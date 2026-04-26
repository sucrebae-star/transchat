import { createServer } from "node:http";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient, ObjectId } from "mongodb";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOCAL_RUNTIME_CONFIG = await loadLocalRuntimeConfig();
const SERVER_STATE_FILE = path.join(__dirname, "transchat-server-state.json");
const PUSH_TOKEN_STATE_FILE = path.join(__dirname, "transchat-push-tokens.json");
const MEDIA_STORAGE_DIR = path.join(__dirname, "transchat-media");
const STATE_SCHEMA_VERSION = 2;
const PUSH_TOKEN_SCHEMA_VERSION = 2;
const JSON_BODY_MAX_BYTES = 200_000;
const STATE_SYNC_BODY_MAX_BYTES = 5 * 1024 * 1024;
const MEDIA_UPLOAD_MAX_BYTES = 60 * 1024 * 1024;

const PORT = Number(process.env.PORT || 3000);
const MONGODB_URI = String(process.env.MONGODB_URI || "").trim();
const MONGODB_DB_NAME = String(process.env.MONGODB_DB_NAME || "transchat").trim() || "transchat";
const MONGODB_USERS_COLLECTION = String(process.env.MONGODB_USERS_COLLECTION || "users").trim() || "users";
const OPENAI_API_KEY = normalizeOpenAIApiKey(process.env.OPENAI_API_KEY || "");
const OPENAI_API_KEY_VALID = isValidOpenAIApiKey(OPENAI_API_KEY);
const OPENAI_MODEL = process.env.OPENAI_TRANSLATION_MODEL || "gpt-5-mini";
const OPENAI_TRANSLATION_FALLBACK_MODEL = normalizeTranslationModelName(process.env.OPENAI_TRANSLATION_FALLBACK_MODEL || "");
const OPENAI_TRANSLATION_CONTEXTUAL_FALLBACK = isEnabledEnv(process.env.OPENAI_TRANSLATION_CONTEXTUAL_FALLBACK || "");
const OPENAI_TRANSLATION_REASONING_EFFORT = normalizeTranslationReasoningEffort(process.env.OPENAI_TRANSLATION_REASONING_EFFORT || "low");
const OPENAI_TRANSLATION_MAX_ATTEMPTS = Math.max(1, Number(process.env.OPENAI_TRANSLATION_MAX_ATTEMPTS || 2));
const OPENAI_TRANSLATION_RETRY_BASE_DELAY_MS = Math.max(100, Number(process.env.OPENAI_TRANSLATION_RETRY_BASE_DELAY_MS || 180));
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
const FIREBASE_SERVICE_ACCOUNT_JSON = String(
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
    LOCAL_RUNTIME_CONFIG.FIREBASE_SERVICE_ACCOUNT_JSON ||
    "",
).trim();
const FIREBASE_SERVICE_ACCOUNT_BASE64 = String(
  process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 ||
    LOCAL_RUNTIME_CONFIG.FIREBASE_SERVICE_ACCOUNT_BASE64 ||
    "",
).trim();
const FIREBASE_SERVICE_ACCOUNT_PATH =
  process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
  LOCAL_RUNTIME_CONFIG.FIREBASE_SERVICE_ACCOUNT_PATH ||
  "";
const FIREBASE_ANDROID_APP_ID = String(
  process.env.FIREBASE_ANDROID_APP_ID ||
      LOCAL_RUNTIME_CONFIG.FIREBASE_ANDROID_APP_ID ||
      "",
).trim();
const FIREBASE_ANDROID_API_KEY = String(
  process.env.FIREBASE_ANDROID_API_KEY ||
      LOCAL_RUNTIME_CONFIG.FIREBASE_ANDROID_API_KEY ||
      FIREBASE_WEB_CONFIG_FALLBACK.apiKey ||
      "",
).trim();
const FIREBASE_ANDROID_PROJECT_ID = String(
  process.env.FIREBASE_ANDROID_PROJECT_ID ||
      LOCAL_RUNTIME_CONFIG.FIREBASE_ANDROID_PROJECT_ID ||
      FIREBASE_WEB_CONFIG_FALLBACK.projectId ||
      "",
).trim();
const FIREBASE_ANDROID_SENDER_ID = String(
  process.env.FIREBASE_ANDROID_SENDER_ID ||
      LOCAL_RUNTIME_CONFIG.FIREBASE_ANDROID_SENDER_ID ||
      FIREBASE_WEB_CONFIG_FALLBACK.messagingSenderId ||
      "",
).trim();
const PUSH_PUBLIC_ORIGIN = normalizePushOrigin(process.env.PUSH_PUBLIC_ORIGIN || "https://transchat.xyz");
const ROOM_AUTO_EXPIRATION_ENABLED = false;
const TYPING_SIGNAL_TTL_MS = 4500;
const PRESENCE_SIGNAL_TTL_MS = 2 * 60 * 1000;
const ALLOWED_LANGUAGES = new Set(["ko", "en", "vi", "ja", "zh", "fil", "ms", "ru"]);
const DEFAULT_TRANSLATION_CONCEPT = "lover";
const PERSISTENT_ROOM_TITLE_KEYS = new Set(["호아와현태", "호아와현태의방"]);
const RECOVERY_QUESTION_KEYS = [
  "recoveryFavoriteColor",
  "recoveryChildhoodNickname",
  "recoveryFavoriteAnimal",
  "recoveryMemorableFood",
  "recoveryFavoriteSeason",
];
const BILLING_FREE_DAILY_TRANSLATIONS = 30;
const BILLING_PREMIUM_MONTHLY_PRICE_VAT_INCLUDED_KRW = 9900;
const BILLING_VAT_RATE = 0.1;
const BILLING_TARGET_MARGIN_RATE_EX_VAT = 0.5;
const BILLING_STANDARD_TRANSLATION_UNIT_CHARACTERS = 220;
const BILLING_ESTIMATED_COST_PER_UNIT_KRW_EX_VAT = 2.0;
const BILLING_PREMIUM_PRODUCT_ID = "transchat_premium_monthly_9900";
const BILLING_TESTER_CODE = "testfree90";
const BILLING_TESTER_ACCESS_DAYS = 90;
const BILLING_PREMIUM_MONTHLY_PRICE_VAT_EXCLUDED_KRW = Math.round(
  BILLING_PREMIUM_MONTHLY_PRICE_VAT_INCLUDED_KRW / (1 + BILLING_VAT_RATE),
);
const BILLING_PREMIUM_COST_BUDGET_KRW_EX_VAT = Math.floor(
  BILLING_PREMIUM_MONTHLY_PRICE_VAT_EXCLUDED_KRW *
    (1 - BILLING_TARGET_MARGIN_RATE_EX_VAT),
);
const BILLING_PREMIUM_MONTHLY_SOFT_LIMIT_UNITS = Math.max(
  1200,
  Math.floor(
    BILLING_PREMIUM_COST_BUDGET_KRW_EX_VAT /
      BILLING_ESTIMATED_COST_PER_UNIT_KRW_EX_VAT,
  ),
);
const BILLING_PREMIUM_DAILY_SOFT_LIMIT_UNITS = Math.max(
  120,
  Math.floor(BILLING_PREMIUM_MONTHLY_SOFT_LIMIT_UNITS / 18),
);

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
  ["/privacy", "privacy.html"],
  ["/privacy.html", "privacy.html"],
  ["/privacy-policy", "privacy.html"],
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
let mongoClientPromise = null;
let lastTranslationError = null;
let lastTranslationErrorDetail = null;

function normalizeOpenAIApiKey(value) {
  return String(value || "")
    .replace(/^['"`]+|['"`]+$/g, "")
    .replace(/\s+/g, "")
    .trim();
}

async function loadLocalRuntimeConfig() {
  const sources = [
    path.join(__dirname, "local.properties"),
    path.join(__dirname, "ops", "windows", "transchat.env"),
  ];
  const merged = {};
  for (const source of sources) {
    Object.assign(merged, await parseKeyValueConfig(source));
  }
  return merged;
}

async function parseKeyValueConfig(filePath) {
  try {
    const raw = await readFile(filePath, "utf8");
    const next = {};
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }
      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex <= 0) {
        continue;
      }
      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim();
      if (!key || !value) {
        continue;
      }
      next[key] = value;
    }
    return next;
  } catch (_) {
    return {};
  }
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

function isPushUserMessageKind(kind) {
  return ["user", "text", "image", "video", "file"].includes(String(kind || "").trim());
}

function getPushMediaKind(message) {
  if (message?.media?.kind) {
    return String(message.media.kind).trim();
  }
  if (message?.attachment?.type === "profile") {
    return "";
  }
  if (message?.attachment) {
    const normalizedKind = String(message?.kind || "").trim();
    if (["image", "video", "file"].includes(normalizedKind)) {
      return normalizedKind;
    }
  }
  return "";
}

function getLatestUserMessageForTrace(state = serverState) {
  const rooms = Array.isArray(state?.rooms) ? [...state.rooms] : [];
  const latestRoom = rooms
    .filter((room) => Array.isArray(room?.messages) && room.messages.length)
    .sort((a, b) => Number(b.lastMessageAt || b.createdAt || 0) - Number(a.lastMessageAt || a.createdAt || 0))[0];
  const latestMessage = [...(latestRoom?.messages || [])]
    .filter((message) => isPushUserMessageKind(message?.kind) && String(message?.originalText || "").trim())
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

const API_ROUTES = [
  { method: "GET", path: "/api/health", handler: handleHealthRequest },
  { method: "GET", path: "/api/push/config", handler: handlePushConfig },
  { method: "POST", path: "/api/push/register", handler: handlePushRegister },
  { method: "POST", path: "/api/push/native/register", handler: handleNativePushRegister },
  { method: "POST", path: "/api/push/native/bind", handler: handleNativePushBind },
  { method: "POST", path: "/api/push/native/unbind", handler: handleNativePushUnbind },
  { method: "POST", path: "/api/push/unregister", handler: handlePushUnregister },
  { method: "POST", path: "/api/translate", handler: handleTranslate },
  { method: "POST", path: "/api/vocabulary/extract", handler: handleVocabularyExtract },
  { method: "POST", path: "/api/media", handler: handleMediaUpload },
  { method: "POST", path: "/api/typing", handler: handleTypingUpdate },
  { method: "POST", path: "/api/presence", handler: handlePresenceUpdate },
  { method: "GET", path: "/api/state", handler: handleStateRead },
  { method: "PUT", path: "/api/state", handler: handleStateUpdate },
  { method: "GET", path: "/api/users/discoverable", handler: handleDiscoverableUsers },
  { method: "POST", path: "/api/users/directory-sync", handler: handleDirectoryUserSync },
  { method: "GET", path: "/api/billing/plans", handler: handleBillingPlans },
  { method: "GET", path: "/api/billing/status", handler: handleBillingStatus },
  { method: "POST", path: "/api/billing/tester-code/activate", handler: handleBillingTesterCodeActivate },
  { method: "GET", path: "/api/auth/login-id-availability", handler: handleAuthLoginIdAvailability },
  { method: "GET", path: "/api/auth/recovery-question", handler: handleAuthRecoveryQuestion },
  { method: "POST", path: "/api/auth/verify-recovery", handler: handleAuthVerifyRecovery },
  { method: "POST", path: "/api/auth/reset-password", handler: handleAuthResetPassword },
  { method: "POST", path: "/api/auth/signup", handler: handleAuthSignUp },
  { method: "POST", path: "/api/auth/login", handler: handleAuthLogin },
  { method: "POST", path: "/api/auth/delete-account", handler: handleAuthDeleteAccount },
  { method: "GET", path: "/api/events", handler: handleEventStream },
];

const server = createServer(async (req, res) => {
  const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (isApiRequestPath(requestUrl.pathname)) {
    return dispatchApiRequest(req, res, requestUrl);
  }

  return dispatchStaticRequest(req, res, requestUrl);
});

function isApiRequestPath(pathname) {
  return String(pathname || "").startsWith("/api/");
}

async function dispatchApiRequest(req, res, requestUrl) {
  const method = String(req.method || "GET").toUpperCase();
  const pathname = requestUrl.pathname;
  const matchingPathRoutes = API_ROUTES.filter((route) => route.path === pathname);

  if (!matchingPathRoutes.length) {
    return sendApiError(res, 404, "route_not_found", `API route not found: ${pathname}`);
  }

  const route = matchingPathRoutes.find((candidate) => candidate.method === method);
  if (!route) {
    const allow = [...new Set(matchingPathRoutes.map((candidate) => candidate.method))].join(", ");
    res.setHeader("Allow", allow);
    return sendApiError(
      res,
      405,
      "method_not_allowed",
      `Method ${method} is not allowed for ${pathname}.`,
    );
  }

  return route.handler(req, res, requestUrl);
}

async function dispatchStaticRequest(req, res, requestUrl) {
  const method = String(req.method || "GET").toUpperCase();
  const pathname = requestUrl.pathname;
  const headOnly = method === "HEAD";

  if (pathname.startsWith("/media/")) {
    if (method === "GET" || method === "HEAD") {
      return serveUploadedMedia(pathname, res, headOnly);
    }
    return sendPlainText(res, 405, "Method not allowed");
  }

  if (method === "GET" || method === "HEAD") {
    return serveStatic(pathname, res, headOnly);
  }

  return sendPlainText(res, 404, "Not found");
}

function handleHealthRequest(_req, res) {
  return sendApiSuccess(res, 200, {
    ok: true,
    liveTranslationEnabled: OPENAI_API_KEY_VALID,
    model: OPENAI_MODEL,
    fallbackModel: OPENAI_TRANSLATION_FALLBACK_MODEL || null,
    contextualFallbackEnabled: Boolean(OPENAI_TRANSLATION_FALLBACK_MODEL && OPENAI_TRANSLATION_CONTEXTUAL_FALLBACK),
    reasoningEffort: OPENAI_TRANSLATION_REASONING_EFFORT,
    sharedStateEnabled: true,
    hasServerState: Boolean(serverState),
    translationConfigured: OPENAI_API_KEY_VALID,
    lastTranslationError,
    lastTranslationErrorDetail,
  });
}

function handleStateRead(_req, res) {
  prunePresenceSignals();
  return sendApiSuccess(res, 200, {
    state: buildReadableServerState(serverState),
  });
}

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
    const sourceLanguage = String(body?.sourceLanguage || body?.source_language || "").trim();
    const detectedLanguages = [...new Set(
      (
        Array.isArray(body?.detectedLanguages)
          ? body.detectedLanguages
          : Array.isArray(body?.detected_languages)
            ? body.detected_languages
            : [sourceLanguage]
      )
        .map((item) => String(item || "").trim())
        .filter((language) => ALLOWED_LANGUAGES.has(language))
    )];
    const targetLanguage = String(body?.targetLanguage || body?.target_language || "").trim();
    const targetLanguages = Array.isArray(body?.targetLanguages)
      ? body.targetLanguages
      : Array.isArray(body?.target_languages)
        ? body.target_languages
        : targetLanguage
          ? [targetLanguage]
          : [];
    const translationConcept = normalizeTranslationConcept(body?.translationConcept || body?.translation_concept);
    const contextSummary = String(body?.contextSummary || body?.context_summary || "").trim().slice(0, 800);
    const participantContext = normalizeParticipantContext(
      body?.participantContext || body?.participant_context,
    );
    const senderUserId = String(body?.senderUserId || body?.sender_user_id || "").trim();
    const viewerUserId = String(body?.viewerUserId || body?.viewer_user_id || "").trim();

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
      senderUserId,
      viewerUserId,
      text: text.slice(0, 120),
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
      participantContext,
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
    console.error("[translate] failed", {
      error: String(error?.message || error || "translation_request_failed"),
    });
    lastTranslationError = normalizeTranslationError(error);
    lastTranslationErrorDetail = summarizeTranslationError(error);
    return sendJson(res, 500, {
      error: "translation_failed",
      message: "The translation request could not be completed.",
      detail: lastTranslationErrorDetail,
    });
  }
}

async function handleVocabularyExtract(req, res) {
  try {
    if (!OPENAI_API_KEY) {
      return sendApiError(
        res,
        503,
        "missing_api_key",
        "Set OPENAI_API_KEY to enable vocabulary extraction.",
      );
    }
    if (!OPENAI_API_KEY_VALID) {
      return sendApiError(
        res,
        503,
        "invalid_api_key_format",
        "OPENAI_API_KEY is malformed.",
      );
    }

    const body = await readJsonBody(req);
    const text = normalizeDisplayText(body?.text || "").trim();
    const meaningLanguage = ALLOWED_LANGUAGES.has(
      String(body?.meaningLanguage || body?.meaning_language || "").trim(),
    )
      ? String(body?.meaningLanguage || body?.meaning_language).trim()
      : "ko";
    const maxCards = Math.max(4, Math.min(80, Number(body?.maxCards || body?.max_cards || 12) || 12));
    const knownTerms = sanitizeVocabularyKnownTerms(body?.knownTerms || body?.known_terms);

    if (!text) {
      return sendApiError(
        res,
        400,
        "invalid_vocabulary_request",
        "text is required.",
      );
    }

    const cards = await requestVocabularyExtraction({
      text,
      meaningLanguage,
      maxCards,
      knownTerms,
    });

    return sendApiSuccess(res, 200, {
      cards,
      model: OPENAI_MODEL,
    });
  } catch (error) {
    console.error("[vocabulary] extraction failed", {
      error: String(error?.message || error || "vocabulary_extract_failed"),
    });
    return sendApiError(
      res,
      500,
      "vocabulary_extract_failed",
      "The vocabulary extraction request could not be completed.",
    );
  }
}

async function handlePushConfig(_req, res) {
  const clientConfig = getFirebaseClientConfig();
  const nativeConfig = getFirebaseNativeConfig();
  return sendJson(res, 200, {
    enabled: Boolean((clientConfig && FIREBASE_VAPID_KEY) || nativeConfig.enabled),
    webConfig: clientConfig,
    vapidKey: FIREBASE_VAPID_KEY || "",
    nativeConfig,
    adminConfig: getFirebaseAdminConfig(),
  });
}

async function handleDiscoverableUsers(_req, res, requestUrl) {
  try {
    if (!MONGODB_URI) {
      return sendApiError(
        res,
        503,
        "mongodb_not_configured",
        "Set MONGODB_URI to enable the discoverable users API.",
      );
    }

    const viewerUserId = String(
      requestUrl.searchParams.get("viewerUserId") ||
      requestUrl.searchParams.get("viewer_user_id") ||
      "",
    ).trim();

    if (!viewerUserId) {
      return sendApiError(
        res,
        400,
        "viewer_user_id_required",
        "viewerUserId query parameter is required.",
      );
    }

    const usersCollection = await getMongoUsersCollection();
    const viewer = await usersCollection.findOne(
      buildMongoUserLookupQuery(viewerUserId),
      {
        projection: {
          _id: 1,
          id: 1,
          loginId: 1,
          blockedUserIds: 1,
          blockedUsers: 1,
        },
      },
    );

    if (!viewer) {
      return sendApiError(
        res,
        404,
        "viewer_not_found",
        "The viewer account could not be found.",
      );
    }

    const viewerResolvedId = resolveMongoUserId(viewer);
    const viewerBlockedIds = normalizeBlockedUserIds(viewer);
    const users = await usersCollection.find(
      buildDiscoverableMongoUsersQuery(),
      {
        projection: {
          _id: 1,
          id: 1,
          loginId: 1,
          name: 1,
          nickname: 1,
          nativeLanguage: 1,
          uiLanguage: 1,
          preferredChatLanguage: 1,
          profileImage: 1,
          joinedAt: 1,
          lastSeenAt: 1,
          blockedUserIds: 1,
          blockedUsers: 1,
          isAdmin: 1,
          deletedAt: 1,
          withdrawnAt: 1,
          isDeleted: 1,
          status: 1,
        },
      },
    ).toArray();

    const discoverableUsers = users
      .filter((user) => {
        const candidateId = resolveMongoUserId(user);
        if (!candidateId || candidateId === viewerResolvedId) {
          return false;
        }
        if (viewerBlockedIds.has(candidateId)) {
          return false;
        }
        const blockedByCandidate = normalizeBlockedUserIds(user);
        return !blockedByCandidate.has(viewerResolvedId);
      })
      .map((user) => sanitizeDiscoverableUser(user))
      .filter(Boolean);

    console.info("[users] discoverable", {
      viewerUserId: viewerResolvedId,
      returned: discoverableUsers.length,
    });

    return sendApiSuccess(res, 200, {
      users: discoverableUsers,
      meta: {
        viewerUserId: viewerResolvedId,
        count: discoverableUsers.length,
      },
    });
  } catch (error) {
    console.error("[users] discoverable failed", {
      error: String(error?.message || error || "discoverable_users_failed"),
    });
    return sendApiError(
      res,
      500,
      "discoverable_users_failed",
      "The discoverable users request could not be completed.",
    );
  }
}

async function handleDirectoryUserSync(req, res) {
  try {
    if (!MONGODB_URI) {
      return sendApiError(
        res,
        503,
        "mongodb_not_configured",
        "Set MONGODB_URI to enable directory user sync.",
      );
    }

    const body = await readJsonBody(req);
    const rawUser = body?.user && typeof body.user === "object"
      ? body.user
      : body;
    const user = sanitizeDirectoryUserDocument(rawUser);

    if (!user?.id || !user?.loginId || !user?.name) {
      return sendApiError(
        res,
        400,
        "invalid_user_payload",
        "id, loginId, and name are required.",
      );
    }

    const usersCollection = await getMongoUsersCollection();
    const existingById = await usersCollection.findOne(
      { id: user.id },
      {
        projection: {
          _id: 1,
          id: 1,
          loginId: 1,
          isDeleted: 1,
          status: 1,
        },
      },
    );

    const now = Date.now();
    const isDeletedPayload = Boolean(user.isDeleted || user.deletedAt || user.withdrawnAt || user.status === "withdrawn");

    if (existingById) {
      await usersCollection.updateOne(
        { _id: existingById._id },
        {
          $set: {
            ...user,
            updatedAt: now,
          },
          $setOnInsert: {
            createdAt: now,
          },
        },
      );
    } else {
      const activeUserByLoginId = await usersCollection.findOne(
        buildActiveMongoUserByLoginIdQuery(user.loginId),
        {
          projection: {
            _id: 1,
            id: 1,
            loginId: 1,
          },
        },
      );

      if (activeUserByLoginId && resolveMongoUserId(activeUserByLoginId) !== user.id) {
        return sendApiError(
          res,
          409,
          "directory_login_conflict",
          "Another active account already uses that login ID.",
        );
      }

      if (isDeletedPayload) {
        console.info("[users] directory sync skipped missing deleted user", {
          userId: user.id,
          loginId: user.loginId,
        });
        return sendApiSuccess(res, 200, {
          userId: user.id,
          skipped: true,
        });
      }

      await usersCollection.updateOne(
        { id: user.id },
        {
          $set: {
            ...user,
            updatedAt: now,
          },
          $setOnInsert: {
            createdAt: now,
          },
        },
        { upsert: true },
      );
    }

    console.info("[users] directory sync", {
      userId: user.id,
      loginId: user.loginId,
      deleted: Boolean(user.isDeleted || user.deletedAt || user.withdrawnAt),
    });

    return sendApiSuccess(res, 200, {
      userId: user.id,
    });
  } catch (error) {
    console.error("[users] directory sync failed", {
      error: String(error?.message || error || "directory_user_sync_failed"),
    });
    return sendApiError(
      res,
      500,
      "directory_user_sync_failed",
      "The directory user sync request could not be completed.",
    );
  }
}

function handleBillingPlans(_req, res) {
  return sendApiSuccess(res, 200, {
    plans: buildBillingPlansPayload(),
  });
}

async function handleBillingStatus(_req, res, requestUrl) {
  try {
    if (!MONGODB_URI) {
      return sendApiError(
        res,
        503,
        "mongodb_not_configured",
        "Set MONGODB_URI to enable billing status checks.",
      );
    }

    const userLookupValue = normalizeDisplayText(
      requestUrl.searchParams.get("userId") ||
        requestUrl.searchParams.get("user_id") ||
        requestUrl.searchParams.get("loginId") ||
        requestUrl.searchParams.get("login_id") ||
        "",
    ).trim();

    if (!userLookupValue) {
      return sendApiError(
        res,
        400,
        "invalid_billing_status_request",
        "userId or loginId query parameter is required.",
      );
    }

    const usersCollection = await getMongoUsersCollection();
    const user = await usersCollection.findOne(
      buildActiveMongoUserLookupQuery(userLookupValue),
      {
        projection: {
          _id: 1,
          id: 1,
          loginId: 1,
          translationAccess: 1,
        },
      },
    );

    if (!user) {
      return sendApiError(
        res,
        404,
        "billing_user_not_found",
        "The account could not be found.",
      );
    }

    return sendApiSuccess(res, 200, {
      userId: resolveMongoUserId(user),
      loginId: String(user?.loginId || "").trim(),
      translationAccess: sanitizeTranslationAccess(user?.translationAccess),
      plans: buildBillingPlansPayload(),
    });
  } catch (error) {
    console.error("[billing] status failed", {
      error: String(error?.message || error || "billing_status_failed"),
    });
    return sendApiError(
      res,
      500,
      "billing_status_failed",
      "The billing status request could not be completed.",
    );
  }
}

async function handleBillingTesterCodeActivate(req, res) {
  try {
    if (!MONGODB_URI) {
      return sendApiError(
        res,
        503,
        "mongodb_not_configured",
        "Set MONGODB_URI to enable tester code activation.",
      );
    }

    const body = await readJsonBody(req);
    const userLookupValue = normalizeDisplayText(
      body?.userId || body?.loginId || "",
    ).trim();
    const code = normalizeTesterCode(body?.code || "");

    if (!userLookupValue || !code) {
      return sendApiError(
        res,
        400,
        "invalid_tester_code_request",
        "userId or loginId, and code are required.",
      );
    }

    if (!isValidTesterCode(code)) {
      return sendApiError(
        res,
        400,
        "invalid_tester_code",
        "The tester code is not valid.",
      );
    }

    const usersCollection = await getMongoUsersCollection();
    const user = await usersCollection.findOne(
      buildActiveMongoUserLookupQuery(userLookupValue),
    );

    if (!user) {
      return sendApiError(
        res,
        404,
        "billing_user_not_found",
        "The account could not be found.",
      );
    }

    const now = Date.now();
    const translationAccess = activateTesterCodeTranslationAccess(
      sanitizeTranslationAccess(user?.translationAccess),
      code,
      now,
    );

    await usersCollection.updateOne(
      { _id: user._id },
      {
        $set: {
          translationAccess,
          updatedAt: now,
        },
      },
    );

    const nextUser = {
      ...user,
      translationAccess,
      updatedAt: now,
    };

    console.info("[billing] tester code activated", {
      userId: resolveMongoUserId(user),
      loginId: String(user?.loginId || "").trim(),
    });

    return sendApiSuccess(res, 200, {
      user: sanitizeAuthUser(nextUser),
    });
  } catch (error) {
    console.error("[billing] tester code activation failed", {
      error: String(error?.message || error || "billing_tester_code_activation_failed"),
    });
    return sendApiError(
      res,
      500,
      "billing_tester_code_activation_failed",
      "The tester code could not be activated.",
    );
  }
}

async function handleAuthSignUp(req, res) {
  try {
    if (!MONGODB_URI) {
      return sendApiError(
        res,
        503,
        "mongodb_not_configured",
        "Set MONGODB_URI to enable sign up.",
      );
    }

    const body = await readJsonBody(req);
    const loginId = normalizeDisplayText(body?.loginId || "").trim().toLowerCase();
    const name = normalizeDisplayText(body?.name || "").trim();
    const password = String(body?.password || "").trim();
    const nativeLanguage = ALLOWED_LANGUAGES.has(String(body?.nativeLanguage || "").trim())
      ? String(body.nativeLanguage).trim()
      : "ko";
    const uiLanguage = ALLOWED_LANGUAGES.has(String(body?.uiLanguage || "").trim())
      ? String(body.uiLanguage).trim()
      : nativeLanguage;
    const preferredChatLanguage = ALLOWED_LANGUAGES.has(String(body?.preferredChatLanguage || "").trim())
      ? String(body.preferredChatLanguage).trim()
      : nativeLanguage;
    const testerCode = normalizeTesterCode(body?.testerCode || "");
    const recoveryQuestionKey = RECOVERY_QUESTION_KEYS.includes(body?.recoveryQuestionKey)
      ? body.recoveryQuestionKey
      : getDeterministicRecoveryQuestionKey(name || loginId);
    const recoveryAnswer = normalizeRecoveryAnswer(body?.recoveryAnswer || "");
    const profileImage = sanitizeProfileImageSummary(body?.profileImage);

    if (!loginId || !name || !password) {
      return sendApiError(
        res,
        400,
        "invalid_signup_request",
        "loginId, name, and password are required.",
      );
    }

    if (testerCode && !isValidTesterCode(testerCode)) {
      return sendApiError(
        res,
        400,
        "invalid_tester_code",
        "The tester code is not valid.",
      );
    }

    const usersCollection = await getMongoUsersCollection();
    const existing = await usersCollection.findOne(
      buildActiveMongoUserByLoginIdQuery(loginId),
    );
    if (existing) {
      return sendApiError(
        res,
        409,
        "duplicate_login_id",
        "That login ID already exists.",
      );
    }

    const now = Date.now();
    const user = {
      id: createServerUserId(),
      loginId,
      name,
      nickname: "",
      nativeLanguage,
      uiLanguage,
      preferredChatLanguage,
      profileImage,
      blockedUserIds: [],
      isAdmin: false,
      joinedAt: now,
      lastSeenAt: now,
      lastLoginAt: now,
      currentRoomId: null,
      recoveryQuestionKey,
      recoveryAnswerHash: recoveryAnswer ? hashSecret(recoveryAnswer) : null,
      passwordHash: hashSecret(password),
      passwordHashAlgorithm: "scrypt-v1",
      translationAccess: testerCode
        ? activateTesterCodeTranslationAccess(
            createDefaultTranslationAccess(now),
            testerCode,
            now,
          )
        : createDefaultTranslationAccess(now),
      isDeleted: false,
      status: "active",
      createdAt: now,
      updatedAt: now,
    };

    await usersCollection.insertOne(user);

    return sendApiSuccess(res, 201, {
      user: sanitizeAuthUser(user),
    });
  } catch (error) {
    console.error("[auth] signup failed", {
      error: String(error?.message || error || "auth_signup_failed"),
    });
    return sendApiError(
      res,
      500,
      "auth_signup_failed",
      "The sign up request could not be completed.",
    );
  }
}

async function handleAuthLoginIdAvailability(_req, res, requestUrl) {
  try {
    if (!MONGODB_URI) {
      return sendApiError(
        res,
        503,
        "mongodb_not_configured",
        "Set MONGODB_URI to enable login ID availability checks.",
      );
    }

    const loginId = normalizeDisplayText(
      requestUrl.searchParams.get("loginId") ||
      requestUrl.searchParams.get("login_id") ||
      "",
    ).trim().toLowerCase();

    if (!loginId) {
      return sendApiError(
        res,
        400,
        "invalid_login_id_request",
        "loginId query parameter is required.",
      );
    }

    const usersCollection = await getMongoUsersCollection();
    const existing = await usersCollection.findOne(
      buildActiveMongoUserByLoginIdQuery(loginId),
      {
        projection: {
          _id: 1,
        },
      },
    );

    return sendApiSuccess(res, 200, {
      loginId,
      available: !existing,
    });
  } catch (error) {
    console.error("[auth] login-id-availability failed", {
      error: String(error?.message || error || "auth_login_id_availability_failed"),
    });
    return sendApiError(
      res,
      500,
      "auth_login_id_availability_failed",
      "The login ID availability request could not be completed.",
    );
  }
}

async function handleAuthRecoveryQuestion(_req, res, requestUrl) {
  try {
    if (!MONGODB_URI) {
      return sendApiError(
        res,
        503,
        "mongodb_not_configured",
        "Set MONGODB_URI to enable recovery question lookup.",
      );
    }

    const loginId = normalizeDisplayText(
      requestUrl.searchParams.get("loginId") ||
      requestUrl.searchParams.get("login_id") ||
      "",
    ).trim().toLowerCase();

    if (!loginId) {
      return sendApiError(
        res,
        400,
        "invalid_recovery_question_request",
        "loginId query parameter is required.",
      );
    }

    const usersCollection = await getMongoUsersCollection();
    const user = await usersCollection.findOne(
      buildActiveMongoUserByLoginIdQuery(loginId),
      {
        projection: {
          _id: 1,
          loginId: 1,
          name: 1,
          recoveryQuestionKey: 1,
        },
      },
    );

    if (!user) {
      return sendApiError(
        res,
        404,
        "recovery_user_not_found",
        "We could not find a registered ID.",
      );
    }

    const recoveryQuestionKey = RECOVERY_QUESTION_KEYS.includes(user?.recoveryQuestionKey)
      ? user.recoveryQuestionKey
      : getDeterministicRecoveryQuestionKey(user?.name || user?.loginId);

    return sendApiSuccess(res, 200, {
      loginId,
      recoveryQuestionKey,
    });
  } catch (error) {
    console.error("[auth] recovery question failed", {
      error: String(error?.message || error || "auth_recovery_question_failed"),
    });
    return sendApiError(
      res,
      500,
      "auth_recovery_question_failed",
      "The recovery question request could not be completed.",
    );
  }
}

async function handleAuthVerifyRecovery(req, res) {
  try {
    if (!MONGODB_URI) {
      return sendApiError(
        res,
        503,
        "mongodb_not_configured",
        "Set MONGODB_URI to enable recovery verification.",
      );
    }

    const body = await readJsonBody(req);
    const loginId = normalizeDisplayText(body?.loginId || "").trim().toLowerCase();
    const recoveryAnswer = normalizeRecoveryAnswer(body?.recoveryAnswer || "");

    if (!loginId || !recoveryAnswer) {
      return sendApiError(
        res,
        400,
        "invalid_recovery_verification_request",
        "loginId and recoveryAnswer are required.",
      );
    }

    const usersCollection = await getMongoUsersCollection();
    const user = await usersCollection.findOne(
      buildActiveMongoUserByLoginIdQuery(loginId),
      {
        projection: {
          _id: 1,
          loginId: 1,
          name: 1,
          recoveryQuestionKey: 1,
          recoveryAnswerHash: 1,
          recoveryAnswer: 1,
        },
      },
    );

    if (!user) {
      return sendApiError(
        res,
        404,
        "recovery_user_not_found",
        "We could not find a registered ID.",
      );
    }

    if (!verifyStoredSecret(recoveryAnswer, user?.recoveryAnswerHash || user?.recoveryAnswer || "")) {
      return sendApiError(
        res,
        401,
        "recovery_answer_mismatch",
        "The security question or answer does not match.",
      );
    }

    const recoveryQuestionKey = RECOVERY_QUESTION_KEYS.includes(user?.recoveryQuestionKey)
      ? user.recoveryQuestionKey
      : getDeterministicRecoveryQuestionKey(user?.name || user?.loginId);

    return sendApiSuccess(res, 200, {
      loginId,
      recoveryQuestionKey,
      verified: true,
    });
  } catch (error) {
    console.error("[auth] verify recovery failed", {
      error: String(error?.message || error || "auth_verify_recovery_failed"),
    });
    return sendApiError(
      res,
      500,
      "auth_verify_recovery_failed",
      "The recovery verification request could not be completed.",
    );
  }
}

async function handleAuthResetPassword(req, res) {
  try {
    if (!MONGODB_URI) {
      return sendApiError(
        res,
        503,
        "mongodb_not_configured",
        "Set MONGODB_URI to enable password resets.",
      );
    }

    const body = await readJsonBody(req);
    const loginId = normalizeDisplayText(body?.loginId || "").trim().toLowerCase();
    const recoveryQuestionKey = String(body?.recoveryQuestionKey || "").trim();
    const recoveryAnswer = normalizeRecoveryAnswer(body?.recoveryAnswer || "");
    const newPassword = String(body?.newPassword || "").trim();

    if (!loginId || !recoveryQuestionKey || !recoveryAnswer || !newPassword) {
      return sendApiError(
        res,
        400,
        "invalid_reset_password_request",
        "loginId, recoveryQuestionKey, recoveryAnswer, and newPassword are required.",
      );
    }

    const usersCollection = await getMongoUsersCollection();
    const user = await usersCollection.findOne(
      buildActiveMongoUserByLoginIdQuery(loginId),
    );

    if (!user) {
      return sendApiError(
        res,
        404,
        "recovery_user_not_found",
        "We could not find a registered ID.",
      );
    }

    const expectedRecoveryQuestionKey = RECOVERY_QUESTION_KEYS.includes(user?.recoveryQuestionKey)
      ? user.recoveryQuestionKey
      : getDeterministicRecoveryQuestionKey(user?.name || user?.loginId);

    if (expectedRecoveryQuestionKey !== recoveryQuestionKey) {
      return sendApiError(
        res,
        401,
        "recovery_answer_mismatch",
        "The security question or answer does not match.",
      );
    }

    if (!verifyStoredSecret(recoveryAnswer, user?.recoveryAnswerHash || user?.recoveryAnswer || "")) {
      return sendApiError(
        res,
        401,
        "recovery_answer_mismatch",
        "The security question or answer does not match.",
      );
    }

    const now = Date.now();
    await usersCollection.updateOne(
      { _id: user._id },
      {
        $set: {
          passwordHash: hashSecret(newPassword),
          passwordHashAlgorithm: "scrypt-v1",
          updatedAt: now,
          lastSeenAt: now,
        },
        $unset: {
          password: "",
        },
      },
    );

    return sendApiSuccess(res, 200, {
      loginId,
      passwordReset: true,
    });
  } catch (error) {
    console.error("[auth] reset password failed", {
      error: String(error?.message || error || "auth_reset_password_failed"),
    });
    return sendApiError(
      res,
      500,
      "auth_reset_password_failed",
      "The password reset request could not be completed.",
    );
  }
}

async function handleAuthLogin(req, res) {
  try {
    if (!MONGODB_URI) {
      return sendApiError(
        res,
        503,
        "mongodb_not_configured",
        "Set MONGODB_URI to enable sign in.",
      );
    }

    const body = await readJsonBody(req);
    const loginId = normalizeDisplayText(body?.loginId || "").trim().toLowerCase();
    const password = String(body?.password || "").trim();

    if (!loginId || !password) {
      return sendApiError(
        res,
        400,
        "invalid_login_request",
        "loginId and password are required.",
      );
    }

    const usersCollection = await getMongoUsersCollection();
    const user = await usersCollection.findOne(
      buildActiveMongoUserByLoginIdQuery(loginId),
    );

    if (!user || !verifyStoredSecret(password, user?.passwordHash || user?.password || "")) {
      return sendApiError(
        res,
        401,
        "invalid_credentials",
        "Invalid login ID or password.",
      );
    }

    const now = Date.now();
    const passwordHash = typeof user?.passwordHash === "string" && user.passwordHash.trim().length > 0
      ? user.passwordHash
      : hashSecret(password);
    await usersCollection.updateOne(
      { _id: user._id },
      {
        $set: {
          lastLoginAt: now,
          lastSeenAt: now,
          updatedAt: now,
          passwordHash,
          passwordHashAlgorithm: "scrypt-v1",
        },
        $unset: {
          password: "",
        },
      },
    );

    const nextUser = {
      ...user,
      lastLoginAt: now,
      lastSeenAt: now,
      passwordHash,
      passwordHashAlgorithm: "scrypt-v1",
    };
    return sendApiSuccess(res, 200, {
      user: sanitizeAuthUser(nextUser),
    });
  } catch (error) {
    console.error("[auth] login failed", {
      error: String(error?.message || error || "auth_login_failed"),
    });
    return sendApiError(
      res,
      500,
      "auth_login_failed",
      "The login request could not be completed.",
    );
  }
}

async function handleAuthDeleteAccount(req, res) {
  try {
    if (!MONGODB_URI) {
      return sendApiError(
        res,
        503,
        "mongodb_not_configured",
        "Set MONGODB_URI to enable account deletion.",
      );
    }

    const body = await readJsonBody(req);
    const userId = String(body?.userId || "").trim();
    const loginId = normalizeDisplayText(body?.loginId || "").trim().toLowerCase();
    const password = String(body?.password || "").trim();

    if ((!userId && !loginId) || !password) {
      return sendApiError(
        res,
        400,
        "invalid_delete_account_request",
        "userId or loginId, and password are required.",
      );
    }

    const usersCollection = await getMongoUsersCollection();
    const lookupValue = userId || loginId;
    const user = await usersCollection.findOne(
      buildActiveMongoUserLookupQuery(lookupValue),
    );

    if (!user) {
      return sendApiError(
        res,
        404,
        "user_not_found",
        "The account could not be found.",
      );
    }

    if (Boolean(user?.isAdmin) || String(user?.loginId || "").trim().toLowerCase() === "admin") {
      return sendApiError(
        res,
        403,
        "delete_admin_forbidden",
        "The admin account cannot be deleted.",
      );
    }

    if (!verifyStoredSecret(password, user?.passwordHash || user?.password || "")) {
      return sendApiError(
        res,
        401,
        "invalid_credentials",
        "Invalid login ID or password.",
      );
    }

    const now = Date.now();
    await usersCollection.updateOne(
      { _id: user._id },
      {
        $set: {
          isDeleted: true,
          status: "withdrawn",
          deletedAt: now,
          withdrawnAt: now,
          updatedAt: now,
          lastSeenAt: now,
        },
      },
    );

    return sendApiSuccess(res, 200, {
      userId: resolveMongoUserId(user),
      loginId: String(user?.loginId || "").trim(),
      status: "withdrawn",
    });
  } catch (error) {
    console.error("[auth] delete account failed", {
      error: String(error?.message || error || "auth_delete_account_failed"),
    });
    return sendApiError(
      res,
      500,
      "auth_delete_account_failed",
      "The delete account request could not be completed.",
    );
  }
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

    let hasKnownUser = Boolean(
      serverState?.users?.some((user) => user.id === userId),
    );
    if (!hasKnownUser && MONGODB_URI) {
      try {
        const usersCollection = await getMongoUsersCollection();
        const mongoUser = await usersCollection.findOne(
          buildActiveMongoUserLookupQuery(userId),
          {
            projection: {
              _id: 1,
              id: 1,
            },
          },
        );
        hasKnownUser = Boolean(mongoUser);
      } catch (lookupError) {
        console.error("[push-bind-native] user lookup failed", lookupError);
      }
    }

    if (!hasKnownUser) {
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
    let normalizedState = mergeStates(serverState, {
      ...nextState,
      updatedAt: receivedAt,
    });
    const newMessageEventsForPush = collectNewUserMessages(
      previousState,
      normalizedState,
    );
    normalizedState = markPushMessagesDispatched(
      normalizedState,
      newMessageEventsForPush.map((event) => event.message.id),
    );
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
      void dispatchPushNotifications(previousState, normalizedState).catch((dispatchError) => {
        console.error("[push-dispatch-error]", dispatchError);
      });
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
      mutedByUserId: {
        ...(previous.mutedByUserId || previous.mutedByUser || {}),
        ...(next.mutedByUserId || next.mutedByUser || {}),
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

function getFirebaseAdminConfig() {
  const configured = Boolean(
    FIREBASE_SERVICE_ACCOUNT_JSON ||
      FIREBASE_SERVICE_ACCOUNT_BASE64 ||
      FIREBASE_SERVICE_ACCOUNT_PATH,
  );
  let source = "none";
  if (FIREBASE_SERVICE_ACCOUNT_JSON) {
    source = "env-json";
  } else if (FIREBASE_SERVICE_ACCOUNT_BASE64) {
    source = "env-base64";
  } else if (FIREBASE_SERVICE_ACCOUNT_PATH) {
    source = "path";
  }
  return {
    configured,
    source,
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

async function loadFirebaseServiceAccountCredentials() {
  if (FIREBASE_SERVICE_ACCOUNT_JSON) {
    return {
      credentials: JSON.parse(FIREBASE_SERVICE_ACCOUNT_JSON),
      source: "env-json",
    };
  }

  if (FIREBASE_SERVICE_ACCOUNT_BASE64) {
    const decoded = Buffer.from(FIREBASE_SERVICE_ACCOUNT_BASE64, "base64").toString("utf8");
    return {
      credentials: JSON.parse(decoded),
      source: "env-base64",
    };
  }

  const serviceAccountPath = await resolveFirebaseServiceAccountPath();
  if (!serviceAccountPath) {
    return {
      credentials: null,
      source: "none",
    };
  }

  const serviceAccountRaw = await readFile(serviceAccountPath, "utf8");
  return {
    credentials: JSON.parse(serviceAccountRaw),
    source: `path:${path.basename(serviceAccountPath)}`,
  };
}

async function getFirebaseMessagingClient() {
  if (firebaseMessagingPromise) {
    return firebaseMessagingPromise;
  }

  firebaseMessagingPromise = (async () => {
    const { credentials, source } = await loadFirebaseServiceAccountCredentials();
    if (!credentials) {
      console.warn("[push] No Firebase Admin credentials found.");
      return null;
    }

    try {
      const adminModule = await import("firebase-admin");
      const admin = adminModule.default || adminModule;
      if (!admin.apps.length) {
        admin.initializeApp({
          credential: admin.credential.cert(credentials),
        });
      }
      console.info("[push] Firebase Admin initialized", {
        source,
        projectId: String(credentials?.project_id || credentials?.projectId || "").trim(),
      });
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
  const dispatchedMessageIds = new Set(previousState?.pushDispatchedMessageIds || []);
  const events = [];

  (nextState?.rooms || []).forEach((room) => {
    const previousRoom = previousRoomMap.get(room.id);
    const previousMessageIds = new Set((previousRoom?.messages || []).map((message) => message.id));
    (room.messages || []).forEach((message) => {
      if (
        !isPushUserMessageKind(message?.kind) ||
        previousMessageIds.has(message.id) ||
        dispatchedMessageIds.has(message.id)
      ) return;
      events.push({ room, message });
    });
  });

  return events;
}

function markPushMessagesDispatched(state, messageIds) {
  const mergedIds = [
    ...new Set([
      ...(state?.pushDispatchedMessageIds || []),
      ...(Array.isArray(messageIds) ? messageIds : []),
    ]),
  ].filter((id) => typeof id === "string" && id.trim());
  return {
    ...state,
    pushDispatchedMessageIds: mergedIds.slice(-5000),
  };
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
  const mediaKind = getPushMediaKind(message);
  if (mediaKind === "image") return "사진을 보냈어요";
  if (mediaKind === "video") return "영상을 보냈어요";
  if (mediaKind === "file") return "파일을 보냈어요";
  return "새 메시지가 도착했어요";
}

function getUserDisplayLanguage(user, fallbackLanguage = "ko") {
  return normalizeMessageLanguageCode(user?.motherLanguage || user?.nativeLanguage || user?.preferredChatLanguage, fallbackLanguage);
}

function findStoredTranslationTextForLanguage(message, language) {
  const baseLanguage = getTranslationVariantLanguage(language);
  if (!baseLanguage) return "";
  const translations = message?.translations || {};
  const directEntry = translations[baseLanguage];
  if (typeof directEntry?.text === "string" && directEntry.text.trim() && !directEntry.failed) {
    return directEntry.text.trim();
  }
  const variantEntry = Object.entries(translations).find(([key, entry]) => {
    return getTranslationVariantLanguage(key) === baseLanguage && typeof entry?.text === "string" && entry.text.trim() && !entry.failed;
  });
  return typeof variantEntry?.[1]?.text === "string" ? variantEntry[1].text.trim() : "";
}

function buildPushMessagePreviewForUser(message, recipientUser) {
  const originalText = String(message?.originalText || "").trim();
  const sourceLanguage = normalizeMessageLanguageCode(message?.originalLanguage || message?.sourceLanguage, recipientUser?.nativeLanguage || "ko");
  const detectedLanguages = Array.isArray(message?.languageProfile?.detectedLanguages) ? message.languageProfile.detectedLanguages : [sourceLanguage];
  const mixedLanguageInput = detectedLanguages.some((language) => language && language !== sourceLanguage);
  const recipientLanguage = getUserDisplayLanguage(recipientUser, sourceLanguage);
  const translatedText = findStoredTranslationTextForLanguage(message, recipientLanguage);
  if (translatedText) {
    return translatedText.length > 80 ? `${translatedText.slice(0, 77)}...` : translatedText;
  }
  if (originalText && recipientLanguage === sourceLanguage && !mixedLanguageInput) {
    return originalText.length > 80 ? `${originalText.slice(0, 77)}...` : originalText;
  }
  if (originalText) return "번역중..";
  const mediaKind = getPushMediaKind(message);
  if (mediaKind === "image") return "사진을 보냈어요";
  if (mediaKind === "video") return "영상을 보냈어요";
  if (mediaKind === "file") return "파일을 보냈어요";
  return "새 메시지가 도착했어요";
}

function isRoomPushMutedForUser(room, userId) {
  return Boolean(room?.mutedByUserId?.[userId] || room?.mutedByUser?.[userId]);
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
    console.info("[push-send-skip]", {
      userId,
      reason: "no_registered_tokens",
      type: payload?.type || "unknown",
    });
    return {
      attempted: 0,
      delivered: 0,
      reason: "no_registered_tokens",
      errors: [],
    };
  }

  const messaging = await getFirebaseMessagingClient();
  if (!messaging) {
    console.warn("[push-send-skip]", {
      userId,
      reason: "firebase_admin_unavailable",
      type: payload?.type || "unknown",
    });
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

  console.info("[push-send]", {
    userId,
    type: payload?.type || "unknown",
    attempted: tokens.length,
    delivered,
    reason: delivered > 0 ? "" : errors[0]?.code || "push_send_failed",
  });
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
  const badgeCount = Math.max(0, Number(payload?.badgeCount || payload?.badge_count || 0) || 0);
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
      directBootOk: true,
      data: {
        badge_count: String(badgeCount),
      },
    },
  };
}

function computeUserUnreadBadgeCount(state, userId) {
  if (!userId) {
    return 0;
  }

  return Math.max(
    0,
    (state?.rooms || []).reduce((total, room) => {
      const nextTotal = total + Math.max(0, Number(room?.unreadCountByUserId?.[userId] || 0) || 0);
      return nextTotal;
    }, 0),
  );
}

async function dispatchPushNotifications(previousState, nextState) {
  try {
    const clientConfig = getFirebaseClientConfig();
    const nativeConfig = getFirebaseNativeConfig();
    const webPushReady = Boolean(clientConfig && FIREBASE_VAPID_KEY);
    const nativePushReady = Boolean(nativeConfig.enabled);
    if (!(webPushReady || nativePushReady)) {
      console.info("[push-dispatch-skip]", {
        reason: "push_not_configured",
        webPushReady,
        nativePushReady,
      });
      return;
    }

    const messageEvents = collectNewUserMessages(previousState, nextState);
    const inviteEvents = collectNewPendingInvites(previousState, nextState);
    console.info("[push-dispatch]", {
      messageEventCount: messageEvents.length,
      inviteEventCount: inviteEvents.length,
      webPushReady,
      nativePushReady,
    });

    if (!messageEvents.length && !inviteEvents.length) {
      console.info("[push-dispatch-skip]", {
        reason: "no_new_events",
      });
      return;
    }

    for (const event of messageEvents) {
      const sender = (nextState?.users || []).find((user) => user.id === event.message.senderId);
      const recipients = deriveRoomParticipantIds(event.room, nextState?.users || []).filter((userId) => userId !== event.message.senderId);
      console.info("[push-message-event]", {
        roomId: event.room.id,
        messageId: event.message.id,
        senderId: event.message.senderId,
        recipientCount: recipients.length,
        recipientIds: recipients,
      });
      for (const recipientId of recipients) {
        if (isRoomPushMutedForUser(event.room, recipientId)) {
          console.info("[push-dispatch-skip]", {
            roomId: event.room.id,
            recipientId,
            reason: "room_muted",
          });
          continue;
        }
        const recipient = (nextState?.users || []).find((user) => user.id === recipientId);
        const tokenCount = getPushTokensForUser(recipientId).length;
        console.info("[push-target]", {
          roomId: event.room.id,
          messageId: event.message.id,
          recipientId,
          tokenCount,
          recipientFound: Boolean(recipient),
        });
        const previewText = buildPushMessagePreviewForUser(event.message, recipient);
        const badgeCount = computeUserUnreadBadgeCount(nextState, recipientId);
        await sendPushToUser(recipientId, {
          type: "message",
          roomId: event.room.id,
          senderId: event.message.senderId,
          senderName: sender?.name || sender?.loginId || "알 수 없는 사용자",
          previewText,
          badgeCount,
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
      const badgeCount = computeUserUnreadBadgeCount(nextState, invite.inviteeId);
      console.info("[push-invite-event]", {
        inviteId: invite.id,
        inviteeId: invite.inviteeId,
        tokenCount: getPushTokensForUser(invite.inviteeId).length,
      });
      await sendPushToUser(invite.inviteeId, {
        type: "invite",
        inviteId: invite.id,
        senderId: invite.inviterId,
        senderName: inviter?.name || inviter?.loginId || "알 수 없는 사용자",
        previewText: invite.previewRoomTitle || "",
        badgeCount,
        createdAt: invite.createdAt,
        title: "새 초대",
        body: `${inviter?.name || inviter?.loginId || "알 수 없는 사용자"}님이 채팅 초대를 보냈어요`,
        tag: `invite:${invite.id}`,
        clickPath: "/?pushType=invite",
      });
    }
  } catch (error) {
    console.error("[push-dispatch-error]", error);
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

async function requestOpenAITranslations({ text, sourceLanguage, detectedLanguages = null, targetLanguages, translationConcept = DEFAULT_TRANSLATION_CONCEPT, contextSummary = "", participantContext = null }) {
  if (!targetLanguages.length) {
    return {
      translations: {},
      model: OPENAI_MODEL,
    };
  }

  const translatedEntries = await Promise.allSettled(
    targetLanguages.map(async (targetLanguage) => {
      const translated = await requestSingleOpenAITranslation({
        text,
        sourceLanguage,
        detectedLanguages,
        targetLanguage,
        translationConcept,
        contextSummary,
        participantContext,
      });
      return [
        targetLanguage,
        {
          text: translated.text || text,
          failed: false,
        },
        translated.model,
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
    translations: Object.fromEntries([...successfulEntries, ...failedEntries].map((entry) => [entry[0], entry[1]])),
    model: [...new Set(successfulEntries.map((entry) => entry[2]).filter(Boolean))].join(", ") || OPENAI_MODEL,
  };
}

async function requestSingleOpenAITranslation({ text, sourceLanguage, detectedLanguages = null, targetLanguage, translationConcept = DEFAULT_TRANSLATION_CONCEPT, contextSummary = "", participantContext = null }) {
  const modelCandidates = buildTranslationModelCandidates({
    sourceLanguage,
    targetLanguage,
    detectedLanguages,
    translationConcept,
    contextSummary,
  });
  const cacheKey = JSON.stringify({
    models: modelCandidates,
    reasoningEffort: OPENAI_TRANSLATION_REASONING_EFFORT,
    sourceLanguage,
    detectedLanguages,
    targetLanguage,
    translationConcept,
    contextSummary,
    participantContext,
    text,
  });
  const cached = translationCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const useChunkedTranslation = shouldUseChunkedTranslation(text);
  let lastError = null;
  for (const modelName of modelCandidates) {
    try {
      const outputText = useChunkedTranslation
        ? await requestChunkedOpenAITranslationFromModel({
            modelName,
            text,
            sourceLanguage,
            targetLanguage,
            detectedLanguages,
            translationConcept,
            contextSummary,
            participantContext,
          })
        : await requestSingleOpenAITranslationFromModel({
            modelName,
            text,
            sourceLanguage,
            targetLanguage,
            detectedLanguages,
            translationConcept,
            contextSummary,
            participantContext,
          });

      if (shouldTryFallbackTranslationModel({ modelName, modelCandidates, sourceLanguage, targetLanguage, text, outputText })) {
        lastError = new Error("translation_fallback_requested");
        continue;
      }

      const translated = {
        text: outputText,
        model: modelName,
      };
      translationCache.set(cacheKey, translated);
      return translated;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("translation_request_failed");
}

function shouldUseChunkedTranslation(text) {
  const normalized = String(text || "").trim();
  if (!normalized) return false;
  const sentenceCount = countSentenceLikeBreaks(normalized);
  const paragraphCount = countParagraphs(normalized);
  return (
    normalized.length >= 260 ||
    sentenceCount >= 5 ||
    paragraphCount >= 2
  );
}

async function requestChunkedOpenAITranslationFromModel({
  modelName,
  text,
  sourceLanguage,
  targetLanguage,
  detectedLanguages = null,
  translationConcept = DEFAULT_TRANSLATION_CONCEPT,
  contextSummary = "",
  participantContext = null,
}) {
  const chunks = splitTranslationTextIntoChunks(text);
  if (chunks.length <= 1) {
    return requestSingleOpenAITranslationFromModel({
      modelName,
      text,
      sourceLanguage,
      targetLanguage,
      detectedLanguages,
      translationConcept,
      contextSummary,
      participantContext,
    });
  }

  console.info("[translate] chunking long translation", {
    modelName,
    sourceLanguage,
    targetLanguage,
    sourceLength: String(text || "").length,
    chunkCount: chunks.length,
  });

  const translatedChunks = await Promise.all(
    chunks.map((chunk) =>
      requestSingleOpenAITranslationFromModel({
        modelName,
        text: chunk.text,
        sourceLanguage,
        targetLanguage,
        detectedLanguages,
        translationConcept,
        contextSummary,
        participantContext,
      })
    )
  );

  return joinTranslatedChunks(chunks, translatedChunks);
}

async function requestSingleOpenAITranslationFromModel({ modelName, text, sourceLanguage, targetLanguage, detectedLanguages = null, translationConcept = DEFAULT_TRANSLATION_CONCEPT, contextSummary = "", participantContext = null }) {
  let lastError = null;
  let maxOutputTokens = estimateTranslationOutputTokens(text);
  for (let attempt = 0; attempt < OPENAI_TRANSLATION_MAX_ATTEMPTS; attempt += 1) {
    try {
      const payload = {
        model: modelName,
        store: false,
        reasoning: {
          effort: OPENAI_TRANSLATION_REASONING_EFFORT,
        },
        max_output_tokens: maxOutputTokens,
        // Policy note: realtime translation sends message text to the configured OpenAI API endpoint only while live translation is enabled.
        input: buildTranslationPrompt({
          text,
          sourceLanguage,
          detectedLanguages,
          targetLanguage,
          translationConcept,
          contextSummary,
          participantContext,
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
        const requestError = new Error(`OpenAI API error ${response.status}: ${errorText}`);
        if (shouldRetryTranslationResponse(response.status) && attempt < OPENAI_TRANSLATION_MAX_ATTEMPTS - 1) {
          await delayTranslationRetry(attempt);
          lastError = requestError;
          continue;
        }
        throw requestError;
      }

      const data = await response.json();
      if (isTranslationResponseIncomplete(data)) {
        const incompleteReason = String(
          data?.incomplete_details?.reason || "response_incomplete",
        ).trim();
        const canExpandBudget = maxOutputTokens < 8192;
        if (canExpandBudget) {
          maxOutputTokens = Math.min(
            8192,
            Math.max(maxOutputTokens + 512, Math.ceil(maxOutputTokens * 1.8)),
          );
          lastError = new Error(
            `translation_incomplete:${incompleteReason}`,
          );
          console.warn("[translate] incomplete response; retrying", {
            modelName,
            sourceLanguage,
            targetLanguage,
            attempt: attempt + 1,
            nextMaxOutputTokens: maxOutputTokens,
            incompleteReason,
            length: String(text || "").length,
          });
          continue;
        }
      }
      let extractedText = "";
      try {
        extractedText = extractResponseText(data);
      } catch (error) {
        lastError = error;
        if (
          attempt < OPENAI_TRANSLATION_MAX_ATTEMPTS - 1 &&
          shouldRetryTranslationError(error)
        ) {
          maxOutputTokens = Math.min(
            8192,
            Math.max(maxOutputTokens + 512, Math.ceil(maxOutputTokens * 1.45)),
          );
          console.warn("[translate] empty text output; retrying", {
            modelName,
            sourceLanguage,
            targetLanguage,
            attempt: attempt + 1,
            nextMaxOutputTokens: maxOutputTokens,
            length: String(text || "").length,
          });
          await delayTranslationRetry(attempt);
          continue;
        }
        throw error;
      }

      if (
        shouldRetrySuspiciousTranslationCompletion({
          originalText: text,
          translatedText: extractedText,
        }) &&
        attempt < OPENAI_TRANSLATION_MAX_ATTEMPTS - 1
      ) {
        maxOutputTokens = Math.min(
          8192,
          Math.max(maxOutputTokens + 512, Math.ceil(maxOutputTokens * 1.45)),
        );
        lastError = new Error("translation_output_suspiciously_incomplete");
        console.warn("[translate] suspiciously short/incomplete output; retrying", {
          modelName,
          sourceLanguage,
          targetLanguage,
          attempt: attempt + 1,
          nextMaxOutputTokens: maxOutputTokens,
          sourceLength: String(text || "").length,
          outputLength: String(extractedText || "").length,
        });
        await delayTranslationRetry(attempt);
        continue;
      }

      return normalizeTranslatedText(extractedText, text, {
        sourceLanguage,
        targetLanguage,
        detectedLanguages,
      });
    } catch (error) {
      lastError = error;
      if (attempt >= OPENAI_TRANSLATION_MAX_ATTEMPTS - 1 || !shouldRetryTranslationError(error)) {
        break;
      }
      await delayTranslationRetry(attempt);
    }
  }

  throw lastError || new Error("translation_request_failed");
}

function buildTranslationModelCandidates({ sourceLanguage, targetLanguage, detectedLanguages = null, translationConcept = DEFAULT_TRANSLATION_CONCEPT, contextSummary = "" }) {
  const candidates = [OPENAI_MODEL];
  if (
    OPENAI_TRANSLATION_FALLBACK_MODEL &&
    OPENAI_TRANSLATION_CONTEXTUAL_FALLBACK &&
    shouldUseContextualTranslationFallback({ sourceLanguage, targetLanguage, detectedLanguages, translationConcept, contextSummary })
  ) {
    candidates.push(OPENAI_TRANSLATION_FALLBACK_MODEL);
  }
  return [...new Set(candidates.filter(Boolean))];
}

function shouldUseContextualTranslationFallback({ sourceLanguage, targetLanguage, detectedLanguages = null, translationConcept = DEFAULT_TRANSLATION_CONCEPT, contextSummary = "" }) {
  const normalizedConcept = normalizeTranslationConcept(translationConcept);
  const normalizedDetectedLanguages = [...new Set(
    (Array.isArray(detectedLanguages) ? detectedLanguages : [sourceLanguage])
      .map((language) => String(language || "").trim())
      .filter((language) => ALLOWED_LANGUAGES.has(language))
  )];
  const mixedLanguageInput = normalizedDetectedLanguages.length > 1;
  const nuancedMode = ["office", "friend", "lover"].includes(normalizedConcept);
  const crossLanguagePair = sourceLanguage !== targetLanguage;
  return Boolean(contextSummary || mixedLanguageInput || (crossLanguagePair && nuancedMode));
}

function shouldTryFallbackTranslationModel({ modelName, modelCandidates = [], sourceLanguage, targetLanguage, text, outputText }) {
  const hasAnotherModel = modelCandidates.indexOf(modelName) < modelCandidates.length - 1;
  if (!hasAnotherModel) return false;
  if (sourceLanguage === targetLanguage) return false;
  const normalizedSource = String(text || "").trim();
  const normalizedOutput = String(outputText || "").trim();
  return Boolean(normalizedSource) && Boolean(normalizedOutput) && normalizedSource === normalizedOutput;
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
  if (message.includes("no text output returned from responses api")) return true;
  if (message.includes("translation_output_suspiciously_incomplete")) return true;
  if (message.includes("translation_incomplete:")) return true;
  if (message.includes("openai api error")) {
    const match = message.match(/openai api error (\d+)/);
    return shouldRetryTranslationResponse(match?.[1]);
  }
  return ["fetch failed", "network", "timeout", "socket", "econnreset", "ecanceled", "terminated"].some((keyword) => message.includes(keyword));
}

async function delayTranslationRetry(attempt) {
  const waitMs = OPENAI_TRANSLATION_RETRY_BASE_DELAY_MS * (attempt + 1);
  await new Promise((resolve) => setTimeout(resolve, waitMs));
}

function normalizeParticipantContext(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const speaker = normalizeParticipantProfile(
    value.speaker || value.sender,
  );
  const recipient = normalizeParticipantProfile(
    value.recipient || value.viewer,
  );
  if (!speaker && !recipient) {
    return null;
  }

  return {
    ...(speaker ? { speaker } : {}),
    ...(recipient ? { recipient } : {}),
  };
}

function normalizeParticipantProfile(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const nativeLanguage = ALLOWED_LANGUAGES.has(
    String(value.nativeLanguage || "").trim(),
  )
    ? String(value.nativeLanguage || "").trim()
    : "";
  const gender = String(value.gender || "").trim().slice(0, 24);
  const rawAge = Number(value.age);
  const age = Number.isFinite(rawAge) && rawAge > 0
    ? Math.max(1, Math.min(120, Math.round(rawAge)))
    : null;
  const ageGroup = String(value.ageGroup || "").trim().slice(0, 24);

  if (!nativeLanguage && !gender && age == null && !ageGroup) {
    return null;
  }

  return {
    ...(nativeLanguage ? { nativeLanguage } : {}),
    ...(gender ? { gender } : {}),
    ...(age != null ? { age } : {}),
    ...(ageGroup ? { ageGroup } : {}),
  };
}

function buildParticipantContextPrompt(participantContext) {
  if (!participantContext) {
    return [];
  }

  const lines = [];
  const speakerLine = describeParticipantProfileHint(
    "Speaker profile hint",
    participantContext.speaker,
  );
  const recipientLine = describeParticipantProfileHint(
    "Recipient profile hint",
    participantContext.recipient,
  );

  if (speakerLine || recipientLine) {
    lines.push(
      "Participant profile hints (soft hints only; use them only when the source is ambiguous):",
    );
  }
  if (speakerLine) {
    lines.push(speakerLine);
  }
  if (recipientLine) {
    lines.push(recipientLine);
  }
  return lines;
}

function describeParticipantProfileHint(label, profile) {
  if (!profile || typeof profile !== "object") {
    return "";
  }

  const details = [];
  if (profile.nativeLanguage) {
    details.push(`native language ${describeLanguage(profile.nativeLanguage)}`);
  }
  if (profile.gender) {
    details.push(`gender ${String(profile.gender)}`);
  }
  if (profile.age != null) {
    details.push(`age ${profile.age}`);
  } else if (profile.ageGroup) {
    details.push(`age group ${String(profile.ageGroup)}`);
  }

  if (!details.length) {
    return "";
  }

  return `- ${label}: ${details.join(", ")}.`;
}

function buildTranslationPrompt({ text, sourceLanguage, detectedLanguages = null, targetLanguage, translationConcept = DEFAULT_TRANSLATION_CONCEPT, contextSummary = "", participantContext = null }) {
  return buildRecipientTranslationPrompt({ text, sourceLanguage, detectedLanguages, targetLanguage, translationConcept, contextSummary, participantContext });

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
    "- Translate the entire message from start to finish. Never stop early, even if the source is long.",
    "- Do not omit names, vocatives, calling expressions, or emotional emphasis.",
    "- Ignore leading meta labels such as '번역본:', '원문:', 'reference:', or 'translation:' when deciding meaning; they are metadata, not the main sentence content.",
    "- Keep emphasis such as '꼭', '항상', '정말', '많이', and '절대' whenever the target language can express it naturally.",
    "- Keep sentence structure as close to the original as possible, but allow minimal restructuring when natural subject omission or pronoun choice in the target language requires it.",
    "- Preserve romantic, caring, reassuring tone exactly.",
    "- Do not paraphrase, summarize, soften, or rewrite creatively.",
    "- Fidelity is more important than stylistic freedom.",
    "- Do not invent unstated quantities, containers, objects, or reasons. If the source stays unspecific, keep the translation equally unspecific.",
    "- Preserve URLs, emojis, @mentions, hashtags, punctuation, and line breaks.",
    "- Preserve every paragraph and sentence. Do not summarize or compress long passages.",
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

function buildRecipientTranslationPrompt({ text, sourceLanguage, detectedLanguages = null, targetLanguage, translationConcept = DEFAULT_TRANSLATION_CONCEPT, contextSummary = "", participantContext = null }) {
  const normalizedConcept = normalizeTranslationConcept(translationConcept);
  const normalizedDetectedLanguages = [...new Set(
    (Array.isArray(detectedLanguages) ? detectedLanguages : [sourceLanguage])
      .map((language) => String(language || "").trim())
      .filter((language) => ALLOWED_LANGUAGES.has(language))
  )];
  const mixedLanguageRequest = normalizedDetectedLanguages.length > 1;
  const romanticDirectionHint =
    normalizedConcept === "lover"
      ? "Default relationship context: private romantic partners. Use it only to preserve accurate warmth, role consistency, and nuance. Do not inject extra romance that the source does not support."
      : "";
  const pairSpecificRules = buildPairSpecificTranslationRules(sourceLanguage, targetLanguage, normalizedConcept, normalizedDetectedLanguages);
  const participantContextLines = buildParticipantContextPrompt(participantContext);

  return [
    "You are the final recipient-facing translator for a multilingual private chat app.",
    mixedLanguageRequest && sourceLanguage === targetLanguage
      ? `Rewrite the mixed-language message into one natural ${describeLanguage(targetLanguage)} chat message.`
      : `Translate the message from ${describeLanguage(sourceLanguage)} into natural ${describeLanguage(targetLanguage)} for the recipient.`,
    "",
    "Priority order:",
    "1. Preserve the speaker's intent, factual meaning, and emotional force.",
    "2. Make the result sound like something a native speaker would naturally text or say in the target language.",
    "3. Preserve wording details, emphasis, and relationship nuance whenever the target language can carry them naturally.",
    "",
    "Requirements:",
    "- Translate for the recipient, not as a literal gloss or teaching example.",
    "- If a literal rendering sounds translated, awkward, or over-explained, rewrite it into the closest idiomatic target-language expression with the same meaning, tone, and interpersonal nuance.",
    "- Translate the complete source message from beginning to end. Never stop partway through a long message.",
    "- Preserve names, vocatives, calling expressions, emotional emphasis, and intensity markers whenever the target language can express them naturally.",
    "- Ignore leading meta labels such as 'translation:', 'translated:', 'reference:', or 'original:' when deciding meaning; they are metadata, not the main sentence content.",
    "- Do not omit or flatten affection, apology, teasing, comfort, hesitation, frustration, urgency, or reassurance.",
    "- Do not invent unstated facts, quantities, containers, objects, motives, or reasons. If the source stays unspecific, keep the translation equally unspecific.",
    "- Preserve URLs, emojis, @mentions, hashtags, punctuation, and line breaks.",
    "- Preserve every paragraph and every sentence. Do not summarize, compress, or drop later paragraphs.",
    "- If the source leaves the subject, object, or relationship term implicit, preserve that natural implicitness whenever the target language allows it.",
    "- Do not force explicit pronouns, kinship terms, or partner-role wording when the target language sounds more natural without them.",
    "- Use participant profile hints only as soft guidance for honorific level, kinship pronouns, vocatives, and ambiguous subject/object resolution.",
    "- If profile hints are missing or uncertain, prefer neutral and natural wording instead of overcommitting to a wrong role term.",
    "- Never expose or mention age or gender details unless the original message itself explicitly says them.",
    "- Use the context summary only to keep names, speaker/addressee roles, relationship tone, and honorific level consistent. Never let the summary override the actual message content.",
    "- If the context summary gives a stable role term or pronoun with medium/high confidence, prefer it before re-guessing. If confidence is low, prefer neutral wording over forcing a wrong kinship term.",
    "- Analyze the full intended meaning first, then write one clean final message in the target language.",
    mixedLanguageRequest
      ? `- The source message contains mixed-language fragments (${normalizedDetectedLanguages.map((language) => describeLanguage(language)).join(", ")}). Understand every fragment first, then translate or normalize all of them into ${describeLanguage(targetLanguage)}; do not leave stray foreign wording just because the dominant language already matches the target.`
      : "",
    ...pairSpecificRules,
    `- Target tone profile: ${describeTranslationConcept(normalizedConcept)}.`,
    romanticDirectionHint ? `- ${romanticDirectionHint}` : "",
    ...participantContextLines,
    contextSummary ? "Context summary (reference only for stable roles, names, relationship tone, and honorific consistency):" : "",
    contextSummary || "",
    "",
    "Return only the final translated message, including all paragraphs from the source.",
    "No explanations, notes, labels, or alternatives.",
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

function normalizeTranslationModelName(value) {
  return String(value || "").trim();
}

function isEnabledEnv(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function normalizeTranslationReasoningEffort(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ["none", "minimal", "low", "medium", "high", "xhigh"].includes(normalized) ? normalized : "low";
}

function describeTranslationConcept(concept) {
  return (
    {
      office: "professional, precise, and natural for real workplace chat without dropping any source nuance",
      general: "natural everyday conversation that stays fully faithful to the source meaning and intent",
      friend: "casual, friendly, and natural while preserving the actual content, subtext, and emotional force",
      lover: "warm, affectionate partner language that feels natural in private chat without adding romance that is not in the source",
    }[normalizeTranslationConcept(concept)] || "warm, affectionate partner language that feels natural in private chat without adding romance that is not in the source"
  );
}

function splitTranslationTextIntoChunks(text, options = {}) {
  const normalized = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  if (!paragraphs.length) {
    return [];
  }

  const chunks = [];
  paragraphs.forEach((paragraph, paragraphIndex) => {
    const paragraphChunks = splitParagraphForTranslation(paragraph, options);
    paragraphChunks.forEach((chunkText, chunkIndex) => {
      chunks.push({
        text: chunkText,
        joiner:
          chunks.length === 0
            ? ""
            : chunkIndex === 0 && paragraphIndex > 0
              ? "\n\n"
              : " ",
      });
    });
  });

  return chunks;
}

function splitParagraphForTranslation(paragraph, { targetChars = 220, maxChars = 320 } = {}) {
  const normalized = String(paragraph || "").trim();
  if (!normalized) return [];

  const units = splitParagraphIntoSentenceLikeUnits(normalized);
  if (!units.length) {
    return sliceTextByWordBoundaries(normalized, maxChars);
  }

  const chunks = [];
  let currentChunk = "";
  for (const unit of units) {
    if (!unit) continue;
    if (unit.length > maxChars) {
      if (currentChunk) {
        chunks.push(currentChunk);
        currentChunk = "";
      }
      chunks.push(...sliceTextByWordBoundaries(unit, maxChars));
      continue;
    }

    const candidate = currentChunk ? `${currentChunk} ${unit}` : unit;
    if (candidate.length <= targetChars || !currentChunk) {
      currentChunk = candidate;
      continue;
    }

    chunks.push(currentChunk);
    currentChunk = unit;
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks;
}

function splitParagraphIntoSentenceLikeUnits(paragraph) {
  const normalized = String(paragraph || "").replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const rawUnits = normalized
    .split(/(?<=[.!?。！？])\s+|\n+/u)
    .map((unit) => unit.trim())
    .filter(Boolean);

  if (rawUnits.length) {
    return rawUnits;
  }

  return [normalized];
}

function sliceTextByWordBoundaries(text, maxChars = 320) {
  const normalized = String(text || "").trim();
  if (!normalized) return [];
  if (normalized.length <= maxChars) return [normalized];

  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length <= 1) {
    const slices = [];
    for (let index = 0; index < normalized.length; index += maxChars) {
      slices.push(normalized.slice(index, index + maxChars).trim());
    }
    return slices.filter(Boolean);
  }

  const chunks = [];
  let currentChunk = "";
  for (const word of words) {
    if (word.length > maxChars) {
      if (currentChunk) {
        chunks.push(currentChunk);
        currentChunk = "";
      }
      chunks.push(...sliceTextByWordBoundaries(word, maxChars));
      continue;
    }

    const candidate = currentChunk ? `${currentChunk} ${word}` : word;
    if (candidate.length <= maxChars || !currentChunk) {
      currentChunk = candidate;
      continue;
    }

    chunks.push(currentChunk);
    currentChunk = word;
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks;
}

function joinTranslatedChunks(chunks, translatedChunks) {
  return translatedChunks
    .map((translatedChunk, index) => `${chunks[index]?.joiner || ""}${String(translatedChunk || "").trim()}`)
    .join("")
    .trim();
}

function sanitizeVocabularyKnownTerms(value) {
  const rawTerms = Array.isArray(value)
    ? value
    : String(value || "")
        .split(",")
        .map((item) => item.trim());
  const seen = new Set();
  const terms = [];
  for (const rawTerm of rawTerms) {
    const term = normalizeVocabularyTerm(rawTerm);
    const key = term.toLowerCase();
    if (term.length < 2 || seen.has(key)) {
      continue;
    }
    seen.add(key);
    terms.push(term);
    if (terms.length >= 80) {
      break;
    }
  }
  return terms;
}

async function requestVocabularyExtraction({ text, meaningLanguage, maxCards, knownTerms = [] }) {
  let lastError = null;
  let maxOutputTokens = Math.min(12000, Math.max(3200, maxCards * 220));
  for (let attempt = 0; attempt < OPENAI_TRANSLATION_MAX_ATTEMPTS; attempt += 1) {
    try {
      const payload = {
        model: OPENAI_MODEL,
        store: false,
        reasoning: {
          effort: OPENAI_TRANSLATION_REASONING_EFFORT,
        },
        max_output_tokens: maxOutputTokens,
        input: buildVocabularyExtractionPrompt({
          text,
          meaningLanguage,
          maxCards,
          knownTerms,
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
        const detail = await response.text().catch(() => "");
        const requestError = new Error(`Vocabulary API error ${response.status}: ${detail.slice(0, 360)}`);
        if (shouldRetryTranslationResponse(response.status) && attempt < OPENAI_TRANSLATION_MAX_ATTEMPTS - 1) {
          lastError = requestError;
          await delayTranslationRetry(attempt);
          continue;
        }
        throw requestError;
      }

      const data = await response.json();
      if (isTranslationResponseIncomplete(data) && attempt < OPENAI_TRANSLATION_MAX_ATTEMPTS - 1) {
        const incompleteReason = String(data?.incomplete_details?.reason || "response_incomplete").trim();
        maxOutputTokens = Math.min(16000, Math.max(maxOutputTokens + 1024, Math.ceil(maxOutputTokens * 1.6)));
        lastError = new Error(`vocabulary_incomplete:${incompleteReason}`);
        console.warn("[vocabulary] incomplete response; retrying", {
          attempt: attempt + 1,
          nextMaxOutputTokens: maxOutputTokens,
          incompleteReason,
          length: String(text || "").length,
        });
        continue;
      }

      const outputText = extractResponseText(data);
      const parsed = parseJsonObjectFromModelText(outputText);
      const cards = sanitizeVocabularyCards(parsed?.cards, {
        sourceText: text,
        maxCards,
      });
      if (cards.length) {
        return cards;
      }
      throw new Error("Vocabulary response did not contain usable cards.");
    } catch (error) {
      lastError = error;
      if (attempt >= OPENAI_TRANSLATION_MAX_ATTEMPTS - 1 || !shouldRetryVocabularyError(error)) {
        break;
      }
      maxOutputTokens = Math.min(16000, Math.max(maxOutputTokens + 1024, Math.ceil(maxOutputTokens * 1.35)));
      await delayTranslationRetry(attempt);
    }
  }

  throw lastError || new Error("vocabulary_extract_failed");
}

function buildVocabularyExtractionPrompt({ text, meaningLanguage, maxCards, knownTerms = [] }) {
  const knownTermBlock = knownTerms.length
    ? [
        "",
        "Already saved study terms on this device. Do not return these again unless the same surface form is clearly used with a different part of speech in this message:",
        knownTerms.join(", "),
      ]
    : [];
  return [
    "You create compact vocabulary flashcards from a private chat message.",
    `Return up to ${maxCards} useful study words.`,
    "For long messages, continue until all useful eligible terms are covered or the maxCards limit is reached.",
    `Write meanings and dictionary explanations in ${describeLanguage(meaningLanguage)}.`,
    "",
    "Part-of-speech choices are exactly: noun, verb, adjective, adverb.",
    "Cover as many eligible nouns, verbs, adjectives, and adverbs from the message as possible, especially for short stories or study text.",
    "Prefer content words that help a language learner understand the message.",
    "Exclude names, particles, pronouns, filler sounds, URLs, and duplicate variants.",
    "Analysis order is important:",
    "1. Detect the message language and candidate study terms from the original text.",
    "2. Decide each term's part of speech from its role in the original sentence context, not from spelling or translation alone.",
    "3. Then write meanings, dictionaryMeaning, and example for the learner.",
    "For inflected words, keep the term surface exactly as it appears in the message, but classify it by the lexical role used in context.",
    "For each card, provide:",
    "- term: the word or short expression exactly as it appears, without punctuation",
    "- partOfSpeech: one of noun, verb, adjective, adverb",
    "- meanings: one to three representative meanings",
    "- dictionaryMeaning: one short dictionary-style explanation",
    "- example: one short example sentence or phrase using the term",
    "",
    "Return strict JSON only with this schema:",
    '{"cards":[{"term":"...","partOfSpeech":"noun","meanings":["..."],"dictionaryMeaning":"...","example":"..."}]}',
    ...knownTermBlock,
    "",
    "Message:",
    text,
  ].join("\n");
}

function parseJsonObjectFromModelText(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed);
  } catch (_) {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return {};
    try {
      return JSON.parse(match[0]);
    } catch {
      return {};
    }
  }
}

function shouldRetryVocabularyError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return (
    shouldRetryTranslationError(error) ||
    message.includes("no text output returned") ||
    message.includes("did not contain usable cards") ||
    message.includes("unexpected end of json") ||
    message.includes("vocabulary_incomplete")
  );
}

function sanitizeVocabularyCards(cards, { sourceText, maxCards }) {
  if (!Array.isArray(cards)) {
    return [];
  }

  const seen = new Set();
  return cards
    .map((card) => sanitizeVocabularyCard(card, sourceText))
    .filter(Boolean)
    .filter((card) => {
      const key = `${card.term.toLowerCase()}|${card.partOfSpeech}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, maxCards);
}

function sanitizeVocabularyCard(card, sourceText) {
  if (!(card && typeof card === "object")) {
    return null;
  }

  const term = normalizeVocabularyTerm(card?.term);
  if (!term) {
    return null;
  }

  const partOfSpeech = normalizeVocabularyPartOfSpeech(card?.partOfSpeech);
  const meanings = Array.isArray(card?.meanings)
    ? card.meanings.map((item) => normalizeDisplayText(item).trim()).filter(Boolean).slice(0, 3)
    : [];
  const dictionaryMeaning = normalizeDisplayText(card?.dictionaryMeaning || meanings.join(", ")).trim();
  const example = normalizeDisplayText(card?.example || buildVocabularyExampleFallback(sourceText, term)).trim();

  return {
    term,
    partOfSpeech,
    meanings: meanings.length ? meanings : [dictionaryMeaning || term],
    dictionaryMeaning: dictionaryMeaning || meanings.join(", ") || term,
    example,
  };
}

function normalizeVocabularyPartOfSpeech(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[\s_-]+/g, "");
  if (["noun", "n", "명사", "danhtu"].includes(normalized)) {
    return "noun";
  }
  if (["verb", "v", "동사", "dongtu"].includes(normalized)) {
    return "verb";
  }
  if (
    [
      "adjective",
      "adj",
      "a",
      "형용사",
      "tinhtu",
    ].includes(normalized)
  ) {
    return "adjective";
  }
  if (["adverb", "adv", "부사", "photu"].includes(normalized)) {
    return "adverb";
  }
  return "noun";
}

function normalizeVocabularyTerm(value) {
  return normalizeDisplayText(value || "")
    .replace(/^[\s"'“”‘’.,!?;:()[\]{}<>]+|[\s"'“”‘’.,!?;:()[\]{}<>]+$/g, "")
    .trim()
    .slice(0, 60);
}

function buildVocabularyExampleFallback(sourceText, term) {
  const normalizedTerm = String(term || "").toLowerCase();
  const sentences = String(sourceText || "")
    .split(/(?<=[.!?。！？])\s+|\n+/u)
    .map((item) => item.trim())
    .filter(Boolean);
  return (
    sentences.find((sentence) => sentence.toLowerCase().includes(normalizedTerm)) ||
    String(sourceText || "").trim().slice(0, 120)
  );
}

function estimateTranslationOutputTokens(text) {
  const normalized = String(text || "");
  const cjkCount = countMatches(normalized, /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/g);
  const latinCount = countMatches(normalized, /[A-Za-zÀ-ỹ]/g);
  const otherCount = Math.max(0, normalized.length - cjkCount - latinCount);
  const approximateInputTokens = Math.max(
    32,
    Math.ceil(cjkCount / 1.45) +
      Math.ceil(latinCount / 3.1) +
      Math.ceil(otherCount / 2.2),
  );
  const estimatedOutput = Math.ceil(approximateInputTokens * 3.2 + 220);
  return Math.min(8192, Math.max(320, estimatedOutput));
}

function isTranslationResponseIncomplete(data) {
  return (
    String(data?.status || "").trim().toLowerCase() === "incomplete" ||
    Boolean(data?.incomplete_details?.reason)
  );
}

function describeLanguage(code) {
  return (
    {
      ko: "Korean",
      en: "English",
      vi: "Vietnamese",
      ja: "Japanese",
      zh: "Chinese",
      fil: "Filipino",
      ms: "Malay",
      ru: "Russian",
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

function shouldRetrySuspiciousTranslationCompletion({
  originalText,
  translatedText,
}) {
  const source = String(originalText || "").trim();
  const output = String(translatedText || "").trim();
  if (!source || !output) return false;

  const sourceSentenceCount = countSentenceLikeBreaks(source);
  const outputSentenceCount = countSentenceLikeBreaks(output);
  const sourceParagraphCount = countParagraphs(source);
  const outputParagraphCount = countParagraphs(output);
  const sourceLooksLong =
    source.length >= 180 || sourceSentenceCount >= 3 || sourceParagraphCount >= 2;
  if (!sourceLooksLong) {
    return false;
  }

  const sourceEndsWithTerminalPunctuation = endsWithSentenceTerminal(source);
  const outputEndsWithTerminalPunctuation = endsWithSentenceTerminal(output);
  const abruptEnding =
    sourceEndsWithTerminalPunctuation &&
    !outputEndsWithTerminalPunctuation &&
    /[\p{L}\p{M}\p{N}]$/u.test(output);
  const missingParagraphs =
    sourceParagraphCount >= 2 && outputParagraphCount < sourceParagraphCount;
  const sentenceGap =
    sourceSentenceCount >= 3 && outputSentenceCount + 1 < sourceSentenceCount;
  const majorSentenceDrop =
    sourceSentenceCount >= 5 && outputSentenceCount < Math.ceil(sourceSentenceCount * 0.6);
  const majorLengthDrop =
    source.length >= 260 && output.length < Math.ceil(source.length * 0.45);

  return abruptEnding || missingParagraphs || sentenceGap || majorSentenceDrop || majorLengthDrop;
}

function countSentenceLikeBreaks(value) {
  const text = String(value || "").trim();
  if (!text) return 0;
  return countMatches(text, /[.!?。！？]+(?:["'”’)\]]+)?|\n{2,}/g);
}

function countParagraphs(value) {
  return String(value || "")
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean).length;
}

function endsWithSentenceTerminal(value) {
  return /[.!?。！？](?:["'”’)\]]+)?\s*$/u.test(String(value || "").trim());
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
  if (!isPushUserMessageKind(message.kind)) {
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
      loginState:
        user?.loginState === "online" ||
        user?.presenceStatus === "online" ||
        user?.presenceStatus === "inRoom" ||
        (typeof user?.currentRoomId === "string" && user.currentRoomId.trim())
          ? "online"
          : "offline",
      presenceStatus:
        typeof user?.presenceStatus === "string" && user.presenceStatus.trim()
          ? user.presenceStatus.trim()
          : (typeof user?.currentRoomId === "string" && user.currentRoomId.trim())
            ? "inRoom"
            : "offline",
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
        mutedByUserId: filterRecordByAllowedKeys(room.mutedByUserId || room.mutedByUser, userIds),
        messages: (room.messages || []).map((message) => sanitizeMessageState(message, userIds)),
      };
    });
  const roomIds = new Set(rooms.map((room) => room.id));

  return {
    ...state,
    version: STATE_SCHEMA_VERSION,
    deletedUsers,
    deletedRooms,
    pushDispatchedMessageIds: sanitizePushDispatchedMessageIds(state.pushDispatchedMessageIds),
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
  return room?.status === "expired" && !(room?.messages || []).some((message) => isPushUserMessageKind(message.kind));
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
  const roomParticipantIds = Array.isArray(room?.participants)
    ? room.participants
    : Array.isArray(room?.participantIds)
      ? room.participantIds
      : [];
  const participantIds = new Set(roomParticipantIds.filter((participantId) => userIds.has(participantId)));
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

function sanitizePushDispatchedMessageIds(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set();
  const ids = [];
  value.forEach((rawId) => {
    const id = typeof rawId === "string" ? rawId.trim() : "";
    if (!id || seen.has(id)) {
      return;
    }
    seen.add(id);
    ids.push(id);
  });
  return ids.slice(-5000);
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

function sendApiSuccess(res, statusCode, payload = {}) {
  return sendJson(res, statusCode, {
    success: true,
    ...payload,
  });
}

function sendApiError(res, statusCode, code, message, extra = {}) {
  return sendJson(res, statusCode, {
    error: message,
    code,
    message,
    ...extra,
  });
}

function sendPlainText(res, statusCode, body) {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
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

function buildDiscoverableMongoUsersQuery() {
  return {
    $and: [
      {
        $or: [
          { isAdmin: { $exists: false } },
          { isAdmin: false },
        ],
      },
      {
        $or: [
          { loginId: { $exists: false } },
          { loginId: { $ne: "admin" } },
        ],
      },
      {
        $or: [
          { deletedAt: { $exists: false } },
          { deletedAt: null },
          { deletedAt: 0 },
        ],
      },
      {
        $or: [
          { withdrawnAt: { $exists: false } },
          { withdrawnAt: null },
          { withdrawnAt: 0 },
        ],
      },
      {
        $or: [
          { isDeleted: { $exists: false } },
          { isDeleted: false },
        ],
      },
      {
        $or: [
          { status: { $exists: false } },
          { status: { $nin: ["deleted", "withdrawn", "inactive"] } },
        ],
      },
    ],
  };
}

function buildActiveMongoUserByLoginIdQuery(loginId) {
  return {
    $and: [
      { loginId },
      {
        $or: [
          { isDeleted: { $exists: false } },
          { isDeleted: false },
        ],
      },
      {
        $or: [
          { status: { $exists: false } },
          { status: { $nin: ["deleted", "withdrawn", "inactive"] } },
        ],
      },
    ],
  };
}

function buildActiveMongoUserLookupQuery(userIdOrLoginId) {
  return {
    $and: [
      buildMongoUserLookupQuery(userIdOrLoginId),
      {
        $or: [
          { isDeleted: { $exists: false } },
          { isDeleted: false },
        ],
      },
      {
        $or: [
          { status: { $exists: false } },
          { status: { $nin: ["deleted", "withdrawn", "inactive"] } },
        ],
      },
    ],
  };
}

function sanitizeDirectoryUserDocument(value) {
  if (!(value && typeof value === "object")) {
    return null;
  }

  const id = String(value?.id || "").trim();
  const loginId = normalizeDisplayText(value?.loginId || "").trim().toLowerCase();
  const name = normalizeDisplayText(value?.name || "").trim();
  const nickname = normalizeDisplayText(value?.nickname || "").trim();
  const nativeLanguage = ALLOWED_LANGUAGES.has(String(value?.nativeLanguage || "").trim())
    ? String(value.nativeLanguage).trim()
    : "ko";
  const uiLanguage = ALLOWED_LANGUAGES.has(String(value?.uiLanguage || "").trim())
    ? String(value.uiLanguage).trim()
    : nativeLanguage;
  const preferredChatLanguage = ALLOWED_LANGUAGES.has(String(value?.preferredChatLanguage || "").trim())
    ? String(value.preferredChatLanguage).trim()
    : nativeLanguage;
  const blockedUserIds = Array.isArray(value?.blockedUserIds)
    ? value.blockedUserIds.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const profileImage = sanitizeProfileImageSummary(value?.profileImage);
  const joinedAt = Number(value?.joinedAt || 0) || Date.now();
  const lastSeenAt = Number(value?.lastSeenAt || 0) || joinedAt;
  const deletedAt = Number(value?.deletedAt || 0) || null;
  const withdrawnAt = Number(value?.withdrawnAt || 0) || null;
  const isDeleted = Boolean(value?.isDeleted) || Boolean(deletedAt || withdrawnAt);
  const status = String(value?.status || "").trim();

  return {
    id,
    loginId,
    name,
    nickname,
    nativeLanguage,
    uiLanguage,
    preferredChatLanguage,
    profileImage,
    blockedUserIds,
    joinedAt,
    lastSeenAt,
    isAdmin: Boolean(value?.isAdmin) || loginId === "admin",
    deletedAt,
    withdrawnAt,
    isDeleted,
    status: status || (isDeleted ? "withdrawn" : "active"),
  };
}

function buildBillingPlansPayload() {
  return {
    publicTestMode: true,
    purchaseEnabled: false,
    translationLimitEnforced: false,
    usageTrackingEnabled: true,
    free: {
      planTier: "free",
      dailyTranslations: BILLING_FREE_DAILY_TRANSLATIONS,
    },
    premiumMonthly: {
      planTier: "premiumMonthly",
      monthlyPriceVatIncludedKrw: BILLING_PREMIUM_MONTHLY_PRICE_VAT_INCLUDED_KRW,
      monthlyPriceVatExcludedKrw: BILLING_PREMIUM_MONTHLY_PRICE_VAT_EXCLUDED_KRW,
      vatRate: BILLING_VAT_RATE,
      targetMarginRateExVat: BILLING_TARGET_MARGIN_RATE_EX_VAT,
      standardUnitCharacters: BILLING_STANDARD_TRANSLATION_UNIT_CHARACTERS,
      premiumDailySoftLimitUnits: BILLING_PREMIUM_DAILY_SOFT_LIMIT_UNITS,
      premiumMonthlySoftLimitUnits: BILLING_PREMIUM_MONTHLY_SOFT_LIMIT_UNITS,
      productId: BILLING_PREMIUM_PRODUCT_ID,
      marketedAsUnlimited: true,
    },
    tester: {
      testerCodeEnabled: true,
      testerAccessDays: BILLING_TESTER_ACCESS_DAYS,
    },
  };
}

function normalizeTesterCode(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidTesterCode(code) {
  return normalizeTesterCode(code) === BILLING_TESTER_CODE;
}

function createDefaultTranslationAccess(now = Date.now()) {
  return {
    planTier: "free",
    subscriptionStatus: "inactive",
    purchaseUiEnabled: true,
    purchaseEnabled: false,
    translationLimitEnforced: false,
    usageTrackingEnabled: true,
    freeDailyTranslations: BILLING_FREE_DAILY_TRANSLATIONS,
    monthlyPriceVatIncludedKrw: BILLING_PREMIUM_MONTHLY_PRICE_VAT_INCLUDED_KRW,
    monthlyPriceVatExcludedKrw: BILLING_PREMIUM_MONTHLY_PRICE_VAT_EXCLUDED_KRW,
    vatRate: BILLING_VAT_RATE,
    targetMarginRate: BILLING_TARGET_MARGIN_RATE_EX_VAT,
    standardUnitCharacters: BILLING_STANDARD_TRANSLATION_UNIT_CHARACTERS,
    premiumDailySoftLimitUnits: BILLING_PREMIUM_DAILY_SOFT_LIMIT_UNITS,
    premiumMonthlySoftLimitUnits: BILLING_PREMIUM_MONTHLY_SOFT_LIMIT_UNITS,
    dailyUsedUnits: 0,
    monthlyUsedUnits: 0,
    dailyWindowKey: "",
    monthlyWindowKey: "",
    subscriptionProductId: BILLING_PREMIUM_PRODUCT_ID,
    testerCode: "",
    testerActivatedAt: null,
    testerAccessUntil: null,
    subscriptionActivatedAt: null,
    subscriptionExpiresAt: null,
    lastStatusUpdatedAt: now,
  };
}

function activateTesterCodeTranslationAccess(currentAccess, code, now = Date.now()) {
  return sanitizeTranslationAccess({
    ...createDefaultTranslationAccess(now),
    ...sanitizeTranslationAccess(currentAccess, { now }),
    planTier: "tester",
    testerCode: normalizeTesterCode(code),
    testerActivatedAt: now,
    testerAccessUntil: now + BILLING_TESTER_ACCESS_DAYS * 24 * 60 * 60 * 1000,
    lastStatusUpdatedAt: now,
  }, { now });
}

function sanitizeTranslationAccess(value, { now = Date.now() } = {}) {
  const base = createDefaultTranslationAccess(now);
  const source = value && typeof value === "object" ? value : {};
  const testerAccessUntil = readOptionalTimestamp(source?.testerAccessUntil);
  const subscriptionExpiresAt = readOptionalTimestamp(source?.subscriptionExpiresAt);
  const testerAccessActive = testerAccessUntil != null && testerAccessUntil > now;
  const subscriptionStatus = normalizeSubscriptionStatus(source?.subscriptionStatus);
  const premiumAccessActive =
    (subscriptionStatus === "active" || subscriptionStatus === "grace") &&
    (subscriptionExpiresAt == null || subscriptionExpiresAt > now);

  return {
    ...base,
    purchaseUiEnabled: readBoolean(source?.purchaseUiEnabled, true),
    purchaseEnabled: readBoolean(source?.purchaseEnabled, false),
    translationLimitEnforced: readBoolean(
      source?.translationLimitEnforced,
      false,
    ),
    usageTrackingEnabled: readBoolean(source?.usageTrackingEnabled, true),
    freeDailyTranslations: readPositiveInteger(
      source?.freeDailyTranslations,
      base.freeDailyTranslations,
    ),
    monthlyPriceVatIncludedKrw: readPositiveInteger(
      source?.monthlyPriceVatIncludedKrw,
      base.monthlyPriceVatIncludedKrw,
    ),
    monthlyPriceVatExcludedKrw: readPositiveInteger(
      source?.monthlyPriceVatExcludedKrw,
      base.monthlyPriceVatExcludedKrw,
    ),
    vatRate: readPositiveNumber(source?.vatRate, base.vatRate),
    targetMarginRate: readPositiveNumber(
      source?.targetMarginRate,
      base.targetMarginRate,
    ),
    standardUnitCharacters: readPositiveInteger(
      source?.standardUnitCharacters,
      base.standardUnitCharacters,
    ),
    premiumDailySoftLimitUnits: readPositiveInteger(
      source?.premiumDailySoftLimitUnits,
      base.premiumDailySoftLimitUnits,
    ),
    premiumMonthlySoftLimitUnits: readPositiveInteger(
      source?.premiumMonthlySoftLimitUnits,
      base.premiumMonthlySoftLimitUnits,
    ),
    dailyUsedUnits: readPositiveInteger(source?.dailyUsedUnits, 0),
    monthlyUsedUnits: readPositiveInteger(source?.monthlyUsedUnits, 0),
    dailyWindowKey: String(source?.dailyWindowKey || "").trim(),
    monthlyWindowKey: String(source?.monthlyWindowKey || "").trim(),
    subscriptionProductId:
      String(source?.subscriptionProductId || BILLING_PREMIUM_PRODUCT_ID).trim() ||
      BILLING_PREMIUM_PRODUCT_ID,
    testerCode: String(source?.testerCode || "").trim(),
    testerActivatedAt: readOptionalTimestamp(source?.testerActivatedAt),
    testerAccessUntil,
    subscriptionActivatedAt: readOptionalTimestamp(
      source?.subscriptionActivatedAt,
    ),
    subscriptionExpiresAt,
    subscriptionStatus,
    planTier: testerAccessActive
      ? "tester"
      : premiumAccessActive
        ? "premiumMonthly"
        : "free",
    lastStatusUpdatedAt:
      readOptionalTimestamp(source?.lastStatusUpdatedAt) || now,
  };
}

function normalizeSubscriptionStatus(value) {
  const normalized = String(value || "").trim();
  return [
    "inactive",
    "pending",
    "active",
    "grace",
    "canceled",
    "expired",
  ].includes(normalized)
    ? normalized
    : "inactive";
}

function readOptionalTimestamp(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

function readPositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

function readPositiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readBoolean(value, fallback) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "off"].includes(normalized)) {
      return false;
    }
  }
  return fallback;
}

function sanitizeAuthUser(user) {
  const id = resolveMongoUserId(user);
  return {
    id,
    loginId: String(user?.loginId || "").trim(),
    name: normalizeDisplayText(user?.name || user?.loginId || "").trim(),
    nickname: normalizeDisplayText(user?.nickname || "").trim(),
    nativeLanguage: String(user?.nativeLanguage || "").trim() || "ko",
    uiLanguage: String(user?.uiLanguage || "").trim() || "ko",
    preferredChatLanguage:
      String(user?.preferredChatLanguage || "").trim() ||
      String(user?.nativeLanguage || "").trim() ||
      "ko",
    profileImage: sanitizeProfileImageSummary(user?.profileImage),
    blockedUserIds: [...normalizeBlockedUserIds(user)],
    joinedAt: Number(user?.joinedAt || 0) || Date.now(),
    lastSeenAt: Number(user?.lastSeenAt || 0) || Date.now(),
    lastLoginAt: Number(user?.lastLoginAt || 0) || null,
    currentRoomId: typeof user?.currentRoomId === "string" ? user.currentRoomId : null,
    isAdmin: Boolean(user?.isAdmin),
    translationAccess: sanitizeTranslationAccess(user?.translationAccess),
    recoveryQuestionKey: RECOVERY_QUESTION_KEYS.includes(user?.recoveryQuestionKey)
      ? user.recoveryQuestionKey
      : getDeterministicRecoveryQuestionKey(user?.name || user?.loginId),
  };
}

function createServerUserId() {
  return `user-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
}

function hashSecret(value) {
  const salt = randomBytes(16).toString("base64url");
  const derived = scryptSync(String(value || ""), salt, 64).toString("base64url");
  return `scrypt-v1$${salt}$${derived}`;
}

function verifyStoredSecret(value, stored) {
  const normalizedStored = String(stored || "").trim();
  if (!normalizedStored) {
    return false;
  }

  if (!normalizedStored.startsWith("scrypt-v1$")) {
    return normalizedStored === String(value || "");
  }

  const [, salt, digest] = normalizedStored.split("$");
  if (!salt || !digest) {
    return false;
  }

  const expected = Buffer.from(digest, "base64url");
  const actual = scryptSync(String(value || ""), salt, expected.length);
  if (expected.length != actual.length) {
    return false;
  }
  return timingSafeEqual(expected, actual);
}

function buildMongoUserLookupQuery(userId) {
  const clauses = [
    { id: userId },
    { loginId: userId },
  ];
  if (ObjectId.isValid(userId)) {
    clauses.push({ _id: new ObjectId(userId) });
  }
  return {
    $or: clauses,
  };
}

function resolveMongoUserId(user) {
  const explicitId = String(user?.id || "").trim();
  if (explicitId) {
    return explicitId;
  }
  const mongoId = user?._id;
  return mongoId == null ? "" : String(mongoId).trim();
}

function normalizeBlockedUserIds(user) {
  const source = Array.isArray(user?.blockedUserIds)
    ? user.blockedUserIds
    : Array.isArray(user?.blockedUsers)
      ? user.blockedUsers
      : [];
  return new Set(
    source
      .map((item) => String(item || "").trim())
      .filter(Boolean),
  );
}

function getActivePresenceSignal(userId) {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) {
    return null;
  }

  const signal = presenceSignals.get(normalizedUserId);
  if (!signal) {
    return null;
  }

  if (!signal.expiresAt || signal.expiresAt <= Date.now()) {
    presenceSignals.delete(normalizedUserId);
    return null;
  }

  return signal;
}

function applyPresenceSignalToUser(user) {
  const id = resolveMongoUserId(user);
  if (!id) {
    return user;
  }

  const signal = getActivePresenceSignal(id);
  const baseLastSeenAt =
    Number(user?.lastSeenAt || user?.lastLoginAt || user?.joinedAt || user?.createdAt || Date.now()) ||
    Date.now();

  if (!signal) {
    const currentRoomId =
      user?.loginState === "online" && typeof user?.currentRoomId === "string" && user.currentRoomId.trim()
        ? user.currentRoomId.trim()
        : null;
    const loginState = user?.loginState === "online" ? "online" : "offline";
    return {
      ...user,
      lastSeenAt: baseLastSeenAt,
      currentRoomId: loginState === "online" ? currentRoomId : null,
      loginState,
      presenceStatus: loginState !== "online"
        ? "offline"
        : currentRoomId
          ? "inRoom"
          : "online",
    };
  }

  const loginState = signal.loginState === "online" ? "online" : "offline";
  const currentRoomId =
    loginState === "online" && typeof signal.currentRoomId === "string" && signal.currentRoomId.trim()
      ? signal.currentRoomId.trim()
      : null;

  return {
    ...user,
    lastSeenAt: Math.max(baseLastSeenAt, Number(signal.lastSeenAt || 0) || Date.now()),
    currentRoomId,
    loginState,
    presenceStatus: loginState !== "online"
      ? "offline"
      : currentRoomId
        ? "inRoom"
        : "online",
  };
}

function buildReadableServerState(state) {
  const nextUsers = (state?.users || []).map((user) => applyPresenceSignalToUser(user));
  return {
    ...(state || {}),
    users: nextUsers,
    presences: nextUsers.map((user) => ({
      userId: user.id,
      status: user.presenceStatus || "offline",
      lastSeenAt: Number(user.lastSeenAt || Date.now()) || Date.now(),
      currentRoomId: typeof user.currentRoomId === "string" && user.currentRoomId.trim()
        ? user.currentRoomId.trim()
        : null,
      recentSeenThresholdMinutes: 60,
    })),
  };
}

function sanitizeDiscoverableUser(user) {
  const userWithPresence = applyPresenceSignalToUser(user);
  const id = resolveMongoUserId(userWithPresence);
  if (!id) {
    return null;
  }

  return {
    id,
    loginId: String(userWithPresence?.loginId || "").trim(),
    name: normalizeDisplayText(userWithPresence?.name || userWithPresence?.loginId || "").trim(),
    nickname: normalizeDisplayText(userWithPresence?.nickname || "").trim(),
    nativeLanguage: String(userWithPresence?.nativeLanguage || "").trim() || "ko",
    uiLanguage: String(userWithPresence?.uiLanguage || "").trim() || "ko",
    preferredChatLanguage:
      String(userWithPresence?.preferredChatLanguage || "").trim() ||
      String(userWithPresence?.nativeLanguage || "").trim() ||
      "ko",
    profileImage: sanitizeProfileImageSummary(userWithPresence?.profileImage),
    joinedAt: Number(userWithPresence?.joinedAt || 0) || null,
    lastSeenAt: Number(userWithPresence?.lastSeenAt || 0) || null,
    currentRoomId:
      typeof userWithPresence?.currentRoomId === "string" && userWithPresence.currentRoomId.trim()
        ? userWithPresence.currentRoomId.trim()
        : null,
    loginState: userWithPresence?.loginState === "online" ? "online" : "offline",
    presenceStatus: String(userWithPresence?.presenceStatus || "offline").trim() || "offline",
  };
}

function sanitizeProfileImageSummary(profileImage) {
  if (!(profileImage && typeof profileImage === "object")) {
    return null;
  }

  return {
    id: typeof profileImage?.id === "string" ? profileImage.id : "",
    fileName: typeof profileImage?.fileName === "string" ? profileImage.fileName : "",
    remoteUrl: typeof profileImage?.remoteUrl === "string" ? profileImage.remoteUrl : "",
    mimeType: typeof profileImage?.mimeType === "string" ? profileImage.mimeType : "",
  };
}

async function getMongoUsersCollection() {
  const client = await getMongoClient();
  return client.db(MONGODB_DB_NAME).collection(MONGODB_USERS_COLLECTION);
}

async function getMongoClient() {
  if (!MONGODB_URI) {
    throw new Error("MONGODB_URI is not configured.");
  }

  if (!mongoClientPromise) {
    const client = new MongoClient(MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
    });
    mongoClientPromise = client.connect().catch((error) => {
      mongoClientPromise = null;
      throw error;
    });
  }

  return mongoClientPromise;
}

server.listen(PORT, () => {
  console.log(`TRANSCHAT local server running at http://localhost:${PORT}`);
  console.log(
    OPENAI_API_KEY_VALID
      ? `Live translation enabled with model ${OPENAI_MODEL} (reasoning: ${OPENAI_TRANSLATION_REASONING_EFFORT}).`
      : OPENAI_API_KEY
        ? "OPENAI_API_KEY is malformed. Re-enter it in one line using ASCII characters only. Live translation is disabled."
        : "OPENAI_API_KEY is missing. Live translation is disabled until the key is configured."
  );
});
