import { createServer } from "node:http";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_STATE_FILE = path.join(__dirname, "transchat-server-state.json");
const PUSH_TOKEN_STATE_FILE = path.join(__dirname, "transchat-push-tokens.json");
const MEDIA_STORAGE_DIR = path.join(__dirname, "transchat-media");
const STATE_SCHEMA_VERSION = 2;
const PUSH_TOKEN_SCHEMA_VERSION = 2;
const JSON_BODY_MAX_BYTES = 200_000;
const STATE_SYNC_BODY_MAX_BYTES = 5 * 1024 * 1024;
const MEDIA_UPLOAD_MAX_BYTES = 60 * 1024 * 1024;

const PORT = Number(process.env.PORT || 3000);
const OPENAI_API_KEY = normalizeOpenAIApiKey(process.env.OPENAI_API_KEY || "");
const OPENAI_API_KEY_VALID = isValidOpenAIApiKey(OPENAI_API_KEY);
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
const FIREBASE_ANDROID_APP_ID = String(process.env.FIREBASE_ANDROID_APP_ID || "").trim();
const FIREBASE_ANDROID_API_KEY = String(process.env.FIREBASE_ANDROID_API_KEY || FIREBASE_WEB_CONFIG_FALLBACK.apiKey || "").trim();
const FIREBASE_ANDROID_PROJECT_ID = String(process.env.FIREBASE_ANDROID_PROJECT_ID || FIREBASE_WEB_CONFIG_FALLBACK.projectId || "").trim();
const FIREBASE_ANDROID_SENDER_ID = String(process.env.FIREBASE_ANDROID_SENDER_ID || FIREBASE_WEB_CONFIG_FALLBACK.messagingSenderId || "").trim();
const PUSH_PUBLIC_ORIGIN = normalizePushOrigin(process.env.PUSH_PUBLIC_ORIGIN || "https://transchat.xyz");
const ROOM_AUTO_EXPIRATION_ENABLED = false;
const TYPING_SIGNAL_TTL_MS = 4500;
const PRESENCE_SIGNAL_TTL_MS = 2 * 60 * 1000;
const ALLOWED_LANGUAGES = new Set(["ko", "en", "vi"]);
const DEFAULT_TRANSLATION_CONCEPT = "lover";
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
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".pdf": "application/pdf",
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

function normalizeOpenAIApiKey(value) {
  return String(value || "")
    .replace(/^['"`]+|['"`]+$/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function isValidOpenAIApiKey(value) {
  if (!value) return false;
  if (!value.startsWith("sk-")) return false;
  return /^[\x21-\x7E]+$/.test(value);
}

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
      liveTranslationEnabled: OPENAI_API_KEY_VALID,
      model: OPENAI_MODEL,
      sharedStateEnabled: true,
      hasServerState: Boolean(serverState),
      translationConfigured: OPENAI_API_KEY_VALID,
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

  if (req.method === "POST" && requestUrl.pathname === "/api/push/native/register") {
    return handleNativePushRegister(req, res);
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/push/native/bind") {
    return handleNativePushBind(req, res);
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/push/native/unbind") {
    return handleNativePushUnbind(req, res);
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/push/unregister") {
    return handlePushUnregister(req, res);
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/translate") {
    // Later this endpoint can sit behind auth, rate limiting, DB logging, and Socket.IO fan-out.
    return handleTranslate(req, res);
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/media") {
    return handleMediaUpload(req, res);
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

  if ((req.method === "GET" || req.method === "HEAD") && requestUrl.pathname.startsWith("/media/")) {
    return serveUploadedMedia(requestUrl.pathname, res, req.method === "HEAD");
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
    if (!OPENAI_API_KEY_VALID) {
      return sendJson(res, 503, {
        error: "invalid_api_key_format",
        message: "OPENAI_API_KEY is malformed. Re-enter it in one line using plain ASCII characters only.",
      });
    }

    const body = await readJsonBody(req);
    const text = normalizeDisplayText(body?.text).trim();
    const sourceLanguage = String(body?.sourceLanguage || "").trim();
    const detectedLanguages = [...new Set(
      (Array.isArray(body?.detectedLanguages) ? body.detectedLanguages : [sourceLanguage])
        .map((item) => String(item || "").trim())
        .filter((language) => ALLOWED_LANGUAGES.has(language))
    )];
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
      .filter((language) => ALLOWED_LANGUAGES.has(language) && (language !== sourceLanguage || detectedLanguages.some((entry) => entry !== language)));

    if (!normalizedTargets.length) {
      return sendJson(res, 200, { translations: {} });
    }

    console.info("[translate] request", {
      sourceLanguage,
      detectedLanguages,
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
      detectedLanguages,
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
  const nativeConfig = getFirebaseNativeConfig();
  return sendJson(res, 200, {
    enabled: Boolean(clientConfig && FIREBASE_VAPID_KEY),
    webConfig: clientConfig,
    vapidKey: FIREBASE_VAPID_KEY || "",
    nativeConfig,
  });
}

async function handlePushRegister(req, res) {
  try {
    const body = await readJsonBody(req);
    const userId = String(body?.userId || "").trim();
    const token = String(body?.token || "").trim();
    const platform = String(body?.platform || "web").trim() || "web";
    const origin = normalizePushOrigin(body?.origin || "");

    if (!userId || !token) {
      return sendJson(res, 400, { error: "invalid_push_registration" });
    }

    if (!serverState?.users?.some((user) => user.id === userId)) {
      return sendJson(res, 404, { error: "user_not_found" });
    }

    upsertPushToken({ userId, token, platform, origin });
    await savePushTokenState(pushTokenState);
    const userTokenCount = getPushTokensForUser(userId).length;
    const registeredAt = Date.now();
    console.info("[push-register]", {
      userId,
      platform,
      origin: origin || PUSH_PUBLIC_ORIGIN,
      tokenTail: token.slice(-12),
      userTokenCount,
    });
    return sendJson(res, 200, {
      ok: true,
      userTokenCount,
      tokenTail: token.slice(-12),
      registeredAt,
    });
  } catch (error) {
    console.error("[push-register]", error);
    return sendJson(res, 500, { error: "push_register_failed" });
  }
}

async function handleNativePushRegister(req, res) {
  try {
    const body = await readJsonBody(req);
    const installId = normalizeInstallId(body?.installId || "");
    const token = String(body?.token || "").trim();
    const appPackage = normalizeAndroidPackageName(body?.packageName || "");
    if (!installId || !token) {
      return sendJson(res, 400, { error: "invalid_native_push_registration" });
    }

    const boundUserId = getBoundUserIdForInstall(installId);
    upsertPushToken({
      userId: boundUserId,
      token,
      installId,
      platform: "android-native",
      appPackage,
      origin: PUSH_PUBLIC_ORIGIN,
    });
    await savePushTokenState(pushTokenState);
    console.info("[push-register-native]", {
      installId,
      tokenTail: token.slice(-12),
      boundUserId,
      appPackage,
    });
    return sendJson(res, 200, {
      ok: true,
      installId,
      boundUserId,
      tokenTail: token.slice(-12),
    });
  } catch (error) {
    console.error("[push-register-native]", error);
    return sendJson(res, 500, { error: "native_push_register_failed" });
  }
}

async function handleNativePushBind(req, res) {
  try {
    const body = await readJsonBody(req);
    const installId = normalizeInstallId(body?.installId || "");
    const userId = String(body?.userId || "").trim();
    if (!installId || !userId) {
      return sendJson(res, 400, { error: "invalid_native_push_bind" });
    }

    if (!serverState?.users?.some((user) => user.id === userId)) {
      return sendJson(res, 404, { error: "user_not_found" });
    }

    upsertNativeBinding({ installId, userId });
    let boundTokenCount = 0;
    pushTokenState = sanitizePushTokenState({
      ...pushTokenState,
      tokens: (pushTokenState?.tokens || []).map((entry) => {
        if (entry.platform === "android-native" && entry.installId === installId) {
          boundTokenCount += 1;
          return {
            ...entry,
            userId,
            updatedAt: Date.now(),
          };
        }
        return entry;
      }),
    });
    await savePushTokenState(pushTokenState);
    console.info("[push-bind-native]", {
      installId,
      userId,
      boundTokenCount,
    });
    return sendJson(res, 200, {
      ok: true,
      installId,
      userId,
      boundTokenCount,
    });
  } catch (error) {
    console.error("[push-bind-native]", error);
    return sendJson(res, 500, { error: "native_push_bind_failed" });
  }
}

async function handleNativePushUnbind(req, res) {
  try {
    const body = await readJsonBody(req);
    const installId = normalizeInstallId(body?.installId || "");
    const userId = String(body?.userId || "").trim();
    if (!installId) {
      return sendJson(res, 400, { error: "invalid_native_push_unbind" });
    }

    const bindingChanged = removeNativeBinding({ installId, userId });
    let clearedTokenCount = 0;
    pushTokenState = sanitizePushTokenState({
      ...pushTokenState,
      tokens: (pushTokenState?.tokens || []).map((entry) => {
        if (entry.platform !== "android-native" || entry.installId !== installId) {
          return entry;
        }
        if (userId && entry.userId && entry.userId !== userId) {
          return entry;
        }
        if (!entry.userId) {
          return entry;
        }
        clearedTokenCount += 1;
        return {
          ...entry,
          userId: "",
          updatedAt: Date.now(),
        };
      }),
    });
    if (bindingChanged || clearedTokenCount) {
      await savePushTokenState(pushTokenState);
    }
    console.info("[push-unbind-native]", {
      installId,
      userId,
      bindingChanged,
      clearedTokenCount,
    });
    return sendJson(res, 200, {
      ok: true,
      installId,
      userId,
      bindingChanged,
      clearedTokenCount,
    });
  } catch (error) {
    console.error("[push-unbind-native]", error);
    return sendJson(res, 500, { error: "native_push_unbind_failed" });
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

function sanitizeMediaId(value) {
  const normalized = String(value || "").trim();
  return /^[A-Za-z0-9_-]{4,120}$/.test(normalized) ? normalized : "";
}

function getFileExtensionFromName(fileName = "") {
  const ext = path.extname(String(fileName || "").trim()).toLowerCase();
  return ext && /^[.][a-z0-9]{1,10}$/.test(ext) ? ext : "";
}

function getMediaFileExtension(mimeType, fileName = "") {
  const normalizedMimeType = String(mimeType || "").trim().toLowerCase();
  const byMimeType = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "video/webm": ".webm",
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
    "application/pdf": ".pdf",
  };
  return byMimeType[normalizedMimeType] || getFileExtensionFromName(fileName) || ".bin";
}

async function handleMediaUpload(req, res) {
  try {
    const mediaId = sanitizeMediaId(req.headers["x-media-id"]);
    const kind = String(req.headers["x-media-kind"] || "").trim().toLowerCase();
    const rawFileName = String(req.headers["x-media-name"] || "").trim();
    const fileName = rawFileName ? decodeURIComponent(rawFileName) : "";
    const mimeType = String(req.headers["x-media-mime-type"] || "application/octet-stream").trim().toLowerCase();

    if (!mediaId || !["image", "video", "file"].includes(kind)) {
      return sendJson(res, 400, { error: "invalid_media_upload" });
    }

    const body = await readBinaryBody(req, MEDIA_UPLOAD_MAX_BYTES);
    if (!body.length) {
      return sendJson(res, 400, { error: "media_body_missing" });
    }

    await mkdir(MEDIA_STORAGE_DIR, { recursive: true });
    const extension = getMediaFileExtension(mimeType, fileName);
    const safeFileName = `${mediaId}${extension}`;
    const absolutePath = path.join(MEDIA_STORAGE_DIR, safeFileName);
    const uploadedAt = Date.now();
    const expiresAt = kind === "image" || kind === "video" ? uploadedAt + 24 * 60 * 60 * 1000 : null;

    await writeFile(absolutePath, body);

    return sendJson(res, 200, {
      ok: true,
      mediaId,
      url: `/media/${safeFileName}`,
      uploadedAt,
      expiresAt,
    });
  } catch (error) {
    console.error("[media-upload]", error);
    return sendJson(res, 500, { error: "media_upload_failed" });
  }
}

async function handleStateUpdate(req, res) {
  try {
    const body = await readJsonBody(req, STATE_SYNC_BODY_MAX_BYTES);
    const nextState = body?.state;
    const sourceId = String(body?.sourceId || "unknown");
    const receivedAt = Date.now();

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
      updatedAt: receivedAt,
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
    if (error?.code === "body_too_large") {
      return sendJson(res, 413, {
        error: "state_payload_too_large",
      });
    }
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

function getFirebaseNativeConfig() {
  const missingFields = [];
  if (!FIREBASE_ANDROID_APP_ID) missingFields.push("appId");
  if (!FIREBASE_ANDROID_API_KEY) missingFields.push("apiKey");
  if (!FIREBASE_ANDROID_PROJECT_ID) missingFields.push("projectId");
  if (!FIREBASE_ANDROID_SENDER_ID) missingFields.push("messagingSenderId");
  const enabled = missingFields.length === 0;
  return {
    enabled,
    appId: FIREBASE_ANDROID_APP_ID,
    apiKey: FIREBASE_ANDROID_API_KEY,
    projectId: FIREBASE_ANDROID_PROJECT_ID,
    messagingSenderId: FIREBASE_ANDROID_SENDER_ID,
    publicOrigin: PUSH_PUBLIC_ORIGIN,
    missingFields,
  };
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
  const bindingByInstallId = new Map();
  (parsed?.nativeBindings || []).forEach((entry) => {
    const installId = normalizeInstallId(entry?.installId || "");
    const userId = String(entry?.userId || "").trim();
    if (!installId || !userId) return;
    const nextEntry = {
      installId,
      userId,
      updatedAt: Number(entry?.updatedAt || Date.now()),
    };
    const previous = bindingByInstallId.get(installId);
    if (!previous || nextEntry.updatedAt >= previous.updatedAt) {
      bindingByInstallId.set(installId, nextEntry);
    }
  });

  const byToken = new Map();
  (parsed?.tokens || []).forEach((entry) => {
    const token = String(entry?.token || "").trim();
    if (!token) return;
    const platform = normalizePushPlatform(entry?.platform || "web");
    const installId = normalizeInstallId(entry?.installId || "");
    const boundUserId = installId ? bindingByInstallId.get(installId)?.userId || "" : "";
    const nextEntry = {
      token,
      userId: String(entry?.userId || "").trim() || boundUserId,
      platform,
      origin: normalizePushOrigin(entry?.origin || ""),
      installId,
      appPackage: normalizeAndroidPackageName(entry?.appPackage || ""),
      updatedAt: Number(entry?.updatedAt || Date.now()),
    };
    if (platform === "web" && !nextEntry.userId) return;
    const entryKey = platform === "android-native" && installId ? `install:${installId}` : `token:${token}`;
    const previous = byToken.get(entryKey);
    if (!previous || nextEntry.updatedAt >= previous.updatedAt) {
      byToken.set(entryKey, nextEntry);
    }
  });

  return {
    version: PUSH_TOKEN_SCHEMA_VERSION,
    tokens: [...byToken.values()].sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0)),
    nativeBindings: [...bindingByInstallId.values()].sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0)),
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
      nativeBindings: [],
    };
  }
}

async function savePushTokenState(state) {
  await writeFile(PUSH_TOKEN_STATE_FILE, JSON.stringify(sanitizePushTokenState(state)), "utf8");
}

function upsertPushToken(entry) {
  const platform = normalizePushPlatform(entry?.platform || "web");
  const installId = normalizeInstallId(entry?.installId || "");
  const existing = (pushTokenState?.tokens || []).find((item) => {
    if (installId && item.installId === installId) return true;
    return item.token === String(entry?.token || "").trim();
  });
  const nextEntry = {
    token: String(entry?.token || "").trim(),
    userId: String(entry?.userId || "").trim() || getBoundUserIdForInstall(installId) || String(existing?.userId || "").trim(),
    platform,
    origin: normalizePushOrigin(entry?.origin || ""),
    installId,
    appPackage: normalizeAndroidPackageName(entry?.appPackage || ""),
    updatedAt: Date.now(),
  };
  if (!nextEntry.token || (platform === "web" && !nextEntry.userId)) return false;
  if (platform === "android-native" && !installId) return false;

  const filtered = (pushTokenState?.tokens || []).filter((item) => {
    if (item.token === nextEntry.token) return false;
    if (platform === "android-native" && installId && item.platform === "android-native" && item.installId === installId) {
      return false;
    }
    return true;
  });
  filtered.unshift(nextEntry);
  pushTokenState = sanitizePushTokenState({
    ...pushTokenState,
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
    ...pushTokenState,
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
  const bindingBefore = (pushTokenState?.nativeBindings || []).length;
  pushTokenState = sanitizePushTokenState({
    version: PUSH_TOKEN_SCHEMA_VERSION,
    tokens: (pushTokenState?.tokens || []).filter((entry) => !entry.userId || activeUserIds.has(entry.userId)),
    nativeBindings: (pushTokenState?.nativeBindings || []).filter((entry) => activeUserIds.has(entry.userId)),
  });
  if ((pushTokenState?.tokens || []).length !== before || (pushTokenState?.nativeBindings || []).length !== bindingBefore) {
    void savePushTokenState(pushTokenState);
  }
}

function getPushTokensForUser(userId) {
  return (pushTokenState?.tokens || []).filter((entry) => entry.userId === userId);
}

function normalizePushPlatform(value) {
  return String(value || "").trim().toLowerCase() === "android-native" ? "android-native" : "web";
}

function normalizeInstallId(value) {
  const normalized = String(value || "").trim();
  return /^[A-Za-z0-9_-]{8,160}$/.test(normalized) ? normalized : "";
}

function normalizeAndroidPackageName(value) {
  const normalized = String(value || "").trim();
  return /^[A-Za-z0-9_.]{3,160}$/.test(normalized) ? normalized : "";
}

function getBoundUserIdForInstall(installId) {
  const normalizedInstallId = normalizeInstallId(installId);
  if (!normalizedInstallId) return "";
  const binding = (pushTokenState?.nativeBindings || []).find((entry) => entry.installId === normalizedInstallId);
  return String(binding?.userId || "").trim();
}

function upsertNativeBinding({ installId = "", userId = "" } = {}) {
  const normalizedInstallId = normalizeInstallId(installId);
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedInstallId || !normalizedUserId) return false;

  const filtered = (pushTokenState?.nativeBindings || []).filter((entry) => entry.installId !== normalizedInstallId);
  filtered.unshift({
    installId: normalizedInstallId,
    userId: normalizedUserId,
    updatedAt: Date.now(),
  });
  pushTokenState = sanitizePushTokenState({
    ...pushTokenState,
    nativeBindings: filtered,
  });
  return true;
}

function removeNativeBinding({ installId = "", userId = "" } = {}) {
  const normalizedInstallId = normalizeInstallId(installId);
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedInstallId) return false;
  const before = (pushTokenState?.nativeBindings || []).length;
  pushTokenState = sanitizePushTokenState({
    ...pushTokenState,
    nativeBindings: (pushTokenState?.nativeBindings || []).filter((entry) => {
      if (entry.installId !== normalizedInstallId) return true;
      if (normalizedUserId && entry.userId !== normalizedUserId) return true;
      return false;
    }),
  });
  return (pushTokenState?.nativeBindings || []).length !== before;
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

function normalizePushOrigin(origin) {
  const value = String(origin || "").trim();
  if (!value) return "";
  try {
    const parsed = new URL(value);
    if (!/^https?:$/i.test(parsed.protocol)) return "";
    return parsed.origin;
  } catch (error) {
    return "";
  }
}

function buildPushTargetUrl(entry, payload) {
  const baseOrigin = normalizePushOrigin(entry?.origin || "") || PUSH_PUBLIC_ORIGIN;
  const clickPath = String(payload?.clickPath || "/").trim() || "/";
  try {
    return new URL(clickPath, baseOrigin).toString();
  } catch (error) {
    return baseOrigin;
  }
}

function isInvalidPushTokenError(error) {
  const code = String(error?.code || error?.errorInfo?.code || "").toLowerCase();
  return code.includes("registration-token-not-registered") || code.includes("invalid-registration-token");
}

function getPushRoomForUser(userId) {
  const rooms = (serverState?.rooms || []).filter((room) => room?.status === "active");
  return rooms.find((room) => deriveRoomParticipantIds(room, serverState?.users || []).includes(userId)) || null;
}

function getPushInviteForUser(userId) {
  return (serverState?.invites || []).find((invite) => invite.inviteeId === userId && invite.status === "pending") || null;
}

function buildPushPayloadSnapshot(userId, type) {
  const now = Date.now();
  if (type === "invite") {
    const invite = getPushInviteForUser(userId);
    return {
      type: "invite",
      inviteId: invite?.id || `invite-${now}`,
      senderId: "system",
      senderName: "TRANSCHAT",
      previewText: invite?.previewRoomTitle || "새 초대 알림입니다.",
      createdAt: now,
      title: "새 초대",
      body: "TRANSCHAT님이 채팅 초대를 보냈어요",
      tag: invite?.id ? `invite:${invite.id}` : `invite:${userId}`,
      clickPath: "/?pushType=invite",
    };
  }

  const room = getPushRoomForUser(userId);
  return {
    type: "message",
    roomId: room?.id || "",
    senderId: "system",
    senderName: "TRANSCHAT",
    previewText: "새 메시지 알림입니다.",
    createdAt: now,
    title: "새 메시지",
    body: "TRANSCHAT: 새 메시지 알림입니다.",
    tag: room?.id ? `room:${room.id}` : `room:${userId}`,
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
      if (entry.platform === "android-native") {
        await messaging.send(buildAndroidNativePushMessage(entry, payload));
      } else {
        await messaging.send(buildWebPushMessage(entry, payload));
      }
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

function buildWebPushMessage(entry, payload) {
  const link = buildPushTargetUrl(entry, payload);
  const notificationTitle = String(payload?.title || "TRANSCHAT");
  const notificationBody = String(payload?.body || payload?.previewText || "");
  return {
    token: entry.token,
    data: normalizePushPayload(payload),
    notification: {
      title: notificationTitle,
      body: notificationBody,
    },
    android: {
      priority: "high",
      notification: {
        defaultSound: true,
        defaultVibrateTimings: true,
      },
    },
    webpush: {
      headers: {
        Urgency: "high",
        TTL: "3600",
      },
      notification: {
        title: notificationTitle,
        body: notificationBody,
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        tag: String(payload?.tag || ""),
      },
      fcmOptions: {
        link,
      },
    },
  };
}

function buildAndroidNativePushMessage(entry, payload) {
  const notificationTitle = String(payload?.title || "TRANSCHAT");
  const notificationBody = String(payload?.body || payload?.previewText || "");
  return {
    token: entry.token,
    data: normalizePushPayload({
      ...payload,
      title: notificationTitle,
      body: notificationBody,
      clickPath: String(payload?.clickPath || "/"),
    }),
    android: {
      priority: "high",
      ttl: 60 * 60 * 1000,
    },
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

async function requestOpenAITranslations({ text, sourceLanguage, detectedLanguages = null, targetLanguages, translationConcept = DEFAULT_TRANSLATION_CONCEPT, contextSummary = "" }) {
  if (!targetLanguages.length) {
    return {
      translations: {},
      model: OPENAI_MODEL,
    };
  }

  const translatedEntries = await Promise.allSettled(
    targetLanguages.map(async (targetLanguage) => {
      const translatedText = await requestSingleOpenAITranslation({
        text,
        sourceLanguage,
        detectedLanguages,
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

  const successfulEntries = translatedEntries
    .filter((entry) => entry.status === "fulfilled")
    .map((entry) => entry.value);
  if (!successfulEntries.length) {
    const firstFailure = translatedEntries.find((entry) => entry.status === "rejected");
    throw firstFailure?.reason || new Error("translation_request_failed");
  }

  const failedEntries = translatedEntries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.status === "rejected")
    .map(({ index }) => [
      targetLanguages[index],
      {
        text: "",
        failed: true,
      },
    ]);

  return {
    translations: Object.fromEntries([...successfulEntries, ...failedEntries]),
    model: OPENAI_MODEL,
  };
}

async function requestSingleOpenAITranslation({ text, sourceLanguage, detectedLanguages = null, targetLanguage, translationConcept = DEFAULT_TRANSLATION_CONCEPT, contextSummary = "" }) {
  const cacheKey = JSON.stringify({
    model: OPENAI_MODEL,
    sourceLanguage,
    detectedLanguages,
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
      detectedLanguages,
      targetLanguage,
      translationConcept,
      contextSummary,
    }),
  };

  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
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
        const requestError = new Error(`OpenAI API error ${response.status}: ${errorText}`);
        if (shouldRetryTranslationResponse(response.status) && attempt < 2) {
          await delayTranslationRetry(attempt);
          lastError = requestError;
          continue;
        }
        throw requestError;
      }

      const data = await response.json();
      const outputText = normalizeTranslatedText(extractResponseText(data), text, {
        sourceLanguage,
        targetLanguage,
        detectedLanguages,
      });
      translationCache.set(cacheKey, outputText);
      return outputText;
    } catch (error) {
      lastError = error;
      if (attempt >= 2 || !shouldRetryTranslationError(error)) {
        break;
      }
      await delayTranslationRetry(attempt);
    }
  }

  throw lastError || new Error("translation_request_failed");
}

function shouldRetryTranslationResponse(statusCode) {
  const status = Number(statusCode || 0);
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function shouldRetryTranslationError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  if (!message) return false;
  if (message.includes("invalid_api_key")) return false;
  if (message.includes("model_not_found") || message.includes("unsupported model") || message.includes("does not have access")) return false;
  if (message.includes("openai api error")) {
    const match = message.match(/openai api error (\d+)/);
    return shouldRetryTranslationResponse(match?.[1]);
  }
  return ["fetch failed", "network", "timeout", "socket", "econnreset", "ecanceled", "terminated"].some((keyword) => message.includes(keyword));
}

async function delayTranslationRetry(attempt) {
  const waitMs = 220 * (attempt + 1);
  await new Promise((resolve) => setTimeout(resolve, waitMs));
}

function buildTranslationPrompt({ text, sourceLanguage, detectedLanguages = null, targetLanguage, translationConcept = DEFAULT_TRANSLATION_CONCEPT, contextSummary = "" }) {
  const normalizedConcept = normalizeTranslationConcept(translationConcept);
  const normalizedDetectedLanguages = [...new Set(
    (Array.isArray(detectedLanguages) ? detectedLanguages : [sourceLanguage])
      .map((language) => String(language || "").trim())
      .filter((language) => ALLOWED_LANGUAGES.has(language))
  )];
  const mixedLanguageRequest = normalizedDetectedLanguages.length > 1;
  const romanticDirectionHint =
    normalizedConcept === "lover"
      ? "Default relationship context: private romantic partners. Preserve caring, reassuring, affectionate tone exactly without rewriting for extra smoothness."
      : "";
  const pairSpecificRules = buildPairSpecificTranslationRules(sourceLanguage, targetLanguage, normalizedConcept, normalizedDetectedLanguages);

  return [
    "You are a professional translator for a multilingual private chat app.",
    mixedLanguageRequest && sourceLanguage === targetLanguage
      ? `Normalize the user's mixed-language message into natural ${describeLanguage(targetLanguage)}.`
      : `Translate the user's message accurately from ${describeLanguage(sourceLanguage)} to ${describeLanguage(targetLanguage)}.`,
    "",
    "Rules:",
    "- Preserve the original meaning as closely as possible.",
    "- Do not omit names, vocatives, calling expressions, or emotional emphasis.",
    "- Ignore leading meta labels such as '번역본:', '원문:', 'reference:', or 'translation:' when deciding meaning; they are metadata, not the main sentence content.",
    "- Keep emphasis such as '꼭', '항상', '정말', '많이', and '절대' whenever the target language can express it naturally.",
    "- Keep sentence structure as close to the original as possible, but allow minimal restructuring when natural subject omission or pronoun choice in the target language requires it.",
    "- Preserve romantic, caring, reassuring tone exactly.",
    "- Do not paraphrase, summarize, soften, or rewrite creatively.",
    "- Fidelity is more important than stylistic freedom.",
    "- Do not invent unstated quantities, containers, objects, or reasons. If the source stays unspecific, keep the translation equally unspecific.",
    "- Preserve URLs, emojis, @mentions, hashtags, punctuation, and line breaks.",
    "- Treat any participant-role or pronoun facts in the context summary as fixed reference facts unless the current message clearly overrides them.",
    "- When Vietnamese subjects or pronouns are omitted or ambiguous, keep the established speaker/addressee roles from the context summary instead of re-guessing them.",
    "- Relationship tone affects warmth and register, but must not force extra pronouns, vocatives, or partner-role wording that the source text does not imply.",
    "- Do not force an explicit subject pronoun in the translation if the target language sounds more natural with the subject omitted.",
    "- If the source leaves the subject implicit, preserve that natural implicitness whenever the target language allows it.",
    "- If the context summary gives a stable role term or pronoun with medium/high confidence, prefer it before re-guessing. If confidence is low, prefer neutral wording over forcing a wrong kinship term.",
    "- Analyze the message clause by clause. If the message mixes Korean, Vietnamese, or other foreign fragments, reconstruct the full meaning first and then produce one natural final sentence in the target language.",
    mixedLanguageRequest
      ? `- The source message contains mixed-language fragments (${normalizedDetectedLanguages.map((language) => describeLanguage(language)).join(", ")}). Translate or normalize every fragment into ${describeLanguage(targetLanguage)}; do not leave foreign words untranslated just because the dominant language already matches the target.`
      : "",
    ...pairSpecificRules,
    `- Apply this recipient-facing tone only within the fidelity rules: ${describeTranslationConcept(normalizedConcept)}.`,
    romanticDirectionHint ? `- ${romanticDirectionHint}` : "",
    contextSummary ? "Context summary (use only to keep names, relationship tone, and honorific consistency; never override the source wording):" : "",
    contextSummary || "",
    "",
    "Return only the translated sentence.",
    "No explanations.",
    "Message:",
    text,
  ].filter(Boolean).join("\n");
}

function buildPairSpecificTranslationRules(sourceLanguage, targetLanguage, translationConcept = DEFAULT_TRANSLATION_CONCEPT, detectedLanguages = null) {
  const rules = [];
  const normalizedDetectedLanguages = [...new Set(
    (Array.isArray(detectedLanguages) ? detectedLanguages : [sourceLanguage])
      .map((language) => String(language || "").trim())
      .filter(Boolean)
  )];
  const includesVietnamese = normalizedDetectedLanguages.includes("vi");
  const includesKorean = normalizedDetectedLanguages.includes("ko");

  if ((sourceLanguage === "ko" || includesKorean) && targetLanguage === "vi") {
    rules.push(
      "- For Korean-to-Vietnamese reflective prose or narration, prefer fluent Vietnamese syntax over rigid Korean clause order while preserving the exact meaning.",
      "- In Korean-to-Vietnamese family dialogue such as parent-child conversation, use warm everyday Vietnamese. Parent lines should sound caring but gently guiding, and child lines should sound respectful and natural without becoming overly formal.",
      "- In Korean-to-Vietnamese parent-child dialogue, prefer everyday family role terms such as 'Me:' and 'Con:' for speaker labels. Do not literalize a dialogue label like '아들:' or '딸:' into stiff forms such as 'Con trai:' or 'Con gai:' unless that gender distinction is genuinely needed for meaning.",
      "- In ordinary caring or mildly scolding parent-to-child dialogue, do not use harsh Vietnamese second-person forms such as 'may' unless the Korean source is clearly angry, insulting, or intentionally severe. Prefer the normal family register built around 'con'.",
      "- Preserve the Korean tone of gentle parental guidance. Expressions like '-해야지', '-거잖아', or '어떡해' should sound like natural family admonition in Vietnamese, not like a lecture or a blunt reprimand.",
      "- For Korean family-life lines, prefer idiomatic household Vietnamese such as 'xem dien thoai', 'phai biet sap xep thoi gian', or 'tat dien thoai roi di ngu' when those match the meaning. Avoid stiff literal renderings that sound translated instead of spoken at home.",
      "- When the child replies to a parent, use 'con' naturally and add particles like 'a' only where spoken Vietnamese would actually use them. Do not force 'a' into every clause or make the child sound unnaturally ceremonial.",
      "- Do not mechanically calque Korean expressions into unnatural Vietnamese phrasing such as 'uống bắt đầu ngày', 'theo con đường của mình', or 'một ngày ... cảm thấy quý giá nhất'. Rewrite them into idiomatic Vietnamese sentences with the same meaning.",
      "- Do not use verbs like 'cảm thấy' with non-human subjects such as weather, air, or scenery when Vietnamese would normally use 'trở nên', 'dường như', 'mang lại cảm giác', or another natural predicate.",
      "- If the Korean source omits the subject, do not automatically insert 'anh', 'em', or 'toi'. Add an explicit Vietnamese subject only when the source or context summary clearly fixes the speaker role and the sentence genuinely needs it.",
      "- In Korean-to-Vietnamese dialogue, if the speaker role is known from the context summary, keep one consistent Vietnamese self/addressee term throughout the message instead of switching pronouns sentence by sentence.",
      "- In Korean-to-Vietnamese narration, inner monologue, weather description, or scene description, prefer omitted subjects or neutral sentence openings when natural rather than forcing 'anh', 'em', or another kinship pronoun.",
      "- If an explicit Vietnamese pronoun is needed, choose the most established role term from the context summary first; do not invent a new subject role for a single sentence without evidence in the message.",
      "- Preserve Korean interpersonal particles and soft corrective tones such as '-잖아', '-해야지', '-지?', and '-거야' with natural Vietnamese discourse markers when appropriate; do not flatten the relationship nuance.",
      "- Do not invent concrete details that the Korean source leaves open. For example, if the source only says 'it seems like you did not even eat half', do not add a bowl, plate, or portion unless it is explicitly stated.",
      "- Interpret Korean abstract nouns such as '모습', '마음', '과정', or evaluative praise like '기특해' by context. Prefer natural Vietnamese expressions for the underlying meaning rather than literal but awkward physical-image wording.",
      "- If the source is descriptive or diary-like narration rather than direct address, keep the Vietnamese output neutral and literary; even in lover mode, do not force romantic vocatives or first-person kinship pronouns into plain scene description."
    );
  }

  if ((sourceLanguage === "vi" || includesVietnamese) && targetLanguage === "ko") {
    rules.push(
      "- For Vietnamese-to-Korean, resolve kinship pronouns such as 'anh', 'em', 'chi', and 'co' from the context summary before translating; do not flatten them into one generic Korean subject.",
      "- For Vietnamese-to-Korean chat, prioritize natural Korean someone would actually say in conversation over mechanically mirrored Vietnamese wording.",
      "- In teacher-student, elder-younger, or other authority dialogue, choose natural spoken Korean endings that match the relationship: teacher-to-student lines should sound like live speech, and student-to-teacher lines should stay polite without becoming stiff written prose.",
      "- When Vietnamese omits the subject or object, preserve the established speaker/addressee roles from context and produce natural Korean without unnecessary repeated pronouns.",
      "- Do not translate Vietnamese role nouns such as 'thay', 'co', or 'con' into repeated explicit Korean subjects like '선생님은' or '학생은' in every sentence when Korean would normally omit them.",
      "- Do not over-translate every Vietnamese pronoun into an explicit Korean subject such as '나는', '내가', '너는', or '그는'. Korean often sounds more natural with the subject omitted once the referent is clear.",
      "- If Vietnamese repeats 'anh' or 'em' mainly for Vietnamese grammar, compress that repetition into natural Korean and keep only the amount of subject marking that Korean genuinely needs.",
      "- Never leave Vietnamese kinship pronouns literally inside Korean output. Do not produce forms such as 'anh은', 'em을', 'anh(em)', or Korean particles attached to raw Vietnamese words.",
      "- For affectionate lines such as 'anh yeu em rat nhieu', prefer natural Korean like '정말 많이 사랑해', '정말 많이 사랑해요', or another context-appropriate Korean sentence. Do not translate it as 'anh은 em을 정말 많이 사랑해'.",
      "- If a vocative name such as 'Hoa,' appears, keep the name naturally in Korean and render the rest of the sentence as fluent Korean. Example direction: 'Hoa, anh yeu em rat nhieu ^^' should read like '호아, 정말 많이 사랑해요 ^^', not a word-for-word pronoun mapping.",
      "- If the Vietnamese source is reflective narration rather than direct dialogue, produce natural Korean narrative prose instead of mirroring Vietnamese word order.",
      "- If a literal Vietnamese-to-Korean mapping sounds like translationese, rewrite it into the closest idiomatic Korean expression while preserving the same meaning, tone, and relationship nuance.",
      "- Reorder clauses when needed so the Korean reads smoothly. Vietnamese connective order, serial-verb structure, and repeated topic phrases should not be copied rigidly into Korean.",
      "- Render Vietnamese particles and softeners such as 'nhe', 'nha', 'a', 'ma', 'roi', 'di', or 'chu' by their function in natural Korean or omit them if Korean would not say them explicitly.",
      "- Prefer spoken Korean predicates and endings over stiff explanatory prose. Avoid unnatural translationese such as overusing '-하는 것이다', '-하게 된다', or noun-heavy phrasing unless the source is truly formal.",
      "- When the Vietnamese source uses emotionally supportive, apologetic, teasing, or affectionate chat language, choose the Korean sentence a native speaker would naturally text in that moment, not a clause-by-clause literal rendering.",
      "- If several Korean phrasings are possible, choose the one that sounds most natural in context while staying fully faithful to the source content."
    );
  }

  if (translationConcept === "lover") {
    rules.push(
      "- In lover mode, keep affectionate warmth only where the source already supports it. Do not romanticize plain observation, weather description, or neutral inner monologue."
    );
  }

  return rules;
}

function normalizeTranslationConcept(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ["office", "general", "friend", "lover"].includes(normalized) ? normalized : DEFAULT_TRANSLATION_CONCEPT;
}

function describeTranslationConcept(concept) {
  return (
    {
      office: "professional, polite, and exact without dropping any source nuance",
      general: "neutral everyday conversation with high fidelity to the source wording and emphasis",
      friend: "casual and friendly while still preserving the original wording, order, and emphasis closely",
      lover: "gentle, warm, affectionate romantic-partner language while preserving the original wording, order, and emphasis closely",
    }[normalizeTranslationConcept(concept)] || "gentle, warm, affectionate romantic-partner language while preserving the original wording, order, and emphasis closely"
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

function normalizeTranslatedText(outputText, originalText, options = {}) {
  const trimmed = String(outputText || "").trim();
  if (!trimmed) return String(originalText || "");
  let normalized = trimmed;
  if (
    (normalized.startsWith('"') && normalized.endsWith('"')) ||
    (normalized.startsWith("'") && normalized.endsWith("'"))
  ) {
    normalized = normalized.slice(1, -1).trim() || String(originalText || "");
  }
  if (options.targetLanguage === "vi") {
    normalized = normalizeVietnameseFamilySpeakerLabels(normalized, options);
  }
  if (options.targetLanguage === "ko") {
    normalized = normalizeKoreanVietnameseRoleArtifactsSafe(normalized, options);
  }
  return normalized;
}

function normalizeVietnameseFamilySpeakerLabels(outputText, options = {}) {
  let normalized = String(outputText || "").trim();
  if (!normalized) return normalized;
  if (String(options.sourceLanguage || "").trim() !== "ko") return normalized;
  return normalized
    .replace(/(^|\n)\s*Con trai\s*:/giu, "$1Con:")
    .replace(/(^|\n)\s*Con g(?:ai|ái)\s*:/giu, "$1Con:");
}

function normalizeKoreanVietnameseRoleArtifactsSafe(outputText, options = {}) {
  let normalized = String(outputText || "").trim();
  if (!normalized) return normalized;
  const detectedLanguages = Array.isArray(options.detectedLanguages) ? options.detectedLanguages : [options.sourceLanguage];
  const includesVietnamese = detectedLanguages.includes("vi") || options.sourceLanguage === "vi";
  if (!includesVietnamese) return normalized;
  if (!/[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/.test(normalized)) return normalized;
  if (!/\b(?:anh|em|chi|ch\u1ecb|co|c\u00f4|thay|th\u1ea7y|me|m\u1eb9|con)\b/iu.test(normalized)) return normalized;

  normalized = normalized
    .replace(/\b(?:anh|em|chi|ch\u1ecb|co|c\u00f4|thay|th\u1ea7y|me|m\u1eb9|con)\s*(?:\uC740|\uB294|\uC774|\uAC00|\uC744|\uB97C|\uC5D0\uAC8C|\uD55C\uD14C)\s*/giu, "")
    .replace(/\(\s*(?:anh|em|chi|ch\u1ecb|co|c\u00f4|thay|th\u1ea7y|me|m\u1eb9|con)\s*\)/giu, "")
    .replace(/\b(?:anh|em|chi|ch\u1ecb|co|c\u00f4|thay|th\u1ea7y|me|m\u1eb9|con)\b/giu, "")
    .replace(/\s+,/g, ",")
    .replace(/,\s*,/g, ", ")
    .replace(/\s{2,}/g, " ")
    .trim();

  return normalized;
}

function normalizeKoreanVietnameseRoleArtifacts(outputText, options = {}) {
  let normalized = String(outputText || "").trim();
  if (!normalized) return normalized;
  const detectedLanguages = Array.isArray(options.detectedLanguages) ? options.detectedLanguages : [options.sourceLanguage];
  const includesVietnamese = detectedLanguages.includes("vi") || options.sourceLanguage === "vi";
  if (!includesVietnamese) return normalized;
  if (!/[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/.test(normalized)) return normalized;
  if (!/\b(?:anh|em|chi|chị|co|cô|thay|thầy|me|mẹ|con)\b/iu.test(normalized)) return normalized;

  normalized = normalized
    .replace(/\b(?:anh|em|chi|chị|co|cô|thay|thầy|me|mẹ|con)\s*(?:은|는|이|가|을|를|에게|한테)\s*/giu, "")
    .replace(/\(\s*(?:anh|em|chi|chị|co|cô|thay|thầy|me|mẹ|con)\s*\)/giu, "")
    .replace(/\b(?:anh|em|chi|chị|co|cô|thay|thầy|me|mẹ|con)\b/giu, "")
    .replace(/\s+,/g, ",")
    .replace(/,\s*,/g, ", ")
    .replace(/\s{2,}/g, " ")
    .trim();

  return normalized;
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
  const sourceLanguage = normalizeMessageLanguageCode(message.originalLanguage || message.sourceLanguage, "ko");
  const translations = sanitizeTranslations(message.translations, originalText, sourceLanguage);

  return {
    ...message,
    originalText,
    originalLanguage: sourceLanguage,
    sourceLanguage,
    media: sanitizeMediaState(message.media),
    status: ["composing", "sent", "delivered", "read"].includes(message.status) ? message.status : "sent",
    deliveredTo: filterRecordByAllowedKeys(message.deliveredTo, allowedUserIds),
    readBy: filterRecordByAllowedKeys(message.readBy, allowedUserIds),
    translations,
    translationMeta: sanitizeTranslationMeta(message.translationMeta, translations, sourceLanguage),
  };
}

function normalizeMessageLanguageCode(value, fallback = "ko") {
  const normalized = getTranslationVariantLanguage(value);
  if (normalized) return normalized;
  const fallbackLanguage = getTranslationVariantLanguage(fallback);
  return fallbackLanguage || "ko";
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
    .filter((user) => !deletedUserIds.has(user.id))
    .map((user) => ({
      ...user,
      loginId: normalizeDisplayText(user?.loginId || user?.name).trim().toLowerCase(),
      name: normalizeDisplayText(user.name),
      nickname: normalizeDisplayText(user?.nickname || "").trim(),
      gender: user?.gender === "female" ? "female" : user?.gender === "male" ? "male" : "",
      age: Number(user?.age || 0) || "",
      auth: {
        provider: user?.auth?.provider || "local",
        subject: user?.auth?.subject || normalizeDisplayText(user?.loginId || user?.name).trim().toLowerCase(),
        email: user?.auth?.email || null,
        phoneNumber: user?.auth?.phoneNumber || null,
        phoneVerified: Boolean(user?.auth?.phoneVerified),
      },
      blockedUserIds: Array.isArray(user?.blockedUserIds) ? user.blockedUserIds : [],
      password: typeof user?.password === "string" ? user.password : "",
      preferredTranslationConcept: normalizeTranslationConcept(user?.preferredTranslationConcept),
      isAdmin: Boolean(user?.isAdmin) || normalizeDisplayText(user?.loginId || "").trim().toLowerCase() === "admin",
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
    .filter((room) => !deletedRoomIds.has(room.id) && !shouldDiscardRoom(room))
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

async function serveUploadedMedia(requestPath, res, headOnly) {
  const requestedName = path.basename(String(requestPath || "").replace(/^\/media\//, ""));
  if (!requestedName || requestedName.includes("..")) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  const absolutePath = path.join(MEDIA_STORAGE_DIR, requestedName);
  const ext = path.extname(requestedName).toLowerCase();

  try {
    const fileBuffer = await readFile(absolutePath);
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable",
    });
    res.end(headOnly ? undefined : fileBuffer);
  } catch (error) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req, maxBytes = JSON_BODY_MAX_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;

    req.on("data", (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.length;
      if (totalBytes > maxBytes) {
        const error = new Error("Request body too large");
        error.code = "body_too_large";
        req.destroy();
        reject(error);
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

function readBinaryBody(req, maxBytes = MEDIA_UPLOAD_MAX_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;

    req.on("data", (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.length;
      if (totalBytes > maxBytes) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(buffer);
    });

    req.on("end", () => resolve(chunks.length ? Buffer.concat(chunks) : Buffer.alloc(0)));
    req.on("error", reject);
  });
}

server.listen(PORT, () => {
  console.log(`TRANSCHAT local server running at http://localhost:${PORT}`);
  console.log(
    OPENAI_API_KEY_VALID
      ? `Live translation enabled with model ${OPENAI_MODEL}.`
      : OPENAI_API_KEY
        ? "OPENAI_API_KEY is malformed. Re-enter it in one line using ASCII characters only. The client will fall back to mock translation."
        : "OPENAI_API_KEY is missing. The client will fall back to mock translation."
  );
});
