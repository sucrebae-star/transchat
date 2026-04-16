import { createServer } from "node:http";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_STATE_FILE = path.join(__dirname, "transchat-server-state.json");
const PUSH_TOKEN_STATE_FILE = path.join(__dirname, "transchat-push-tokens.json");
const STATE_SCHEMA_VERSION = 2;
const PUSH_TOKEN_SCHEMA_VERSION = 1;

const PORT = Number(process.env.PORT || 3000);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_TRANSLATION_MODEL || "gpt-5-mini";
const FIREBASE_WEB_CONFIG_FALLBACK = {
  apiKey: "AIzaSyB9ZcnjW7n0WVNVg3ELHvSUfnYK_BfK3_0",
  authDomain: "transchat-push.firebaseapp.com",
  projectId: "transchat-push",
  storageBucket: "transchat-push.firebasestorage.app",
  messagingSenderId: "1060316273156",
  appId: "1:1060316273156:web:1404f3c390b189a7377351",
};
const FIREBASE_VAPID_KEY_FALLBACK = "BB1LDIwYOl1eop_5Q8Oka2WQDXwapy-tOmDaIL0ljTtF90lOTYkONeydXEBE_u0_IJQBHx6djF2yftZvhqpz2Ws";
const FIREBASE_WEB_CONFIG_JSON = process.env.FIREBASE_WEB_CONFIG_JSON || JSON.stringify(FIREBASE_WEB_CONFIG_FALLBACK);
const FIREBASE_VAPID_KEY = process.env.FIREBASE_VAPID_KEY || FIREBASE_VAPID_KEY_FALLBACK;
const FIREBASE_SERVICE_ACCOUNT_PATH = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || "";
const ROOM_AUTO_EXPIRATION_ENABLED = false;
const TYPING_SIGNAL_TTL_MS = 4500;
const PRESENCE_SIGNAL_TTL_MS = 2 * 60 * 1000;
const ALLOWED_LANGUAGES = new Set(["ko", "en", "vi"]);
const DEMO_USER_NAMES = new Set(["Hana", "Alex", "Linh", "Yuna"]);
const DEMO_ROOM_IDS = new Set(["room-lounge", "room-travel", "room-brainstorm"]);
const DEMO_ROOM_TITLES = new Set(["Global Lounge", "Weekend Passport", "Night Shift Ideas"]);
const PERSISTENT_ROOM_TITLE_KEYS = new Set(["호아와현태", "호아와현태의방"]);
const RECOVERY_QUESTION_KEYS = [
  "recoveryFavoriteColor",
  "recoveryChildhoodNickname",
  "recoveryFavoriteAnimal",
  "recoveryMemorableFood",
  "recoveryFavoriteSeason",
];

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
};

const STATIC_FILES = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/manifest.json", "manifest.json"],
  ["/.well-known/assetlinks.json", path.join(".well-known", "assetlinks.json")],
  ["/styles.css", "styles.css"],
  ["/app.js", "app.js"],
  ["/firebase-messaging-sw.js", "firebase-messaging-sw.runtime.js"],
  ["/icons/icon-192.png", path.join("icons", "icon-192.png")],
  ["/icons/icon-512.png", path.join("icons", "icon-512.png")],
  ["/icons/apple-touch-icon.png", path.join("icons", "apple-touch-icon.png")],
]);

let serverState = await loadServerState();
let pushTokenState = await loadPushTokenState();
const sseClients = new Set();
const typingSignals = new Map();
const presenceSignals = new Map();
const translationCache = new Map();
let firebaseMessagingPromise = null;
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

function countMatches(value, pattern) {
  const matches = String(value || "").match(pattern);
  return matches ? matches.length : 0;
}

function isEncodingCorruptedText(value, expectedLanguage = "") {
  const text = String(value ?? "").normalize("NFC");
  if (!text) return false;
  if (text.includes("\uFFFD")) return true;

  const questionBurstCount = countMatches(text, /\?{2,}/g);
  const cjkCount = countMatches(text, /[\u4E00-\u9FFF]/g);
  const hangulCount = countMatches(text, /[\uAC00-\uD7AF]/g);
  const latinCount = countMatches(text, /[A-Za-zÀ-ỹ]/g);
  const weirdScriptCount = cjkCount + hangulCount;
  const weirdRatio = weirdScriptCount / Math.max(text.length, 1);

  if (questionBurstCount && weirdScriptCount >= 2) {
    return true;
  }

  if (expectedLanguage === "ko") {
    return hangulCount === 0 && (questionBurstCount > 0 || cjkCount >= 2);
  }

  if (expectedLanguage === "vi" || expectedLanguage === "en") {
    return latinCount >= 4 && weirdScriptCount >= 4 && weirdRatio > 0.12;
  }

  return false;
}

function summarizeTextForTrace(value) {
  const text = String(value ?? "");
  return {
    length: text.length,
    replacement: text.includes("\uFFFD"),
    preview: text.slice(0, 80),
    codepoints: Array.from(text.slice(0, 8)).map((character) => `U+${character.codePointAt(0).toString(16).toUpperCase()}`),
  };
}

function logEncodingTrace(stage, value, extra = {}) {
  const text = String(value ?? "");
  if (!text) return;
  console.info(`[encoding] ${stage}`, {
    ...extra,
    ...summarizeTextForTrace(text),
  });
}

function getLatestUserMessageForTrace(state = serverState) {
  const rooms = Array.isArray(state?.rooms) ? [...state.rooms] : [];
  const latestRoom = rooms
    .filter((room) => Array.isArray(room?.messages) && room.messages.length)
    .sort((a, b) => Number(b.lastMessageAt || b.createdAt || 0) - Number(a.lastMessageAt || a.createdAt || 0))[0];
  const latestMessage = [...(latestRoom?.messages || [])]
    .filter((message) => message?.kind === "user" && String(message?.originalText || "").trim())
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))[0];
  if (!(latestRoom && latestMessage)) {
    return null;
  }
  return {
    roomId: latestRoom.id,
    messageId: latestMessage.id,
    text: latestMessage.originalText,
  };
}

function normalizeRecoveryAnswer(value) {
  return normalizeDisplayText(value)
    .replace(/\s+/g, "")
    .trim()
    .toLowerCase();
}

function getDeterministicRecoveryQuestionKey(seedValue) {
  const seed = normalizeDisplayText(seedValue || "transchat").trim().toLowerCase();
  let hash = 0;
  for (const character of Array.from(seed)) {
    hash = (hash + character.codePointAt(0)) % RECOVERY_QUESTION_KEYS.length;
  }
  return RECOVERY_QUESTION_KEYS[hash] || RECOVERY_QUESTION_KEYS[0];
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

  if (req.method === "GET" && requestUrl.pathname === "/api/push/config") {
    return handlePushConfig(req, res);
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/push/register") {
    return handlePushRegister(req, res);
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/push/unregister") {
    return handlePushUnregister(req, res);
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/push/send-test") {
    return handlePushSendTest(req, res);
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
    const text = normalizeDisplayText(body?.text).trim();
    const sourceLanguage = String(body?.sourceLanguage || "").trim();
    const targetLanguages = Array.isArray(body?.targetLanguages) ? body.targetLanguages : [];
    const translationConcept = normalizeTranslationConcept(body?.translationConcept);
    const contextSummary = String(body?.contextSummary || "").trim().slice(0, 800);

    if (!text || !ALLOWED_LANGUAGES.has(sourceLanguage)) {
      return sendJson(res, 400, { error: "invalid_request" });
    }

    if (isEncodingCorruptedText(text, sourceLanguage)) {
      return sendJson(res, 422, {
        error: "encoding_corrupted",
        message: "Source text is already damaged and cannot be translated safely.",
      });
    }

    const normalizedTargets = [...new Set(targetLanguages.map((item) => String(item).trim()))]
      .filter((language) => ALLOWED_LANGUAGES.has(language) && language !== sourceLanguage);

    if (!normalizedTargets.length) {
      return sendJson(res, 200, { translations: {} });
    }

    console.info("[translate] request", {
      sourceLanguage,
      targetLanguages: normalizedTargets,
      translationConcept,
      contextSummaryLength: contextSummary.length,
      length: text.length,
    });
    logEncodingTrace("server-translate-received", text, {
      sourceLanguage,
      targetLanguages: normalizedTargets,
    });

    const translationResult = await requestOpenAITranslations({
      text,
      sourceLanguage,
      targetLanguages: normalizedTargets,
      translationConcept,
      contextSummary,
    });
    lastTranslationError = null;
    lastTranslationErrorDetail = null;
    Object.entries(translationResult.translations || {}).forEach(([language, entry]) => {
      logEncodingTrace("server-translate-result", entry?.text || "", {
        targetLanguage: language,
        sourceLanguage,
      });
    });

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

async function handlePushConfig(_req, res) {
  const clientConfig = getFirebaseClientConfig();
  return sendJson(res, 200, {
    enabled: Boolean(clientConfig && FIREBASE_VAPID_KEY),
    webConfig: clientConfig,
    vapidKey: FIREBASE_VAPID_KEY || "",
  });
}

async function handlePushRegister(req, res) {
  try {
    const body = await readJsonBody(req);
    const userId = String(body?.userId || "").trim();
    const token = String(body?.token || "").trim();
    const platform = String(body?.platform || "web").trim() || "web";

    if (!userId || !token) {
      return sendJson(res, 400, { error: "invalid_push_registration" });
    }

    if (!serverState?.users?.some((user) => user.id === userId)) {
      return sendJson(res, 404, { error: "user_not_found" });
    }

    upsertPushToken({ userId, token, platform });
    await savePushTokenState(pushTokenState);
    return sendJson(res, 200, { ok: true });
  } catch (error) {
    console.error("[push-register]", error);
    return sendJson(res, 500, { error: "push_register_failed" });
  }
}

async function handlePushUnregister(req, res) {
  try {
    const body = await readJsonBody(req);
    const userId = String(body?.userId || "").trim();
    const token = String(body?.token || "").trim();
    if (!userId && !token) {
      return sendJson(res, 400, { error: "invalid_push_unregistration" });
    }

    const changed = removePushToken({ userId, token });
    if (changed) {
      await savePushTokenState(pushTokenState);
    }
    return sendJson(res, 200, { ok: true, removed: changed });
  } catch (error) {
    console.error("[push-unregister]", error);
    return sendJson(res, 500, { error: "push_unregister_failed" });
  }
}

async function handlePushSendTest(req, res) {
  try {
    const body = await readJsonBody(req);
    const userId = String(body?.userId || "").trim();
    const type = String(body?.type || "message").trim().toLowerCase();

    if (!userId || !["message", "invite"].includes(type)) {
      return sendJson(res, 400, { error: "invalid_push_test_request" });
    }

    const targetUser = (serverState?.users || []).find((user) => user.id === userId);
    if (!targetUser) {
      return sendJson(res, 404, { error: "user_not_found" });
    }

    const tokenEntries = getPushTokensForUser(userId);
    if (!tokenEntries.length) {
      return sendJson(res, 409, {
        error: "push_token_not_found",
        message: "No push token is registered for this user.",
      });
    }

    const payload = buildTestPushPayload(userId, type);
    const result = await sendPushToUser(userId, payload);
    console.info("[push-test]", {
      userId,
      type,
      attempted: result.attempted,
      delivered: result.delivered,
      errors: result.errors || [],
    });

    return sendJson(res, 200, {
      ok: true,
      type,
      userId,
      attempted: result.attempted,
      delivered: result.delivered,
      errors: result.errors || [],
      reason: result.reason || "",
      roomId: payload.roomId || "",
      inviteId: payload.inviteId || "",
    });
  } catch (error) {
    console.error("[push-test]", error);
    return sendJson(res, 500, { error: "push_test_failed" });
  }
}

async function handleStateUpdate(req, res) {
  try {
    const body = await readJsonBody(req);
    const nextState = body?.state;
    const sourceId = String(body?.sourceId || "unknown");

    if (!(nextState && [1, STATE_SCHEMA_VERSION].includes(Number(nextState.version || 0)))) {
      return sendJson(res, 400, { error: "invalid_state" });
    }

    const previousState = serverState;
    const incomingTrace = getLatestUserMessageForTrace(nextState);
    if (incomingTrace) {
      logEncodingTrace("server-state-received", incomingTrace.text, {
        roomId: incomingTrace.roomId,
        messageId: incomingTrace.messageId,
        sourceId,
      });
    }
    const normalizedState = mergeStates(serverState, {
      ...nextState,
      updatedAt: Number(nextState.updatedAt || Date.now()),
    });
    const normalizedTrace = getLatestUserMessageForTrace(normalizedState);
    if (normalizedTrace) {
      logEncodingTrace("server-state-normalized", normalizedTrace.text, {
        roomId: normalizedTrace.roomId,
        messageId: normalizedTrace.messageId,
        sourceId,
      });
    }

    serverState = normalizedState;
    prunePushTokensForDeletedUsers(serverState);
    await saveServerState(normalizedState);
    broadcastServerEvent({
      type: "state-updated",
      sourceId,
      updatedAt: normalizedState.updatedAt,
    });
    if (previousState) {
      void dispatchPushNotifications(previousState, normalizedState);
    }

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
  if (!(previousState && [1, STATE_SCHEMA_VERSION].includes(Number(previousState.version || 0)))) {
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
    const nextPassword =
      typeof next.password === "string" && next.password.length
        ? next.password
        : typeof previous.password === "string"
          ? previous.password
          : "";
    const nextRecoveryQuestion =
      RECOVERY_QUESTION_KEYS.includes(next.recoveryQuestion)
        ? next.recoveryQuestion
        : RECOVERY_QUESTION_KEYS.includes(next.recoveryQuestionKey)
          ? next.recoveryQuestionKey
          : RECOVERY_QUESTION_KEYS.includes(previous.recoveryQuestion)
            ? previous.recoveryQuestion
            : previous.recoveryQuestionKey;
    const nextRecoveryAnswer =
      typeof next.recoveryAnswer === "string" && next.recoveryAnswer.length
        ? next.recoveryAnswer
        : previous.recoveryAnswer;
    return {
      ...previous,
      ...next,
      password: nextPassword,
      recoveryQuestion: nextRecoveryQuestion,
      recoveryQuestionKey: nextRecoveryQuestion,
      recoveryAnswer: nextRecoveryAnswer,
      joinedAt: Math.min(Number(previous.joinedAt || previous.createdAt || Date.now()), Number(next.joinedAt || next.createdAt || Date.now())),
      lastSeenAt: Math.max(Number(previous.lastSeenAt || 0), Number(next.lastSeenAt || 0)),
      lastLoginAt: Math.max(Number(previous.lastLoginAt || 0), Number(next.lastLoginAt || 0)) || null,
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
      seenByInvitee: Boolean(previous.seenByInvitee || next.seenByInvitee),
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
        deliveredTo: {
          ...(existing.deliveredTo || {}),
          ...(message.deliveredTo || {}),
        },
        readBy: {
          ...(existing.readBy || {}),
          ...(message.readBy || {}),
        },
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

function getFirebaseClientConfig() {
  if (!FIREBASE_WEB_CONFIG_JSON) return null;
  try {
    const parsed = JSON.parse(FIREBASE_WEB_CONFIG_JSON);
    if (!(parsed && typeof parsed === "object")) {
      return null;
    }
    return {
      apiKey: String(parsed.apiKey || "").trim(),
      authDomain: String(parsed.authDomain || "").trim(),
      projectId: String(parsed.projectId || "").trim(),
      storageBucket: String(parsed.storageBucket || "").trim(),
      messagingSenderId: String(parsed.messagingSenderId || "").trim(),
      appId: String(parsed.appId || "").trim(),
      measurementId: String(parsed.measurementId || "").trim(),
    };
  } catch (error) {
    console.warn("[push-config] Invalid FIREBASE_WEB_CONFIG_JSON", error);
    return null;
  }
}

async function resolveFirebaseServiceAccountPath() {
  if (FIREBASE_SERVICE_ACCOUNT_PATH) {
    return path.isAbsolute(FIREBASE_SERVICE_ACCOUNT_PATH)
      ? FIREBASE_SERVICE_ACCOUNT_PATH
      : path.join(__dirname, FIREBASE_SERVICE_ACCOUNT_PATH);
  }

  try {
    const entries = await readdir(__dirname);
    const match = entries.find((entry) => /firebase.*adminsdk.*\.json$/i.test(entry) || /adminsdk.*\.json$/i.test(entry));
    return match ? path.join(__dirname, match) : "";
  } catch (error) {
    return "";
  }
}

async function getFirebaseMessagingClient() {
  if (firebaseMessagingPromise) {
    return firebaseMessagingPromise;
  }

  firebaseMessagingPromise = (async () => {
    const serviceAccountPath = await resolveFirebaseServiceAccountPath();
    if (!serviceAccountPath) {
      console.warn("[push] No Firebase service account path found.");
      return null;
    }

    try {
      const serviceAccountRaw = await readFile(serviceAccountPath, "utf8");
      const serviceAccount = JSON.parse(serviceAccountRaw);
      const adminModule = await import("firebase-admin");
      const admin = adminModule.default || adminModule;
      if (!admin.apps.length) {
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
        });
      }
      return admin.messaging();
    } catch (error) {
      console.error("[push] Firebase Admin init failed", error);
      return null;
    }
  })();

  return firebaseMessagingPromise;
}

function sanitizePushTokenState(parsed) {
  const byToken = new Map();
  (parsed?.tokens || []).forEach((entry) => {
    const token = String(entry?.token || "").trim();
    const userId = String(entry?.userId || "").trim();
    if (!token || !userId) return;
    const previous = byToken.get(token);
    const nextEntry = {
      token,
      userId,
      platform: String(entry?.platform || "web").trim() || "web",
      updatedAt: Number(entry?.updatedAt || Date.now()),
    };
    if (!previous || nextEntry.updatedAt >= previous.updatedAt) {
      byToken.set(token, nextEntry);
    }
  });

  return {
    version: PUSH_TOKEN_SCHEMA_VERSION,
    tokens: [...byToken.values()].sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0)),
  };
}

async function loadPushTokenState() {
  try {
    const raw = await readFile(PUSH_TOKEN_STATE_FILE, "utf8");
    return sanitizePushTokenState(JSON.parse(raw));
  } catch (error) {
    return {
      version: PUSH_TOKEN_SCHEMA_VERSION,
      tokens: [],
    };
  }
}

async function savePushTokenState(state) {
  await writeFile(PUSH_TOKEN_STATE_FILE, JSON.stringify(sanitizePushTokenState(state)), "utf8");
}

function upsertPushToken(entry) {
  const nextEntry = {
    token: String(entry?.token || "").trim(),
    userId: String(entry?.userId || "").trim(),
    platform: String(entry?.platform || "web").trim() || "web",
    updatedAt: Date.now(),
  };
  if (!nextEntry.token || !nextEntry.userId) return false;

  const filtered = (pushTokenState?.tokens || []).filter((item) => item.token !== nextEntry.token);
  filtered.unshift(nextEntry);
  pushTokenState = sanitizePushTokenState({
    version: PUSH_TOKEN_SCHEMA_VERSION,
    tokens: filtered,
  });
  return true;
}

function removePushToken({ userId = "", token = "" } = {}) {
  const nextUserId = String(userId || "").trim();
  const nextToken = String(token || "").trim();
  const before = (pushTokenState?.tokens || []).length;
  pushTokenState = sanitizePushTokenState({
    version: PUSH_TOKEN_SCHEMA_VERSION,
    tokens: (pushTokenState?.tokens || []).filter((entry) => {
      if (nextToken && entry.token === nextToken) return false;
      if (nextUserId && entry.userId === nextUserId && !nextToken) return false;
      return true;
    }),
  });
  return (pushTokenState?.tokens || []).length !== before;
}

function prunePushTokensForDeletedUsers(state) {
  const activeUserIds = new Set((state?.users || []).map((user) => user.id));
  const before = (pushTokenState?.tokens || []).length;
  pushTokenState = sanitizePushTokenState({
    version: PUSH_TOKEN_SCHEMA_VERSION,
    tokens: (pushTokenState?.tokens || []).filter((entry) => activeUserIds.has(entry.userId)),
  });
  if ((pushTokenState?.tokens || []).length !== before) {
    void savePushTokenState(pushTokenState);
  }
}

function getPushTokensForUser(userId) {
  return (pushTokenState?.tokens || []).filter((entry) => entry.userId === userId);
}

function collectNewUserMessages(previousState, nextState) {
  const previousRoomMap = new Map((previousState?.rooms || []).map((room) => [room.id, room]));
  const events = [];

  (nextState?.rooms || []).forEach((room) => {
    const previousRoom = previousRoomMap.get(room.id);
    const previousMessageIds = new Set((previousRoom?.messages || []).map((message) => message.id));
    (room.messages || []).forEach((message) => {
      if (message?.kind !== "user" || previousMessageIds.has(message.id)) return;
      events.push({ room, message });
    });
  });

  return events;
}

function collectNewPendingInvites(previousState, nextState) {
  const previousInviteMap = new Map((previousState?.invites || []).map((invite) => [invite.id, invite]));
  return (nextState?.invites || []).filter((invite) => {
    const previousInvite = previousInviteMap.get(invite.id);
    if (!previousInvite) {
      return invite.status === "pending";
    }
    return previousInvite.status !== "pending" && invite.status === "pending";
  });
}

function buildPushMessagePreview(message) {
  const originalText = String(message?.originalText || "").trim();
  if (originalText) {
    return originalText.length > 80 ? `${originalText.slice(0, 77)}...` : originalText;
  }
  if (message?.media?.kind === "image") return "사진을 보냈어요";
  if (message?.media?.kind === "video") return "영상을 보냈어요";
  if (message?.media?.kind === "file") return "파일을 보냈어요";
  return "새 메시지가 도착했어요";
}

function normalizePushPayload(payload) {
  return Object.fromEntries(
    Object.entries(payload || {}).map(([key, value]) => [key, value == null ? "" : String(value)])
  );
}

function isInvalidPushTokenError(error) {
  const code = String(error?.code || error?.errorInfo?.code || "").toLowerCase();
  return code.includes("registration-token-not-registered") || code.includes("invalid-registration-token");
}

function getPushTestRoomForUser(userId) {
  const rooms = (serverState?.rooms || []).filter((room) => room?.status === "active");
  return rooms.find((room) => deriveRoomParticipantIds(room, serverState?.users || []).includes(userId)) || null;
}

function getPushTestInviteForUser(userId) {
  return (serverState?.invites || []).find((invite) => invite.inviteeId === userId && invite.status === "pending") || null;
}

function buildTestPushPayload(userId, type) {
  const now = Date.now();
  if (type === "invite") {
    const invite = getPushTestInviteForUser(userId);
    return {
      type: "invite",
      inviteId: invite?.id || `test-invite-${now}`,
      senderId: "system-test",
      senderName: "TRANSCHAT",
      previewText: invite?.previewRoomTitle || "테스트 초대 알림입니다.",
      createdAt: now,
      title: "새 초대",
      body: "TRANSCHAT님이 채팅 초대를 보냈어요",
      tag: invite?.id ? `invite:${invite.id}` : `invite:test:${userId}`,
      clickPath: "/?pushType=invite",
    };
  }

  const room = getPushTestRoomForUser(userId);
  return {
    type: "message",
    roomId: room?.id || "",
    senderId: "system-test",
    senderName: "TRANSCHAT",
    previewText: "테스트 푸시 알림입니다.",
    createdAt: now,
    title: "새 메시지",
    body: "TRANSCHAT: 테스트 푸시 알림입니다.",
    tag: room?.id ? `room:${room.id}` : `room:test:${userId}`,
    clickPath: room?.id ? `/?pushType=message&roomId=${encodeURIComponent(room.id)}` : "/",
  };
}

async function sendPushToUser(userId, payload) {
  const tokens = getPushTokensForUser(userId);
  if (!tokens.length) {
    return {
      attempted: 0,
      delivered: 0,
      reason: "no_registered_tokens",
      errors: [],
    };
  }

  const messaging = await getFirebaseMessagingClient();
  if (!messaging) {
    return {
      attempted: tokens.length,
      delivered: 0,
      reason: "firebase_admin_unavailable",
      errors: [],
    };
  }

  let delivered = 0;
  const errors = [];

  for (const entry of tokens) {
    try {
      await messaging.send({
        token: entry.token,
        data: normalizePushPayload(payload),
        webpush: {
          headers: {
            Urgency: "high",
            TTL: "120",
          },
        },
      });
      delivered += 1;
    } catch (error) {
      console.error("[push-send]", error);
      errors.push({
        code: String(error?.code || error?.errorInfo?.code || "unknown_error"),
        message: String(error?.message || "Push send failed"),
        tokenTail: entry.token.slice(-12),
      });
      if (isInvalidPushTokenError(error)) {
        removePushToken({ token: entry.token });
        await savePushTokenState(pushTokenState);
      }
    }
  }

  return {
    attempted: tokens.length,
    delivered,
    reason: delivered > 0 ? "" : errors[0]?.code || "push_send_failed",
    errors,
  };
}

async function dispatchPushNotifications(previousState, nextState) {
  const clientConfig = getFirebaseClientConfig();
  if (!(clientConfig && FIREBASE_VAPID_KEY)) {
    return;
  }

  const messageEvents = collectNewUserMessages(previousState, nextState);
  const inviteEvents = collectNewPendingInvites(previousState, nextState);

  for (const event of messageEvents) {
    const sender = (nextState?.users || []).find((user) => user.id === event.message.senderId);
    const recipients = deriveRoomParticipantIds(event.room, nextState?.users || []).filter((userId) => userId !== event.message.senderId);
    const previewText = buildPushMessagePreview(event.message);
    for (const recipientId of recipients) {
      await sendPushToUser(recipientId, {
        type: "message",
        roomId: event.room.id,
        senderId: event.message.senderId,
        senderName: sender?.name || sender?.loginId || "알 수 없는 사용자",
        previewText,
        createdAt: event.message.createdAt,
        title: "새 메시지",
        body: `${sender?.name || sender?.loginId || "알 수 없는 사용자"}: ${previewText}`,
        tag: `room:${event.room.id}`,
        clickPath: `/?pushType=message&roomId=${encodeURIComponent(event.room.id)}`,
      });
    }
  }

  for (const invite of inviteEvents) {
    const inviter = (nextState?.users || []).find((user) => user.id === invite.inviterId);
    await sendPushToUser(invite.inviteeId, {
      type: "invite",
      inviteId: invite.id,
      senderId: invite.inviterId,
      senderName: inviter?.name || inviter?.loginId || "알 수 없는 사용자",
      previewText: invite.previewRoomTitle || "",
      createdAt: invite.createdAt,
      title: "새 초대",
      body: `${inviter?.name || inviter?.loginId || "알 수 없는 사용자"}님이 채팅 초대를 보냈어요`,
      tag: `invite:${invite.id}`,
      clickPath: "/?pushType=invite",
    });
  }
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
    const loginState = body?.loginState === "offline" ? "offline" : "online";

    if (!userId) {
      return sendJson(res, 400, { error: "invalid_presence_payload" });
    }

    presenceSignals.set(userId, {
      userId,
      currentRoomId: loginState === "offline" ? null : currentRoomId,
      lastSeenAt,
      loginState,
      expiresAt: Date.now() + PRESENCE_SIGNAL_TTL_MS,
    });

    prunePresenceSignals();
    broadcastServerEvent({
      type: "presence-updated",
      userId,
      currentRoomId: loginState === "offline" ? null : currentRoomId,
      lastSeenAt,
      loginState,
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

async function requestOpenAITranslations({ text, sourceLanguage, targetLanguages, translationConcept = "general", contextSummary = "" }) {
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
        translationConcept,
        contextSummary,
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

async function requestSingleOpenAITranslation({ text, sourceLanguage, targetLanguage, translationConcept = "general", contextSummary = "" }) {
  const cacheKey = JSON.stringify({
    model: OPENAI_MODEL,
    sourceLanguage,
    targetLanguage,
    translationConcept,
    contextSummary,
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
      translationConcept,
      contextSummary,
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

function buildTranslationPrompt({ text, sourceLanguage, targetLanguage, translationConcept = "general", contextSummary = "" }) {
  return [
    "You are a realtime chat translator.",
    "Translate the full message into the target language only.",
    "Return only the translated message text.",
    "Do not summarize, shorten, soften, explain, or add commentary.",
    "Do not filter or propose alternatives.",
    `Use this recipient-facing tone: ${describeTranslationConcept(translationConcept)}.`,
    contextSummary ? "Apply this short conversation context only to keep names, relationship tone, and honorifics consistent:" : "",
    contextSummary || "",
    "Preserve the full meaning, tone, sentence count, URLs, emojis, @mentions, hashtags, punctuation, and line breaks.",
    `Source language: ${describeLanguage(sourceLanguage)}.`,
    `Target language: ${describeLanguage(targetLanguage)}.`,
    "Message:",
    text,
  ].join("\n");
}

function normalizeTranslationConcept(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ["office", "general", "friend", "lover"].includes(normalized) ? normalized : "general";
}

function describeTranslationConcept(concept) {
  return (
    {
      office: "professional, work-appropriate, and polite",
      general: "natural everyday conversation with neutral friendliness",
      friend: "casual, relaxed, and friendly between close friends",
      lover: "gentle, warm, and affectionate between romantic partners",
    }[normalizeTranslationConcept(concept)] || "natural everyday conversation with neutral friendliness"
  );
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

function sanitizeUsageState(value) {
  return {
    windowKey: typeof value?.windowKey === "string" ? value.windowKey : "",
    totalMessages: Math.max(0, Number(value?.totalMessages || 0)),
    softLimitNotified: Boolean(value?.softLimitNotified),
    lastUpdatedAt: Number(value?.lastUpdatedAt || Date.now()),
  };
}

function sanitizeMessageState(message, allowedUserIds) {
  if (!message) {
    return message;
  }
  if (message.kind === "system") {
    return {
      ...message,
      systemParams: Object.fromEntries(
        Object.entries(message.systemParams || {}).map(([key, value]) => [
          key,
          typeof value === "string" ? normalizeDisplayText(value) : value,
        ])
      ),
    };
  }
  if (message.kind !== "user") {
    return message;
  }

  const originalText = normalizeDisplayText(message.originalText || message.text || "");
  const translations = sanitizeTranslations(message.translations, originalText, message.sourceLanguage);

  return {
    ...message,
    originalText,
    media: sanitizeMediaState(message.media),
    status: ["composing", "sent", "delivered", "read"].includes(message.status) ? message.status : "sent",
    deliveredTo: filterRecordByAllowedKeys(message.deliveredTo, allowedUserIds),
    readBy: filterRecordByAllowedKeys(message.readBy, allowedUserIds),
    translations,
    translationMeta: sanitizeTranslationMeta(message.translationMeta, translations, message.sourceLanguage),
  };
}

function getTranslationVariantLanguage(value) {
  const normalized = String(value || "").trim();
  if (ALLOWED_LANGUAGES.has(normalized)) {
    return normalized;
  }
  const [language] = normalized.split("__");
  return ALLOWED_LANGUAGES.has(language) ? language : "";
}

function sanitizeTranslations(translations, originalText, sourceLanguage) {
  return Object.fromEntries(
    Object.entries(translations || {})
      .filter(([key]) => Boolean(getTranslationVariantLanguage(key)))
      .map(([key, entry]) => {
        const language = getTranslationVariantLanguage(key);
        const text = typeof entry?.text === "string" ? normalizeDisplayText(entry.text) : "";
        const failed = Boolean(entry?.failed);
        const looksLikeLegacyFallback = language !== sourceLanguage && !failed && text === String(originalText || "");
        if (!text && !failed) return null;
        if (looksLikeLegacyFallback) return null;
        return [
          key,
          {
            text: text || String(originalText || ""),
            failed,
          },
        ];
      })
      .filter(Boolean)
  );
}

function sanitizeTranslationMeta(meta, translations, sourceLanguage) {
  const requestedTargets = [...new Set(
    (Array.isArray(meta?.requestedTargets) ? meta.requestedTargets : Object.keys(translations || {}))
      .map((key) => String(key || "").trim())
      .filter((key) => {
        const language = getTranslationVariantLanguage(key);
        return Boolean(language) && language !== sourceLanguage;
      })
  )];
  const provider = typeof meta?.provider === "string" ? meta.provider : "none";
  const state =
    typeof meta?.state === "string"
      ? meta.state
      : meta?.pending
        ? "pending"
        : provider === "mock"
          ? "mock"
          : provider === "none" && !requestedTargets.length
            ? "idle"
            : "success";

  return {
    provider,
    model: meta?.model || null,
    live: Boolean(meta?.live),
    pending: state === "pending",
    state,
    reason: typeof meta?.reason === "string" ? meta.reason : null,
    errorDetail: typeof meta?.errorDetail === "string" ? meta.errorDetail : null,
    requestedTargets,
    completedAt: Number(meta?.completedAt || 0) || null,
  };
}

function sanitizeMediaState(media) {
  if (!media || !["image", "video", "file"].includes(media.kind)) {
    return media || null;
  }

  return {
    ...media,
    mediaId: typeof media?.mediaId === "string" ? media.mediaId : null,
    mimeType: typeof media?.mimeType === "string" ? media.mimeType : "",
    uploadedAt: Number(media?.uploadedAt || 0) || null,
    expiresAt: Number(media?.expiresAt || 0) || null,
    expired: Boolean(media?.expired) || (Number(media?.expiresAt || 0) > 0 && Number(media?.expiresAt || 0) <= Date.now()),
    storage: typeof media?.storage === "string" ? media.storage : "",
  };
}

function sanitizeSharedState(state) {
  if (!(state && [1, STATE_SCHEMA_VERSION].includes(Number(state.version || 0)))) {
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
      loginId: normalizeDisplayText(user?.loginId || user?.name).trim().toLowerCase(),
      name: normalizeDisplayText(user.name),
      nickname: normalizeDisplayText(user?.nickname || "").trim(),
      gender: user?.gender === "female" ? "female" : user?.gender === "male" ? "male" : "",
      age: Number(user?.age || 0) || "",
      auth: {
        provider: user?.auth?.provider || "test-name",
        subject: user?.auth?.subject || normalizeDisplayText(user?.loginId || user?.name).trim().toLowerCase(),
        email: user?.auth?.email || null,
        phoneNumber: user?.auth?.phoneNumber || null,
        phoneVerified: Boolean(user?.auth?.phoneVerified),
      },
      blockedUserIds: Array.isArray(user?.blockedUserIds) ? user.blockedUserIds : [],
      password: typeof user?.password === "string" ? user.password : "",
      preferredTranslationConcept: normalizeTranslationConcept(user?.preferredTranslationConcept),
      planTier: ["monthly", "yearly"].includes(user?.planTier) ? user.planTier : "free",
      usage: sanitizeUsageState(user?.usage),
      planUpdatedAt: Number(user?.planUpdatedAt || user?.joinedAt || user?.createdAt || Date.now()),
      planPolicyAcknowledgedAt: Number(user?.planPolicyAcknowledgedAt || 0) || null,
      enableNaturalTranslationBeta: Boolean(user?.enableNaturalTranslationBeta),
      isAdmin: Boolean(user?.isAdmin) || normalizeDisplayText(user?.loginId || "").trim().toLowerCase() === "admin",
      isUnlimitedTester: Boolean(user?.isUnlimitedTester) || normalizeDisplayText(user?.name || "").replace(/\s+/g, "").trim().toLowerCase() === "hoa" || normalizeDisplayText(user?.name || "").replace(/\s+/g, "").trim().toLowerCase() === "현태",
      isUnlimitedUser: Boolean(user?.isUnlimitedUser) || Boolean(user?.isUnlimitedTester) || normalizeDisplayText(user?.name || "").replace(/\s+/g, "").trim().toLowerCase() === "hoa" || normalizeDisplayText(user?.name || "").replace(/\s+/g, "").trim().toLowerCase() === "현태",
      canBypassUsageLimit:
        Boolean(user?.canBypassUsageLimit) ||
        Boolean(user?.isAdmin) ||
        Boolean(user?.isUnlimitedTester) ||
        normalizeDisplayText(user?.loginId || "").trim().toLowerCase() === "admin" ||
        normalizeDisplayText(user?.name || "").replace(/\s+/g, "").trim().toLowerCase() === "hoa" ||
        normalizeDisplayText(user?.name || "").replace(/\s+/g, "").trim().toLowerCase() === "현태",
      recoveryQuestionKey: RECOVERY_QUESTION_KEYS.includes(user?.recoveryQuestionKey)
        ? user.recoveryQuestionKey
        : RECOVERY_QUESTION_KEYS.includes(user?.recoveryQuestion)
          ? user.recoveryQuestion
          : getDeterministicRecoveryQuestionKey(user?.name),
      recoveryQuestion: RECOVERY_QUESTION_KEYS.includes(user?.recoveryQuestion)
        ? user.recoveryQuestion
        : RECOVERY_QUESTION_KEYS.includes(user?.recoveryQuestionKey)
          ? user.recoveryQuestionKey
          : getDeterministicRecoveryQuestionKey(user?.name),
      recoveryAnswer:
        typeof user?.recoveryAnswer === "string"
          ? normalizeRecoveryAnswer(user.recoveryAnswer)
          : normalizeRecoveryAnswer(user?.name),
      joinedAt: Number(user?.joinedAt || user?.createdAt || Date.now()),
      lastSeenAt: Number(user?.lastSeenAt || user?.lastLoginAt || user?.joinedAt || user?.createdAt || Date.now()),
      lastLoginAt: Number(user?.lastLoginAt || 0) || null,
      loginState: user?.loginState === "online" ? "online" : "offline",
      hasUnreadInvites: Boolean(user?.hasUnreadInvites),
      hasUnreadMessages: Boolean(user?.hasUnreadMessages),
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
        disableExpiration: ROOM_AUTO_EXPIRATION_ENABLED ? persistent : true,
        status: !ROOM_AUTO_EXPIRATION_ENABLED || (persistent && room.status === "expired") ? "active" : room.status,
        expiredAt: ROOM_AUTO_EXPIRATION_ENABLED && !persistent ? room.expiredAt || null : null,
        participants,
        accessByUser: filterRecordByAllowedKeys(room.accessByUser, userIds),
        unreadByUser: filterRecordByAllowedKeys(room.unreadByUser, userIds),
        messages: (room.messages || []).map((message) => sanitizeMessageState(message, userIds)),
      };
    });
  const roomIds = new Set(rooms.map((room) => room.id));

  return {
    ...state,
    version: STATE_SCHEMA_VERSION,
    deletedUsers,
    deletedRooms,
    updatedAt: Number(state.updatedAt || Date.now()),
    users: users.map((user) => ({
      ...user,
      currentRoomId: roomIds.has(user.currentRoomId) ? user.currentRoomId : null,
    })),
    invites: (state.invites || [])
      .filter((invite) => {
        const hasUsers = userIds.has(invite.inviterId) && userIds.has(invite.inviteeId);
        if (!hasUsers) return false;
        if (invite?.type === "connection") return true;
        return roomIds.has(invite.roomId);
      })
      .map((invite) => ({
        ...invite,
        roomId: roomIds.has(invite?.roomId) ? invite.roomId : null,
        type: invite?.type === "connection" ? "connection" : "room",
        previewRoomTitle: typeof invite?.previewRoomTitle === "string" ? invite.previewRoomTitle : "",
        status: ["pending", "accepted", "rejected"].includes(invite?.status) ? invite.status : "pending",
        respondedAt: Number(invite?.respondedAt || 0) || null,
        seenByInvitee: Boolean(invite?.seenByInvitee),
      })),
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
  if (!ROOM_AUTO_EXPIRATION_ENABLED) {
    return false;
  }
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
    if (!(parsed && [1, STATE_SCHEMA_VERSION].includes(Number(parsed.version || 0)))) {
      return null;
    }

    const sanitized = sanitizeSharedState(parsed);
    const trace = getLatestUserMessageForTrace(sanitized);
    if (trace) {
      logEncodingTrace("server-state-load", trace.text, {
        roomId: trace.roomId,
        messageId: trace.messageId,
      });
    }
    if (JSON.stringify(sanitized) !== JSON.stringify(parsed)) {
      await saveServerState(sanitized);
    }
    return sanitized;
  } catch (error) {
    return null;
  }
}

async function saveServerState(state) {
  const trace = getLatestUserMessageForTrace(state);
  if (trace) {
    logEncodingTrace("server-state-save", trace.text, {
      roomId: trace.roomId,
      messageId: trace.messageId,
    });
  }
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
    const chunks = [];
    let totalBytes = 0;

    req.on("data", (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.length;
      if (totalBytes > 200_000) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(buffer);
    });

    req.on("end", () => {
      try {
        const raw = chunks.length ? Buffer.concat(chunks).toString("utf8") : "";
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
