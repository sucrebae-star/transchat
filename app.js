(function () {
  const STATE_SCHEMA_VERSION = 2;
  const STORAGE_KEY = "transchat-prototype-state-v1";
  const SESSION_USER_KEY = "transchat-active-user-v1";
  const AUTO_LOGIN_KEY = "transchat-auto-login-v1";
  const REMEMBERED_LOGIN_ID_KEY = "transchat-remembered-login-id-v1";
  const LANDING_UI_KEY = "transchat-landing-ui-v1";
  const PUSH_TOKEN_CACHE_KEY = "transchat-push-token-v1";
  const PUSH_TOKEN_USER_KEY = "transchat-push-user-v1";
  const PUSH_TOKEN_REGISTERED_AT_KEY = "transchat-push-registered-at-v1";
  const NATIVE_PUSH_INSTALL_ID_KEY = "transchat-native-push-install-id-v1";
  const NATIVE_PUSH_BOUND_USER_KEY = "transchat-native-push-bound-user-v1";
  const NATIVE_PUSH_BOUND_AT_KEY = "transchat-native-push-bound-at-v1";
  const FCM_VAPID_PUBLIC_KEY = "BB1LDIwYOl1eop_5Q8Oka2WQDXwapy-tOmDaIL0ljTtF90lOTYkONeydXEBE_u0_IJQBHx6djF2yftZvhqpz2Ws";
  const KNOWN_LOCAL_STORAGE_KEYS = new Set([STORAGE_KEY, AUTO_LOGIN_KEY, REMEMBERED_LOGIN_ID_KEY, LANDING_UI_KEY, PUSH_TOKEN_CACHE_KEY, PUSH_TOKEN_USER_KEY, PUSH_TOKEN_REGISTERED_AT_KEY, NATIVE_PUSH_INSTALL_ID_KEY, NATIVE_PUSH_BOUND_USER_KEY, NATIVE_PUSH_BOUND_AT_KEY]);
  const CONFIG = {
    roomAutoExpirationEnabled: false,
    roomExpireMs: 30 * 60 * 1000,
    passwordAttemptLimit: 5,
    passwordLockMs: 90 * 1000,
    mediaExpireHours: 24,
    imageMaxBytes: 10 * 1024 * 1024,
    profileImageMaxBytes: 5 * 1024 * 1024,
    videoMaxBytes: 50 * 1024 * 1024,
    imageMaxDimension: 1600,
    videoMaxDimension: 960,
    videoCompressionEnabled: true,
    videoTargetBitrate: 1_200_000,
    videoAudioBitrate: 96_000,
    mediaCleanupIntervalMs: 5 * 60 * 1000,
    storageWarningThreshold: 0.82,
    recentSeenThresholdMinutes: 60,
    allowedImageMimeTypes: ["image/jpeg", "image/png", "image/webp"],
    heartbeatMs: 30 * 1000,
    typingIdleMs: 1600,
    typingSignalThrottleMs: 700,
    typingSignalTtlMs: 4500,
    translationPendingTimeoutMs: 15 * 1000,
    translationRetryCooldownMs: 30 * 1000,
    translationRequestTimeoutMs: 12 * 1000,
    translationApiPath: "/api/translate",
    mediaUploadApiPath: "/api/media",
    stateApiPath: "/api/state",
    eventsApiPath: "/api/events",
    typingApiPath: "/api/typing",
    pushConfigApiPath: "/api/push/config",
    pushRegisterApiPath: "/api/push/register",
    pushNativeBindApiPath: "/api/push/native/bind",
    pushNativeUnbindApiPath: "/api/push/native/unbind",
    pushUnregisterApiPath: "/api/push/unregister",
  };
  const TRANSLATION_CONCEPTS = Object.freeze([
    { id: "office", labelKey: "translationConceptOffice" },
    { id: "general", labelKey: "translationConceptGeneral" },
    { id: "friend", labelKey: "translationConceptFriend" },
    { id: "lover", labelKey: "translationConceptLover" },
  ]);
  const DEFAULT_TRANSLATION_CONCEPT = "lover";
  const BUILT_IN_ADMIN_ACCOUNT = Object.freeze({
    loginId: "admin",
    password: "0694",
    name: "Admin",
    nativeLanguage: "ko",
    uiLanguage: "ko",
  });
  const MEDIA_DB_NAME = "transchat-media-v1";
  const MEDIA_DB_STORE = "chat-media";
  const PROFILE_CROP_PREVIEW_SIZE = 260;
  const PROFILE_CROP_OUTPUT_SIZE = 520;
  const PROFILE_CROP_MAX_DIMENSION = 1280;

  const APP_ROOT = ensureAppRoot();
  const runtime = {
    clientId: `client-${Math.random().toString(36).slice(2, 10)}`,
    videoUrls: new Map(),
    mediaObjectUrls: new Map(),
    mediaLoadPromises: new Map(),
    mediaDbPromise: null,
    translationTasks: new Map(),
    translationRequests: new Map(),
    statusTimers: new Map(),
    toastTimers: new Map(),
    typingStopTimers: new Map(),
    syncChannel: null,
    countdownInterval: null,
    relativeTimer: null,
    heartbeatTimer: null,
    healthTimer: null,
    serverSyncTimer: null,
    serverSyncInFlight: false,
    serverSyncQueued: false,
    serverSyncBackoffMs: 0,
    lastSuccessfulServerSyncAt: 0,
    serverStatePollTimer: null,
    translationRecoveryTimer: null,
    softRenderTimer: null,
    mediaCleanupTimer: null,
    eventSource: null,
    resumeStateSyncPromise: null,
    serverEventsConnected: false,
    compositionActive: false,
    compositionTarget: null,
    pendingRenderWhileComposing: false,
    lastComposerInputAt: 0,
    chatPinnedToBottom: true,
    composerHeight: 0,
    viewportBaseHeight: 0,
    keyboardOffset: 0,
    viewportSyncFrame: 0,
    preservedScrollPositions: {},
    receiptTimer: null,
    storageEstimate: null,
    typingSignals: {},
    presenceSignals: {},
    lastTypingSignalAt: {},
    lastPresenceSignalAt: 0,
    lastPresencePersistAt: 0,
    lastServerStatePollAt: 0,
    lastAppliedServerStateAt: 0,
    backend: {
      serverReachable: false,
      liveTranslationEnabled: false,
      model: null,
      sharedStateEnabled: false,
      hasServerState: false,
      translationConfigured: false,
      lastTranslationError: null,
      lastTranslationErrorDetail: null,
      checkedAt: 0,
    },
    push: {
      supported: typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator && "PushManager" in window,
      permission: typeof Notification !== "undefined" ? Notification.permission : "unsupported",
      config: null,
      serviceWorkerRegistration: null,
      messaging: null,
      token: "",
      tokenUserId: "",
      initialized: false,
      initPromise: null,
      foregroundBound: false,
      status: "idle",
      lastError: "",
      lastRegisterAt: 0,
      refreshPromise: null,
      nativeInstallId: "",
      swMessageBound: false,
      pendingNavigation: null,
    },
    pwa: {
      supported: typeof window !== "undefined" && "serviceWorker" in navigator,
      deferredPrompt: null,
      installed: false,
      swRegistered: false,
      listenersBound: false,
    },
    profileImageCropDrag: null,
    historyBound: false,
    historyRoomId: null,
    historyExitArmed: false,
  };

  function ensureAppRoot() {
    const existing = document.getElementById("app");
    if (existing instanceof HTMLElement) {
      return existing;
    }
    const fallbackRoot = document.createElement("div");
    fallbackRoot.id = "app";
    document.body.appendChild(fallbackRoot);
    return fallbackRoot;
  }

  function escapeFallbackHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderBootstrapFallback(error, phase = "bootstrap") {
    if (!(APP_ROOT instanceof HTMLElement)) return;
    const message = String(error?.message || error || "Unknown error");
    APP_ROOT.innerHTML = `
      <main style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:#f5f7fb;color:#10203a;font-family:system-ui,sans-serif;">
        <section style="width:min(420px,100%);padding:24px;border-radius:20px;background:#fff;border:1px solid rgba(16,32,58,.08);box-shadow:0 18px 40px rgba(16,32,58,.08);">
          <h1 style="margin:0 0 8px;font-size:1.15rem;">TRANSCHAT</h1>
          <p style="margin:0 0 10px;font-size:.95rem;font-weight:600;">앱을 불러오지 못했습니다.</p>
          <p style="margin:0 0 16px;font-size:.86rem;color:#5c6c84;">콘솔을 확인한 뒤 다시 시도해 주세요.</p>
          <div style="padding:12px 14px;border-radius:14px;background:#f7f9fc;border:1px solid rgba(16,32,58,.08);font-size:.78rem;line-height:1.5;word-break:break-word;">
            <strong>${escapeFallbackHtml(phase)}</strong><br />
            ${escapeFallbackHtml(message)}
          </div>
          <button type="button" onclick="window.location.reload()" style="margin-top:16px;width:100%;height:44px;border:none;border-radius:14px;background:#2563eb;color:#fff;font-weight:700;cursor:pointer;">다시 시도</button>
        </section>
      </main>
    `;
  }

  function reportBootstrapError(error, phase = "bootstrap") {
    console.error(`[transchat] ${phase}:failed`, error);
    renderBootstrapFallback(error, phase);
  }

  const uiState = {
    activeRoomId: null,
    dismissedRoomId: null,
    modal: null,
    drawer: null,
    directoryTab: "chat",
    directoryOpen: true,
    chatDetailsOpen: false,
    attachmentMenuOpen: false,
    mobileRoomsOpen: false,
    roomSearch: "",
    drafts: {},
    originalVisibility: {},
    toasts: [],
    previewMedia: null,
    profileEditor: {
      userId: null,
      name: "",
      nickname: "",
      gender: "",
      age: "",
    },
    landing: {
      name: "",
      password: "",
      autoLogin: false,
      nativeLanguage: "ko",
      uiLanguage: localStorage.getItem(LANDING_UI_KEY) || "ko",
      nativeAccordionOpen: false,
      profileImage: null,
      error: "",
      mode: "login",
      signupId: "",
      signupPassword: "",
      signupName: "",
      signupQuestionKey: null,
      signupAnswer: "",
      signupNativeLanguage: "ko",
      signupNativeAccordionOpen: false,
      resetName: "",
      resetQuestionKey: null,
      resetAnswer: "",
      resetPassword: "",
      resetPasswordConfirm: "",
      resetVerified: false,
    },
  };

  const UI_LANGUAGES = {
    ko: "한국어",
    en: "English",
    vi: "Tiếng Việt",
  };

  const CHAT_LANGUAGES = {
    ko: "한국어",
    en: "English",
    vi: "Tiếng Việt",
  };

  const LANDING_QUICK_UI_LANGUAGES = ["ko", "vi"];
  const LANGUAGE_OPTION_LABELS = {
    ko: "한국어",
    en: "English",
    vi: "Tiếng Việt",
  };
  const LANDING_UI_LANGUAGE_LABELS = {
    ko: "한국어",
    vi: "Tiếng Việt",
  };

  const RECOVERY_QUESTION_KEYS = [
    "recoveryFavoriteColor",
    "recoveryChildhoodNickname",
    "recoveryFavoriteAnimal",
    "recoveryMemorableFood",
    "recoveryFavoriteSeason",
  ];

  // Added: shared profile/native-language metadata for the lightweight mobile profile flow.
  const LANGUAGE_META = {
    ko: { flag: "🇰🇷", nativeLabel: "한국어" },
    en: { flag: "🇺🇸", nativeLabel: "English" },
    vi: { flag: "🇻🇳", nativeLabel: "Tiếng Việt" },
  };

  const DEFAULT_PROFILE_IMAGE =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 96 96'%3E%3Crect width='96' height='96' rx='28' fill='%23eef3fb'/%3E%3Ccircle cx='48' cy='35' r='18' fill='%2398a8c0'/%3E%3Cpath d='M20 82c4-16 16-24 28-24s24 8 28 24' fill='%2398a8c0'/%3E%3C/svg%3E";

  // Keep dictionary containers defined before any extension block so startup never fails on first paint.
  const DICTIONARY = { ko: {}, en: {}, vi: {} };

  Object.assign(DICTIONARY.ko, {
    presenceRecentSeen: "최근 접속",
    presenceHoursAgo: "{count}시간 전 접속",
    presenceDaysAgo: "{count}일 전 접속",
    profilePopupLastSeen: "마지막 접속",
    toastMediaStorageFailed: "미디어 저장에 실패했습니다",
    toastMediaStorageFailedCopy: "브라우저 저장 공간 또는 미디어 처리 상태를 확인한 뒤 다시 시도해 주세요.",
    mediaExpiredLabel: "만료된 미디어",
    mediaExpiredCopy: "이 미디어는 업로드 후 24시간이 지나 자동 삭제되었습니다.",
    mediaExpiresIn: "만료: {time}",
    mediaExpiresAfterUpload: "업로드 후 {hours}시간 뒤 자동 삭제",
    pushSettingsTitle: "푸시 알림",
    pushEnableButton: "푸시 알림 받기",
    pushPermissionGranted: "알림 허용됨",
    pushPermissionDenied: "알림 차단됨",
    pushPermissionDefault: "알림 미설정",
    pushPermissionUnsupported: "이 브라우저에서는 미지원",
    pushPermissionGrantedHelp: "이 기기에서 새 메시지와 새 초대를 받을 수 있습니다.",
    pushPermissionPendingHelp: "버튼을 눌러 새 메시지와 초대 알림을 받아보세요.",
    pushPermissionBlockedHelp: "브라우저 설정에서 알림 권한을 직접 허용해야 합니다.",
    pushRegisterSuccessTitle: "푸시 알림 연결 완료",
    pushRegisterSuccessCopy: "이 기기에서 새 메시지와 초대를 받아볼 수 있습니다.",
    pushRegisterFailedTitle: "푸시 알림 연결 실패",
    pushRegisterFailedCopy: "Firebase 설정값과 브라우저 알림 권한을 확인해 주세요.",
    pushTokenReady: "권한 허용 · 이 기기 토큰 등록 완료",
    pushTokenPending: "권한은 허용됐지만 이 기기 토큰 등록이 아직 완료되지 않았습니다.",
    pushTestMessageButton: "메시지 테스트",
    pushTestInviteButton: "초대 테스트",
    pushTestSuccessTitle: "테스트 푸시 전송 완료",
    pushTestSuccessCopy: "{type} 알림을 이 기기로 전송했습니다.",
    pushTestFailedTitle: "테스트 푸시 전송 실패",
    pushTestFailedCopy: "권한, 토큰 등록 상태, Firebase 설정을 다시 확인해 주세요.",
    pushToastMessageTitle: "새 메시지",
    pushToastMessageCopy: "{name}: {preview}",
    pushToastInviteTitle: "새 초대",
    pushToastInviteCopy: "{name}님이 채팅 초대를 보냈어요",
  });

  Object.assign(DICTIONARY.en, {
    presenceRecentSeen: "Recently active",
    presenceHoursAgo: "Active {count}h ago",
    presenceDaysAgo: "Active {count}d ago",
    profilePopupLastSeen: "Last seen",
    toastMediaStorageFailed: "Media could not be saved",
    toastMediaStorageFailedCopy: "Please check available browser storage and try again.",
    mediaExpiredLabel: "Expired media",
    mediaExpiredCopy: "This media was automatically deleted 24 hours after upload.",
    mediaExpiresIn: "{time}",
    mediaExpiresAfterUpload: "Auto-deletes {hours} hours after upload",
    pushSettingsTitle: "Push notifications",
    pushEnableButton: "Enable push alerts",
    pushPermissionGranted: "Notifications allowed",
    pushPermissionDenied: "Notifications blocked",
    pushPermissionDefault: "Notifications not set",
    pushPermissionUnsupported: "Not supported on this browser",
    pushPermissionGrantedHelp: "This device can receive new messages and invite alerts.",
    pushPermissionPendingHelp: "Tap the button to receive new message and invite alerts.",
    pushPermissionBlockedHelp: "Please allow notifications from your browser settings.",
    pushRegisterSuccessTitle: "Push connected",
    pushRegisterSuccessCopy: "This device can now receive new messages and invites.",
    pushRegisterFailedTitle: "Push setup failed",
    pushRegisterFailedCopy: "Please check your Firebase values and notification permissions.",
    pushTokenReady: "Permission granted · this device token is registered",
    pushTokenPending: "Permission is granted, but this device token is not registered yet.",
    pushTestMessageButton: "Test message",
    pushTestInviteButton: "Test invite",
    pushTestSuccessTitle: "Test push sent",
    pushTestSuccessCopy: "A {type} alert was sent to this device.",
    pushTestFailedTitle: "Test push failed",
    pushTestFailedCopy: "Please check notification permission, token registration, and Firebase config.",
    pushToastMessageTitle: "New message",
    pushToastMessageCopy: "{name}: {preview}",
    pushToastInviteTitle: "New invite",
    pushToastInviteCopy: "{name} sent you a chat invite",
  });

  Object.assign(DICTIONARY.vi, {
    presenceRecentSeen: "Vua moi truy cap",
    presenceHoursAgo: "Truy cap {count} gio truoc",
    presenceDaysAgo: "Truy cap {count} ngay truoc",
    profilePopupLastSeen: "Lan truy cap cuoi",
    toastMediaStorageFailed: "Khong the luu media",
    toastMediaStorageFailedCopy: "Hay kiem tra dung luong trinh duyet roi thu lai.",
    mediaExpiredLabel: "Media da het han",
    mediaExpiredCopy: "Media nay da tu dong bi xoa sau 24 gio ke tu luc tai len.",
    mediaExpiresIn: "Het han: {time}",
    mediaExpiresAfterUpload: "Tu dong xoa sau {hours} gio ke tu luc tai len",
    pushSettingsTitle: "Thong bao day",
    pushEnableButton: "Bat thong bao day",
    pushPermissionGranted: "Da cho phep thong bao",
    pushPermissionDenied: "Thong bao da bi chan",
    pushPermissionDefault: "Chua cai dat thong bao",
    pushPermissionUnsupported: "Trinh duyet nay khong ho tro",
    pushPermissionGrantedHelp: "Thiet bi nay co the nhan thong bao tin nhan va loi moi moi.",
    pushPermissionPendingHelp: "Nhan nut de nhan thong bao tin nhan va loi moi moi.",
    pushPermissionBlockedHelp: "Hay vao cai dat trinh duyet de cho phep thong bao.",
    pushRegisterSuccessTitle: "Da ket noi thong bao day",
    pushRegisterSuccessCopy: "Thiet bi nay da co the nhan tin nhan va loi moi moi.",
    pushRegisterFailedTitle: "Khong the ket noi thong bao day",
    pushRegisterFailedCopy: "Hay kiem tra cau hinh Firebase va quyen thong bao.",
    pushTokenReady: "Da cap quyen · token thiet bi nay da duoc luu",
    pushTokenPending: "Da cap quyen, nhung token thiet bi nay chua duoc dang ky.",
    pushTestMessageButton: "Thu tin nhan",
    pushTestInviteButton: "Thu loi moi",
    pushTestSuccessTitle: "Da gui thong bao thu",
    pushTestSuccessCopy: "Da gui thong bao {type} toi thiet bi nay.",
    pushTestFailedTitle: "Gui thong bao thu that bai",
    pushTestFailedCopy: "Hay kiem tra quyen thong bao, token va cau hinh Firebase.",
    pushToastMessageTitle: "Tin nhan moi",
    pushToastMessageCopy: "{name}: {preview}",
    pushToastInviteTitle: "Loi moi moi",
    pushToastInviteCopy: "{name} da gui loi moi tro chuyen",
  });

  Object.assign(DICTIONARY.ko, {
    pwaInstallTitle: "앱 설치",
    pwaInstallButton: "앱 설치하기",
    pwaInstalledButton: "앱이 설치됨",
    pwaInstallGuideButton: "홈 화면에 추가 안내 보기",
    pwaInstallReadyCopy: "이 기기에서 TRANSCHAT을 앱처럼 빠르게 열 수 있습니다.",
    pwaInstalledCopy: "이 기기에서는 이미 앱처럼 설치되어 있습니다.",
    pwaInstallManualCopy: "브라우저 메뉴에서 앱 설치 또는 홈 화면에 추가를 선택해 주세요.",
    pwaInstallIosCopy: "Safari의 공유 버튼을 누른 뒤 '홈 화면에 추가'를 선택해 주세요.",
    pwaInstallUnsupportedCopy: "이 브라우저에서는 앱 설치 지원이 제한될 수 있습니다.",
    pwaInstallGuideTitle: "앱 설치 안내",
    pwaInstalledToastTitle: "앱 설치 완료",
    pwaInstalledToastCopy: "이제 TRANSCHAT을 앱처럼 바로 실행할 수 있습니다.",
  });

  Object.assign(DICTIONARY.en, {
    pwaInstallTitle: "Install app",
    pwaInstallButton: "Install app",
    pwaInstalledButton: "App installed",
    pwaInstallGuideButton: "Show install guide",
    pwaInstallReadyCopy: "You can open TRANSCHAT like an app on this device.",
    pwaInstalledCopy: "TRANSCHAT is already installed like an app on this device.",
    pwaInstallManualCopy: "Use your browser menu to install the app or add it to the home screen.",
    pwaInstallIosCopy: "In Safari, tap Share and choose Add to Home Screen.",
    pwaInstallUnsupportedCopy: "Install support may be limited in this browser.",
    pwaInstallGuideTitle: "Install guide",
    pwaInstalledToastTitle: "App installed",
    pwaInstalledToastCopy: "You can now launch TRANSCHAT like an app.",
  });

  Object.assign(DICTIONARY.vi, {
    pwaInstallTitle: "Cai dat ung dung",
    pwaInstallButton: "Cai dat ung dung",
    pwaInstalledButton: "Da cai dat",
    pwaInstallGuideButton: "Xem huong dan them vao man hinh chinh",
    pwaInstallReadyCopy: "Ban co the mo TRANSCHAT nhu mot ung dung tren thiet bi nay.",
    pwaInstalledCopy: "TRANSCHAT da duoc cai dat nhu mot ung dung tren thiet bi nay.",
    pwaInstallManualCopy: "Hay mo menu trinh duyet de cai dat ung dung hoac them vao man hinh chinh.",
    pwaInstallIosCopy: "Trong Safari, nhan nut Chia se roi chon Them vao man hinh chinh.",
    pwaInstallUnsupportedCopy: "Tinh nang cai dat co the bi gioi han tren trinh duyet nay.",
    pwaInstallGuideTitle: "Huong dan cai dat",
    pwaInstalledToastTitle: "Da cai dat ung dung",
    pwaInstalledToastCopy: "Ban da co the mo TRANSCHAT nhu mot ung dung.",
  });

  const LOCALES = {
    ko: "ko-KR",
    en: "en-US",
    vi: "vi-VN",
  };

  const DEMO_USER_NAMES = new Set(["Hana", "Alex", "Linh", "Yuna"]);
  const DEMO_ROOM_IDS = new Set(["room-lounge", "room-travel", "room-brainstorm"]);
  const DEMO_ROOM_TITLES = new Set(["Global Lounge", "Weekend Passport", "Night Shift Ideas"]);
  const PERSISTENT_ROOM_TITLE_KEYS = new Set(["호아와현태", "호아와현태의방"]);

  // Base dictionary content is assigned after the early extension blocks above.

  DICTIONARY.ko = { ...DICTIONARY.ko,
    appSubtitle: "한국어 중심의 실시간 다국어 채팅 프로토타입",
    landingEyebrow: "한국어 기본 UI",
    landingTitle: "TRANSCHAT",
    landingDescription:
      "각자 자신의 모국어로만 대화해도, 상대방에게는 자동으로 번역되어 보이도록 설계된 실시간 채팅 서비스입니다.",
    landingPointRealtime: "실시간 번역 구조",
    landingPointRealtimeCopy: "모의 번역 레이어와 메시지 상태 흐름을 바로 테스트할 수 있습니다.",
    landingPointInvite: "초대형 협업 흐름",
    landingPointInviteCopy: "초대 수락과 거절, 보호된 방 입장, 읽음 처리까지 한 번에 검증할 수 있습니다.",
    landingPointEphemeral: "30분 자동 만료",
    landingPointEphemeralCopy: "새 메시지가 없으면 방과 미디어가 함께 정리되는 구조를 포함합니다.",
    landingPointMobile: "모바일 입력 대응",
    landingPointMobileCopy: "소프트 키보드가 떠도 입력창이 가려지지 않도록 뷰포트 보정을 적용합니다.",
    landingPanelTitle: "바로 체험 시작",
    landingPanelCopy: "UI 언어와 채팅 모국어를 각각 설정한 뒤 바로 대화를 시작할 수 있습니다.",
    labelUsername: "사용자 이름",
    labelNativeLanguage: "채팅 모국어",
    labelUiLanguage: "UI 언어",
    placeholderUsername: "예: 민수",
    helperUsername: "같은 이름이 이미 있으면 자동으로 숫자 접미사가 붙습니다.",
    enterButton: "입장하기",
    demoUsersLabel: "기본 데모 사용자",
    demoUsersValue: "Hana, Alex, Linh, Yuna",
    topbarStatus: "브라우저에서 바로 사용 가능",
    serverOnline: "서버 연결됨",
    serverOffline: "서버 연결 없음",
    translationLiveMode: "실번역 사용",
    translationFallbackMode: "모의 번역",
    syncRealtime: "실시간 동기화",
    syncBasic: "기본 동기화",
    roomListTitle: "대화방",
    roomListCopy: "방을 선택하거나 초대를 받아 입장하세요.",
    tabAllRooms: "전체 방",
    tabActiveRooms: "채팅",
    tabFriends: "친구",
    tabMyInfo: "내 정보",
    activeRoomsTitle: "대화중인 채팅방",
    activeRoomsEmptyTitle: "참여 중인 방이 없습니다",
    activeRoomsEmptyCopy: "방에 입장하면 이 탭에 현재 대화중인 방이 표시됩니다.",
    friendsTitle: "친구 목록",
    friendsCopy: "온라인 상태를 보고 현재 방으로 빠르게 초대할 수 있습니다.",
    friendsEmptyTitle: "표시할 친구가 없습니다",
    friendsEmptyCopy: "다른 이름으로 입장한 사용자가 생기면 여기서 확인할 수 있습니다.",
    myInfoTitle: "내 정보",
    roomSearchPlaceholder: "방 제목 또는 생성자 검색",
    createRoomButton: "방 만들기",
    noRoomsTitle: "아직 표시할 방이 없습니다",
    noRoomsCopy: "새 방을 만들거나 검색어를 지워 전체 방 목록을 확인해 보세요.",
    roomCreator: "생성자",
    roomParticipants: "참여자",
    roomLastActivity: "마지막 메시지",
    roomUnlocked: "입장 기록 있음",
    roomProtected: "비밀번호 필요",
    roomOpen: "공개 입장",
    roomPersistent: "만료 제외",
    roomExpired: "만료됨",
    unreadLabel: "읽지 않음",
    chatWelcomeTitle: "TRANSCHAT에 오신 것을 환영합니다",
    chatWelcomeCopy: "왼쪽 목록에서 방을 선택하면 메시지, 번역, 초대 흐름을 바로 사용할 수 있습니다.",
    chatExpiredTitle: "대화가 만료되어 삭제되었습니다",
    chatExpiredCopy: "30분 동안 새로운 메시지가 없어 방이 자동 종료되었습니다. 모든 참여자와 메시지, 미디어가 정리된 상태입니다.",
    chatHeaderCreator: "생성자",
    participantsButton: "참여자",
    inviteButton: "초대",
    leaveButton: "나가기",
    backToRooms: "방 목록",
    expireCountdown: "만료까지",
    expireTesting: "31분 경과 테스트",
    noMessagesTitle: "첫 메시지를 보내 보세요",
    noMessagesCopy: "새 텍스트, 이미지, 비디오 메시지 전송 시에만 방의 만료 타이머가 갱신됩니다.",
    showOriginal: "원문 보기",
    hideOriginal: "원문 숨기기",
    translationFailedBadge: "번역 실패",
    translationPendingBadge: "번역 중",
    translatedBadge: "자동 번역됨",
    systemMessage: "시스템",
    statusComposing: "작성 중",
    statusSent: "전송완료",
    statusRead: "읽음",
    typingIndicator: "{name} 님이 입력 중입니다...",
    draftFailToggleOn: "다음 전송은 번역 실패 테스트",
    draftFailToggleOff: "번역 실패 시뮬레이션",
    composerPlaceholder: "당신의 모국어로 입력하세요. 링크도 자동 감지됩니다.",
    sendButton: "전송",
    addPhoto: "사진",
    addVideo: "비디오",
    addFile: "파일",
    attachmentImageReady: "이미지 첨부 준비 완료",
    attachmentVideoReady: "비디오 첨부 준비 완료",
    attachmentFileReady: "파일 첨부 준비 완료",
    removeAttachment: "첨부 제거",
    imageTooLarge: "이미지는 10MB 이하만 보낼 수 있습니다.",
    videoTooLarge: "비디오는 50MB 이하만 보낼 수 있습니다.",
    imageCompressing: "이미지를 압축 중입니다...",
    videoPreparing: "비디오 전송 준비 중입니다...",
    mediaPreview: "미리보기",
    videoSessionOnly: "이 비디오 미리보기는 현재 세션에서만 유지됩니다.",
    linkOpen: "링크 열기",
    sideInvitesTitle: "초대 센터",
    sideInvitesCopy: "수신 초대와 최근 응답 상태를 확인하세요.",
    noInvitesTitle: "도착한 초대가 없습니다",
    noInvitesCopy: "다른 사용자가 초대하면 여기에 표시됩니다.",
    acceptInvite: "수락",
    rejectInvite: "거절",
    inviteAccepted: "초대 수락",
    inviteRejected: "초대 거절",
    invitePending: "응답 대기 중",
    inviteResultTitle: "최근 초대 결과",
    inviteResultEmpty: "보낸 초대의 결과가 아직 없습니다.",
    sidePeopleTitle: "현재 방 참여자",
    sidePeopleCopy: "모국어와 접속 상태를 함께 확인할 수 있습니다.",
    noParticipants: "아직 방에 참여한 사용자가 없습니다.",
    presenceInRoom: "방 안",
    presenceOnline: "온라인",
    presenceOffline: "오프라인",
    settingsTitle: "설정",
    settingsCopy: "UI 언어, 모국어, 테마를 바로 변경할 수 있습니다.",
    themeLabel: "테마",
    themeSystem: "시스템",
    themeLight: "라이트",
    themeDark: "다크",
    settingsNativeLanguage: "내 채팅 모국어",
    settingsPreferredLanguage: "선호 대화 언어",
    settingsUiLanguage: "내 UI 언어",
    settingsDemoSwitch: "테스트용 사용자 전환",
    settingsDemoSwitchCopy: "한 브라우저에서 초대 흐름을 빠르게 확인할 때 사용합니다.",
    settingsCurrentRoomTest: "활성 방 만료 테스트",
    settingsCurrentRoomTestCopy: "현재 열린 방의 마지막 메시지 시간을 31분 전으로 이동합니다.",
    settingsReset: "데모 데이터 초기화",
    settingsClose: "닫기",
    modalCreateRoomTitle: "새 방 만들기",
    modalCreateRoomCopy: "제목과 비밀번호를 입력하면 보호된 방이 즉시 목록에 추가됩니다.",
    modalRoomTitle: "방 제목",
    modalRoomPassword: "비밀번호",
    placeholderRoomTitle: "예: 서울 야간 스터디",
    placeholderRoomPassword: "입장 비밀번호 입력",
    createConfirm: "생성하기",
    cancel: "취소",
    modalPasswordTitle: "비밀번호 확인",
    modalPasswordCopy: "보호된 방에 입장하려면 비밀번호가 필요합니다.",
    passwordError: "비밀번호가 올바르지 않습니다.",
    passwordAttemptsLeft: "남은 시도: {count}",
    passwordLocked: "입력 잠금 중",
    passwordLockedCopy: "잠금 해제까지 {time} 남았습니다.",
    enterRoomButton: "입장",
    modalInviteTitle: "사용자 초대",
    modalInviteCopy: "초대할 사용자의 이름을 입력하면 초대 센터에 즉시 표시됩니다.",
    inviteNameLabel: "초대할 사용자 이름",
    inviteNamePlaceholder: "예: Alex",
    inviteSend: "초대 보내기",
    inviteUserMissing: "해당 이름의 사용자를 찾을 수 없습니다.",
    inviteSelfError: "자기 자신은 초대할 수 없습니다.",
    inviteDuplicateError: "이미 처리 중인 초대가 있습니다.",
    inviteExpiredError: "만료된 방에는 초대할 수 없습니다.",
    participantsModalTitle: "참여자 목록",
    participantsModalCopy: "이 방에 연결된 사용자와 언어 상태입니다.",
    mediaModalTitle: "미디어 보기",
    mediaModalClose: "닫기",
    toastEnter: "입장 완료",
    toastEnterCopy: "{name} 이름으로 서비스를 시작했습니다.",
    toastDuplicateName: "중복 이름 조정",
    toastDuplicateNameCopy: "이미 사용 중이라 {name} 이름으로 저장했습니다.",
    toastRoomCreated: "방이 생성되었습니다",
    toastRoomCreatedCopy: "{title} 방이 목록에 추가되었습니다.",
    toastPasswordSuccess: "방 입장 성공",
    toastPasswordSuccessCopy: "{title} 방에 참여했습니다.",
    toastInviteSent: "초대를 보냈습니다",
    toastInviteSentCopy: "{name} 님에게 초대를 전달했습니다.",
    toastInviteAccepted: "초대가 수락되었습니다",
    toastInviteAcceptedCopy: "{name} 님이 방에 참여했습니다.",
    toastInviteRejected: "초대가 거절되었습니다",
    toastInviteRejectedCopy: "{name} 님이 초대를 거절했습니다.",
    toastTranslationFailed: "번역 실패 테스트",
    toastTranslationFailedCopy: "이 메시지는 원문으로 표시되고 실패 배지가 붙습니다.",
    toastRoomExpired: "방이 만료되었습니다",
    toastRoomExpiredCopy: "{title} 대화가 만료되어 삭제되었습니다.",
    toastAttachmentRemoved: "첨부를 제거했습니다",
    toastAttachmentRemovedCopy: "메시지 초안에서 미디어를 삭제했습니다.",
    toastDemoReset: "데모 데이터가 초기화되었습니다",
    toastDemoResetCopy: "기본 시드 데이터로 다시 시작합니다.",
    toastUserSwitched: "사용자 전환",
    toastUserSwitchedCopy: "{name} 계정으로 전환했습니다.",
    toastNeedRoom: "먼저 방을 선택하세요",
    toastNeedRoomCopy: "메시지를 보내려면 활성 방이 필요합니다.",
    toastEmptyDraft: "보낼 내용이 없습니다",
    toastEmptyDraftCopy: "텍스트를 입력하거나 미디어를 첨부해 주세요.",
    toastInviteAction: "초대 응답 완료",
    toastInviteActionCopy: "선택한 초대의 상태가 업데이트되었습니다.",
    toastRoomDeleted: "방이 삭제되었습니다",
    toastRoomDeletedCopy: "{title} 방이 삭제되었습니다.",
    logoutButton: "로그아웃",
    logoutCopy: "현재 계정을 삭제하고 첫 화면으로 돌아갑니다.",
    toastRoomLeft: "방에서 나갔습니다",
    toastRoomLeftCopy: "{title} 방을 나왔습니다.",
    toastRoomFastForward: "만료 테스트 적용",
    toastRoomFastForwardCopy: "활성 방의 마지막 메시지를 31분 전으로 이동했습니다.",
    toastMediaMissing: "미디어를 불러올 수 없습니다",
    toastMediaMissingCopy: "이 비디오 미리보기는 새로 고침 후 다시 준비해야 합니다.",
    toastMessageSent: "메시지를 보냈습니다",
    toastMessageSentCopy: "자동 번역과 읽음 상태가 순차적으로 반영됩니다.",
    toastNoUserSwitch: "전환할 사용자가 없습니다",
    toastNoUserSwitchCopy: "새 사용자를 먼저 입장시켜 주세요.",
    friendInviteButton: "현재 방으로 초대",
    previewNotReady: "준비 중",
    previewNotReadyCopy: "비디오 압축 구조만 시뮬레이션하고 있습니다.",
    systemUserJoined: "{name} 님이 입장했습니다.",
    systemUserLeft: "{name} 님이 나갔습니다.",
    systemUserInvited: "{inviter} 님이 {invitee} 님을 초대했습니다.",
    systemInviteAccepted: "{name} 님이 초대를 수락했습니다.",
    systemInviteRejected: "{name} 님이 초대를 거절했습니다.",
    systemRoomExpired: "대화가 만료되어 삭제되었습니다.",
    relativeJustNow: "방금 전",
    relativeMinutesAgo: "{count}분 전",
    relativeHoursAgo: "{count}시간 전",
    relativeDaysAgo: "{count}일 전",
    remainingMinutes: "{count}분",
    remainingSeconds: "{count}초",
  };

  DICTIONARY.en = { ...DICTIONARY.en,
    appSubtitle: "Korean-first multilingual chat prototype",
    landingEyebrow: "Default UI in Korean",
    landingTitle: "TRANSCHAT",
    landingDescription:
      "A real-time chat service prototype where each person writes only in their native language and everyone else sees an automatic translation.",
    landingPointRealtime: "Real-time translation flow",
    landingPointRealtimeCopy: "Test the mock translation layer and message status pipeline immediately.",
    landingPointInvite: "Invite-driven collaboration",
    landingPointInviteCopy: "Verify invite accept and reject flows, protected room access, and read states in one place.",
    landingPointEphemeral: "30-minute auto-expiration",
    landingPointEphemeralCopy: "Rooms, messages, and media are cleaned up together when no new message is sent.",
    landingPointMobile: "Mobile keyboard handling",
    landingPointMobileCopy: "The composer stays visible above the software keyboard with viewport-aware layout updates.",
    landingPanelTitle: "Enter the prototype",
    landingPanelCopy: "Set your UI language and chat native language separately, then start chatting right away.",
    labelUsername: "User name",
    labelNativeLanguage: "Native chat language",
    labelUiLanguage: "UI language",
    placeholderUsername: "Example: Minsu",
    helperUsername: "If the name already exists, a numeric suffix is added automatically.",
    enterButton: "Enter",
    demoUsersLabel: "Seeded demo users",
    demoUsersValue: "Hana, Alex, Linh, Yuna",
    topbarStatus: "Ready in the browser",
    serverOnline: "Server online",
    serverOffline: "Server offline",
    translationLiveMode: "Live translation",
    translationFallbackMode: "Mock fallback",
    syncRealtime: "Realtime sync",
    syncBasic: "Basic sync",
    roomListTitle: "Rooms",
    roomListCopy: "Select a room or accept an invite to join.",
    tabAllRooms: "All Rooms",
    tabActiveRooms: "Chat",
    tabFriends: "Friends",
    tabMyInfo: "My Info",
    activeRoomsTitle: "Active Chats",
    activeRoomsEmptyTitle: "No active chat rooms",
    activeRoomsEmptyCopy: "Rooms you join appear in this tab.",
    friendsTitle: "Friends",
    friendsCopy: "Check online status and invite someone into the current room quickly.",
    friendsEmptyTitle: "No friends to show",
    friendsEmptyCopy: "Other entered users will appear here.",
    myInfoTitle: "My Info",
    roomSearchPlaceholder: "Search by room title or creator",
    createRoomButton: "Create Room",
    noRoomsTitle: "No rooms match right now",
    noRoomsCopy: "Create a room or clear the search field to see the full list.",
    roomCreator: "Creator",
    roomParticipants: "Participants",
    roomLastActivity: "Last message",
    roomUnlocked: "Unlocked before",
    roomProtected: "Password required",
    roomOpen: "Open access",
    roomPersistent: "No auto-expire",
    roomExpired: "Expired",
    unreadLabel: "Unread",
    chatWelcomeTitle: "Welcome to TRANSCHAT",
    chatWelcomeCopy: "Pick a room from the list to start messaging, translation, and invites right away.",
    chatExpiredTitle: "This conversation expired and was deleted",
    chatExpiredCopy: "No new message was sent for 30 minutes, so the room closed automatically. Participants, messages, and media were removed.",
    chatHeaderCreator: "Creator",
    participantsButton: "Participants",
    inviteButton: "Invite",
    leaveButton: "Leave",
    backToRooms: "Rooms",
    expireCountdown: "Expires in",
    expireTesting: "Fast-forward 31 min",
    noMessagesTitle: "Send the first message",
    noMessagesCopy: "Only new text or media messages refresh the room expiration timer.",
    showOriginal: "Show original",
    hideOriginal: "Hide original",
    translationFailedBadge: "Translation failed",
    translationPendingBadge: "Translating",
    translatedBadge: "Auto translated",
    systemMessage: "System",
    statusComposing: "Composing",
    statusSent: "Sent",
    statusRead: "Read",
    typingIndicator: "{name} is typing...",
    draftFailToggleOn: "Next send will fail translation",
    draftFailToggleOff: "Simulate translation failure",
    composerPlaceholder: "Write in your native language. URLs are detected automatically.",
    sendButton: "Send",
    addPhoto: "Photo",
    addVideo: "Video",
    addFile: "File",
    attachmentImageReady: "Image attachment ready",
    attachmentVideoReady: "Video attachment ready",
    attachmentFileReady: "File attachment ready",
    removeAttachment: "Remove attachment",
    imageTooLarge: "Images must be 10MB or smaller.",
    videoTooLarge: "Videos must be 50MB or smaller.",
    imageCompressing: "Compressing image...",
    videoPreparing: "Preparing video send...",
    mediaPreview: "Preview",
    videoSessionOnly: "This video preview is only available in the current session.",
    linkOpen: "Open link",
    sideInvitesTitle: "Invite Center",
    sideInvitesCopy: "Check incoming invites and recent responses.",
    noInvitesTitle: "No invites yet",
    noInvitesCopy: "New invites will appear here.",
    acceptInvite: "Accept",
    rejectInvite: "Reject",
    inviteAccepted: "Accepted",
    inviteRejected: "Rejected",
    invitePending: "Pending",
    inviteResultTitle: "Recent invite results",
    inviteResultEmpty: "No invite results yet.",
    sidePeopleTitle: "Participants in this room",
    sidePeopleCopy: "See each participant's language and current presence.",
    noParticipants: "No one is currently in this room.",
    presenceInRoom: "In room",
    presenceOnline: "Online",
    presenceOffline: "Offline",
    settingsTitle: "Settings",
    settingsCopy: "Change UI language, native language, and theme instantly.",
    themeLabel: "Theme",
    themeSystem: "System",
    themeLight: "Light",
    themeDark: "Dark",
    settingsNativeLanguage: "My native chat language",
    settingsPreferredLanguage: "Preferred conversation language",
    settingsUiLanguage: "My UI language",
    settingsDemoSwitch: "Switch demo user",
    settingsDemoSwitchCopy: "Useful when you want to test invite flows in one browser quickly.",
    settingsCurrentRoomTest: "Expiration test for active room",
    settingsCurrentRoomTestCopy: "Move the current room's last message time back by 31 minutes.",
    settingsReset: "Reset demo data",
    settingsClose: "Close",
    modalCreateRoomTitle: "Create a new room",
    modalCreateRoomCopy: "Enter a title and password to add a protected room immediately.",
    modalRoomTitle: "Room title",
    modalRoomPassword: "Password",
    placeholderRoomTitle: "Example: Seoul night study",
    placeholderRoomPassword: "Enter room password",
    createConfirm: "Create",
    cancel: "Cancel",
    modalPasswordTitle: "Password check",
    modalPasswordCopy: "A password is required to enter this protected room.",
    passwordError: "The password is incorrect.",
    passwordAttemptsLeft: "Attempts left: {count}",
    passwordLocked: "Input locked",
    passwordLockedCopy: "Unlocks in {time}.",
    enterRoomButton: "Enter room",
    modalInviteTitle: "Invite a user",
    modalInviteCopy: "Enter another user's name and the invite appears in their invite center right away.",
    inviteNameLabel: "User name to invite",
    inviteNamePlaceholder: "Example: Alex",
    inviteSend: "Send invite",
    inviteUserMissing: "No user with that name was found.",
    inviteSelfError: "You cannot invite yourself.",
    inviteDuplicateError: "There is already a pending invite.",
    inviteExpiredError: "You cannot invite someone into an expired room.",
    participantsModalTitle: "Participant list",
    participantsModalCopy: "Connected users and their language settings for this room.",
    mediaModalTitle: "View media",
    mediaModalClose: "Close",
    toastEnter: "Entered",
    toastEnterCopy: "You started the app as {name}.",
    toastDuplicateName: "Duplicate name adjusted",
    toastDuplicateNameCopy: "That name was already taken, so it was saved as {name}.",
    toastRoomCreated: "Room created",
    toastRoomCreatedCopy: "{title} has been added to the room list.",
    toastPasswordSuccess: "Room joined",
    toastPasswordSuccessCopy: "You entered {title}.",
    toastInviteSent: "Invite sent",
    toastInviteSentCopy: "{name} received the invite.",
    toastInviteAccepted: "Invite accepted",
    toastInviteAcceptedCopy: "{name} joined the room.",
    toastInviteRejected: "Invite rejected",
    toastInviteRejectedCopy: "{name} rejected the invite.",
    toastTranslationFailed: "Translation failure test",
    toastTranslationFailedCopy: "This message is shown as the original text with a failure badge.",
    toastRoomExpired: "Room expired",
    toastRoomExpiredCopy: "{title} expired and was deleted.",
    toastAttachmentRemoved: "Attachment removed",
    toastAttachmentRemovedCopy: "The media was removed from the draft.",
    toastDemoReset: "Demo data reset",
    toastDemoResetCopy: "The app was restored to the seeded state.",
    toastUserSwitched: "User switched",
    toastUserSwitchedCopy: "You are now using {name}.",
    toastNeedRoom: "Select a room first",
    toastNeedRoomCopy: "An active room is required before sending a message.",
    toastEmptyDraft: "Nothing to send",
    toastEmptyDraftCopy: "Type a message or attach media first.",
    toastInviteAction: "Invite response saved",
    toastInviteActionCopy: "The invite status was updated.",
    toastRoomDeleted: "Room deleted",
    toastRoomDeletedCopy: "{title} was deleted.",
    logoutButton: "Log out",
    logoutCopy: "Delete this account and return to the first screen.",
    toastRoomLeft: "Left room",
    toastRoomLeftCopy: "You left {title}.",
    toastRoomFastForward: "Expiration test applied",
    toastRoomFastForwardCopy: "The active room now looks 31 minutes inactive.",
    toastMediaMissing: "Media is unavailable",
    toastMediaMissingCopy: "This video preview needs to be prepared again after a refresh.",
    toastMessageSent: "Message sent",
    toastMessageSentCopy: "Automatic translation and read states will update in sequence.",
    toastNoUserSwitch: "No other users available",
    toastNoUserSwitchCopy: "Enter at least one additional user first.",
    friendInviteButton: "Invite to current room",
    previewNotReady: "Preparing",
    previewNotReadyCopy: "Only the video compression workflow is simulated in this prototype.",
    systemUserJoined: "{name} joined the room.",
    systemUserLeft: "{name} left the room.",
    systemUserInvited: "{inviter} invited {invitee}.",
    systemInviteAccepted: "{name} accepted the invite.",
    systemInviteRejected: "{name} rejected the invite.",
    systemRoomExpired: "This conversation expired and was deleted.",
    relativeJustNow: "Just now",
    relativeMinutesAgo: "{count} min ago",
    relativeHoursAgo: "{count} hr ago",
    relativeDaysAgo: "{count} day ago",
    remainingMinutes: "{count} min",
    remainingSeconds: "{count} sec",
  };

  DICTIONARY.vi = { ...DICTIONARY.vi,
    appSubtitle: "Nguyên mẫu chat đa ngôn ngữ ưu tiên giao diện Hàn Quốc",
    landingEyebrow: "Giao diện mặc định là tiếng Hàn",
    landingTitle: "TRANSCHAT",
    landingDescription:
      "Nguyên mẫu dịch vụ chat thời gian thực, nơi mỗi người chỉ cần viết bằng tiếng mẹ đẻ của mình và người khác sẽ thấy bản dịch tự động.",
    landingPointRealtime: "Luồng dịch thời gian thực",
    landingPointRealtimeCopy: "Có thể thử ngay lớp dịch giả lập và trạng thái tin nhắn.",
    landingPointInvite: "Quy trình mời vào phòng",
    landingPointInviteCopy: "Thử chấp nhận, từ chối lời mời, vào phòng có mật khẩu và trạng thái đã đọc tại một nơi.",
    landingPointEphemeral: "Tự động hết hạn sau 30 phút",
    landingPointEphemeralCopy: "Phòng, tin nhắn và media được dọn dẹp cùng nhau nếu không có tin nhắn mới.",
    landingPointMobile: "Bàn phím di động",
    landingPointMobileCopy: "Khung soạn tin luôn nằm trên bàn phím nhờ cập nhật viewport trên di động.",
    landingPanelTitle: "Bắt đầu trải nghiệm",
    landingPanelCopy: "Dat rieng ngon ngu giao dien va ngon ngu me de trong chat roi bat dau tro chuyen ngay.",
    labelUsername: "Tên người dùng",
    labelNativeLanguage: "Ngôn ngữ mẹ đẻ trong chat",
    labelUiLanguage: "Ngôn ngữ giao diện",
    placeholderUsername: "Ví dụ: Minsu",
    helperUsername: "Nếu tên đã tồn tại, hệ thống sẽ tự thêm hậu tố số.",
    enterButton: "Vào",
    demoUsersLabel: "Người dùng mẫu",
    demoUsersValue: "Hana, Alex, Linh, Yuna",
    topbarStatus: "San sang tren trinh duyet",
    serverOnline: "May chu dang ket noi",
    serverOffline: "Khong ket noi may chu",
    translationLiveMode: "Dich thuc",
    translationFallbackMode: "Dich gia lap",
    syncRealtime: "Dong bo thoi gian thuc",
    syncBasic: "Dong bo co ban",
    roomListTitle: "Phong chat",
    roomListCopy: "Chon phong hoac chap nhan loi moi de tham gia.",
    tabAllRooms: "Tat ca phong",
    tabActiveRooms: "Chat",
    tabFriends: "Ban be",
    tabMyInfo: "Thong tin toi",
    activeRoomsTitle: "Phong dang chat",
    activeRoomsEmptyTitle: "Chua tham gia phong nao",
    activeRoomsEmptyCopy: "Phong ban dang tham gia se hien thi trong tab nay.",
    friendsTitle: "Danh sach ban be",
    friendsCopy: "Xem trang thai truc tuyen va moi nhanh vao phong hien tai.",
    friendsEmptyTitle: "Chua co ban be de hien thi",
    friendsEmptyCopy: "Nguoi dung khac sau khi vao se hien thi tai day.",
    myInfoTitle: "Thong tin cua toi",
    roomSearchPlaceholder: "Tim theo ten phong hoac nguoi tao",
    createRoomButton: "Tao phong",
    noRoomsTitle: "Chua co phong phu hop",
    noRoomsCopy: "Hay tao phong moi hoac xoa tu khoa tim kiem.",
    roomCreator: "Nguoi tao",
    roomParticipants: "Thanh vien",
    roomLastActivity: "Tin nhan cuoi",
    roomUnlocked: "Da mo truoc do",
    roomProtected: "Can mat khau",
    roomOpen: "Cong khai",
    roomPersistent: "Khong tu het han",
    roomExpired: "Da het han",
    unreadLabel: "Chua doc",
    chatWelcomeTitle: "Chao mung den voi TRANSCHAT",
    chatWelcomeCopy: "Chon mot phong de bat dau nhan tin, dich va gui loi moi ngay.",
    chatExpiredTitle: "Cuoc tro chuyen nay da het han va bi xoa",
    chatExpiredCopy: "Khong co tin nhan moi trong 30 phut, nen phong da dong tu dong. Thanh vien, tin nhan va media da duoc xoa.",
    chatHeaderCreator: "Nguoi tao",
    participantsButton: "Thanh vien",
    inviteButton: "Moi",
    leaveButton: "Roi phong",
    backToRooms: "Phong",
    expireCountdown: "Het han sau",
    expireTesting: "Nhanh hon 31 phut",
    noMessagesTitle: "Hay gui tin nhan dau tien",
    noMessagesCopy: "Chi tin nhan text hoac media moi lam moi bo dem het han cua phong.",
    showOriginal: "Xem ban goc",
    hideOriginal: "An ban goc",
    translationFailedBadge: "Dich that bai",
    translationPendingBadge: "Dang dich",
    translatedBadge: "Da dich tu dong",
    systemMessage: "He thong",
    statusComposing: "Dang soan",
    statusSent: "Da gui",
    statusRead: "Da doc",
    typingIndicator: "{name} dang nhap...",
    draftFailToggleOn: "Lan gui tiep theo se that bai dich",
    draftFailToggleOff: "Mo phong loi dich",
    composerPlaceholder: "Nhap bang ngon ngu me de cua ban. URL duoc nhan dien tu dong.",
    sendButton: "Gui",
    addPhoto: "Anh",
    addVideo: "Video",
    addFile: "Tap tin",
    attachmentImageReady: "Anh da san sang de gui",
    attachmentVideoReady: "Video da san sang de gui",
    attachmentFileReady: "Tap tin da san sang de gui",
    removeAttachment: "Xoa tep dinh kem",
    imageTooLarge: "Anh phai nho hon hoac bang 10MB.",
    videoTooLarge: "Video phai nho hon hoac bang 50MB.",
    imageCompressing: "Dang nen anh...",
    videoPreparing: "Dang chuan bi gui video...",
    mediaPreview: "Xem truoc",
    videoSessionOnly: "Xem truoc video chi ton tai trong phien hien tai.",
    linkOpen: "Mo lien ket",
    sideInvitesTitle: "Trung tam loi moi",
    sideInvitesCopy: "Xem loi moi den va ket qua gan day.",
    noInvitesTitle: "Chua co loi moi",
    noInvitesCopy: "Loi moi moi se hien thi tai day.",
    acceptInvite: "Chap nhan",
    rejectInvite: "Tu choi",
    inviteAccepted: "Da chap nhan",
    inviteRejected: "Da tu choi",
    invitePending: "Dang cho",
    inviteResultTitle: "Ket qua loi moi gan day",
    inviteResultEmpty: "Chua co ket qua loi moi.",
    sidePeopleTitle: "Thanh vien trong phong",
    sidePeopleCopy: "Xem ngon ngu va trang thai hien tai cua tung nguoi.",
    noParticipants: "Chua co ai trong phong nay.",
    presenceInRoom: "Trong phong",
    presenceOnline: "Truc tuyen",
    presenceOffline: "Ngoai tuyen",
    settingsTitle: "Cai dat",
    settingsCopy: "Doi ngon ngu giao dien, ngon ngu me de va giao dien sang toi ngay lap tuc.",
    themeLabel: "Giao dien",
    themeSystem: "He thong",
    themeLight: "Sang",
    themeDark: "Toi",
    settingsNativeLanguage: "Ngon ngu me de cua toi",
    settingsPreferredLanguage: "Ngon ngu tro chuyen uu tien",
    settingsUiLanguage: "Ngon ngu giao dien cua toi",
    settingsDemoSwitch: "Chuyen nguoi dung thu nghiem",
    settingsDemoSwitchCopy: "Huu ich khi muon thu luong loi moi nhanh trong mot trinh duyet.",
    settingsCurrentRoomTest: "Thu het han phong dang mo",
    settingsCurrentRoomTestCopy: "Dua moc tin nhan cuoi cua phong hien tai ve 31 phut truoc.",
    settingsReset: "Dat lai du lieu mau",
    settingsClose: "Dong",
    modalCreateRoomTitle: "Tao phong moi",
    modalCreateRoomCopy: "Nhap tieu de va mat khau de tao phong bao ve ngay lap tuc.",
    modalRoomTitle: "Tieu de phong",
    modalRoomPassword: "Mat khau",
    placeholderRoomTitle: "Vi du: Nhom hoc dem Seoul",
    placeholderRoomPassword: "Nhap mat khau phong",
    createConfirm: "Tao",
    cancel: "Huy",
    modalPasswordTitle: "Kiem tra mat khau",
    modalPasswordCopy: "Can mat khau de vao phong nay.",
    passwordError: "Mat khau khong dung.",
    passwordAttemptsLeft: "So lan con lai: {count}",
    passwordLocked: "Dang khoa nhap",
    passwordLockedCopy: "Mo khoa sau {time}.",
    enterRoomButton: "Vao phong",
    modalInviteTitle: "Moi nguoi dung",
    modalInviteCopy: "Nhap ten nguoi dung khac, loi moi se hien ngay trong trung tam loi moi cua ho.",
    inviteNameLabel: "Ten nguoi duoc moi",
    inviteNamePlaceholder: "Vi du: Alex",
    inviteSend: "Gui loi moi",
    inviteUserMissing: "Khong tim thay nguoi dung co ten nay.",
    inviteSelfError: "Ban khong the tu moi chinh minh.",
    inviteDuplicateError: "Da co mot loi moi dang cho.",
    inviteExpiredError: "Khong the moi vao phong da het han.",
    participantsModalTitle: "Danh sach thanh vien",
    participantsModalCopy: "Nguoi dung dang ket noi va cai dat ngon ngu cua phong nay.",
    mediaModalTitle: "Xem media",
    mediaModalClose: "Dong",
    toastEnter: "Da vao",
    toastEnterCopy: "Ban da bat dau voi ten {name}.",
    toastDuplicateName: "Da dieu chinh ten trung",
    toastDuplicateNameCopy: "Ten nay da ton tai nen duoc luu thanh {name}.",
    toastRoomCreated: "Da tao phong",
    toastRoomCreatedCopy: "Phong {title} da duoc them vao danh sach.",
    toastPasswordSuccess: "Da vao phong",
    toastPasswordSuccessCopy: "Ban da vao {title}.",
    toastInviteSent: "Da gui loi moi",
    toastInviteSentCopy: "{name} da nhan duoc loi moi.",
    toastInviteAccepted: "Loi moi da duoc chap nhan",
    toastInviteAcceptedCopy: "{name} da vao phong.",
    toastInviteRejected: "Loi moi bi tu choi",
    toastInviteRejectedCopy: "{name} da tu choi loi moi.",
    toastTranslationFailed: "Thu nghiem loi dich",
    toastTranslationFailedCopy: "Tin nhan nay se hien ban goc kem nhan that bai.",
    toastRoomExpired: "Phong da het han",
    toastRoomExpiredCopy: "{title} da het han va bi xoa.",
    toastAttachmentRemoved: "Da xoa tep dinh kem",
    toastAttachmentRemovedCopy: "Media da duoc xoa khoi ban nhap.",
    toastDemoReset: "Da dat lai du lieu mau",
    toastDemoResetCopy: "Ung dung da tro ve du lieu khoi tao.",
    toastUserSwitched: "Da doi nguoi dung",
    toastUserSwitchedCopy: "Ban dang dung tai khoan {name}.",
    toastNeedRoom: "Hay chon phong truoc",
    toastNeedRoomCopy: "Can co phong dang mo truoc khi gui tin nhan.",
    toastEmptyDraft: "Khong co noi dung de gui",
    toastEmptyDraftCopy: "Hay nhap tin nhan hoac dinh kem media.",
    toastInviteAction: "Da cap nhat loi moi",
    toastInviteActionCopy: "Trang thai loi moi da duoc luu.",
    toastRoomDeleted: "Da xoa phong",
    toastRoomDeletedCopy: "Phong {title} da bi xoa.",
    logoutButton: "Dang xuat",
    logoutCopy: "Xoa tai khoan hien tai va quay lai man hinh dau tien.",
    toastRoomLeft: "Da roi phong",
    toastRoomLeftCopy: "Ban da roi phong {title}.",
    toastRoomFastForward: "Da ap dung thu nghiem het han",
    toastRoomFastForwardCopy: "Phong hien tai duoc danh dau nhu khong hoat dong 31 phut.",
    toastMediaMissing: "Khong the tai media",
    toastMediaMissingCopy: "Can chuan bi lai xem truoc video sau khi tai lai trang.",
    toastMessageSent: "Da gui tin nhan",
    toastMessageSentCopy: "Ban dich tu dong va trang thai da doc se cap nhat lan luot.",
    toastNoUserSwitch: "Khong co nguoi dung de chuyen",
    toastNoUserSwitchCopy: "Hay tao them nguoi dung truoc.",
    friendInviteButton: "Moi vao phong hien tai",
    previewNotReady: "Dang chuan bi",
    previewNotReadyCopy: "Ban prototype nay chi mo phong cau truc nen video.",
    systemUserJoined: "{name} da vao phong.",
    systemUserLeft: "{name} da roi phong.",
    systemUserInvited: "{inviter} da moi {invitee}.",
    systemInviteAccepted: "{name} da chap nhan loi moi.",
    systemInviteRejected: "{name} da tu choi loi moi.",
    systemRoomExpired: "Cuoc tro chuyen nay da het han va bi xoa.",
    relativeJustNow: "Vua xong",
    relativeMinutesAgo: "{count} phut truoc",
    relativeHoursAgo: "{count} gio truoc",
    relativeDaysAgo: "{count} ngay truoc",
    remainingMinutes: "{count} phut",
    remainingSeconds: "{count} giay",
  };

  // Added: profile and connection UI copy without rebuilding the overall layout structure.
  Object.assign(DICTIONARY.ko, {
    tabFriends: "연결",
    landingNamePlaceholderSimple: "이름을 작성하세요",
    landingNativeLanguageLabel: "모국어",
    landingPhotoLabel: "프로필 사진",
    landingPhotoHelper: "사진이 없으면 기본 이미지가 적용됩니다.",
    profilePhotoChange: "사진 변경",
    profilePhotoRemove: "사진 삭제",
    profileNameLabel: "아이디",
    profileSaveButton: "저장",
    profileCardTitle: "내 프로필",
    profileListTitle: "등록된 사용자",
    toastProfileSaved: "프로필이 저장되었습니다",
    toastProfileSavedCopy: "아이디 변경이 반영되었습니다.",
    toastProfileNameTaken: "이미 사용 중인 이름입니다",
    toastProfileNameTakenCopy: "다른 아이디를 입력해 주세요.",
    toastProfileImageUpdated: "프로필 사진이 변경되었습니다",
    toastProfileImageUpdatedCopy: "새 프로필 이미지가 저장되었습니다.",
    toastProfileImageRemoved: "기본 프로필로 변경되었습니다",
    toastProfileImageRemovedCopy: "기본 실루엣 이미지가 적용되었습니다.",
    toastProfileImageInvalid: "이미지 파일만 사용할 수 있습니다",
    toastProfileImageInvalidCopy: "프로필에는 사진 파일만 업로드할 수 있습니다.",
    toastImageFormatInvalid: "지원되는 이미지 형식만 업로드할 수 있습니다",
    toastImageFormatInvalidCopy: "JPEG, PNG, WEBP 파일만 선택해 주세요.",
    toastProfileImageTooLarge: "프로필 사진 용량이 너무 큽니다",
    toastProfileImageTooLargeCopy: "프로필 사진은 5MB 이하로 선택해 주세요.",
    toastAccessDenied: "로그인이 필요합니다",
    toastAccessDeniedCopy: "계정을 확인한 뒤 다시 시도해주세요.",
    landingAccessHint: "계정을 만들거나 로그인한 뒤 바로 사용할 수 있습니다.",
    connectionInvite: "초대하기",
    connectionInvited: "초대 보냄",
    connectionActive: "대화중",
  });

  Object.assign(DICTIONARY.en, {
    tabFriends: "Connections",
    landingNamePlaceholderSimple: "Enter your name",
    landingNativeLanguageLabel: "Native language",
    landingPhotoLabel: "Profile photo",
    landingPhotoHelper: "If you skip this, the default silhouette is used.",
    profilePhotoChange: "Change photo",
    profilePhotoRemove: "Remove photo",
    profileNameLabel: "User ID",
    profileSaveButton: "Save",
    profileCardTitle: "My profile",
    profileListTitle: "Registered users",
    toastProfileSaved: "Profile saved",
    toastProfileSavedCopy: "Your user ID has been updated.",
    toastProfileNameTaken: "That name is already in use",
    toastProfileNameTakenCopy: "Choose a different user ID.",
    toastProfileImageUpdated: "Profile image updated",
    toastProfileImageUpdatedCopy: "Your new profile image has been saved.",
    toastProfileImageRemoved: "Default profile restored",
    toastProfileImageRemovedCopy: "The default silhouette is active again.",
    toastProfileImageInvalid: "Image files only",
    toastProfileImageInvalidCopy: "Only image uploads are supported for profile photos.",
    toastImageFormatInvalid: "Unsupported image format",
    toastImageFormatInvalidCopy: "Please select a JPEG, PNG, or WEBP image.",
    toastProfileImageTooLarge: "Profile image is too large",
    toastProfileImageTooLargeCopy: "Profile images must be 5MB or smaller.",
    toastAccessDenied: "Login required",
    toastAccessDeniedCopy: "Check your account information and try again.",
    landingAccessHint: "Create an account or sign in to start right away.",
    connectionInvite: "Invite",
    connectionInvited: "Invited",
    connectionActive: "In chat",
  });

  Object.assign(DICTIONARY.vi, {
    tabFriends: "Ket noi",
    landingNamePlaceholderSimple: "Nhap ten cua ban",
    landingNativeLanguageLabel: "Ngon ngu me de",
    landingPhotoLabel: "Anh dai dien",
    landingPhotoHelper: "Neu bo trong, anh mac dinh se duoc dung.",
    profilePhotoChange: "Doi anh",
    profilePhotoRemove: "Xoa anh",
    profileNameLabel: "ID nguoi dung",
    profileSaveButton: "Luu",
    profileCardTitle: "Ho so cua toi",
    profileListTitle: "Danh sach nguoi dung",
    toastProfileSaved: "Da luu ho so",
    toastProfileSavedCopy: "ID nguoi dung da duoc cap nhat.",
    toastProfileNameTaken: "Ten nay da duoc su dung",
    toastProfileNameTakenCopy: "Hay nhap mot ID khac.",
    toastProfileImageUpdated: "Da doi anh dai dien",
    toastProfileImageUpdatedCopy: "Anh dai dien moi da duoc luu.",
    toastProfileImageRemoved: "Da quay ve anh mac dinh",
    toastProfileImageRemovedCopy: "Anh bong nguoi mac dinh da duoc ap dung.",
    toastProfileImageInvalid: "Chi ho tro tep anh",
    toastProfileImageInvalidCopy: "Anh dai dien chi nhan tep hinh anh.",
    toastImageFormatInvalid: "Dinh dang anh khong duoc ho tro",
    toastImageFormatInvalidCopy: "Chi ho tro anh JPEG, PNG hoac WEBP.",
    toastProfileImageTooLarge: "Anh dai dien qua lon",
    toastProfileImageTooLargeCopy: "Anh dai dien phai nho hon hoac bang 5MB.",
    toastAccessDenied: "Can dang nhap",
    toastAccessDeniedCopy: "Hay kiem tra thong tin tai khoan roi thu lai.",
    landingAccessHint: "Tao tai khoan hoac dang nhap de bat dau ngay.",
    connectionInvite: "Moi",
    connectionInvited: "Da moi",
    connectionActive: "Dang tro chuyen",
  });

  const TRANSLATION_MEMORY = {
    hello: { ko: "안녕하세요", en: "hello", vi: "xin chao" },
    everyone: { ko: "모두", en: "everyone", vi: "moi nguoi" },
    thanks: { ko: "고마워요", en: "thanks", vi: "cam on" },
    tonight: { ko: "오늘 밤", en: "tonight", vi: "toi nay" },
    meeting: { ko: "회의", en: "meeting", vi: "cuoc hop" },
    coffee: { ko: "커피", en: "coffee", vi: "ca phe" },
    link: { ko: "링크", en: "link", vi: "lien ket" },
    project: { ko: "프로젝트", en: "project", vi: "du an" },
    helloEveryone: {
      ko: "안녕하세요 모두",
      en: "Hello everyone",
      vi: "Xin chao moi nguoi",
    },
    sharedLink: {
      ko: "회의 링크를 공유할게요",
      en: "I will share the meeting link",
      vi: "Minh se chia se lien ket cuoc hop",
    },
    travelPlan: {
      ko: "이번 주말 계획을 정해 봐요",
      en: "Let's decide this weekend's plan",
      vi: "Hay quyet dinh ke hoach cuoi tuan nay",
    },
    translationCheck: {
      ko: "번역 품질을 계속 개선하고 있습니다",
      en: "Translation quality continues to improve",
      vi: "Chat luong dich dang tiep tuc duoc cai thien",
    },
  };

  let appState = createInitialState();
  try {
    console.info("[transchat] bootstrap:state-load:start");
    appState = loadState();
    ensureSystemAccounts();
    syncUserAlertState();
    console.info("[transchat] bootstrap:state-load:complete", {
      users: (appState.users || []).length,
      rooms: (appState.rooms || []).length,
      invites: (appState.invites || []).length,
    });
  } catch (error) {
    reportBootstrapError(error, "state-load");
  }

  Object.assign(DICTIONARY.ko, {
    tabFriends: "연결",
    statusDelivered: "전달됨",
    loginButton: "로그인",
    signupButton: "회원가입",
    passwordChangeButton: "비밀번호 변경",
    authIdLabel: "아이디",
    authPasswordLabel: "비밀번호",
    authPasswordPlaceholder: "비밀번호를 입력하세요",
    authPasswordConfirmLabel: "비밀번호 확인",
    authPasswordConfirmPlaceholder: "비밀번호를 다시 입력하세요",
    authRecoveryQuestionLabel: "확인 질문",
    authRecoveryAnswerLabel: "정답",
    authRecoveryAnswerPlaceholder: "정답을 입력하세요",
    authRecoveryAnswerHelper: "띄어쓰기 없이 작성",
    authNewPasswordLabel: "새 비밀번호",
    authNewPasswordPlaceholder: "새 비밀번호를 입력하세요",
    signupCompleteButton: "가입 완료",
    nextButton: "다음",
    passwordUpdateButton: "변경 완료",
    authLoginNotFound: "등록된 아이디를 찾을 수 없습니다.",
    authLoginPasswordMismatch: "비밀번호가 일치하지 않습니다.",
    authNeedId: "아이디를 입력하세요.",
    authNeedPassword: "비밀번호를 입력하세요.",
    authPasswordMismatch: "비밀번호와 확인 값이 다릅니다.",
    authNeedRecoveryAnswer: "질문 정답을 입력하세요.",
    authRecoveryMismatch: "질문 정답이 일치하지 않습니다.",
    authSignupDuplicate: "이미 존재하는 아이디입니다.",
    toastSignupSuccess: "회원가입이 완료되었습니다",
    toastSignupSuccessCopy: "새 계정으로 바로 로그인되었습니다.",
    toastPasswordUpdated: "비밀번호가 변경되었습니다",
    toastPasswordUpdatedCopy: "새 비밀번호로 다시 로그인할 수 있습니다.",
    passwordResetFindIdHint: "아이디를 입력하면 등록된 질문이 표시됩니다.",
    recoveryFavoriteColor: "가장 좋아하는 색깔은?",
    recoveryChildhoodNickname: "어릴 때 별명은?",
    recoveryFavoriteAnimal: "가장 좋아하는 동물은?",
    recoveryMemorableFood: "기억에 남는 음식은?",
    recoveryFavoriteSeason: "좋아하는 계절은?",
    roomSettingsButton: "방 설정",
    roomSettingsCopy: "방 제목과 비밀번호를 수정할 수 있습니다.",
    roomPasswordLabel: "방 비밀번호",
    roomPasswordPlaceholder: "비밀번호를 입력하면 잠금이 설정됩니다.",
    applyButton: "적용",
    toastRoomSettingsSaved: "방 설정이 저장되었습니다",
    toastRoomSettingsSavedCopy: "{title} 설정이 반영되었습니다.",
    roomDeleteConfirm: "방을 나가시겠어요? 다른 참여자가 남아 있으면 방장은 자동으로 변경되고, 마지막 참여자면 방이 삭제됩니다.",
  });

  Object.assign(DICTIONARY.en, {
    tabFriends: "Connections",
    statusDelivered: "Delivered",
    loginButton: "Log in",
    signupButton: "Sign up",
    passwordChangeButton: "Change password",
    authIdLabel: "User ID",
    authPasswordLabel: "Password",
    authPasswordPlaceholder: "Enter your password",
    authPasswordConfirmLabel: "Confirm password",
    authPasswordConfirmPlaceholder: "Re-enter your password",
    authRecoveryQuestionLabel: "Verification question",
    authRecoveryAnswerLabel: "Answer",
    authRecoveryAnswerPlaceholder: "Enter your answer",
    authRecoveryAnswerHelper: "Write without spaces",
    authNewPasswordLabel: "New password",
    authNewPasswordPlaceholder: "Enter a new password",
    signupCompleteButton: "Create account",
    nextButton: "Next",
    passwordUpdateButton: "Update password",
    authLoginNotFound: "No account matches that ID.",
    authLoginPasswordMismatch: "The password does not match.",
    authNeedId: "Enter your user ID.",
    authNeedPassword: "Enter your password.",
    authPasswordMismatch: "Password and confirmation do not match.",
    authNeedRecoveryAnswer: "Enter the answer to your verification question.",
    authRecoveryMismatch: "The verification answer does not match.",
    authSignupDuplicate: "That user ID already exists.",
    toastSignupSuccess: "Account created",
    toastSignupSuccessCopy: "You are now logged in with the new account.",
    toastPasswordUpdated: "Password updated",
    toastPasswordUpdatedCopy: "You can now log in with the new password.",
    passwordResetFindIdHint: "Enter an ID to reveal its saved verification question.",
    recoveryFavoriteColor: "What is your favorite color?",
    recoveryChildhoodNickname: "What was your childhood nickname?",
    recoveryFavoriteAnimal: "What is your favorite animal?",
    recoveryMemorableFood: "Which food do you remember most?",
    recoveryFavoriteSeason: "What is your favorite season?",
    roomSettingsButton: "Room settings",
    roomSettingsCopy: "Update the room title and password.",
    roomPasswordLabel: "Room password",
    roomPasswordPlaceholder: "Leave blank to remove the password.",
    applyButton: "Apply",
    toastRoomSettingsSaved: "Room settings saved",
    toastRoomSettingsSavedCopy: "{title} has been updated.",
    roomDeleteConfirm: "Leave this room? If other participants remain, ownership is transferred automatically. If you are the last participant, the room is deleted.",
  });

  Object.assign(DICTIONARY.vi, {
    tabFriends: "Ket noi",
    statusDelivered: "Da chuyen",
    loginButton: "Dang nhap",
    signupButton: "Dang ky",
    passwordChangeButton: "Doi mat khau",
    authIdLabel: "ID",
    authPasswordLabel: "Mat khau",
    authPasswordPlaceholder: "Nhap mat khau",
    authPasswordConfirmLabel: "Xac nhan mat khau",
    authPasswordConfirmPlaceholder: "Nhap lai mat khau",
    authRecoveryQuestionLabel: "Cau hoi xac minh",
    authRecoveryAnswerLabel: "Cau tra loi",
    authRecoveryAnswerPlaceholder: "Nhap cau tra loi",
    authRecoveryAnswerHelper: "Viet lien, khong co khoang trang",
    authNewPasswordLabel: "Mat khau moi",
    authNewPasswordPlaceholder: "Nhap mat khau moi",
    signupCompleteButton: "Hoan tat dang ky",
    nextButton: "Tiep theo",
    passwordUpdateButton: "Cap nhat mat khau",
    authLoginNotFound: "Khong tim thay tai khoan phu hop.",
    authLoginPasswordMismatch: "Mat khau khong dung.",
    authNeedId: "Hay nhap ID.",
    authNeedPassword: "Hay nhap mat khau.",
    authPasswordMismatch: "Mat khau va phan xac nhan khong khop.",
    authNeedRecoveryAnswer: "Hay nhap cau tra loi xac minh.",
    authRecoveryMismatch: "Cau tra loi xac minh khong khop.",
    authSignupDuplicate: "ID nay da ton tai.",
    toastSignupSuccess: "Da tao tai khoan",
    toastSignupSuccessCopy: "Ban da dang nhap bang tai khoan moi.",
    toastPasswordUpdated: "Da doi mat khau",
    toastPasswordUpdatedCopy: "Bay gio ban co the dang nhap bang mat khau moi.",
    passwordResetFindIdHint: "Nhap ID de hien cau hoi xac minh da luu.",
    recoveryFavoriteColor: "Mau sac ban thich nhat la gi?",
    recoveryChildhoodNickname: "Biet danh luc nho cua ban la gi?",
    recoveryFavoriteAnimal: "Con vat ban thich nhat la gi?",
    recoveryMemorableFood: "Mon an ban nho nhat la gi?",
    recoveryFavoriteSeason: "Mua ban thich nhat la mua nao?",
    roomSettingsButton: "Cai dat phong",
    roomSettingsCopy: "Ban co the sua ten phong va mat khau.",
    roomPasswordLabel: "Mat khau phong",
    roomPasswordPlaceholder: "De trong neu muon bo mat khau.",
    applyButton: "Ap dung",
    toastRoomSettingsSaved: "Da luu cai dat phong",
    toastRoomSettingsSavedCopy: "{title} da duoc cap nhat.",
    roomDeleteConfirm: "Ban co muon roi phong khong? Neu van con nguoi trong phong, chu phong se duoc chuyen tu dong. Neu ban la nguoi cuoi cung, phong se bi xoa.",
  });

  // Added: login/signup/profile copy for the dedicated auth screens and compact profile editing flow.
  Object.assign(DICTIONARY.ko, {
    landingNamePlaceholderSimple: "아이디를 작성하세요",
    landingAuthSecondaryHint: "계정으로 로그인하면 바로 대화를 시작할 수 있습니다.",
    landingBackToLogin: "로그인으로 돌아가기",
    signupScreenTitle: "회원가입",
    signupScreenCopy: "계정 정보와 모국어를 설정하면 바로 입장할 수 있습니다.",
    resetScreenTitle: "비밀번호 변경",
    resetScreenCopy: "아이디와 확인 질문으로 본인 확인 후 새 비밀번호를 설정하세요.",
    authNameLabel: "이름",
    authNamePlaceholder: "이름을 작성하세요",
    authNicknameLabel: "닉네임",
    authNicknamePlaceholder: "닉네임을 작성하세요",
    authGenderLabel: "성별",
    authGenderMale: "남성",
    authGenderFemale: "여성",
    authAgeLabel: "나이",
    authAgePlaceholder: "나이를 입력하세요",
    authSignupNativeLanguageLabel: "모국어 설정",
    authInvalidIdTitle: "아이디 형식을 확인하세요",
    authInvalidIdCopy: "아이디는 영어와 숫자를 조합한 5자 이상이어야 합니다.",
    authInvalidPasswordTitle: "비밀번호 형식을 확인하세요",
    authInvalidPasswordCopy: "비밀번호는 8자 이상이며 영어, 숫자, 특수문자를 모두 포함해야 합니다.",
    authSignupNameRequired: "이름을 입력하세요.",
    authProfileSavedCopy: "기본 프로필이 저장되었습니다.",
    profileAccountIdLabel: "아이디",
    profileNameReadonlyLabel: "이름",
    profileNicknameLabel: "닉네임",
    profileGenderLabel: "성별",
    profileAgeLabel: "나이",
    profilePopupTitle: "기본 프로필",
    profilePopupName: "이름",
    profilePopupId: "아이디",
    profilePopupGender: "성별",
    profilePopupAge: "나이",
    profilePopupEmpty: "미설정",
  });

  Object.assign(DICTIONARY.en, {
    landingNamePlaceholderSimple: "Enter your ID",
    landingAuthSecondaryHint: "Sign in with your account and start chatting right away.",
    landingBackToLogin: "Back to login",
    signupScreenTitle: "Create account",
    signupScreenCopy: "Set your account details and native language before entering.",
    resetScreenTitle: "Change password",
    resetScreenCopy: "Verify your identity with your account ID and question before setting a new password.",
    authNameLabel: "Name",
    authNamePlaceholder: "Enter your name",
    authNicknameLabel: "Nickname",
    authNicknamePlaceholder: "Enter your nickname",
    authGenderLabel: "Gender",
    authGenderMale: "Male",
    authGenderFemale: "Female",
    authAgeLabel: "Age",
    authAgePlaceholder: "Enter your age",
    authSignupNativeLanguageLabel: "Native language",
    authInvalidIdTitle: "Check your user ID",
    authInvalidIdCopy: "Your user ID must be at least 5 characters and include both letters and numbers.",
    authInvalidPasswordTitle: "Check your password",
    authInvalidPasswordCopy: "Your password must be at least 8 characters and include letters, numbers, and special characters.",
    authSignupNameRequired: "Enter your name.",
    authProfileSavedCopy: "Your basic profile has been saved.",
    profileAccountIdLabel: "User ID",
    profileNameReadonlyLabel: "Name",
    profileNicknameLabel: "Nickname",
    profileGenderLabel: "Gender",
    profileAgeLabel: "Age",
    profilePopupTitle: "Basic profile",
    profilePopupName: "Name",
    profilePopupId: "User ID",
    profilePopupGender: "Gender",
    profilePopupAge: "Age",
    profilePopupEmpty: "Not set",
  });

  Object.assign(DICTIONARY.vi, {
    landingNamePlaceholderSimple: "Nhap ID cua ban",
    landingAuthSecondaryHint: "Dang nhap bang tai khoan cua ban de bat dau tro chuyen ngay.",
    landingBackToLogin: "Quay lai dang nhap",
    signupScreenTitle: "Dang ky",
    signupScreenCopy: "Hay cai dat thong tin tai khoan va ngon ngu me de truoc khi vao.",
    resetScreenTitle: "Doi mat khau",
    resetScreenCopy: "Nhap ID va cau hoi xac minh truoc khi dat mat khau moi.",
    authNameLabel: "Ten",
    authNamePlaceholder: "Nhap ten cua ban",
    authNicknameLabel: "Biet danh",
    authNicknamePlaceholder: "Nhap biet danh",
    authGenderLabel: "Gioi tinh",
    authGenderMale: "Nam",
    authGenderFemale: "Nu",
    authAgeLabel: "Tuoi",
    authAgePlaceholder: "Nhap tuoi",
    authSignupNativeLanguageLabel: "Ngon ngu me de",
    authInvalidIdTitle: "Hay kiem tra ID",
    authInvalidIdCopy: "ID phai co it nhat 5 ky tu va bao gom ca chu cai va so.",
    authInvalidPasswordTitle: "Hay kiem tra mat khau",
    authInvalidPasswordCopy: "Mat khau phai co it nhat 8 ky tu va bao gom chu cai, so, va ky tu dac biet.",
    authSignupNameRequired: "Hay nhap ten.",
    authProfileSavedCopy: "Da luu ho so co ban.",
    profileAccountIdLabel: "ID",
    profileNameReadonlyLabel: "Ten",
    profileNicknameLabel: "Biet danh",
    profileGenderLabel: "Gioi tinh",
    profileAgeLabel: "Tuoi",
    profilePopupTitle: "Ho so co ban",
    profilePopupName: "Ten",
    profilePopupId: "ID",
    profilePopupGender: "Gioi tinh",
    profilePopupAge: "Tuoi",
    profilePopupEmpty: "Chua cai dat",
  });

  Object.assign(DICTIONARY.ko, {
    authAutoLoginLabel: "자동로그인",
    translationMockBadge: "모의 번역",
    translationDisabledBadge: "번역 꺼짐",
    translationDisabledMode: "번역 꺼짐",
    translationIssueMode: "번역 오류",
  });

  Object.assign(DICTIONARY.en, {
    authAutoLoginLabel: "Auto login",
    translationMockBadge: "Mock translation",
    translationDisabledBadge: "Translation off",
    translationDisabledMode: "Translation off",
    translationIssueMode: "Translation issue",
  });

  Object.assign(DICTIONARY.vi, {
    authAutoLoginLabel: "Tu dong dang nhap",
    translationMockBadge: "Dich gia lap",
    translationDisabledBadge: "Da tat dich",
    translationDisabledMode: "Da tat dich",
    translationIssueMode: "Loi dich",
  });

  Object.assign(DICTIONARY.ko, {
    naturalTranslationBetaTitle: "자연스러운 번역",
    naturalTranslationBetaCopy: "최근 대화를 짧게 요약해 말투, 호칭, 관계 맥락을 번역에 반영합니다.",
  });

  Object.assign(DICTIONARY.en, {
    naturalTranslationBetaTitle: "Natural translation",
    naturalTranslationBetaCopy: "Uses a short recent-chat summary to keep tone, names, and relationship context more natural.",
  });

  Object.assign(DICTIONARY.vi, {
    naturalTranslationBetaTitle: "Ban dich tu nhien",
    naturalTranslationBetaCopy: "Tom tat ngan cuoc tro chuyen gan day de giu xung ho, giong dieu va boi canh quan he tu nhien hon.",
  });

  // Translation tone labels stay centralized so the composer menu can switch concepts without hardcoded UI copy.
  Object.assign(DICTIONARY.ko, {
    translationPendingInline: "번역 중...",
    translationUnavailableInline: "번역을 준비 중입니다.",
    translationConceptLabel: "번역 말투",
    translationConceptOffice: "사무",
    translationConceptGeneral: "일반",
    translationConceptFriend: "친구",
    translationConceptLover: "연인",
    dateYesterday: "어제",
  });

  Object.assign(DICTIONARY.en, {
    translationPendingInline: "Translating...",
    translationUnavailableInline: "Translation is being prepared.",
    translationConceptLabel: "Translation tone",
    translationConceptOffice: "Office",
    translationConceptGeneral: "Default",
    translationConceptFriend: "Friend",
    translationConceptLover: "Partner",
    dateYesterday: "Yesterday",
  });

  Object.assign(DICTIONARY.vi, {
    translationPendingInline: "Dang dich...",
    translationUnavailableInline: "Ban dich dang duoc chuan bi.",
    translationConceptLabel: "Sac thai ban dich",
    translationConceptOffice: "Cong viec",
    translationConceptGeneral: "Thong thuong",
    translationConceptFriend: "Ban be",
    translationConceptLover: "Nguoi yeu",
    dateYesterday: "Hom qua",
  });

  Object.assign(DICTIONARY.ko, {
    encodingCorruptedInline: "이 메시지는 인코딩 문제로 손상되었습니다.",
    encodingCorruptedBadge: "문자 손상",
  });

  Object.assign(DICTIONARY.en, {
    encodingCorruptedInline: "This message was damaged by an encoding issue.",
    encodingCorruptedBadge: "Text damaged",
  });

  Object.assign(DICTIONARY.vi, {
    encodingCorruptedInline: "Tin nhan nay da bi hong do loi ma hoa.",
    encodingCorruptedBadge: "Loi ma hoa",
  });

  // Added: plan/pricing copy stays in the central dictionary so the lightweight billing preview remains localizable.
  Object.assign(DICTIONARY.ko, {
    planSectionTitle: "현재 이용중인 플랜",
    planCurrentLabel: "현재 나의 플랜",
    planFreeLabel: "무료",
    planMonthlyLabel: "월 구독",
    planYearlyLabel: "연간 구독",
    planChangeButton: "변경하기",
    planModalTitle: "플랜 변경",
    planModalCopy: "실제 결제 연동 전 단계의 안내용 구독 화면입니다.",
    planMonthlyPrice: "월 {price}",
    planYearlyPrice: "연 {price}",
    planMonthlyCopyPrimary: "일반적인 개인 대화에 충분한 사용량 제공",
    planMonthlyCopySecondary: "과도한 자동화 또는 비정상적인 사용은 제한될 수 있음",
    planYearlyCopyPrimary: "월 구독 대비 할인된 요금",
    planYearlyCopySecondary: "일반적인 개인 대화에 충분한 사용량 제공",
    planApplyPreview: "테스트용 적용",
    planCurrentBadge: "현재 사용중",
    planCheckoutPlaceholder: "결제 연결 예정",
    planPolicyButton: "이용 정책 보기",
    planRemainingMessages: "오늘 무료 잔여 메시지: {count}개",
    planResetAt: "다음 초기화: {time}",
    planFreeExceededTitle: "오늘 무료 메시지 한도를 모두 사용했습니다.",
    planFreeExceededCopy: "다음 이용 가능 시간: {time}\n더 많이 사용하려면 플랜을 변경하세요.",
    planPremiumAbuseTitle: "일반적인 사용 범위를 초과했습니다.",
    planPremiumAbuseCopy: "안정적인 서비스 운영을 위해 사용량이 일시적으로 제한될 수 있습니다.\n자세한 내용은 이용 정책을 확인해 주세요.",
    planPolicyTitle: "이용 정책",
    planPolicyCopy: "무료 플랜은 일일 메시지 제한이 있으며, 유료 플랜은 일반 개인 대화 기준으로 넉넉하게 제공되지만 비정상적 자동화나 남용 사용은 제한될 수 있습니다. 실제 결제 단계에서는 이 정책에 동의하는 구조로 확장될 예정입니다.",
    planPremiumUsageCopy: "일반적인 개인 대화에 충분한 사용량 제공",
    planPremiumGuardCopy: "비정상적 자동화/과도 사용은 제한될 수 있음",
    planSoftLimitToast: "사용량이 많아지고 있습니다. 안정적인 서비스 운영을 위해 정책이 적용될 수 있습니다.",
    planUpdatedTitle: "플랜이 변경되었습니다",
    planUpdatedCopy: "현재 플랜 정보가 테스트 상태로 반영되었습니다.",
  });

  Object.assign(DICTIONARY.en, {
    planSectionTitle: "Current plan",
    planCurrentLabel: "My current plan",
    planFreeLabel: "Free",
    planMonthlyLabel: "Monthly",
    planYearlyLabel: "Yearly",
    planChangeButton: "Change",
    planModalTitle: "Change plan",
    planModalCopy: "This is a preview subscription screen before real payments are connected.",
    planMonthlyPrice: "{price} / month",
    planYearlyPrice: "{price} / year",
    planMonthlyCopyPrimary: "Enough usage for typical personal conversations",
    planMonthlyCopySecondary: "Excessive automation or abusive usage may be limited",
    planYearlyCopyPrimary: "Discounted compared with monthly billing",
    planYearlyCopySecondary: "Enough usage for typical personal conversations",
    planApplyPreview: "Apply for testing",
    planCurrentBadge: "Current",
    planCheckoutPlaceholder: "Checkout coming soon",
    planPolicyButton: "View usage policy",
    planRemainingMessages: "Free messages left today: {count}",
    planResetAt: "Next reset: {time}",
    planFreeExceededTitle: "You have used all free messages for today.",
    planFreeExceededCopy: "Next available time: {time}\nChange your plan for more usage.",
    planPremiumAbuseTitle: "Typical usage has been exceeded.",
    planPremiumAbuseCopy: "Usage may be limited temporarily for stable service operations.\nSee the usage policy for details.",
    planPolicyTitle: "Usage policy",
    planPolicyCopy: "The free plan includes a daily message limit. Paid plans are generous for normal personal conversations, but abusive automation or excessive usage may still be limited. The real payment flow can later require agreement to this policy.",
    planPremiumUsageCopy: "Enough usage for typical personal conversations",
    planPremiumGuardCopy: "Abusive automation or heavy usage may still be limited",
    planSoftLimitToast: "Usage is getting high. Service policies may apply to protect stability.",
    planUpdatedTitle: "Plan updated",
    planUpdatedCopy: "The current plan has been updated in preview mode.",
  });

  Object.assign(DICTIONARY.vi, {
    planSectionTitle: "Goi dang su dung",
    planCurrentLabel: "Goi hien tai cua toi",
    planFreeLabel: "Mien phi",
    planMonthlyLabel: "Goi thang",
    planYearlyLabel: "Goi nam",
    planChangeButton: "Thay doi",
    planModalTitle: "Thay doi goi",
    planModalCopy: "Day la man hinh goi cuoc mang tinh chat gioi thieu, truoc khi ket noi thanh toan that.",
    planMonthlyPrice: "{price} / thang",
    planYearlyPrice: "{price} / nam",
    planMonthlyCopyPrimary: "Du dung cho cac cuoc tro chuyen ca nhan thong thuong",
    planMonthlyCopySecondary: "Tu dong hoa qua muc hoac su dung bat thuong co the bi gioi han",
    planYearlyCopyPrimary: "Tiet kiem hon so voi goi thang",
    planYearlyCopySecondary: "Du dung cho cac cuoc tro chuyen ca nhan thong thuong",
    planApplyPreview: "Ap dung de test",
    planCurrentBadge: "Dang dung",
    planCheckoutPlaceholder: "Cho ket noi thanh toan",
    planPolicyButton: "Xem chinh sach",
    planRemainingMessages: "Tin nhan mien phi con lai hom nay: {count}",
    planResetAt: "Lan dat lai tiep theo: {time}",
    planFreeExceededTitle: "Ban da dung het so tin nhan mien phi hom nay.",
    planFreeExceededCopy: "Thoi gian dung lai: {time}\nHay doi goi neu muon dung nhieu hon.",
    planPremiumAbuseTitle: "Ban da vuot qua muc su dung thong thuong.",
    planPremiumAbuseCopy: "De giu he thong on dinh, viec su dung co the bi gioi han tam thoi.\nHay xem chinh sach de biet them.",
    planPolicyTitle: "Chinh sach su dung",
    planPolicyCopy: "Goi mien phi co gioi han tin nhan theo ngay. Goi tra phi du rong cho tro chuyen ca nhan thong thuong, nhung van co the gioi han neu co tu dong hoa bat thuong hoac lam dung. Sau nay luong thanh toan that co the yeu cau dong y voi chinh sach nay.",
    planPremiumUsageCopy: "Du dung cho cac cuoc tro chuyen ca nhan thong thuong",
    planPremiumGuardCopy: "Tu dong hoa bat thuong hoac su dung qua muc van co the bi gioi han",
    planSoftLimitToast: "Muc su dung dang tang cao. Chinh sach dich vu co the duoc ap dung de giu on dinh.",
    planUpdatedTitle: "Da doi goi",
    planUpdatedCopy: "Thong tin goi hien tai da duoc cap nhat o che do thu.",
  });

  Object.assign(DICTIONARY.ko, {
    adminDeleteUserButton: "계정 삭제",
    adminDeleteRoomButton: "방 삭제",
    adminAccountDeleteConfirm: "이 계정을 삭제하면 모든 기록이 완전히 삭제됩니다. 계속하시겠습니까?",
    adminRoomDeleteConfirm: "이 대화방과 모든 메시지를 삭제합니다. 계속할까요?",
    toastAccountDeleted: "계정이 삭제되었습니다",
    toastAccountDeletedCopy: "{name} 계정과 관련 데이터가 삭제되었습니다.",
    toastAdminSelfDeleteBlocked: "관리자 본인은 삭제할 수 없습니다",
    toastAdminSelfDeleteBlockedCopy: "admin 계정은 직접 삭제할 수 없습니다.",
    planUnlimitedTesterCopy: "무제한 사용 가능",
    adminProfileEditTitle: "사용자 정보 수정",
    adminProfilePasswordLabel: "비밀번호",
    adminProfileSaveButton: "저장",
  });

  Object.assign(DICTIONARY.en, {
    adminDeleteUserButton: "Delete account",
    adminDeleteRoomButton: "Delete room",
    adminAccountDeleteConfirm: "This deletes the account and all related records permanently. Continue?",
    adminRoomDeleteConfirm: "Delete this room and all of its messages?",
    toastAccountDeleted: "Account deleted",
    toastAccountDeletedCopy: "{name} and related data were deleted.",
    toastAdminSelfDeleteBlocked: "You cannot delete the admin account",
    toastAdminSelfDeleteBlockedCopy: "The admin account cannot delete itself.",
    planUnlimitedTesterCopy: "Unlimited access",
    adminProfileEditTitle: "Edit user profile",
    adminProfilePasswordLabel: "Password",
    adminProfileSaveButton: "Save",
  });

  Object.assign(DICTIONARY.vi, {
    adminDeleteUserButton: "Xoa tai khoan",
    adminDeleteRoomButton: "Xoa phong",
    adminAccountDeleteConfirm: "Neu xoa tai khoan nay, toan bo lich su lien quan se bi xoa vinh vien. Tiep tuc?",
    adminRoomDeleteConfirm: "Xoa phong chat nay va toan bo tin nhan?",
    toastAccountDeleted: "Da xoa tai khoan",
    toastAccountDeletedCopy: "Tai khoan {name} va du lieu lien quan da bi xoa.",
    toastAdminSelfDeleteBlocked: "Khong the xoa tai khoan admin",
    toastAdminSelfDeleteBlockedCopy: "Tai khoan admin khong the tu xoa chinh no.",
    planUnlimitedTesterCopy: "Su dung khong gioi han",
    adminProfileEditTitle: "Sua thong tin nguoi dung",
    adminProfilePasswordLabel: "Mat khau",
    adminProfileSaveButton: "Luu",
  });

  Object.assign(DICTIONARY.ko, {
    planRemainingMessages: "오늘 무료 체험 잔여 메시지: {count}개",
    planFreeTrialHint: "무료로 충분히 체험해보고 필요할 때 플랜 변경 가능",
    planMonthlyCopySecondary: "안정적인 서비스 운영을 위해 과도한 자동화/남용은 제한될 수 있음",
    planYearlyCopySecondary: "안정적인 서비스 운영을 위해 과도한 자동화/남용은 제한될 수 있음",
    planPremiumGuardCopy: "안정적인 서비스 운영을 위해 과도한 자동화/남용은 제한될 수 있음",
  });

  Object.assign(DICTIONARY.en, {
    planRemainingMessages: "Free trial messages left today: {count}",
    planFreeTrialHint: "Try the service comfortably for free and change your plan only if needed.",
    planMonthlyCopySecondary: "Heavy automation or abusive usage may still be limited for service stability.",
    planYearlyCopySecondary: "Heavy automation or abusive usage may still be limited for service stability.",
    planPremiumGuardCopy: "Heavy automation or abusive usage may still be limited for service stability.",
  });

  Object.assign(DICTIONARY.vi, {
    planRemainingMessages: "So tin nhan trai nghiem mien phi con lai hom nay: {count}",
    planFreeTrialHint: "Ban co the trai nghiem thoai mai mien phi va chi doi goi khi that su can.",
    planMonthlyCopySecondary: "De van hanh on dinh, tu dong hoa qua muc hoac lam dung co the bi gioi han.",
    planYearlyCopySecondary: "De van hanh on dinh, tu dong hoa qua muc hoac lam dung co the bi gioi han.",
    planPremiumGuardCopy: "De van hanh on dinh, tu dong hoa qua muc hoac lam dung co the bi gioi han.",
  });

  console.info("[transchat] dictionary:init:complete", Object.keys(DICTIONARY));

  function loadState() {
    cleanupLegacyBrowserStorage();
    hydrateRememberedLandingState();
    const parsed = readPersistedState();
    if (parsed) return parsed;

    const initialState = createInitialState();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(initialState));
    return initialState;
  }

  function readPersistedState() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return null;

    try {
      const parsed = JSON.parse(saved);
      return normalizeLoadedState(parsed);
    } catch (error) {
      console.warn("Failed to parse saved state", error);
      return null;
    }
  }

  function normalizeLoadedState(parsed) {
    if (!(parsed && [1, STATE_SCHEMA_VERSION].includes(Number(parsed.version || 0)))) {
      return null;
    }

    return sanitizeAppState(parsed);
  }

  function cleanupLegacyBrowserStorage() {
    try {
      const keysToRemove = [];
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (!key || !key.startsWith("transchat-") || KNOWN_LOCAL_STORAGE_KEYS.has(key)) continue;
        keysToRemove.push(key);
      }
      keysToRemove.forEach((key) => localStorage.removeItem(key));
    } catch (error) {
      console.warn("Failed to clean legacy browser storage", error);
    }
  }

  function hydrateRememberedLandingState() {
    try {
      const rememberedLoginId = localStorage.getItem(REMEMBERED_LOGIN_ID_KEY);
      if (rememberedLoginId && !uiState.landing.name) {
        uiState.landing.name = rememberedLoginId;
      }
    } catch (error) {
      console.warn("Failed to restore remembered login id", error);
    }
  }

  function readCachedPushRegistration() {
    try {
      return {
        token: localStorage.getItem(PUSH_TOKEN_CACHE_KEY) || "",
        userId: localStorage.getItem(PUSH_TOKEN_USER_KEY) || "",
        registeredAt: Number(localStorage.getItem(PUSH_TOKEN_REGISTERED_AT_KEY) || 0) || 0,
      };
    } catch (error) {
      return { token: "", userId: "", registeredAt: 0 };
    }
  }

  function readNativePushInstallState() {
    try {
      return {
        installId: localStorage.getItem(NATIVE_PUSH_INSTALL_ID_KEY) || "",
        userId: localStorage.getItem(NATIVE_PUSH_BOUND_USER_KEY) || "",
        boundAt: Number(localStorage.getItem(NATIVE_PUSH_BOUND_AT_KEY) || 0) || 0,
      };
    } catch (error) {
      return { installId: "", userId: "", boundAt: 0 };
    }
  }

  function persistCachedPushRegistration(userId, token, registeredAt = Date.now()) {
    if (!userId || !token) return;
    localStorage.setItem(PUSH_TOKEN_CACHE_KEY, token);
    localStorage.setItem(PUSH_TOKEN_USER_KEY, userId);
    localStorage.setItem(PUSH_TOKEN_REGISTERED_AT_KEY, String(Number(registeredAt || Date.now())));
    runtime.push.token = token;
    runtime.push.tokenUserId = userId;
    runtime.push.lastRegisterAt = Number(registeredAt || Date.now()) || Date.now();
  }

  function clearCachedPushRegistration() {
    localStorage.removeItem(PUSH_TOKEN_CACHE_KEY);
    localStorage.removeItem(PUSH_TOKEN_USER_KEY);
    localStorage.removeItem(PUSH_TOKEN_REGISTERED_AT_KEY);
    runtime.push.token = "";
    runtime.push.tokenUserId = "";
    runtime.push.lastRegisterAt = 0;
  }

  function persistNativePushInstallState(installId, userId = "", boundAt = Date.now()) {
    if (!installId) return;
    localStorage.setItem(NATIVE_PUSH_INSTALL_ID_KEY, installId);
    runtime.push.nativeInstallId = installId;
    if (userId) {
      localStorage.setItem(NATIVE_PUSH_BOUND_USER_KEY, userId);
      localStorage.setItem(NATIVE_PUSH_BOUND_AT_KEY, String(Number(boundAt || Date.now())));
      return;
    }
    localStorage.removeItem(NATIVE_PUSH_BOUND_USER_KEY);
    localStorage.removeItem(NATIVE_PUSH_BOUND_AT_KEY);
  }

  function clearNativePushBinding(options = {}) {
    const preserveInstallId = options.preserveInstallId !== false;
    if (!preserveInstallId) {
      localStorage.removeItem(NATIVE_PUSH_INSTALL_ID_KEY);
      runtime.push.nativeInstallId = "";
    }
    localStorage.removeItem(NATIVE_PUSH_BOUND_USER_KEY);
    localStorage.removeItem(NATIVE_PUSH_BOUND_AT_KEY);
  }

  function createSeedState() {
    const now = Date.now();
    const hana = createUser("Hana", "ko", "ko", now - 9 * 60 * 1000, null);
    const alex = createUser("Alex", "en", "en", now - 3 * 60 * 1000, "room-lounge");
    const linh = createUser("Linh", "vi", "vi", now - 1 * 60 * 1000, "room-lounge");
    const yuna = createUser("Yuna", "ko", "en", now - 18 * 60 * 1000, null);

    const loungeMessages = [
      systemMessage("sys-1", "systemUserJoined", { name: "Hana" }, now - 29 * 60 * 1000),
      systemMessage("sys-2", "systemUserJoined", { name: "Alex" }, now - 28 * 60 * 1000),
      userMessage(
        "msg-1",
        hana.id,
        "안녕하세요 모두",
        "ko",
        translateSeed("helloEveryone"),
        now - 26 * 60 * 1000,
        "read",
        null
      ),
      userMessage(
        "msg-2",
        alex.id,
        "I will share the meeting link https://meet.transchat.app/demo",
        "en",
        {
          ko: { text: "회의 링크를 공유할게요 https://meet.transchat.app/demo", failed: false },
          en: { text: "I will share the meeting link https://meet.transchat.app/demo", failed: false },
          vi: { text: "Minh se chia se lien ket cuoc hop https://meet.transchat.app/demo", failed: false },
        },
        now - 18 * 60 * 1000,
        "read",
        null
      ),
      userMessage(
        "msg-3",
        linh.id,
        "Chung ta dang thu chat luong dich",
        "vi",
        translateSeed("translationCheck"),
        now - 7 * 60 * 1000,
        "read",
        null
      ),
    ];

    const protectedMessages = [
      systemMessage("sys-4", "systemUserJoined", { name: "Alex" }, now - 45 * 60 * 1000),
      userMessage(
        "msg-4",
        alex.id,
        "Let's decide this weekend's plan",
        "en",
        translateSeed("travelPlan"),
        now - 24 * 60 * 1000,
        "read",
        null
      ),
      userMessage(
        "msg-5",
        yuna.id,
        "원문만 보여야 하는 실패 사례입니다",
        "ko",
        {
          ko: { text: "원문만 보여야 하는 실패 사례입니다", failed: false },
          en: { text: "원문만 보여야 하는 실패 사례입니다", failed: true },
          vi: { text: "원문만 보여야 하는 실패 사례입니다", failed: true },
        },
        now - 21 * 60 * 1000,
        "read",
        null
      ),
    ];

    const brainstormMessages = [
      systemMessage("sys-5", "systemUserJoined", { name: "Hana" }, now - 15 * 60 * 1000),
      userMessage(
        "msg-6",
        hana.id,
        "오늘 밤 커피 미팅 괜찮으세요?",
        "ko",
        {
          ko: { text: "오늘 밤 커피 미팅 괜찮으세요?", failed: false },
          en: { text: "Is a coffee meeting tonight okay?", failed: false },
          vi: { text: "Toi nay gap nhau uong ca phe duoc khong?", failed: false },
        },
        now - 10 * 60 * 1000,
        "read",
        null
      ),
    ];

    return {
      version: STATE_SCHEMA_VERSION,
      settings: {
        theme: "system",
      },
      users: [hana, alex, linh, yuna],
      invites: [
        {
          id: "invite-1",
          roomId: "room-lounge",
          inviterId: hana.id,
          inviteeId: yuna.id,
          status: "pending",
          createdAt: now - 4 * 60 * 1000,
          respondedAt: null,
        },
      ],
      rooms: [
        {
          id: "room-lounge",
          title: "Global Lounge",
          creatorId: hana.id,
          password: "",
          isProtected: false,
          participants: [hana.id, alex.id, linh.id],
          accessByUser: {},
          unreadByUser: { [yuna.id]: 2 },
          lastMessageAt: now - 7 * 60 * 1000,
          createdAt: now - 29 * 60 * 1000,
          status: "active",
          expiredAt: null,
          messages: loungeMessages,
        },
        {
          id: "room-travel",
          title: "Weekend Passport",
          creatorId: alex.id,
          password: "map123",
          isProtected: true,
          participants: [alex.id, yuna.id],
          accessByUser: { [alex.id]: true, [yuna.id]: true },
          unreadByUser: { [hana.id]: 1, [linh.id]: 1 },
          lastMessageAt: now - 21 * 60 * 1000,
          createdAt: now - 47 * 60 * 1000,
          status: "active",
          expiredAt: null,
          messages: protectedMessages,
        },
        {
          id: "room-brainstorm",
          title: "Night Shift Ideas",
          creatorId: hana.id,
          password: "",
          isProtected: false,
          participants: [hana.id],
          accessByUser: {},
          unreadByUser: {},
          lastMessageAt: now - 10 * 60 * 1000,
          createdAt: now - 15 * 60 * 1000,
          status: "active",
          expiredAt: null,
          messages: brainstormMessages,
        },
      ],
    };
  }

  function createUser(name, nativeLanguage, uiLanguage, lastSeenAt, currentRoomId, profileImage = null, accountOptions = {}) {
    const normalizedName = normalizeDisplayText(name).trim();
    const joinedAt = Number(accountOptions.joinedAt || Date.now());
    const normalizedLoginId = normalizeAccountId(accountOptions.loginId || normalizedName);
    const isAdmin = Boolean(accountOptions.isAdmin) || isAdminLoginId(normalizedLoginId);
    return {
      id: uid("user"),
      loginId: normalizedLoginId,
      name: normalizedName,
      nickname: normalizeDisplayText(accountOptions.nickname || "").trim(),
      gender: accountOptions.gender === "female" ? "female" : accountOptions.gender === "male" ? "male" : "",
      age: Number(accountOptions.age || 0) || "",
      profileImage,
      isAdmin,
      preferredTranslationConcept: normalizeTranslationConcept(accountOptions.preferredTranslationConcept),
      auth: {
        provider: "local",
        subject: normalizedLoginId || normalizeLoginIdentity(normalizedName),
        email: null,
        phoneNumber: null,
        phoneVerified: false,
      },
      blockedUserIds: [],
      nativeLanguage,
      preferredChatLanguage: nativeLanguage,
      uiLanguage,
      password: String(accountOptions.password || ""),
      recoveryQuestionKey: accountOptions.recoveryQuestionKey || accountOptions.recoveryQuestion || getDeterministicRecoveryQuestionKey(normalizedName),
      recoveryQuestion:
        accountOptions.recoveryQuestion || accountOptions.recoveryQuestionKey || getDeterministicRecoveryQuestionKey(normalizedName),
      recoveryAnswer: normalizeRecoveryAnswer(accountOptions.recoveryAnswer != null ? accountOptions.recoveryAnswer : normalizedName),
      joinedAt,
      lastSeenAt,
      currentRoomId,
      createdAt: joinedAt,
      lastLoginAt: Number(accountOptions.lastLoginAt || 0) || null,
      loginState: accountOptions.loginState === "online" ? "online" : "offline",
      hasUnreadInvites: Boolean(accountOptions.hasUnreadInvites),
      hasUnreadMessages: Boolean(accountOptions.hasUnreadMessages),
    };
  }

  function systemMessage(id, key, params, createdAt) {
    return {
      id,
      kind: "system",
      systemKey: key,
      systemParams: params,
      createdAt,
    };
  }

  function userMessage(
    id,
    senderId,
    originalText,
    sourceLanguage,
    translations,
    createdAt,
    status,
    media
  ) {
    return {
      id,
      kind: "user",
      senderId,
      createdAt,
      originalText,
      originalLanguage: sourceLanguage,
      sourceLanguage,
      translations,
      status,
      media,
      languageProfile: null,
      deliveredTo: {},
      readBy: {},
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
    const storedSourceLanguage = normalizeMessageLanguageCode(message.originalLanguage || message.sourceLanguage, "ko");
    const languageProfile = originalText ? buildMessageLanguageProfile(originalText, storedSourceLanguage, message.languageProfile) : createLanguageProfile(storedSourceLanguage);
    const sourceLanguage = languageProfile.primaryLanguage;
    const translations = sanitizeTranslations(message.translations, originalText, sourceLanguage);

    return {
      ...message,
      originalText,
      originalLanguage: sourceLanguage,
      sourceLanguage,
      languageProfile,
      status: ["composing", "sent", "delivered", "read"].includes(message.status) ? message.status : "sent",
      media: sanitizeMediaState(message.media),
      deliveredTo: filterRecordByAllowedKeys(message.deliveredTo, allowedUserIds),
      readBy: filterRecordByAllowedKeys(message.readBy, allowedUserIds),
      translations,
      translationMeta: sanitizeTranslationMeta(message.translationMeta, translations, sourceLanguage, languageProfile),
    };
  }

  function normalizeMessageLanguageCode(value, fallback = "ko") {
    const normalized = getTranslationVariantLanguage(value);
    if (normalized) return normalized;
    const fallbackLanguage = getTranslationVariantLanguage(fallback);
    return fallbackLanguage || "ko";
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

  function sanitizeTranslationMeta(meta, translations, sourceLanguage, languageProfile = null) {
    const requestedTargets = [...new Set(
      (Array.isArray(meta?.requestedTargets) ? meta.requestedTargets : Object.keys(translations || {}))
        .map((key) => String(key || "").trim())
        .filter((key) => {
          const language = getTranslationVariantLanguage(key);
          return Boolean(language) && shouldRequestTranslationForLanguage(language, sourceLanguage, languageProfile);
        })
    )];
    const provider = typeof meta?.provider === "string" ? meta.provider : "none";
    const live = Boolean(meta?.live);
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
      live,
      pending: state === "pending",
      state,
      reason: typeof meta?.reason === "string" ? meta.reason : null,
      errorDetail: typeof meta?.errorDetail === "string" ? meta.errorDetail : null,
      requestedTargets,
      startedAt: Number(meta?.startedAt || 0) || null,
      completedAt: Number(meta?.completedAt || 0) || null,
    };
  }

  function sanitizeMediaState(media) {
    if (!media || !isChatMediaKind(media.kind)) {
      return media || null;
    }

    return {
      ...media,
      mediaId: String(media.mediaId || "").trim() || null,
      mimeType: String(media.mimeType || "").trim(),
      uploadedAt: Number(media.uploadedAt || Date.now()),
      expiresAt: Number(media.expiresAt || 0) || null,
      expired: Boolean(media.expired) || isMediaExpired(media),
      storage: media.storage === "indexeddb" ? "indexeddb" : media.storage === "draft" ? "draft" : media.storage,
    };
  }

  function translateSeed(key) {
    const item = TRANSLATION_MEMORY[key];
    return {
      ko: { text: item.ko, failed: false },
      en: { text: item.en, failed: false },
      vi: { text: item.vi, failed: false },
    };
  }

  function createInitialState() {
    return {
      version: STATE_SCHEMA_VERSION,
      settings: {
        theme: "system",
      },
      users: [],
      invites: [],
      rooms: [],
      deletedUsers: {},
      deletedRooms: {},
      updatedAt: Date.now(),
    };
  }

  function sanitizeAppState(parsed) {
    const deletedUsers = sanitizeDeletedUsers(parsed?.deletedUsers);
    const deletedUserIds = new Set(Object.keys(deletedUsers));
    const deletedRooms = sanitizeDeletedRooms(parsed?.deletedRooms);
    const deletedRoomIds = new Set(Object.keys(deletedRooms));
    const nextState = {
      ...parsed,
      version: STATE_SCHEMA_VERSION,
      settings: {
        theme: parsed?.settings?.theme || "system",
      },
      deletedUsers,
      deletedRooms,
      updatedAt: Number(parsed.updatedAt || Date.now()),
    };

    const users = (parsed.users || [])
      .filter((user) => !deletedUserIds.has(user.id))
      .map((user) => {
        const normalizedLoginId = normalizeAccountId(user?.loginId || user?.name);
        const normalizedName = normalizeDisplayText(user.name);
        const isAdmin = Boolean(user?.isAdmin) || isAdminLoginId(normalizedLoginId);
        return {
          ...user,
          loginId: normalizedLoginId,
          name: normalizedName,
          nickname: normalizeDisplayText(user?.nickname || "").trim(),
          gender: user?.gender === "female" ? "female" : user?.gender === "male" ? "male" : "",
          age: Number(user?.age || 0) || "",
          isAdmin,
          auth: {
            provider: user?.auth?.provider || "local",
            subject: user?.auth?.subject || normalizedLoginId,
            email: user?.auth?.email || null,
            phoneNumber: user?.auth?.phoneNumber || null,
            phoneVerified: Boolean(user?.auth?.phoneVerified),
          },
          blockedUserIds: Array.isArray(user?.blockedUserIds) ? user.blockedUserIds : [],
          preferredChatLanguage: user.preferredChatLanguage || user.nativeLanguage || "ko",
          preferredTranslationConcept: normalizeTranslationConcept(user?.preferredTranslationConcept),
          password: typeof user?.password === "string" ? user.password : "",
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
        };
      });
    const userIds = new Set(users.map((user) => user.id));

    const rooms = (parsed.rooms || [])
      .filter((room) => !deletedRoomIds.has(room.id) && !shouldDiscardRoom(room))
      .map((room) => {
        const persistent = isPersistentRoom(room);
        const participants = deriveRoomParticipantIds(room, users);
        return {
          ...room,
          title: normalizeDisplayText(room.title),
          disableExpiration: CONFIG.roomAutoExpirationEnabled ? persistent : true,
          status: !CONFIG.roomAutoExpirationEnabled || (persistent && room.status === "expired") ? "active" : room.status,
          expiredAt: CONFIG.roomAutoExpirationEnabled && !persistent ? room.expiredAt || null : null,
          participants,
          accessByUser: filterRecordByAllowedKeys(room.accessByUser, userIds),
          unreadByUser: filterRecordByAllowedKeys(room.unreadByUser, userIds),
          messages: (room.messages || []).map((message) => sanitizeMessageState(message, userIds)),
        };
      });
    const roomIds = new Set(rooms.map((room) => room.id));

    nextState.users = users.map((user) => ({
      ...user,
      currentRoomId: roomIds.has(user.currentRoomId) ? user.currentRoomId : null,
    }));
    nextState.rooms = rooms;
    nextState.invites = (parsed.invites || [])
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
        previewRoomTitle: normalizeDisplayText(invite?.previewRoomTitle || ""),
        status: ["pending", "accepted", "rejected"].includes(invite?.status) ? invite.status : "pending",
        respondedAt: Number(invite?.respondedAt || 0) || null,
        seenByInvitee: Boolean(invite?.seenByInvitee),
      }));

    return nextState;
  }

  function shouldDiscardRoom(room) {
    if (!CONFIG.roomAutoExpirationEnabled) {
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

  function deriveRoomParticipantIds(room, users = appState.users || []) {
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

  function uid(prefix) {
    return `${prefix}-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
  }

  function persistState(options = {}) {
    // Prototype policy note: chats and inline image previews live in local/browser state until a room is deleted or expires.
    syncSpecialUserFlags();
    syncUserAlertState();
    if (options.touchUpdatedAt !== false) {
      appState.updatedAt = Date.now();
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
    broadcastStateRefresh();
    if (options.syncToServer !== false) {
      scheduleServerStateSync(options.syncDelayMs);
    }
  }

  function broadcastStateRefresh() {
    if (!runtime.syncChannel) return;
    runtime.syncChannel.postMessage({
      type: "state-updated",
      sourceId: runtime.clientId,
      at: Date.now(),
    });
  }

  function syncUiWithCurrentUserState() {
    const currentUser = getCurrentUser();
    if (!currentUser) {
      if (tryRemapActiveUserIdentity()) {
        return;
      }
      if (getActiveUserId()) {
        clearAutoLoginState();
        setActiveUserId(null);
      }
      uiState.activeRoomId = null;
      return;
    }

    if (currentUser.currentRoomId) {
      uiState.activeRoomId = currentUser.currentRoomId;
      return;
    }

    if (uiState.activeRoomId && !appState.rooms.some((room) => room.id === uiState.activeRoomId)) {
      uiState.activeRoomId = null;
      uiState.directoryTab = "chat";
      uiState.chatDetailsOpen = false;
      uiState.attachmentMenuOpen = false;
    }
  }

  function applyPersistedState() {
    const persisted = readPersistedState();
    if (!persisted) return;
    applyStateSnapshot(persisted, { source: "storage", skipPersist: true });
  }

  function reconcileServerSnapshot(nextState) {
    const activeUserId = getActiveUserId();
    if (!activeUserId) {
      return { state: nextState, mergedLocalActiveUser: false };
    }

    if ((nextState.users || []).some((user) => user.id === activeUserId)) {
      return { state: nextState, mergedLocalActiveUser: false };
    }

    if (nextState.deletedUsers?.[activeUserId]) {
      clearAutoLoginState();
      setActiveUserId(null);
      return { state: nextState, mergedLocalActiveUser: false };
    }

    const localCurrentUser = appState.users.find((user) => user.id === activeUserId);
    if (!localCurrentUser) {
      if (tryRemapActiveUserIdentity(nextState)) {
        return { state: nextState, mergedLocalActiveUser: false };
      }
      return { state: nextState, mergedLocalActiveUser: false };
    }

    const serverIdentityMatch = findUserByLoginName(localCurrentUser.loginId || localCurrentUser.name, nextState.users || []);
    if (serverIdentityMatch) {
      setActiveUserId(serverIdentityMatch.id);
      const remembered = readAutoLoginState();
      if (remembered?.loginId) {
        persistAutoLoginState(serverIdentityMatch);
      }
      return { state: nextState, mergedLocalActiveUser: false };
    }

    const localActivityAt = Number(localCurrentUser.lastSeenAt || localCurrentUser.lastLoginAt || 0);
    const localLooksFresh = localActivityAt > 0 && Date.now() - localActivityAt < 5 * 60 * 1000;
    if (!localLooksFresh || getStateTimestamp(nextState) >= localActivityAt) {
      return { state: nextState, mergedLocalActiveUser: false };
    }

    const mergedState = sanitizeAppState({
      ...nextState,
      version: STATE_SCHEMA_VERSION,
      users: [...(nextState.users || []), localCurrentUser],
      updatedAt: Math.max(getStateTimestamp(nextState), Number(localCurrentUser.lastSeenAt || 0), Date.now()),
    });

    return {
      state: mergedState || nextState,
      mergedLocalActiveUser: true,
    };
  }

  function syncPresenceSignalsWithAppState() {
    const knownUserIds = new Set((appState.users || []).map((user) => user.id));
    Object.keys(runtime.presenceSignals).forEach((userId) => {
      if (!knownUserIds.has(userId)) {
        delete runtime.presenceSignals[userId];
      }
    });

    (appState.users || []).forEach((user) => {
      const existingSignal = runtime.presenceSignals[user.id];
      if (user.loginState === "offline") {
        runtime.presenceSignals[user.id] = {
          userId: user.id,
          currentRoomId: null,
          lastSeenAt: Number(user.lastSeenAt || existingSignal?.lastSeenAt || Date.now()),
          loginState: "offline",
        };
        return;
      }

      if (!existingSignal) return;
      runtime.presenceSignals[user.id] = {
        ...existingSignal,
        currentRoomId: user.currentRoomId || existingSignal.currentRoomId || null,
        lastSeenAt: Math.max(Number(existingSignal.lastSeenAt || 0), Number(user.lastSeenAt || 0)),
        loginState: user.loginState === "online" ? "online" : existingSignal.loginState || "offline",
      };
    });
  }

  function applyStateSnapshot(nextState, options = {}) {
    const previousActiveRoom = appState.rooms.find((room) => room.id === uiState.activeRoomId) || null;
    let snapshot = nextState;
    let mergedLocalActiveUser = false;
    if (options.source === "server") {
      const reconciled = reconcileServerSnapshot(nextState);
      snapshot = reconciled.state;
      mergedLocalActiveUser = reconciled.mergedLocalActiveUser;
    }

    appState = snapshot;
    if (options.source === "server") {
      runtime.lastAppliedServerStateAt = Math.max(
        Number(runtime.lastAppliedServerStateAt || 0),
        getStateTimestamp(snapshot)
      );
    }
    if (!options.skipPersist) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
    }
    syncPresenceSignalsWithAppState();
    syncUiWithCurrentUserState();
    if (previousActiveRoom && !appState.rooms.some((room) => room.id === previousActiveRoom.id)) {
      pushToast("toastRoomDeleted", "toastRoomDeletedCopy", { title: previousActiveRoom.title });
    }
    if (mergedLocalActiveUser) {
      scheduleServerStateSync();
    }
    const traceMessage = getLatestUserMessageForTrace(appState);
    if (traceMessage) {
      logEncodingTrace("client-render-ready", traceMessage.text, {
        roomId: traceMessage.roomId,
        messageId: traceMessage.messageId,
        source: options.source || "local",
      });
    }
    if (options.source === "server" && shouldDeferNonCriticalRender()) {
      renderSafelyDuringInput();
    } else {
      render();
    }
    return true;
  }

  function scheduleServerStateSync(delay = 120) {
    if (!shouldUseTranslationBackend()) return;
    runtime.serverSyncQueued = true;
    clearTimeout(runtime.serverSyncTimer);
    runtime.serverSyncTimer = setTimeout(() => {
      runtime.serverSyncTimer = null;
      void syncStateToServer();
    }, Math.max(0, Number(delay) || 0));
  }

  function flushServerStateSync() {
    if (!shouldUseTranslationBackend()) return;
    runtime.serverSyncQueued = true;
    clearTimeout(runtime.serverSyncTimer);
    runtime.serverSyncTimer = null;
    void syncStateToServer();
  }

  async function syncStateToServer() {
    if (!shouldUseTranslationBackend()) return;
    if (runtime.serverSyncInFlight) {
      runtime.serverSyncQueued = true;
      return;
    }

    const stateSnapshot = appState;
    const stateTimestamp = getStateTimestamp(stateSnapshot);
    const payload = JSON.stringify({
      state: stateSnapshot,
      sourceId: runtime.clientId,
    });
    const payloadBytes = new TextEncoder().encode(payload).length;
    runtime.serverSyncInFlight = true;
    runtime.serverSyncQueued = false;

    try {
      const traceMessage = getLatestUserMessageForTrace(stateSnapshot);
      if (traceMessage) {
        logEncodingTrace("client-state-payload", traceMessage.text, {
          roomId: traceMessage.roomId,
          messageId: traceMessage.messageId,
        });
      }
      // Sync note: the local Node server mirrors app state; replace this with DB-backed access control in production.
      const response = await fetch(CONFIG.stateApiPath, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: payload,
      });

      if (!response.ok) {
        throw new Error(`State sync failed with ${response.status}`);
      }
      runtime.serverSyncBackoffMs = 0;
      runtime.lastSuccessfulServerSyncAt = Math.max(runtime.lastSuccessfulServerSyncAt || 0, stateTimestamp);
    } catch (error) {
      runtime.serverSyncQueued = true;
      runtime.serverSyncBackoffMs = runtime.serverSyncBackoffMs
        ? Math.min(runtime.serverSyncBackoffMs * 2, 5000)
        : 800;
      console.warn("Failed to sync state to server", {
        error: String(error?.message || error),
        stateTimestamp,
        payloadBytes,
      });
    } finally {
      runtime.serverSyncInFlight = false;
      if (runtime.serverSyncQueued || getStateTimestamp(appState) > stateTimestamp) {
        scheduleServerStateSync(runtime.serverSyncBackoffMs || 120);
      }
    }
  }

  async function fetchServerState() {
    if (!shouldUseTranslationBackend()) return null;

    try {
      const response = await fetch(CONFIG.stateApiPath, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`State fetch failed with ${response.status}`);
      }

      const payload = await response.json();
      return normalizeLoadedState(payload?.state);
    } catch (error) {
      return null;
    }
  }

  async function pollServerStateIfNeeded(options = {}) {
    if (!shouldUseTranslationBackend() || document.hidden) return false;
    if (!runtime.backend.serverReachable && !options.force) return false;
    const now = Date.now();
    if (!options.force && now - Number(runtime.lastServerStatePollAt || 0) < 900) {
      return false;
    }
    runtime.lastServerStatePollAt = now;
    const serverState = await fetchServerState();
    if (!serverState) return false;
    if (!options.force && getStateTimestamp(serverState) <= Number(runtime.lastAppliedServerStateAt || 0)) {
      return false;
    }
    applyStateSnapshot(serverState, { source: "server" });
    return true;
  }

  async function refreshServerStateAfterResume(options = {}) {
    if (!shouldUseTranslationBackend()) {
      if (options.renderIfUnchanged) {
        renderSafelyDuringInput();
      }
      return false;
    }
    if (runtime.resumeStateSyncPromise) {
      return runtime.resumeStateSyncPromise;
    }

    runtime.resumeStateSyncPromise = (async () => {
      const applied = await pollServerStateIfNeeded({ force: true });
      if (!applied && options.renderIfUnchanged) {
        renderSafelyDuringInput();
      }
      return applied;
    })().finally(() => {
      runtime.resumeStateSyncPromise = null;
    });

    return runtime.resumeStateSyncPromise;
  }

  function getStateTimestamp(state) {
    return Number(state?.updatedAt || 0);
  }

  function getStateRosterFingerprint(state) {
    return getCanonicalUsersForDisplay(state?.users || [])
      .map((user) => normalizeAccountId(user.loginId || user.name))
      .filter(Boolean)
      .sort()
      .join("|");
  }

  function shouldPreferServerState(serverState, localState) {
    const serverTimestamp = getStateTimestamp(serverState);
    const localTimestamp = getStateTimestamp(localState);
    if (serverTimestamp >= localTimestamp) return true;

    const serverRoster = getStateRosterFingerprint(serverState);
    const localRoster = getStateRosterFingerprint(localState);
    if (serverRoster && serverRoster !== localRoster && (serverState.users || []).length >= (localState.users || []).length) {
      return true;
    }

    const remembered = readAutoLoginState();
    const activeIdentity = normalizeAccountId(getCurrentUser()?.loginId || remembered?.loginId || "");
    if (activeIdentity) {
      const serverHasIdentity = Boolean(findUserByLoginName(activeIdentity, serverState.users || []));
      if (serverHasIdentity && serverRoster !== localRoster) {
        return true;
      }
    }

    return false;
  }

  async function bootstrapServerState() {
    const serverState = await fetchServerState();
    if (serverState) {
      const serverIsEmpty =
        !(serverState.users || []).length &&
        !(serverState.rooms || []).length &&
        !(serverState.invites || []).length;
      const localHasData =
        Boolean((appState.users || []).length) ||
        Boolean((appState.rooms || []).length) ||
        Boolean((appState.invites || []).length);

      if (!serverIsEmpty && shouldPreferServerState(serverState, appState)) {
        applyStateSnapshot(serverState, { source: "server" });
        if (!getCurrentUser()) {
          restoreAutoLoginSession();
        }
        return;
      }

      if (serverIsEmpty && !localHasData) {
        applyStateSnapshot(serverState, { source: "server" });
        if (!getCurrentUser()) {
          restoreAutoLoginSession();
        }
        return;
      }
    }

    if (!getCurrentUser()) {
      restoreAutoLoginSession();
    }
    scheduleServerStateSync();
  }

  function getActiveUserId() {
    return sessionStorage.getItem(SESSION_USER_KEY);
  }

  function setActiveUserId(userId) {
    if (userId) {
      sessionStorage.setItem(SESSION_USER_KEY, userId);
    } else {
      sessionStorage.removeItem(SESSION_USER_KEY);
    }
  }

  function persistAutoLoginState(user) {
    if (!user?.id) return;
    const payload = {
      version: STATE_SCHEMA_VERSION,
      userId: user.id,
      loginId: user.loginId || user.name,
      savedAt: Date.now(),
    };
    localStorage.setItem(AUTO_LOGIN_KEY, JSON.stringify(payload));
    localStorage.setItem(REMEMBERED_LOGIN_ID_KEY, payload.loginId);
  }

  function clearAutoLoginState(options = {}) {
    localStorage.removeItem(AUTO_LOGIN_KEY);
    if (options.keepRememberedId) return;
    localStorage.removeItem(REMEMBERED_LOGIN_ID_KEY);
  }

  function syncAutoLoginPreference(user, shouldRemember) {
    if (shouldRemember) {
      persistAutoLoginState(user);
      return;
    }
    clearAutoLoginState();
  }

  function readAutoLoginState() {
    const raw = localStorage.getItem(AUTO_LOGIN_KEY);
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw);
      return {
        userId: String(parsed?.userId || "").trim(),
        loginId: normalizeAccountId(parsed?.loginId || ""),
      };
    } catch (error) {
      console.warn("Failed to parse auto login state", error);
      clearAutoLoginState();
      return null;
    }
  }

  function restoreAutoLoginSession(options = {}) {
    if (getActiveUserId()) return false;
    const remembered = readAutoLoginState();
    if (!remembered?.userId && !remembered?.loginId) return false;

    const user =
      appState.users.find((item) => item.id === remembered.userId) ||
      findUserByLoginName(remembered.loginId, appState.users || []) ||
      null;

    if (!user || appState.deletedUsers?.[user.id]) {
      if (options.clearOnMissing !== false) {
        clearAutoLoginState();
      }
      return false;
    }

    uiState.landing.autoLogin = true;
    uiState.landing.uiLanguage = user.uiLanguage || uiState.landing.uiLanguage || "ko";
    persistAutoLoginState(user);
    completeLandingLogin(user, {
      toastKey: false,
      preserveStoredUiLanguage: true,
      autoLogin: true,
    });
    return true;
  }

  function getCurrentUser() {
    const userId = getActiveUserId();
    if (!userId) return null;
    return appState.users.find((user) => user.id === userId) || null;
  }

  function getNativePushInstallId() {
    if (runtime.push.nativeInstallId) {
      return runtime.push.nativeInstallId;
    }
    const cached = readNativePushInstallState();
    runtime.push.nativeInstallId = cached.installId || "";
    return runtime.push.nativeInstallId;
  }

  function getUserIdentityScore(user) {
    if (!user) return 0;
    const onlineBoost = user.loginState === "online" ? 1_000_000_000_000 : 0;
    const lastSeen = Number(user.lastSeenAt || 0);
    const lastLogin = Number(user.lastLoginAt || 0);
    const joinedAt = Number(user.joinedAt || user.createdAt || 0);
    const completionBoost =
      (user.profileImage ? 5_000 : 0) +
      (user.gender ? 1_000 : 0) +
      (user.age ? 1_000 : 0) +
      (user.currentRoomId ? 2_000 : 0);
    return onlineBoost + Math.max(lastSeen, lastLogin, joinedAt) + completionBoost;
  }

  function mergeUserIdentityRecords(primary, secondary) {
    if (!primary) return secondary || null;
    if (!secondary) return primary;

    const preferred = getUserIdentityScore(primary) >= getUserIdentityScore(secondary) ? primary : secondary;
    const fallback = preferred === primary ? secondary : primary;
    return {
      ...fallback,
      ...preferred,
      id: preferred.id,
      loginId: preferred.loginId || fallback.loginId,
      name: preferred.name || fallback.name,
      password: preferred.password || fallback.password || "",
      profileImage: preferred.profileImage || fallback.profileImage || null,
      gender: preferred.gender || fallback.gender || "",
      age: preferred.age || fallback.age || "",
      nativeLanguage: preferred.nativeLanguage || fallback.nativeLanguage || "ko",
      preferredChatLanguage:
        preferred.preferredChatLanguage ||
        fallback.preferredChatLanguage ||
        preferred.nativeLanguage ||
        fallback.nativeLanguage ||
        "ko",
      preferredTranslationConcept: preferred.preferredTranslationConcept || fallback.preferredTranslationConcept || DEFAULT_TRANSLATION_CONCEPT,
      uiLanguage: preferred.uiLanguage || fallback.uiLanguage || "ko",
      joinedAt: Math.min(Number(primary.joinedAt || primary.createdAt || Date.now()), Number(secondary.joinedAt || secondary.createdAt || Date.now())),
      lastSeenAt: Math.max(Number(primary.lastSeenAt || 0), Number(secondary.lastSeenAt || 0)),
      lastLoginAt: Math.max(Number(primary.lastLoginAt || 0), Number(secondary.lastLoginAt || 0)) || null,
      loginState: primary.loginState === "online" || secondary.loginState === "online" ? "online" : "offline",
      hasUnreadInvites: Boolean(primary.hasUnreadInvites || secondary.hasUnreadInvites),
      hasUnreadMessages: Boolean(primary.hasUnreadMessages || secondary.hasUnreadMessages),
      currentRoomId: preferred.currentRoomId || fallback.currentRoomId || null,
      isAdmin: Boolean(primary.isAdmin || secondary.isAdmin),
    };
  }

  function buildCanonicalUserMap(users = []) {
    const canonical = new Map();
    (users || []).forEach((user) => {
      const key = normalizeAccountId(user?.loginId || user?.name || user?.id);
      if (!key) return;
      const existing = canonical.get(key);
      canonical.set(key, existing ? mergeUserIdentityRecords(existing, user) : user);
    });
    return canonical;
  }

  function getCanonicalUsersForDisplay(users = []) {
    return [...buildCanonicalUserMap(users).values()];
  }

  function tryRemapActiveUserIdentity(stateOverride = null) {
    const activeUserId = getActiveUserId();
    if (!activeUserId) return false;

    const remembered = readAutoLoginState();
    const localActive = appState.users.find((user) => user.id === activeUserId) || null;
    const identity = normalizeAccountId(remembered?.loginId || localActive?.loginId || localActive?.name);
    if (!identity) return false;

    const pool = stateOverride?.users || appState.users || [];
    const replacement = findUserByLoginName(identity, pool);
    if (!replacement || replacement.id === activeUserId) return false;

    setActiveUserId(replacement.id);
    if (remembered?.loginId) {
      persistAutoLoginState(replacement);
    }
    return true;
  }

  function getUiLanguage() {
    const currentUser = getCurrentUser();
    return currentUser?.uiLanguage || uiState.landing.uiLanguage || "ko";
  }

  function getLocale() {
    return LOCALES[getUiLanguage()] || "ko-KR";
  }

  function t(key, params = {}, overrideLanguage) {
    const lang = overrideLanguage || getUiLanguage();
    const dictionary = DICTIONARY[lang] || DICTIONARY.ko;
    let template = dictionary[key];
    if (!template) {
      template = DICTIONARY.ko[key] || key;
    }
    return String(template).replace(/\{(\w+)\}/g, (_, token) => params[token] ?? "");
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // Added: repair legacy mojibake that could have been persisted before UTF-8 handling stabilized on server sync.
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

  function resolveRenderableMessageText(primaryText, primaryLanguage, fallbackText = "", fallbackLanguage = "") {
    const primary = String(primaryText || "");
    const fallback = String(fallbackText || "");
    const primaryCorrupted = isEncodingCorruptedText(primary, primaryLanguage);
    const fallbackCorrupted = isEncodingCorruptedText(fallback, fallbackLanguage);

    if (primary && !primaryCorrupted) {
      return {
        text: primary,
        corrupted: false,
        usedFallback: false,
      };
    }

    if (fallback && !fallbackCorrupted) {
      return {
        text: fallback,
        corrupted: true,
        usedFallback: true,
      };
    }

    return {
      text: "",
      corrupted: primaryCorrupted || fallbackCorrupted,
      usedFallback: false,
    };
  }

  function normalizeLoginIdentity(value) {
    return normalizeDisplayText(value).trim().toLowerCase();
  }

  function normalizeAccountId(value) {
    return normalizeDisplayText(value).trim().toLowerCase();
  }

  function normalizePolicyIdentity(value) {
    return normalizeDisplayText(value).replace(/\s+/g, "").trim().toLowerCase();
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

  function getLatestUserMessageForTrace(state = appState) {
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

  function isAdminLoginId(value) {
    return normalizeAccountId(value) === BUILT_IN_ADMIN_ACCOUNT.loginId;
  }

  function isAdminUser(user) {
    return Boolean(user?.isAdmin) || isAdminLoginId(user?.loginId);
  }

  function applySpecialUserFlags(user) {
    if (!user) return user;
    user.isAdmin = Boolean(user.isAdmin) || isAdminLoginId(user.loginId);
    return user;
  }

  function syncSpecialUserFlags() {
    (appState.users || []).forEach((user) => applySpecialUserFlags(user));
  }

  function ensureSystemAccounts() {
    syncSpecialUserFlags();
    let adminUser = (appState.users || []).find((user) => isAdminLoginId(user?.loginId));
    if (!adminUser) {
      adminUser = createUser(
        BUILT_IN_ADMIN_ACCOUNT.name,
        BUILT_IN_ADMIN_ACCOUNT.nativeLanguage,
        BUILT_IN_ADMIN_ACCOUNT.uiLanguage,
        Date.now(),
        null,
        null,
        {
          loginId: BUILT_IN_ADMIN_ACCOUNT.loginId,
          password: BUILT_IN_ADMIN_ACCOUNT.password,
          isAdmin: true,
        }
      );
      appState.users.unshift(adminUser);
    }
    applySpecialUserFlags(adminUser);
  }

  function isValidSignupLoginId(value) {
    return /^(?=.*[a-z])(?=.*\d)[a-z\d]{5,}$/i.test(String(value || "").trim());
  }

  function isValidSignupPassword(value) {
    return /^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/.test(String(value || ""));
  }

  function getUserDisplayName(user) {
    return normalizeDisplayText(user?.nickname || user?.name || user?.loginId || "");
  }

  function openNoticeModal(titleKey, messageKey, params = {}) {
    uiState.modal = {
      type: "notice",
      data: {
        title: t(titleKey, params),
        message: t(messageKey, params),
      },
    };
  }

  function hasUnreadInviteNotifications(userId) {
    return appState.invites.some(
      (invite) => invite.inviteeId === userId && invite.status === "pending" && !invite.seenByInvitee
    );
  }

  function hasUnreadMessageNotifications(userId) {
    return appState.rooms.some((room) => Number(room?.unreadByUser?.[userId] || 0) > 0);
  }

  function syncUserAlertState() {
    appState.users.forEach((user) => {
      user.hasUnreadInvites = hasUnreadInviteNotifications(user.id);
      user.hasUnreadMessages = hasUnreadMessageNotifications(user.id);
    });
  }

  function markIncomingInvitesSeen(userId) {
    let changed = false;
    appState.invites.forEach((invite) => {
      if (invite.inviteeId === userId && invite.status === "pending" && !invite.seenByInvitee) {
        invite.seenByInvitee = true;
        changed = true;
      }
    });
    if (changed) {
      syncUserAlertState();
    }
    return changed;
  }

  function markAllChatNotificationsSeen(userId) {
    let changed = false;
    appState.rooms.forEach((room) => {
      if (!room.unreadByUser) return;
      if (Number(room.unreadByUser[userId] || 0) > 0) {
        room.unreadByUser[userId] = 0;
        changed = true;
      }
    });
    if (changed) {
      syncUserAlertState();
    }
    return changed;
  }

  function renderTabBadge(tabId, currentUser) {
    if (!currentUser) return "";
    const showBadge =
      (tabId === "me" && (currentUser.hasUnreadInvites || hasUnreadInviteNotifications(currentUser.id))) ||
      (tabId === "chat" && (currentUser.hasUnreadMessages || hasUnreadMessageNotifications(currentUser.id)));
    return showBadge ? `<span class="mobile-tab-badge" aria-hidden="true">N</span>` : "";
  }

  function normalizeRecoveryAnswer(value) {
    return normalizeDisplayText(value)
      .replace(/\s+/g, "")
      .trim()
      .toLowerCase();
  }

  function getDeterministicRecoveryQuestionKey(seedValue) {
    const seed = normalizeLoginIdentity(seedValue || "transchat");
    if (!RECOVERY_QUESTION_KEYS.length) {
      return "recoveryFavoriteColor";
    }

    let hash = 0;
    for (const character of Array.from(seed)) {
      hash = (hash + character.codePointAt(0)) % RECOVERY_QUESTION_KEYS.length;
    }
    return RECOVERY_QUESTION_KEYS[hash] || RECOVERY_QUESTION_KEYS[0];
  }

  function getRandomRecoveryQuestionKey() {
    return RECOVERY_QUESTION_KEYS[Math.floor(Math.random() * RECOVERY_QUESTION_KEYS.length)] || RECOVERY_QUESTION_KEYS[0];
  }

  // Added: web standard file-picker validation so only user-selected images are processed in memory.
  function validateSelectedImageFile(file, options = {}) {
    const maxBytes = Number(options.maxBytes || CONFIG.imageMaxBytes);
    if (!file) {
      return { ok: false, titleKey: "toastImageFormatInvalid", messageKey: "toastImageFormatInvalidCopy" };
    }
    if (!CONFIG.allowedImageMimeTypes.includes(String(file.type || "").toLowerCase())) {
      return { ok: false, titleKey: "toastImageFormatInvalid", messageKey: "toastImageFormatInvalidCopy" };
    }
    if (file.size > maxBytes) {
      if (options.kind === "profile") {
        return { ok: false, titleKey: "toastProfileImageTooLarge", messageKey: "toastProfileImageTooLargeCopy" };
      }
      return { ok: false, titleKey: "imageTooLarge", messageKey: "imageTooLarge" };
    }
    return { ok: true };
  }

  function getLanguageMeta(languageCode) {
    return LANGUAGE_META[languageCode] || { flag: "🏳️", nativeLabel: languageCode || "Unknown" };
  }

  function getUserProfileImage(user) {
    return user?.profileImage || DEFAULT_PROFILE_IMAGE;
  }

  function syncProfileEditor(currentUser) {
    if (!currentUser) return null;
    if (uiState.profileEditor.userId !== currentUser.id) {
      uiState.profileEditor = {
        userId: currentUser.id,
        name: currentUser.name || "",
        nickname: currentUser.nickname || "",
        gender: currentUser.gender || "",
        age: currentUser.age || "",
      };
    }
    return uiState.profileEditor;
  }

  async function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("file_read_failed"));
      reader.readAsDataURL(file);
    });
  }

  async function prepareProfileImage(file) {
    const validation = validateSelectedImageFile(file, {
      maxBytes: CONFIG.profileImageMaxBytes,
      kind: "profile",
    });
    if (!validation.ok) {
      const error = new Error("profile_image_invalid");
      error.titleKey = validation.titleKey;
      error.messageKey = validation.messageKey;
      throw error;
    }

    if (typeof createImageBitmap !== "function") {
      return fileToDataUrl(file);
    }

    const bitmap = await createImageBitmap(file);
    const ratio = Math.min(1, 480 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
    canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    const context = canvas.getContext("2d");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.84);
    bitmap.close();
    return dataUrl;
  }

  async function prepareProfileEditorImage(file) {
    const validation = validateSelectedImageFile(file, {
      maxBytes: CONFIG.profileImageMaxBytes,
      kind: "profile",
    });
    if (!validation.ok) {
      const error = new Error("profile_image_invalid");
      error.titleKey = validation.titleKey;
      error.messageKey = validation.messageKey;
      throw error;
    }

    const loaded = await loadImageForCanvas(file);
    const ratio = Math.min(1, PROFILE_CROP_MAX_DIMENSION / Math.max(loaded.width, loaded.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(loaded.width * ratio));
    canvas.height = Math.max(1, Math.round(loaded.height * ratio));
    const context = canvas.getContext("2d");
    context.drawImage(loaded.source, 0, 0, canvas.width, canvas.height);
    loaded.cleanup();

    return {
      sourceUrl: canvas.toDataURL("image/jpeg", 0.92),
      sourceWidth: canvas.width,
      sourceHeight: canvas.height,
    };
  }

  function getProfileCropMetrics(data) {
    const sourceWidth = Math.max(1, Number(data?.sourceWidth || 1));
    const sourceHeight = Math.max(1, Number(data?.sourceHeight || 1));
    const zoom = Math.max(1, Number(data?.zoom || 1));
    const baseScale = Math.max(PROFILE_CROP_OUTPUT_SIZE / sourceWidth, PROFILE_CROP_OUTPUT_SIZE / sourceHeight);
    const drawWidth = sourceWidth * baseScale * zoom;
    const drawHeight = sourceHeight * baseScale * zoom;
    return {
      previewRatio: PROFILE_CROP_PREVIEW_SIZE / PROFILE_CROP_OUTPUT_SIZE,
      drawWidth,
      drawHeight,
    };
  }

  function clampProfileCropState(data) {
    if (!data) return data;
    const metrics = getProfileCropMetrics(data);
    const minOffsetX = PROFILE_CROP_OUTPUT_SIZE - metrics.drawWidth;
    const minOffsetY = PROFILE_CROP_OUTPUT_SIZE - metrics.drawHeight;
    data.offsetX = Math.min(0, Math.max(minOffsetX, Number(data.offsetX || 0)));
    data.offsetY = Math.min(0, Math.max(minOffsetY, Number(data.offsetY || 0)));
    data.zoom = Math.max(1, Math.min(Number(data.maxZoom || 3.2), Number(data.zoom || 1)));
    return data;
  }

  function createProfileCropState(source) {
    const data = {
      sourceUrl: source.sourceUrl,
      sourceWidth: source.sourceWidth,
      sourceHeight: source.sourceHeight,
      zoom: 1,
      minZoom: 1,
      maxZoom: 3.2,
      offsetX: 0,
      offsetY: 0,
      saving: false,
    };
    const metrics = getProfileCropMetrics(data);
    data.offsetX = (PROFILE_CROP_OUTPUT_SIZE - metrics.drawWidth) / 2;
    data.offsetY = (PROFILE_CROP_OUTPUT_SIZE - metrics.drawHeight) / 2;
    return clampProfileCropState(data);
  }

  async function loadImageElement(sourceUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("image_load_failed"));
      image.src = sourceUrl;
    });
  }

  function getProfileCropImageInlineStyle(data) {
    const metrics = getProfileCropMetrics(data);
    return [
      `width:${metrics.drawWidth * metrics.previewRatio}px`,
      `height:${metrics.drawHeight * metrics.previewRatio}px`,
      `transform:translate(${Number(data.offsetX || 0) * metrics.previewRatio}px, ${Number(data.offsetY || 0) * metrics.previewRatio}px)`,
    ].join(";");
  }

  function syncProfileCropPreviewUi() {
    if (uiState.modal?.type !== "profile-image-editor") {
      return;
    }
    const data = clampProfileCropState(uiState.modal.data || {});
    const image = APP_ROOT.querySelector("[data-profile-crop-image]");
    const zoomInput = APP_ROOT.querySelector('[data-input="profile-crop-zoom"]');
    const zoomValue = APP_ROOT.querySelector("[data-profile-crop-zoom-value]");
    if (image instanceof HTMLElement) {
      image.setAttribute("style", getProfileCropImageInlineStyle(data));
    }
    if (zoomInput instanceof HTMLInputElement) {
      zoomInput.value = String(data.zoom);
    }
    if (zoomValue instanceof HTMLElement) {
      zoomValue.textContent = `${Math.round(data.zoom * 100)}%`;
    }
  }

  async function openProfileImageEditor(file) {
    const prepared = await prepareProfileEditorImage(file);
    uiState.modal = {
      type: "profile-image-editor",
      data: createProfileCropState(prepared),
    };
    render();
  }

  function updateProfileCropZoom(nextZoom) {
    if (uiState.modal?.type !== "profile-image-editor") {
      return;
    }
    const data = uiState.modal.data || {};
    const previousMetrics = getProfileCropMetrics(data);
    const focusX = (PROFILE_CROP_OUTPUT_SIZE / 2 - Number(data.offsetX || 0)) / previousMetrics.drawWidth;
    const focusY = (PROFILE_CROP_OUTPUT_SIZE / 2 - Number(data.offsetY || 0)) / previousMetrics.drawHeight;
    data.zoom = Math.max(Number(data.minZoom || 1), Math.min(Number(data.maxZoom || 3.2), Number(nextZoom || 1)));
    const nextMetrics = getProfileCropMetrics(data);
    data.offsetX = PROFILE_CROP_OUTPUT_SIZE / 2 - focusX * nextMetrics.drawWidth;
    data.offsetY = PROFILE_CROP_OUTPUT_SIZE / 2 - focusY * nextMetrics.drawHeight;
    clampProfileCropState(data);
    syncProfileCropPreviewUi();
  }

  function clearProfileCropDrag() {
    runtime.profileImageCropDrag = null;
  }

  function onRootPointerDown(event) {
    const stage = event.target instanceof HTMLElement ? event.target.closest("[data-profile-crop-stage]") : null;
    if (!(stage instanceof HTMLElement) || uiState.modal?.type !== "profile-image-editor") {
      return;
    }
    event.preventDefault();
    const data = uiState.modal.data || {};
    runtime.profileImageCropDrag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: Number(data.offsetX || 0),
      originY: Number(data.offsetY || 0),
    };
    stage.setPointerCapture?.(event.pointerId);
  }

  function onWindowPointerMove(event) {
    const drag = runtime.profileImageCropDrag;
    if (!drag || uiState.modal?.type !== "profile-image-editor") {
      return;
    }
    const data = uiState.modal.data || {};
    const previewRatio = getProfileCropMetrics(data).previewRatio;
    data.offsetX = drag.originX + (event.clientX - drag.startX) / previewRatio;
    data.offsetY = drag.originY + (event.clientY - drag.startY) / previewRatio;
    clampProfileCropState(data);
    syncProfileCropPreviewUi();
  }

  function onWindowPointerUp(event) {
    if (runtime.profileImageCropDrag && (!event.pointerId || runtime.profileImageCropDrag.pointerId === event.pointerId)) {
      clearProfileCropDrag();
    }
  }

  async function submitProfileImageCrop() {
    const currentUser = getCurrentUser();
    const cropData = uiState.modal?.type === "profile-image-editor" ? uiState.modal.data : null;
    if (!currentUser || !cropData || cropData.saving) {
      return;
    }

    cropData.saving = true;
    render();
    try {
      const image = await loadImageElement(cropData.sourceUrl);
      const metrics = getProfileCropMetrics(cropData);
      const canvas = document.createElement("canvas");
      canvas.width = PROFILE_CROP_OUTPUT_SIZE;
      canvas.height = PROFILE_CROP_OUTPUT_SIZE;
      const context = canvas.getContext("2d");
      context.drawImage(image, Number(cropData.offsetX || 0), Number(cropData.offsetY || 0), metrics.drawWidth, metrics.drawHeight);
      currentUser.profileImage = canvas.toDataURL("image/jpeg", 0.9);
      persistState();
      flushServerStateSync();
      uiState.modal = null;
      clearProfileCropDrag();
      pushToast("toastProfileImageUpdated", "toastProfileImageUpdatedCopy");
      render();
    } catch (error) {
      cropData.saving = false;
      pushToast(error.titleKey || "toastProfileImageInvalid", error.messageKey || "toastProfileImageInvalidCopy");
      render();
    }
  }

  async function loadImageForCanvas(file) {
    if (typeof createImageBitmap === "function") {
      const bitmap = await createImageBitmap(file);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        cleanup() {
          bitmap.close();
        },
      };
    }

    const objectUrl = URL.createObjectURL(file);
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("image_load_failed"));
      element.src = objectUrl;
    });
    return {
      source: image,
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height,
      cleanup() {
        URL.revokeObjectURL(objectUrl);
      },
    };
  }

  function getMediaExpireMs() {
    return CONFIG.mediaExpireHours * 60 * 60 * 1000;
  }

  function buildMediaExpiry(uploadedAt = Date.now()) {
    return {
      uploadedAt,
      expiresAt: uploadedAt + getMediaExpireMs(),
    };
  }

  function isChatMediaKind(kind) {
    return kind === "image" || kind === "video";
  }

  function isExpirableChatMedia(media) {
    return Boolean(media && isChatMediaKind(media.kind));
  }

  function isMediaExpired(media, now = Date.now()) {
    if (!isExpirableChatMedia(media)) return false;
    if (media.expired) return true;
    const expiresAt = Number(media.expiresAt || 0);
    return Boolean(expiresAt && now >= expiresAt);
  }

  function getMediaExpiryLabel(expiresAt) {
    const diffMs = Math.max(0, Number(expiresAt || Date.now()) - Date.now());
    const diffMinutes = Math.ceil(diffMs / (60 * 1000));
    const formatter = typeof Intl !== "undefined" && typeof Intl.RelativeTimeFormat === "function"
      ? new Intl.RelativeTimeFormat(getLocale(), { numeric: "auto" })
      : null;
    if (diffMinutes < 60) {
      return formatter ? formatter.format(Math.max(1, diffMinutes), "minute") : formatRemaining(diffMs);
    }
    const diffHours = Math.ceil(diffMinutes / 60);
    if (diffHours < 24) {
      return formatter ? formatter.format(diffHours, "hour") : `${diffHours}h`;
    }
    const diffDays = Math.ceil(diffHours / 24);
    return formatter ? formatter.format(diffDays, "day") : `${diffDays}d`;
  }

  function blobToObjectUrl(blob) {
    return blob instanceof Blob ? URL.createObjectURL(blob) : "";
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
            return;
          }
          reject(new Error("canvas_blob_failed"));
        },
        type,
        quality
      );
    });
  }

  async function openChatMediaDb() {
    if (runtime.mediaDbPromise) {
      return runtime.mediaDbPromise;
    }

    runtime.mediaDbPromise = new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) {
        reject(new Error("indexeddb_unavailable"));
        return;
      }

      const request = indexedDB.open(MEDIA_DB_NAME, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        const store = database.objectStoreNames.contains(MEDIA_DB_STORE)
          ? request.transaction.objectStore(MEDIA_DB_STORE)
          : database.createObjectStore(MEDIA_DB_STORE, { keyPath: "id" });

        if (!store.indexNames.contains("expiresAt")) {
          store.createIndex("expiresAt", "expiresAt", { unique: false });
        }
        if (!store.indexNames.contains("roomId")) {
          store.createIndex("roomId", "roomId", { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("indexeddb_open_failed"));
    });

    return runtime.mediaDbPromise;
  }

  async function runMediaStore(mode, task) {
    const database = await openChatMediaDb();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(MEDIA_DB_STORE, mode);
      const store = transaction.objectStore(MEDIA_DB_STORE);
      let settled = false;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        fn(value);
      };

      transaction.oncomplete = () => finish(resolve);
      transaction.onerror = () => finish(reject, transaction.error || new Error("indexeddb_transaction_failed"));
      transaction.onabort = () => finish(reject, transaction.error || new Error("indexeddb_transaction_aborted"));

      try {
        const result = task(store, resolve, reject);
        if (result && typeof result.onsuccess === "function") {
          result.onsuccess = () => finish(resolve, result.result);
          result.onerror = () => finish(reject, result.error || new Error("indexeddb_request_failed"));
        }
      } catch (error) {
        finish(reject, error);
      }
    });
  }

  async function writeChatMediaRecord(record) {
    if (!record?.id || !(record.blob instanceof Blob)) {
      throw new Error("invalid_media_record");
    }

    await refreshStorageEstimate(record.fileSize || record.blob.size || 0);
    await runMediaStore("readwrite", (store) => store.put(record));
    await refreshStorageEstimate();
    return record;
  }

  async function readChatMediaRecord(mediaId) {
    if (!mediaId) return null;
    return runMediaStore("readonly", (store) => store.get(mediaId));
  }

  async function deleteChatMediaRecord(mediaId) {
    if (!mediaId) return;
    revokeCachedMediaUrl(mediaId);
    await runMediaStore("readwrite", (store, resolve) => {
      const request = store.delete(mediaId);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      return request;
    });
    await refreshStorageEstimate();
  }

  async function deleteChatMediaRecords(mediaIds) {
    const uniqueIds = [...new Set((mediaIds || []).filter(Boolean))];
    if (!uniqueIds.length) return;
    uniqueIds.forEach((mediaId) => revokeCachedMediaUrl(mediaId));
    await runMediaStore("readwrite", (store) => {
      uniqueIds.forEach((mediaId) => store.delete(mediaId));
    });
    await refreshStorageEstimate();
  }

  async function listExpiredChatMediaIds(now = Date.now()) {
    try {
      return await runMediaStore("readonly", (store, resolve) => {
        if (!store.indexNames.contains("expiresAt")) {
          resolve([]);
          return;
        }

        const request = store.index("expiresAt").getAll(IDBKeyRange.upperBound(now));
        request.onsuccess = () => {
          resolve(
            (request.result || [])
              .filter((item) => Number(item?.expiresAt || 0) <= now)
              .map((item) => item.id)
          );
        };
        request.onerror = () => resolve([]);
        return request;
      });
    } catch (error) {
      return [];
    }
  }

  async function estimateStorageUsage(extraBytes = 0) {
    if (!navigator.storage?.estimate) return null;
    try {
      const estimate = await navigator.storage.estimate();
      const usage = Number(estimate?.usage || 0);
      const quota = Number(estimate?.quota || 0);
      const projectedUsage = usage + Number(extraBytes || 0);
      return {
        usage,
        quota,
        projectedUsage,
        thresholdExceeded: quota > 0 ? projectedUsage / quota >= CONFIG.storageWarningThreshold : false,
      };
    } catch (error) {
      return null;
    }
  }

  async function refreshStorageEstimate(extraBytes = 0) {
    runtime.storageEstimate = await estimateStorageUsage(extraBytes);
    return runtime.storageEstimate;
  }

  function cacheMediaObjectUrl(mediaId, objectUrl) {
    if (!mediaId || !objectUrl) return "";
    revokeCachedMediaUrl(mediaId);
    runtime.mediaObjectUrls.set(mediaId, objectUrl);
    return objectUrl;
  }

  function revokeCachedMediaUrl(mediaId) {
    const objectUrl = runtime.mediaObjectUrls.get(mediaId);
    if (!objectUrl) return;
    URL.revokeObjectURL(objectUrl);
    runtime.mediaObjectUrls.delete(mediaId);
  }

  async function ensureIndexedMediaLoaded(media) {
    if (!media?.mediaId || media.storage !== "indexeddb" || isMediaExpired(media)) {
      return "";
    }
    const cached = runtime.mediaObjectUrls.get(media.mediaId);
    if (cached) {
      return cached;
    }
    if (runtime.mediaLoadPromises.has(media.mediaId)) {
      return runtime.mediaLoadPromises.get(media.mediaId);
    }

    const loadPromise = (async () => {
      const record = await readChatMediaRecord(media.mediaId);
      if (!record?.blob) return "";
      if (Number(record.expiresAt || 0) <= Date.now()) {
        await deleteChatMediaRecord(media.mediaId);
        return "";
      }
      return cacheMediaObjectUrl(media.mediaId, blobToObjectUrl(record.blob));
    })()
      .catch(() => "")
      .finally(() => {
        runtime.mediaLoadPromises.delete(media.mediaId);
        renderSafelyDuringInput(90);
      });

    runtime.mediaLoadPromises.set(media.mediaId, loadPromise);
    return loadPromise;
  }

  function collectMediaIdsFromMessages(messages) {
    return (messages || [])
      .map((message) => message?.media?.mediaId)
      .filter(Boolean);
  }

  async function cleanupExpiredChatMedia(options = {}) {
    const now = Date.now();
    const expiredIds = new Set(await listExpiredChatMediaIds(now));
    let changed = false;

    appState.rooms.forEach((room) => {
      room.messages = (room.messages || []).map((message) => {
        if (!message?.media || !isExpirableChatMedia(message.media)) {
          return message;
        }
        const mediaId = message.media.mediaId;
        if (!isMediaExpired(message.media, now) && !expiredIds.has(mediaId)) {
          return message;
        }
        if (message.media.expired) {
          expiredIds.add(mediaId);
          return message;
        }
        changed = true;
        expiredIds.add(mediaId);
        return {
          ...message,
          media: {
            ...message.media,
            expired: true,
            deletedAt: now,
          },
        };
      });
    });

    if (expiredIds.size) {
      await deleteChatMediaRecords([...expiredIds]);
    }

    if (changed && options.persist !== false) {
      persistState();
      if (shouldDeferNonCriticalRender()) {
        renderSafelyDuringInput();
      } else {
        render();
      }
    }

    return changed;
  }

  function scheduleMediaDeletion(mediaIds) {
    const ids = [...new Set((mediaIds || []).filter(Boolean))];
    if (!ids.length) return;
    deleteChatMediaRecords(ids).catch(() => {
      // Media cleanup is best-effort in the prototype; missing blobs should not block room or account deletion.
    });
  }

  function renderProfileImage(imageOrUser, className, altText = "profile") {
    const source =
      typeof imageOrUser === "string" ? imageOrUser || DEFAULT_PROFILE_IMAGE : getUserProfileImage(imageOrUser);
    return `<img class="${className}" src="${escapeHtml(source)}" alt="${escapeHtml(altText)}">`;
  }

  function renderLanguageAccordionOptions(selectedCode, actionName = "select-landing-native-language") {
    return Object.keys(CHAT_LANGUAGES)
      .map((languageCode) => {
        const meta = getLanguageMeta(languageCode);
        return `
          <button
            class="landing-language-option ${selectedCode === languageCode ? "active" : ""}"
            type="button"
            data-action="${actionName}"
            data-language="${languageCode}"
          >
            <span class="landing-language-option-flag" aria-hidden="true">${meta.flag}</span>
            <span>${escapeHtml(meta.nativeLabel)}</span>
          </button>
        `;
      })
      .join("");
  }

  function getDraft(roomId) {
    if (!uiState.drafts[roomId]) {
      uiState.drafts[roomId] = {
        text: "",
        attachment: null,
        processing: false,
        translationConcept: DEFAULT_TRANSLATION_CONCEPT,
      };
    }
    return uiState.drafts[roomId];
  }

  function setDraft(roomId, updates) {
    uiState.drafts[roomId] = {
      ...getDraft(roomId),
      ...updates,
    };
  }

  function getChatLanguageName(code) {
    return LANGUAGE_OPTION_LABELS[code] || CHAT_LANGUAGES[code] || code;
  }

  function normalizeTranslationConcept(value) {
    const normalized = String(value || "").trim().toLowerCase();
    return TRANSLATION_CONCEPTS.some((entry) => entry.id === normalized) ? normalized : DEFAULT_TRANSLATION_CONCEPT;
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

  function getTranslationVariantLanguage(value) {
    const normalized = String(value || "").trim();
    if (Object.prototype.hasOwnProperty.call(CHAT_LANGUAGES, normalized)) {
      return normalized;
    }
    const [language] = normalized.split("__");
    return Object.prototype.hasOwnProperty.call(CHAT_LANGUAGES, language) ? language : "";
  }

  function buildTranslationVariantKey(language, concept) {
    const baseLanguage = getTranslationVariantLanguage(language);
    if (!baseLanguage) return "";
    return `${baseLanguage}__${normalizeTranslationConcept(concept)}`;
  }

  function getUserTranslationConcept(user = getCurrentUser()) {
    return normalizeTranslationConcept(user?.preferredTranslationConcept || DEFAULT_TRANSLATION_CONCEPT);
  }

  function getTranslationConceptMeta(conceptId) {
    return (
      TRANSLATION_CONCEPTS.find((entry) => entry.id === normalizeTranslationConcept(conceptId)) ||
      TRANSLATION_CONCEPTS.find((entry) => entry.id === DEFAULT_TRANSLATION_CONCEPT) ||
      TRANSLATION_CONCEPTS[0]
    );
  }

  function getTranslationConceptLabel(conceptId) {
    return t(getTranslationConceptMeta(conceptId).labelKey);
  }

  function getUiLanguageName(code) {
    return LANGUAGE_OPTION_LABELS[code] || UI_LANGUAGES[code] || code;
  }

  function applyTheme() {
    const themePreference = appState.settings.theme || "system";
    const resolved =
      themePreference === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : themePreference;
    document.body.dataset.theme = resolved === "dark" ? "dark" : "light";
  }

  function pushToast(titleKey, messageKey, params = {}) {
    const toast = {
      id: uid("toast"),
      title: t(titleKey, params),
      message: t(messageKey, params),
    };
    uiState.toasts.push(toast);
    if (uiState.toasts.length > 4) {
      uiState.toasts.shift();
    }
    const existing = runtime.toastTimers.get(toast.id);
    if (existing) {
      clearTimeout(existing);
    }
    runtime.toastTimers.set(
      toast.id,
      setTimeout(() => {
        uiState.toasts = uiState.toasts.filter((item) => item.id !== toast.id);
        runtime.toastTimers.delete(toast.id);
        render();
      }, 4200)
    );
  }

  function revokeRuntimeVideo(runtimeId) {
    const url = runtime.videoUrls.get(runtimeId);
    if (url) {
      URL.revokeObjectURL(url);
      runtime.videoUrls.delete(runtimeId);
    }
  }

  function releaseDraftAttachment(attachment, options = {}) {
    if (!attachment) return;
    if (attachment.kind === "video" && attachment.runtimeId) {
      revokeRuntimeVideo(attachment.runtimeId);
    }
    if (!options.preserveObjectUrl && attachment.objectUrl) {
      URL.revokeObjectURL(attachment.objectUrl);
    }
  }

  function adoptDraftMediaObjectUrl(attachment, mediaId) {
    if (!attachment?.objectUrl || !mediaId) return;
    cacheMediaObjectUrl(mediaId, attachment.objectUrl);
    delete attachment.objectUrl;
  }

  function formatRelativeTime(timestamp) {
    if (!timestamp) return "—";
    const diff = Date.now() - timestamp;
    if (diff < 60 * 1000) return t("relativeJustNow");
    const minutes = Math.floor(diff / (60 * 1000));
    if (minutes < 60) return t("relativeMinutesAgo", { count: minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t("relativeHoursAgo", { count: hours });
    const days = Math.floor(hours / 24);
    return t("relativeDaysAgo", { count: days });
  }

  function formatClock(timestamp) {
    if (!timestamp) return "—";
    return new Intl.DateTimeFormat(getLocale(), {
      hour: "numeric",
      minute: "2-digit",
      month: "short",
      day: "numeric",
    }).format(timestamp);
  }

  function formatMessageMetaDate(timestamp) {
    if (!timestamp) return "??";
    const now = new Date();
    const target = new Date(timestamp);
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const targetStart = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
    const diffDays = Math.round((todayStart - targetStart) / 86400000);

    if (diffDays <= 0) {
      return new Intl.DateTimeFormat(getLocale(), {
        hour: "numeric",
        minute: "2-digit",
      }).format(timestamp);
    }

    if (diffDays === 1) {
      return t("dateYesterday");
    }

    const sameYear = target.getFullYear() === now.getFullYear();
    return new Intl.DateTimeFormat(
      getLocale(),
      sameYear
        ? { month: "long", day: "numeric" }
        : { year: "numeric", month: "long", day: "numeric" }
    ).format(timestamp);
  }

  function formatRemaining(ms) {
    const safe = Math.max(0, ms);
    const minutes = Math.floor(safe / 60000);
    if (minutes >= 1) return t("remainingMinutes", { count: minutes });
    const seconds = Math.ceil(safe / 1000);
    return t("remainingSeconds", { count: seconds });
  }

  function formatBytes(bytes) {
    if (!bytes) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    let value = bytes;
    let index = 0;
    while (value >= 1024 && index < units.length - 1) {
      value /= 1024;
      index += 1;
    }
    return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
  }

  function capitalize(value) {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  function initials(name) {
    return name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((token) => token[0]?.toUpperCase() || "")
      .join("");
  }

  function detectLinks(text) {
    if (!text) return [];
    return text.match(/https?:\/\/[^\s]+/g) || [];
  }

  function shortenLink(link) {
    try {
      const url = new URL(link);
      return `${url.hostname}${url.pathname === "/" ? "" : url.pathname}`;
    } catch (error) {
      return link;
    }
  }

  function stripLinks(text) {
    return String(text || "")
      .replace(/https?:\/\/[^\s]+/g, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function renderIconSvg(kind) {
    const icons = {
      photo: `
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M7 6h2l1.2-2h3.6L15 6h2a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3Zm5 3.5A4.5 4.5 0 1 0 12 18a4.5 4.5 0 0 0 0-9Zm0 2A2.5 2.5 0 1 1 12 16a2.5 2.5 0 0 1 0-5Z"></path>
        </svg>
      `,
      video: `
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M5 6a3 3 0 0 0-3 3v6a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3v-1.2l4.1 2.4c.9.5 1.9-.1 1.9-1.2V8.9c0-1.1-1-1.7-1.9-1.2L16 10.1V9a3 3 0 0 0-3-3H5Zm1 2h7a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"></path>
        </svg>
      `,
      file: `
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M7 3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9.5L13.5 3H7Zm6 1.8L17.2 9H14a1 1 0 0 1-1-1V4.8ZM9 13h6v2H9v-2Zm0 4h6v2H9v-2Zm0-8h3v2H9V9Z"></path>
        </svg>
      `,
    };
    return `<span class="icon-svg icon-${kind}">${icons[kind] || ""}</span>`;
  }

  function renderLanguageOptions(selected, source) {
    return Object.entries(source)
      .map(([value, label]) => {
        const displayLabel = LANGUAGE_OPTION_LABELS[value] || label;
        return `<option value="${value}" ${selected === value ? "selected" : ""}>${escapeHtml(displayLabel)}</option>`;
      })
      .join("");
  }

  function renderLandingLanguageButtons() {
    return LANDING_QUICK_UI_LANGUAGES.map((languageCode) => `
      <button
        class="landing-language-button ${uiState.landing.uiLanguage === languageCode ? "active" : ""}"
        type="button"
        data-action="set-landing-ui-language"
        data-language="${languageCode}"
        aria-label="${escapeHtml(LANDING_UI_LANGUAGE_LABELS[languageCode] || languageCode)}"
        title="${escapeHtml(LANDING_UI_LANGUAGE_LABELS[languageCode] || languageCode)}"
      >
        <span aria-hidden="true">${languageCode === "ko" ? "🇰🇷" : "🇻🇳"}</span>
      </button>
    `).join("");
  }

  function getFilteredRooms() {
    const rooms = [...appState.rooms]
      .filter((room) => room.status === "active")
      .sort((a, b) => (b.lastMessageAt || b.createdAt) - (a.lastMessageAt || a.createdAt));
    return filterRoomsByQuery(rooms);
  }

  function filterRoomsByQuery(rooms) {
    const query = normalizeDisplayText(uiState.roomSearch).trim().toLowerCase();
    if (!query) return rooms;
    return rooms.filter((room) => {
      const creator = appState.users.find((user) => user.id === room.creatorId);
      return (
        normalizeDisplayText(room.title).toLowerCase().includes(query) ||
        normalizeDisplayText(creator?.name).toLowerCase().includes(query)
      );
    });
  }

  function isRoomUnlockedForUser(room, userId) {
    if (!room.isProtected) return true;
    if (room.participants.includes(userId)) return true;
    const record = room.accessByUser?.[userId];
    return record === true || Boolean(record?.unlocked);
  }

  function formatLastSeenLabel(timestamp) {
    const lastSeenAt = Number(timestamp || 0);
    if (!lastSeenAt) return t("presenceOffline");
    const diffMs = Math.max(0, Date.now() - lastSeenAt);
    const diffMinutes = Math.floor(diffMs / (60 * 1000));
    if (diffMinutes < CONFIG.recentSeenThresholdMinutes) {
      return t("presenceRecentSeen");
    }
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) {
      return t("presenceHoursAgo", { count: Math.max(1, diffHours) });
    }
    const diffDays = Math.floor(diffHours / 24);
    return t("presenceDaysAgo", { count: Math.max(1, diffDays) });
  }

  function renderPresenceLabel(presence, options = {}) {
    if (!presence) return "";
    const roomNote = presence.inRoom ? `<span class="presence-room-note">${escapeHtml(t("presenceInRoom"))}</span>` : "";
    return `
      <span class="presence-inline ${options.compact ? "compact" : ""}">
        <span class="presence-dot ${presence.kind}"></span>
        <span>${escapeHtml(presence.label)}</span>
        ${roomNote}
      </span>
    `;
  }

  function getPresence(user, roomId) {
    const livePresence = runtime.presenceSignals[user.id];
    const lastSeenAt = Number(livePresence?.lastSeenAt || user.lastSeenAt || 0);
    const effectiveRoomId = livePresence?.loginState === "offline" ? null : livePresence?.currentRoomId || user.currentRoomId || null;
    const recentlyActive = Date.now() - lastSeenAt < 2 * 60 * 1000;
    const explicitLoginState =
      livePresence?.loginState === "offline" || user.loginState === "offline"
        ? "offline"
        : livePresence?.loginState === "online" || user.loginState === "online"
          ? "online"
          : null;
    const inRoom = Boolean(roomId && effectiveRoomId && roomId === effectiveRoomId);

    if (explicitLoginState === "online" && recentlyActive) {
      return { kind: "online", label: t("presenceOnline"), lastSeenAt, roomId: effectiveRoomId, inRoom };
    }

    if (explicitLoginState === "offline") {
      return { kind: "offline", label: formatLastSeenLabel(lastSeenAt), lastSeenAt, roomId: null, inRoom: false };
    }

    if (recentlyActive) {
      return { kind: "online", label: t("presenceOnline"), lastSeenAt, roomId: effectiveRoomId, inRoom };
    }
    return {
      kind: "offline",
      label: formatLastSeenLabel(lastSeenAt),
      lastSeenAt,
      roomId: effectiveRoomId,
      inRoom: false,
    };
  }

  function shouldDeferNonCriticalRender() {
    const activeElement = document.activeElement;
    const activeInput =
      activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement ? activeElement : null;

    if (runtime.compositionActive) {
      return true;
    }

    if (!activeInput || activeInput.dataset.input !== "composer") {
      return false;
    }

    return Date.now() - runtime.lastComposerInputAt < 240;
  }

  function renderSafelyDuringInput(delay = 180) {
    clearTimeout(runtime.softRenderTimer);
    runtime.softRenderTimer = setTimeout(() => {
      runtime.softRenderTimer = null;
      if (shouldDeferNonCriticalRender()) {
        renderSafelyDuringInput(delay);
        return;
      }
      render();
    }, delay);
  }

  function hasSharedActiveRoom(userId, otherUserId) {
    return appState.rooms.some((room) => {
      if (room.status !== "active") return false;
      const participantIds = new Set(deriveRoomParticipantIds(room));
      return participantIds.has(userId) && participantIds.has(otherUserId);
    });
  }

  function findPendingInvite(inviterId, inviteeId) {
    return appState.invites.find((invite) => {
      if (invite.status !== "pending") return false;
      if (invite.inviterId !== inviterId || invite.inviteeId !== inviteeId) return false;
      if (invite.type === "connection") {
        return true;
      }
      return Boolean(invite.roomId) && appState.rooms.some((room) => room.id === invite.roomId && room.status === "active");
    }) || null;
  }

  function getInviteDisplayTitle(invite) {
    if (!invite) return "—";
    const room = invite.roomId ? appState.rooms.find((item) => item.id === invite.roomId) : null;
    if (room?.title) {
      return normalizeDisplayText(room.title);
    }
    if (invite.previewRoomTitle) {
      return normalizeDisplayText(invite.previewRoomTitle);
    }
    const inviter = appState.users.find((user) => user.id === invite.inviterId);
    const invitee = appState.users.find((user) => user.id === invite.inviteeId);
    return normalizeDisplayText([inviter?.name, invitee?.name].filter(Boolean).join(" - ")) || "—";
  }

  function getConnectionActionState(currentUser, friend) {
    const incomingInvite = findPendingInvite(friend.id, currentUser.id);
    if (incomingInvite) {
      return { kind: "incoming", invite: incomingInvite };
    }

    if (hasSharedActiveRoom(currentUser.id, friend.id)) {
      return { kind: "active" };
    }

    const outgoingInvite = findPendingInvite(currentUser.id, friend.id);
    if (outgoingInvite) {
      return { kind: "outgoing", invite: outgoingInvite };
    }

    return { kind: "invite" };
  }

  function createConnectionInviteRoom(currentUser, friend) {
    const title = normalizeDisplayText(`${currentUser.name} · ${friend.name}`);
    const createdAt = Date.now();
    const room = {
      id: uid("room"),
      title,
      creatorId: currentUser.id,
      password: "",
      isProtected: false,
      disableExpiration: isPersistentRoomTitle(title),
      participants: [currentUser.id],
      accessByUser: { [currentUser.id]: true },
      unreadByUser: {},
      lastMessageAt: createdAt,
      createdAt,
      status: "active",
      expiredAt: null,
      messages: [systemMessage(uid("sys"), "systemUserJoined", { name: currentUser.name }, createdAt)],
    };
    appState.rooms.unshift(room);
    return room;
  }

  function sendConnectionInvite(friendId) {
    const currentUser = getCurrentUser();
    const friend = appState.users.find((user) => user.id === friendId);
    if (!currentUser || !friend || friend.id === currentUser.id) return;

    const state = getConnectionActionState(currentUser, friend);
    if (state.kind !== "invite") {
      render();
      return;
    }

    const invite = {
      id: uid("invite"),
      roomId: null,
      inviterId: currentUser.id,
      inviteeId: friend.id,
      type: "connection",
      previewRoomTitle: normalizeDisplayText([currentUser.name, friend.name].join(" - ")),
      status: "pending",
      createdAt: Date.now(),
      respondedAt: null,
      seenByInvitee: false,
    };
    appState.invites.unshift(invite);
    persistState();
    pushToast("toastInviteSent", "toastInviteSentCopy", { name: friend.name });
    render();
  }

  function createAcceptedConnectionRoom(inviter, invitee, createdAt = Date.now()) {
    const title = normalizeDisplayText([inviter?.name, invitee?.name].filter(Boolean).join(" - "));
    const room = {
      id: uid("room"),
      title,
      creatorId: inviter.id,
      password: "",
      isProtected: false,
      disableExpiration: isPersistentRoomTitle(title),
      participants: [inviter.id, invitee.id],
      accessByUser: { [inviter.id]: true, [invitee.id]: true },
      unreadByUser: { [inviter.id]: 1, [invitee.id]: 0 },
      lastMessageAt: createdAt,
      createdAt,
      status: "active",
      expiredAt: null,
      messages: [
        systemMessage(uid("sys"), "systemUserJoined", { name: inviter.name }, createdAt),
        systemMessage(uid("sys"), "systemInviteAccepted", { name: invitee.name }, createdAt),
      ],
    };
    appState.rooms.unshift(room);
    return room;
  }

  function createConnectionInviteRoomStable(currentUser, friend) {
    const title = normalizeDisplayText(`${currentUser.name} · ${friend.name}`);
    const createdAt = Date.now();
    const room = {
      id: uid("room"),
      title,
      creatorId: currentUser.id,
      password: "",
      isProtected: false,
      disableExpiration: isPersistentRoomTitle(title),
      participants: [currentUser.id],
      accessByUser: { [currentUser.id]: true },
      unreadByUser: {},
      lastMessageAt: createdAt,
      createdAt,
      status: "active",
      expiredAt: null,
      messages: [systemMessage(uid("sys"), "systemUserJoined", { name: currentUser.name }, createdAt)],
    };
    appState.rooms.unshift(room);
    return room;
  }

  function createConnectionInviteRoomAscii(currentUser, friend) {
    const title = normalizeDisplayText([currentUser.name, friend.name].join(" - "));
    const createdAt = Date.now();
    const room = {
      id: uid("room"),
      title,
      creatorId: currentUser.id,
      password: "",
      isProtected: false,
      disableExpiration: isPersistentRoomTitle(title),
      participants: [currentUser.id],
      accessByUser: { [currentUser.id]: true },
      unreadByUser: {},
      lastMessageAt: createdAt,
      createdAt,
      status: "active",
      expiredAt: null,
      messages: [systemMessage(uid("sys"), "systemUserJoined", { name: currentUser.name }, createdAt)],
    };
    appState.rooms.unshift(room);
    return room;
  }

  function renderConnectionAction(friend, currentUser) {
    const state = getConnectionActionState(currentUser, friend);
    if (state.kind === "incoming") {
      return `
        <div class="connection-actions">
          <button class="connection-icon-button accept" type="button" data-action="respond-invite" data-invite-id="${state.invite.id}" data-response="accept" aria-label="${escapeHtml(t("acceptInvite"))}">✓</button>
          <button class="connection-icon-button reject" type="button" data-action="respond-invite" data-invite-id="${state.invite.id}" data-response="reject" aria-label="${escapeHtml(t("rejectInvite"))}">✕</button>
        </div>
      `;
    }
    if (state.kind === "active") {
      return `<span class="status-pill pill-accent connection-state-pill">${escapeHtml(t("connectionActive"))}</span>`;
    }
    if (state.kind === "outgoing") {
      return `<span class="status-pill connection-state-pill">${escapeHtml(t("connectionInvited"))}</span>`;
    }
    return `<button class="button button-secondary connection-invite-button" type="button" data-action="send-connection-invite" data-user-id="${friend.id}">${escapeHtml(t("connectionInvite"))}</button>`;
  }

  function renderConnectionActionV2(friend, currentUser) {
    const state = getConnectionActionState(currentUser, friend);
    if (state.kind === "incoming") {
      return `
        <div class="connection-actions">
          <button class="connection-icon-button accept" type="button" data-action="respond-invite" data-invite-id="${state.invite.id}" data-response="accept" aria-label="${escapeHtml(t("acceptInvite"))}">&#10003;</button>
          <button class="connection-icon-button reject" type="button" data-action="respond-invite" data-invite-id="${state.invite.id}" data-response="reject" aria-label="${escapeHtml(t("rejectInvite"))}">&#10005;</button>
        </div>
      `;
    }
    if (state.kind === "active") {
      return `<span class="status-pill pill-accent connection-state-pill">${escapeHtml(t("connectionActive"))}</span>`;
    }
    if (state.kind === "outgoing") {
      return `<span class="status-pill connection-state-pill">${escapeHtml(t("connectionInvited"))}</span>`;
    }
    return `<button class="button button-secondary connection-invite-button" type="button" data-action="send-connection-invite" data-user-id="${friend.id}">${escapeHtml(t("connectionInvite"))}</button>`;
  }

  function normalizeRenderableNodes(nodes) {
    return (nodes || []).filter((node) => !(node.nodeType === Node.TEXT_NODE && !String(node.textContent || "").trim()));
  }

  function getNodeDiffKey(node) {
    if (!(node instanceof Element)) return null;
    if (node.dataset.diffKey) return `diff:${node.dataset.diffKey}`;
    if (node.id) return `id:${node.id}`;
    if (node.dataset.scrollKey) return `scroll:${node.dataset.scrollKey}`;
    if (node.dataset.roomId && node.dataset.action) return `room:${node.dataset.roomId}:${node.dataset.action}`;
    if (node.dataset.userId && node.dataset.action) return `user:${node.dataset.userId}:${node.dataset.action}`;
    if (node.dataset.messageId && node.dataset.action) return `message:${node.dataset.messageId}:${node.dataset.action}`;
    if (node.dataset.inviteId) return `invite:${node.dataset.inviteId}:${node.dataset.response || node.dataset.action || node.tagName}`;
    if (node.dataset.tabId) return `tab:${node.dataset.tabId}`;
    if (node.dataset.input && node.dataset.roomId) return `input:${node.dataset.input}:${node.dataset.roomId}`;
    if (node.dataset.input) return `input:${node.dataset.input}`;
    return null;
  }

  function shouldPreserveLiveInput(element) {
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) {
      return false;
    }
    if (document.activeElement !== element) return false;
    if (runtime.compositionActive) return true;
    if (element.dataset.input === "composer" || element.dataset.input === "room-search") return true;
    return false;
  }

  function syncElementAttributes(currentNode, nextNode) {
    const currentAttrs = new Set(currentNode.getAttributeNames());
    const nextAttrs = new Set(nextNode.getAttributeNames());

    currentAttrs.forEach((name) => {
      if (!nextAttrs.has(name)) {
        currentNode.removeAttribute(name);
      }
    });

    nextAttrs.forEach((name) => {
      const nextValue = nextNode.getAttribute(name);
      if (currentNode.getAttribute(name) !== nextValue) {
        currentNode.setAttribute(name, nextValue);
      }
    });
  }

  function syncFormControlValue(currentNode, nextNode) {
    if (currentNode instanceof HTMLInputElement && nextNode instanceof HTMLInputElement) {
      if (!shouldPreserveLiveInput(currentNode) && currentNode.value !== nextNode.value) {
        currentNode.value = nextNode.value;
      }
      if (currentNode.checked !== nextNode.checked) {
        currentNode.checked = nextNode.checked;
      }
      return;
    }

    if (currentNode instanceof HTMLTextAreaElement && nextNode instanceof HTMLTextAreaElement) {
      if (!shouldPreserveLiveInput(currentNode) && currentNode.value !== nextNode.value) {
        currentNode.value = nextNode.value;
      }
      return;
    }

    if (currentNode instanceof HTMLSelectElement && nextNode instanceof HTMLSelectElement) {
      if (!shouldPreserveLiveInput(currentNode) && currentNode.value !== nextNode.value) {
        currentNode.value = nextNode.value;
      }
    }
  }

  function findReusableChild(existingChildren, nextChild, usedChildren) {
    const keyedNext = getNodeDiffKey(nextChild);
    if (keyedNext) {
      return (
        existingChildren.find((child) => !usedChildren.has(child) && getNodeDiffKey(child) === keyedNext) || null
      );
    }

    return (
      existingChildren.find((child) => {
        if (usedChildren.has(child)) return false;
        if (getNodeDiffKey(child)) return false;
        if (child.nodeType !== nextChild.nodeType) return false;
        if (child.nodeType === Node.ELEMENT_NODE) {
          return child.nodeName === nextChild.nodeName;
        }
        return true;
      }) || null
    );
  }

  function patchDomNode(currentNode, nextNode) {
    if (!currentNode || !nextNode) return;

    if (
      currentNode.nodeType !== nextNode.nodeType ||
      currentNode.nodeName !== nextNode.nodeName ||
      getNodeDiffKey(currentNode) !== getNodeDiffKey(nextNode)
    ) {
      currentNode.replaceWith(nextNode.cloneNode(true));
      return;
    }

    if (currentNode.nodeType === Node.TEXT_NODE) {
      if (currentNode.textContent !== nextNode.textContent) {
        currentNode.textContent = nextNode.textContent;
      }
      return;
    }

    if (!(currentNode instanceof Element) || !(nextNode instanceof Element)) {
      return;
    }

    syncElementAttributes(currentNode, nextNode);
    syncFormControlValue(currentNode, nextNode);
    patchChildList(currentNode, normalizeRenderableNodes(Array.from(nextNode.childNodes)));
  }

  function patchChildList(parentNode, nextChildren) {
    Array.from(parentNode.childNodes).forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE && !String(child.textContent || "").trim()) {
        child.remove();
      }
    });
    const existingChildren = normalizeRenderableNodes(Array.from(parentNode.childNodes));
    const usedChildren = new Set();
    let referenceNode = parentNode.firstChild;

    nextChildren.forEach((nextChild) => {
      const reusableChild = findReusableChild(existingChildren, nextChild, usedChildren);
      if (reusableChild) {
        usedChildren.add(reusableChild);
        patchDomNode(reusableChild, nextChild);
        if (reusableChild !== referenceNode) {
          parentNode.insertBefore(reusableChild, referenceNode);
        }
        referenceNode = reusableChild.nextSibling;
        return;
      }

      const clone = nextChild.cloneNode(true);
      parentNode.insertBefore(clone, referenceNode);
    });

    existingChildren.forEach((child) => {
      if (!usedChildren.has(child)) {
        child.remove();
      }
    });
  }

  function patchRootHtml(nextHtml) {
    const template = document.createElement("template");
    template.innerHTML = nextHtml.trim();
    patchChildList(APP_ROOT, normalizeRenderableNodes(Array.from(template.content.childNodes)));
  }

  function render() {
    try {
      console.debug("[transchat] render:start");
      if (runtime.compositionActive) {
        runtime.pendingRenderWhileComposing = true;
        return;
      }
      const focusState = captureFocusState();
      const chatScrollState = captureChatScrollState();
      const surfaceScrollState = captureSurfaceScrollState();
      applyTheme();
      const currentUser = getCurrentUser();
      document.documentElement.lang = getUiLanguage();
      patchRootHtml(currentUser ? renderShellMobile(currentUser) : renderLandingEnhancedV2());
      bindPostRender(focusState, chatScrollState, surfaceScrollState);
      console.debug("[transchat] render:complete");
    } catch (error) {
      reportBootstrapError(error, "render");
    }
  }

  function renderLanding() {
    const selectedNative = getLanguageMeta(uiState.landing.nativeLanguage || "ko");
    const landingProfileImage = uiState.landing.profileImage || DEFAULT_PROFILE_IMAGE;
    return `
      <main class="shell landing">
        <div class="landing-card landing-card-minimal">
          <section class="landing-minimal-panel">
            <h1 class="brand landing-brand-minimal">TRANSCHAT</h1>
            <form class="landing-minimal-form" data-form="landing">
              <div class="landing-profile-picker-block">
                <button
                  class="landing-profile-picker"
                  type="button"
                  data-action="trigger-landing-profile"
                  aria-label="${escapeHtml(t("landingPhotoLabel"))}"
                >
                  ${renderProfileImage(landingProfileImage, "landing-profile-image", t("landingPhotoLabel"))}
                </button>
                <div class="landing-profile-copy">
                  <strong>${escapeHtml(t("landingPhotoLabel"))}</strong>
                  <span>${escapeHtml(t("landingPhotoHelper"))}</span>
                </div>
                <input data-input="landing-profile-image" type="file" accept="image/jpeg,image/png,image/webp" hidden>
              </div>
              <div class="landing-input-row">
                <input
                  id="entry-name"
                  name="name"
                  type="text"
                  maxlength="24"
                  value="${escapeHtml(uiState.landing.name)}"
                  placeholder="${escapeHtml(t("landingNamePlaceholderSimple"))}"
                  autocapitalize="off"
                  autocomplete="off"
                />
                <button class="landing-submit-button" type="submit" aria-label="${escapeHtml(t("enterButton"))}">
                  →
                </button>
              </div>
              <div class="landing-language-accordion">
                <button
                  class="landing-language-accordion-trigger"
                  type="button"
                  data-action="toggle-landing-native-accordion"
                  aria-expanded="${uiState.landing.nativeAccordionOpen ? "true" : "false"}"
                >
                  <span class="landing-language-trigger-main">
                    <span aria-hidden="true">${selectedNative.flag}</span>
                    <span>${escapeHtml(selectedNative.nativeLabel)}</span>
                  </span>
                  <span class="landing-language-trigger-caret" aria-hidden="true">${uiState.landing.nativeAccordionOpen ? "−" : "+"}</span>
                </button>
                ${uiState.landing.nativeAccordionOpen
                  ? `<div class="landing-language-accordion-panel">${renderLanguageAccordionOptions(uiState.landing.nativeLanguage)}</div>`
                  : ""}
              </div>
            </form>
          </section>
        </div>
      </main>
      ${renderToastStack()}
    `;
  }

  // Added: keep the existing landing structure but move UI-language controls below native-language selection for visibility.
  function renderLandingEnhanced() {
    const selectedNative = getLanguageMeta(uiState.landing.nativeLanguage || "ko");
    const landingProfileImage = uiState.landing.profileImage || DEFAULT_PROFILE_IMAGE;
    return `
      <main class="shell landing">
        <div class="landing-card landing-card-minimal">
          <section class="landing-minimal-panel">
            <h1 class="brand landing-brand-minimal">TRANSCHAT</h1>
            <form class="landing-minimal-form" data-form="landing">
              <div class="landing-profile-picker-block">
                <button
                  class="landing-profile-picker"
                  type="button"
                  data-action="trigger-landing-profile"
                  aria-label="${escapeHtml(t("landingPhotoLabel"))}"
                >
                  ${renderProfileImage(landingProfileImage, "landing-profile-image", t("landingPhotoLabel"))}
                </button>
                <div class="landing-profile-copy">
                  <strong>${escapeHtml(t("landingPhotoLabel"))}</strong>
                  <span>${escapeHtml(t("landingPhotoHelper"))}</span>
                </div>
                <input data-input="landing-profile-image" type="file" accept="image/jpeg,image/png,image/webp" hidden>
              </div>
              <div class="landing-input-row">
                <input
                  id="entry-name"
                  name="name"
                  type="text"
                  maxlength="24"
                  value="${escapeHtml(uiState.landing.name)}"
                  placeholder="${escapeHtml(t("landingNamePlaceholderSimple"))}"
                  autocapitalize="off"
                  autocomplete="off"
                />
                <button class="landing-submit-button" type="submit" aria-label="${escapeHtml(t("enterButton"))}">&rarr;</button>
              </div>
              <div class="landing-language-accordion">
                <button
                  class="landing-language-accordion-trigger"
                  type="button"
                  data-action="toggle-landing-native-accordion"
                  aria-expanded="${uiState.landing.nativeAccordionOpen ? "true" : "false"}"
                >
                  <span class="landing-language-trigger-main">
                    <span aria-hidden="true">${selectedNative.flag}</span>
                    <span>${escapeHtml(selectedNative.nativeLabel)}</span>
                  </span>
                  <span class="landing-language-trigger-caret" aria-hidden="true">${uiState.landing.nativeAccordionOpen ? "&minus;" : "+"}</span>
                </button>
                ${uiState.landing.nativeAccordionOpen
                  ? `<div class="landing-language-accordion-panel">${renderLanguageAccordionOptions(uiState.landing.nativeLanguage)}</div>`
                  : ""}
              </div>
              <div class="landing-ui-language-row" aria-label="${escapeHtml(t("labelUiLanguage"))}">
                <span class="landing-ui-language-icon" aria-hidden="true">🖥️</span>
                <div class="landing-ui-language-buttons">${renderLandingLanguageButtons()}</div>
              </div>
            </form>
          </section>
        </div>
      </main>
      ${renderToastStack()}
    `;
  }

  function renderLandingSignupPanel() {
    if (uiState.landing.mode !== "signup") return "";
    const questionKey = uiState.landing.signupQuestionKey || getRandomRecoveryQuestionKey();
    return `
      <div class="landing-inline-panel" data-panel="signup">
        <h3>${escapeHtml(t("signupButton"))}</h3>
        <div class="field compact-field">
          <label for="signup-name">${escapeHtml(t("authIdLabel"))}</label>
          <input
            id="signup-name"
            type="text"
            data-input="signup-name"
            maxlength="24"
            value="${escapeHtml(uiState.landing.signupName)}"
            placeholder="${escapeHtml(t("landingNamePlaceholderSimple"))}"
            autocapitalize="off"
            autocomplete="off"
          />
        </div>
        <div class="field compact-field">
          <label for="signup-password">${escapeHtml(t("authPasswordLabel"))}</label>
          <input
            id="signup-password"
            type="password"
            data-input="signup-password"
            value="${escapeHtml(uiState.landing.signupPassword)}"
            placeholder="${escapeHtml(t("authPasswordPlaceholder"))}"
            autocomplete="new-password"
          />
        </div>
        <div class="field compact-field">
          <label for="signup-password-confirm">${escapeHtml(t("authPasswordConfirmLabel"))}</label>
          <input
            id="signup-password-confirm"
            type="password"
            data-input="signup-password-confirm"
            value="${escapeHtml(uiState.landing.signupPasswordConfirm)}"
            placeholder="${escapeHtml(t("authPasswordConfirmPlaceholder"))}"
            autocomplete="new-password"
          />
        </div>
        <div class="field compact-field">
          <label>${escapeHtml(t("authRecoveryQuestionLabel"))}</label>
          <div class="landing-question-pill">${escapeHtml(t(questionKey))}</div>
        </div>
        <div class="field compact-field">
          <label for="signup-answer">${escapeHtml(t("authRecoveryAnswerLabel"))}</label>
          <input
            id="signup-answer"
            type="text"
            data-input="signup-answer"
            value="${escapeHtml(uiState.landing.signupAnswer)}"
            placeholder="${escapeHtml(t("authRecoveryAnswerPlaceholder"))}"
            autocapitalize="off"
            autocomplete="off"
          />
          <span class="helper">${escapeHtml(t("authRecoveryAnswerHelper"))}</span>
        </div>
        <div class="landing-panel-actions">
          <button class="button button-primary" type="button" data-action="submit-landing-signup">${escapeHtml(t("signupCompleteButton"))}</button>
          <button class="button button-secondary" type="button" data-action="close-landing-panel">${escapeHtml(t("cancel"))}</button>
        </div>
      </div>
    `;
  }

  function renderLandingPasswordResetPanel() {
    if (uiState.landing.mode !== "reset") return "";
    const resetUser = appState.users.find(
      (user) => normalizeLoginIdentity(user.name) === normalizeLoginIdentity(uiState.landing.resetName)
    );
    const questionKey = resetUser?.recoveryQuestionKey || uiState.landing.resetQuestionKey;
    return `
      <div class="landing-inline-panel" data-panel="reset">
        <h3>${escapeHtml(t("passwordChangeButton"))}</h3>
        <div class="field compact-field">
          <label for="reset-name">${escapeHtml(t("authIdLabel"))}</label>
          <input
            id="reset-name"
            type="text"
            data-input="reset-name"
            maxlength="24"
            value="${escapeHtml(uiState.landing.resetName)}"
            placeholder="${escapeHtml(t("landingNamePlaceholderSimple"))}"
            autocapitalize="off"
            autocomplete="off"
          />
        </div>
        ${uiState.landing.resetVerified
          ? `
            <div class="field compact-field">
              <label for="reset-password">${escapeHtml(t("authNewPasswordLabel"))}</label>
              <input
                id="reset-password"
                type="password"
                data-input="reset-password"
                value="${escapeHtml(uiState.landing.resetPassword)}"
                placeholder="${escapeHtml(t("authNewPasswordPlaceholder"))}"
                autocomplete="new-password"
              />
            </div>
            <div class="field compact-field">
              <label for="reset-password-confirm">${escapeHtml(t("authPasswordConfirmLabel"))}</label>
              <input
                id="reset-password-confirm"
                type="password"
                data-input="reset-password-confirm"
                value="${escapeHtml(uiState.landing.resetPasswordConfirm)}"
                placeholder="${escapeHtml(t("authPasswordConfirmPlaceholder"))}"
                autocomplete="new-password"
              />
            </div>
            <div class="landing-panel-actions">
              <button class="button button-primary" type="button" data-action="submit-landing-password-update">${escapeHtml(t("passwordUpdateButton"))}</button>
              <button class="button button-secondary" type="button" data-action="close-landing-panel">${escapeHtml(t("cancel"))}</button>
            </div>
          `
          : `
            <div class="field compact-field">
              <label>${escapeHtml(t("authRecoveryQuestionLabel"))}</label>
              <div class="landing-question-pill">${escapeHtml(questionKey ? t(questionKey) : t("passwordResetFindIdHint"))}</div>
            </div>
            <div class="field compact-field">
              <label for="reset-answer">${escapeHtml(t("authRecoveryAnswerLabel"))}</label>
              <input
                id="reset-answer"
                type="text"
                data-input="reset-answer"
                value="${escapeHtml(uiState.landing.resetAnswer)}"
                placeholder="${escapeHtml(t("authRecoveryAnswerPlaceholder"))}"
                autocapitalize="off"
                autocomplete="off"
              />
              <span class="helper">${escapeHtml(t("authRecoveryAnswerHelper"))}</span>
            </div>
            <div class="landing-panel-actions">
              <button class="button button-primary" type="button" data-action="submit-landing-password-verify">${escapeHtml(t("nextButton"))}</button>
              <button class="button button-secondary" type="button" data-action="close-landing-panel">${escapeHtml(t("cancel"))}</button>
            </div>
          `}
      </div>
    `;
  }

  function renderLandingUiLanguageRow(centered = false) {
    return `
      <div class="landing-ui-language-row ${centered ? "centered" : ""}" aria-label="${escapeHtml(t("labelUiLanguage"))}">
        <span class="landing-ui-language-icon" aria-hidden="true">&#128421;&#65039;</span>
        <div class="landing-ui-language-buttons">${renderLandingLanguageButtons()}</div>
      </div>
    `;
  }

  function renderLandingLoginScreen() {
    return `
      <section class="landing-minimal-panel">
        <h1 class="brand landing-brand-minimal">TRANSCHAT</h1>
        <form class="landing-minimal-form" data-form="landing">
          <div class="landing-input-stack">
            <input
              id="entry-name"
              name="name"
              type="text"
              maxlength="24"
              value="${escapeHtml(uiState.landing.name)}"
              placeholder="${escapeHtml(t("landingNamePlaceholderSimple"))}"
              autocapitalize="off"
              autocomplete="username"
            />
            <input
              id="entry-password"
              name="password"
              type="password"
              value="${escapeHtml(uiState.landing.password)}"
              placeholder="${escapeHtml(t("authPasswordPlaceholder"))}"
              autocomplete="current-password"
            />
          </div>
          <label class="landing-checkbox-row" for="entry-auto-login">
            <input
              id="entry-auto-login"
              name="autoLogin"
              type="checkbox"
              data-input="landing-auto-login"
              ${uiState.landing.autoLogin ? "checked" : ""}
            />
            <span>${escapeHtml(t("authAutoLoginLabel"))}</span>
          </label>
          <div class="landing-auth-actions">
            <button class="button button-primary landing-auth-button" type="submit">${escapeHtml(t("loginButton"))}</button>
          </div>
          <div class="landing-auth-links">
            <button class="landing-text-button" type="button" data-action="open-landing-signup">${escapeHtml(t("signupButton"))}</button>
            <button class="landing-text-button" type="button" data-action="open-landing-reset">${escapeHtml(t("passwordChangeButton"))}</button>
          </div>
          <p class="landing-inline-helper ${uiState.landing.error ? "error" : ""}">
            ${escapeHtml(uiState.landing.error || "")}
          </p>
        </form>
        ${renderLandingUiLanguageRow(true)}
      </section>
    `;
  }

  function renderLandingSignupScreen() {
    const selectedNative = getLanguageMeta(uiState.landing.signupNativeLanguage || "ko");
    const landingProfileImage = uiState.landing.profileImage || DEFAULT_PROFILE_IMAGE;
    return `
      <section class="landing-minimal-panel">
        <div class="landing-screen-topbar">
          <button class="landing-text-button back" type="button" data-action="close-landing-panel">${escapeHtml(t("landingBackToLogin"))}</button>
        </div>
        <div class="landing-screen-copy">
          <h2>${escapeHtml(t("signupScreenTitle"))}</h2>
          <p>${escapeHtml(t("signupScreenCopy"))}</p>
        </div>
        <form class="landing-minimal-form" data-form="landing-signup">
          <div class="landing-profile-picker-block">
            <button
              class="landing-profile-picker"
              type="button"
              data-action="trigger-landing-profile"
              aria-label="${escapeHtml(t("landingPhotoLabel"))}"
            >
              ${renderProfileImage(landingProfileImage, "landing-profile-image", t("landingPhotoLabel"))}
            </button>
            <div class="landing-profile-copy">
              <strong>${escapeHtml(t("landingPhotoLabel"))}</strong>
              <span>${escapeHtml(t("landingPhotoHelper"))}</span>
            </div>
            <input data-input="landing-profile-image" type="file" accept="image/jpeg,image/png,image/webp" hidden>
          </div>
          <div class="landing-input-stack">
            <input
              id="signup-id"
              data-input="signup-id"
              type="text"
              maxlength="24"
              value="${escapeHtml(uiState.landing.signupId)}"
              placeholder="${escapeHtml(t("landingNamePlaceholderSimple"))}"
              autocapitalize="off"
              autocomplete="username"
            />
            <input
              id="signup-password"
              data-input="signup-password"
              type="password"
              value="${escapeHtml(uiState.landing.signupPassword)}"
              placeholder="${escapeHtml(t("authPasswordPlaceholder"))}"
              autocomplete="new-password"
            />
            <input
              id="signup-name"
              data-input="signup-name"
              type="text"
              maxlength="24"
              value="${escapeHtml(uiState.landing.signupName)}"
              placeholder="${escapeHtml(t("authNamePlaceholder"))}"
              autocapitalize="off"
              autocomplete="off"
            />
          </div>
          <div class="landing-language-accordion">
            <button
              class="landing-language-accordion-trigger"
              type="button"
              data-action="toggle-signup-native-accordion"
              aria-expanded="${uiState.landing.signupNativeAccordionOpen ? "true" : "false"}"
            >
              <span class="landing-language-trigger-main">
                <span aria-hidden="true">${selectedNative.flag}</span>
                <span>${escapeHtml(selectedNative.nativeLabel)}</span>
              </span>
              <span class="landing-language-trigger-caret" aria-hidden="true">${uiState.landing.signupNativeAccordionOpen ? "&minus;" : "+"}</span>
            </button>
            ${uiState.landing.signupNativeAccordionOpen
              ? `<div class="landing-language-accordion-panel">${renderLanguageAccordionOptions(
                  uiState.landing.signupNativeLanguage,
                  "select-signup-native-language"
                )}</div>`
              : ""}
          </div>
          <div class="field compact-field">
            <label>${escapeHtml(t("authRecoveryQuestionLabel"))}</label>
            <div class="landing-question-pill">${escapeHtml(t(uiState.landing.signupQuestionKey || getRandomRecoveryQuestionKey()))}</div>
          </div>
          <div class="field compact-field">
            <label for="signup-answer">${escapeHtml(t("authRecoveryAnswerLabel"))}</label>
            <input
              id="signup-answer"
              data-input="signup-answer"
              type="text"
              value="${escapeHtml(uiState.landing.signupAnswer)}"
              placeholder="${escapeHtml(t("authRecoveryAnswerPlaceholder"))}"
              autocapitalize="off"
              autocomplete="off"
            />
            <span class="helper">${escapeHtml(t("authRecoveryAnswerHelper"))}</span>
          </div>
          <div class="landing-auth-actions">
            <button class="button button-primary landing-auth-button" type="button" data-action="submit-landing-signup">${escapeHtml(t("signupCompleteButton"))}</button>
          </div>
          <p class="landing-inline-helper ${uiState.landing.error ? "error" : ""}">
            ${escapeHtml(uiState.landing.error || "")}
          </p>
        </form>
        ${renderLandingUiLanguageRow(true)}
      </section>
    `;
  }

  function renderLandingResetScreen() {
    const questionKey = uiState.landing.resetQuestionKey;
    return `
      <section class="landing-minimal-panel">
        <div class="landing-screen-topbar">
          <button class="landing-text-button back" type="button" data-action="close-landing-panel">${escapeHtml(t("landingBackToLogin"))}</button>
        </div>
        <div class="landing-screen-copy">
          <h2>${escapeHtml(t("resetScreenTitle"))}</h2>
          <p>${escapeHtml(t("resetScreenCopy"))}</p>
        </div>
        <form class="landing-minimal-form" data-form="landing-reset">
          <div class="landing-input-stack">
            <input
              id="reset-name"
              data-input="reset-name"
              type="text"
              maxlength="24"
              value="${escapeHtml(uiState.landing.resetName)}"
              placeholder="${escapeHtml(t("landingNamePlaceholderSimple"))}"
              autocapitalize="off"
              autocomplete="username"
            />
            ${uiState.landing.resetVerified
              ? `
                <input
                  id="reset-password"
                  data-input="reset-password"
                  type="password"
                  value="${escapeHtml(uiState.landing.resetPassword)}"
                  placeholder="${escapeHtml(t("authNewPasswordPlaceholder"))}"
                  autocomplete="new-password"
                />
                <input
                  id="reset-password-confirm"
                  data-input="reset-password-confirm"
                  type="password"
                  value="${escapeHtml(uiState.landing.resetPasswordConfirm)}"
                  placeholder="${escapeHtml(t("authPasswordConfirmPlaceholder"))}"
                  autocomplete="new-password"
                />
              `
              : `
                <div class="landing-question-pill">${escapeHtml(questionKey ? t(questionKey) : t("passwordResetFindIdHint"))}</div>
                <input
                  id="reset-answer"
                  data-input="reset-answer"
                  type="text"
                  value="${escapeHtml(uiState.landing.resetAnswer)}"
                  placeholder="${escapeHtml(t("authRecoveryAnswerPlaceholder"))}"
                  autocapitalize="off"
                  autocomplete="off"
                />
              `}
          </div>
          ${uiState.landing.resetVerified ? "" : `<p class="landing-inline-helper">${escapeHtml(t("authRecoveryAnswerHelper"))}</p>`}
          <div class="landing-auth-actions">
            <button
              class="button button-primary landing-auth-button"
              type="button"
              data-action="${uiState.landing.resetVerified ? "submit-landing-password-update" : "submit-landing-password-verify"}"
            >
              ${escapeHtml(t(uiState.landing.resetVerified ? "passwordUpdateButton" : "nextButton"))}
            </button>
          </div>
          <p class="landing-inline-helper ${uiState.landing.error ? "error" : ""}">
            ${escapeHtml(uiState.landing.error || "")}
          </p>
        </form>
        ${renderLandingUiLanguageRow(true)}
      </section>
    `;
  }

  function renderLandingEnhancedV2() {
    const content =
      uiState.landing.mode === "signup"
        ? renderLandingSignupScreen()
        : uiState.landing.mode === "reset"
          ? renderLandingResetScreen()
          : renderLandingLoginScreen();

    return `
      <main class="shell landing">
        <div class="landing-card landing-card-minimal">
          ${content}
        </div>
      </main>
      ${renderModal()}
      ${renderToastStack()}
    `;
  }

  function renderShellMobile(currentUser) {
    const activeRoom = uiState.directoryTab === "chat"
      ? appState.rooms.find((room) => room.id === uiState.activeRoomId && room.status === "active") || null
      : null;
    const inRoom = Boolean(activeRoom);

    return `
      <main class="shell app-shell mobile-shell ${inRoom ? "in-room" : ""}">
        ${inRoom ? "" : renderMobileTopbar(currentUser)}
        <section class="workspace workspace-single mobile-workspace">
          ${renderMobileWorkspace(currentUser, activeRoom)}
        </section>
        ${inRoom ? "" : renderBottomDirectoryMobile()}
      </main>
      ${renderModal()}
      ${uiState.modal?.type === "search" ? renderSearchModalMobile(currentUser) : ""}
      ${renderToastStack()}
    `;
  }

  function renderMobileTopbar(currentUser) {
    const displayName = normalizeDisplayText(currentUser?.name || currentUser?.loginId || "");
    return `
      <header class="topbar mobile-topbar">
        <button class="brand-chip compact brand-chip-button" type="button" data-action="go-connections">
          <div class="brand-mark">T</div>
          <div class="brand-meta">
            <strong>TRANSCHAT</strong>
          </div>
        </button>
        <button class="profile-chip compact profile-chip-button" type="button" data-action="go-my-info">
          ${renderProfileImage(currentUser, "avatar avatar-image", currentUser.name)}
          <div class="profile-text">
            <strong>${escapeHtml(displayName || currentUser.loginId || currentUser.name)}</strong>
            ${currentUser.loginId && displayName !== currentUser.loginId ? `<span>${escapeHtml(currentUser.loginId)}</span>` : ""}
          </div>
        </button>
      </header>
    `;
  }

  function renderMobileWorkspace(currentUser, activeRoom) {
    if (uiState.directoryTab === "friends") {
      return renderFriendsScreenMobile(currentUser);
    }
    if (uiState.directoryTab === "me") {
      return renderMyInfoScreenMobile(currentUser);
    }
    return activeRoom ? renderChatRoomMobileEnhanced(currentUser, activeRoom) : renderChatListScreenMobile(currentUser);
  }

  function renderBottomDirectoryMobile() {
    return `
      <section class="directory-dock nav-only mobile-nav-dock">
        <div class="directory-shell nav-shell">
          <nav class="directory-tabs tabs-only mobile-tabs">
            ${renderDirectoryTabButtonMobile("friends", "tabFriends", "👥")}
            ${renderDirectoryTabButtonMobile("chat", "tabActiveRooms", "💬")}
            ${renderDirectoryTabButtonMobile("me", "tabMyInfo", "🙂")}
          </nav>
        </div>
      </section>
    `;
  }

  function renderDirectoryTabButtonMobile(tabId, labelKey, icon) {
    const currentUser = getCurrentUser();
    const active = uiState.directoryTab === tabId || (tabId === "chat" && uiState.directoryTab === "all-rooms");
    return `
      <button
        class="directory-tab mobile-tab ${active ? "active" : ""}"
        data-action="switch-directory-tab"
        data-tab-id="${tabId}"
      >
        ${renderTabBadge(tabId, currentUser)}
        <span class="mobile-tab-icon" aria-hidden="true">${icon}</span>
        <span>${escapeHtml(t(labelKey))}</span>
      </button>
    `;
  }

  function renderChatListScreenMobile(currentUser) {
    const joinedRooms = appState.rooms
      .filter((room) => room.status === "active")
      .sort((a, b) => {
        const aIsCurrent = currentUser.currentRoomId === a.id ? 1 : 0;
        const bIsCurrent = currentUser.currentRoomId === b.id ? 1 : 0;
        if (aIsCurrent !== bIsCurrent) {
          return bIsCurrent - aIsCurrent;
        }
        const aParticipating = deriveRoomParticipantIds(a).includes(currentUser.id) ? 1 : 0;
        const bParticipating = deriveRoomParticipantIds(b).includes(currentUser.id) ? 1 : 0;
        if (aParticipating !== bParticipating) {
          return bParticipating - aParticipating;
        }
        return (b.lastMessageAt || b.createdAt || 0) - (a.lastMessageAt || a.createdAt || 0);
      });

    return `
      <section class="panel screen-panel mobile-screen">
        <div class="screen-header mobile-screen-header">
          <h2>${escapeHtml(t("tabActiveRooms"))}</h2>
          <div class="mobile-header-actions">
            <button class="icon-button mobile-icon-button" data-action="open-search" aria-label="${escapeHtml(t("roomSearchPlaceholder"))}" title="${escapeHtml(t("roomSearchPlaceholder"))}">
              🔍
            </button>
            <button class="icon-button mobile-icon-button accent" data-action="open-modal" data-modal="create-room" aria-label="${escapeHtml(t("createRoomButton"))}" title="${escapeHtml(t("createRoomButton"))}">
              +
            </button>
          </div>
        </div>
        <div class="screen-body mobile-list-body" data-scroll-key="chat-list">
          ${joinedRooms.length
            ? joinedRooms.map((room) => renderRoomCardMobile(room, currentUser)).join("")
            : `<div class="empty-card compact-empty"><h3>${escapeHtml(t("activeRoomsEmptyTitle"))}</h3><p>${escapeHtml(t("activeRoomsEmptyCopy"))}</p></div>`}
        </div>
      </section>
    `;
  }

  function renderRoomCardMobile(room) {
    const creator = appState.users.find((user) => user.id === room.creatorId);
    return `
      <button class="room-card mobile-room-card ${uiState.activeRoomId === room.id ? "active" : ""}" data-action="open-room" data-room-id="${room.id}" data-diff-key="room:${room.id}">
        <div class="room-topline">
          <strong>${escapeHtml(normalizeDisplayText(room.title))}</strong>
          ${room.isProtected ? `<span class="room-lock" aria-label="${escapeHtml(t("roomProtected"))}">🔒</span>` : ""}
        </div>
        <span class="room-owner mobile-room-owner">👑 ${escapeHtml(creator?.name || "—")}</span>
        <span class="room-preview">${escapeHtml(getRoomPreviewText(room))}</span>
      </button>
    `;
  }

  function getRoomPreviewText(room) {
    const latestUserMessage = (room.messages || []).slice().reverse().find((message) => message.kind === "user");
    if (latestUserMessage?.originalText) {
      return latestUserMessage.originalText.slice(0, 42);
    }
    return formatRelativeTime(room.lastMessageAt || room.createdAt);
  }

  function renderFriendsScreenMobile(currentUser) {
    const friends = getCanonicalUsersForDisplay(appState.users)
      .filter((user) => user.id !== currentUser.id)
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt || a.name.localeCompare(b.name));

    return `
      <section class="panel screen-panel mobile-screen">
        <div class="screen-header mobile-screen-header">
          <h2>${escapeHtml(t("tabFriends"))}</h2>
        </div>
        <div class="screen-body mobile-list-body" data-scroll-key="friends-list">
          ${friends.length
            ? friends.map((friend) => renderFriendRowMobile(friend, currentUser)).join("")
            : `<div class="empty-card compact-empty"><h3>${escapeHtml(t("friendsEmptyTitle"))}</h3><p>${escapeHtml(t("friendsEmptyCopy"))}</p></div>`}
        </div>
      </section>
    `;
  }

  function renderFriendRowMobile(friend, currentUser) {
    const presence = getPresence(friend, friend.currentRoomId || null);
    const displayName = getUserDisplayName(friend) || friend.loginId || friend.name;
    const canDeleteUser = isAdminUser(currentUser) && !isAdminUser(friend);
    return `
      <article class="friend-card mobile-friend-card" data-diff-key="friend:${friend.id}">
        ${renderProfileImage(friend, "list-profile-image", friend.name)}
        <button class="friend-name-button" type="button" data-action="open-profile-preview" data-user-id="${friend.id}">
          <strong>${escapeHtml(displayName)}</strong>
        </button>
        <div class="friend-row-tail">
          <span class="friend-inline-presence ${presence.kind}">${renderPresenceLabel(presence, { compact: true })}</span>
          ${currentUser ? renderConnectionActionV2(friend, currentUser) : `<span class="tiny-status ${presence.kind}">${escapeHtml(presence.label)}</span>`}
          ${canDeleteUser
            ? `<button class="connection-icon-button admin-delete-user-button" type="button" data-action="admin-delete-user" data-user-id="${friend.id}" aria-label="${escapeHtml(t("adminDeleteUserButton"))}" title="${escapeHtml(t("adminDeleteUserButton"))}">×</button>`
            : ""}
        </div>
      </article>
    `;
  }

  function renderMyInfoScreenMobile(currentUser) {
    const profileEditor = syncProfileEditor(currentUser);
    const adminView = isAdminUser(currentUser);

    return `
      <section class="panel screen-panel mobile-screen">
        <div class="screen-header mobile-screen-header">
          <h2>${escapeHtml(t("tabMyInfo"))}</h2>
        </div>
        <div class="screen-body mobile-list-body my-info-mobile" data-scroll-key="my-info">
          ${adminView
            ? ""
            : `
              <div class="setting-card compact profile-edit-card">
                <div class="profile-edit-head">
                  ${renderProfileImage(currentUser, "profile-edit-image", currentUser.name)}
                  <div class="profile-edit-copy">
                    <strong>${escapeHtml(t("profileCardTitle"))}</strong>
                    <span class="helper">${escapeHtml(currentUser.loginId || "")}</span>
                  </div>
                </div>
                <div class="profile-edit-actions">
                  <button class="button button-secondary" type="button" data-action="trigger-profile-image">${escapeHtml(t("profilePhotoChange"))}</button>
                  <button class="button button-ghost" type="button" data-action="remove-profile-image">${escapeHtml(t("profilePhotoRemove"))}</button>
                </div>
                <input data-input="my-profile-image" type="file" accept="image/jpeg,image/png,image/webp" hidden>
                <div class="field compact-field">
                  <label>${escapeHtml(t("profileAccountIdLabel"))}</label>
                  <div class="profile-static-value">${escapeHtml(currentUser.loginId || "")}</div>
                </div>
                <div class="field compact-field">
                  <label>${escapeHtml(t("profileNameReadonlyLabel"))}</label>
                  <div class="profile-static-value">${escapeHtml(currentUser.name || "")}</div>
                </div>
                <div class="field compact-field">
                  <label for="my-profile-gender">${escapeHtml(t("profileGenderLabel"))}</label>
                  <select id="my-profile-gender" data-input="my-profile-gender">
                    <option value="">${escapeHtml(t("profilePopupEmpty"))}</option>
                    <option value="male" ${profileEditor?.gender === "male" ? "selected" : ""}>${escapeHtml(t("authGenderMale"))}</option>
                    <option value="female" ${profileEditor?.gender === "female" ? "selected" : ""}>${escapeHtml(t("authGenderFemale"))}</option>
                  </select>
                </div>
                <div class="field compact-field">
                  <label for="my-profile-age">${escapeHtml(t("profileAgeLabel"))}</label>
                  <input
                    id="my-profile-age"
                    data-input="my-profile-age"
                    type="number"
                    min="0"
                    max="120"
                    inputmode="numeric"
                    value="${escapeHtml(profileEditor?.age || "")}"
                    placeholder="${escapeHtml(t("authAgePlaceholder"))}"
                    autocomplete="off"
                  />
                </div>
                <button class="button" type="button" data-action="save-basic-profile">${escapeHtml(t("profileSaveButton"))}</button>
              </div>
            `}
          <div class="setting-card compact">
            <strong>${escapeHtml(t("settingsUiLanguage"))}</strong>
            <div class="field compact-field">
              <select data-input="settings-ui-language">
                ${renderLanguageOptions(currentUser.uiLanguage, UI_LANGUAGES)}
              </select>
            </div>
          </div>
          <div class="setting-card compact">
            <strong>${escapeHtml(t("settingsNativeLanguage"))}</strong>
            <div class="field compact-field">
              <select data-input="settings-native-language">
                ${renderLanguageOptions(currentUser.nativeLanguage, CHAT_LANGUAGES)}
              </select>
            </div>
          </div>
          ${renderPushSettingsCard(currentUser)}
          ${renderPwaInstallCard()}
          <button class="button button-danger logout-inline-button" data-action="logout-current-user">${escapeHtml(t("logoutButton"))}</button>
        </div>
      </section>
    `;
  }

  function renderPushSettingsCard() {
    const currentUser = getCurrentUser();
    const pushStatus = getPushStatusMeta();
    const permission = getPushPermissionState();
    const disabled = permission === "unsupported";
    const tokenRegistered = Boolean(currentUser && runtime.push.token && runtime.push.tokenUserId === currentUser.id);
    const registrationStateKey = permission === "granted" ? (tokenRegistered ? "pushTokenReady" : "pushTokenPending") : "";
    return `
      <div class="setting-card compact">
        <strong>${escapeHtml(t("pushSettingsTitle"))}</strong>
        <span class="helper">${escapeHtml(t(pushStatus.stateKey))}</span>
        ${registrationStateKey ? `<span class="helper">${escapeHtml(t(registrationStateKey))}</span>` : ""}
        <div class="profile-edit-actions">
          <button
            class="button button-secondary"
            type="button"
            data-action="request-push-permission"
            ${disabled ? "disabled" : ""}
          >
            ${escapeHtml(t("pushEnableButton"))}
          </button>
        </div>
        <span class="helper">${escapeHtml(t(pushStatus.helperKey))}</span>
      </div>
    `;
  }

  function isStandaloneApp() {
    return Boolean(
      window.matchMedia?.("(display-mode: standalone)")?.matches ||
      window.navigator.standalone === true
    );
  }

  function isIosInstallGuideBrowser() {
    const ua = navigator.userAgent || "";
    const isIOS = /iphone|ipad|ipod/i.test(ua);
    const isWebKit = /webkit/i.test(ua);
    const isOtherBrowser = /CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua);
    return isIOS && isWebKit && !isOtherBrowser;
  }

  function syncPwaInstallState(options = {}) {
    runtime.pwa.installed = isStandaloneApp();
    if (runtime.pwa.installed) {
      runtime.pwa.deferredPrompt = null;
    }
    if (options.render) {
      renderSafelyDuringInput();
    }
  }

  function getPwaInstallMeta() {
    syncPwaInstallState();
    if (runtime.pwa.installed) {
      return {
        buttonKey: "pwaInstalledButton",
        helperKey: "pwaInstalledCopy",
        disabled: true,
      };
    }

    if (runtime.pwa.deferredPrompt) {
      return {
        buttonKey: "pwaInstallButton",
        helperKey: "pwaInstallReadyCopy",
        disabled: false,
      };
    }

    if (isIosInstallGuideBrowser()) {
      return {
        buttonKey: "pwaInstallGuideButton",
        helperKey: "pwaInstallIosCopy",
        disabled: false,
      };
    }

    return {
      buttonKey: "pwaInstallGuideButton",
      helperKey: runtime.pwa.swRegistered ? "pwaInstallManualCopy" : "pwaInstallUnsupportedCopy",
      disabled: false,
    };
  }

  function renderPwaInstallCard() {
    const meta = getPwaInstallMeta();
    return `
      <div class="setting-card compact pwa-install-card">
        <strong>${escapeHtml(t("pwaInstallTitle"))}</strong>
        <div class="profile-edit-actions single-action-row">
          <button
            class="button button-secondary pwa-install-button"
            type="button"
            data-action="trigger-pwa-install"
            ${meta.disabled ? "disabled" : ""}
          >
            ${escapeHtml(t(meta.buttonKey))}
          </button>
        </div>
        <span class="helper">${escapeHtml(t(meta.helperKey))}</span>
      </div>
    `;
  }

  async function triggerPwaInstallFlow() {
    syncPwaInstallState();
    if (runtime.pwa.installed) {
      renderSafelyDuringInput();
      return;
    }

    if (runtime.pwa.deferredPrompt) {
      const promptEvent = runtime.pwa.deferredPrompt;
      runtime.pwa.deferredPrompt = null;
      await promptEvent.prompt();
      try {
        await promptEvent.userChoice;
      } catch (error) {
        // Ignore dismissal; button state is recalculated from installability after the prompt closes.
      }
      syncPwaInstallState({ render: true });
      return;
    }

    openNoticeModal("pwaInstallGuideTitle", isIosInstallGuideBrowser() ? "pwaInstallIosCopy" : "pwaInstallManualCopy");
    render();
  }

  function renderChatRoomMobile(currentUser, room) {
    const participants = deriveRoomParticipantIds(room)
      .map((participantId) => appState.users.find((user) => user.id === participantId))
      .filter(Boolean);

    return `
      <section class="chat-panel mobile-chat-room">
        <header class="chat-header mobile-chat-header">
          <button class="icon-button back-button" data-action="back-to-chat-list" aria-label="Back">←</button>
          <h2>${escapeHtml(normalizeDisplayText(room.title))}</h2>
          <button
            class="menu-icon-button"
            data-action="toggle-chat-details"
            aria-label="${escapeHtml(t("participantsButton"))}"
            title="${escapeHtml(t("participantsButton"))}"
          >
            ☰
          </button>
        </header>
        <div class="participant-strip">
          ${participants.map((participant) => `<span class="participant-chip">${escapeHtml(participant.name)}</span>`).join("")}
        </div>
        <section class="chat-scroll" id="chat-scroll">
          ${renderMessageList(room, currentUser)}
        </section>
        <footer class="composer mobile-composer">${renderComposerMobile(room)}</footer>
        ${uiState.chatDetailsOpen ? renderChatDetailsMenuMobile(room) : ""}
      </section>
    `;
  }

  function renderChatDetailsMenuMobile(room) {
    const currentUser = getCurrentUser();
    const canManageRoom = currentUser?.id === room.creatorId;
    const draft = getDraft(room.id);
    return `
      <div class="chat-details-backdrop" data-action="close-chat-details"></div>
      <aside class="chat-details-panel mobile-chat-menu">
        ${room.password ? `<div class="chat-menu-password">${escapeHtml(t("roomPasswordLabel"))}: <strong>${escapeHtml(room.password)}</strong></div>` : ""}
        ${canManageRoom
          ? `
            <button class="chat-menu-item" type="button" data-action="open-modal" data-modal="room-settings">
              <span aria-hidden="true">&#9881;</span>
              <span>${escapeHtml(t("roomSettingsButton"))}</span>
            </button>
          `
          : ""}
        <div class="chat-menu-section">
          <div class="chat-menu-label">${escapeHtml(t("translationConceptLabel"))}</div>
          <div class="translation-concept-list">
            ${renderTranslationConceptOptions(room.id, currentUser?.preferredTranslationConcept || draft.translationConcept)}
          </div>
        </div>
        <button class="chat-menu-item" data-action="open-modal" data-modal="invite">
          <span aria-hidden="true">👥+</span>
          <span>${escapeHtml(t("inviteButton"))}</span>
        </button>
        <button class="chat-menu-item danger" data-action="leave-room" data-room-id="${room.id}">
          <span aria-hidden="true">🚪</span>
          <span>${escapeHtml(t("leaveButton"))}</span>
        </button>
      </aside>
    `;
  }

  function renderComposerMobile(room) {
    const draft = getDraft(room.id);
    return `
      ${draft.attachment ? renderAttachmentPreview(draft.attachment) : ""}
      <div class="composer-wrap composer-inline mobile-composer-wrap">
        <div class="composer-line">
          <input
            class="composer-input"
            type="text"
            data-input="composer"
              data-room-id="${room.id}"
              value="${escapeHtml(draft.text)}"
              placeholder="${escapeHtml(t("composerPlaceholder"))}"
              autocomplete="off"
              autocorrect="off"
              autocapitalize="off"
              spellcheck="false"
              enterkeyhint="send"
              inputmode="text"
              data-lpignore="true"
            />
          <button class="icon-button plus-trigger" data-action="toggle-attachment-menu" aria-label="${escapeHtml(t("addFile"))}" title="${escapeHtml(t("addFile"))}">+</button>
          <button class="button button-primary send-button" data-action="send-message" data-room-id="${room.id}" ${draft.processing ? "disabled" : ""}>${escapeHtml(t("sendButton"))}</button>
          <div class="attachment-menu ${uiState.attachmentMenuOpen ? "open" : ""}">
            <button class="attach-option" data-action="trigger-image" data-room-id="${room.id}" aria-label="${escapeHtml(t("addPhoto"))}" title="${escapeHtml(t("addPhoto"))}">
              ${renderIconSvg("photo")}
            </button>
            <button class="attach-option" data-action="trigger-video" data-room-id="${room.id}" aria-label="${escapeHtml(t("addVideo"))}" title="${escapeHtml(t("addVideo"))}">
              ${renderIconSvg("video")}
            </button>
            <button class="attach-option" data-action="trigger-file" data-room-id="${room.id}" aria-label="${escapeHtml(t("addFile"))}" title="${escapeHtml(t("addFile"))}">
              ${renderIconSvg("file")}
            </button>
          </div>
        </div>
      </div>
      <input class="hidden-input" type="file" accept="image/jpeg,image/png,image/webp" data-input="image-file" data-room-id="${room.id}" />
      <input class="hidden-input" type="file" accept="video/*" data-input="video-file" data-room-id="${room.id}" />
      <input class="hidden-input" type="file" data-input="generic-file" data-room-id="${room.id}" />
    `;
  }

  function renderTranslationConceptOptions(roomId, activeConcept) {
    return TRANSLATION_CONCEPTS.map((concept) => {
      const selected = normalizeTranslationConcept(activeConcept) === concept.id;
      return `
        <button
          class="translation-concept-chip ${selected ? "active" : ""}"
          type="button"
          data-action="set-translation-concept"
          data-room-id="${roomId}"
          data-concept="${concept.id}"
        >
          ${escapeHtml(t(concept.labelKey))}
        </button>
      `;
    }).join("");
  }

  // Added: keep the room layout but stabilize the chat header and single-line composer for mobile input/touch handling.
  function renderChatRoomMobileEnhanced(currentUser, room) {
    const participants = deriveRoomParticipantIds(room)
      .map((participantId) => appState.users.find((user) => user.id === participantId))
      .filter(Boolean);

    return `
      <section class="chat-panel mobile-chat-room">
        <header class="chat-header mobile-chat-header">
          <button class="icon-button back-button" type="button" data-action="back-to-chat-list" aria-label="${escapeHtml(t("backToRooms"))}">&larr;</button>
          <h2>${escapeHtml(normalizeDisplayText(room.title))}</h2>
          <button
            class="menu-icon-button"
            type="button"
            data-action="toggle-chat-details"
            aria-label="${escapeHtml(t("participantsButton"))}"
            title="${escapeHtml(t("participantsButton"))}"
          >
            &#9776;
          </button>
        </header>
        <div class="participant-strip">
          ${participants.map((participant) => `<span class="participant-chip">${escapeHtml(participant.name)}</span>`).join("")}
        </div>
        <section class="chat-scroll" id="chat-scroll">
          ${renderMessageList(room, currentUser)}
        </section>
        ${renderTypingIndicators(room, currentUser)}
        <footer class="composer mobile-composer">${renderComposerMobileEnhanced(room)}</footer>
        ${uiState.chatDetailsOpen ? renderChatDetailsMenuMobile(room) : ""}
      </section>
    `;
  }

  function renderComposerMobileEnhanced(room) {
    const draft = getDraft(room.id);
    return `
      ${draft.attachment ? renderAttachmentPreview(draft.attachment) : ""}
      <div class="composer-wrap composer-inline mobile-composer-wrap">
        <div class="composer-line mobile-composer-line">
          <div class="composer-input-shell">
            <textarea
              class="composer-input"
              data-input="composer"
              data-room-id="${room.id}"
              placeholder="${escapeHtml(t("composerPlaceholder"))}"
              name="chat-message-${room.id}"
              rows="1"
              autocomplete="off"
              autocorrect="off"
              autocapitalize="off"
              spellcheck="false"
              enterkeyhint="send"
              aria-autocomplete="none"
              inputmode="text"
              data-lpignore="true"
            >${escapeHtml(draft.text)}</textarea>
            <button
              class="icon-button plus-trigger composer-inline-action"
              type="button"
              data-action="toggle-attachment-menu"
              data-room-id="${room.id}"
              aria-label="${escapeHtml(t("addFile"))}"
              title="${escapeHtml(t("addFile"))}"
            >
              +
            </button>
            <div class="attachment-menu ${uiState.attachmentMenuOpen ? "open" : ""}">
              <div class="attachment-menu-grid">
                <button class="attach-option" type="button" data-action="trigger-image" data-room-id="${room.id}" aria-label="${escapeHtml(t("addPhoto"))}" title="${escapeHtml(t("addPhoto"))}">
                  ${renderIconSvg("photo")}
                </button>
                <button class="attach-option" type="button" data-action="trigger-video" data-room-id="${room.id}" aria-label="${escapeHtml(t("addVideo"))}" title="${escapeHtml(t("addVideo"))}">
                  ${renderIconSvg("video")}
                </button>
                <button class="attach-option" type="button" data-action="trigger-file" data-room-id="${room.id}" aria-label="${escapeHtml(t("addFile"))}" title="${escapeHtml(t("addFile"))}">
                  ${renderIconSvg("file")}
                </button>
              </div>
            </div>
          </div>
          <button class="button button-primary send-button" type="button" data-action="send-message" data-room-id="${room.id}" ${draft.processing ? "disabled" : ""}>${escapeHtml(t("sendButton"))}</button>
        </div>
      </div>
      <input class="hidden-input" type="file" accept="image/jpeg,image/png,image/webp" data-input="image-file" data-room-id="${room.id}" />
      <input class="hidden-input" type="file" accept="image/*" capture="environment" data-input="camera-image-file" data-room-id="${room.id}" />
      <input class="hidden-input" type="file" accept="video/*" data-input="video-file" data-room-id="${room.id}" />
      <input class="hidden-input" type="file" data-input="generic-file" data-room-id="${room.id}" />
    `;
  }

  function renderSearchModalMobile(currentUser) {
    const rooms = filterRoomsByQuery(getFilteredRooms());
    return `
      <div class="modal-layer">
        <section class="modal search-modal">
          <div class="modal-header">
            <h3>${escapeHtml(t("roomSearchPlaceholder"))}</h3>
          </div>
          <div class="modal-body">
            <div class="field compact-field">
              <input
                type="search"
                data-input="room-search"
                value="${escapeHtml(uiState.roomSearch)}"
                placeholder="${escapeHtml(t("roomSearchPlaceholder"))}"
                autocomplete="off"
              />
            </div>
            <div class="compact-room-list search-results-list">
              ${rooms.length
                ? rooms.map((room) => renderRoomCardMobile(room, currentUser)).join("")
                : `<div class="empty-card compact-empty"><h3>${escapeHtml(t("noRoomsTitle"))}</h3><p>${escapeHtml(t("noRoomsCopy"))}</p></div>`}
            </div>
          </div>
          <div class="modal-footer">
            <button class="button button-secondary" data-action="close-modal">${escapeHtml(t("settingsClose"))}</button>
          </div>
        </section>
      </div>
    `;
  }

  function renderShell(currentUser) {
    const activeRoom = appState.rooms.find((room) => room.id === uiState.activeRoomId) || null;
    return `
      <main class="shell app-shell">
        <header class="topbar">
          <div class="topbar-left">
            <button class="brand-chip brand-chip-button" type="button" data-action="go-connections">
              <div class="brand-mark">T</div>
              <div class="brand-meta">
                <strong>TRANSCHAT</strong>
                <span>${escapeHtml(t("topbarStatus"))}</span>
              </div>
            </button>
          </div>
          <div class="topbar-right">
            ${renderTopbarStatusBadges()}
            <div class="profile-chip">
              ${renderProfileImage(currentUser, "avatar avatar-image", currentUser.name)}
              <div class="profile-text">
                <strong>${escapeHtml(currentUser.name)}</strong>
                <span>${escapeHtml(getChatLanguageName(currentUser.nativeLanguage))} · ${escapeHtml(getUiLanguageName(currentUser.uiLanguage))}</span>
              </div>
            </div>
          </div>
        </header>
        <section class="workspace workspace-single">
          ${renderMainPanel(currentUser, activeRoom)}
        </section>
        ${renderBottomDirectory(currentUser)}
      </main>
      ${renderModal()}
      ${renderToastStack()}
    `;
  }

  function renderTopbarStatusBadges() {
    const status = runtime.backend;
    const syncReady = Boolean(runtime.serverEventsConnected || runtime.syncChannel);
    const displayTranslationLabel = status.liveTranslationEnabled
      ? `${t("translationLiveMode")}${status.model ? ` · ${status.model}` : ""}`
      : status.serverReachable && status.translationConfigured === false
        ? t("translationDisabledMode")
        : status.serverReachable && status.lastTranslationError
          ? t("translationIssueMode")
          : t("translationFallbackMode");
    const translationTitle = status.lastTranslationErrorDetail || displayTranslationLabel;

    return `
      <div class="status-cluster">
        <span class="status-pill ${status.serverReachable ? "pill-success" : "pill-warning"}">${escapeHtml(
          status.serverReachable ? t("serverOnline") : t("serverOffline")
        )}</span>
        <span class="status-pill ${status.liveTranslationEnabled ? "pill-accent" : "pill-warning"}" title="${escapeHtml(translationTitle)}">${escapeHtml(displayTranslationLabel)}</span>
        <span class="status-pill ${syncReady ? "pill-success" : "pill-warning"}">${escapeHtml(
          syncReady ? t("syncRealtime") : t("syncBasic")
        )}</span>
      </div>
    `;
  }

  function renderSidebar(currentUser) {
    const rooms = getFilteredRooms();
    return `
      <aside class="panel sidebar ${uiState.mobileRoomsOpen ? "mobile-open" : ""}">
        <div class="sidebar-header">
          <div>
            <h2>${escapeHtml(t("roomListTitle"))}</h2>
            <p class="sidebar-copy">${escapeHtml(t("roomListCopy"))}</p>
          </div>
          <button class="button button-primary" data-action="open-modal" data-modal="create-room">${escapeHtml(t("createRoomButton"))}</button>
        </div>
        <div class="sidebar-tools">
          <div class="search-box field">
            <input type="search" value="${escapeHtml(uiState.roomSearch)}" data-input="room-search" placeholder="${escapeHtml(t("roomSearchPlaceholder"))}" />
          </div>
        </div>
        <div class="room-list">
          ${
            rooms.length
              ? rooms.map((room) => renderRoomCard(room, currentUser)).join("")
              : `<div class="empty-card"><h3>${escapeHtml(t("noRoomsTitle"))}</h3><p>${escapeHtml(t("noRoomsCopy"))}</p></div>`
          }
        </div>
      </aside>
    `;
  }

  function renderRoomCard(room, currentUser) {
    const creator = appState.users.find((user) => user.id === room.creatorId);
    return `
      <button class="room-card room-card-compact ${uiState.activeRoomId === room.id ? "active" : ""} ${room.status === "expired" ? "expired" : ""}" data-action="open-room" data-room-id="${room.id}">
        <div class="room-topline">
          <strong>${escapeHtml(normalizeDisplayText(room.title))}</strong>
          <div class="room-icons">
            ${room.isProtected ? `<span aria-label="${escapeHtml(t("roomProtected"))}">🔒</span>` : ""}
            ${room.status === "expired" ? `<span class="tiny-pill pill-danger">${escapeHtml(t("roomExpired"))}</span>` : ""}
          </div>
        </div>
        <span class="room-owner">👑 ${escapeHtml(creator?.name || "—")}</span>
      </button>
    `;
  }

  function renderMainPanel(currentUser, activeRoom) {
    return `<section class="main-panel main-panel-single">${renderWorkspaceView(currentUser, activeRoom)}</section>`;
  }

  function renderWorkspaceView(currentUser, activeRoom) {
    if (uiState.directoryTab === "all-rooms") {
      return renderAllRoomsScreen(currentUser);
    }
    if (uiState.directoryTab === "friends") {
      return renderFriendsScreen(currentUser);
    }
    if (uiState.directoryTab === "me") {
      return renderMyInfoScreen(currentUser);
    }
    return renderChatPanel(currentUser, activeRoom);
  }

  function renderBottomDirectory() {
    return `
      <section class="directory-dock nav-only">
        <div class="directory-shell nav-shell">
          <nav class="directory-tabs tabs-only">
            ${renderDirectoryTabButton("all-rooms", "tabAllRooms")}
            ${renderDirectoryTabButton("chat", "tabActiveRooms")}
            ${renderDirectoryTabButton("friends", "tabFriends")}
            ${renderDirectoryTabButton("me", "tabMyInfo")}
          </nav>
        </div>
      </section>
    `;
  }

  function renderAllRoomsScreen(currentUser) {
    const activeRooms = appState.rooms
      .filter((room) => room.status === "active" && deriveRoomParticipantIds(room).includes(currentUser.id))
      .sort((a, b) => (b.lastMessageAt || b.createdAt) - (a.lastMessageAt || a.createdAt));
    const rooms = getFilteredRooms();

    return `
      <section class="panel screen-panel screen-panel-rooms">
        <div class="screen-header">
          <div>
            <h2>${escapeHtml(t("roomListTitle"))}</h2>
            <p class="panel-copy">${escapeHtml(t("roomListCopy"))}</p>
          </div>
        </div>
        <div class="screen-body">
          <div class="sticky-active-block">
            <div class="directory-copy">${escapeHtml(t("activeRoomsTitle"))}</div>
            ${
              activeRooms.length
                ? `<div class="active-room-row">${activeRooms
                    .map(
                      (room) => `<button class="active-room-chip ${uiState.activeRoomId === room.id ? "active" : ""}" data-action="open-room" data-room-id="${room.id}">${escapeHtml(normalizeDisplayText(room.title))}</button>`
                    )
                    .join("")}</div>`
                : `<div class="helper">${escapeHtml(t("activeRoomsEmptyCopy"))}</div>`
            }
            <div class="tab-search-row">
              <div class="search-box field">
                <input type="search" value="${escapeHtml(uiState.roomSearch)}" data-input="room-search" placeholder="${escapeHtml(t("roomSearchPlaceholder"))}" />
              </div>
            </div>
          </div>
          <div class="compact-room-list">
            ${rooms.length
              ? rooms.map((room) => renderRoomCard(room, currentUser)).join("")
              : `<div class="empty-card"><h3>${escapeHtml(t("noRoomsTitle"))}</h3><p>${escapeHtml(t("noRoomsCopy"))}</p></div>`}
          </div>
        </div>
        <button
          class="fab-create-room"
          data-action="open-modal"
          data-modal="create-room"
          aria-label="${escapeHtml(t("createRoomButton"))}"
          title="${escapeHtml(t("createRoomButton"))}"
        >
          +
        </button>
      </section>
    `;
  }

  function renderFriendsScreen(currentUser) {
    return `
      <section class="panel screen-panel">
        <div class="screen-header">
          <div>
            <h2>${escapeHtml(t("friendsTitle"))}</h2>
            <p class="panel-copy">${escapeHtml(t("friendsCopy"))}</p>
          </div>
        </div>
        <div class="screen-body">
          ${renderFriendsDirectory(currentUser)}
        </div>
      </section>
    `;
  }

  function renderMyInfoScreen(currentUser) {
    return `
      <section class="panel screen-panel">
        <div class="screen-header">
          <div>
            <h2>${escapeHtml(t("myInfoTitle"))}</h2>
            <p class="panel-copy">${escapeHtml(t("settingsCopy"))}</p>
          </div>
        </div>
        <div class="screen-body">
          ${renderMyInfoDirectory(currentUser)}
        </div>
      </section>
    `;
  }

  function renderDirectoryTabButton(tabId, labelKey) {
    const active = uiState.directoryTab === tabId;
    return `
      <button
        class="directory-tab ${active ? "active" : ""}"
        data-action="switch-directory-tab"
        data-tab-id="${tabId}"
      >
        ${escapeHtml(t(labelKey))}
      </button>
    `;
  }

  function renderDirectoryContent(currentUser) {
    if (uiState.directoryTab === "all-rooms") {
      return renderRoomDirectory(getFilteredRooms(), currentUser, {
        emptyTitle: t("noRoomsTitle"),
        emptyCopy: t("noRoomsCopy"),
        searchable: true,
      });
    }
    if (uiState.directoryTab === "chat") {
      const rooms = appState.rooms
        .filter((room) => room.status === "active" && deriveRoomParticipantIds(room).includes(currentUser.id))
        .sort((a, b) => (b.lastMessageAt || b.createdAt) - (a.lastMessageAt || a.createdAt));
      return renderRoomDirectory(rooms, currentUser, {
        emptyTitle: t("activeRoomsEmptyTitle"),
        emptyCopy: t("activeRoomsEmptyCopy"),
        searchable: true,
      });
    }
    if (uiState.directoryTab === "friends") {
      return renderFriendsDirectory(currentUser);
    }
    return renderMyInfoDirectory(currentUser);
  }

  function renderRoomDirectory(rooms, currentUser, options) {
    return `
      ${options.searchable ? `
        <div class="tab-search-row">
          <div class="search-box field">
            <input type="search" value="${escapeHtml(uiState.roomSearch)}" data-input="room-search" placeholder="${escapeHtml(t("roomSearchPlaceholder"))}" />
          </div>
        </div>
      ` : ""}
      <div class="compact-room-list">
        ${filterRoomsByQuery(rooms).length
          ? filterRoomsByQuery(rooms).map((room) => renderRoomCard(room, currentUser)).join("")
          : `<div class="empty-card"><h3>${escapeHtml(options.emptyTitle)}</h3><p>${escapeHtml(options.emptyCopy)}</p></div>`}
      </div>
    `;
  }

  function renderFriendsDirectory(currentUser) {
    const friends = appState.users
      .filter((user) => user.id !== currentUser.id)
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt || a.name.localeCompare(b.name));

    return `
      <div class="directory-copy">${escapeHtml(t("friendsCopy"))}</div>
      <div class="friend-list">
        ${friends.length
          ? friends.map((friend) => renderFriendCard(friend)).join("")
          : `<div class="empty-card"><h3>${escapeHtml(t("friendsEmptyTitle"))}</h3><p>${escapeHtml(t("friendsEmptyCopy"))}</p></div>`}
      </div>
    `;
  }

  function renderFriendCard(friend) {
    const activeRoom = appState.rooms.find((room) => room.id === uiState.activeRoomId && room.status === "active");
    const alreadyInRoom = activeRoom ? deriveRoomParticipantIds(activeRoom).includes(friend.id) : false;
    const pendingInvite = activeRoom
      ? appState.invites.some((invite) => invite.roomId === activeRoom.id && invite.inviteeId === friend.id && invite.status === "pending")
      : false;
    const presence = getPresence(friend, activeRoom?.id || friend.currentRoomId || null);
    return `
      <article class="friend-card">
        ${renderProfileImage(friend, "list-profile-image", friend.name)}
        <div class="friend-card-meta">
          <strong>${escapeHtml(friend.name)}</strong>
          <span>${escapeHtml(getChatLanguageName(friend.nativeLanguage))} · ${escapeHtml(getChatLanguageName(friend.preferredChatLanguage || friend.nativeLanguage))}</span>
        </div>
        <div class="button-row">
          <span class="status-pill ${presence.kind === "online" ? "pill-success" : ""}">
            ${renderPresenceLabel(presence)}
          </span>
          <button
            class="button button-secondary"
            data-action="quick-invite"
            data-friend-name="${escapeHtml(friend.name)}"
            ${!activeRoom || alreadyInRoom || pendingInvite ? "disabled" : ""}
          >
            ${escapeHtml(t("friendInviteButton"))}
          </button>
        </div>
      </article>
    `;
  }

  function renderMyInfoDirectory(currentUser) {
    const incoming = appState.invites
      .filter((invite) => invite.inviteeId === currentUser.id)
      .sort((a, b) => b.createdAt - a.createdAt);
    const recent = appState.invites
      .filter((invite) => invite.inviterId === currentUser.id && invite.status !== "pending")
      .sort((a, b) => (b.respondedAt || 0) - (a.respondedAt || 0))
      .slice(0, 4);
    return `
      <div class="my-info-grid">
        <div class="setting-card">
          <strong>${escapeHtml(t("myInfoTitle"))}</strong>
          <span>${escapeHtml(currentUser.name)}</span>
        </div>
        <div class="setting-card">
          <strong>${escapeHtml(t("settingsUiLanguage"))}</strong>
          <div class="field" style="margin-top: 12px;">
            <select data-input="settings-ui-language">
              ${renderLanguageOptions(currentUser.uiLanguage, UI_LANGUAGES)}
            </select>
          </div>
        </div>
        <div class="setting-card">
          <strong>${escapeHtml(t("settingsNativeLanguage"))}</strong>
          <div class="field" style="margin-top: 12px;">
            <select data-input="settings-native-language">
              ${renderLanguageOptions(currentUser.nativeLanguage, CHAT_LANGUAGES)}
            </select>
          </div>
        </div>
        ${renderPushSettingsCard(currentUser)}
        <div class="setting-card">
          <strong>${escapeHtml(t("settingsPreferredLanguage"))}</strong>
          <div class="field" style="margin-top: 12px;">
            <select data-input="settings-preferred-language">
              ${renderLanguageOptions(currentUser.preferredChatLanguage || currentUser.nativeLanguage, CHAT_LANGUAGES)}
            </select>
          </div>
        </div>
        <div class="setting-card">
          <strong>${escapeHtml(t("themeLabel"))}</strong>
          <div class="segmented" style="margin-top: 12px;">
            ${["system", "light", "dark"].map((theme) => `<button class="${appState.settings.theme === theme ? "active" : ""}" data-action="set-theme" data-theme="${theme}">${escapeHtml(t(`theme${capitalize(theme)}`))}</button>`).join("")}
          </div>
        </div>
        <div class="setting-card">
          <strong>${escapeHtml(t("sideInvitesTitle"))}</strong>
          ${incoming.length
            ? incoming.map((invite) => renderInviteCard(invite)).join("")
            : `<span>${escapeHtml(t("noInvitesCopy"))}</span>`}
        </div>
        <div class="setting-card">
          <strong>${escapeHtml(t("inviteResultTitle"))}</strong>
          ${recent.length
            ? recent.map((invite) => {
                const invitee = appState.users.find((user) => user.id === invite.inviteeId);
                return `<span>${escapeHtml(invitee?.name || "—")} · ${escapeHtml(getInviteDisplayTitle(invite))} · ${escapeHtml(invite.status === "accepted" ? t("inviteAccepted") : t("inviteRejected"))}</span>`;
              }).join("")
            : `<span>${escapeHtml(t("inviteResultEmpty"))}</span>`}
        </div>
        ${renderPwaInstallCard()}
        <div class="setting-card">
          <strong>${escapeHtml(t("logoutButton"))}</strong>
          <span>${escapeHtml(t("logoutCopy"))}</span>
          <div class="button-row" style="margin-top: 12px;">
            <button class="button button-danger" data-action="logout-current-user">${escapeHtml(t("logoutButton"))}</button>
          </div>
        </div>
      </div>
    `;
  }

  function renderChatPanel(currentUser, room) {
    if (!room) {
      return `
        <section class="chat-panel">
          <div class="empty-state">
            <div class="empty-card">
              <h3>${escapeHtml(t("chatWelcomeTitle"))}</h3>
              <p>${escapeHtml(t("chatWelcomeCopy"))}</p>
            </div>
          </div>
        </section>
      `;
    }

    const creator = appState.users.find((user) => user.id === room.creatorId);
    const isExpired = room.status === "expired";
    const participantCount = deriveRoomParticipantIds(room).length;
    return `
      <section class="chat-panel">
        <header class="chat-header">
          <div class="chat-headline">
            <div class="stack-row">
              <h2>${escapeHtml(normalizeDisplayText(room.title))}</h2>
              ${room.status === "expired"
                ? `<span class="pill pill-danger">${escapeHtml(t("roomExpired"))}</span>`
                : room.isProtected
                  ? `<span class="pill pill-warning">${escapeHtml(t("roomProtected"))}</span>`
                  : `<span class="pill pill-success">${escapeHtml(t("roomOpen"))}</span>`}
            </div>
            <p>${escapeHtml(t("chatHeaderCreator"))}: ${escapeHtml(creator?.name || "—")} · ${escapeHtml(t("roomParticipants"))}: ${participantCount}</p>
          </div>
          <div class="header-actions">
            ${room.status === "active" && CONFIG.roomAutoExpirationEnabled
              ? room.disableExpiration
                ? `<span class="pill pill-success">${escapeHtml(t("roomPersistent"))}</span>`
                : `<span class="pill pill-accent">${escapeHtml(t("expireCountdown"))}: ${escapeHtml(formatRemaining((room.lastMessageAt || room.createdAt) + CONFIG.roomExpireMs - Date.now()))}</span>`
              : ""}
            ${room.status === "active"
              ? `
                <button
                  class="menu-icon-button"
                  data-action="toggle-chat-details"
                  aria-label="${escapeHtml(t("participantsButton"))}"
                  title="${escapeHtml(t("participantsButton"))}"
                >
                  &#9776;
                </button>
              `
              : ""}
          </div>
        </header>
        <section class="chat-scroll" id="chat-scroll">
          ${isExpired ? renderExpiredRoom() : renderMessageList(room, currentUser)}
        </section>
        ${isExpired ? "" : renderTypingIndicators(room, currentUser)}
        ${isExpired ? "" : `<footer class="composer">${renderComposer(room, currentUser)}</footer>`}
        ${room.status === "active" && uiState.chatDetailsOpen ? renderChatDetailsPanel(room) : ""}
      </section>
    `;
  }

  function renderChatDetailsPanel(room) {
    const participants = deriveRoomParticipantIds(room)
      .map((participantId) => appState.users.find((user) => user.id === participantId))
      .filter(Boolean);
    const currentUser = getCurrentUser();
    const canManageRoom = currentUser?.id === room.creatorId;
    const draft = getDraft(room.id);

    return `
      <div class="chat-details-backdrop" data-action="close-chat-details"></div>
      <aside class="chat-details-panel">
        <div class="chat-details-header">
          <div>
            <strong>${escapeHtml(t("participantsModalTitle"))}</strong>
            <span>${escapeHtml(t("roomParticipants"))}: ${participants.length}</span>
          </div>
          <button
            class="menu-icon-button close"
            data-action="close-chat-details"
            aria-label="${escapeHtml(t("settingsClose"))}"
            title="${escapeHtml(t("settingsClose"))}"
          >
            ×
          </button>
        </div>
        <div class="chat-details-actions">
          ${canManageRoom ? `<button class="button button-secondary" data-action="open-modal" data-modal="room-settings">${escapeHtml(t("roomSettingsButton"))}</button>` : ""}
          <button class="button button-secondary" data-action="open-modal" data-modal="invite">${escapeHtml(t("inviteButton"))}</button>
          <button class="button button-danger" data-action="leave-room" data-room-id="${room.id}">${escapeHtml(t("leaveButton"))}</button>
        </div>
        <div class="chat-menu-section desktop-tone-section">
          <div class="chat-menu-label">${escapeHtml(t("translationConceptLabel"))}</div>
          <div class="translation-concept-list">
            ${renderTranslationConceptOptions(room.id, currentUser?.preferredTranslationConcept || draft.translationConcept)}
          </div>
        </div>
        <div class="chat-details-list">
          ${participants.length
            ? participants.map((participant) => renderParticipantCard(participant, room.id)).join("")
            : `<div class="helper">${escapeHtml(t("noParticipants"))}</div>`}
        </div>
      </aside>
    `;
  }

  function renderExpiredRoom() {
    return `
      <div class="expired-state">
        <div class="expired-card">
          <h3>${escapeHtml(t("chatExpiredTitle"))}</h3>
          <p>${escapeHtml(t("chatExpiredCopy"))}</p>
        </div>
      </div>
    `;
  }

  function renderMessageList(room, currentUser) {
    if (!room.messages.length) {
      return `
        <div class="empty-card">
          <h3>${escapeHtml(t("noMessagesTitle"))}</h3>
          <p>${escapeHtml(t("noMessagesCopy"))}</p>
        </div>
      `;
    }

    const parts = [];
    let lastDateLabel = "";
    room.messages
      .slice()
      .sort((a, b) => a.createdAt - b.createdAt)
      .forEach((message) => {
        const dateLabel = new Intl.DateTimeFormat(getLocale(), {
          month: "short",
          day: "numeric",
        }).format(message.createdAt);

        if (dateLabel !== lastDateLabel) {
          lastDateLabel = dateLabel;
          parts.push(`<div class="day-divider">${escapeHtml(dateLabel)}</div>`);
        }

        if (message.kind === "system") {
          parts.push(`<div class="message-row system" data-diff-key="system:${message.id}"><div class="system-bubble">${escapeHtml(t(message.systemKey, message.systemParams))}</div></div>`);
          return;
        }

        const sender = appState.users.find((user) => user.id === message.senderId);
        const isMine = sender?.id === currentUser.id;
        queueMissingViewerTranslation(room, message, currentUser);
        const translated = getDisplayTranslation(message, currentUser);
        const showOriginal = Boolean(uiState.originalVisibility[message.id]);
        const viewerLanguage = getViewerDisplayLanguage(currentUser, message);
        const messageStatus = isMine ? getOutgoingMessageStatus(room, message, currentUser) : "";
        const candidateDisplayText =
          translated.pending
            ? t("translationPendingInline")
            : translated.text || (translated.failed ? message.originalText : "");
        const renderableText = translated.pending
          ? { text: candidateDisplayText, corrupted: false, usedFallback: false }
          : resolveRenderableMessageText(candidateDisplayText, viewerLanguage, message.originalText, message.sourceLanguage);
        const originalCorrupted = isEncodingCorruptedText(message.originalText, message.sourceLanguage);
        const encodingCorrupted = Boolean(renderableText.corrupted);
        const effectiveDisplayText =
          renderableText.text || (encodingCorrupted ? t("encodingCorruptedInline") : message.originalText);
        const shouldShowToggle =
          message.originalText &&
          !originalCorrupted &&
          message.originalText !== effectiveDisplayText &&
          !translated.failed &&
          !translated.pending;
        const links = translated.pending || encodingCorrupted ? [] : detectLinks(effectiveDisplayText || message.originalText);
        const visibleText = stripLinks(effectiveDisplayText || message.originalText);
        const visibleOriginal = originalCorrupted ? "" : stripLinks(message.originalText);
        parts.push(`
          <div class="message-row ${isMine ? "mine" : ""}" data-diff-key="message:${message.id}">
            ${!isMine ? `<div class="message-avatar">${renderProfileImage(sender, "avatar avatar-image", sender?.name || "profile")}</div>` : ""}
            <div class="message-stack">
              ${!isMine ? `<div class="message-sender">${escapeHtml(sender?.name || "")}</div>` : ""}
              <div class="message-main">
              <div class="bubble">
                ${visibleText ? `<p>${escapeHtml(visibleText).replace(/\n/g, "<br />")}</p>` : ""}
                ${links.length ? renderLinks(links) : ""}
                ${message.media ? renderMedia(message.media, message.id) : ""}
                ${showOriginal && visibleOriginal ? `<div class="original-copy">${escapeHtml(visibleOriginal)}</div>` : ""}
              </div>
              <div class="message-footer">
                <span>${escapeHtml(formatMessageMetaDate(message.createdAt))}</span>
                ${messageStatus ? `<span>${escapeHtml(t(`status${capitalize(messageStatus)}`))}</span>` : ""}
                ${translated.pending ? `<span class="tiny-pill pill-warning compact-meta-pill" title="${escapeHtml(t("translationPendingBadge"))}" aria-label="${escapeHtml(t("translationPendingBadge"))}">🔄</span>` : ""}
                ${encodingCorrupted ? `<span class="tiny-pill pill-danger compact-meta-pill" title="${escapeHtml(t("encodingCorruptedBadge"))}" aria-label="${escapeHtml(t("encodingCorruptedBadge"))}">⚠️</span>` : ""}
                ${translated.failed && !encodingCorrupted ? `<span class="tiny-pill pill-danger compact-meta-pill" title="${escapeHtml(t("translationFailedBadge"))}" aria-label="${escapeHtml(t("translationFailedBadge"))}">⚠️</span>` : ""}
                ${translated.mocked ? `<span class="tiny-pill pill-warning compact-meta-pill" title="${escapeHtml(t("translationMockBadge"))}" aria-label="${escapeHtml(t("translationMockBadge"))}">🧪</span>` : ""}
                ${translated.disabled ? `<span class="tiny-pill pill-warning compact-meta-pill" title="${escapeHtml(t("translationDisabledBadge"))}" aria-label="${escapeHtml(t("translationDisabledBadge"))}">⏸️</span>` : ""}
                ${message.originalText && translated.translated && !translated.failed && !translated.mocked ? `<span class="tiny-pill pill-accent compact-meta-pill" title="${escapeHtml(t("translatedBadge"))}" aria-label="${escapeHtml(t("translatedBadge"))}">✅</span>` : ""}
                ${shouldShowToggle ? `<button class="text-button" data-action="toggle-original" data-message-id="${message.id}">${escapeHtml(showOriginal ? t("hideOriginal") : t("showOriginal"))}</button>` : ""}
              </div>
              </div>
            </div>
          </div>
        `);
      });
    return parts.join("");
  }

  function renderTypingIndicators(room, currentUser) {
    const typingUsers = getActiveTypingUsers(room.id, currentUser.id);
    const activeTypingUser = typingUsers[0] || null;
    return `
      <div class="typing-slot ${activeTypingUser ? "active" : ""}">
        <div class="typing-bubble compact">${activeTypingUser ? escapeHtml(t("typingIndicator", { name: activeTypingUser.name || "" })) : "&nbsp;"}</div>
      </div>
    `;
  }

  function renderLinks(links) {
    return `
      <div class="message-links">
        ${links
          .map(
            (link) => `<a class="link-pill" href="${escapeHtml(link)}" target="_blank" rel="noreferrer noopener">🔗 ${escapeHtml(shortenLink(link))}</a>`
          )
          .join("")}
      </div>
    `;
  }

  function hasUsableTranslationEntry(entry) {
    return typeof entry?.text === "string" && entry.text.trim().length > 0;
  }

  function findStoredTranslationForLanguage(message, language, preferredConcept = DEFAULT_TRANSLATION_CONCEPT) {
    const baseLanguage = getTranslationVariantLanguage(language);
    if (!baseLanguage) {
      return { key: "", entry: null };
    }

    const translations = message?.translations || {};
    const preferredKey = buildTranslationVariantKey(baseLanguage, preferredConcept);
    const preferredEntry = translations[preferredKey];
    if (hasUsableTranslationEntry(preferredEntry) && !preferredEntry.failed && !isEncodingCorruptedText(preferredEntry.text, baseLanguage)) {
      return { key: preferredKey, entry: preferredEntry };
    }

    const legacyEntry = translations[baseLanguage];
    if (hasUsableTranslationEntry(legacyEntry) && !legacyEntry.failed && !isEncodingCorruptedText(legacyEntry.text, baseLanguage)) {
      return { key: baseLanguage, entry: legacyEntry };
    }

    const fallbackVariant = Object.entries(translations).find(([key, entry]) => {
      const variantLanguage = getTranslationVariantLanguage(key);
      return variantLanguage === baseLanguage && hasUsableTranslationEntry(entry) && !entry.failed && !isEncodingCorruptedText(entry.text, baseLanguage);
    });
    if (fallbackVariant) {
      return { key: fallbackVariant[0], entry: fallbackVariant[1] };
    }

    return { key: "", entry: null };
  }

  function isTranslationPendingStale(message) {
    if (!message || message.kind !== "user") return false;
    const state = message.translationMeta?.state || (message.translationMeta?.pending ? "pending" : "idle");
    if (state !== "pending") return false;
    const startedAt = Number(message.translationMeta?.startedAt || message.createdAt || 0) || 0;
    if (!startedAt) return true;
    return Date.now() - startedAt > CONFIG.translationPendingTimeoutMs;
  }

  function getUserDisplayLanguage(user, fallbackLanguage = "ko") {
    return normalizeMessageLanguageCode(user?.nativeLanguage || user?.preferredChatLanguage, fallbackLanguage);
  }

  function shouldPreferOriginalForOwnMessage(user, message) {
    return Boolean(user && message && message.senderId === user.id);
  }

  function getViewerDisplayLanguage(currentUser, message) {
    const sourceLanguage = normalizeMessageLanguageCode(message?.originalLanguage || message?.sourceLanguage, currentUser?.nativeLanguage || "ko");
    return getUserDisplayLanguage(currentUser, sourceLanguage) || sourceLanguage;
  }

  function getDisplayTranslation(message, currentUser) {
    if (!message.originalText) {
      return {
        text: message.originalText,
        failed: false,
        pending: false,
        mocked: false,
        disabled: false,
        translated: false,
      };
    }

    if (shouldPreferOriginalForOwnMessage(currentUser, message)) {
      return {
        text: message.originalText,
        failed: false,
        pending: false,
        mocked: false,
        disabled: false,
        translated: false,
      };
    }

    const viewerLanguage = getViewerDisplayLanguage(currentUser, message);
    const preferredLanguage = getPreferredTranslationLanguage(currentUser, message);
    const preferredConcept = getUserTranslationConcept(currentUser);
    const requestedTargets =
      Array.isArray(message.translationMeta?.requestedTargets) && message.translationMeta.requestedTargets.length
        ? message.translationMeta.requestedTargets
        : Object.keys(message.translations || {}).filter((key) => shouldRequestTranslationForLanguage(getTranslationVariantLanguage(key), message.sourceLanguage, message.languageProfile));
    const storedTranslation = preferredLanguage ? findStoredTranslationForLanguage(message, preferredLanguage, preferredConcept) : { key: "", entry: null };
    const translation = storedTranslation.entry;
    const requestedForCurrentUser = Boolean(preferredLanguage);
    const state = message.translationMeta?.state || (message.translationMeta?.pending ? "pending" : "idle");
    const disabled = message.translationMeta?.reason === "service_disabled";
    const mocked = message.translationMeta?.provider === "mock";

    if (!viewerLanguage || !preferredLanguage) {
      return {
        text: message.originalText,
        failed: false,
        pending: false,
        mocked: false,
        disabled: false,
        translated: false,
      };
    }

    if (!translation) {
      if (requestedForCurrentUser) {
        if (disabled || state === "failed" || state === "partial") {
          return { text: t("translationUnavailableInline"), failed: true, pending: false, mocked: false, disabled, translated: false };
        }
        if ((state === "pending" && !isTranslationPendingStale(message)) || state === "idle" || mocked) {
          return { text: t("translationPendingInline"), failed: false, pending: true, mocked: Boolean(mocked), disabled: false, translated: false };
        }
      }
      return { text: message.originalText, failed: false, pending: false, mocked: false, disabled: false, translated: false };
    }

    return {
      text: translation.text || message.originalText,
      failed: Boolean(translation.failed),
      pending: state === "pending" && !translation.text,
      mocked: mocked && !translation.failed && requestedForCurrentUser,
      disabled: disabled && !(translation.text && translation.text !== message.originalText),
      translated: Boolean(translation.text) && translation.text !== message.originalText,
    };
  }

  function getPreferredTranslationLanguage(currentUser, message) {
    if (shouldPreferOriginalForOwnMessage(currentUser, message)) {
      return null;
    }
    const viewerLanguage = getViewerDisplayLanguage(currentUser, message);
    return shouldRequestTranslationForLanguage(viewerLanguage, message?.sourceLanguage, message?.languageProfile) ? viewerLanguage : null;
  }

  function shouldPauseFailedTranslationRetry(message, targetKey) {
    if (!message || !targetKey) return false;
    const requestedTargets = new Set(Array.isArray(message.translationMeta?.requestedTargets) ? message.translationMeta.requestedTargets : []);
    if (!requestedTargets.has(targetKey)) return false;

    const translationState = message.translationMeta?.state || (message.translationMeta?.pending ? "pending" : "idle");
    if (!(translationState === "failed" || translationState === "partial")) return false;

    const failureReason = String(message.translationMeta?.reason || "").trim();
    const completedAt = Number(message.translationMeta?.completedAt || 0) || 0;
    const recentFailure = completedAt > 0 && Date.now() - completedAt < CONFIG.translationRetryCooldownMs;
    if (!runtime.backend.liveTranslationEnabled) return true;

    return recentFailure && ["service_disabled", "live_request_failed", "live_request_rejected", "client_exception", "server_unreachable"].includes(failureReason);
  }

  function queueMissingViewerTranslation(room, message, currentUser) {
    if (!room || !message || message.kind !== "user" || !message.originalText) return;
    if (shouldPreferOriginalForOwnMessage(currentUser, message)) return;
    const targetLanguage = getPreferredTranslationLanguage(currentUser, message);
    if (!shouldRequestTranslationForLanguage(targetLanguage, message.sourceLanguage, message.languageProfile)) return;
    if (isEncodingCorruptedText(message.originalText, message.sourceLanguage)) {
      const liveRoom = appState.rooms.find((entry) => entry.id === room.id);
      const liveMessage = liveRoom?.messages?.find((entry) => entry.id === message.id);
      if (liveMessage) {
        liveMessage.translationMeta = {
          ...(liveMessage.translationMeta || {}),
          pending: false,
          state: "failed",
          reason: "encoding_corrupted",
          errorDetail: "Stored source text is already damaged.",
          completedAt: Date.now(),
        };
        persistState();
      }
      return;
    }
    const viewerConcept = getUserTranslationConcept(currentUser);
    const targetKey = buildTranslationVariantKey(targetLanguage, viewerConcept);
    if (!targetKey) return;
    const existingTranslation = findStoredTranslationForLanguage(message, targetLanguage, viewerConcept);
    if (hasUsableTranslationEntry(existingTranslation.entry) && !existingTranslation.entry.failed) return;

    const requestedTargets = new Set(Array.isArray(message.translationMeta?.requestedTargets) ? message.translationMeta.requestedTargets : []);
    const translationState = message.translationMeta?.state || (message.translationMeta?.pending ? "pending" : "idle");
    const stalePending = isTranslationPendingStale(message);
    if (translationState === "pending" && requestedTargets.has(targetKey) && !stalePending) return;
    if (shouldPauseFailedTranslationRetry(message, targetKey)) return;

    const taskKey = `${room.id}:${message.id}:${targetKey}`;
    if (runtime.translationTasks.has(taskKey)) return;
    runtime.translationTasks.set(taskKey, Date.now());

    console.info("[translation] hydrate-missing-target", {
      roomId: room.id,
      messageId: message.id,
      targetLanguage,
      stalePending,
      serverReachable: runtime.backend.serverReachable,
      liveTranslationEnabled: runtime.backend.liveTranslationEnabled,
    });

    Promise.resolve()
      .then(async () => {
        const liveRoom = appState.rooms.find((entry) => entry.id === room.id);
        const liveMessage = liveRoom?.messages?.find((entry) => entry.id === message.id);
        if (!liveRoom || !liveMessage) return;
        const liveRequestedTargets = new Set(Array.isArray(liveMessage.translationMeta?.requestedTargets) ? liveMessage.translationMeta.requestedTargets : []);
        if (!liveRequestedTargets.has(targetKey) || isTranslationPendingStale(liveMessage)) {
          liveMessage.translationMeta = {
            ...(liveMessage.translationMeta || {}),
            provider: liveMessage.translationMeta?.provider || "pending",
            model: liveMessage.translationMeta?.model || runtime.backend.model || null,
            live: Boolean(runtime.backend.liveTranslationEnabled),
            pending: true,
            state: "pending",
            reason: null,
            errorDetail: null,
            requestedTargets: [...liveRequestedTargets, targetKey],
            startedAt: Date.now(),
            completedAt: null,
          };
          persistState();
          renderSafelyDuringInput();
        }

        const translationBundle = await buildTranslations(
          liveRoom,
          liveMessage.originalText,
          liveMessage.senderId,
          liveMessage.sourceLanguage,
          [targetLanguage],
          {
            languageProfile: liveMessage.languageProfile,
            translationConcept: viewerConcept,
            naturalTranslationEnabled: isNaturalTranslationEnabledForUser(currentUser),
            contextSummary: getRoomNaturalTranslationSummary(liveRoom, liveMessage.senderId),
          }
        );
        const nextEntry =
          translationBundle.translations?.[targetKey] ||
          { text: liveMessage.originalText, failed: translationBundle.meta?.state === "failed" };

        liveMessage.translations = {
          ...(liveMessage.translations || {}),
          [targetKey]: nextEntry,
        };
        const mergedTargets = [...new Set([...(liveMessage.translationMeta?.requestedTargets || []), targetKey])];
        const hasAnyFailure = mergedTargets.some((language) => Boolean(liveMessage.translations?.[language]?.failed));
        liveMessage.translationMeta = {
          ...(liveMessage.translationMeta || {}),
          ...translationBundle.meta,
          pending: false,
          state: hasAnyFailure ? "partial" : translationBundle.meta?.state || "success",
          requestedTargets: mergedTargets,
          startedAt: null,
          completedAt: Date.now(),
        };
        persistState();
        renderSafelyDuringInput();
      })
      .catch((error) => {
        const liveRoom = appState.rooms.find((entry) => entry.id === room.id);
        const liveMessage = liveRoom?.messages?.find((entry) => entry.id === message.id);
        if (liveMessage) {
          liveMessage.translations = {
            ...(liveMessage.translations || {}),
            [targetKey]: { text: liveMessage.originalText, failed: true },
          };
          liveMessage.translationMeta = {
            ...(liveMessage.translationMeta || {}),
            pending: false,
            state: "failed",
            reason: "client_exception",
            errorDetail: String(error?.message || error || "translation_error"),
            requestedTargets: [...new Set([...(liveMessage.translationMeta?.requestedTargets || []), targetKey])],
            startedAt: null,
            completedAt: Date.now(),
          };
          persistState();
          renderSafelyDuringInput();
        }
        console.warn("[translation] viewer-target failed", {
          roomId: room.id,
          messageId: message.id,
          targetLanguage,
          error: String(error?.message || error),
        });
      })
      .finally(() => {
        runtime.translationTasks.delete(taskKey);
      });
  }

  function isScrollNearBottom(scrollElement, threshold = 88) {
    if (!(scrollElement instanceof HTMLElement)) {
      return true;
    }
    return scrollElement.scrollHeight - scrollElement.clientHeight - scrollElement.scrollTop <= threshold;
  }

  function isComposerFocused() {
    const active = document.activeElement;
    return (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) && active.dataset.input === "composer";
  }

  function getRecipientIdsForMessage(room, message) {
    if (!room || !message?.senderId) return [];
    return deriveRoomParticipantIds(room).filter((participantId) => participantId !== message.senderId);
  }

  function getOutgoingMessageStatus(room, message, currentUser) {
    if (!room || !message || message.kind !== "user" || message.senderId !== currentUser.id) {
      return message?.status || "";
    }

    const recipientIds = getRecipientIdsForMessage(room, message);
    if (!recipientIds.length) {
      return message.status === "composing" ? "composing" : "sent";
    }

    const deliveredTo = message.deliveredTo || {};
    const readBy = message.readBy || {};
    const allRead = recipientIds.every((participantId) => Boolean(readBy[participantId]));
    if (allRead) return "read";

    const allDelivered = recipientIds.every((participantId) => Boolean(deliveredTo[participantId] || readBy[participantId]));
    if (allDelivered) return "delivered";

    return message.status === "composing" ? "composing" : "sent";
  }

  function canAcknowledgeReadForCurrentRoom(roomId, options = {}) {
    const currentUser = getCurrentUser();
    if (!currentUser || !roomId) return false;
    if (document.hidden) return false;
    if (uiState.activeRoomId !== roomId || currentUser.currentRoomId !== roomId) return false;

    const scroll = document.getElementById("chat-scroll");
    if (options.force) return true;
    if (runtime.chatPinnedToBottom) return true;
    if (isComposerFocused()) return true;
    return isScrollNearBottom(scroll, 120);
  }

  function refreshMessageReceipts(options = {}) {
    const currentUser = getCurrentUser();
    if (!currentUser) return false;

    const now = Date.now();
    let changed = false;

    appState.rooms.forEach((room) => {
      if (room.status !== "active") return;
      if (!deriveRoomParticipantIds(room).includes(currentUser.id)) return;

      (room.messages || []).forEach((message) => {
        if (message.kind !== "user" || message.senderId === currentUser.id) return;

        if (!message.deliveredTo) message.deliveredTo = {};
        if (!message.readBy) message.readBy = {};

        if (!message.deliveredTo[currentUser.id]) {
          message.deliveredTo[currentUser.id] = now;
          changed = true;
        }

        if (canAcknowledgeReadForCurrentRoom(room.id, options) && !message.readBy[currentUser.id]) {
          message.readBy[currentUser.id] = now;
          message.deliveredTo[currentUser.id] = message.deliveredTo[currentUser.id] || now;
          if (!room.unreadByUser) room.unreadByUser = {};
          room.unreadByUser[currentUser.id] = 0;
          changed = true;
        }
      });
    });

    return changed;
  }

  function scheduleReceiptRefresh(options = {}) {
    clearTimeout(runtime.receiptTimer);
    runtime.receiptTimer = setTimeout(() => {
      runtime.receiptTimer = null;
      if (!getCurrentUser()) return;
      const changed = refreshMessageReceipts(options);
      if (changed) {
        persistState();
        if (options.force) {
          flushServerStateSync();
        }
        if (shouldDeferNonCriticalRender()) {
          renderSafelyDuringInput();
        } else {
          render();
        }
      }
    }, options.delay ?? 60);
  }

  function renderMedia(media, messageId) {
    if (isMediaExpired(media)) {
      return renderExpiredMediaCard(media);
    }

    if (media.storage === "pending") {
      return renderPendingMediaCard(media);
    }

    const source = resolveMediaSource(media);
    if (media.kind === "image") {
      return source
        ? `<div class="media-card"><button class="media-thumb" data-action="open-media" data-message-id="${messageId}"><img src="${source}" alt="${escapeHtml(media.name || "image")}" /></button></div>`
        : renderPendingMediaCard(media);
    }
    if (media.kind === "file") {
      return `
        <div class="media-card">
          <button class="file-card" data-action="open-media" data-message-id="${messageId}">
            ${renderIconSvg("file")}
            <div class="video-meta">
              <strong>${escapeHtml(media.name || "file")}</strong>
              <span>${escapeHtml(formatBytes(media.size || 0))}</span>
            </div>
          </button>
        </div>
      `;
    }
    return `
      <div class="media-card">
        <div class="video-card">
          ${source ? `<video controls src="${source}" preload="metadata"></video>` : `<div class="tiny-pill pill-warning">${escapeHtml(t("previewNotReady"))}</div>`}
          <div class="video-meta">
            <strong>${escapeHtml(media.name || "video")}</strong>
            <span>${escapeHtml(formatBytes(media.size || 0))}</span>
            <span>${escapeHtml(media.expiresAt ? t("mediaExpiresIn", { time: getMediaExpiryLabel(media.expiresAt) }) : t("videoSessionOnly"))}</span>
          </div>
          <div class="button-row">
            <button class="button button-secondary" data-action="open-media" data-message-id="${messageId}">${escapeHtml(t("mediaPreview"))}</button>
          </div>
        </div>
      </div>
    `;
  }

  function resolveMediaSource(media) {
    if (!media) return "";
    if (isMediaExpired(media)) return "";
    if (media.storage === "draft") return media.objectUrl || "";
    if (media.storage === "inline") return media.previewUrl;
    if (media.storage === "server") return media.url || media.previewUrl || "";
    if (media.storage === "runtime") return runtime.videoUrls.get(media.runtimeId) || "";
    if (media.storage === "indexeddb" && media.mediaId) {
      const cached = runtime.mediaObjectUrls.get(media.mediaId);
      if (cached) return cached;
      ensureIndexedMediaLoaded(media);
      return "";
    }
    return media.previewUrl || "";
  }

  function renderExpiredMediaCard(media) {
    return `
      <div class="media-card">
        <div class="video-card media-expired-card">
          <div class="video-meta">
            <strong>${escapeHtml(t("mediaExpiredLabel"))}</strong>
            <span>${escapeHtml(t("mediaExpiredCopy"))}</span>
            <span>${escapeHtml(media?.name || "")}</span>
          </div>
        </div>
      </div>
    `;
  }

  function renderPendingMediaCard(media) {
    return `
      <div class="media-card">
        <div class="video-card">
          <div class="video-meta">
            <strong>${escapeHtml(media?.name || t("previewNotReady"))}</strong>
            <span>${escapeHtml(t("previewNotReadyCopy"))}</span>
          </div>
        </div>
      </div>
    `;
  }

  function renderComposer(room, currentUser) {
    const draft = getDraft(room.id);
    return `
      ${draft.attachment ? renderAttachmentPreview(draft.attachment) : ""}
      <div class="draft-tools">
        <div class="helper">${escapeHtml(t("labelNativeLanguage"))}: ${escapeHtml(getChatLanguageName(currentUser.nativeLanguage))} · ${escapeHtml(t("settingsPreferredLanguage"))}: ${escapeHtml(getChatLanguageName(currentUser.preferredChatLanguage || currentUser.nativeLanguage))}</div>
      </div>
      <div class="composer-wrap composer-inline">
        <div class="composer-line">
          <input
            class="composer-input"
            type="text"
            data-input="composer"
            data-room-id="${room.id}"
            value="${escapeHtml(draft.text)}"
            placeholder="${escapeHtml(t("composerPlaceholder"))}"
            autocomplete="off"
            autocorrect="off"
            autocapitalize="off"
            spellcheck="false"
            enterkeyhint="send"
            inputmode="text"
            data-lpignore="true"
          />
          <div class="composer-action-group">
            <div class="attachment-menu ${uiState.attachmentMenuOpen ? "open" : ""}">
              <button class="attach-option" data-action="trigger-image" data-room-id="${room.id}" aria-label="${escapeHtml(t("addPhoto"))}" title="${escapeHtml(t("addPhoto"))}">
                ${renderIconSvg("photo")}
              </button>
              <button class="attach-option" data-action="trigger-video" data-room-id="${room.id}" aria-label="${escapeHtml(t("addVideo"))}" title="${escapeHtml(t("addVideo"))}">
                ${renderIconSvg("video")}
              </button>
              <button class="attach-option" data-action="trigger-file" data-room-id="${room.id}" aria-label="${escapeHtml(t("addFile"))}" title="${escapeHtml(t("addFile"))}">
                ${renderIconSvg("file")}
              </button>
            </div>
            <button class="icon-button plus-trigger" data-action="toggle-attachment-menu" aria-label="${escapeHtml(t("addFile"))}" title="${escapeHtml(t("addFile"))}">+</button>
            <button class="button button-primary send-button" data-action="send-message" data-room-id="${room.id}" ${draft.processing ? "disabled" : ""}>${escapeHtml(t("sendButton"))}</button>
          </div>
        </div>
      </div>
      <input class="hidden-input" type="file" accept="image/jpeg,image/png,image/webp" data-input="image-file" data-room-id="${room.id}" />
      <input class="hidden-input" type="file" accept="image/*" capture="environment" data-input="camera-image-file" data-room-id="${room.id}" />
      <input class="hidden-input" type="file" accept="video/*" data-input="video-file" data-room-id="${room.id}" />
      <input class="hidden-input" type="file" data-input="generic-file" data-room-id="${room.id}" />
    `;
  }

  function renderAttachmentPreview(attachment) {
    return `
      <div class="attachment-preview">
        <div>
          <strong>${escapeHtml(
            attachment.kind === "image"
              ? t("attachmentImageReady")
              : attachment.kind === "video"
                ? t("attachmentVideoReady")
                : t("attachmentFileReady")
          )}</strong>
          <div class="helper">${escapeHtml(attachment.name)} · ${escapeHtml(formatBytes(attachment.size))}</div>
        </div>
        <div class="button-row">
          ${attachment.kind !== "file" ? `<button class="button button-secondary" data-action="preview-draft-media">${escapeHtml(t("mediaPreview"))}</button>` : ""}
          <button class="button button-danger" data-action="remove-attachment">${escapeHtml(t("removeAttachment"))}</button>
        </div>
      </div>
    `;
  }

  function renderAttachmentPreview(attachment) {
    const statusLabel =
      attachment.kind === "image"
        ? t("attachmentImageReady")
        : attachment.kind === "video"
          ? t("attachmentVideoReady")
          : t("attachmentFileReady");
    return `
      <div class="attachment-preview">
        <div>
          <strong>${escapeHtml(statusLabel)}</strong>
          <div class="helper">${escapeHtml(attachment.name)} · ${escapeHtml(formatBytes(attachment.size))}</div>
          ${attachment.kind !== "file" ? `<div class="helper">${escapeHtml(t("mediaExpiresAfterUpload", { hours: CONFIG.mediaExpireHours }))}</div>` : ""}
        </div>
        <div class="button-row">
          ${attachment.kind !== "file" ? `<button class="button button-secondary" data-action="preview-draft-media">${escapeHtml(t("mediaPreview"))}</button>` : ""}
          <button class="button button-danger" data-action="remove-attachment">${escapeHtml(t("removeAttachment"))}</button>
        </div>
      </div>
    `;
  }

  function renderInviteSide(currentUser) {
    const incoming = appState.invites
      .filter((invite) => invite.inviteeId === currentUser.id)
      .sort((a, b) => b.createdAt - a.createdAt);
    const recent = appState.invites
      .filter((invite) => invite.inviterId === currentUser.id && invite.status !== "pending")
      .sort((a, b) => (b.respondedAt || 0) - (a.respondedAt || 0))
      .slice(0, 4);

    return `
      <section class="panel">
        <div class="panel-header">
          <div>
            <h2>${escapeHtml(t("sideInvitesTitle"))}</h2>
            <p class="panel-copy">${escapeHtml(t("sideInvitesCopy"))}</p>
          </div>
        </div>
        <div class="card-scroll">
          ${incoming.length ? incoming.map((invite) => renderInviteCard(invite)).join("") : `<div class="empty-card"><h3>${escapeHtml(t("noInvitesTitle"))}</h3><p>${escapeHtml(t("noInvitesCopy"))}</p></div>`}
          <div class="info-card">
            <strong>${escapeHtml(t("inviteResultTitle"))}</strong>
            ${recent.length
              ? recent
                  .map((invite) => {
                    const invitee = appState.users.find((user) => user.id === invite.inviteeId);
                    return `<span>${escapeHtml(invitee?.name || "—")} · ${escapeHtml(getInviteDisplayTitle(invite))} · ${escapeHtml(invite.status === "accepted" ? t("inviteAccepted") : t("inviteRejected"))}</span>`;
                  })
                  .join("")
              : `<span>${escapeHtml(t("inviteResultEmpty"))}</span>`}
          </div>
        </div>
      </section>
    `;
  }

  function renderInviteCard(invite) {
    const inviter = appState.users.find((user) => user.id === invite.inviterId);
    const room = appState.rooms.find((item) => item.id === invite.roomId);
    return `
      <article class="invite-card">
        <strong>${escapeHtml(normalizeDisplayText(room?.title || "—"))}</strong>
        <span>${escapeHtml(getUserDisplayName(inviter) || inviter?.loginId || "—")} · ${escapeHtml(formatRelativeTime(invite.createdAt))}</span>
        <div class="invite-row" style="margin-top: 12px;">
          ${invite.status === "pending"
            ? `
                <button class="button button-primary" data-action="respond-invite" data-invite-id="${invite.id}" data-response="accept">${escapeHtml(t("acceptInvite"))}</button>
                <button class="button button-danger" data-action="respond-invite" data-invite-id="${invite.id}" data-response="reject">${escapeHtml(t("rejectInvite"))}</button>
              `
            : `<span class="status-pill ${invite.status === "accepted" ? "pill-success" : "pill-danger"}">${escapeHtml(invite.status === "accepted" ? t("inviteAccepted") : t("inviteRejected"))}</span>`}
        </div>
      </article>
    `;
  }

  function renderPeopleSide(activeRoom) {
    const participants = activeRoom
      ? activeRoom.participants
          .map((participantId) => appState.users.find((user) => user.id === participantId))
          .filter(Boolean)
      : [];

    return `
      <section class="panel">
        <div class="panel-header">
          <div>
            <h2>${escapeHtml(t("sidePeopleTitle"))}</h2>
            <p class="panel-copy">${escapeHtml(t("sidePeopleCopy"))}</p>
          </div>
        </div>
        <div class="card-scroll">
          ${activeRoom && participants.length ? participants.map((participant) => renderParticipantCard(participant, activeRoom.id)).join("") : `<div class="empty-card"><h3>${escapeHtml(t("participantsButton"))}</h3><p>${escapeHtml(activeRoom ? t("noParticipants") : t("chatWelcomeCopy"))}</p></div>`}
        </div>
      </section>
    `;
  }

  function renderParticipantCard(participant, roomId) {
    const presence = getPresence(participant, roomId);
    return `
      <article class="participant-card">
        <div class="participant-row">
          <div class="participant-row-start">
            ${renderProfileImage(participant, "list-profile-image", participant.name)}
            <div class="friend-card-meta">
              <strong>${escapeHtml(participant.name)}</strong>
              <span>${escapeHtml(getChatLanguageName(participant.nativeLanguage))}</span>
            </div>
          </div>
          <span class="status-pill ${presence.kind === "online" ? "pill-success" : ""}">
            ${renderPresenceLabel(presence)}
          </span>
        </div>
      </article>
    `;
  }

  function renderDrawer(currentUser) {
    const open = Boolean(uiState.drawer);
    return `
      <div class="drawer ${open ? "open" : ""}">
        <div class="drawer-backdrop" data-action="close-drawer"></div>
        <aside class="drawer-panel">
          ${uiState.drawer === "settings" ? renderSettingsDrawer(currentUser) : uiState.drawer === "invites" ? renderInvitesDrawer(currentUser) : `<div class="drawer-body"></div>`}
        </aside>
      </div>
    `;
  }

  function renderSettingsDrawer(currentUser) {
    return `
      <div class="sidebar-header">
        <div>
          <h2 class="drawer-title">${escapeHtml(t("settingsTitle"))}</h2>
          <p class="drawer-copy">${escapeHtml(t("settingsCopy"))}</p>
        </div>
      </div>
      <div class="drawer-body">
        <div class="setting-card">
          <strong>${escapeHtml(t("settingsUiLanguage"))}</strong>
          <span>${escapeHtml(getUiLanguageName(currentUser.uiLanguage))}</span>
          <div class="field" style="margin-top: 12px;">
            <select data-input="settings-ui-language">
              ${renderLanguageOptions(currentUser.uiLanguage, UI_LANGUAGES)}
            </select>
          </div>
        </div>
        <div class="setting-card">
          <strong>${escapeHtml(t("settingsNativeLanguage"))}</strong>
          <span>${escapeHtml(getChatLanguageName(currentUser.nativeLanguage))}</span>
          <div class="field" style="margin-top: 12px;">
            <select data-input="settings-native-language">
              ${renderLanguageOptions(currentUser.nativeLanguage, CHAT_LANGUAGES)}
            </select>
          </div>
        </div>
        <div class="setting-card">
          <strong>${escapeHtml(t("themeLabel"))}</strong>
          <div class="segmented" style="margin-top: 12px;">
            ${["system", "light", "dark"].map((theme) => `<button class="${appState.settings.theme === theme ? "active" : ""}" data-action="set-theme" data-theme="${theme}">${escapeHtml(t(`theme${capitalize(theme)}`))}</button>`).join("")}
          </div>
        </div>
      </div>
      <div class="drawer-footer">
        <button class="button button-secondary" data-action="close-drawer">${escapeHtml(t("settingsClose"))}</button>
      </div>
    `;
  }

  function renderInvitesDrawer(currentUser) {
    const incoming = appState.invites
      .filter((invite) => invite.inviteeId === currentUser.id)
      .sort((a, b) => b.createdAt - a.createdAt);
    return `
      <div class="sidebar-header">
        <div>
          <h2 class="drawer-title">${escapeHtml(t("sideInvitesTitle"))}</h2>
          <p class="drawer-copy">${escapeHtml(t("sideInvitesCopy"))}</p>
        </div>
      </div>
      <div class="drawer-body">
        ${incoming.length ? incoming.map((invite) => renderInviteCard(invite)).join("") : `<div class="empty-card"><h3>${escapeHtml(t("noInvitesTitle"))}</h3><p>${escapeHtml(t("noInvitesCopy"))}</p></div>`}
      </div>
      <div class="drawer-footer">
        <button class="button button-secondary" data-action="close-drawer">${escapeHtml(t("settingsClose"))}</button>
      </div>
    `;
  }

  function renderModal() {
    if (!uiState.modal) return "";
    const modalType = uiState.modal.type;
    const body =
      modalType === "create-room"
      ? renderCreateRoomModal()
      : modalType === "room-settings"
          ? renderRoomSettingsModal()
        : modalType === "password"
          ? renderPasswordModal()
          : modalType === "invite"
            ? renderInviteModal()
            : modalType === "participants"
              ? renderParticipantsModal()
              : modalType === "media"
                ? renderMediaModal()
                : modalType === "profile-preview"
                  ? renderProfilePreviewModal()
                  : modalType === "profile-image-editor"
                    ? renderProfileImageEditorModal()
                    : modalType === "profile-image-view"
                      ? renderProfileImageViewModal()
                  : modalType === "image-source"
                    ? renderImageSourceModal()
                  : modalType === "notice"
                    ? renderNoticeModal()
                    : modalType === "exit-confirm"
                      ? renderAppExitConfirmModal()
                : "";
    return `<div class="modal-layer">${body}</div>`;
  }

  function renderExitConfirmModal() {
    const uiLanguage = getUiLanguage();
    const title =
      uiLanguage === "en"
        ? "Do you want to close the app?"
        : uiLanguage === "vi"
          ? "Ban co muon thoat ung dung khong?"
          : "앱을 종료하시겠습니까?";
    const message =
      uiLanguage === "en"
        ? "If you go back from the chat list, the app will close."
        : uiLanguage === "vi"
          ? "Khi dang o danh sach phong chat, nhan nut quay lai de thoat ung dung."
          : "채팅 목록에서 뒤로가기를 누르면 앱을 종료할 수 있습니다.";
    const confirmLabel =
      uiLanguage === "en"
        ? "Yes"
        : uiLanguage === "vi"
          ? "Co"
          : "예";
    return `
      <section class="modal notice-modal">
        <div class="modal-header">
          <h3>${escapeHtml(title)}</h3>
        </div>
        <div class="modal-body">
          <p>${escapeHtml(message)}</p>
        </div>
        <div class="modal-footer">
          <button class="button button-secondary" data-action="close-modal">${escapeHtml(t("cancel"))}</button>
          <button class="button button-primary" data-action="confirm-exit-app">${escapeHtml(confirmLabel)}</button>
        </div>
      </section>
    `;
  }

  function renderAppExitConfirmModal() {
    const uiLanguage = getUiLanguage();
    const title =
      uiLanguage === "en"
        ? "Do you want to close the app?"
        : uiLanguage === "vi"
          ? "Ban co muon thoat ung dung khong?"
          : "\uC571\uC744 \uC885\uB8CC\uD558\uC2DC\uACA0\uC2B5\uB2C8\uAE4C?";
    const message =
      uiLanguage === "en"
        ? "If you go back from the chat list, the app will close."
        : uiLanguage === "vi"
          ? "Khi dang o danh sach phong chat, nhan nut quay lai de thoat ung dung."
          : "\uCC44\uD305 \uBAA9\uB85D\uC5D0\uC11C \uB4A4\uB85C\uAC00\uAE30\uB97C \uB204\uB974\uBA74 \uC571\uC774 \uC885\uB8CC\uB429\uB2C8\uB2E4.";
    const cancelLabel =
      uiLanguage === "en"
        ? "No"
        : uiLanguage === "vi"
          ? "Khong"
          : "\uC544\uB2C8\uC624";
    const confirmLabel =
      uiLanguage === "en"
        ? "Yes"
        : uiLanguage === "vi"
          ? "Co"
          : "\uC608";
    return `
      <section class="modal notice-modal">
        <div class="modal-header">
          <h3>${escapeHtml(title)}</h3>
        </div>
        <div class="modal-body">
          <p>${escapeHtml(message)}</p>
        </div>
        <div class="modal-footer">
          <button class="button button-secondary" data-action="close-modal">${escapeHtml(cancelLabel)}</button>
          <button class="button button-primary" data-action="confirm-exit-app">${escapeHtml(confirmLabel)}</button>
        </div>
      </section>
    `;
  }

  function renderProfileImageEditorModal() {
    const data = uiState.modal?.data || {};
    return `
      <section class="modal profile-crop-modal">
        <div class="modal-header">
          <h3>프로필 사진 편집</h3>
          <p>사각형 안에서 확대하고 위치를 맞춰주세요</p>
        </div>
        <div class="modal-body profile-crop-body">
          <div class="profile-crop-stage" data-profile-crop-stage="true">
            <img
              class="profile-crop-image"
              data-profile-crop-image="true"
              src="${escapeHtml(data.sourceUrl || "")}"
              alt="profile crop"
              draggable="false"
              style="${escapeHtml(getProfileCropImageInlineStyle(data))}"
            >
          </div>
          <div class="profile-crop-controls">
            <div class="profile-crop-zoom-row">
              <span>확대</span>
              <input
                type="range"
                min="${escapeHtml(String(data.minZoom || 1))}"
                max="${escapeHtml(String(data.maxZoom || 3.2))}"
                step="0.01"
                value="${escapeHtml(String(data.zoom || 1))}"
                data-input="profile-crop-zoom"
              >
              <strong data-profile-crop-zoom-value="true">${Math.round(Number(data.zoom || 1) * 100)}%</strong>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="button button-secondary" type="button" data-action="close-modal">취소</button>
          <button class="button button-primary" type="button" data-action="submit-profile-image-crop" ${data.saving ? "disabled" : ""}>저장</button>
        </div>
      </section>
    `;
  }

  function renderProfileImageViewModal() {
    const data = uiState.modal?.data || {};
    return `
      <section class="modal profile-image-view-modal">
        <div class="modal-header">
          <h3>프로필 사진</h3>
          <p>${escapeHtml(data.name || "")}</p>
        </div>
        <div class="modal-body profile-image-view-body">
          <img class="profile-image-view-image" src="${escapeHtml(data.image || DEFAULT_PROFILE_IMAGE)}" alt="${escapeHtml(data.name || "profile")}">
        </div>
        <div class="modal-footer">
          <button class="button button-secondary" type="button" data-action="close-modal">${escapeHtml(t("settingsClose"))}</button>
        </div>
      </section>
    `;
  }

  function renderImageSourceModal() {
    const roomId = uiState.modal?.data?.roomId || uiState.activeRoomId || "";
    return `
      <section class="modal bottom-sheet-modal image-source-modal">
        <div class="modal-header">
          <h3>사진 업로드</h3>
          <p>가져올 방식을 선택하세요</p>
        </div>
        <div class="modal-body image-source-actions">
          <button class="button button-primary" type="button" data-action="pick-image-source" data-source="gallery" data-room-id="${escapeHtml(roomId)}">갤러리에서 선택</button>
          <button class="button button-secondary" type="button" data-action="pick-image-source" data-source="camera" data-room-id="${escapeHtml(roomId)}">카메라로 촬영</button>
        </div>
        <div class="modal-footer">
          <button class="button button-secondary" type="button" data-action="close-modal">${escapeHtml(t("cancel"))}</button>
        </div>
      </section>
    `;
  }

  function renderCreateRoomModal() {
    const data = uiState.modal.data || { title: "", password: "" };
    return `
      <section class="modal">
        <div class="modal-header">
          <h3>${escapeHtml(t("modalCreateRoomTitle"))}</h3>
          <p>${escapeHtml(t("modalCreateRoomCopy"))}</p>
        </div>
        <form class="modal-body" data-form="create-room">
          <div class="field">
            <label>${escapeHtml(t("modalRoomTitle"))}</label>
            <input name="title" value="${escapeHtml(data.title)}" placeholder="${escapeHtml(t("placeholderRoomTitle"))}" required />
          </div>
          <div class="field">
            <label>${escapeHtml(t("modalRoomPassword"))}</label>
            <input name="password" value="${escapeHtml(data.password)}" placeholder="${escapeHtml(t("placeholderRoomPassword"))}" required />
          </div>
        </form>
        <div class="modal-footer">
          <button class="button button-secondary" data-action="close-modal">${escapeHtml(t("cancel"))}</button>
          <button class="button button-primary" data-action="submit-create-room">${escapeHtml(t("createConfirm"))}</button>
        </div>
      </section>
    `;
  }

  function renderRoomSettingsModal() {
    const currentRoom = appState.rooms.find((item) => item.id === uiState.activeRoomId);
    const data = uiState.modal?.data || {};
    if (!currentRoom) return "";
    return `
      <section class="modal">
        <div class="modal-header">
          <h3>${escapeHtml(t("roomSettingsButton"))}</h3>
          <p>${escapeHtml(t("roomSettingsCopy"))}</p>
        </div>
        <form class="modal-body" data-form="room-settings">
          <div class="field">
            <label>${escapeHtml(t("modalRoomTitle"))}</label>
            <input name="title" value="${escapeHtml(data.title ?? currentRoom.title)}" placeholder="${escapeHtml(t("placeholderRoomTitle"))}" />
          </div>
          <div class="field">
            <label>${escapeHtml(t("roomPasswordLabel"))}</label>
            <input name="password" value="${escapeHtml((data.password ?? currentRoom.password) || "")}" placeholder="${escapeHtml(t("roomPasswordPlaceholder"))}" />
          </div>
        </form>
        <div class="modal-footer">
          <button class="button button-secondary" type="button" data-action="close-modal">${escapeHtml(t("cancel"))}</button>
          <button class="button button-primary" type="button" data-action="submit-room-settings">${escapeHtml(t("applyButton"))}</button>
        </div>
      </section>
    `;
  }

  function renderPasswordModal() {
    const { roomId, error = "", password = "" } = uiState.modal.data;
    const room = appState.rooms.find((item) => item.id === roomId);
    const currentUser = getCurrentUser();
    const record = room && currentUser ? accessRecord(room, currentUser.id) : { failedAttempts: 0, lockedUntil: null };
    const locked = record.lockedUntil && record.lockedUntil > Date.now();
    return `
      <section class="modal">
        <div class="modal-header">
          <h3>${escapeHtml(t("modalPasswordTitle"))}</h3>
          <p>${escapeHtml(t("modalPasswordCopy"))}</p>
        </div>
        <div class="modal-body">
          <div class="field">
            <label>${escapeHtml(t("modalRoomPassword"))}</label>
            <input data-input="password-modal" type="password" value="${escapeHtml(password)}" placeholder="${escapeHtml(t("placeholderRoomPassword"))}" ${locked ? "disabled" : ""} />
          </div>
          ${error ? `<div class="status-pill pill-danger">${escapeHtml(error)}</div>` : ""}
          ${locked ? `<div class="helper">${escapeHtml(t("passwordLockedCopy", { time: formatRemaining(record.lockedUntil - Date.now()) }))}</div>` : record.failedAttempts ? `<div class="helper">${escapeHtml(t("passwordAttemptsLeft", { count: Math.max(0, CONFIG.passwordAttemptLimit - record.failedAttempts) }))}</div>` : ""}
        </div>
        <div class="modal-footer">
          <button class="button button-secondary" data-action="close-modal">${escapeHtml(t("cancel"))}</button>
          <button class="button button-primary" data-action="submit-password" ${locked ? "disabled" : ""}>${escapeHtml(t("enterRoomButton"))}</button>
        </div>
      </section>
    `;
  }

  function renderInviteModal() {
    const data = uiState.modal.data || { name: "", error: "" };
    return `
      <section class="modal">
        <div class="modal-header">
          <h3>${escapeHtml(t("modalInviteTitle"))}</h3>
          <p>${escapeHtml(t("modalInviteCopy"))}</p>
        </div>
        <div class="modal-body">
          <div class="field">
            <label>${escapeHtml(t("inviteNameLabel"))}</label>
            <input data-input="invite-name" value="${escapeHtml(data.name)}" placeholder="${escapeHtml(t("inviteNamePlaceholder"))}" />
          </div>
          ${data.error ? `<div class="status-pill pill-danger">${escapeHtml(data.error)}</div>` : ""}
        </div>
        <div class="modal-footer">
          <button class="button button-secondary" data-action="close-modal">${escapeHtml(t("cancel"))}</button>
          <button class="button button-primary" data-action="submit-invite">${escapeHtml(t("inviteSend"))}</button>
        </div>
      </section>
    `;
  }

  function renderParticipantsModal() {
    const room = appState.rooms.find((item) => item.id === uiState.activeRoomId);
    const participants = room
      ? deriveRoomParticipantIds(room).map((participantId) => appState.users.find((user) => user.id === participantId)).filter(Boolean)
      : [];
    return `
      <section class="modal">
        <div class="modal-header">
          <h3>${escapeHtml(t("participantsModalTitle"))}</h3>
          <p>${escapeHtml(t("participantsModalCopy"))}</p>
        </div>
        <div class="modal-body">
          ${participants.length ? participants.map((participant) => renderParticipantCard(participant, room.id)).join("") : `<div class="helper">${escapeHtml(t("noParticipants"))}</div>`}
        </div>
        <div class="modal-footer">
          <button class="button button-secondary" data-action="close-modal">${escapeHtml(t("settingsClose"))}</button>
        </div>
      </section>
    `;
  }

  function renderMediaModal() {
    const media = uiState.previewMedia;
    if (!media) return "";
    if (isMediaExpired(media)) {
      return `
        <section class="modal">
          <div class="modal-header">
            <h3>${escapeHtml(t("mediaModalTitle"))}</h3>
            <p>${escapeHtml(media.name || "")}</p>
          </div>
          <div class="modal-body">${renderExpiredMediaCard(media)}</div>
          <div class="modal-footer">
            <button class="button button-secondary" data-action="close-modal">${escapeHtml(t("mediaModalClose"))}</button>
          </div>
        </section>
      `;
    }
    const source = resolveMediaSource(media);
    const content =
      media.kind === "image" && source
        ? `<img src="${source}" alt="${escapeHtml(media.name || "preview")}" />`
        : media.kind === "file"
          ? `
              <div class="file-card static">
                ${renderIconSvg("file")}
                <div class="video-meta">
                  <strong>${escapeHtml(media.name || "file")}</strong>
                  <span>${escapeHtml(formatBytes(media.size || 0))}</span>
                </div>
              </div>
            `
        : media.kind === "video" && source
          ? `<video controls src="${source}"></video>`
          : `<div class="video-card"><div class="video-meta"><strong>${escapeHtml(t("previewNotReady"))}</strong><span>${escapeHtml(t("previewNotReadyCopy"))}</span></div></div>`;

    return `
      <section class="modal">
        <div class="modal-header">
          <h3>${escapeHtml(t("mediaModalTitle"))}</h3>
          <p>${escapeHtml(media.name || "")}</p>
        </div>
        <div class="modal-body">${content}</div>
        <div class="modal-footer">
          <button class="button button-secondary" data-action="close-modal">${escapeHtml(t("mediaModalClose"))}</button>
        </div>
      </section>
    `;
  }

  function renderProfilePreviewModal() {
    const friend = appState.users.find((user) => user.id === uiState.modal?.data?.userId);
    if (!friend) return "";
    const currentUser = getCurrentUser();
    const canAdminEdit = isAdminUser(currentUser) && !isAdminUser(friend);
    const displayName = getUserDisplayName(friend) || friend.loginId || friend.name;
    const genderLabel =
      friend.gender === "male"
        ? t("authGenderMale")
        : friend.gender === "female"
          ? t("authGenderFemale")
          : t("profilePopupEmpty");
    const modalData = uiState.modal?.data || {};
    return `
      <section class="modal">
        <div class="modal-header">
          <h3>${escapeHtml(canAdminEdit ? t("adminProfileEditTitle") : t("profilePopupTitle"))}</h3>
          <p>${escapeHtml(displayName)}</p>
        </div>
        <div class="modal-body profile-preview-grid">
          ${canAdminEdit
            ? `
              <div class="field compact-field">
                <label for="admin-profile-name">${escapeHtml(t("profilePopupName"))}</label>
                <input id="admin-profile-name" data-input="admin-profile-name" type="text" maxlength="24" value="${escapeHtml(modalData.editName ?? friend.name ?? "")}" autocomplete="off" />
              </div>
              <div class="field compact-field">
                <label>${escapeHtml(t("profilePopupId"))}</label>
                <div class="profile-static-value">${escapeHtml(friend.loginId || "")}</div>
              </div>
              <div class="field compact-field">
                <label for="admin-profile-gender">${escapeHtml(t("profilePopupGender"))}</label>
                <select id="admin-profile-gender" data-input="admin-profile-gender">
                  <option value="">${escapeHtml(t("profilePopupEmpty"))}</option>
                  <option value="male" ${(modalData.editGender ?? friend.gender) === "male" ? "selected" : ""}>${escapeHtml(t("authGenderMale"))}</option>
                  <option value="female" ${(modalData.editGender ?? friend.gender) === "female" ? "selected" : ""}>${escapeHtml(t("authGenderFemale"))}</option>
                </select>
              </div>
              <div class="field compact-field">
                <label for="admin-profile-age">${escapeHtml(t("profilePopupAge"))}</label>
                <input id="admin-profile-age" data-input="admin-profile-age" type="number" min="0" max="120" inputmode="numeric" value="${escapeHtml(String(modalData.editAge ?? friend.age ?? ""))}" autocomplete="off" />
              </div>
              <div class="field compact-field">
                <label for="admin-profile-password">${escapeHtml(t("adminProfilePasswordLabel"))}</label>
                <input id="admin-profile-password" data-input="admin-profile-password" type="text" value="${escapeHtml(modalData.editPassword ?? friend.password ?? "")}" autocomplete="off" />
              </div>
            `
            : `
              <div class="profile-preview-item"><span>${escapeHtml(t("profilePopupName"))}</span><strong>${escapeHtml(friend.name || t("profilePopupEmpty"))}</strong></div>
              <div class="profile-preview-item"><span>${escapeHtml(t("profilePopupId"))}</span><strong>${escapeHtml(friend.loginId || "")}</strong></div>
              <div class="profile-preview-item"><span>${escapeHtml(t("profilePopupGender"))}</span><strong>${escapeHtml(genderLabel)}</strong></div>
              <div class="profile-preview-item"><span>${escapeHtml(t("profilePopupAge"))}</span><strong>${escapeHtml(friend.age || t("profilePopupEmpty"))}</strong></div>
            `}
        </div>
        <div class="modal-footer">
          ${canAdminEdit ? `<button class="button button-primary" data-action="save-admin-profile" data-user-id="${friend.id}">${escapeHtml(t("adminProfileSaveButton"))}</button>` : ""}
          <button class="button button-secondary" data-action="close-modal">${escapeHtml(t("settingsClose"))}</button>
        </div>
      </section>
    `;
  }

  function renderFriendCard(friend) {
    const activeRoom = appState.rooms.find((room) => room.id === uiState.activeRoomId && room.status === "active");
    const alreadyInRoom = activeRoom ? deriveRoomParticipantIds(activeRoom).includes(friend.id) : false;
    const pendingInvite = activeRoom
      ? appState.invites.some((invite) => invite.roomId === activeRoom.id && invite.inviteeId === friend.id && invite.status === "pending")
      : false;
    const presence = getPresence(friend, activeRoom?.id || friend.currentRoomId || null);
    return `
      <article class="friend-card">
        ${renderProfileImage(friend, "list-profile-image", friend.name)}
        <div class="friend-card-meta">
          <strong>${escapeHtml(friend.name)}</strong>
          <span>${escapeHtml(getChatLanguageName(friend.nativeLanguage))} · ${escapeHtml(presence.label)}</span>
        </div>
        <div class="button-row">
          <span class="status-pill ${presence.kind === "online" ? "pill-success" : ""}">
            ${renderPresenceLabel(presence)}
          </span>
          <button
            class="button button-secondary"
            data-action="quick-invite"
            data-friend-name="${escapeHtml(friend.name)}"
            ${!activeRoom || alreadyInRoom || pendingInvite ? "disabled" : ""}
          >
            ${escapeHtml(t("friendInviteButton"))}
          </button>
        </div>
      </article>
    `;
  }

  function renderParticipantCard(participant, roomId) {
    const presence = getPresence(participant, roomId);
    return `
      <article class="participant-card">
        <div class="participant-row">
          <div class="participant-row-start">
            ${renderProfileImage(participant, "list-profile-image", participant.name)}
            <div class="friend-card-meta">
              <strong>${escapeHtml(participant.name)}</strong>
              <span>${escapeHtml(getChatLanguageName(participant.nativeLanguage))}</span>
            </div>
          </div>
          <span class="status-pill ${presence.kind === "online" ? "pill-success" : ""}">
            ${renderPresenceLabel(presence)}
          </span>
        </div>
      </article>
    `;
  }

  function renderProfilePreviewModal() {
    const friend = appState.users.find((user) => user.id === uiState.modal?.data?.userId);
    if (!friend) return "";
    const currentUser = getCurrentUser();
    const canAdminEdit = isAdminUser(currentUser) && !isAdminUser(friend);
    const displayName = getUserDisplayName(friend) || friend.loginId || friend.name;
    const genderLabel =
      friend.gender === "male"
        ? t("authGenderMale")
        : friend.gender === "female"
          ? t("authGenderFemale")
          : t("profilePopupEmpty");
    const presence = getPresence(friend, friend.currentRoomId || null);
    const modalData = uiState.modal?.data || {};
    return `
      <section class="modal profile-preview-modal">
        <div class="modal-header profile-preview-header">
          <div class="profile-preview-heading">
            <h3>${escapeHtml(canAdminEdit ? t("adminProfileEditTitle") : t("profilePopupTitle"))}</h3>
            <p>${escapeHtml(displayName)}</p>
          </div>
          <button
            class="profile-preview-photo-button"
            type="button"
            data-action="open-profile-image-view"
            data-user-id="${friend.id}"
            aria-label="${escapeHtml(displayName)}"
          >
            ${renderProfileImage(friend, "profile-preview-photo", displayName)}
          </button>
        </div>
        <div class="modal-body profile-preview-grid">
          ${canAdminEdit
            ? `
              <div class="field compact-field">
                <label for="admin-profile-name">${escapeHtml(t("profilePopupName"))}</label>
                <input id="admin-profile-name" data-input="admin-profile-name" type="text" maxlength="24" value="${escapeHtml(modalData.editName ?? friend.name ?? "")}" autocomplete="off" />
              </div>
              <div class="field compact-field">
                <label>${escapeHtml(t("profilePopupId"))}</label>
                <div class="profile-static-value">${escapeHtml(friend.loginId || "")}</div>
              </div>
              <div class="field compact-field">
                <label for="admin-profile-gender">${escapeHtml(t("profilePopupGender"))}</label>
                <select id="admin-profile-gender" data-input="admin-profile-gender">
                  <option value="">${escapeHtml(t("profilePopupEmpty"))}</option>
                  <option value="male" ${(modalData.editGender ?? friend.gender) === "male" ? "selected" : ""}>${escapeHtml(t("authGenderMale"))}</option>
                  <option value="female" ${(modalData.editGender ?? friend.gender) === "female" ? "selected" : ""}>${escapeHtml(t("authGenderFemale"))}</option>
                </select>
              </div>
              <div class="field compact-field">
                <label for="admin-profile-age">${escapeHtml(t("profilePopupAge"))}</label>
                <input id="admin-profile-age" data-input="admin-profile-age" type="number" min="0" max="120" inputmode="numeric" value="${escapeHtml(String(modalData.editAge ?? friend.age ?? ""))}" autocomplete="off" />
              </div>
              <div class="field compact-field">
                <label for="admin-profile-password">${escapeHtml(t("adminProfilePasswordLabel"))}</label>
                <input id="admin-profile-password" data-input="admin-profile-password" type="text" value="${escapeHtml(modalData.editPassword ?? friend.password ?? "")}" autocomplete="off" />
              </div>
              <div class="field compact-field">
                <label>${escapeHtml(t("profilePopupLastSeen"))}</label>
                <div class="profile-static-value">${renderPresenceLabel(presence)}</div>
              </div>
            `
            : `
              <div class="profile-preview-item"><span>${escapeHtml(t("profilePopupName"))}</span><strong>${escapeHtml(friend.name || t("profilePopupEmpty"))}</strong></div>
              <div class="profile-preview-item"><span>${escapeHtml(t("profilePopupId"))}</span><strong>${escapeHtml(friend.loginId || "")}</strong></div>
              <div class="profile-preview-item"><span>${escapeHtml(t("profilePopupGender"))}</span><strong>${escapeHtml(genderLabel)}</strong></div>
              <div class="profile-preview-item"><span>${escapeHtml(t("profilePopupAge"))}</span><strong>${escapeHtml(friend.age || t("profilePopupEmpty"))}</strong></div>
              <div class="profile-preview-item"><span>${escapeHtml(t("profilePopupLastSeen"))}</span><strong>${renderPresenceLabel(presence)}</strong></div>
            `}
        </div>
        <div class="modal-footer">
          ${canAdminEdit ? `<button class="button button-primary" data-action="save-admin-profile" data-user-id="${friend.id}">${escapeHtml(t("adminProfileSaveButton"))}</button>` : ""}
          <button class="button button-secondary" data-action="close-modal">${escapeHtml(t("settingsClose"))}</button>
        </div>
      </section>
    `;
  }

  function renderNoticeModal() {
    const title = uiState.modal?.data?.title || "";
    const message = uiState.modal?.data?.message || "";
    return `
      <section class="modal notice-modal">
        <div class="modal-header">
          <h3>${escapeHtml(title)}</h3>
        </div>
        <div class="modal-body">
          <p>${escapeHtml(message)}</p>
        </div>
        <div class="modal-footer">
          <button class="button button-primary" data-action="close-modal">${escapeHtml(t("settingsClose"))}</button>
        </div>
      </section>
    `;
  }

  function renderToastStack() {
    if (!uiState.toasts.length) return "";
    return `
      <div class="toast-stack">
        ${uiState.toasts.map((toast) => `<div class="toast"><strong>${escapeHtml(toast.title)}</strong><p>${escapeHtml(toast.message)}</p></div>`).join("")}
      </div>
    `;
  }

  function bindPostRender(focusState, chatScrollState, surfaceScrollState) {
    syncViewport();
    restoreChatScrollState(chatScrollState);
    restoreSurfaceScrollState(surfaceScrollState);
    updateChatLayoutMetrics();
    restoreFocusState(focusState);
    syncBrowserHistoryForActiveRoom();
    scheduleReceiptRefresh({ delay: 70 });
  }

  function ensureBrowserHistoryState() {
    if (typeof window === "undefined" || !window.history || typeof window.history.replaceState !== "function") {
      return;
    }
    const currentState = window.history.state;
    if (currentState?.__transchat) {
      return;
    }
    window.history.replaceState({ __transchat: true, screen: "app-root", roomId: null }, "", window.location.href);
  }

  function syncBrowserHistoryForActiveRoom() {
    if (typeof window === "undefined" || !window.history) {
      return;
    }

    const currentUser = getCurrentUser();
    if (!currentUser) {
      runtime.historyRoomId = null;
      runtime.historyExitArmed = false;
      return;
    }

    ensureBrowserHistoryState();
    const currentState = window.history.state;
    const roomId = uiState.activeRoomId || null;
    const isChatListView = !roomId && uiState.directoryTab === "chat";
    if (roomId) {
      if (currentState?.__transchat && currentState.screen === "room" && currentState.roomId === roomId) {
        runtime.historyRoomId = roomId;
        return;
      }
      if (runtime.historyRoomId === roomId) {
        return;
      }
      if (currentState?.__transchat && currentState.screen === "room") {
        window.history.replaceState({ __transchat: true, screen: "room", roomId }, "", window.location.href);
        runtime.historyRoomId = roomId;
        return;
      }
      window.history.pushState({ __transchat: true, screen: "room", roomId }, "", window.location.href);
      runtime.historyRoomId = roomId;
      return;
    }

    runtime.historyRoomId = null;
    if (isChatListView) {
      if (currentState?.__transchat && currentState.screen === "chat-list") {
        return;
      }
      if (currentState?.__transchat && currentState.screen === "app-root") {
        window.history.pushState({ __transchat: true, screen: "chat-list", roomId: null }, "", window.location.href);
        return;
      }
      window.history.replaceState({ __transchat: true, screen: "chat-list", roomId: null }, "", window.location.href);
      return;
    }

    if (!(currentState?.__transchat && currentState.screen === "app-root")) {
      window.history.replaceState({ __transchat: true, screen: "app-root", roomId: null }, "", window.location.href);
    }
  }

  function closeActiveRoomView(options = {}) {
    const currentUser = getCurrentUser();
    const roomId = uiState.activeRoomId || currentUser?.currentRoomId || null;
    if (roomId) {
      stopTypingForRoom(roomId);
      uiState.dismissedRoomId = roomId;
    }
    uiState.activeRoomId = null;
    uiState.directoryTab = "chat";
    uiState.chatDetailsOpen = false;
    uiState.attachmentMenuOpen = false;
    uiState.mobileRoomsOpen = false;
    markUserPresence(null);
    if (currentUser) {
      markAllChatNotificationsSeen(currentUser.id);
      persistState();
    }
    if (options.updateHistory !== false) {
      syncBrowserHistoryForActiveRoom();
    }
    render();
  }

  function handleRoomBackNavigation() {
    if (!uiState.activeRoomId) {
      return;
    }
    const historyState = window.history?.state;
    if (historyState?.__transchat && historyState.screen === "room") {
      window.history.back();
      return;
    }
    closeActiveRoomView();
  }

  function confirmExitApp() {
    uiState.modal = null;
    uiState.previewMedia = null;
    clearProfileCropDrag();
    if (typeof window === "undefined" || !window.history) {
      render();
      return;
    }
    runtime.historyExitArmed = true;
    window.history.back();
  }

  function onWindowPopState(event) {
    const nextState = event.state;
    if (runtime.historyExitArmed) {
      runtime.historyExitArmed = false;
      const shouldContinueExit = !nextState || (nextState.__transchat && nextState.screen === "app-root");
      if (shouldContinueExit) {
        setTimeout(() => {
          if (typeof window !== "undefined" && window.history) {
            window.history.back();
          }
        }, 0);
      }
      return;
    }

    if (uiState.activeRoomId) {
      const isRoomState = Boolean(nextState?.__transchat && nextState.screen === "room");
      if (!isRoomState) {
        closeActiveRoomView({ updateHistory: false });
      }
      return;
    }

    const currentUser = getCurrentUser();
    const shouldGuardExit = Boolean(currentUser && uiState.directoryTab === "chat");
    const isChatListState = Boolean(nextState?.__transchat && nextState.screen === "chat-list");
    if (shouldGuardExit && !isChatListState) {
      uiState.modal = { type: "exit-confirm" };
      uiState.previewMedia = null;
      clearProfileCropDrag();
      if (typeof window !== "undefined" && window.history && typeof window.history.pushState === "function") {
        window.history.pushState({ __transchat: true, screen: "chat-list", roomId: null }, "", window.location.href);
      }
      render();
    }
  }

  function captureChatScrollState() {
    const scroll = document.getElementById("chat-scroll");
    if (!(scroll instanceof HTMLElement)) {
      return null;
    }

    const distanceFromBottom = Math.max(0, scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop);
    return {
      roomId: uiState.activeRoomId || null,
      scrollTop: scroll.scrollTop,
      distanceFromBottom,
      anchoredToBottom: distanceFromBottom <= 48,
    };
  }

  function captureSurfaceScrollState() {
    const nextState = {};
    APP_ROOT.querySelectorAll("[data-scroll-key]").forEach((surface) => {
      if (!(surface instanceof HTMLElement)) return;
      const key = String(surface.dataset.scrollKey || "").trim();
      if (!key) return;
      runtime.preservedScrollPositions[key] = surface.scrollTop;
      nextState[key] = surface.scrollTop;
    });
    return nextState;
  }

  function restoreChatScrollState(chatScrollState) {
    const scroll = document.getElementById("chat-scroll");
    if (!(scroll instanceof HTMLElement)) {
      return;
    }

    if (!chatScrollState || chatScrollState.roomId !== (uiState.activeRoomId || null) || chatScrollState.anchoredToBottom) {
      scroll.scrollTop = scroll.scrollHeight;
      runtime.chatPinnedToBottom = true;
      return;
    }

    if (typeof chatScrollState.scrollTop === "number") {
      const maxScrollTop = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
      scroll.scrollTop = Math.max(0, Math.min(chatScrollState.scrollTop, maxScrollTop));
      runtime.chatPinnedToBottom = isScrollNearBottom(scroll);
      return;
    }

    scroll.scrollTop = Math.max(0, scroll.scrollHeight - scroll.clientHeight - chatScrollState.distanceFromBottom);
    runtime.chatPinnedToBottom = isScrollNearBottom(scroll);
  }

  function restoreSurfaceScrollState(surfaceScrollState) {
    APP_ROOT.querySelectorAll("[data-scroll-key]").forEach((surface) => {
      if (!(surface instanceof HTMLElement)) return;
      const key = String(surface.dataset.scrollKey || "").trim();
      if (!key) return;
      const nextScrollTop =
        surfaceScrollState && typeof surfaceScrollState[key] === "number"
          ? surfaceScrollState[key]
          : runtime.preservedScrollPositions[key];
      if (typeof nextScrollTop !== "number") return;
      surface.scrollTop = nextScrollTop;
    });
  }

  function captureFocusState() {
    const active = document.activeElement;
    if (!active || !(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)) {
      return null;
    }

    const parts = [];
    if (active.dataset.input) {
      parts.push(`[data-input="${escapeSelector(active.dataset.input)}"]`);
    } else if (active.name) {
      parts.push(`[name="${escapeSelector(active.name)}"]`);
    } else if (active.id) {
      parts.push(`#${escapeSelector(active.id)}`);
    } else {
      return null;
    }

    if (active.dataset.roomId) {
      parts.push(`[data-room-id="${escapeSelector(active.dataset.roomId)}"]`);
    }

    return {
      selector: parts.join(""),
      selectionStart: typeof active.selectionStart === "number" ? active.selectionStart : null,
      selectionEnd: typeof active.selectionEnd === "number" ? active.selectionEnd : null,
    };
  }

  function restoreFocusState(focusState) {
    if (!focusState?.selector) return;
    const target = APP_ROOT.querySelector(focusState.selector);
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;

    target.focus({ preventScroll: true });
    if (
      typeof focusState.selectionStart === "number" &&
      typeof focusState.selectionEnd === "number" &&
      typeof target.setSelectionRange === "function"
    ) {
      const maxLength = target.value.length;
      const start = Math.min(focusState.selectionStart, maxLength);
      const end = Math.min(focusState.selectionEnd, maxLength);
      target.setSelectionRange(start, end);
    }
  }

  function updateChatLayoutMetrics() {
    const composer = APP_ROOT.querySelector(".mobile-composer");
    const composerInput = composer?.querySelector?.('[data-input="composer"]');
    if (composerInput instanceof HTMLTextAreaElement) {
      autoResizeTextarea(composerInput);
    }
    const composerHeight = composer instanceof HTMLElement ? composer.offsetHeight : 0;
    runtime.composerHeight = composerHeight;
    document.documentElement.style.setProperty("--composer-height", `${composerHeight}px`);
    keepChatBottomVisible();
  }

  function keepChatBottomVisible(force = false) {
    const scroll = document.getElementById("chat-scroll");
    if (!(scroll instanceof HTMLElement)) {
      return;
    }

    if (!(force || runtime.chatPinnedToBottom)) {
      return;
    }

    requestAnimationFrame(() => {
      scroll.scrollTop = scroll.scrollHeight;
      runtime.chatPinnedToBottom = true;
    });
  }

  function onRootScroll(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (target.dataset.scrollKey) {
      runtime.preservedScrollPositions[target.dataset.scrollKey] = target.scrollTop;
    }

    if (target.id !== "chat-scroll") {
      return;
    }
    runtime.chatPinnedToBottom = isScrollNearBottom(target);
    if (runtime.chatPinnedToBottom) {
      scheduleReceiptRefresh({ delay: 30 });
    }
  }

  function onRootFocusIn(event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) || target.dataset.input !== "composer") {
      return;
    }
    const scroll = document.getElementById("chat-scroll");
    runtime.chatPinnedToBottom = isScrollNearBottom(scroll, 120);
    if (runtime.chatPinnedToBottom) {
      keepChatBottomVisible(true);
    }
    scheduleReceiptRefresh({ force: true, delay: 40 });
  }

  function createOptimisticMessageMedia(attachment) {
    if (!attachment) return null;
    return {
      kind: attachment.kind,
      name: attachment.name,
      size: attachment.size,
      mimeType: attachment.mimeType || "",
      storage: "pending",
      mediaId: String(attachment.mediaId || "").trim() || null,
      uploadedAt: Number(attachment.uploadedAt || Date.now()),
      expiresAt: Number(attachment.expiresAt || 0) || null,
      expired: false,
    };
  }

  function escapeSelector(value) {
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
      return CSS.escape(String(value));
    }
    return String(value).replace(/["\\]/g, "\\$&");
  }

  function onRootClick(event) {
    if (event.target instanceof HTMLElement && event.target.classList.contains("modal-layer")) {
      uiState.modal = null;
      uiState.previewMedia = null;
      clearProfileCropDrag();
      render();
      return;
    }
    const actionTarget = event.target.closest("[data-action]");
    if (!actionTarget) return;
    const action = actionTarget.dataset.action;

    if (action === "set-landing-ui-language") {
      const nextLanguage = actionTarget.dataset.language;
      if (nextLanguage) {
        uiState.landing.uiLanguage = nextLanguage;
        localStorage.setItem(LANDING_UI_KEY, nextLanguage);
        render();
      }
      return;
    }
    if (action === "toggle-landing-native-accordion") {
      uiState.landing.nativeAccordionOpen = !uiState.landing.nativeAccordionOpen;
      render();
      return;
    }
    if (action === "toggle-signup-native-accordion") {
      uiState.landing.signupNativeAccordionOpen = !uiState.landing.signupNativeAccordionOpen;
      render();
      return;
    }
    if (action === "select-landing-native-language") {
      const nextLanguage = actionTarget.dataset.language;
      if (nextLanguage) {
        uiState.landing.nativeLanguage = nextLanguage;
        uiState.landing.nativeAccordionOpen = false;
        render();
      }
      return;
    }
    if (action === "select-signup-native-language") {
      const nextLanguage = actionTarget.dataset.language;
      if (nextLanguage) {
        uiState.landing.signupNativeLanguage = nextLanguage;
        uiState.landing.signupNativeAccordionOpen = false;
        render();
      }
      return;
    }
    if (action === "trigger-landing-profile") {
      document.querySelector('[data-input="landing-profile-image"]')?.click();
      return;
    }
    if (action === "open-landing-signup") {
      uiState.landing.mode = "signup";
      uiState.landing.signupId = uiState.landing.signupId || normalizeAccountId(uiState.landing.name);
      uiState.landing.signupQuestionKey = uiState.landing.signupQuestionKey || getRandomRecoveryQuestionKey();
      uiState.landing.error = "";
      render();
      return;
    }
    if (action === "open-landing-reset") {
      uiState.landing.mode = "reset";
      uiState.landing.resetName = uiState.landing.resetName || uiState.landing.name;
      uiState.landing.resetQuestionKey = findUserByLoginName(uiState.landing.resetName)?.recoveryQuestionKey || null;
      uiState.landing.resetAnswer = "";
      uiState.landing.resetPassword = "";
      uiState.landing.resetPasswordConfirm = "";
      uiState.landing.resetVerified = false;
      uiState.landing.error = "";
      render();
      return;
    }
    if (action === "close-landing-panel") {
      resetLandingPanelState();
      uiState.landing.error = "";
      uiState.landing.profileImage = null;
      render();
      return;
    }
    if (action === "submit-landing-signup") {
      submitLandingSignup();
      return;
    }
    if (action === "submit-landing-password-verify") {
      verifyLandingPasswordReset();
      return;
    }
    if (action === "submit-landing-password-update") {
      submitLandingPasswordUpdate();
      return;
    }
    if (action === "go-my-info") {
      const currentUser = getCurrentUser();
      stopTypingForRoom(uiState.activeRoomId);
      if (currentUser) {
        markIncomingInvitesSeen(currentUser.id);
      }
      uiState.directoryTab = "me";
      uiState.activeRoomId = null;
      uiState.chatDetailsOpen = false;
      uiState.attachmentMenuOpen = false;
      markUserPresence(null);
      if (currentUser) {
        persistState();
      }
      render();
      return;
    }
    if (action === "go-connections") {
      const currentUser = getCurrentUser();
      stopTypingForRoom(uiState.activeRoomId);
      uiState.directoryTab = "friends";
      uiState.activeRoomId = null;
      uiState.chatDetailsOpen = false;
      uiState.attachmentMenuOpen = false;
      markUserPresence(null);
      if (currentUser) {
        persistState();
      }
      render();
      return;
    }
    if (action === "switch-directory-tab") {
      const nextTab = actionTarget.dataset.tabId;
      const currentUser = getCurrentUser();
      uiState.directoryTab = nextTab;
      if (currentUser && nextTab === "me") {
        markIncomingInvitesSeen(currentUser.id);
      }
      if (currentUser && nextTab === "chat") {
        markAllChatNotificationsSeen(currentUser.id);
      }
      if (nextTab !== "chat") {
        stopTypingForRoom(uiState.activeRoomId);
        uiState.activeRoomId = null;
        markUserPresence(null);
      }
      if (nextTab !== "chat") {
        uiState.chatDetailsOpen = false;
      }
      uiState.attachmentMenuOpen = false;
      if (currentUser && (nextTab === "me" || nextTab === "chat")) {
        persistState();
      }
      render();
      return;
    }
    if (action === "open-search") {
      uiState.modal = { type: "search" };
      uiState.chatDetailsOpen = false;
      render();
      return;
    }
    if (action === "back-to-chat-list") {
      handleRoomBackNavigation();
      return;
    }
    if (action === "confirm-exit-app") {
      confirmExitApp();
      return;
    }
    if (action === "toggle-chat-details") {
      uiState.chatDetailsOpen = !uiState.chatDetailsOpen;
      render();
      return;
    }
    if (action === "toggle-attachment-menu") {
      uiState.attachmentMenuOpen = !uiState.attachmentMenuOpen;
      render();
      return;
    }
    if (action === "set-translation-concept") {
      const roomId = actionTarget.dataset.roomId;
      const concept = normalizeTranslationConcept(actionTarget.dataset.concept);
      const currentUser = getCurrentUser();
      if (!roomId || !currentUser) return;
      currentUser.preferredTranslationConcept = concept;
      setDraft(roomId, { translationConcept: concept });
      persistState();
      render();
      return;
    }
    if (action === "close-chat-details") {
      uiState.chatDetailsOpen = false;
      render();
      return;
    }
    if (action === "open-modal") {
      uiState.chatDetailsOpen = false;
      uiState.attachmentMenuOpen = false;
      openModal(actionTarget.dataset.modal);
      return;
    }
    if (action === "pick-image-source") {
      const roomId = actionTarget.dataset.roomId || uiState.modal?.data?.roomId || uiState.activeRoomId || "";
      const source = actionTarget.dataset.source === "camera" ? "camera-image-file" : "image-file";
      uiState.modal = null;
      render();
      if (roomId) {
        window.setTimeout(() => {
          triggerHiddenInput(source, roomId);
        }, 30);
      }
      return;
    }
    if (action === "close-modal") {
      uiState.modal = null;
      uiState.previewMedia = null;
      clearProfileCropDrag();
      render();
      return;
    }
    if (action === "submit-profile-image-crop") {
      void submitProfileImageCrop();
      return;
    }
    if (action === "open-drawer") {
      uiState.drawer = actionTarget.dataset.drawer;
      render();
      return;
    }
    if (action === "close-drawer") {
      uiState.drawer = null;
      render();
      return;
    }
    if (action === "toggle-mobile-rooms") {
      uiState.mobileRoomsOpen = !uiState.mobileRoomsOpen;
      render();
      return;
    }
    if (action === "submit-create-room") {
      handleCreateRoom();
      return;
    }
    if (action === "submit-room-settings") {
      handleRoomSettingsSubmit();
      return;
    }
    if (action === "open-room") {
      if (uiState.modal?.type === "search") {
        uiState.modal = null;
      }
      handleOpenRoom(actionTarget.dataset.roomId);
      return;
    }
    if (action === "submit-password") {
      handlePasswordSubmit();
      return;
    }
    if (action === "leave-room") {
      const roomId = actionTarget.dataset.roomId;
      const room = appState.rooms.find((item) => item.id === roomId);
      const currentUser = getCurrentUser();
      if (room && currentUser && room.creatorId === currentUser.id) {
        const confirmed = window.confirm(t("roomDeleteConfirm", { title: room.title }));
        if (!confirmed) return;
      }
      leaveRoom(roomId);
      return;
    }
    if (action === "toggle-original") {
      const messageId = actionTarget.dataset.messageId;
      uiState.originalVisibility[messageId] = !uiState.originalVisibility[messageId];
      render();
      return;
    }
    if (action === "send-message") {
      handleSendMessage(actionTarget.dataset.roomId);
      return;
    }
    if (action === "trigger-image") {
      uiState.attachmentMenuOpen = false;
      uiState.modal = {
        type: "image-source",
        data: { roomId: actionTarget.dataset.roomId || uiState.activeRoomId || "" },
      };
      render();
      return;
    }
    if (action === "trigger-video") {
      uiState.attachmentMenuOpen = false;
      triggerHiddenInput("video-file", actionTarget.dataset.roomId);
      return;
    }
    if (action === "trigger-file") {
      uiState.attachmentMenuOpen = false;
      triggerHiddenInput("generic-file", actionTarget.dataset.roomId);
      return;
    }
    if (action === "remove-attachment") {
      const roomId = uiState.activeRoomId;
      if (roomId) {
        const attachment = getDraft(roomId).attachment;
        releaseDraftAttachment(attachment);
        setDraft(roomId, { attachment: null });
        uiState.attachmentMenuOpen = false;
        pushToast("toastAttachmentRemoved", "toastAttachmentRemovedCopy");
        render();
      }
      return;
    }
    if (action === "preview-draft-media") {
      const roomId = uiState.activeRoomId;
      if (roomId) {
        uiState.previewMedia = getDraft(roomId).attachment;
        uiState.modal = { type: "media" };
        render();
      }
      return;
    }
    if (action === "submit-invite") {
      handleInviteSubmit();
      return;
    }
    if (action === "trigger-profile-image") {
      document.querySelector('[data-input="my-profile-image"]')?.click();
      return;
    }
    if (action === "remove-profile-image") {
      const currentUser = getCurrentUser();
      if (currentUser) {
        currentUser.profileImage = null;
        persistState();
        flushServerStateSync();
        pushToast("toastProfileImageRemoved", "toastProfileImageRemovedCopy");
        render();
      }
      return;
    }
    if (action === "save-basic-profile") {
      saveBasicProfile();
      return;
    }
    if (action === "request-push-permission") {
      void requestPushPermissionAndRegister();
      return;
    }
    if (action === "trigger-pwa-install") {
      void triggerPwaInstallFlow();
      return;
    }
    if (action === "open-profile-preview") {
      const friend = appState.users.find((user) => user.id === actionTarget.dataset.userId);
      uiState.modal = {
        type: "profile-preview",
        data: {
          userId: actionTarget.dataset.userId,
          editName: friend?.name || "",
          editGender: friend?.gender || "",
          editAge: friend?.age || "",
          editPassword: friend?.password || "",
        },
      };
      render();
      return;
    }
    if (action === "open-profile-image-view") {
      const friend = appState.users.find((user) => user.id === actionTarget.dataset.userId);
      if (!friend) return;
      uiState.modal = {
        type: "profile-image-view",
        data: {
          userId: friend.id,
          name: getUserDisplayName(friend) || friend.loginId || friend.name,
          image: getUserProfileImage(friend),
        },
      };
      clearProfileCropDrag();
      render();
      return;
    }
    if (action === "save-admin-profile") {
      const currentUser = getCurrentUser();
      const targetUser = appState.users.find((user) => user.id === actionTarget.dataset.userId);
      if (!isAdminUser(currentUser) || !targetUser || isAdminUser(targetUser)) {
        return;
      }
      const nextName = normalizeDisplayText(uiState.modal?.data?.editName || "").trim();
      const nextGender = uiState.modal?.data?.editGender === "male" || uiState.modal?.data?.editGender === "female"
        ? uiState.modal.data.editGender
        : "";
      const nextAge = Math.max(0, Math.min(120, Number(uiState.modal?.data?.editAge || 0) || 0)) || "";
      const nextPassword = String(uiState.modal?.data?.editPassword || "").trim();

      if (nextName) {
        targetUser.name = nextName;
      }
      targetUser.gender = nextGender;
      targetUser.age = nextAge;
      if (nextPassword) {
        targetUser.password = nextPassword;
      }
      applySpecialUserFlags(targetUser);
      persistState();
      uiState.modal = null;
      render();
      return;
    }
    if (action === "admin-delete-user") {
      const currentUser = getCurrentUser();
      const userId = actionTarget.dataset.userId;
      const targetUser = appState.users.find((user) => user.id === userId);
      if (!isAdminUser(currentUser) || !targetUser) return;
      if (isAdminUser(targetUser)) {
        pushToast("toastAdminSelfDeleteBlocked", "toastAdminSelfDeleteBlockedCopy");
        render();
        return;
      }
      const confirmed = window.confirm(t("adminAccountDeleteConfirm"));
      if (!confirmed) return;
      deleteUserAccount(userId);
      persistState();
      pushToast("toastAccountDeleted", "toastAccountDeletedCopy", { name: targetUser.name || targetUser.loginId });
      render();
      return;
    }
    if (action === "send-connection-invite") {
      sendConnectionInvite(actionTarget.dataset.userId);
      return;
    }
    if (action === "respond-invite") {
      respondInvite(actionTarget.dataset.inviteId, actionTarget.dataset.response);
      return;
    }
    if (action === "quick-invite") {
      const activeRoom = appState.rooms.find((room) => room.id === uiState.activeRoomId && room.status === "active");
      if (!activeRoom) {
        pushToast("toastNeedRoom", "toastNeedRoomCopy");
        render();
        return;
      }
      uiState.modal = {
        type: "invite",
        data: { name: actionTarget.dataset.friendName || "", error: "" },
      };
      render();
      return;
    }
    if (action === "open-media") {
      openMessageMedia(actionTarget.dataset.messageId);
      return;
    }
    if (action === "set-theme") {
      appState.settings.theme = actionTarget.dataset.theme;
      persistState();
      render();
      return;
    }
    if (action === "logout-current-user") {
      logoutCurrentUser();
      return;
    }
  }

  function onRootInput(event) {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.dataset.input === "landing-auto-login") {
      uiState.landing.autoLogin = target.checked;
      return;
    }
    if (target instanceof HTMLInputElement && target.name === "name" && target.closest('[data-form="landing"]')) {
      uiState.landing.name = target.value;
      uiState.landing.error = "";
      return;
    }
    if (target instanceof HTMLInputElement && target.name === "password" && target.closest('[data-form="landing"]')) {
      uiState.landing.password = target.value;
      uiState.landing.error = "";
      return;
    }
    if (target instanceof HTMLInputElement && target.dataset.input === "signup-id") {
      uiState.landing.signupId = target.value;
      uiState.landing.error = "";
      return;
    }
    if (target instanceof HTMLInputElement && target.dataset.input === "signup-name") {
      uiState.landing.signupName = target.value;
      uiState.landing.error = "";
      return;
    }
    if (target instanceof HTMLInputElement && target.dataset.input === "signup-password") {
      uiState.landing.signupPassword = target.value;
      uiState.landing.error = "";
      return;
    }
    if (target instanceof HTMLInputElement && target.dataset.input === "signup-password-confirm") {
      uiState.landing.signupPasswordConfirm = target.value;
      uiState.landing.error = "";
      return;
    }
    if (target instanceof HTMLInputElement && target.dataset.input === "signup-answer") {
      uiState.landing.signupAnswer = target.value;
      uiState.landing.error = "";
      return;
    }
    if (target instanceof HTMLInputElement && target.dataset.input === "reset-name") {
      uiState.landing.resetName = target.value;
      uiState.landing.resetQuestionKey = findUserByLoginName(target.value)?.recoveryQuestionKey || null;
      uiState.landing.resetVerified = false;
      uiState.landing.error = "";
      return;
    }
    if (target instanceof HTMLInputElement && target.dataset.input === "reset-answer") {
      uiState.landing.resetAnswer = target.value;
      uiState.landing.error = "";
      return;
    }
    if (target instanceof HTMLInputElement && target.dataset.input === "reset-password") {
      uiState.landing.resetPassword = target.value;
      uiState.landing.error = "";
      return;
    }
    if (target instanceof HTMLInputElement && target.dataset.input === "reset-password-confirm") {
      uiState.landing.resetPasswordConfirm = target.value;
      uiState.landing.error = "";
      return;
    }
    if (target instanceof HTMLInputElement && (target.closest('form[data-form="create-room"]') || target.closest('form[data-form="room-settings"]'))) {
      if (uiState.modal?.type === "create-room" || uiState.modal?.type === "room-settings") {
        if (!uiState.modal.data) uiState.modal.data = {};
        uiState.modal.data[target.name] = target.value;
      }
      return;
    }
    if (target.dataset.input === "room-search") {
      uiState.roomSearch = target.value;
      if (runtime.compositionActive) {
        runtime.pendingRenderWhileComposing = true;
        return;
      }
      render();
      return;
    }
    if (target instanceof HTMLInputElement && target.dataset.input === "my-profile-age") {
      uiState.profileEditor.age = target.value;
      return;
    }
    if (target instanceof HTMLInputElement && target.dataset.input === "admin-profile-name" && uiState.modal?.type === "profile-preview") {
      uiState.modal.data.editName = target.value;
      return;
    }
    if (target instanceof HTMLInputElement && target.dataset.input === "admin-profile-age" && uiState.modal?.type === "profile-preview") {
      uiState.modal.data.editAge = target.value;
      return;
    }
    if (target instanceof HTMLInputElement && target.dataset.input === "admin-profile-password" && uiState.modal?.type === "profile-preview") {
      uiState.modal.data.editPassword = target.value;
      return;
    }
    if (target.dataset.input === "composer") {
      const roomId = target.dataset.roomId;
      runtime.lastComposerInputAt = Date.now();
      setDraft(roomId, { text: target.value });
      if (target instanceof HTMLTextAreaElement) {
        autoResizeTextarea(target);
      }
      handleComposerActivity(roomId, target.value);
      return;
    }
    if (target.dataset.input === "password-modal" && uiState.modal) {
      uiState.modal.data.password = target.value;
      return;
    }
    if (target.dataset.input === "invite-name" && uiState.modal) {
      uiState.modal.data.name = target.value;
      uiState.modal.data.error = "";
    }
  }

  async function onRootChange(event) {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.dataset.input === "landing-auto-login") {
      uiState.landing.autoLogin = target.checked;
      return;
    }
    if (target.matches('select[name="nativeLanguage"]')) {
      uiState.landing.nativeLanguage = target.value;
      return;
    }
    if (target.matches('select[name="uiLanguage"]')) {
      uiState.landing.uiLanguage = target.value;
      localStorage.setItem(LANDING_UI_KEY, target.value);
      render();
      return;
    }
    if (target.dataset.input === "settings-ui-language") {
      const currentUser = getCurrentUser();
      if (currentUser) {
        currentUser.uiLanguage = target.value;
        localStorage.setItem(LANDING_UI_KEY, target.value);
        persistState();
        render();
      }
      return;
    }
    if (target.dataset.input === "settings-native-language") {
      const currentUser = getCurrentUser();
      if (currentUser) {
        currentUser.nativeLanguage = target.value;
        currentUser.preferredChatLanguage = target.value;
        persistState();
        render();
      }
      return;
    }
    if (target.dataset.input === "switch-user") {
      if (target.value) {
        switchUser(target.value);
      }
      return;
    }
    if (target.dataset.input === "landing-profile-image") {
      const [file] = target.files || [];
      if (file) {
        try {
          uiState.landing.profileImage = await prepareProfileImage(file);
          uiState.landing.error = "";
          render();
        } catch (error) {
          pushToast(error.titleKey || "toastProfileImageInvalid", error.messageKey || "toastProfileImageInvalidCopy");
          render();
        }
      }
      target.value = "";
      return;
    }
    if (target.dataset.input === "my-profile-image") {
      const currentUser = getCurrentUser();
      const [file] = target.files || [];
      if (currentUser && file) {
        try {
          currentUser.profileImage = await prepareProfileImage(file);
          persistState();
          flushServerStateSync();
          pushToast("toastProfileImageUpdated", "toastProfileImageUpdatedCopy");
          render();
        } catch (error) {
          pushToast(error.titleKey || "toastProfileImageInvalid", error.messageKey || "toastProfileImageInvalidCopy");
          render();
        }
      }
      target.value = "";
      return;
    }
    if (target.dataset.input === "my-profile-gender") {
      uiState.profileEditor.gender = target.value;
      return;
    }
    if (target.dataset.input === "admin-profile-gender" && uiState.modal?.type === "profile-preview") {
      uiState.modal.data.editGender = target.value;
      return;
    }
    if (target.dataset.input === "image-file") {
      const [file] = target.files || [];
      if (file) {
        await handleImageSelection(target.dataset.roomId, file);
      }
      target.value = "";
      return;
    }
    if (target.dataset.input === "camera-image-file") {
      const [file] = target.files || [];
      if (file) {
        await handleImageSelection(target.dataset.roomId, file);
      }
      target.value = "";
      return;
    }
    if (target.dataset.input === "video-file") {
      const [file] = target.files || [];
      if (file) {
        await handleVideoSelection(target.dataset.roomId, file);
      }
      target.value = "";
      return;
    }
    if (target.dataset.input === "generic-file") {
      const [file] = target.files || [];
      if (file) {
        handleGenericFileSelection(target.dataset.roomId, file);
      }
      target.value = "";
    }
  }

  function onRootKeyDown(event) {
    const target = event.target;
    if (event.key === "Escape" && uiState.modal) {
      uiState.modal = null;
      uiState.previewMedia = null;
      render();
      return;
    }
    if (
      target instanceof HTMLInputElement &&
      ["signup-id", "signup-name", "signup-password"].includes(target.dataset.input) &&
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.isComposing
    ) {
      event.preventDefault();
      submitLandingSignup();
      return;
    }
    if (
      target instanceof HTMLInputElement &&
      ["reset-name", "reset-answer"].includes(target.dataset.input) &&
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.isComposing &&
      !uiState.landing.resetVerified
    ) {
      event.preventDefault();
      verifyLandingPasswordReset();
      return;
    }
    if (
      target instanceof HTMLInputElement &&
      ["reset-password", "reset-password-confirm"].includes(target.dataset.input) &&
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.isComposing &&
      uiState.landing.resetVerified
    ) {
      event.preventDefault();
      submitLandingPasswordUpdate();
      return;
    }
    if (
      target instanceof HTMLInputElement &&
      target.dataset.input === "my-profile-age" &&
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.isComposing
    ) {
      event.preventDefault();
      saveBasicProfile();
      return;
    }
    if (
      (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) &&
      target.dataset.input === "composer" &&
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.isComposing
    ) {
      event.preventDefault();
      handleSendMessage(target.dataset.roomId);
    }
  }

  function onRootCompositionStart(event) {
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      runtime.compositionActive = true;
      runtime.compositionTarget = target.dataset.input || target.name || target.id || null;
      if (target.dataset.input === "composer") {
        runtime.lastComposerInputAt = Date.now();
      }
    }
  }

  function onRootCompositionUpdate(event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
      return;
    }

    runtime.compositionActive = true;
    runtime.compositionTarget = target.dataset.input || target.name || target.id || null;
    if (target.dataset.input === "composer") {
      runtime.lastComposerInputAt = Date.now();
      setDraft(target.dataset.roomId, { text: target.value });
    }
    if (target.dataset.input === "room-search") {
      uiState.roomSearch = target.value;
    }
  }

  function onRootCompositionEnd(event) {
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      runtime.compositionActive = false;
      runtime.compositionTarget = null;
      if (target.dataset.input === "room-search") {
        uiState.roomSearch = target.value;
      } else if (target.dataset.input === "my-profile-age") {
        uiState.profileEditor.age = target.value;
      }
    }
    if ((target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) && target.dataset.input === "composer") {
      setDraft(target.dataset.roomId, { text: target.value });
    }
    if (runtime.pendingRenderWhileComposing) {
      runtime.pendingRenderWhileComposing = false;
      render();
    }
  }

  function onRootSubmit(event) {
    event.preventDefault();
    const form = event.target;
    if (form.dataset.form === "landing") {
      const formData = new FormData(form);
      uiState.landing.name = String(formData.get("name") || "").trim();
      uiState.landing.password = String(formData.get("password") || "");
      uiState.landing.autoLogin = Boolean(formData.get("autoLogin"));
      enterLandingUser();
      return;
    }
    if (form.dataset.form === "landing-signup") {
      submitLandingSignup();
      return;
    }
    if (form.dataset.form === "landing-reset") {
      if (uiState.landing.resetVerified) {
        submitLandingPasswordUpdate();
      } else {
        verifyLandingPasswordReset();
      }
    }
  }

  function openModal(type) {
    if (type === "create-room") {
      uiState.modal = { type, data: { title: "", password: "" } };
    } else if (type === "room-settings") {
      const currentRoom = appState.rooms.find((item) => item.id === uiState.activeRoomId);
      uiState.modal = {
        type,
        data: {
          title: currentRoom?.title || "",
          password: currentRoom?.password || "",
        },
      };
    } else if (type === "invite") {
      uiState.modal = { type, data: { name: "", error: "" } };
    } else if (type === "participants") {
      uiState.modal = { type };
    } else if (type === "plan") {
      uiState.modal = { type };
    }
    render();
  }

  function triggerHiddenInput(type, roomId) {
    const input = document.querySelector(`[data-input="${type}"][data-room-id="${roomId}"]`);
    input?.click();
  }

  function getComposerInput(roomId) {
    return APP_ROOT.querySelector(`[data-input="composer"][data-room-id="${roomId}"]`);
  }

  function getComposerValue(roomId) {
    const input = getComposerInput(roomId);
    if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
      return input.value;
    }
    return getDraft(roomId).text || "";
  }

  function autoResizeTextarea(textarea) {
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
  }

  function generateUniqueUserName(baseName) {
    const taken = new Set(appState.users.map((user) => user.name));
    if (!taken.has(baseName)) return baseName;
    let suffix = 0;
    while (taken.has(`${baseName}${suffix}`)) {
      suffix += 1;
    }
    return `${baseName}${suffix}`;
  }

  function saveBasicProfile() {
    const currentUser = getCurrentUser();
    if (!currentUser) return;

    currentUser.gender =
      uiState.profileEditor.gender === "male" || uiState.profileEditor.gender === "female"
        ? uiState.profileEditor.gender
        : "";
    currentUser.age = Math.max(0, Math.min(120, Number(uiState.profileEditor.age || 0) || 0)) || "";
    uiState.profileEditor.gender = currentUser.gender;
    uiState.profileEditor.age = currentUser.age;
    persistState();
    pushToast("toastProfileSaved", "authProfileSavedCopy");
    render();
  }

  function findUserByLoginName(name, sourceUsers = appState.users) {
    const normalized = normalizeAccountId(name);
    if (!normalized) return null;
    return (sourceUsers || [])
      .filter((user) => normalizeAccountId(user.loginId || user.name) === normalized)
      .sort((a, b) => getUserIdentityScore(b) - getUserIdentityScore(a))[0] || null;
  }

  function resetLandingPanelState() {
    uiState.landing.mode = "login";
    uiState.landing.signupId = "";
    uiState.landing.signupPassword = "";
    uiState.landing.signupName = "";
    uiState.landing.signupQuestionKey = null;
    uiState.landing.signupAnswer = "";
    uiState.landing.signupNativeLanguage = "ko";
    uiState.landing.signupNativeAccordionOpen = false;
    uiState.landing.resetName = "";
    uiState.landing.resetQuestionKey = null;
    uiState.landing.resetAnswer = "";
    uiState.landing.resetPassword = "";
    uiState.landing.resetPasswordConfirm = "";
    uiState.landing.resetVerified = false;
  }

  function completeLandingLogin(user, options = {}) {
    if (!user) return;
    const now = Date.now();
    const defaultLanguage = uiState.landing.uiLanguage === "vi" ? "vi" : "ko";
    const nextUiLanguage = options.preserveStoredUiLanguage ? user.uiLanguage || uiState.landing.uiLanguage || "ko" : uiState.landing.uiLanguage;
    const shouldRemember = options.autoLogin ?? uiState.landing.autoLogin;

    applySpecialUserFlags(user);
    user.name = normalizeDisplayText(user.name).trim();
    user.loginId = normalizeAccountId(user.loginId || user.name);
    user.uiLanguage = nextUiLanguage;
    user.nativeLanguage = user.nativeLanguage || defaultLanguage;
    user.preferredChatLanguage = user.preferredChatLanguage || user.nativeLanguage;
    if (options.useLandingProfile && uiState.landing.profileImage) {
      user.profileImage = uiState.landing.profileImage;
    }
    user.auth = {
      provider: user?.auth?.provider || "local",
      subject: normalizeAccountId(user.loginId || user.name),
      email: user?.auth?.email || null,
      phoneNumber: user?.auth?.phoneNumber || null,
      phoneVerified: Boolean(user?.auth?.phoneVerified),
    };
    user.lastSeenAt = now;
    user.lastLoginAt = now;
    user.loginState = "online";

    setActiveUserId(user.id);
    syncAutoLoginPreference(user, shouldRemember);
    localStorage.setItem(LANDING_UI_KEY, user.uiLanguage);
    uiState.activeRoomId = user.currentRoomId || null;
    uiState.directoryTab = "chat";
    uiState.chatDetailsOpen = false;
    uiState.attachmentMenuOpen = false;
    uiState.mobileRoomsOpen = false;
    uiState.landing.name = user.loginId || user.name;
    uiState.landing.password = "";
    uiState.landing.autoLogin = shouldRemember;
    uiState.landing.nativeAccordionOpen = false;
    uiState.landing.profileImage = null;
    uiState.landing.error = "";
    resetLandingPanelState();
    uiState.profileEditor = {
      userId: user.id,
      name: user.name,
      nickname: user.nickname || "",
      gender: user.gender || "",
      age: user.age || "",
    };
    persistState();
    markUserPresence(user.currentRoomId || null);
    if (options.toastKey) {
      pushToast(options.toastKey, options.toastCopyKey || "toastEnterCopy", { name: getUserDisplayName(user) || user.loginId || user.name });
    }
    render();
    void registerPushTokenForCurrentUser();
    void syncNativePushBindingForCurrentUser({ force: true });
    flushPendingPushNavigation();
  }

  function enterLandingUser() {
    const baseId = normalizeAccountId(uiState.landing.name);
    const password = String(uiState.landing.password || "");
    if (!baseId) return;
    const existingUser = findUserByLoginName(baseId);
    if (!existingUser) {
      uiState.landing.error = t("authLoginNotFound");
      render();
      return;
    }

    if (String(existingUser.password || "") !== password) {
      uiState.landing.error = t("authLoginPasswordMismatch");
      render();
      return;
    }

    completeLandingLogin(existingUser);
  }

  function submitLandingSignup() {
    const signupId = normalizeAccountId(uiState.landing.signupId);
    const password = String(uiState.landing.signupPassword || "");
    const realName = normalizeDisplayText(uiState.landing.signupName).trim();
    const defaultLanguage = uiState.landing.uiLanguage === "vi" ? "vi" : "ko";

    if (!signupId) {
      uiState.landing.error = t("authNeedId");
      render();
      return;
    }
    if (!realName) {
      uiState.landing.error = t("authSignupNameRequired");
      render();
      return;
    }
    if (!isValidSignupLoginId(signupId)) {
      openNoticeModal("authInvalidIdTitle", "authInvalidIdCopy");
      render();
      return;
    }
    if (!isValidSignupPassword(password)) {
      openNoticeModal("authInvalidPasswordTitle", "authInvalidPasswordCopy");
      render();
      return;
    }
    if (!uiState.landing.signupQuestionKey || !uiState.landing.signupAnswer.trim()) {
      uiState.landing.error = t("authNeedRecoveryAnswer");
      render();
      return;
    }
    if (findUserByLoginName(signupId)) {
      uiState.landing.error = t("authSignupDuplicate");
      render();
      return;
    }

    const user = createUser(
      realName,
      uiState.landing.signupNativeLanguage || defaultLanguage,
      uiState.landing.uiLanguage,
      Date.now(),
      null,
      uiState.landing.profileImage || null,
      {
        loginId: signupId,
        password,
        recoveryQuestionKey: uiState.landing.signupQuestionKey,
        recoveryQuestion: uiState.landing.signupQuestionKey,
        recoveryAnswer: uiState.landing.signupAnswer,
        loginState: "online",
        lastLoginAt: Date.now(),
        nickname: "",
        gender: "",
        age: "",
      }
    );
    appState.users.push(user);
    uiState.landing.name = user.loginId || user.name;
    uiState.landing.password = "";
    completeLandingLogin(user, {
      toastKey: "toastSignupSuccess",
      toastCopyKey: "toastSignupSuccessCopy",
      useLandingProfile: true,
    });
  }

  function verifyLandingPasswordReset() {
    const baseName = normalizeAccountId(uiState.landing.resetName);
    const answer = normalizeRecoveryAnswer(uiState.landing.resetAnswer);
    const user = findUserByLoginName(baseName);

    if (!baseName) {
      uiState.landing.error = t("authNeedId");
      render();
      return;
    }
    if (!user) {
      uiState.landing.error = t("authLoginNotFound");
      render();
      return;
    }
    if (!answer) {
      uiState.landing.error = t("authNeedRecoveryAnswer");
      render();
      return;
    }
    if (answer !== normalizeRecoveryAnswer(user.recoveryAnswer)) {
      uiState.landing.error = t("authRecoveryMismatch");
      render();
      return;
    }

    uiState.landing.resetName = user.loginId || user.name;
    uiState.landing.resetQuestionKey = user.recoveryQuestionKey;
    uiState.landing.resetVerified = true;
    uiState.landing.error = "";
    render();
  }

  function submitLandingPasswordUpdate() {
    const baseName = normalizeAccountId(uiState.landing.resetName);
    const nextPassword = String(uiState.landing.resetPassword || "");
    const nextPasswordConfirm = String(uiState.landing.resetPasswordConfirm || "");
    const user = findUserByLoginName(baseName);

    if (!user) {
      uiState.landing.error = t("authLoginNotFound");
      render();
      return;
    }
    if (!uiState.landing.resetVerified) {
      uiState.landing.error = t("authRecoveryMismatch");
      render();
      return;
    }
    if (!nextPassword) {
      uiState.landing.error = t("authNeedPassword");
      render();
      return;
    }
    if (!isValidSignupPassword(nextPassword)) {
      openNoticeModal("authInvalidPasswordTitle", "authInvalidPasswordCopy");
      render();
      return;
    }
    if (nextPassword !== nextPasswordConfirm) {
      uiState.landing.error = t("authPasswordMismatch");
      render();
      return;
    }

    user.password = nextPassword;
    user.lastLoginAt = user.lastLoginAt || Date.now();
    uiState.landing.name = user.loginId || user.name;
    uiState.landing.password = "";
    uiState.landing.error = "";
    resetLandingPanelState();
    persistState();
    pushToast("toastPasswordUpdated", "toastPasswordUpdatedCopy");
    render();
  }

  function markUserPresence(roomId) {
    const currentUser = getCurrentUser();
    if (!currentUser) return;
    const now = Date.now();
    if (arguments.length >= 1) {
      currentUser.currentRoomId = roomId || null;
    }
    const effectiveRoomId = currentUser.currentRoomId || null;
    currentUser.lastSeenAt = now;
    currentUser.loginState = "online";
    runtime.presenceSignals[currentUser.id] = {
      userId: currentUser.id,
      currentRoomId: effectiveRoomId,
      lastSeenAt: now,
      loginState: "online",
    };
    persistPresenceSnapshotIfNeeded(now);
    sendPresenceSignal(effectiveRoomId, { loginState: "online", lastSeenAt: now });
  }

  function persistPresenceSnapshotIfNeeded(timestamp = Date.now(), options = {}) {
    const currentUser = getCurrentUser();
    if (!currentUser) return;
    if (!options.force && timestamp - runtime.lastPresencePersistAt < CONFIG.heartbeatMs) {
      return;
    }
    runtime.lastPresencePersistAt = timestamp;
    currentUser.lastSeenAt = timestamp;
    if (options.offline) {
      currentUser.loginState = "offline";
      currentUser.currentRoomId = null;
    } else {
      currentUser.loginState = "online";
      if (Object.prototype.hasOwnProperty.call(options, "roomId")) {
        currentUser.currentRoomId = options.roomId || null;
      }
    }
    runtime.presenceSignals[currentUser.id] = {
      userId: currentUser.id,
      currentRoomId: currentUser.currentRoomId || null,
      lastSeenAt: timestamp,
      loginState: currentUser.loginState,
    };
    persistState({ syncToServer: false, touchUpdatedAt: false });
  }

  function switchUser(userId) {
    stopTypingForRoom(uiState.activeRoomId);
    const previousUser = getCurrentUser();
    const user = appState.users.find((item) => item.id === userId);
    if (!user) {
      pushToast("toastNoUserSwitch", "toastNoUserSwitchCopy");
      return;
    }
    setActiveUserId(user.id);
    localStorage.setItem(LANDING_UI_KEY, user.uiLanguage);
    uiState.drawer = null;
    uiState.modal = null;
    uiState.chatDetailsOpen = false;
    uiState.attachmentMenuOpen = false;
    uiState.activeRoomId = user.currentRoomId || null;
    uiState.directoryTab = "chat";
    uiState.profileEditor = {
      userId: user.id,
      name: user.name,
      nickname: user.nickname || "",
      gender: user.gender || "",
      age: user.age || "",
    };
    markUserPresence(user.currentRoomId || null);
    pushToast("toastUserSwitched", "toastUserSwitchedCopy", { name: user.name });
    render();
    void (async () => {
      if (previousUser && previousUser.id !== user.id) {
        await unregisterPushTokenForUser(previousUser);
        await unbindNativePushInstallForUser(previousUser);
      }
      await requestPushRegistrationRefresh();
      await syncNativePushBindingForCurrentUser({ force: true });
    })();
  }

  function handleCreateRoom() {
    const titleInput = document.querySelector('form[data-form="create-room"] input[name="title"]');
    const passwordInput = document.querySelector('form[data-form="create-room"] input[name="password"]');
    const title = normalizeDisplayText(titleInput?.value).trim();
    const password = String(passwordInput?.value || "").trim();
    if (!title || !password) return;
    const currentUser = getCurrentUser();
    if (!currentUser) return;

    const room = {
      id: uid("room"),
      title,
      creatorId: currentUser.id,
      password,
      isProtected: true,
      disableExpiration: isPersistentRoomTitle(title),
      participants: [currentUser.id],
      accessByUser: { [currentUser.id]: true },
      unreadByUser: {},
      lastMessageAt: Date.now(),
      createdAt: Date.now(),
      status: "active",
      expiredAt: null,
      messages: [systemMessage(uid("sys"), "systemUserJoined", { name: currentUser.name }, Date.now())],
    };
    appState.rooms.unshift(room);
    currentUser.currentRoomId = room.id;
    uiState.activeRoomId = room.id;
    uiState.directoryTab = "chat";
    uiState.chatDetailsOpen = false;
    uiState.attachmentMenuOpen = false;
    uiState.modal = null;
    persistState();
    pushToast("toastRoomCreated", "toastRoomCreatedCopy", { title });
    render();
  }

  function handleRoomSettingsSubmit() {
    const currentUser = getCurrentUser();
    const room = appState.rooms.find((item) => item.id === uiState.activeRoomId);
    const titleInput = document.querySelector('form[data-form="room-settings"] input[name="title"]');
    const passwordInput = document.querySelector('form[data-form="room-settings"] input[name="password"]');
    if (!currentUser || !room || room.creatorId !== currentUser.id) return;

    const nextTitle = normalizeDisplayText(titleInput?.value || room.title).trim() || room.title;
    const nextPassword = String(passwordInput?.value || "").trim();

    room.title = nextTitle;
    room.password = nextPassword;
    room.isProtected = Boolean(nextPassword);
    room.disableExpiration = Boolean(room.disableExpiration) || isPersistentRoomTitle(nextTitle);
    uiState.modal = null;
    uiState.chatDetailsOpen = false;
    persistState();
    pushToast("toastRoomSettingsSaved", "toastRoomSettingsSavedCopy", { title: nextTitle });
    render();
  }

  function ensureParticipant(room, userId, addSystemMessage = true) {
    if (room.participants.includes(userId)) return;
    room.participants.push(userId);
    if (addSystemMessage) {
      const user = appState.users.find((item) => item.id === userId);
      room.messages.push(systemMessage(uid("sys"), "systemUserJoined", { name: user?.name || "" }, Date.now()));
    }
  }

  function getRemainingRoomParticipantIds(room, excludedUserId = "") {
    const excluded = String(excludedUserId || "").trim();
    return deriveRoomParticipantIds(room).filter((participantId) => participantId && participantId !== excluded);
  }

  function transferRoomOwnershipIfNeeded(room, departingUserId) {
    if (!room || room.creatorId !== departingUserId) {
      return {
        deleted: false,
        transferredTo: "",
      };
    }

    const remainingParticipantIds = getRemainingRoomParticipantIds(room, departingUserId);
    if (!remainingParticipantIds.length) {
      deleteRoom(room.id);
      return {
        deleted: true,
        transferredTo: "",
      };
    }

    room.creatorId = remainingParticipantIds[0];
    return {
      deleted: false,
      transferredTo: room.creatorId,
    };
  }

  function markRoomRead(roomId, userId) {
    const room = appState.rooms.find((item) => item.id === roomId);
    if (!room) return;
    if (!room.unreadByUser) room.unreadByUser = {};
    room.unreadByUser[userId] = 0;
  }

  function handleOpenRoom(roomId) {
    if (uiState.activeRoomId && uiState.activeRoomId !== roomId) {
      stopTypingForRoom(uiState.activeRoomId);
    }
    const room = appState.rooms.find((item) => item.id === roomId);
    const currentUser = getCurrentUser();
    if (!room || !currentUser) return;

    if (room.status === "expired") {
      uiState.activeRoomId = room.id;
      currentUser.currentRoomId = null;
      persistState();
      render();
      return;
    }

    if (room.isProtected && !isRoomUnlockedForUser(room, currentUser.id)) {
      uiState.modal = {
        type: "password",
        data: { roomId, password: "", error: "" },
      };
      render();
      return;
    }

    ensureParticipant(room, currentUser.id);
    currentUser.currentRoomId = room.id;
    currentUser.lastSeenAt = Date.now();
    uiState.activeRoomId = room.id;
    uiState.directoryTab = "chat";
    uiState.chatDetailsOpen = false;
    uiState.attachmentMenuOpen = false;
    markRoomRead(room.id, currentUser.id);
    persistState();
    render();
    markUserPresence(room.id);
    scheduleReceiptRefresh({ force: true, delay: 0 });
  }

  function accessRecord(room, userId) {
    if (!room.accessByUser) room.accessByUser = {};
    const current = room.accessByUser[userId];
    if (current === true) {
      return { unlocked: true, failedAttempts: 0, lockedUntil: null };
    }
    if (!current || typeof current !== "object") {
      room.accessByUser[userId] = { failedAttempts: 0, lockedUntil: null, unlocked: false };
    }
    return room.accessByUser[userId];
  }

  function handlePasswordSubmit() {
    if (!uiState.modal || uiState.modal.type !== "password") return;
    const { roomId, password } = uiState.modal.data;
    const room = appState.rooms.find((item) => item.id === roomId);
    const currentUser = getCurrentUser();
    if (!room || !currentUser) return;
    const record = accessRecord(room, currentUser.id);

    if (record.lockedUntil && record.lockedUntil > Date.now()) {
      uiState.modal.data.error = t("passwordLocked");
      render();
      return;
    }

    if (password !== room.password) {
      record.failedAttempts = (record.failedAttempts || 0) + 1;
      uiState.modal.data.error = t("passwordError");
      if (record.failedAttempts >= CONFIG.passwordAttemptLimit) {
        record.lockedUntil = Date.now() + CONFIG.passwordLockMs;
      }
      persistState();
      render();
      return;
    }

    room.accessByUser[currentUser.id] = true;
    ensureParticipant(room, currentUser.id);
    currentUser.currentRoomId = room.id;
    uiState.activeRoomId = room.id;
    uiState.directoryTab = "chat";
    uiState.chatDetailsOpen = false;
    uiState.attachmentMenuOpen = false;
    uiState.modal = null;
    persistState();
    pushToast("toastPasswordSuccess", "toastPasswordSuccessCopy", { title: room.title });
    render();
    markUserPresence(room.id);
    scheduleReceiptRefresh({ force: true, delay: 0 });
  }

  function leaveRoom(roomId) {
    stopTypingForRoom(roomId);
    const room = appState.rooms.find((item) => item.id === roomId);
    const currentUser = getCurrentUser();
    if (!room || !currentUser || room.status === "expired") return;

    room.participants = (room.participants || []).filter((participantId) => participantId !== currentUser.id);
    const ownershipChange = transferRoomOwnershipIfNeeded(room, currentUser.id);

    if (ownershipChange.deleted) {
      currentUser.currentRoomId = null;
      if (uiState.activeRoomId === roomId) {
        uiState.activeRoomId = null;
      }
      persistState();
      pushToast("toastRoomDeleted", "toastRoomDeletedCopy", { title: room.title });
      render();
      return;
    }

    room.messages.push(systemMessage(uid("sys"), "systemUserLeft", { name: currentUser.name }, Date.now()));
    currentUser.currentRoomId = null;
    if (uiState.activeRoomId === room.id) {
      uiState.activeRoomId = null;
    }
    uiState.directoryTab = "chat";
    uiState.chatDetailsOpen = false;
    uiState.attachmentMenuOpen = false;
    persistState();
    pushToast("toastRoomLeft", "toastRoomLeftCopy", { title: room.title });
    render();
  }

  function deleteRoom(roomId) {
    const room = appState.rooms.find((item) => item.id === roomId);
    if (!room) return;
    const mediaIds = collectMediaIdsFromMessages(room.messages);

    // Policy alignment: room deletion must clean both message metadata and stored chat media blobs together.
    room.messages.forEach((message) => {
      if (message.media?.mediaId) {
        revokeCachedMediaUrl(message.media.mediaId);
      }
      if (message.media?.kind === "video" && message.media.runtimeId) {
        revokeRuntimeVideo(message.media.runtimeId);
      }
    });
    scheduleMediaDeletion(mediaIds);

    stopTypingForRoom(roomId);
    delete runtime.typingSignals[roomId];
    delete uiState.drafts[roomId];
    appState.deletedRooms = {
      ...(appState.deletedRooms || {}),
      [room.id]: Date.now(),
    };
    appState.rooms = appState.rooms.filter((item) => item.id !== roomId);
    appState.invites = appState.invites.filter((invite) => invite.roomId !== roomId);
    appState.users.forEach((user) => {
      if (user.currentRoomId === roomId) {
        user.currentRoomId = null;
      }
    });

    if (uiState.activeRoomId === roomId) {
      uiState.activeRoomId = null;
    }
    if (uiState.modal?.data?.roomId === roomId) {
      uiState.modal = null;
    }
    uiState.directoryTab = "chat";
    uiState.chatDetailsOpen = false;
    uiState.attachmentMenuOpen = false;
  }

  function deleteUserAccount(userId) {
    const user = appState.users.find((item) => item.id === userId);
    if (!user) return;
    if (isAdminUser(user)) return;
    const mediaIdsToDelete = [];

    [...appState.rooms].forEach((room) => {
      if ((room.participants || []).includes(userId)) {
        room.participants = room.participants.filter((participantId) => participantId !== userId);
      }
      room.messages = (room.messages || []).filter((message) => {
        if (message?.senderId !== userId) return true;
        if (message.media?.mediaId) {
          mediaIdsToDelete.push(message.media.mediaId);
          revokeCachedMediaUrl(message.media.mediaId);
        }
        if (message.media?.kind === "video" && message.media.runtimeId) {
          revokeRuntimeVideo(message.media.runtimeId);
        }
        return false;
      });
      if (room.accessByUser) {
        delete room.accessByUser[userId];
      }
      if (room.unreadByUser) {
        delete room.unreadByUser[userId];
      }
      room.messages = (room.messages || []).map((message) =>
        message?.kind === "user"
          ? {
              ...message,
              deliveredTo: Object.fromEntries(Object.entries(message.deliveredTo || {}).filter(([key]) => key !== userId)),
              readBy: Object.fromEntries(Object.entries(message.readBy || {}).filter(([key]) => key !== userId)),
            }
          : message
      );
      transferRoomOwnershipIfNeeded(room, userId);
    });
    appState.rooms = appState.rooms.filter((room) => deriveRoomParticipantIds(room).length > 0);
    scheduleMediaDeletion(mediaIdsToDelete);

    Object.keys(runtime.typingSignals).forEach((roomId) => {
      if (!runtime.typingSignals[roomId]) return;
      delete runtime.typingSignals[roomId][userId];
      if (!Object.keys(runtime.typingSignals[roomId]).length) {
        delete runtime.typingSignals[roomId];
      }
    });

    delete runtime.presenceSignals[userId];
    appState.invites = appState.invites.filter((invite) => invite.inviterId !== userId && invite.inviteeId !== userId);
    appState.users.forEach((item) => {
      if (Array.isArray(item.blockedUserIds)) {
        item.blockedUserIds = item.blockedUserIds.filter((blockedId) => blockedId !== userId);
      }
      if (item.currentRoomId && !appState.rooms.some((room) => room.id === item.currentRoomId)) {
        item.currentRoomId = null;
      }
    });
    appState.deletedUsers = {
      ...(appState.deletedUsers || {}),
      [userId]: Date.now(),
    };
    appState.users = appState.users.filter((item) => item.id !== userId);
    if (uiState.modal?.data?.userId === userId) {
      uiState.modal = null;
    }
  }

  function logoutCurrentUser() {
    const currentUser = getCurrentUser();
    if (!currentUser) return;
    const logoutUserSnapshot = { id: currentUser.id };

    stopTypingForRoom(uiState.activeRoomId);
    const logoutTimestamp = Date.now();
    currentUser.loginState = "offline";
    currentUser.currentRoomId = null;
    currentUser.lastSeenAt = logoutTimestamp;
    runtime.presenceSignals[currentUser.id] = {
      userId: currentUser.id,
      currentRoomId: null,
      lastSeenAt: logoutTimestamp,
      loginState: "offline",
    };
    persistPresenceSnapshotIfNeeded(logoutTimestamp, { force: true, offline: true });
    sendPresenceSignal(null, { loginState: "offline", lastSeenAt: logoutTimestamp, force: true });
    clearAutoLoginState();
    localStorage.setItem(LANDING_UI_KEY, currentUser.uiLanguage || uiState.landing.uiLanguage || "ko");
    uiState.landing.name = "";
    uiState.landing.password = "";
    uiState.landing.autoLogin = false;
    uiState.landing.nativeLanguage = currentUser.nativeLanguage || "ko";
    uiState.landing.uiLanguage = currentUser.uiLanguage || uiState.landing.uiLanguage || "ko";
    uiState.landing.nativeAccordionOpen = false;
    uiState.landing.profileImage = null;
    uiState.landing.error = "";
    resetLandingPanelState();
    uiState.profileEditor = {
      userId: null,
      name: "",
      nickname: "",
      gender: "",
      age: "",
    };

    setActiveUserId(null);
    uiState.activeRoomId = null;
    uiState.modal = null;
    uiState.drawer = null;
    uiState.directoryTab = "chat";
    uiState.chatDetailsOpen = false;
    uiState.attachmentMenuOpen = false;
    uiState.mobileRoomsOpen = false;
    uiState.previewMedia = null;
    uiState.roomSearch = "";
    persistState();
    void unregisterPushTokenForUser(logoutUserSnapshot);
    void unbindNativePushInstallForUser(logoutUserSnapshot);
    render();
  }

  async function persistDraftAttachmentForMessage(attachment, roomId, messageId) {
    if (!attachment) return null;
    const mediaId = attachment.mediaId || uid("media");
    const blob = attachment.blob instanceof Blob ? attachment.blob : null;
    if (!blob) {
      throw new Error("draft_media_blob_missing");
    }

    const response = await fetch(CONFIG.mediaUploadApiPath, {
      method: "POST",
      headers: {
        "x-media-id": mediaId,
        "x-media-kind": attachment.kind,
        "x-media-name": encodeURIComponent(attachment.name || `${mediaId}`),
        "x-media-mime-type": attachment.mimeType || blob.type || "application/octet-stream",
        "x-room-id": roomId,
        "x-message-id": messageId,
      },
      body: blob,
    });

    if (!response.ok) {
      throw new Error(`media_upload_failed_${response.status}`);
    }

    const payload = await readJsonResponseBody(response);
    const uploadedAt = Number(payload?.uploadedAt || Date.now());
    const expiresAt = Number(payload?.expiresAt || 0) || null;

    return {
      kind: attachment.kind,
      name: attachment.name,
      size: blob.size,
      mimeType: attachment.mimeType || blob.type || "",
      storage: "server",
      mediaId,
      url: typeof payload?.url === "string" ? payload.url : "",
      previewUrl: typeof payload?.url === "string" ? payload.url : "",
      uploadedAt,
      expiresAt,
      expired: false,
    };
  }

  async function handleSendMessage(roomId) {
    runtime.compositionActive = false;
    runtime.pendingRenderWhileComposing = false;
    const room = appState.rooms.find((item) => item.id === roomId);
    const currentUser = getCurrentUser();
    if (!room || !currentUser) {
      pushToast("toastNeedRoom", "toastNeedRoomCopy");
      return;
    }
    const draft = getDraft(roomId);
    if (draft.processing) {
      return;
    }
    const liveText = getComposerValue(roomId);
    if (liveText !== draft.text) {
      setDraft(roomId, { text: liveText });
    }
    const text = normalizeDisplayText(liveText).trim();
    const attachment = draft.attachment;
    const translationConcept = getUserTranslationConcept(currentUser);
    const languageProfile = text ? buildMessageLanguageProfile(text, currentUser.nativeLanguage) : createLanguageProfile(currentUser.nativeLanguage);
    const sourceLanguage = languageProfile.primaryLanguage;
    if (!text && !attachment) {
      pushToast("toastEmptyDraft", "toastEmptyDraftCopy");
      return;
    }
    stopTypingForRoom(roomId);
    const composerInput = getComposerInput(roomId);
    const draftSnapshot = {
      text: liveText,
      attachment,
      translationConcept,
    };
    const messageId = uid("msg");
    const createdAt = Date.now();
    const message = userMessage(
      messageId,
      currentUser.id,
      text,
      sourceLanguage,
      {},
      createdAt,
      "sent",
      createOptimisticMessageMedia(attachment)
    );
    message.languageProfile = languageProfile;
    message.translationConcept = translationConcept;
    logEncodingTrace("client-draft", text, {
      roomId,
      messageId,
      sourceLanguage,
    });
    const requestedTargetLanguages = text ? getNeededTargetLanguages(room, currentUser.id, sourceLanguage, languageProfile) : [];
    const requestedTargetKeys = requestedTargetLanguages.map((language) => buildTranslationVariantKey(language, translationConcept));
    message.translationMeta = text
      ? {
          provider: "pending",
          model: runtime.backend.model || null,
          live: runtime.backend.liveTranslationEnabled,
          pending: true,
          state: "pending",
          reason: null,
          errorDetail: null,
          requestedTargets: requestedTargetKeys,
          startedAt: createdAt,
          completedAt: null,
        }
      : {
          provider: "none",
          model: null,
          live: false,
          pending: false,
          state: "idle",
          reason: "not-needed",
          errorDetail: null,
          requestedTargets: [],
          startedAt: null,
          completedAt: createdAt,
        };
    if (composerInput instanceof HTMLInputElement || composerInput instanceof HTMLTextAreaElement) {
      composerInput.value = "";
    }
    setDraft(roomId, {
      text: "",
      attachment: null,
      processing: true,
      translationConcept,
    });
    uiState.attachmentMenuOpen = false;
    ensureParticipant(room, currentUser.id, false);
    room.messages.push(message);
    room.lastMessageAt = createdAt;
    currentUser.currentRoomId = room.id;
    currentUser.lastSeenAt = createdAt;
    persistState();
    flushServerStateSync();
    scheduleReceiptRefresh({ delay: 90 });
    render();
    let storedAttachment = message.media;
    try {
      storedAttachment = attachment ? await persistDraftAttachmentForMessage(attachment, room.id, messageId) : message.media;
      const liveRoomAfterPersist = appState.rooms.find((entry) => entry.id === roomId);
      const liveMessageAfterPersist = liveRoomAfterPersist?.messages?.find((entry) => entry.id === messageId);
      if (liveMessageAfterPersist && storedAttachment) {
        liveMessageAfterPersist.media = storedAttachment;
        persistState();
        flushServerStateSync();
        renderSafelyDuringInput(40);
      }
    } catch (error) {
      room.messages = room.messages.filter((entry) => entry.id !== messageId);
      room.lastMessageAt = Math.max(
        Number(room.createdAt || 0),
        ...room.messages.map((entry) => Number(entry.createdAt || 0))
      );
      setDraft(roomId, {
        ...draftSnapshot,
        processing: false,
      });
      persistState();
      flushServerStateSync();
      pushToast("toastMediaStorageFailed", "toastMediaStorageFailedCopy");
      render();
      return;
    }
    markRoomRead(room.id, currentUser.id);
    room.participants.forEach((participantId) => {
      if (participantId !== currentUser.id) {
        room.unreadByUser[participantId] = (room.unreadByUser[participantId] || 0) + 1;
      }
    });
    setDraft(roomId, { processing: false });
    persistState();
    flushServerStateSync();
    render();

    if (!text) {
      return;
    }

    Promise.resolve()
      .then(async () => {
        let translationBundle = {
          translations: { [sourceLanguage]: { text, failed: false } },
          meta: {
            provider: "none",
            model: null,
            live: false,
            state: "idle",
            reason: "not-needed",
            errorDetail: null,
            requestedTargets: requestedTargetKeys,
            completedAt: Date.now(),
          },
        };

        try {
          translationBundle = await buildTranslations(
            room,
            text,
            currentUser.id,
            sourceLanguage,
            requestedTargetLanguages,
            {
              languageProfile,
              translationConcept,
              naturalTranslationEnabled: isNaturalTranslationEnabledForUser(currentUser),
              contextSummary: getRoomNaturalTranslationSummary(room, currentUser.id),
            }
          );
        } catch (error) {
          console.warn("[translation] unexpected client failure", {
            messageId,
            sourceLanguage,
            requestedTargetLanguages,
            translationConcept,
            error: String(error?.message || error),
          });
          translationBundle = {
            translations: {
              [sourceLanguage]: { text, failed: false },
              ...Object.fromEntries(
                requestedTargetLanguages.map((language) => [buildTranslationVariantKey(language, translationConcept) || language, { text, failed: true }])
              ),
            },
            meta: {
              provider: "client-error",
              model: null,
              live: false,
              state: "failed",
              reason: "client_exception",
              errorDetail: String(error?.message || error || "translation_error"),
              requestedTargets: requestedTargetKeys,
              completedAt: Date.now(),
            },
          };
        }

        const liveRoom = appState.rooms.find((entry) => entry.id === roomId);
        const liveMessage = liveRoom?.messages?.find((entry) => entry.id === messageId);
        if (!liveRoom || !liveMessage) {
          return;
        }

        liveMessage.translations = translationBundle.translations;
        liveMessage.translationMeta = {
          ...translationBundle.meta,
          pending: false,
          startedAt: null,
        };
        liveMessage.status = liveMessage.status === "composing" ? "sent" : liveMessage.status || "sent";
        persistState();
        flushServerStateSync();
        renderSafelyDuringInput();
      })
      .catch((error) => {
        console.warn("[translation] send pipeline failed", {
          roomId,
          messageId,
          error: String(error?.message || error),
        });
      });
  }

  function createBaseTranslationMap(text, sourceLanguage) {
    return text
      ? {
          [sourceLanguage]: { text, failed: false },
        }
      : {};
  }

  function getNeededTargetLanguages(room, senderId, fromLanguage, languageProfile = null) {
    if (!room) return [];

    const audienceIds = new Set(deriveRoomParticipantIds(room));
    audienceIds.add(room.creatorId);
    (appState.users || []).forEach((user) => {
      if (user?.currentRoomId === room.id) {
        audienceIds.add(user.id);
      }
    });
    Object.entries(room.accessByUser || {}).forEach(([userId, access]) => {
      if (access === true || access?.unlocked) {
        audienceIds.add(userId);
      }
    });

    const needed = new Set();
    audienceIds.forEach((participantId) => {
      if (participantId === senderId) return;
      const participant = appState.users.find((user) => user.id === participantId);
      if (!participant) return;
      const targetLanguage = getUserDisplayLanguage(participant, fromLanguage);
      if (shouldRequestTranslationForLanguage(targetLanguage, fromLanguage, languageProfile)) {
        needed.add(targetLanguage);
      }
    });

    return [...needed];
  }

  function stripLeadingTranslationLabel(text) {
    const normalized = String(text || "").normalize("NFC");
    const translationLabelPattern = /^(?:\s|\u200b)*(?:(?:\uBC88\uC5ED(?:\uBCF8|\uBB38|\uACB0\uACFC)?|\uC6D0\uBB38|\uCC38\uACE0|\uC790\uB3D9\s*\uBC88\uC5ED|translated(?:\s+message|\s+text)?|translation|original|reference|note|b\u1EA3n d\u1ECBch|ban dich)\s*[:：]\s*)+/iu;
    return normalized
      .replace(translationLabelPattern, "")
      .trim();
  }

  function splitTextForLanguageAnalysis(text) {
    return String(text || "")
      .split(/[\r\n]+|(?<=[.!?…])\s+|[,:;|/]+/u)
      .map((segment) => segment.trim())
      .filter(Boolean)
      .flatMap((segment) =>
        segment
          .split(/(?<=[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af])\s+(?=[A-Za-z\u00C0-\u024F\u1E00-\u1EFF])|(?<=[A-Za-z\u00C0-\u024F\u1E00-\u1EFF])\s+(?=[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af])/u)
          .map((part) => part.trim())
          .filter(Boolean)
      );
  }

  function detectSegmentLanguages(text, fallbackLanguage = "ko") {
    const normalizedText = stripLeadingTranslationLabel(String(text || "").normalize("NFC")).trim();
    const fallback = normalizeMessageLanguageCode(fallbackLanguage, "ko");
    if (!normalizedText) return [];

    const languages = new Set([detectMessageLanguage(normalizedText, fallback)]);
    const sanitizedTokenText = ` ${sanitizeToken(normalizedText)} `;
    const precomputedHangulCount = countMatches(normalizedText, /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/g);
    const expressiveHangulCount = countMatches(normalizedText, /[?뗣뀕?졼뀥]/g);
    const koreanSignalCount = Math.max(0, precomputedHangulCount - expressiveHangulCount);
    const vietnameseAccentCount = countMatches(normalizedText, /[훯횂횎횚?특휂훱창챗척퉤튼휃횁?梳▣꺻틺梳?별梳꿍병梳뜬벡梳╇벰梳め벵횋횊梳뷘볼梳멜봅沼沼귗퍍沼녍띊뚡퍑칩沼듑벭믟퍗횛沼뚡퍙沼믟퍝沼뽥퍡沼싡퍥沼왾퍩沼▣싀쇹빴큠沼ㅱ빻沼め뺄沼?뺐횦沼꿍뻑沼멜뺨]/gu);
    const vietnameseCharCount = countMatches(normalizedText, /[훱창휃챗척퉤튼찼횪梳Ｃａ벙梳α벨梳⒰벴梳?변梳긔볐梳듄볜챕챔梳삔봄梳밞봇沼곢퍌沼끷퍐챠챙沼됂⒰퍔처챵沼뤓듄퍖沼묃퍜沼뺗퍠沼쇹퍤沼앩퍨沼■빰첬첫沼㎶⒰빳沼⒰뺀沼?뺏沼궁써뺙沼료뻘沼?]/gi);
    const vietnameseWordHitCount = countMatches(sanitizedTokenText, /\b(anh|em|toi|ban|minh|nha|nhe|roi|duoc|khong|yeu|thuong|nho|chua|vay|cho|lam|lan|sau|ngu|ngon|me|con|thay|co)\b/gi);
    const englishWordHitCount = countMatches(sanitizedTokenText, /\b(i|you|we|they|love|miss|hello|hi|please|thanks|okay|can|are|is|am)\b/gi);

    if (koreanSignalCount > 0) languages.add("ko");
    if (vietnameseAccentCount > 0 || vietnameseCharCount > 0 || vietnameseWordHitCount >= 1) languages.add("vi");
    if (englishWordHitCount >= 2) languages.add("en");
    return [...languages].filter(Boolean);
  }

  function createLanguageProfile(primaryLanguage, detectedLanguages = null) {
    const normalizedPrimary = normalizeMessageLanguageCode(primaryLanguage, "ko");
    const normalizedDetected = [...new Set(
      (Array.isArray(detectedLanguages) ? detectedLanguages : [normalizedPrimary])
        .map((language) => getTranslationVariantLanguage(language))
        .filter(Boolean)
    )];
    if (!normalizedDetected.includes(normalizedPrimary)) {
      normalizedDetected.unshift(normalizedPrimary);
    }
    return {
      primaryLanguage: normalizedPrimary,
      detectedLanguages: normalizedDetected,
      mixed: normalizedDetected.length > 1,
    };
  }

  function buildMessageLanguageProfile(text, fallbackLanguage = "ko", existingProfile = null) {
    const normalizedText = stripLeadingTranslationLabel(String(text || "").normalize("NFC")).trim();
    const fallback = normalizeMessageLanguageCode(fallbackLanguage, "ko");
    if (!normalizedText) {
      return createLanguageProfile(fallback);
    }

    const primaryLanguage = detectMessageLanguage(normalizedText, fallback);
    const storedDetectedLanguages = Array.isArray(existingProfile?.detectedLanguages) ? existingProfile.detectedLanguages : [];
    const segmentedLanguages = splitTextForLanguageAnalysis(normalizedText)
      .flatMap((segment) => detectSegmentLanguages(segment, fallback))
      .filter(Boolean);
    const detectedLanguages = [...new Set([
      primaryLanguage,
      ...storedDetectedLanguages.map((language) => getTranslationVariantLanguage(language)).filter(Boolean),
      ...detectSegmentLanguages(normalizedText, fallback),
      ...segmentedLanguages,
    ])];

    return createLanguageProfile(primaryLanguage, detectedLanguages);
  }

  function shouldRequestTranslationForLanguage(targetLanguage, sourceLanguage, languageProfile = null) {
    const normalizedTarget = getTranslationVariantLanguage(targetLanguage);
    const normalizedSource = normalizeMessageLanguageCode(sourceLanguage, "ko");
    if (!normalizedTarget) return false;
    if (normalizedTarget !== normalizedSource) return true;
    const profile = createLanguageProfile(normalizedSource, languageProfile?.detectedLanguages);
    return profile.detectedLanguages.some((language) => language && language !== normalizedTarget);
  }

  function detectMessageLanguage(text, fallbackLanguage = "ko") {
    const normalizedText = stripLeadingTranslationLabel(String(text || "").normalize("NFC")).trim();
    const fallback = normalizeMessageLanguageCode(fallbackLanguage, "ko");
    if (!normalizedText) return fallback;

    const sanitizedTokenText = ` ${sanitizeToken(normalizedText)} `;
    const precomputedHangulCount = countMatches(normalizedText, /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/g);
    const expressiveHangulCount = countMatches(normalizedText, /[ㅋㅎㅠㅜ]/g);
    const koreanSignalCount = Math.max(0, precomputedHangulCount - expressiveHangulCount);
    const vietnameseAccentCount = countMatches(normalizedText, /[ĂÂÊÔƠƯĐăâêôơưđÁÀẢÃẠẮẰẲẴẶẤẦẨẪẬÉÈẺẼẸẾỀỂỄỆÍÌỈĨỊÓÒỎÕỌỐỒỔỖỘỚỜỞỠỢÚÙỦŨỤỨỪỬỮỰÝỲỶỸỴ]/gu);
    const vietnameseWordHitCount = countMatches(sanitizedTokenText, /\b(anh|em|toi|ban|minh|nha|nhe|roi|duoc|khong|yeu|thuong|nho|chua|vay|cho|lam|lan|sau|ngu|ngon)\b/gi);
    if (vietnameseAccentCount > 0 || vietnameseWordHitCount >= 2) {
      return "vi";
    }
    if (koreanSignalCount >= 2) {
      return "ko";
    }
    const englishWordHitCount = countMatches(sanitizedTokenText, /\b(i|you|we|they|love|miss|hello|hi|please|thanks|okay|can|are|is|am)\b/gi);
    if (englishWordHitCount >= 2) {
      return "en";
    }

    const hangulCount = (normalizedText.match(/[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/g) || []).length;
    if (hangulCount > 0) {
      return "ko";
    }

    const vietnameseCharCount = (
      normalizedText.match(/[ăâđêôơưáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/gi) || []
    ).length;
    if (vietnameseCharCount > 0) {
      return "vi";
    }

    const normalizedTokenText = ` ${sanitizeToken(normalizedText)} `;
    const vietnameseWordPattern = /\b(anh|em|toi|ban|minh|nha|nhe|roi|duoc|khong|yeu|thuong|nho|chua|vay)\b/i;
    const englishWordPattern = /\b(i|you|we|they|love|miss|hello|hi|please|thanks|okay|can|are|is|am)\b/i;
    if (vietnameseWordPattern.test(normalizedTokenText)) {
      return "vi";
    }
    if (englishWordPattern.test(normalizedTokenText)) {
      return "en";
    }

    const latinCount = (normalizedText.match(/[A-Za-z]/g) || []).length;
    if (latinCount > 0) {
      return fallback === "vi" ? "vi" : "en";
    }

    return fallback;
  }

  function isNaturalTranslationEnabledForUser(user = getCurrentUser()) {
    return Boolean(user);
  }

  function normalizeContextSnippet(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 56);
  }

  function describeContextLanguage(code) {
    return (
      {
        ko: "Korean",
        en: "English",
        vi: "Vietnamese",
      }[normalizeMessageLanguageCode(code, "ko")] || code || "Unknown"
    );
  }

  function tokenizeReferenceContext(text) {
    return sanitizeToken(stripLeadingTranslationLabel(normalizeDisplayText(text || "")))
      .split(/\s+/)
      .filter(Boolean);
  }

  function pickDominantReferencePronoun(scoreMap, excluded = []) {
    const blocked = new Set(excluded.filter(Boolean));
    const ranked = Object.entries(scoreMap || {})
      .filter(([key, score]) => key && !blocked.has(key) && Number(score || 0) > 0)
      .sort((a, b) => b[1] - a[1]);
    if (!ranked.length) return "";
    const [topKey, topScore] = ranked[0];
    const secondScore = Number(ranked[1]?.[1] || 0);
    if (topScore < 2) return "";
    if (secondScore && topScore <= secondScore) return "";
    return topKey;
  }

  function getReferenceConfidence(scoreMap, pronoun) {
    if (!pronoun) return "low";
    const ranked = Object.entries(scoreMap || {})
      .filter(([, score]) => Number(score || 0) > 0)
      .sort((a, b) => b[1] - a[1]);
    const topScore = Number(ranked[0]?.[1] || 0);
    const secondScore = Number(ranked[1]?.[1] || 0);
    if (topScore >= 4 && topScore - secondScore >= 2) return "high";
    if (topScore >= 2) return "medium";
    return "low";
  }

  function inferConversationRelationshipType(recentMessages, preferredConcept) {
    const tokens = (recentMessages || [])
      .flatMap((message) => tokenizeReferenceContext(message.originalText || message.text || ""))
      .filter(Boolean);
    const familyTerms = new Set(["me", "con", "bo", "ba", "cha", "anhai", "chi", "emgai", "엄마", "아빠", "아들", "딸"]);
    const schoolTerms = new Set(["thay", "co", "giaovien", "hocsinh", "선생님", "학생", "숙제", "수업"]);
    const familyHits = tokens.filter((token) => familyTerms.has(token)).length;
    const schoolHits = tokens.filter((token) => schoolTerms.has(token)).length;

    if (familyHits >= 2) return { type: "family", confidence: "high" };
    if (schoolHits >= 2) return { type: "teacher-student", confidence: "high" };
    if (preferredConcept === "lover") return { type: "lover", confidence: "medium" };
    if (preferredConcept === "friend") return { type: "friend", confidence: "medium" };
    if (preferredConcept === "office") return { type: "general", confidence: "medium" };
    return { type: "general", confidence: "low" };
  }

  function analyzeVietnameseReferenceProfile(messages, participantId) {
    const pronouns = new Set(["anh", "em", "chi", "co", "chu", "bac", "toi", "ban", "minh", "me", "con", "thay"]);
    const subjectFollowers = new Set(["da", "dang", "se", "muon", "nho", "yeu", "thuong", "biet", "thay", "so", "goi", "nhac", "can", "muon", "ngu", "an", "ve", "doi"]);
    const objectLeaders = new Set(["cho", "voi", "gap", "nho", "yeu", "thuong", "goi", "nhac", "xinloi", "tha", "bao", "noi", "tra", "gui"]);
    const observedPronouns = new Set();
    const selfScores = {};
    const addressScores = {};
    let analyzedMessages = 0;

    (messages || []).forEach((message) => {
      if (message?.senderId !== participantId || message?.kind !== "user") return;
      const sourceLanguage = normalizeMessageLanguageCode(message.originalLanguage || message.sourceLanguage, "ko");
      const tokens = tokenizeReferenceContext(message.originalText || message.text || "");
      if (!tokens.length) return;
      const likelyVietnamese = sourceLanguage === "vi" || tokens.some((token) => pronouns.has(token));
      if (!likelyVietnamese) return;
      analyzedMessages += 1;

      tokens.forEach((token, index) => {
        if (!pronouns.has(token)) return;
        observedPronouns.add(token);
        const previous = tokens[index - 1] || "";
        const next = tokens[index + 1] || "";

        if (index === 0 || subjectFollowers.has(next)) {
          selfScores[token] = (selfScores[token] || 0) + 2;
        }
        if (objectLeaders.has(previous) || next === "oi" || next === "a" || next === "nhe" || next === "nha") {
          addressScores[token] = (addressScores[token] || 0) + 2;
        }
        if ((previous === "cho" || previous === "de") && ["nhac", "biet", "xem", "noi", "goi", "tra", "viet"].includes(next)) {
          selfScores[token] = (selfScores[token] || 0) + 1;
        }
      });
    });

    const selfPronoun = pickDominantReferencePronoun(selfScores);
    const addressPronoun = pickDominantReferencePronoun(addressScores, selfPronoun ? [selfPronoun] : []);
    return {
      participantId,
      observedPronouns: [...observedPronouns],
      analyzedMessages,
      selfPronoun,
      addressPronoun,
      selfConfidence: getReferenceConfidence(selfScores, selfPronoun),
      addressConfidence: getReferenceConfidence(addressScores, addressPronoun),
      selfScores,
      addressScores,
    };
  }

  function inferRoomParticipantReferenceFacts(room, recentMessages) {
    const participantIds = [...new Set([...deriveRoomParticipantIds(room), room?.creatorId].filter(Boolean))];
    const participants = participantIds
      .map((participantId) => appState.users.find((user) => user.id === participantId))
      .filter(Boolean);
    const profiles = participants.map((participant) => ({
      user: participant,
      displayName: getUserDisplayName(participant) || participant.loginId || participant.id,
      ...analyzeVietnameseReferenceProfile(recentMessages, participant.id),
    }));

    if (profiles.length === 2) {
      const [first, second] = profiles;
      if (!first.addressPronoun && second.selfPronoun) first.addressPronoun = second.selfPronoun;
      if (!second.addressPronoun && first.selfPronoun) second.addressPronoun = first.selfPronoun;
      if (!first.selfPronoun && second.addressPronoun) first.selfPronoun = second.addressPronoun;
      if (!second.selfPronoun && first.addressPronoun) second.selfPronoun = first.addressPronoun;
    }

    return profiles;
  }

  function buildParticipantReferenceSummary(profile, allProfiles, senderId) {
    if (!profile?.user) return "";
    const counterpartNames = allProfiles
      .filter((entry) => entry.user.id !== profile.user.id)
      .map((entry) => entry.displayName)
      .filter(Boolean);
    const counterpartLabel =
      counterpartNames.length === 1
        ? counterpartNames[0]
        : counterpartNames.length > 1
          ? "the other participants"
          : "the other side";

    const roleFacts = [];
    if (profile.selfPronoun) {
      roleFacts.push(`refers to self as "${profile.selfPronoun}" (confidence ${profile.selfConfidence || "low"})`);
    }
    if (profile.addressPronoun) {
      roleFacts.push(`addresses ${counterpartLabel} as "${profile.addressPronoun}" (confidence ${profile.addressConfidence || "low"})`);
    }
    if (!roleFacts.length && profile.observedPronouns.length) {
      roleFacts.push(`uses Vietnamese reference terms ${profile.observedPronouns.slice(0, 4).map((entry) => `"${entry}"`).join(", ")}`);
    }
    if (!roleFacts.length) return "";

    const focusPrefix = profile.user.id === senderId ? "Current speaker base facts" : "Participant base facts";
    return `${focusPrefix}: ${profile.displayName} ${roleFacts.join(" and ")}.`;
  }

  function getRoomNaturalTranslationSummary(room, senderId = "") {
    if (!room || !isNaturalTranslationEnabledForUser()) {
      return "";
    }

    const recentMessages = (room.messages || [])
      .filter((message) => message?.kind === "user" && String(message?.originalText || message?.text || "").trim())
      .slice(-18);
    if (!recentMessages.length) {
      return "";
    }

    const participantSignature = [...new Set([...deriveRoomParticipantIds(room), room?.creatorId].filter(Boolean))]
      .map((participantId) => {
        const participant = appState.users.find((user) => user.id === participantId);
        return `${participantId}:${participant?.nativeLanguage || ""}:${participant?.gender || ""}:${participant?.name || ""}`;
      })
      .join("|");
    const signature = `${senderId || "none"}::${participantSignature}::${recentMessages.map((message) => `${message.id}:${message.translationConcept || DEFAULT_TRANSLATION_CONCEPT}`).join("|")}`;
    if (room.naturalTranslationContextCache?.signature === signature && room.naturalTranslationContextCache?.summary) {
      return room.naturalTranslationContextCache.summary;
    }

    const dominantConcept = recentMessages.reduce((counts, message) => {
      const concept = normalizeTranslationConcept(message.translationConcept);
      counts[concept] = (counts[concept] || 0) + 1;
      return counts;
    }, {});
    const preferredConcept =
      Object.entries(dominantConcept).sort((a, b) => b[1] - a[1])[0]?.[0] || DEFAULT_TRANSLATION_CONCEPT;
    const recentLines = recentMessages.slice(-4).map((message) => {
      const speaker = appState.users.find((user) => user.id === message.senderId);
      const snippet = normalizeContextSnippet(message.originalText || message.text || "");
      if (!snippet) return "";
      return `${getUserDisplayName(speaker) || "User"}: ${snippet}`;
    }).filter(Boolean);
    const participantProfiles = inferRoomParticipantReferenceFacts(room, recentMessages);
    const participantFacts = participantProfiles
      .map((profile) => {
        const gender = profile.user?.gender === "male" ? "male" : profile.user?.gender === "female" ? "female" : "";
        return `${profile.displayName} uses ${describeContextLanguage(profile.user?.nativeLanguage)}${gender ? `, gender ${gender}` : ""}`;
      })
      .filter(Boolean);
    const referenceFacts = participantProfiles
      .map((profile) => buildParticipantReferenceSummary(profile, participantProfiles, senderId))
      .filter(Boolean);
    const relationshipType = inferConversationRelationshipType(recentMessages, preferredConcept);
    const summary = [
      `Conversation persona context: relation ${relationshipType.type} (confidence ${relationshipType.confidence}).`,
      `Relationship tone hint: ${describeTranslationConcept(preferredConcept)}.`,
      participantFacts.length ? `Participant facts: ${participantFacts.join(" | ")}` : "",
      referenceFacts.length ? referenceFacts.join(" ") : "",
      senderId ? "If Vietnamese subjects or pronouns are omitted, keep the current speaker and addressee roles above fixed unless this message clearly overrides them." : "",
      recentLines.length ? `Recent lines: ${recentLines.join(" | ")}` : "",
    ].filter(Boolean).join("\n");

    room.naturalTranslationContextCache = {
      signature,
      summary,
      updatedAt: Date.now(),
    };
    return summary;
  }

  async function buildTranslations(room, text, senderId, fromLanguage, requestedTargetLanguages = null, options = {}) {
    const languageProfile = options.languageProfile || null;
    const targetLanguages = Array.isArray(requestedTargetLanguages)
      ? [...new Set(requestedTargetLanguages.filter((language) => shouldRequestTranslationForLanguage(language, fromLanguage, languageProfile)))]
      : getNeededTargetLanguages(room, senderId, fromLanguage, languageProfile);
    const result = createBaseTranslationMap(text, fromLanguage);
    const translationConcept = normalizeTranslationConcept(options.translationConcept);
    const translationKeys = targetLanguages.map((language) => buildTranslationVariantKey(language, translationConcept));
    const naturalTranslationEnabled = Boolean(options.naturalTranslationEnabled);
    const contextSummary = naturalTranslationEnabled ? String(options.contextSummary || "").trim() : "";

    console.info("[translation] request", {
      senderId,
      sourceLanguage: fromLanguage,
      targetLanguages,
      detectedLanguages: languageProfile?.detectedLanguages || [fromLanguage],
      translationConcept,
      naturalTranslationEnabled,
      contextSummaryLength: contextSummary.length,
      serverReachable: runtime.backend.serverReachable,
      liveTranslationEnabled: runtime.backend.liveTranslationEnabled,
    });

    if (!targetLanguages.length) {
      return {
        translations: result,
        meta: {
          provider: "none",
          model: runtime.backend.model || null,
          live: false,
          state: "idle",
          reason: "not-needed",
          errorDetail: null,
          requestedTargets: [],
          completedAt: Date.now(),
        },
      };
    }

    if (isEncodingCorruptedText(text, fromLanguage)) {
      targetLanguages.forEach((targetLanguage) => {
        result[buildTranslationVariantKey(targetLanguage, translationConcept)] = { text, failed: true };
      });
      return {
        translations: result,
        meta: {
          provider: "none",
          model: null,
          live: false,
          state: "failed",
          reason: "encoding_corrupted",
          errorDetail: "Source text is already damaged and cannot be translated safely.",
          requestedTargets: translationKeys,
          completedAt: Date.now(),
        },
      };
    }

    const liveTranslations = await requestServerTranslations(text, fromLanguage, targetLanguages, {
      languageProfile,
      translationConcept,
      contextSummary,
    });
    if (liveTranslations.status === "success") {
      targetLanguages.forEach((targetLanguage) => {
        const targetKey = buildTranslationVariantKey(targetLanguage, translationConcept);
        const entry = liveTranslations.translations?.[targetLanguage];
        const translatedText =
          typeof entry === "string"
            ? entry
            : typeof entry?.text === "string"
              ? entry.text
              : "";
        result[targetKey] = translatedText
          ? { text: translatedText, failed: Boolean(entry?.failed) }
          : { text, failed: true };
      });
      const hasFailure = translationKeys.some((language) => Boolean(result[language]?.failed));
      console.info("[translation] response", {
        sourceLanguage: fromLanguage,
        targetLanguages,
        translationConcept,
        provider: liveTranslations.provider,
        model: liveTranslations.model,
        hasFailure,
      });
      return {
        translations: result,
        meta: {
          provider: liveTranslations.provider || "openai",
          model: liveTranslations.model || runtime.backend.model || null,
          live: true,
          state: hasFailure ? "partial" : "success",
          reason: null,
          errorDetail: null,
          requestedTargets: translationKeys,
          completedAt: Date.now(),
        },
      };
    }

    if (liveTranslations.reason === "encoding_corrupted") {
      targetLanguages.forEach((targetLanguage) => {
        result[buildTranslationVariantKey(targetLanguage, translationConcept)] = { text, failed: true };
      });
      return {
        translations: result,
        meta: {
          provider: "none",
          model: null,
          live: false,
          state: "failed",
          reason: "encoding_corrupted",
          errorDetail: liveTranslations.errorDetail || "Stored source text is already damaged.",
          requestedTargets: translationKeys,
          completedAt: Date.now(),
        },
      };
    }

    console.warn("[translation] fallback", {
      sourceLanguage: fromLanguage,
      targetLanguages,
      translationConcept,
      reason: liveTranslations.reason,
      errorDetail: liveTranslations.errorDetail || null,
    });

    for (const targetLanguage of targetLanguages) {
      try {
        const translated = await mockTranslate(text, fromLanguage, targetLanguage);
        result[buildTranslationVariantKey(targetLanguage, translationConcept)] = { text: translated, failed: false };
      } catch (error) {
        result[buildTranslationVariantKey(targetLanguage, translationConcept)] = { text, failed: true };
      }
    }
    const allFallbacksFailed = translationKeys.every((language) => Boolean(result[language]?.failed));
    return {
      translations: result,
      meta: {
        provider: "mock",
        model: null,
        live: false,
        state: allFallbacksFailed ? "failed" : "mock",
        reason: liveTranslations.reason,
        errorDetail: liveTranslations.errorDetail || null,
        requestedTargets: translationKeys,
        completedAt: Date.now(),
      },
    };
  }

  async function requestServerTranslations(text, sourceLanguage, targetLanguages, options = {}) {
    if (!targetLanguages.length) {
      return { status: "skipped", reason: "not-needed", errorDetail: null };
    }

    if (!shouldUseTranslationBackend()) {
      return { status: "failed", reason: "client_backend_unavailable", errorDetail: "The browser is not connected to the local backend." };
    }

    const translationConcept = normalizeTranslationConcept(options.translationConcept);
    const languageProfile = options.languageProfile || null;
    const requestKey = JSON.stringify({
      sourceLanguage,
      detectedLanguages: Array.isArray(languageProfile?.detectedLanguages) ? [...languageProfile.detectedLanguages].sort() : [],
      targetLanguages: [...targetLanguages].sort(),
      translationConcept,
      text,
    });
    if (runtime.translationRequests.has(requestKey)) {
      return runtime.translationRequests.get(requestKey);
    }

    const requestPromise = (async () => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const finalAttempt = attempt === 1;
        try {
          const controller = typeof AbortController === "function" ? new AbortController() : null;
          const timeoutId = controller
            ? window.setTimeout(() => controller.abort(), CONFIG.translationRequestTimeoutMs)
            : 0;
          logEncodingTrace("client-translate-request", text, {
            sourceLanguage,
            targetLanguages,
            translationConcept,
            attempt: attempt + 1,
          });
          let response;
          try {
            // Later this request can move to a real auth/session-aware Node.js + WebSocket message pipeline.
            response = await fetch(CONFIG.translationApiPath, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                text,
                sourceLanguage,
                detectedLanguages: Array.isArray(languageProfile?.detectedLanguages) ? languageProfile.detectedLanguages : [sourceLanguage],
                targetLanguages,
                translationConcept,
                contextSummary: String(options.contextSummary || "").trim(),
              }),
              signal: controller?.signal,
            });
          } finally {
            if (timeoutId) {
              window.clearTimeout(timeoutId);
            }
          }

          const payload = await readJsonResponseBody(response);
          if (!response.ok) {
            const reason = normalizeTranslationFailureReason(payload?.error, response.status);
            if (!finalAttempt && Number(response.status) >= 500) {
              console.warn("[translation] retry-request", {
                sourceLanguage,
                targetLanguages,
                translationConcept,
                attempt: attempt + 1,
                reason,
              });
              await new Promise((resolve) => setTimeout(resolve, 180));
              continue;
            }
            updateBackendStatus({
              serverReachable: true,
              liveTranslationEnabled: false,
              translationConfigured: ["missing_api_key", "invalid_api_key_format"].includes(payload?.error) ? false : runtime.backend.translationConfigured,
              lastTranslationError: payload?.error || reason,
              lastTranslationErrorDetail: payload?.detail || payload?.message || `Translation request failed with ${response.status}.`,
              checkedAt: Date.now(),
            });
            return {
              status: "failed",
              reason,
              errorDetail: payload?.detail || payload?.message || `Translation request failed with ${response.status}.`,
            };
          }

          updateBackendStatus({
            serverReachable: true,
            liveTranslationEnabled: true,
            model: payload?.model || null,
            translationConfigured: true,
            lastTranslationError: null,
            lastTranslationErrorDetail: null,
            checkedAt: Date.now(),
          });
          return {
            status: "success",
            translations: payload?.translations || null,
            provider: "openai",
            model: payload?.model || null,
          };
        } catch (error) {
          if (!finalAttempt) {
            console.warn("[translation] retry-request", {
              sourceLanguage,
              targetLanguages,
              translationConcept,
              attempt: attempt + 1,
              reason: error?.name === "AbortError" ? "timeout" : "server_unreachable",
              errorDetail: String(error?.message || error || "Server unreachable"),
            });
            await new Promise((resolve) => setTimeout(resolve, 180));
            continue;
          }
          updateBackendStatus({
            serverReachable: false,
            liveTranslationEnabled: false,
            lastTranslationError: error?.name === "AbortError" ? "timeout" : "server_unreachable",
            lastTranslationErrorDetail: String(error?.message || error || "Server unreachable"),
            checkedAt: Date.now(),
          });
          return {
            status: "failed",
            reason: error?.name === "AbortError" ? "timeout" : "server_unreachable",
            errorDetail: String(error?.message || error || "Server unreachable"),
          };
        }
      }
    })().finally(() => {
      runtime.translationRequests.delete(requestKey);
    });

    runtime.translationRequests.set(requestKey, requestPromise);
    return requestPromise;
  }

  async function readJsonResponseBody(response) {
    const raw = await response.text();
    if (!raw) return {};
    try {
      return JSON.parse(raw);
    } catch (error) {
      return {
        detail: raw,
      };
    }
  }

  function normalizeTranslationFailureReason(errorCode, statusCode) {
    if (errorCode === "encoding_corrupted") return "encoding_corrupted";
    if (errorCode === "missing_api_key") return "service_disabled";
    if (errorCode === "invalid_api_key_format") return "service_disabled";
    if (Number(statusCode) >= 500) return "live_request_failed";
    return "live_request_rejected";
  }

  function shouldUseTranslationBackend() {
    return (
      typeof fetch === "function" &&
      typeof window !== "undefined" &&
      (window.location.protocol === "http:" || window.location.protocol === "https:")
    );
  }

  function getActiveTypingUsers(roomId, currentUserId) {
    const roomSignals = runtime.typingSignals[roomId];
    if (!roomSignals) return [];

    const now = Date.now();
    return Object.values(roomSignals)
      .filter((entry) => entry && entry.userId !== currentUserId && entry.expiresAt > now)
      .sort((a, b) => (b.expiresAt || 0) - (a.expiresAt || 0));
  }

  function pruneTypingSignals() {
    const now = Date.now();
    let changed = false;

    Object.keys(runtime.typingSignals).forEach((roomId) => {
      const entries = runtime.typingSignals[roomId];
      if (!entries) return;

      Object.keys(entries).forEach((userId) => {
        if (!entries[userId] || entries[userId].expiresAt <= now) {
          delete entries[userId];
          changed = true;
        }
      });

      if (!Object.keys(entries).length) {
        delete runtime.typingSignals[roomId];
      }
    });

    return changed;
  }

  function prunePresenceSignals() {
    const now = Date.now();
    const ttlMs = 2 * 60 * 1000;
    let changed = false;
    Object.keys(runtime.presenceSignals).forEach((userId) => {
      const signal = runtime.presenceSignals[userId];
      if (!signal) return;
      if (now - Number(signal.lastSeenAt || 0) > ttlMs) {
        delete runtime.presenceSignals[userId];
        changed = true;
      }
    });
    return changed;
  }

  function updateTypingSignal(payload) {
    const roomId = payload?.roomId;
    const userId = payload?.userId;
    if (!roomId || !userId) return false;

    const roomSignals = runtime.typingSignals[roomId] || {};
    const nextSignals = { ...roomSignals };

    if (payload.isTyping) {
      nextSignals[userId] = {
        roomId,
        userId,
        name: payload.name || "",
        expiresAt: Number(payload.expiresAt || Date.now() + CONFIG.typingSignalTtlMs),
      };
    } else {
      delete nextSignals[userId];
    }

    if (Object.keys(nextSignals).length) {
      runtime.typingSignals[roomId] = nextSignals;
    } else {
      delete runtime.typingSignals[roomId];
    }

    return true;
  }

  function scheduleTypingStop(roomId) {
    const existing = runtime.typingStopTimers.get(roomId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      sendTypingSignal(roomId, false, { force: true });
      runtime.typingStopTimers.delete(roomId);
    }, CONFIG.typingIdleMs);
    runtime.typingStopTimers.set(roomId, timer);
  }

  function stopTypingForRoom(roomId) {
    if (!roomId) return;
    const existing = runtime.typingStopTimers.get(roomId);
    if (existing) {
      clearTimeout(existing);
      runtime.typingStopTimers.delete(roomId);
    }
    sendTypingSignal(roomId, false, { force: true });
  }

  function handleComposerActivity(roomId, value) {
    if (!roomId) return;
    refreshPresenceFromInput();

    if (!String(value || "").trim()) {
      stopTypingForRoom(roomId);
      return;
    }

    sendTypingSignal(roomId, true);
    scheduleTypingStop(roomId);
  }

  function refreshPresenceFromInput() {
    const currentUser = getCurrentUser();
    if (!currentUser) return;

    const now = Date.now();
    currentUser.lastSeenAt = now;
    currentUser.loginState = "online";
    runtime.presenceSignals[currentUser.id] = {
      userId: currentUser.id,
      currentRoomId: uiState.activeRoomId || currentUser.currentRoomId || null,
      lastSeenAt: now,
      loginState: "online",
    };
    persistPresenceSnapshotIfNeeded(now);
    if (now - runtime.lastPresenceSignalAt >= 15000) {
      runtime.lastPresenceSignalAt = now;
      sendPresenceSignal(uiState.activeRoomId || currentUser.currentRoomId || null, { loginState: "online", lastSeenAt: now });
    }
  }

  async function sendPresenceSignal(roomId, options = {}) {
    const currentUser = getCurrentUser();
    if (!currentUser || !shouldUseTranslationBackend()) return;
    if (!options.force && options.loginState === "online" && Date.now() - runtime.lastPresenceSignalAt < 900 && roomId === currentUser.currentRoomId) {
      return;
    }

    try {
      await fetch("/api/presence", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId: currentUser.id,
          currentRoomId: roomId || null,
          lastSeenAt: Number(options.lastSeenAt || Date.now()),
          loginState: options.loginState === "offline" ? "offline" : "online",
        }),
      });
    } catch (error) {
      // Presence is best-effort and should not block messaging.
    }
  }

  async function sendTypingSignal(roomId, isTyping, options = {}) {
    const currentUser = getCurrentUser();
    if (!currentUser || !roomId || !shouldUseTranslationBackend()) return;

    const now = Date.now();
    const throttleKey = `${roomId}:${isTyping ? "start" : "stop"}`;
    if (!options.force && now - (runtime.lastTypingSignalAt[throttleKey] || 0) < CONFIG.typingSignalThrottleMs) {
      return;
    }
    runtime.lastTypingSignalAt[throttleKey] = now;

    try {
      await fetch(CONFIG.typingApiPath, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          roomId,
          userId: currentUser.id,
          name: currentUser.name,
          isTyping,
        }),
      });
    } catch (error) {
      // Keep typing indicators best-effort so message sending never blocks on this request.
    }
  }

  function updateBackendStatus(nextStatus) {
    const previous = runtime.backend;
    const merged = {
      ...previous,
      ...nextStatus,
    };
    const changed =
      previous.serverReachable !== merged.serverReachable ||
      previous.liveTranslationEnabled !== merged.liveTranslationEnabled ||
      previous.model !== merged.model ||
      previous.sharedStateEnabled !== merged.sharedStateEnabled ||
      previous.hasServerState !== merged.hasServerState ||
      previous.translationConfigured !== merged.translationConfigured ||
      previous.lastTranslationError !== merged.lastTranslationError ||
      previous.lastTranslationErrorDetail !== merged.lastTranslationErrorDetail;

    runtime.backend = merged;
    const becameRecoveryReady =
      (!previous.serverReachable && merged.serverReachable) ||
      (!previous.liveTranslationEnabled && merged.liveTranslationEnabled) ||
      (!previous.translationConfigured && merged.translationConfigured) ||
      (Boolean(previous.lastTranslationError) && !merged.lastTranslationError);
    if (becameRecoveryReady) {
      scheduleTranslationRecoveryScan();
    }
    return changed;
  }

  function scheduleTranslationRecoveryScan(delay = 420) {
    if (runtime.translationRecoveryTimer) {
      window.clearTimeout(runtime.translationRecoveryTimer);
    }
    runtime.translationRecoveryTimer = window.setTimeout(() => {
      runtime.translationRecoveryTimer = null;
      retryRecoverableTranslations();
    }, delay);
  }

  function retryRecoverableTranslations() {
    const currentUser = getCurrentUser();
    if (!currentUser || !runtime.backend.serverReachable || !runtime.backend.liveTranslationEnabled) {
      return;
    }
    const activeRoomId = uiState.activeRoomId || currentUser.currentRoomId || "";
    if (!activeRoomId) return;
    const room = appState.rooms.find((entry) => entry.id === activeRoomId);
    if (!room) return;

    room.messages.forEach((message) => {
      if (message?.kind !== "user" || !message.originalText) return;
      queueMissingViewerTranslation(room, message, currentUser);
    });
  }

  function isPushSupported() {
    return Boolean(runtime.push.supported && window.firebase && typeof window.firebase.messaging === "function");
  }

  function getPushPermissionState() {
    if (!(typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator && "PushManager" in window)) {
      return "unsupported";
    }
    return Notification.permission || "default";
  }

  function shouldAttemptPushTokenRegistration(permission = getPushPermissionState()) {
    if (permission === "granted") {
      return true;
    }
    return isStandaloneApp();
  }

  function syncPushPermissionState(options = {}) {
    const nextPermission = getPushPermissionState();
    const changed = runtime.push.permission !== nextPermission;
    runtime.push.permission = nextPermission;
    runtime.push.supported = nextPermission !== "unsupported";
    if (changed && options.render) {
      renderSafelyDuringInput();
    }
    return nextPermission;
  }

  function getPushStatusMeta() {
    const permission = syncPushPermissionState();
    if (permission === "granted") {
      return {
        stateKey: "pushPermissionGranted",
        helperKey: runtime.push.status === "error" ? "pushRegisterFailedCopy" : "pushPermissionGrantedHelp",
      };
    }
    if (permission === "denied") {
      return {
        stateKey: "pushPermissionDenied",
        helperKey: "pushPermissionBlockedHelp",
      };
    }
    if (permission === "unsupported") {
      return {
        stateKey: "pushPermissionUnsupported",
        helperKey: "pushRegisterFailedCopy",
      };
    }
    return {
      stateKey: "pushPermissionDefault",
      helperKey: "pushPermissionPendingHelp",
    };
  }

  async function fetchPushConfig(options = {}) {
    if (runtime.push.config && !options.force) {
      return runtime.push.config;
    }

    const response = await fetch(CONFIG.pushConfigApiPath, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Push config request failed with ${response.status}`);
    }

    const payload = await readJsonResponseBody(response);
    runtime.push.config = payload || null;
    return runtime.push.config;
  }

  async function registerPushServiceWorker() {
    if (runtime.push.serviceWorkerRegistration) {
      return runtime.push.serviceWorkerRegistration;
    }
    try {
      const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
      runtime.push.serviceWorkerRegistration = registration;
      return registration;
    } catch (error) {
      console.error("[push] service worker registration failed", error);
      throw error;
    }
  }

  async function ensurePushMessagingClient() {
    if (!isPushSupported()) {
      runtime.push.status = "unsupported";
      return null;
    }

    if (runtime.push.messaging && runtime.push.serviceWorkerRegistration) {
      return runtime.push.messaging;
    }

    if (runtime.push.initPromise) {
      return runtime.push.initPromise;
    }

    runtime.push.initPromise = (async () => {
      const config = await fetchPushConfig();
      if (!(config?.enabled && config?.webConfig)) {
        runtime.push.status = "unavailable";
        runtime.push.lastError = "push_not_configured";
        return null;
      }

      const serviceWorkerRegistration = await registerPushServiceWorker();
      const firebaseApi = window.firebase;
      if (!(firebaseApi && typeof firebaseApi.initializeApp === "function" && typeof firebaseApi.messaging === "function")) {
        throw new Error("firebase_messaging_sdk_missing");
      }

      if (!firebaseApi.apps?.length) {
        firebaseApi.initializeApp(config.webConfig);
      }

      runtime.push.serviceWorkerRegistration = serviceWorkerRegistration;
      runtime.push.messaging = firebaseApi.messaging();

      if (!runtime.push.foregroundBound) {
        runtime.push.messaging.onMessage((payload) => {
          handleForegroundPushPayload(payload);
        });
        runtime.push.foregroundBound = true;
      }

      runtime.push.initialized = true;
      runtime.push.status = "ready";
      runtime.push.lastError = "";
      return runtime.push.messaging;
    })()
      .catch((error) => {
        runtime.push.status = "error";
        runtime.push.lastError = String(error?.message || error || "push_init_failed");
        console.warn("[push] init failed", runtime.push.lastError);
        return null;
      })
      .finally(() => {
        runtime.push.initPromise = null;
        renderSafelyDuringInput();
      });

    return runtime.push.initPromise;
  }

  function normalizePushPayload(payload) {
    const data = payload?.data || payload || {};
    return {
      type: String(data?.type || "").trim(),
      roomId: String(data?.roomId || "").trim(),
      inviteId: String(data?.inviteId || "").trim(),
      senderId: String(data?.senderId || "").trim(),
      senderName: String(data?.senderName || "").trim(),
      previewText: String(data?.previewText || "").trim(),
      createdAt: Number(data?.createdAt || 0) || null,
      title: String(data?.title || "").trim(),
      body: String(data?.body || "").trim(),
      clickPath: String(data?.clickPath || "").trim(),
    };
  }

  async function registerPushTokenForCurrentUser(options = {}) {
    const currentUser = getCurrentUser();
    if (!currentUser) return false;

    const permission = syncPushPermissionState();
    if (!shouldAttemptPushTokenRegistration(permission)) {
      console.warn("[push] getToken skipped because notification permission is not granted", { permission });
      return false;
    }

    const messaging = await ensurePushMessagingClient();
    const registration = runtime.push.serviceWorkerRegistration || await registerPushServiceWorker();
    if (!(messaging && registration)) {
      return false;
    }

    try {
      const token = await messaging.getToken({
        vapidKey: FCM_VAPID_PUBLIC_KEY,
        serviceWorkerRegistration: registration,
      });

      console.log("FCM token:", token);

      if (!token) {
        runtime.push.status = "error";
        runtime.push.lastError = "push_token_missing";
        return false;
      }

      const cached = readCachedPushRegistration();
      const registeredRecently =
        cached.token === token &&
        cached.userId === currentUser.id &&
        Number(cached.registeredAt || 0) > 0 &&
        Date.now() - Number(cached.registeredAt || 0) < 6 * 60 * 60 * 1000;
      if (!options.force && registeredRecently) {
        persistCachedPushRegistration(currentUser.id, token, cached.registeredAt);
        runtime.push.status = "registered";
        return true;
      }

      const response = await fetch(CONFIG.pushRegisterApiPath, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId: currentUser.id,
          token,
          platform: "web",
          origin: window.location.origin,
        }),
      });

      if (!response.ok) {
        throw new Error(`push_register_failed_${response.status}`);
      }

      const payload = await readJsonResponseBody(response).catch(() => null);

      persistCachedPushRegistration(currentUser.id, token, payload?.registeredAt || Date.now());
      runtime.push.status = "registered";
      runtime.push.lastError = "";
      return true;
    } catch (error) {
      console.error("[push] getToken failed", error);
      runtime.push.status = "error";
      runtime.push.lastError = String(error?.message || error || "push_register_failed");
      console.warn("[push] register failed", runtime.push.lastError);
      return false;
    } finally {
      renderSafelyDuringInput();
    }
  }

  async function unregisterPushTokenForUser(user, options = {}) {
    const targetUser = user || getCurrentUser();
    const cached = readCachedPushRegistration();
    const cachedToken = options.token || cached.token || runtime.push.token;
    if (!(targetUser?.id && cachedToken)) {
      clearCachedPushRegistration();
      runtime.push.status = "idle";
      return;
    }

    try {
      await fetch(CONFIG.pushUnregisterApiPath, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId: targetUser.id,
          token: cachedToken,
        }),
      });
    } catch (error) {
      console.warn("[push] unregister failed", String(error?.message || error || "push_unregister_failed"));
    } finally {
      clearCachedPushRegistration();
      runtime.push.status = "idle";
      runtime.push.lastError = "";
      renderSafelyDuringInput();
    }
  }

  async function requestPushPermissionAndRegister() {
    if (!isPushSupported()) {
      runtime.push.status = "unsupported";
      renderSafelyDuringInput();
      return false;
    }

    const permission = syncPushPermissionState();
    if (permission === "denied") {
      renderSafelyDuringInput();
      return false;
    }

    const nextPermission = permission === "granted" ? "granted" : await Notification.requestPermission();
    syncPushPermissionState({ render: true });
    if (nextPermission !== "granted" && !isStandaloneApp()) {
      return false;
    }

    const registered = await registerPushTokenForCurrentUser({ force: true });
    if (registered) {
      pushToast("pushRegisterSuccessTitle", "pushRegisterSuccessCopy");
    } else {
      pushToast("pushRegisterFailedTitle", "pushRegisterFailedCopy");
    }
    return registered;
  }

  async function requestPushRegistrationRefresh() {
    const currentUser = getCurrentUser();
    if (!currentUser) return false;
    const permission = syncPushPermissionState();
    if (!shouldAttemptPushTokenRegistration(permission)) return false;

    const cached = readCachedPushRegistration();
    const cacheExpired = !cached.registeredAt || Date.now() - Number(cached.registeredAt || 0) >= 6 * 60 * 60 * 1000;
    const tokenMismatch = cached.userId !== currentUser.id || !cached.token;
    const shouldForce =
      tokenMismatch ||
      cacheExpired ||
      runtime.push.status === "error" ||
      runtime.push.tokenUserId !== currentUser.id ||
      !runtime.push.lastRegisterAt;
    const now = Date.now();
    if (!shouldForce && now - Number(runtime.push.lastRegisterAt || 0) < 15 * 1000) {
      return false;
    }
    if (runtime.push.refreshPromise) {
      return runtime.push.refreshPromise;
    }

    runtime.push.refreshPromise = registerPushTokenForCurrentUser({ force: shouldForce })
      .finally(() => {
        runtime.push.refreshPromise = null;
      });
    return runtime.push.refreshPromise;
  }

  async function syncNativePushBindingForCurrentUser(options = {}) {
    const currentUser = getCurrentUser();
    const installId = getNativePushInstallId();
    if (!(currentUser && installId)) return false;

    const cached = readNativePushInstallState();
    const boundRecently =
      cached.installId === installId &&
      cached.userId === currentUser.id &&
      Number(cached.boundAt || 0) > 0 &&
      Date.now() - Number(cached.boundAt || 0) < 6 * 60 * 60 * 1000;
    if (!options.force && boundRecently) {
      return true;
    }

    try {
      const response = await fetch(CONFIG.pushNativeBindApiPath, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId: currentUser.id,
          installId,
          origin: window.location.origin,
        }),
      });
      if (!response.ok) {
        throw new Error(`native_push_bind_failed_${response.status}`);
      }
      persistNativePushInstallState(installId, currentUser.id, Date.now());
      return true;
    } catch (error) {
      console.warn("[push-native] bind failed", error);
      return false;
    }
  }

  async function unbindNativePushInstallForUser(user) {
    const targetUser = user || getCurrentUser();
    const cached = readNativePushInstallState();
    const installId = cached.installId || runtime.push.nativeInstallId;
    if (!(targetUser?.id && installId)) {
      clearNativePushBinding({ preserveInstallId: true });
      return;
    }

    try {
      await fetch(CONFIG.pushNativeUnbindApiPath, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId: targetUser.id,
          installId,
        }),
      });
    } catch (error) {
      console.warn("[push-native] unbind failed", error);
    } finally {
      clearNativePushBinding({ preserveInstallId: true });
    }
  }

  function showLocalPushPreview(type, payload = {}) {
    const previewPayload =
      type === "invite"
        ? {
            type: "invite",
            senderName: "TRANSCHAT",
            previewText: "",
            title: t("pushToastInviteTitle"),
            body: t("pushToastInviteCopy", { name: "TRANSCHAT" }),
            inviteId: payload?.inviteId || "",
          }
        : {
            type: "message",
            senderName: "TRANSCHAT",
            previewText: "새 메시지 알림입니다.",
            title: t("pushToastMessageTitle"),
            body: t("pushToastMessageCopy", { name: "TRANSCHAT", preview: "새 메시지 알림입니다." }),
            roomId: payload?.roomId || "",
          };

    try {
      if (getPushPermissionState() === "granted" && typeof Notification !== "undefined") {
        const notification = new Notification(previewPayload.title, {
          body: previewPayload.body,
          tag: `push-test-${type}`,
        });
        window.setTimeout(() => notification.close(), 4000);
        return;
      }
    } catch (error) {
      console.warn("[push-test] local notification preview failed", error);
    }

    handleForegroundPushPayload(previewPayload);
  }

  function handleForegroundPushPayload(payload) {
    const normalized = normalizePushPayload(payload);
    if (!normalized.type) return;

    console.info("[push] foreground", normalized);
    if (
      normalized.type === "message" &&
      document.visibilityState === "visible" &&
      uiState.directoryTab === "chat" &&
      uiState.activeRoomId === normalized.roomId
    ) {
      return;
    }

    if (normalized.type === "invite") {
      pushToast("pushToastInviteTitle", "pushToastInviteCopy", {
        name: normalized.senderName || t("systemMessage"),
      });
      return;
    }

    if (normalized.type === "message") {
      pushToast("pushToastMessageTitle", "pushToastMessageCopy", {
        name: normalized.senderName || t("systemMessage"),
        preview: normalized.previewText || t("translationPendingInline"),
      });
    }
  }

  function navigateFromPushPayload(payload) {
    const normalized = normalizePushPayload(payload);
    if (!normalized.type) return;

    const currentUser = getCurrentUser();
    if (!currentUser) {
      runtime.push.pendingNavigation = normalized;
      return;
    }

    if (normalized.type === "message" && normalized.roomId) {
      const room = appState.rooms.find((entry) => entry.id === normalized.roomId && entry.status === "active");
      uiState.directoryTab = "chat";
      uiState.chatDetailsOpen = false;
      uiState.attachmentMenuOpen = false;
      uiState.modal = null;
      uiState.activeRoomId = room?.id || null;
      if (room) {
        markAllChatNotificationsSeen(currentUser.id);
        markUserPresence(room.id);
      }
      persistState();
      render();
      return;
    }

    if (normalized.type === "invite") {
      uiState.directoryTab = "friends";
      uiState.activeRoomId = null;
      uiState.chatDetailsOpen = false;
      uiState.attachmentMenuOpen = false;
      uiState.modal = null;
      markIncomingInvitesSeen(currentUser.id);
      markUserPresence(null);
      persistState();
      render();
    }
  }

  function consumePushNavigationFromLocation() {
    const url = new URL(window.location.href);
    const type = url.searchParams.get("pushType");
    if (!(type === "message" || type === "invite")) {
      return;
    }
    runtime.push.pendingNavigation = normalizePushPayload({
      type,
      roomId: url.searchParams.get("roomId") || "",
      inviteId: url.searchParams.get("inviteId") || "",
      clickPath: url.pathname + url.search,
    });
    url.searchParams.delete("pushType");
    url.searchParams.delete("roomId");
    url.searchParams.delete("inviteId");
    const nextSearch = url.searchParams.toString();
    window.history.replaceState({}, "", `${url.pathname}${nextSearch ? `?${nextSearch}` : ""}${url.hash}`);
  }

  function consumeNativeInstallIdFromLocation() {
    const url = new URL(window.location.href);
    const installId = String(url.searchParams.get("nativeInstallId") || "").trim();
    const runtimeSource = String(url.searchParams.get("nativeRuntime") || "").trim();
    if (!installId && !runtimeSource) {
      return;
    }

    if (installId) {
      const cached = readNativePushInstallState();
      if (cached.installId !== installId) {
        persistNativePushInstallState(installId);
      } else {
        runtime.push.nativeInstallId = installId;
      }
    }

    url.searchParams.delete("nativeInstallId");
    url.searchParams.delete("nativeRuntime");
    const nextSearch = url.searchParams.toString();
    window.history.replaceState({}, "", `${url.pathname}${nextSearch ? `?${nextSearch}` : ""}${url.hash}`);
  }

  function flushPendingPushNavigation() {
    if (!runtime.push.pendingNavigation) return;
    const payload = runtime.push.pendingNavigation;
    runtime.push.pendingNavigation = null;
    navigateFromPushPayload(payload);
  }

  async function refreshBackendStatus() {
    if (!shouldUseTranslationBackend()) {
      closeServerEvents();
      if (
        updateBackendStatus({
          serverReachable: false,
          liveTranslationEnabled: false,
          model: null,
          sharedStateEnabled: false,
          hasServerState: false,
          translationConfigured: false,
          lastTranslationError: "client_backend_unavailable",
          lastTranslationErrorDetail: "The page is not connected to the local Node backend.",
          checkedAt: Date.now(),
        })
      ) {
        renderSafelyDuringInput();
      }
      return;
    }

    try {
      const response = await fetch("/api/health", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Health check failed with ${response.status}`);
      }

      const payload = await response.json();
      console.info("[translation] health", {
        serverReachable: true,
        liveTranslationEnabled: Boolean(payload?.liveTranslationEnabled),
        translationConfigured: Boolean(payload?.translationConfigured),
        lastTranslationError: payload?.lastTranslationError || null,
      });
      if (
        updateBackendStatus({
          serverReachable: true,
          liveTranslationEnabled: Boolean(payload?.liveTranslationEnabled),
          model: payload?.model || null,
          sharedStateEnabled: Boolean(payload?.sharedStateEnabled),
          hasServerState: Boolean(payload?.hasServerState),
          translationConfigured: Boolean(payload?.translationConfigured),
          lastTranslationError: payload?.lastTranslationError || null,
          lastTranslationErrorDetail: payload?.lastTranslationErrorDetail || null,
          checkedAt: Date.now(),
        })
      ) {
        renderSafelyDuringInput();
      }
      initServerEvents();
    } catch (error) {
      console.warn("[translation] health failed", String(error?.message || error || "server_unreachable"));
      closeServerEvents();
      if (
        updateBackendStatus({
          serverReachable: false,
          liveTranslationEnabled: false,
          model: null,
          sharedStateEnabled: false,
          hasServerState: false,
          translationConfigured: false,
          lastTranslationError: "server_unreachable",
          lastTranslationErrorDetail: String(error?.message || error || "Server unreachable"),
          checkedAt: Date.now(),
        })
      ) {
        renderSafelyDuringInput();
      }
    }
  }

  async function mockTranslate(text, fromLanguage, targetLanguage) {
    // Front-end fallback used when the local Node translation server or OpenAI API is unavailable.
    await wait(320);
    const direct = findPhraseTranslation(text, targetLanguage);
    if (direct) return direct;

    const transformed = text
      .split(/(\s+)/)
      .map((part) => {
        if (/^\s+$/.test(part) || /^https?:\/\//i.test(part)) return part;
        const token = sanitizeToken(part);
        const mapped = TRANSLATION_MEMORY[token];
        if (!mapped) return part;
        return preserveCase(mapped[targetLanguage] || part, part);
      })
      .join("");

    if (transformed !== text) return transformed;
    const fallbackLabels = {
      ko: "번역본",
      en: "Translated message",
      vi: "Bản dịch",
    };
    const fallbackLabel = fallbackLabels[targetLanguage] || "Translated message";
    return `${fallbackLabel}: ${text}`;
  }

  function findPhraseTranslation(text, targetLanguage) {
    const normalized = sanitizeToken(text);
    return Object.values(TRANSLATION_MEMORY).find((entry) => entry?.[targetLanguage] && sanitizeToken(entry[targetLanguage]) === normalized)?.[targetLanguage] ||
      Object.values(TRANSLATION_MEMORY).find((entry) => entry?.en && sanitizeToken(entry.en) === normalized)?.[targetLanguage] ||
      Object.values(TRANSLATION_MEMORY).find((entry) => entry?.ko && sanitizeToken(entry.ko) === normalized)?.[targetLanguage] ||
      Object.values(TRANSLATION_MEMORY).find((entry) => entry?.vi && sanitizeToken(entry.vi) === normalized)?.[targetLanguage] ||
      null;
  }

  function sanitizeToken(value) {
    return String(value)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, "")
      .trim();
  }

  function preserveCase(output, original) {
    if (original === original.toUpperCase()) return output.toUpperCase();
    return output;
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function scheduleStatusProgression(roomId, messageId) {
    updateMessageStatus(roomId, messageId, "sent");
  }

  function updateMessageStatus(roomId, messageId, status) {
    const room = appState.rooms.find((item) => item.id === roomId);
    const message = room?.messages.find((item) => item.id === messageId);
    if (!message) return;
    message.status = status;
    persistState();
    render();
  }

  async function handleImageSelection(roomId, file) {
    const validation = validateSelectedImageFile(file, {
      maxBytes: CONFIG.imageMaxBytes,
      kind: "chat",
    });
    if (!validation.ok) {
      pushToast(validation.titleKey, validation.messageKey);
      return;
    }
    const existing = getDraft(roomId).attachment;
    releaseDraftAttachment(existing);
    setDraft(roomId, { processing: true });
    render();
    pushToast("imageCompressing", "imageCompressing");
    try {
      const attachment = await compressImage(file);
      setDraft(roomId, { attachment, processing: false });
    } catch (error) {
      setDraft(roomId, { attachment: null, processing: false });
      pushToast("toastMediaStorageFailed", "toastMediaStorageFailedCopy");
    }
    uiState.attachmentMenuOpen = false;
    render();
  }

  async function compressImage(file) {
    // The browser only processes the specific user-selected file; no broad device storage access is requested.
    const image = await loadImageForCanvas(file);
    const ratio = Math.min(1, CONFIG.imageMaxDimension / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * ratio));
    canvas.height = Math.max(1, Math.round(image.height * ratio));
    const context = canvas.getContext("2d");
    context.drawImage(image.source, 0, 0, canvas.width, canvas.height);
    const targetType = file.type === "image/png" ? "image/webp" : "image/jpeg";
    const optimizedBlob = await canvasToBlob(canvas, targetType, 0.82);
    image.cleanup();
    const { uploadedAt, expiresAt } = buildMediaExpiry();
    return {
      kind: "image",
      name: file.name,
      size: optimizedBlob.size,
      mimeType: optimizedBlob.type || targetType,
      blob: optimizedBlob,
      objectUrl: blobToObjectUrl(optimizedBlob),
      storage: "draft",
      uploadedAt,
      expiresAt,
      mediaId: uid("draft-media"),
    };
  }

  async function handleVideoSelection(roomId, file) {
    if (file.size > CONFIG.videoMaxBytes) {
      pushToast("videoTooLarge", "videoTooLarge");
      return;
    }
    const existing = getDraft(roomId).attachment;
    releaseDraftAttachment(existing);
    setDraft(roomId, { processing: true });
    render();
    pushToast("videoPreparing", "videoPreparing");
    try {
      const attachment = await prepareVideo(file);
      setDraft(roomId, { attachment, processing: false });
    } catch (error) {
      setDraft(roomId, { attachment: null, processing: false });
      pushToast("toastMediaStorageFailed", "toastMediaStorageFailedCopy");
    }
    uiState.attachmentMenuOpen = false;
    render();
  }

  function handleGenericFileSelection(roomId, file) {
    const existing = getDraft(roomId).attachment;
    releaseDraftAttachment(existing);
    setDraft(roomId, {
      attachment: {
        kind: "file",
        name: file.name,
        size: file.size,
        mimeType: file.type || "",
        blob: file,
      },
      processing: false,
    });
    uiState.attachmentMenuOpen = false;
    render();
  }

  async function prepareVideo(file) {
    const optimizedBlob = CONFIG.videoCompressionEnabled ? await compressVideo(file) : file;
    const { uploadedAt, expiresAt } = buildMediaExpiry();
    const optimizedName =
      String(optimizedBlob.type || "").includes("webm")
        ? (/\.[^.]+$/.test(file.name) ? file.name.replace(/\.[^.]+$/, "") : file.name) + ".webm"
        : file.name;
    return {
      kind: "video",
      name: optimizedName,
      size: optimizedBlob.size,
      mimeType: optimizedBlob.type || "video/webm",
      blob: optimizedBlob,
      objectUrl: blobToObjectUrl(optimizedBlob),
      storage: "draft",
      uploadedAt,
      expiresAt,
      mediaId: uid("draft-media"),
    };
  }

  async function compressVideo(file) {
    const compressed = await transcodeVideoToWebm(file).catch(() => null);
    if (compressed instanceof Blob && compressed.size > 0) {
      return compressed;
    }
    return file;
  }

  async function transcodeVideoToWebm(file) {
    if (typeof document === "undefined" || typeof MediaRecorder !== "function") {
      throw new Error("video_compression_unavailable");
    }

    const sourceUrl = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.src = sourceUrl;
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";

    await new Promise((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("video_metadata_failed"));
    });

    const drawRatio = Math.min(1, CONFIG.videoMaxDimension / Math.max(video.videoWidth || 1, video.videoHeight || 1));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round((video.videoWidth || 1) * drawRatio));
    canvas.height = Math.max(1, Math.round((video.videoHeight || 1) * drawRatio));
    const context = canvas.getContext("2d");
    if (!context) {
      URL.revokeObjectURL(sourceUrl);
      throw new Error("video_canvas_failed");
    }
    const capture = typeof video.captureStream === "function" ? video.captureStream() : typeof video.mozCaptureStream === "function" ? video.mozCaptureStream() : null;
    const outputStream = canvas.captureStream(24);
    if (capture) {
      capture.getAudioTracks().forEach((track) => outputStream.addTrack(track));
    }

    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
      ? "video/webm;codecs=vp9,opus"
      : MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")
        ? "video/webm;codecs=vp8,opus"
        : "video/webm";
    const chunks = [];
    const recorder = new MediaRecorder(outputStream, {
      mimeType,
      videoBitsPerSecond: CONFIG.videoTargetBitrate,
      audioBitsPerSecond: CONFIG.videoAudioBitrate,
    });

    let rafId = 0;
    const drawFrame = () => {
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      if (!video.paused && !video.ended) {
        rafId = requestAnimationFrame(drawFrame);
      }
    };

    return new Promise((resolve, reject) => {
      const fail = (error) => {
        cancelAnimationFrame(rafId);
        URL.revokeObjectURL(sourceUrl);
        video.pause();
        outputStream.getTracks().forEach((track) => track.stop());
        if (capture) {
          capture.getTracks().forEach((track) => track.stop());
        }
        reject(error);
      };
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size) {
          chunks.push(event.data);
        }
      };
      recorder.onerror = () => fail(new Error("video_record_failed"));
      recorder.onstop = () => {
        cancelAnimationFrame(rafId);
        URL.revokeObjectURL(sourceUrl);
        video.pause();
        outputStream.getTracks().forEach((track) => track.stop());
        if (capture) {
          capture.getTracks().forEach((track) => track.stop());
        }
        const blob = new Blob(chunks, { type: mimeType });
        if (blob.size) {
          resolve(blob);
          return;
        }
        reject(new Error("video_blob_empty"));
      };
      video.onended = () => {
        if (recorder.state !== "inactive") {
          recorder.stop();
        }
      };

      recorder.start(600);
      video.currentTime = 0;
      video.play().then(() => {
        drawFrame();
      }).catch(fail);
    });
  }

  function handleInviteSubmit() {
    if (!uiState.modal || uiState.modal.type !== "invite") return;
    const currentUser = getCurrentUser();
    const room = appState.rooms.find((item) => item.id === uiState.activeRoomId);
    if (!currentUser || !room) return;
    const name = normalizeDisplayText(uiState.modal.data.name).trim();
    const invitee = appState.users.find((user) => normalizeDisplayText(user.name).toLowerCase() === name.toLowerCase());

    if (room.status === "expired") {
      uiState.modal.data.error = t("inviteExpiredError");
      render();
      return;
    }
    if (!invitee) {
      uiState.modal.data.error = t("inviteUserMissing");
      render();
      return;
    }
    if (invitee.id === currentUser.id) {
      uiState.modal.data.error = t("inviteSelfError");
      render();
      return;
    }
    const duplicate = appState.invites.find(
      (invite) => invite.roomId === room.id && invite.inviteeId === invitee.id && invite.status === "pending"
    );
    if (duplicate) {
      uiState.modal.data.error = t("inviteDuplicateError");
      render();
      return;
    }

    const invite = {
      id: uid("invite"),
      roomId: room.id,
      inviterId: currentUser.id,
      inviteeId: invitee.id,
      type: "room",
      previewRoomTitle: normalizeDisplayText(room.title),
      status: "pending",
      createdAt: Date.now(),
      respondedAt: null,
      seenByInvitee: false,
    };
    appState.invites.unshift(invite);
    room.messages.push(systemMessage(uid("sys"), "systemUserInvited", { inviter: currentUser.name, invitee: invitee.name }, Date.now()));
    room.unreadByUser[invitee.id] = (room.unreadByUser[invitee.id] || 0) + 1;
    uiState.modal = null;
    persistState();
    pushToast("toastInviteSent", "toastInviteSentCopy", { name: invitee.name });
    render();
  }

  function respondInvite(inviteId, response) {
    const invite = appState.invites.find((item) => item.id === inviteId);
    const currentUser = getCurrentUser();
    if (!invite || !currentUser) return;
    let room = invite.roomId ? appState.rooms.find((item) => item.id === invite.roomId) : null;
    invite.status = response === "accept" ? "accepted" : "rejected";
    invite.respondedAt = Date.now();
    invite.seenByInvitee = true;
    if (response === "accept") {
      if (invite.type === "connection" && !room) {
        const inviter = appState.users.find((user) => user.id === invite.inviterId);
        if (!inviter) {
          return;
        }
        room = createAcceptedConnectionRoom(inviter, currentUser, Date.now());
        invite.roomId = room.id;
        invite.previewRoomTitle = room.title;
      }
      if (!room) return;
      ensureParticipant(room, currentUser.id);
      room.accessByUser[currentUser.id] = true;
      if (invite.type !== "connection") {
        room.messages.push(systemMessage(uid("sys"), "systemInviteAccepted", { name: currentUser.name }, Date.now()));
      }
      currentUser.currentRoomId = room.id;
      uiState.activeRoomId = room.id;
      uiState.directoryTab = "chat";
      uiState.chatDetailsOpen = false;
      uiState.attachmentMenuOpen = false;
      pushToast("toastInviteAccepted", "toastInviteAcceptedCopy", { name: currentUser.name });
    } else {
      if (room) {
        room.messages.push(systemMessage(uid("sys"), "systemInviteRejected", { name: currentUser.name }, Date.now()));
      }
      pushToast("toastInviteRejected", "toastInviteRejectedCopy", { name: currentUser.name });
    }
    syncUserAlertState();
    persistState();
    render();
    if (response === "accept") {
      markUserPresence(room.id);
      scheduleReceiptRefresh({ force: true, delay: 0 });
    }
  }

  // Keep invite cards usable for connection-only invites that do not create a real room until acceptance.
  function renderInviteCard(invite) {
    const inviter = appState.users.find((user) => user.id === invite.inviterId);
    return `
      <article class="invite-card">
        <strong>${escapeHtml(getInviteDisplayTitle(invite))}</strong>
        <span>${escapeHtml(getUserDisplayName(inviter) || inviter?.loginId || "—")} · ${escapeHtml(formatRelativeTime(invite.createdAt))}</span>
        <div class="invite-row" style="margin-top: 12px;">
          ${invite.status === "pending"
            ? `
                <button class="button button-primary" data-action="respond-invite" data-invite-id="${invite.id}" data-response="accept">${escapeHtml(t("acceptInvite"))}</button>
                <button class="button button-danger" data-action="respond-invite" data-invite-id="${invite.id}" data-response="reject">${escapeHtml(t("rejectInvite"))}</button>
              `
            : `<span class="status-pill ${invite.status === "accepted" ? "pill-success" : "pill-danger"}">${escapeHtml(invite.status === "accepted" ? t("inviteAccepted") : t("inviteRejected"))}</span>`}
        </div>
      </article>
    `;
  }

  function openMessageMedia(messageId) {
    const room = appState.rooms.find((item) => item.id === uiState.activeRoomId);
    const message = room?.messages.find((item) => item.id === messageId);
    if (!message?.media) return;
    if (message.media.storage === "indexeddb") {
      ensureIndexedMediaLoaded(message.media);
    }
    if (message.media.kind === "video" && message.media.storage !== "indexeddb" && !resolveMediaSource(message.media)) {
      pushToast("toastMediaMissing", "toastMediaMissingCopy");
    }
    uiState.previewMedia = message.media;
    uiState.modal = { type: "media" };
    render();
  }

  function checkRoomExpirations() {
    if (!CONFIG.roomAutoExpirationEnabled) {
      return;
    }
    const expiredRooms = appState.rooms.filter((room) => {
      if (room.status === "expired" || room.disableExpiration) return false;
      const lastActivity = room.lastMessageAt || room.createdAt;
      return Date.now() - lastActivity >= CONFIG.roomExpireMs;
    });

    if (expiredRooms.length) {
      expiredRooms.forEach((room) => expireRoom(room));
      persistState();
      render();
    }
  }

  function expireRoom(room) {
    // Policy alignment: expiration must remove both the room UI and its stored message/media payloads in the same path.
    const title = room.title;
    deleteRoom(room.id);
    uiState.activeRoomId = null;
    uiState.directoryTab = "chat";
    pushToast("toastRoomExpired", "toastRoomExpiredCopy", { title });
  }

  function syncViewport() {
    const visual = window.visualViewport;
    const layoutViewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const viewportHeight = visual ? visual.height : layoutViewportHeight;
    const viewportBottom = visual ? visual.height + visual.offsetTop : viewportHeight;
    const keyboardClosed = !visual || viewportBottom >= layoutViewportHeight - 24;
    if (!runtime.viewportBaseHeight || keyboardClosed) {
      runtime.viewportBaseHeight = Math.max(viewportBottom, layoutViewportHeight, viewportHeight);
    } else {
      runtime.viewportBaseHeight = Math.max(runtime.viewportBaseHeight, viewportBottom, layoutViewportHeight, viewportHeight);
    }
    runtime.keyboardOffset = Math.max(0, runtime.viewportBaseHeight - viewportBottom);
    document.documentElement.style.setProperty("--app-height", `${viewportHeight}px`);
    document.documentElement.style.setProperty("--keyboard-offset", `${runtime.keyboardOffset}px`);
    if (runtime.viewportSyncFrame) {
      cancelAnimationFrame(runtime.viewportSyncFrame);
    }
    runtime.viewportSyncFrame = requestAnimationFrame(() => {
      runtime.viewportSyncFrame = 0;
      updateChatLayoutMetrics();
    });
  }

  function bindGlobalListeners() {
    APP_ROOT.addEventListener("click", onRootClick);
    APP_ROOT.addEventListener("input", onRootInput);
    APP_ROOT.addEventListener("focusin", onRootFocusIn);
    APP_ROOT.addEventListener("scroll", onRootScroll, true);
    APP_ROOT.addEventListener("keydown", onRootKeyDown);
    APP_ROOT.addEventListener("compositionstart", onRootCompositionStart);
    APP_ROOT.addEventListener("compositionupdate", onRootCompositionUpdate);
    APP_ROOT.addEventListener("compositionend", onRootCompositionEnd);
    APP_ROOT.addEventListener("change", onRootChange);
    APP_ROOT.addEventListener("submit", onRootSubmit);
    if (!runtime.historyBound) {
      window.addEventListener("popstate", onWindowPopState);
      runtime.historyBound = true;
    }
    if (!runtime.pwa.listenersBound) {
      window.addEventListener("beforeinstallprompt", (event) => {
        event.preventDefault();
        runtime.pwa.deferredPrompt = event;
        syncPwaInstallState({ render: true });
      });
      window.addEventListener("appinstalled", () => {
        runtime.pwa.deferredPrompt = null;
        runtime.pwa.installed = true;
        pushToast("pwaInstalledToastTitle", "pwaInstalledToastCopy");
        syncPwaInstallState({ render: true });
      });
      window.matchMedia?.("(display-mode: standalone)")?.addEventListener?.("change", () => {
        syncPwaInstallState({ render: true });
      });
      runtime.pwa.listenersBound = true;
    }
    syncPushPermissionState();
    if ("serviceWorker" in navigator && !runtime.push.swMessageBound) {
      navigator.serviceWorker.addEventListener("message", (event) => {
        if (event.data?.type === "transchat-push-click") {
          runtime.push.pendingNavigation = normalizePushPayload(event.data.payload || {});
          flushPendingPushNavigation();
        }
      });
      runtime.push.swMessageBound = true;
    }
    window.addEventListener("resize", syncViewport);
    window.addEventListener("orientationchange", () => {
      syncViewport();
      keepChatBottomVisible(true);
    });
    window.addEventListener("focus", () => {
      syncPushPermissionState({ render: true });
      void requestPushRegistrationRefresh();
      void syncNativePushBindingForCurrentUser();
      void refreshServerStateAfterResume({ renderIfUnchanged: true });
    });
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", syncViewport);
      window.visualViewport.addEventListener("scroll", syncViewport);
    }
    window.addEventListener("storage", (event) => {
      if (event.key === STORAGE_KEY && event.newValue) {
        try {
          const parsed = normalizeLoadedState(JSON.parse(event.newValue));
          if (parsed) {
            applyStateSnapshot(parsed, { source: "storage", skipPersist: true });
          }
        } catch (error) {
          console.warn("Failed to sync storage state", error);
        }
      }
    });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        syncPushPermissionState();
        void requestPushRegistrationRefresh();
        void syncNativePushBindingForCurrentUser();
        syncPwaInstallState();
        markUserPresence(uiState.activeRoomId);
        checkRoomExpirations();
        cleanupExpiredChatMedia();
        refreshStorageEstimate();
        scheduleReceiptRefresh({ force: true, delay: 0 });
        flushPendingPushNavigation();
        void refreshServerStateAfterResume({ renderIfUnchanged: true });
        return;
      }
      persistPresenceSnapshotIfNeeded(Date.now(), { force: true });
    });
    window.addEventListener("pageshow", () => {
      if (document.hidden) return;
      void refreshServerStateAfterResume({ renderIfUnchanged: true });
    });
    window.addEventListener("pagehide", () => {
      const timestamp = Date.now();
      persistPresenceSnapshotIfNeeded(timestamp, { force: true, offline: true });
      sendPresenceSignal(null, { force: true, loginState: "offline", lastSeenAt: timestamp });
    });
  }

  function initRealtimeSync() {
    if (typeof BroadcastChannel !== "function") return;

    runtime.syncChannel = new BroadcastChannel("transchat-state-sync-v1");
    runtime.syncChannel.addEventListener("message", (event) => {
      if (event.data?.type !== "state-updated" || event.data?.sourceId === runtime.clientId) {
        return;
      }
      applyPersistedState();
    });
  }

  function initServerEvents() {
    if (
      runtime.eventSource ||
      typeof EventSource !== "function" ||
      !shouldUseTranslationBackend() ||
      !runtime.backend.serverReachable
    ) {
      return;
    }

    runtime.eventSource = new EventSource(CONFIG.eventsApiPath);
    runtime.eventSource.addEventListener("open", () => {
      runtime.serverEventsConnected = true;
      void pollServerStateIfNeeded({ force: true });
      renderSafelyDuringInput();
    });
    runtime.eventSource.addEventListener("state-updated", async (event) => {
      let payload = null;
      try {
        payload = JSON.parse(event.data);
      } catch (error) {
        payload = null;
      }

      if (payload?.sourceId === runtime.clientId) {
        return;
      }

      const serverState = await fetchServerState();
      if (!serverState) return;
      if (getStateTimestamp(serverState) <= Number(runtime.lastAppliedServerStateAt || 0)) return;
      applyStateSnapshot(serverState, { source: "server" });
    });
    runtime.eventSource.addEventListener("typing-updated", (event) => {
      let payload = null;
      try {
        payload = JSON.parse(event.data);
      } catch (error) {
        payload = null;
      }

      if (!payload) return;
      const currentUser = getCurrentUser();
      if (payload.userId && currentUser && payload.userId === currentUser.id) {
        return;
      }
      if (updateTypingSignal(payload)) {
        renderSafelyDuringInput();
      }
    });
    runtime.eventSource.addEventListener("presence-updated", (event) => {
      let payload = null;
      try {
        payload = JSON.parse(event.data);
      } catch (error) {
        payload = null;
      }

      if (!payload?.userId) return;
      const currentUser = getCurrentUser();
      if (currentUser && payload.userId === currentUser.id) {
        return;
      }
      runtime.presenceSignals[payload.userId] = {
        userId: payload.userId,
        currentRoomId: payload.currentRoomId || null,
        lastSeenAt: Number(payload.lastSeenAt || Date.now()),
        loginState: payload.loginState === "offline" ? "offline" : "online",
      };
      renderSafelyDuringInput();
    });
    runtime.eventSource.addEventListener("error", () => {
      runtime.serverEventsConnected = false;
      closeServerEvents();
      void pollServerStateIfNeeded({ force: true });
      renderSafelyDuringInput();
    });
  }

  function closeServerEvents() {
    if (runtime.eventSource) {
      runtime.eventSource.close();
      runtime.eventSource = null;
    }
    runtime.serverEventsConnected = false;
  }

  function startRuntimeLoops() {
    clearInterval(runtime.countdownInterval);
    clearInterval(runtime.relativeTimer);
    clearInterval(runtime.heartbeatTimer);
    clearInterval(runtime.healthTimer);
    clearInterval(runtime.mediaCleanupTimer);
    clearInterval(runtime.serverStatePollTimer);
    runtime.countdownInterval = setInterval(() => {
      if (pruneTypingSignals()) {
        renderSafelyDuringInput();
      }
      if (prunePresenceSignals()) {
        renderSafelyDuringInput();
      }
      if (uiState.modal?.type === "password") {
        renderSafelyDuringInput();
      }
    }, 1000);
    runtime.relativeTimer = setInterval(() => {
      checkRoomExpirations();
      renderSafelyDuringInput();
    }, 30000);
    runtime.heartbeatTimer = setInterval(() => {
      markUserPresence(uiState.activeRoomId);
    }, CONFIG.heartbeatMs);
    runtime.healthTimer = setInterval(() => {
      refreshBackendStatus();
    }, 15000);
    runtime.mediaCleanupTimer = setInterval(() => {
      cleanupExpiredChatMedia();
      refreshStorageEstimate();
    }, CONFIG.mediaCleanupIntervalMs);
    runtime.serverStatePollTimer = setInterval(() => {
      if (!getCurrentUser() || runtime.serverEventsConnected) return;
      void pollServerStateIfNeeded();
    }, 1200);
  }

  async function bootApplication() {
    try {
      console.info("[transchat] bootstrap:start");
      const cachedPushRegistration = readCachedPushRegistration();
      runtime.push.token = cachedPushRegistration.token;
      runtime.push.tokenUserId = cachedPushRegistration.userId;
      runtime.push.nativeInstallId = readNativePushInstallState().installId || "";
      syncPushPermissionState();
      syncPwaInstallState();
      consumeNativeInstallIdFromLocation();
      consumePushNavigationFromLocation();
      restoreAutoLoginSession({ clearOnMissing: false });
      const currentUser = getCurrentUser();
      if (currentUser) {
        uiState.activeRoomId = currentUser.currentRoomId || null;
        uiState.directoryTab = "chat";
        uiState.chatDetailsOpen = false;
        uiState.attachmentMenuOpen = false;
        markUserPresence(uiState.activeRoomId);
      }

      bindGlobalListeners();
      try {
        await registerPushServiceWorker();
        runtime.pwa.swRegistered = true;
      } catch (error) {
        runtime.pwa.swRegistered = false;
        console.warn("[pwa] service worker registration failed", error);
      }
      initRealtimeSync();
      startRuntimeLoops();
      checkRoomExpirations();
      cleanupExpiredChatMedia();
      refreshStorageEstimate();
      refreshBackendStatus();
      console.info("[transchat] bootstrap:render");
      render();
      await bootstrapServerState();
      if (getCurrentUser()) {
        void requestPushRegistrationRefresh();
        void syncNativePushBindingForCurrentUser();
      }
      flushPendingPushNavigation();
      console.info("[transchat] bootstrap:complete");
    } catch (error) {
      reportBootstrapError(error, "bootstrap");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      bootApplication();
    }, { once: true });
  } else {
    bootApplication();
  }
})();
