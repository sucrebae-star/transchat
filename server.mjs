import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_STATE_FILE = path.join(__dirname, "transchat-server-state.json");

const PORT = Number(process.env.PORT || 3000);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_TRANSLATION_MODEL || "gpt-5-mini";
const TYPING_SIGNAL_TTL_MS = 4500;
const PRESENCE_SIGNAL_TTL_MS = 2 * 60 * 1000;
const ALLOWED_LANGUAGES = new Set(["ko", "en", "vi"]);
const DEMO_USER_NAMES = new Set(["Hana", "Alex", "Linh", "Yuna"]);
const DEMO_ROOM_IDS = new Set(["room-lounge", "room-travel", "room-brainstorm"]);
const DEMO_ROOM_TITLES = new Set(["Global Lounge", "Weekend Passport", "Night Shift Ideas"]);
const PERSISTENT_ROOM_TITLE_KEYS = new Set(["호아와현태", "호아와현태의방"]);
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const STATIC_FILES = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/styles.css", "styles.css"],
  ["/app.js", "app.js"],
]);

let serverState = await loadServerState();
const sseClients = new Set();
const typingSignals = new Map();
const presenceSignals = new Map();
const translationCache = new Map();
let lastTranslationError = null;
let lastTranslationErrorDetail = null;

function normalizeDisplayText(value) {
  const normalized = String(value ?? "").normalize("NFC");
  if (!normalized) return "";

  const characters = Array.from(normalized);
  const isSingleByteOnly = characters.every((character) => character.charCodeAt(0) <= 255);
  const looksSuspicious = /[ÃÂÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ]/.test(normalized);

  if (!isSingleByteOnly || !looksSuspicious) {
    return normalized;
  }

  try {
    const bytes = Uint8Array.from(characters.map((character) => character.charCodeAt(0)));
    const repaired = new TextDecoder("utf-8", { fatal: true }).decode(bytes).normalize("NFC");
    return /[^\u0000-\u007f]/.test(repaired) ? repaired : normalized;
  } catch (error) {
    return normalized;
  }
}

const server = createServer(async (req, res) => {
  const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && requestUrl.pathname === "/api/health") {
    return sendJson(res, 200, {
      ok: true,
      liveTranslationEnabled: Boolean(OPENAI_API_KEY) && !lastTranslationError,
      model: OPENAI_MODEL,
      sharedStateEnabled: true,
      hasServerState: Boolean(serverState),
      translationConfigured: Boolean(OPENAI_API_KEY),
      lastTranslationError,
      lastTranslationErrorDetail,
    });
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/translate") {
    // Later this endpoint can sit behind auth, rate limiting, DB logging, and Socket.IO fan-out.
    return handleTranslate(req, res);
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/typing") {
    return handleTypingUpdate(req, res);
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/presence") {
    return handlePresenceUpdate(req, res);
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/state") {
    return sendJson(res, 200, {
      state: serverState,
    });
  }

  if (req.method === "PUT" && requestUrl.pathname === "/api/state") {
    return handleStateUpdate(req, res);
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/events") {
    return handleEventStream(req, res);
  }

  if (req.method === "GET" || req.method === "HEAD") {
    return serveStatic(requestUrl.pathname, res, req.method === "HEAD");
  }

  return sendJson(res, 405, { error: "method_not_allowed" });
});

async function handleTranslate(req, res) {
  try {
    if (!OPENAI_API_KEY) {
      return sendJson(res, 503, {
        error: "missing_api_key",
        message: "Set OPENAI_API_KEY to enable live translation.",
      });
    }

    const body = await readJsonBody(req);
    const text = String(body?.text || "").trim();
    const sourceLanguage = String(body?.sourceLanguage || "").trim();
    const targetLanguages = Array.isArray(body?.targetLanguages) ? body.targetLanguages : [];

    if (!text || !ALLOWED_LANGUAGES.has(sourceLanguage)) {
      return sendJson(res, 400, { error: "invalid_request" });
    }

    const normalizedTargets = [...new Set(targetLanguages.map((item) => String(item).trim()))]
      .filter((language) => ALLOWED_LANGUAGES.has(language) && language !== sourceLanguage);

    if (!normalizedTargets.length) {
      return sendJson(res, 200, { translations: {} });
    }

    const translationResult = await requestOpenAITranslations({
      text,
      sourceLanguage,
      targetLanguages: normalizedTargets,
    });
    lastTranslationError = null;
    lastTranslationErrorDetail = null;

    return sendJson(res, 200, {
      translations: translationResult.translations,
      model: translationResult.model,
    });
  } catch (error) {
    console.error("[translate]", error);
    lastTranslationError = normalizeTranslationError(error);
    lastTranslationErrorDetail = summarizeTranslationError(error);
    return sendJson(res, 500, {
      error: "translation_failed",
      message: "The translation request could not be completed.",
      detail: lastTranslationErrorDetail,
    });
  }
}

async function handleStateUpdate(req, res) {
  try {
    const body = await readJsonBody(req);
    const nextState = body?.state;
    const sourceId = String(body?.sourceId || "unknown");

    if (!(nextState && nextState.version === 1)) {
      return sendJson(res, 400, { error: "invalid_state" });
    }

    const normalizedState = mergeStates(serverState, {
      ...nextState,
      updatedAt: Number(nextState.updatedAt || Date.now()),
    });

    serverState = normalizedState;
    await saveServerState(normalizedState);
    broadcastServerEvent({
      type: "state-updated",
      sourceId,
      updatedAt: normalizedState.updatedAt,
    });

    return sendJson(res, 200, {
      ok: true,
      updatedAt: normalizedState.updatedAt,
    });
  } catch (error) {
    console.error("[state]", error);
    return sendJson(res, 500, {
      error: "state_update_failed",
    });
  }
}

function mergeStates(previousState, nextState) {
  if (!(previousState && previousState.version === 1)) {
    return sanitizeSharedState(nextState);
  }

  const deletedUsers = mergeDeletedUsers(previousState.deletedUsers || {}, nextState.deletedUsers || {});
  const deletedRooms = mergeDeletedRooms(previousState.deletedRooms || {}, nextState.deletedRooms || {});

  return sanitizeSharedState({
    ...previousState,
    ...nextState,
    deletedUsers,
    deletedRooms,
    users: mergeUsers(previousState.users || [], nextState.users || []),
    invites: mergeInvites(previousState.invites || [], nextState.invites || []),
    rooms: mergeRooms(previousState.rooms || [], nextState.rooms || [], deletedRooms),
    updatedAt: Number(nextState.updatedAt || Date.now()),
  });
}

function mergeDeletedUsers(previousDeletedUsers, nextDeletedUsers) {
  const merged = {
    ...(previousDeletedUsers || {}),
  };

  Object.entries(nextDeletedUsers || {}).forEach(([userId, deletedAt]) => {
    if (!String(userId || "").trim()) return;
    merged[userId] = Math.max(Number(merged[userId] || 0), Number(deletedAt || Date.now()));
  });

  return merged;
}

function mergeDeletedRooms(previousDeletedRooms, nextDeletedRooms) {
  const merged = {
    ...(previousDeletedRooms || {}),
  };

  Object.entries(nextDeletedRooms || {}).forEach(([roomId, deletedAt]) => {
    if (!String(roomId || "").trim()) return;
    merged[roomId] = Math.max(Number(merged[roomId] || 0), Number(deletedAt || Date.now()));
  });

  return merged;
}

function mergeUsers(previousUsers, nextUsers) {
  const previousById = new Map(previousUsers.map((user) => [user.id, user]));
  const nextById = new Map(nextUsers.map((user) => [user.id, user]));
  const mergedIds = new Set([...previousById.keys(), ...nextById.keys()]);

  return [...mergedIds].map((id) => {
    const previous = previousById.get(id);
    const next = nextById.get(id);
    if (!previous) return next;
    if (!next) return previous;
    return {
      ...previous,
      ...next,
      lastSeenAt: Math.max(Number(previous.lastSeenAt || 0), Number(next.lastSeenAt || 0)),
    };
  });
}

function mergeInvites(previousInvites, nextInvites) {
  const previousById = new Map(previousInvites.map((invite) => [invite.id, invite]));
  const nextById = new Map(nextInvites.map((invite) => [invite.id, invite]));
  const mergedIds = new Set([...previousById.keys(), ...nextById.keys()]);

  return [...mergedIds].map((id) => {
    const previous = previousById.get(id);
    const next = nextById.get(id);
    if (!previous) return next;
    if (!next) return previous;
    return {
      ...previous,
      ...next,
      respondedAt: Math.max(Number(previous.respondedAt || 0), Number(next.respondedAt || 0)) || null,
    };
  });
}

function mergeRooms(previousRooms, nextRooms, deletedRooms = {}) {
  const previousById = new Map(previousRooms.map((room) => [room.id, room]));
  const nextById = new Map(nextRooms.map((room) => [room.id, room]));
  const deletedRoomIds = new Set(Object.keys(deletedRooms || {}));
  const mergedIds = new Set([...previousById.keys(), ...nextById.keys()]);

  return [...mergedIds]
    .filter((id) => !deletedRoomIds.has(id))
    .map((id) => {
    const previous = previousById.get(id);
    const next = nextById.get(id);
    if (!previous) return next;
    if (!next) return previous;

    return {
      ...previous,
      ...next,
      messages: mergeMessages(previous.messages || [], next.messages || []),
      unreadByUser: {
        ...(previous.unreadByUser || {}),
        ...(next.unreadByUser || {}),
      },
      accessByUser: {
        ...(previous.accessByUser || {}),
        ...(next.accessByUser || {}),
      },
      lastMessageAt: Math.max(Number(previous.lastMessageAt || 0), Number(next.lastMessageAt || 0)),
      createdAt: Math.min(Number(previous.createdAt || Date.now()), Number(next.createdAt || Date.now())),
      expiredAt: next.expiredAt || previous.expiredAt || null,
    };
    });
}

function mergeMessages(previousMessages, nextMessages) {
  const byId = new Map();

  [...previousMessages, ...nextMessages]
    .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0))
    .forEach((message) => {
      const existing = byId.get(message.id);
      if (!existing) {
        byId.set(message.id, message);
        return;
      }

      byId.set(message.id, {
        ...existing,
        ...message,
        translations: {
          ...(existing.translations || {}),
          ...(message.translations || {}),
        },
        translationMeta: {
          ...(existing.translationMeta || {}),
          ...(message.translationMeta || {}),
        },
      });
    });

  return [...byId.values()].sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
}

async function handleTypingUpdate(req, res) {
  try {
    const body = await readJsonBody(req);
    const roomId = String(body?.roomId || "").trim();
    const userId = String(body?.userId || "").trim();
    const name = String(body?.name || "").trim();
    const isTyping = Boolean(body?.isTyping);

    if (!roomId || !userId) {
      return sendJson(res, 400, { error: "invalid_typing_payload" });
    }

    const roomSignals = typingSignals.get(roomId) || new Map();
    if (isTyping) {
      roomSignals.set(userId, {
        roomId,
        userId,
        name,
        isTyping: true,
        expiresAt: Date.now() + TYPING_SIGNAL_TTL_MS,
      });
      typingSignals.set(roomId, roomSignals);
    } else {
      roomSignals.delete(userId);
      if (roomSignals.size) {
        typingSignals.set(roomId, roomSignals);
      } else {
        typingSignals.delete(roomId);
      }
    }

    pruneTypingSignals();
    broadcastServerEvent({
      type: "typing-updated",
      roomId,
      userId,
      name,
      isTyping,
      expiresAt: Date.now() + TYPING_SIGNAL_TTL_MS,
    });

    return sendJson(res, 200, { ok: true });
  } catch (error) {
    console.error("[typing]", error);
    return sendJson(res, 500, { error: "typing_update_failed" });
  }
}

async function handlePresenceUpdate(req, res) {
  try {
    const body = await readJsonBody(req);
    const userId = String(body?.userId || "").trim();
    const currentRoomId = body?.currentRoomId ? String(body.currentRoomId).trim() : null;
    const lastSeenAt = Number(body?.lastSeenAt || Date.now());

    if (!userId) {
      return sendJson(res, 400, { error: "invalid_presence_payload" });
    }

    presenceSignals.set(userId, {
      userId,
      currentRoomId,
      lastSeenAt,
      expiresAt: Date.now() + PRESENCE_SIGNAL_TTL_MS,
    });

    prunePresenceSignals();
    broadcastServerEvent({
      type: "presence-updated",
      userId,
      currentRoomId,
      lastSeenAt,
    });

    return sendJson(res, 200, { ok: true });
  } catch (error) {
    console.error("[presence]", error);
    return sendJson(res, 500, { error: "presence_update_failed" });
  }
}

function handleEventStream(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });

  const client = { res };
  sseClients.add(client);

  res.write(`event: ready\ndata: ${JSON.stringify({ ok: true, at: Date.now() })}\n\n`);

  req.on("close", () => {
    sseClients.delete(client);
  });
}

function pruneTypingSignals() {
  const now = Date.now();
  for (const [roomId, roomSignals] of typingSignals.entries()) {
    for (const [userId, entry] of roomSignals.entries()) {
      if (!entry || entry.expiresAt <= now) {
        roomSignals.delete(userId);
      }
    }

    if (!roomSignals.size) {
      typingSignals.delete(roomId);
    }
  }
}

function prunePresenceSignals() {
  const now = Date.now();
  for (const [userId, entry] of presenceSignals.entries()) {
    if (!entry || entry.expiresAt <= now) {
      presenceSignals.delete(userId);
    }
  }
}

function normalizeTranslationError(error) {
  const raw = String(error?.message || "translation_error").toLowerCase();
  if (raw.includes("invalid_api_key")) return "invalid_api_key";
  if (raw.includes("insufficient_quota")) return "insufficient_quota";
  if (raw.includes("rate_limit")) return "rate_limited";
  if (raw.includes("model_not_found") || raw.includes("does not have access") || raw.includes("unsupported model")) {
    return "model_unavailable";
  }
  return "translation_error";
}

async function requestOpenAITranslations({ text, sourceLanguage, targetLanguages }) {
  if (!targetLanguages.length) {
    return {
      translations: {},
      model: OPENAI_MODEL,
    };
  }

  const translatedEntries = await Promise.all(
    targetLanguages.map(async (targetLanguage) => {
      const translatedText = await requestSingleOpenAITranslation({
        text,
        sourceLanguage,
        targetLanguage,
      });
      return [
        targetLanguage,
        {
          text: translatedText || text,
          failed: false,
        },
      ];
    })
  );

  return {
    translations: Object.fromEntries(translatedEntries),
    model: OPENAI_MODEL,
  };
}

async function requestSingleOpenAITranslation({ text, sourceLanguage, targetLanguage }) {
  const cacheKey = JSON.stringify({
    model: OPENAI_MODEL,
    sourceLanguage,
    targetLanguage,
    text,
  });
  const cached = translationCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const payload = {
    model: OPENAI_MODEL,
    store: false,
    reasoning: {
      effort: "minimal",
    },
    max_output_tokens: estimateTranslationOutputTokens(text),
    // Policy note: realtime translation sends message text to the configured OpenAI API endpoint only while live translation is enabled.
    input: buildTranslationPrompt({
      text,
      sourceLanguage,
      targetLanguage,
    }),
  };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const outputText = normalizeTranslatedText(extractResponseText(data), text);
  translationCache.set(cacheKey, outputText);
  return outputText;
}

function buildTranslationPrompt({ text, sourceLanguage, targetLanguage }) {
  return [
    "You are a realtime chat translator.",
    "Translate the full message into the target language only.",
    "Do not summarize, shorten, simplify away details, or omit any part of the message.",
    "Return only the final translated message text with no labels or commentary.",
    "Make the translation sound natural for a real chat conversation.",
    "Preserve the full meaning, tone, sentence count, URLs, emojis, @mentions, hashtags, punctuation, and line breaks.",
    `Source language: ${describeLanguage(sourceLanguage)}.`,
    `Target language: ${describeLanguage(targetLanguage)}.`,
    "Message:",
    text,
  ].join("\n");
}

function estimateTranslationOutputTokens(text) {
  const approximateInputTokens = Math.max(24, Math.ceil(String(text || "").length / 3));
  const estimatedOutput = Math.ceil(approximateInputTokens * 2.6 + 96);
  return Math.min(4096, Math.max(192, estimatedOutput));
}

function describeLanguage(code) {
  return (
    {
      ko: "Korean",
      en: "English",
      vi: "Vietnamese",
    }[code] || code
  );
}

function normalizeTranslatedText(outputText, originalText) {
  const trimmed = String(outputText || "").trim();
  if (!trimmed) return String(originalText || "");
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim() || String(originalText || "");
  }
  return trimmed;
}

function extractResponseText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text;
  }

  for (const item of data?.output || []) {
    if (item?.type !== "message" || !Array.isArray(item.content)) continue;

    for (const content of item.content) {
      if (content?.type === "refusal") {
        throw new Error("Model refused translation output.");
      }

      if (typeof content?.text === "string" && content.text.trim()) {
        return content.text;
      }
    }
  }

  throw new Error("No text output returned from Responses API.");
}

function summarizeTranslationError(error) {
  const raw = String(error?.message || "translation_error").replace(/\s+/g, " ").trim();
  return raw.slice(0, 320);
}

function sanitizeSharedState(state) {
  if (!(state && state.version === 1)) {
    return null;
  }

  const deletedUsers = sanitizeDeletedUsers(state.deletedUsers);
  const deletedUserIds = new Set(Object.keys(deletedUsers));
  const deletedRooms = sanitizeDeletedRooms(state.deletedRooms);
  const deletedRoomIds = new Set(Object.keys(deletedRooms));

  const users = (state.users || [])
    .filter((user) => !deletedUserIds.has(user.id) && !isDemoUser(user))
    .map((user) => ({
      ...user,
      name: normalizeDisplayText(user.name),
      auth: {
        provider: user?.auth?.provider || "test-name",
        subject: user?.auth?.subject || normalizeDisplayText(user.name).trim().toLowerCase(),
        email: user?.auth?.email || null,
        phoneNumber: user?.auth?.phoneNumber || null,
        phoneVerified: Boolean(user?.auth?.phoneVerified),
      },
      blockedUserIds: Array.isArray(user?.blockedUserIds) ? user.blockedUserIds : [],
    }));
  const userIds = new Set(users.map((user) => user.id));

  const rooms = (state.rooms || [])
    .filter((room) => !deletedRoomIds.has(room.id) && !isDemoRoom(room) && !shouldDiscardRoom(room))
    .map((room) => {
      const persistent = isPersistentRoom(room);
      const participants = deriveRoomParticipantIds(room, users);
      return {
        ...room,
        title: normalizeDisplayText(room.title),
        disableExpiration: persistent,
        status: persistent && room.status === "expired" ? "active" : room.status,
        expiredAt: persistent ? null : room.expiredAt || null,
        participants,
        accessByUser: filterRecordByAllowedKeys(room.accessByUser, userIds),
        unreadByUser: filterRecordByAllowedKeys(room.unreadByUser, userIds),
      };
    });
  const roomIds = new Set(rooms.map((room) => room.id));

  return {
    ...state,
    deletedUsers,
    deletedRooms,
    updatedAt: Number(state.updatedAt || Date.now()),
    users: users.map((user) => ({
      ...user,
      currentRoomId: roomIds.has(user.currentRoomId) ? user.currentRoomId : null,
    })),
    invites: (state.invites || []).filter((invite) => {
      return roomIds.has(invite.roomId) && userIds.has(invite.inviterId) && userIds.has(invite.inviteeId);
    }),
    rooms,
  };
}

function isDemoUser(user) {
  return DEMO_USER_NAMES.has(String(user?.name || "").trim());
}

function isDemoRoom(room) {
  return DEMO_ROOM_IDS.has(room?.id) || DEMO_ROOM_TITLES.has(String(room?.title || "").trim());
}

function shouldDiscardRoom(room) {
  return room?.status === "expired" && !(room?.messages || []).some((message) => message.kind === "user");
}

function isPersistentRoom(room) {
  return Boolean(room?.disableExpiration) || isPersistentRoomTitle(room?.title);
}

function isPersistentRoomTitle(title) {
  const normalized = normalizeRoomTitle(title);
  return PERSISTENT_ROOM_TITLE_KEYS.has(normalized) || normalized.includes("호아와현태");
}

function normalizeRoomTitle(title) {
  return normalizeDisplayText(title)
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function filterRecordByAllowedKeys(record, allowedIds) {
  return Object.fromEntries(Object.entries(record || {}).filter(([key]) => allowedIds.has(key)));
}

function deriveRoomParticipantIds(room, users = []) {
  const userIds = new Set((users || []).map((user) => user.id));
  const participantIds = new Set((room?.participants || []).filter((participantId) => userIds.has(participantId)));
  (users || []).forEach((user) => {
    if (user?.currentRoomId === room?.id && userIds.has(user.id)) {
      participantIds.add(user.id);
    }
  });
  return [...participantIds];
}

function sanitizeDeletedRooms(record) {
  return Object.fromEntries(
    Object.entries(record || {})
      .filter(([roomId]) => Boolean(String(roomId || "").trim()))
      .map(([roomId, deletedAt]) => [roomId, Number(deletedAt || Date.now())])
  );
}

function sanitizeDeletedUsers(record) {
  return Object.fromEntries(
    Object.entries(record || {})
      .filter(([userId]) => Boolean(String(userId || "").trim()))
      .map(([userId, deletedAt]) => [userId, Number(deletedAt || Date.now())])
  );
}

async function loadServerState() {
  try {
    const raw = await readFile(SERVER_STATE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!(parsed && parsed.version === 1)) {
      return null;
    }

    const sanitized = sanitizeSharedState(parsed);
    if (JSON.stringify(sanitized) !== JSON.stringify(parsed)) {
      await saveServerState(sanitized);
    }
    return sanitized;
  } catch (error) {
    return null;
  }
}

async function saveServerState(state) {
  await writeFile(SERVER_STATE_FILE, JSON.stringify(state), "utf8");
}

function broadcastServerEvent(payload) {
  const serialized = `event: ${payload.type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients) {
    client.res.write(serialized);
  }
}

async function serveStatic(requestPath, res, headOnly) {
  const fileName = STATIC_FILES.get(requestPath);
  if (!fileName) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  const absolutePath = path.join(__dirname, fileName);
  const ext = path.extname(fileName).toLowerCase();

  try {
    const fileBuffer = await readFile(absolutePath);
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(headOnly ? undefined : fileBuffer);
  } catch (error) {
    console.error("[static]", error);
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Static file error");
  }
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";

    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 200_000) {
        reject(new Error("Request body too large"));
      }
    });

    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(new Error("Invalid JSON body"));
      }
    });

    req.on("error", reject);
  });
}

server.listen(PORT, () => {
  console.log(`TRANSCHAT local server running at http://localhost:${PORT}`);
  console.log(
    OPENAI_API_KEY
      ? `Live translation enabled with model ${OPENAI_MODEL}.`
      : "OPENAI_API_KEY is missing. The client will fall back to mock translation."
  );
});
