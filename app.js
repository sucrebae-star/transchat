(function () {
  const STORAGE_KEY = "transchat-prototype-state-v1";
  const SESSION_USER_KEY = "transchat-active-user-v1";
  const LANDING_UI_KEY = "transchat-landing-ui-v1";
  const CONFIG = {
    roomExpireMs: 30 * 60 * 1000,
    passwordAttemptLimit: 5,
    passwordLockMs: 90 * 1000,
    freeDailyMessageLimit: 30,
    freeResetHour: 7,
    monthlyPlanPrice: 9900,
    yearlyPlanPrice: 99000,
    premiumSoftLimit: 600,
    premiumHardLimit: 900,
    abuseGuardMessage: "planPremiumAbuseGuardCopy",
    planPolicyVersion: "2026-04-preview",
    imageMaxBytes: 10 * 1024 * 1024,
    profileImageMaxBytes: 5 * 1024 * 1024,
    videoMaxBytes: 50 * 1024 * 1024,
    allowedImageMimeTypes: ["image/jpeg", "image/png", "image/webp"],
    heartbeatMs: 30 * 1000,
    typingIdleMs: 1600,
    typingSignalThrottleMs: 700,
    typingSignalTtlMs: 4500,
    translationApiPath: "/api/translate",
    stateApiPath: "/api/state",
    eventsApiPath: "/api/events",
    typingApiPath: "/api/typing",
    // Private test gate for now; replace with provider-backed auth when Google or magic-link login is added.
    accessGateMode: "whitelist",
  };
  // Edit this allowlist during private testing; later move the same rule to authenticated server-side identities.
  const PRIVATE_TEST_ALLOWLIST = new Set(["현태", "배현태", "호아", "hoa"].map((value) => value.trim().toLowerCase()));

  const PRIVATE_TEST_GATE_NAMES = new Set(["hoa", "현태", "admin"].map((value) => String(value || "").trim().toLowerCase()));
  const UNLIMITED_TESTER_NAMES = new Set(["hoa", "현태"].map((value) => String(value || "").trim().toLowerCase()));
  const BUILT_IN_ADMIN_ACCOUNT = Object.freeze({
    loginId: "admin",
    password: "0694",
    name: "Admin",
    nativeLanguage: "ko",
    uiLanguage: "ko",
  });

  const APP_ROOT = document.getElementById("app");
  const runtime = {
    clientId: `client-${Math.random().toString(36).slice(2, 10)}`,
    videoUrls: new Map(),
    statusTimers: new Map(),
    toastTimers: new Map(),
    typingStopTimers: new Map(),
    syncChannel: null,
    countdownInterval: null,
    relativeTimer: null,
    heartbeatTimer: null,
    healthTimer: null,
    serverSyncTimer: null,
    softRenderTimer: null,
    eventSource: null,
    serverEventsConnected: false,
    compositionActive: false,
    compositionTarget: null,
    pendingRenderWhileComposing: false,
    lastComposerInputAt: 0,
    chatPinnedToBottom: true,
    composerHeight: 0,
    viewportBaseHeight: 0,
    keyboardOffset: 0,
    preservedScrollPositions: {},
    receiptTimer: null,
    typingSignals: {},
    presenceSignals: {},
    lastTypingSignalAt: {},
    lastPresenceSignalAt: 0,
    lastPresencePersistAt: 0,
    backend: {
      serverReachable: false,
      liveTranslationEnabled: false,
      model: null,
      sharedStateEnabled: false,
      hasServerState: false,
      checkedAt: 0,
    },
  };

  const uiState = {
    activeRoomId: null,
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

  const LOCALES = {
    ko: "ko-KR",
    en: "en-US",
    vi: "vi-VN",
  };

  const DEMO_USER_NAMES = new Set(["Hana", "Alex", "Linh", "Yuna"]);
  const DEMO_ROOM_IDS = new Set(["room-lounge", "room-travel", "room-brainstorm"]);
  const DEMO_ROOM_TITLES = new Set(["Global Lounge", "Weekend Passport", "Night Shift Ideas"]);
  const PERSISTENT_ROOM_TITLE_KEYS = new Set(["호아와현태", "호아와현태의방"]);

  const DICTIONARY = {};

  DICTIONARY.ko = {
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
    landingPanelCopy: "UI 언어와 채팅 모국어를 분리해서 설정한 뒤 로컬 브라우저에서 전체 플로우를 테스트할 수 있습니다.",
    labelUsername: "사용자 이름",
    labelNativeLanguage: "채팅 모국어",
    labelUiLanguage: "UI 언어",
    placeholderUsername: "예: 민수",
    helperUsername: "같은 이름이 이미 있으면 자동으로 숫자 접미사가 붙습니다.",
    enterButton: "입장하기",
    demoUsersLabel: "기본 데모 사용자",
    demoUsersValue: "Hana, Alex, Linh, Yuna",
    topbarStatus: "로컬 브라우저 테스트 가능",
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
    chatWelcomeCopy: "왼쪽 목록에서 방을 선택하면 메시지, 번역, 초대, 만료 흐름을 바로 테스트할 수 있습니다.",
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
    settingsCopy: "UI 언어, 모국어, 테마, 테스트 도구를 바로 바꿀 수 있습니다.",
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

  DICTIONARY.en = {
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
    landingPanelCopy: "Set UI language and chat native language separately, then test the full local browser flow.",
    labelUsername: "User name",
    labelNativeLanguage: "Native chat language",
    labelUiLanguage: "UI language",
    placeholderUsername: "Example: Minsu",
    helperUsername: "If the name already exists, a numeric suffix is added automatically.",
    enterButton: "Enter",
    demoUsersLabel: "Seeded demo users",
    demoUsersValue: "Hana, Alex, Linh, Yuna",
    topbarStatus: "Runs locally in the browser",
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
    chatWelcomeCopy: "Pick a room from the list to test messaging, translation, invites, and expiration behavior.",
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
    settingsCopy: "Change UI language, native language, theme, and test tools instantly.",
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

  DICTIONARY.vi = {
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
    landingPanelCopy: "Đặt riêng ngôn ngữ giao diện và ngôn ngữ mẹ đẻ trong chat, sau đó thử toàn bộ luồng trên trình duyệt.",
    labelUsername: "Tên người dùng",
    labelNativeLanguage: "Ngôn ngữ mẹ đẻ trong chat",
    labelUiLanguage: "Ngôn ngữ giao diện",
    placeholderUsername: "Ví dụ: Minsu",
    helperUsername: "Nếu tên đã tồn tại, hệ thống sẽ tự thêm hậu tố số.",
    enterButton: "Vào",
    demoUsersLabel: "Người dùng mẫu",
    demoUsersValue: "Hana, Alex, Linh, Yuna",
    topbarStatus: "Chay truc tiep tren trinh duyet",
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
    chatWelcomeCopy: "Chon mot phong de thu nhan tin, dich, loi moi va han tu dong.",
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
    settingsCopy: "Doi ngon ngu giao dien, ngon ngu me de, giao dien sang toi va cong cu thu nghiem ngay lap tuc.",
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
    toastAccessDenied: "테스트 허용 사용자만 입장할 수 있습니다",
    toastAccessDeniedCopy: "화이트리스트에 등록된 이름으로만 테스트 입장이 가능합니다.",
    landingAccessHint: "현재 테스트 단계이므로 허용된 사용자만 입장할 수 있습니다.",
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
    toastAccessDenied: "Only approved testers can enter",
    toastAccessDeniedCopy: "This private test currently allows a small whitelist of user names.",
    landingAccessHint: "This private test is limited to approved users only.",
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
    toastAccessDenied: "Chi nguoi dung duoc phep moi vao duoc",
    toastAccessDeniedCopy: "Ban thu rieng nay chi cho phep mot danh sach ten cu the.",
    landingAccessHint: "Ban thu hien chi cho phep nhung nguoi dung da duoc phep.",
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
      ko: "번역 품질 테스트 중입니다",
      en: "We are testing translation quality",
      vi: "Chung ta dang thu chat luong dich",
    },
  };

  let appState = loadState();
  ensureSystemAccounts();
  syncUsageWindows();
  syncUserAlertState();

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
    roomDeleteConfirm: "방장이 나가면 대화방과 내용이 모두 삭제됩니다. 계속할까요?",
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
    roomDeleteConfirm: "If the creator leaves, this room and all of its contents are deleted. Continue?",
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
    roomDeleteConfirm: "Neu chu phong roi di, phong va toan bo noi dung se bi xoa. Tiep tuc?",
  });

  // Added: login/signup/profile copy for the dedicated auth screens and compact profile editing flow.
  Object.assign(DICTIONARY.ko, {
    landingNamePlaceholderSimple: "아이디를 작성하세요",
    landingAuthSecondaryHint: "테스트 계정으로 간단히 로그인할 수 있습니다.",
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
    landingAuthSecondaryHint: "Log in quickly with a private test account.",
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
    landingAuthSecondaryHint: "Dang nhap nhanh bang tai khoan thu nghiem rieng.",
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
    adminAccountDeleteConfirm: "이 계정을 삭제하면 관련 정보도 함께 삭제됩니다.",
    adminRoomDeleteConfirm: "이 대화방과 모든 메시지를 삭제합니다. 계속할까요?",
    toastAccountDeleted: "계정이 삭제되었습니다",
    toastAccountDeletedCopy: "{name} 계정과 관련 데이터가 삭제되었습니다.",
    toastAdminSelfDeleteBlocked: "관리자 본인은 삭제할 수 없습니다",
    toastAdminSelfDeleteBlockedCopy: "admin 계정은 직접 삭제할 수 없습니다.",
    planUnlimitedTesterCopy: "테스트용 무제한 예외 계정",
  });

  Object.assign(DICTIONARY.en, {
    adminDeleteUserButton: "Delete account",
    adminDeleteRoomButton: "Delete room",
    adminAccountDeleteConfirm: "Deleting this account also removes related data.",
    adminRoomDeleteConfirm: "Delete this room and all of its messages?",
    toastAccountDeleted: "Account deleted",
    toastAccountDeletedCopy: "{name} and related data were deleted.",
    toastAdminSelfDeleteBlocked: "You cannot delete the admin account",
    toastAdminSelfDeleteBlockedCopy: "The admin account cannot delete itself.",
    planUnlimitedTesterCopy: "Unlimited tester bypass account",
  });

  Object.assign(DICTIONARY.vi, {
    adminDeleteUserButton: "Xoa tai khoan",
    adminDeleteRoomButton: "Xoa phong",
    adminAccountDeleteConfirm: "Neu xoa tai khoan nay, du lieu lien quan cung se bi xoa.",
    adminRoomDeleteConfirm: "Xoa phong chat nay va toan bo tin nhan?",
    toastAccountDeleted: "Da xoa tai khoan",
    toastAccountDeletedCopy: "Tai khoan {name} va du lieu lien quan da bi xoa.",
    toastAdminSelfDeleteBlocked: "Khong the xoa tai khoan admin",
    toastAdminSelfDeleteBlockedCopy: "Tai khoan admin khong the tu xoa chinh no.",
    planUnlimitedTesterCopy: "Tai khoan test khong gioi han",
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

  function loadState() {
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
    if (!(parsed && parsed.version === 1)) {
      return null;
    }

    return sanitizeAppState(parsed);
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
      version: 1,
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
    const isUnlimitedTester = isUnlimitedTesterName(normalizedName);
    return {
      id: uid("user"),
      loginId: normalizedLoginId,
      name: normalizedName,
      nickname: normalizeDisplayText(accountOptions.nickname || "").trim(),
      gender: accountOptions.gender === "female" ? "female" : accountOptions.gender === "male" ? "male" : "",
      age: Number(accountOptions.age || 0) || "",
      profileImage,
      isAdmin,
      isUnlimitedTester,
      canBypassUsageLimit: isAdmin || isUnlimitedTester,
      // Future auth expansion point: replace test-name identity with Google, magic-link, or phone-backed identities.
      auth: {
        provider: "test-name",
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
      planTier: ["monthly", "yearly"].includes(accountOptions.planTier) ? accountOptions.planTier : "free",
      usage: sanitizeUsageState(accountOptions.usage, joinedAt),
      planUpdatedAt: Number(accountOptions.planUpdatedAt || joinedAt),
      planPolicyAcknowledgedAt: Number(accountOptions.planPolicyAcknowledgedAt || 0) || null,
      recoveryQuestionKey: accountOptions.recoveryQuestionKey || getDeterministicRecoveryQuestionKey(normalizedName),
      recoveryAnswer: normalizeRecoveryAnswer(
        accountOptions.recoveryAnswer != null ? accountOptions.recoveryAnswer : normalizedName
      ),
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
      sourceLanguage,
      translations,
      status,
      media,
      deliveredTo: {},
      readBy: {},
    };
  }

  function sanitizeMessageState(message, allowedUserIds) {
    if (!message || message.kind !== "user") {
      return message;
    }

    return {
      ...message,
      status: ["composing", "sent", "delivered", "read"].includes(message.status) ? message.status : "sent",
      deliveredTo: filterRecordByAllowedKeys(message.deliveredTo, allowedUserIds),
      readBy: filterRecordByAllowedKeys(message.readBy, allowedUserIds),
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
      version: 1,
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
      settings: {
        theme: parsed?.settings?.theme || "system",
      },
      deletedUsers,
      deletedRooms,
      updatedAt: Number(parsed.updatedAt || Date.now()),
    };

    const users = (parsed.users || [])
      .filter((user) => !deletedUserIds.has(user.id) && !isDemoUser(user))
      .map((user) => {
        const normalizedLoginId = normalizeAccountId(user?.loginId || user?.name);
        const normalizedName = normalizeDisplayText(user.name);
        const isAdmin = Boolean(user?.isAdmin) || isAdminLoginId(normalizedLoginId);
        const isUnlimitedTester = isUnlimitedTesterName(normalizedName);
        return {
          ...user,
          loginId: normalizedLoginId,
          name: normalizedName,
          nickname: normalizeDisplayText(user?.nickname || "").trim(),
          gender: user?.gender === "female" ? "female" : user?.gender === "male" ? "male" : "",
          age: Number(user?.age || 0) || "",
          isAdmin,
          isUnlimitedTester,
          canBypassUsageLimit: isAdmin || isUnlimitedTester,
          auth: {
            provider: user?.auth?.provider || "test-name",
            subject: user?.auth?.subject || normalizedLoginId,
            email: user?.auth?.email || null,
            phoneNumber: user?.auth?.phoneNumber || null,
            phoneVerified: Boolean(user?.auth?.phoneVerified),
          },
          blockedUserIds: Array.isArray(user?.blockedUserIds) ? user.blockedUserIds : [],
          preferredChatLanguage: user.preferredChatLanguage || user.nativeLanguage || "ko",
          password: typeof user?.password === "string" ? user.password : "",
          planTier: ["monthly", "yearly"].includes(user?.planTier) ? user.planTier : "free",
          usage: sanitizeUsageState(user?.usage, Number(parsed.updatedAt || Date.now())),
          planUpdatedAt: Number(user?.planUpdatedAt || user?.joinedAt || user?.createdAt || Date.now()),
          planPolicyAcknowledgedAt: Number(user?.planPolicyAcknowledgedAt || 0) || null,
          recoveryQuestionKey: RECOVERY_QUESTION_KEYS.includes(user?.recoveryQuestionKey)
            ? user.recoveryQuestionKey
            : getDeterministicRecoveryQuestionKey(user?.name),
          recoveryAnswer:
            typeof user?.recoveryAnswer === "string"
              ? normalizeRecoveryAnswer(user.recoveryAnswer)
              : normalizeRecoveryAnswer(user?.name),
          joinedAt: Number(user?.joinedAt || user?.createdAt || Date.now()),
          lastLoginAt: Number(user?.lastLoginAt || 0) || null,
          loginState: user?.loginState === "online" ? "online" : "offline",
          hasUnreadInvites: Boolean(user?.hasUnreadInvites),
          hasUnreadMessages: Boolean(user?.hasUnreadMessages),
        };
      });
    const userIds = new Set(users.map((user) => user.id));

    const rooms = (parsed.rooms || [])
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
      .filter((invite) => roomIds.has(invite.roomId) && userIds.has(invite.inviterId) && userIds.has(invite.inviteeId))
      .map((invite) => ({
        ...invite,
        status: ["pending", "accepted", "rejected"].includes(invite?.status) ? invite.status : "pending",
        respondedAt: Number(invite?.respondedAt || 0) || null,
        seenByInvitee: Boolean(invite?.seenByInvitee),
      }));

    return nextState;
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

  function persistState() {
    // Prototype policy note: chats and inline image previews live in local/browser state until a room is deleted or expires.
    syncSpecialUserFlags();
    syncUsageWindows();
    syncUserAlertState();
    appState.updatedAt = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
    broadcastStateRefresh();
    scheduleServerStateSync();
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
    applyStateSnapshot(persisted);
  }

  function shouldPreserveLocalActiveUser(nextState) {
    const activeUserId = getActiveUserId();
    if (!activeUserId) return false;

    const localCurrentUser = appState.users.find((user) => user.id === activeUserId);
    if (!localCurrentUser) return false;

    return !(nextState.users || []).some((user) => user.id === activeUserId);
  }

  function applyStateSnapshot(nextState, options = {}) {
    const previousActiveRoom = appState.rooms.find((room) => room.id === uiState.activeRoomId) || null;
    if (options.source === "server" && shouldPreserveLocalActiveUser(nextState)) {
      scheduleServerStateSync();
      return false;
    }

    appState = nextState;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
    syncUiWithCurrentUserState();
    if (previousActiveRoom && !appState.rooms.some((room) => room.id === previousActiveRoom.id)) {
      pushToast("toastRoomDeleted", "toastRoomDeletedCopy", { title: previousActiveRoom.title });
    }
    if (options.source === "server" && shouldDeferNonCriticalRender()) {
      renderSafelyDuringInput();
    } else {
      render();
    }
    return true;
  }

  function scheduleServerStateSync() {
    if (!shouldUseTranslationBackend()) return;
    clearTimeout(runtime.serverSyncTimer);
    runtime.serverSyncTimer = setTimeout(() => {
      syncStateToServer();
    }, 120);
  }

  async function syncStateToServer() {
    if (!shouldUseTranslationBackend()) return;

    try {
      // Prototype sync note: the local Node server mirrors app state for test devices only; replace with DB access control in production.
      const response = await fetch(CONFIG.stateApiPath, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          state: appState,
          sourceId: runtime.clientId,
        }),
      });

      if (!response.ok) {
        throw new Error(`State sync failed with ${response.status}`);
      }
    } catch (error) {
      console.warn("Failed to sync state to server", error);
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

  function getStateTimestamp(state) {
    return Number(state?.updatedAt || 0);
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

      if (!serverIsEmpty && getStateTimestamp(serverState) >= getStateTimestamp(appState)) {
        applyStateSnapshot(serverState, { source: "server" });
        return;
      }

      if (serverIsEmpty && !localHasData) {
        applyStateSnapshot(serverState, { source: "server" });
        return;
      }
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

  function getCurrentUser() {
    const userId = getActiveUserId();
    if (!userId) return null;
    return appState.users.find((user) => user.id === userId) || null;
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

  function normalizeLoginIdentity(value) {
    return normalizeDisplayText(value).trim().toLowerCase();
  }

  function normalizeAccountId(value) {
    return normalizeDisplayText(value).trim().toLowerCase();
  }

  function normalizePolicyIdentity(value) {
    return normalizeDisplayText(value).replace(/\s+/g, "").trim().toLowerCase();
  }

  function isAdminLoginId(value) {
    return normalizeAccountId(value) === BUILT_IN_ADMIN_ACCOUNT.loginId;
  }

  function isUnlimitedTesterName(value) {
    return UNLIMITED_TESTER_NAMES.has(normalizePolicyIdentity(value));
  }

  function isAdminUser(user) {
    return Boolean(user?.isAdmin) || isAdminLoginId(user?.loginId);
  }

  function canBypassUsageLimit(user) {
    return Boolean(user) && (isAdminUser(user) || Boolean(user?.isUnlimitedTester) || isUnlimitedTesterName(user?.name));
  }

  function applySpecialUserFlags(user) {
    if (!user) return user;
    user.isAdmin = Boolean(user.isAdmin) || isAdminLoginId(user.loginId);
    user.isUnlimitedTester = isUnlimitedTesterName(user.name);
    user.canBypassUsageLimit = user.isAdmin || user.isUnlimitedTester;
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
          planTier: "yearly",
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

  function getUsageWindowInfo(now = Date.now()) {
    const current = new Date(now);
    const resetPoint = new Date(current);
    resetPoint.setHours(CONFIG.freeResetHour, 0, 0, 0);

    let windowStart = resetPoint;
    let nextReset = new Date(resetPoint);
    if (current < resetPoint) {
      windowStart = new Date(resetPoint);
      windowStart.setDate(windowStart.getDate() - 1);
      nextReset = resetPoint;
    } else {
      nextReset = new Date(resetPoint);
      nextReset.setDate(nextReset.getDate() + 1);
    }

    const key = [
      windowStart.getFullYear(),
      String(windowStart.getMonth() + 1).padStart(2, "0"),
      String(windowStart.getDate()).padStart(2, "0"),
      CONFIG.freeResetHour,
    ].join("-");

    return {
      key,
      windowStartAt: windowStart.getTime(),
      nextResetAt: nextReset.getTime(),
    };
  }

  function sanitizeUsageState(value, now = Date.now()) {
    const info = getUsageWindowInfo(now);
    if (!value || value.windowKey !== info.key) {
      return {
        windowKey: info.key,
        totalMessages: 0,
        softLimitNotified: false,
        lastUpdatedAt: now,
      };
    }

    return {
      windowKey: info.key,
      totalMessages: Math.max(0, Number(value.totalMessages || 0)),
      softLimitNotified: Boolean(value.softLimitNotified),
      lastUpdatedAt: Number(value.lastUpdatedAt || now),
    };
  }

  function ensureUserUsageState(user, now = Date.now()) {
    if (!user) return getUsageWindowInfo(now);
    const info = getUsageWindowInfo(now);
    user.planTier = ["free", "monthly", "yearly"].includes(user.planTier) ? user.planTier : "free";
    user.usage = sanitizeUsageState(user.usage, now);
    return {
      ...info,
      usage: user.usage,
    };
  }

  function syncUsageWindows() {
    appState.users.forEach((user) => ensureUserUsageState(user));
  }

  function isPremiumPlan(user) {
    return ["monthly", "yearly"].includes(user?.planTier);
  }

  function getPlanLabel(planTier) {
    return t(
      planTier === "monthly"
        ? "planMonthlyLabel"
        : planTier === "yearly"
          ? "planYearlyLabel"
          : "planFreeLabel"
    );
  }

  function formatPriceLabel(amount, type) {
    const formatted = `${new Intl.NumberFormat("ko-KR").format(amount)}원`;
    return t(type === "monthly" ? "planMonthlyPrice" : "planYearlyPrice", { price: formatted });
  }

  function formatPlanResetTime(timestamp) {
    return new Intl.DateTimeFormat(getLocale(), {
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(timestamp));
  }

  function getPlanUsageSummary(user) {
    const info = ensureUserUsageState(user);
    const used = Number(user?.usage?.totalMessages || 0);
    const remaining = Math.max(0, CONFIG.freeDailyMessageLimit - used);
    return {
      used,
      remaining,
      nextResetAt: info.nextResetAt,
    };
  }

  function getMessageLimitState(user) {
    const summary = getPlanUsageSummary(user);
    if (canBypassUsageLimit(user)) {
      return { blocked: false, kind: "ok", summary };
    }
    if (!isPremiumPlan(user) && summary.used >= CONFIG.freeDailyMessageLimit) {
      return { blocked: true, kind: "free", summary };
    }
    if (isPremiumPlan(user) && summary.used >= CONFIG.premiumHardLimit) {
      return { blocked: true, kind: "premium", summary };
    }
    return { blocked: false, kind: "ok", summary };
  }

  function maybeFlagPremiumSoftLimit(user) {
    if (canBypassUsageLimit(user)) return false;
    if (!isPremiumPlan(user)) return false;
    ensureUserUsageState(user);
    if (Number(user.usage.totalMessages || 0) < CONFIG.premiumSoftLimit) return false;
    if (user.usage.softLimitNotified) return false;
    user.usage.softLimitNotified = true;
    return true;
  }

  function recordMessageUsage(room, senderId, createdAt = Date.now()) {
    const affectedUserIds = new Set(deriveRoomParticipantIds(room));
    affectedUserIds.add(senderId);

    affectedUserIds.forEach((userId) => {
      const user = appState.users.find((item) => item.id === userId);
      if (!user) return;
      if (canBypassUsageLimit(user)) return;
      ensureUserUsageState(user, createdAt);
      user.usage.totalMessages = Math.max(0, Number(user.usage.totalMessages || 0)) + 1;
      user.usage.lastUpdatedAt = createdAt;
    });
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

  function isAllowedPrivateTester(name) {
    if (CONFIG.accessGateMode !== "whitelist") {
      return true;
    }
    return PRIVATE_TEST_GATE_NAMES.has(normalizePolicyIdentity(name)) || isAdminLoginId(name);
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
        failTranslation: false,
        processing: false,
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

  function getPresence(user, roomId) {
    const livePresence = runtime.presenceSignals[user.id];
    const lastSeenAt = Number(livePresence?.lastSeenAt || user.lastSeenAt || 0);
    const currentRoomId = livePresence?.currentRoomId ?? user.currentRoomId;
    const recentlyActive = Date.now() - lastSeenAt < 2 * 60 * 1000;
    if (recentlyActive && roomId && currentRoomId === roomId) {
      return { kind: "in-room", label: t("presenceInRoom") };
    }
    if (recentlyActive && currentRoomId) {
      return { kind: "in-room", label: t("presenceInRoom") };
    }
    if (recentlyActive) {
      return { kind: "online", label: t("presenceOnline") };
    }
    return { kind: "offline", label: t("presenceOffline") };
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

    return Date.now() - runtime.lastComposerInputAt < 900;
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
      return appState.rooms.some((room) => room.id === invite.roomId && room.status === "active");
    }) || null;
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

    const room = createConnectionInviteRoomAscii(currentUser, friend);
    const invite = {
      id: uid("invite"),
      roomId: room.id,
      inviterId: currentUser.id,
      inviteeId: friend.id,
      status: "pending",
      createdAt: Date.now(),
      respondedAt: null,
      seenByInvitee: false,
    };
    appState.invites.unshift(invite);
    room.messages.push(systemMessage(uid("sys"), "systemUserInvited", { inviter: currentUser.name, invitee: friend.name }, Date.now()));
    room.unreadByUser[friend.id] = (room.unreadByUser[friend.id] || 0) + 1;
    persistState();
    pushToast("toastInviteSent", "toastInviteSentCopy", { name: friend.name });
    render();
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
          <div class="landing-auth-actions">
            <button class="button button-primary landing-auth-button" type="submit">${escapeHtml(t("loginButton"))}</button>
          </div>
          <div class="landing-auth-links">
            <button class="landing-text-button" type="button" data-action="open-landing-signup">${escapeHtml(t("signupButton"))}</button>
            <button class="landing-text-button" type="button" data-action="open-landing-reset">${escapeHtml(t("passwordChangeButton"))}</button>
          </div>
          <p class="landing-inline-helper ${uiState.landing.error ? "error" : ""}">
            ${escapeHtml(uiState.landing.error || t("landingAuthSecondaryHint"))}
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
          <div class="landing-auth-actions">
            <button class="button button-primary landing-auth-button" type="button" data-action="submit-landing-signup">${escapeHtml(t("signupCompleteButton"))}</button>
          </div>
          <p class="landing-inline-helper ${uiState.landing.error ? "error" : ""}">
            ${escapeHtml(uiState.landing.error || t("landingAccessHint"))}
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
            ${escapeHtml(uiState.landing.error || t("landingAccessHint"))}
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
        <div class="brand-chip compact">
          <div class="brand-mark">T</div>
          <div class="brand-meta">
            <strong>TRANSCHAT</strong>
          </div>
        </div>
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
      .filter((room) => room.status === "active" && deriveRoomParticipantIds(room).includes(currentUser.id))
      .sort((a, b) => (b.lastMessageAt || b.createdAt) - (a.lastMessageAt || a.createdAt));

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
    const friends = appState.users
      .slice()
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
    return `
      <article class="friend-card mobile-friend-card" data-diff-key="friend:${friend.id}">
        ${renderProfileImage(friend, "list-profile-image", friend.name)}
        <button class="friend-name-button" type="button" data-action="open-profile-preview" data-user-id="${friend.id}">
          <strong>${escapeHtml(displayName)}</strong>
        </button>
        <span class="friend-inline-presence ${presence.kind}">${escapeHtml(presence.label)}</span>
        ${currentUser ? renderConnectionActionV2(friend, currentUser) : `<span class="tiny-status ${presence.kind}">${escapeHtml(presence.label)}</span>`}
      </article>
    `;
  }

  function renderMyInfoScreenMobile(currentUser) {
    const profileEditor = syncProfileEditor(currentUser);
    const planSummary = getPlanUsageSummary(currentUser);

    return `
      <section class="panel screen-panel mobile-screen">
        <div class="screen-header mobile-screen-header">
          <h2>${escapeHtml(t("tabMyInfo"))}</h2>
        </div>
        <div class="screen-body mobile-list-body my-info-mobile" data-scroll-key="my-info">
          ${renderPlanSummaryCard(currentUser, planSummary)}
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
          <button class="button button-danger logout-inline-button" data-action="logout-current-user">${escapeHtml(t("logoutButton"))}</button>
        </div>
      </section>
    `;
  }

  function renderPlanSummaryCard(currentUser, summary) {
    const currentPlanLabel = getPlanLabel(currentUser.planTier);
    const premiumPlan = isPremiumPlan(currentUser);
    const unlimitedTester = canBypassUsageLimit(currentUser);
    return `
      <div class="setting-card compact plan-summary-card">
        <div class="plan-summary-head">
          <div>
            <strong>${escapeHtml(t("planSectionTitle"))}</strong>
            <span class="helper">${escapeHtml(t("planCurrentLabel"))} : ${escapeHtml(currentPlanLabel)}</span>
          </div>
          <button class="button button-secondary compact-action-button" type="button" data-action="open-modal" data-modal="plan">${escapeHtml(t("planChangeButton"))}</button>
        </div>
        ${unlimitedTester
          ? `
            <div class="plan-usage-copy">
              <span>${escapeHtml(t("planUnlimitedTesterCopy"))}</span>
              <span>${escapeHtml(t("planResetAt", { time: formatPlanResetTime(summary.nextResetAt) }))}</span>
            </div>
          `
          : premiumPlan
          ? `
            <div class="plan-usage-copy">
              <span>${escapeHtml(t("planPremiumUsageCopy"))}</span>
              <span>${escapeHtml(t("planPremiumGuardCopy"))}</span>
            </div>
          `
          : `
            <div class="plan-usage-copy">
              <span>${escapeHtml(t("planRemainingMessages", { count: summary.remaining }))}</span>
              <span>${escapeHtml(t("planFreeTrialHint"))}</span>
              <span>${escapeHtml(t("planResetAt", { time: formatPlanResetTime(summary.nextResetAt) }))}</span>
            </div>
          `}
      </div>
    `;
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
            <input
              class="composer-input"
              type="text"
              data-input="composer"
              data-room-id="${room.id}"
              value="${escapeHtml(draft.text)}"
              placeholder="${escapeHtml(t("composerPlaceholder"))}"
              autocomplete="off"
            />
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
          <button class="button button-primary send-button" type="button" data-action="send-message" data-room-id="${room.id}" ${draft.processing ? "disabled" : ""}>${escapeHtml(t("sendButton"))}</button>
        </div>
      </div>
      <input class="hidden-input" type="file" accept="image/jpeg,image/png,image/webp" data-input="image-file" data-room-id="${room.id}" />
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
            <div class="brand-chip">
              <div class="brand-mark">T</div>
              <div class="brand-meta">
                <strong>TRANSCHAT</strong>
                <span>${escapeHtml(t("topbarStatus"))}</span>
              </div>
            </div>
          </div>
          <div class="topbar-right">
            ${renderTopbarStatusBadges()}
            <div class="profile-chip">
              <div class="avatar">${escapeHtml(initials(currentUser.name))}</div>
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
    const translationLabel = status.liveTranslationEnabled
      ? `${t("translationLiveMode")}${status.model ? ` · ${status.model}` : ""}`
      : t("translationFallbackMode");
    const displayTranslationLabel = status.liveTranslationEnabled
      ? `${t("translationLiveMode")}${status.model ? ` · ${status.model}` : ""}`
      : t("translationFallbackMode");

    return `
      <div class="status-cluster">
        <span class="status-pill ${status.serverReachable ? "pill-success" : "pill-warning"}">${escapeHtml(
          status.serverReachable ? t("serverOnline") : t("serverOffline")
        )}</span>
        <span class="status-pill ${status.liveTranslationEnabled ? "pill-accent" : "pill-warning"}">${escapeHtml(displayTranslationLabel)}</span>
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
        <div>
          <strong>${escapeHtml(friend.name)}</strong>
          <span>${escapeHtml(getChatLanguageName(friend.nativeLanguage))} · ${escapeHtml(getChatLanguageName(friend.preferredChatLanguage || friend.nativeLanguage))}</span>
        </div>
        <div class="button-row">
          <span class="status-pill ${presence.kind === "in-room" ? "pill-accent" : presence.kind === "online" ? "pill-success" : ""}">
            <span class="presence-dot ${presence.kind}"></span>
            ${escapeHtml(presence.label)}
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
                const room = appState.rooms.find((item) => item.id === invite.roomId);
                return `<span>${escapeHtml(invitee?.name || "—")} · ${escapeHtml(normalizeDisplayText(room?.title || "—"))} · ${escapeHtml(invite.status === "accepted" ? t("inviteAccepted") : t("inviteRejected"))}</span>`;
              }).join("")
            : `<span>${escapeHtml(t("inviteResultEmpty"))}</span>`}
        </div>
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
            ${room.status === "active"
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
        ${isExpired ? "" : `<footer class="composer">${renderComposer(room, currentUser)}</footer>`}
        ${room.status === "active" && uiState.chatDetailsOpen ? renderChatDetailsPanel(room) : ""}
      </section>
    `;
  }

  function renderChatDetailsPanel(room) {
    const participants = deriveRoomParticipantIds(room)
      .map((participantId) => appState.users.find((user) => user.id === participantId))
      .filter(Boolean);

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
          <button class="button button-secondary" data-action="open-modal" data-modal="invite">${escapeHtml(t("inviteButton"))}</button>
          <button class="button button-danger" data-action="leave-room" data-room-id="${room.id}">${escapeHtml(t("leaveButton"))}</button>
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
      const typingIndicators = renderTypingIndicators(room, currentUser);
      return `
        <div class="empty-card">
          <h3>${escapeHtml(t("noMessagesTitle"))}</h3>
          <p>${escapeHtml(t("noMessagesCopy"))}</p>
        </div>
        ${typingIndicators}
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
        const translated = getDisplayTranslation(message, currentUser);
        const showOriginal = Boolean(uiState.originalVisibility[message.id]);
        const shouldShowToggle = message.originalText && message.originalText !== translated.text && !translated.failed && !translated.pending;
        const messageStatus = isMine ? getOutgoingMessageStatus(room, message, currentUser) : "";
        const links = detectLinks(translated.text || message.originalText);
        const visibleText = stripLinks(translated.text || message.originalText);
        const visibleOriginal = stripLinks(message.originalText);
        parts.push(`
          <div class="message-row ${isMine ? "mine" : ""}" data-diff-key="message:${message.id}">
            ${!isMine ? `<div class="message-avatar"><div class="avatar">${escapeHtml(initials(sender?.name || "?"))}</div></div>` : ""}
            <div class="message-stack">
              ${!isMine ? `<div class="message-sender">${escapeHtml(sender?.name || "")}</div>` : ""}
              <div class="bubble">
                ${visibleText ? `<p>${escapeHtml(visibleText).replace(/\n/g, "<br />")}</p>` : ""}
                ${links.length ? renderLinks(links) : ""}
                ${message.media ? renderMedia(message.media, message.id) : ""}
                ${showOriginal && visibleOriginal ? `<div class="original-copy">${escapeHtml(visibleOriginal)}</div>` : ""}
              </div>
              <div class="message-footer">
                <span>${escapeHtml(formatClock(message.createdAt))}</span>
                ${messageStatus ? `<span>${escapeHtml(t(`status${capitalize(messageStatus)}`))}</span>` : ""}
                ${translated.pending ? `<span class="tiny-pill pill-warning">${escapeHtml(t("translationPendingBadge"))}</span>` : ""}
                ${translated.failed ? `<span class="tiny-pill pill-danger">${escapeHtml(t("translationFailedBadge"))}</span>` : ""}
                ${message.originalText && !translated.failed && !isMine && translated.text !== message.originalText ? `<span class="tiny-pill pill-accent">${escapeHtml(t("translatedBadge"))}</span>` : ""}
                ${shouldShowToggle ? `<button class="text-button" data-action="toggle-original" data-message-id="${message.id}">${escapeHtml(showOriginal ? t("hideOriginal") : t("showOriginal"))}</button>` : ""}
              </div>
            </div>
          </div>
        `);
      });

    const typingIndicators = renderTypingIndicators(room, currentUser);
    return `${parts.join("")}${typingIndicators}`;
  }

  function renderTypingIndicators(room, currentUser) {
    const typingUsers = getActiveTypingUsers(room.id, currentUser.id);
    if (!typingUsers.length) return "";

    return typingUsers
      .map((entry) => `
        <div class="message-row typing">
          <div class="message-avatar"><div class="avatar">${escapeHtml(initials(entry.name || "?"))}</div></div>
          <div class="message-stack">
            <div class="message-sender">${escapeHtml(entry.name || "")}</div>
            <div class="typing-bubble">${escapeHtml(t("typingIndicator", { name: entry.name || "" }))}</div>
          </div>
        </div>
      `)
      .join("");
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

  function getDisplayTranslation(message, currentUser) {
    if (message.senderId === currentUser.id || !message.originalText) {
      return {
        text: message.originalText,
        failed: Boolean(Object.values(message.translations || {}).some((entry) => entry.failed)),
        pending: false,
      };
    }
    const preferredLanguage = currentUser.preferredChatLanguage || currentUser.nativeLanguage;
    const translation =
      message.translations?.[preferredLanguage] ||
      message.translations?.[currentUser.nativeLanguage];
    if (!translation) {
      if (message.translationMeta?.pending) {
        return { text: message.originalText, failed: false, pending: true };
      }
      return { text: message.originalText, failed: true, pending: false };
    }
    return {
      text: translation.text || message.originalText,
      failed: translation.failed,
      pending: false,
    };
  }

  function isScrollNearBottom(scrollElement, threshold = 88) {
    if (!(scrollElement instanceof HTMLElement)) {
      return true;
    }
    return scrollElement.scrollHeight - scrollElement.clientHeight - scrollElement.scrollTop <= threshold;
  }

  function isComposerFocused() {
    const active = document.activeElement;
    return active instanceof HTMLInputElement && active.dataset.input === "composer";
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
        if (shouldDeferNonCriticalRender()) {
          renderSafelyDuringInput();
        } else {
          render();
        }
      }
    }, options.delay ?? 60);
  }

  function renderMedia(media, messageId) {
    const source = resolveMediaSource(media);
    if (media.kind === "image") {
      return `<div class="media-card"><button class="media-thumb" data-action="open-media" data-message-id="${messageId}"><img src="${source}" alt="${escapeHtml(media.name || "image")}" /></button></div>`;
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
            <span>${escapeHtml(t("videoSessionOnly"))}</span>
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
    if (media.storage === "inline") return media.previewUrl;
    if (media.storage === "runtime") return runtime.videoUrls.get(media.runtimeId) || "";
    return media.previewUrl || "";
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
                    const room = appState.rooms.find((item) => item.id === invite.roomId);
                    return `<span>${escapeHtml(invitee?.name || "—")} · ${escapeHtml(normalizeDisplayText(room?.title || "—"))} · ${escapeHtml(invite.status === "accepted" ? t("inviteAccepted") : t("inviteRejected"))}</span>`;
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
          <div>
            <strong>${escapeHtml(participant.name)}</strong>
            <span>${escapeHtml(getChatLanguageName(participant.nativeLanguage))}</span>
          </div>
          <span class="status-pill ${presence.kind === "in-room" ? "pill-accent" : presence.kind === "online" ? "pill-success" : ""}">
            <span class="presence-dot ${presence.kind}"></span>
            ${escapeHtml(presence.label)}
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
        : modalType === "plan"
          ? renderPlanModal()
        : modalType === "password"
          ? renderPasswordModal()
          : modalType === "invite"
            ? renderInviteModal()
            : modalType === "participants"
              ? renderParticipantsModal()
              : modalType === "media"
                ? renderMediaModal()
                : modalType === "usage-limit"
                  ? renderUsageLimitModal()
                : modalType === "profile-preview"
                  ? renderProfilePreviewModal()
                  : modalType === "notice"
                    ? renderNoticeModal()
                : "";
    return `<div class="modal-layer">${body}</div>`;
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

  function renderPlanModal() {
    const currentUser = getCurrentUser();
    if (!currentUser) return "";
    const plans = [
      {
        tier: "free",
        label: t("planFreeLabel"),
        price: `${new Intl.NumberFormat("ko-KR").format(0)}원`,
        lines: [t("planRemainingMessages", { count: Math.max(0, CONFIG.freeDailyMessageLimit - getPlanUsageSummary(currentUser).used) }), t("planResetAt", { time: formatPlanResetTime(getPlanUsageSummary(currentUser).nextResetAt) })],
      },
      {
        tier: "monthly",
        label: t("planMonthlyLabel"),
        price: t("planMonthlyPrice", { price: `${new Intl.NumberFormat("ko-KR").format(CONFIG.monthlyPlanPrice)}원` }),
        lines: [t("planMonthlyCopyPrimary"), t("planMonthlyCopySecondary")],
      },
      {
        tier: "yearly",
        label: t("planYearlyLabel"),
        price: t("planYearlyPrice", { price: `${new Intl.NumberFormat("ko-KR").format(CONFIG.yearlyPlanPrice)}원` }),
        lines: [t("planYearlyCopyPrimary"), t("planYearlyCopySecondary")],
      },
    ];
    return `
      <section class="modal plan-modal">
        <div class="modal-header">
          <h3>${escapeHtml(t("planModalTitle"))}</h3>
          <p>${escapeHtml(t("planModalCopy"))}</p>
        </div>
        <div class="modal-body plan-modal-body">
          ${plans
            .map(
              (plan) => `
                <article class="plan-option-card ${currentUser.planTier === plan.tier ? "current" : ""}">
                  <div class="plan-option-top">
                    <strong>${escapeHtml(plan.label)}</strong>
                    ${currentUser.planTier === plan.tier ? `<span class="status-pill pill-accent">${escapeHtml(t("planCurrentBadge"))}</span>` : ""}
                  </div>
                  <div class="plan-option-price">${escapeHtml(plan.price)}</div>
                  <div class="plan-usage-copy">
                    ${plan.lines.map((line) => `<span>${escapeHtml(line)}</span>`).join("")}
                  </div>
                  <div class="plan-option-actions">
                    <button class="button button-primary" type="button" data-action="apply-plan-selection" data-plan-tier="${plan.tier}">
                      ${escapeHtml(currentUser.planTier === plan.tier ? t("planCurrentBadge") : t("planApplyPreview"))}
                    </button>
                    <button class="button button-ghost" type="button" data-action="open-checkout-placeholder">${escapeHtml(t("planCheckoutPlaceholder"))}</button>
                  </div>
                </article>
              `
            )
            .join("")}
          <div class="plan-policy-block">
            <strong>${escapeHtml(t("planPolicyTitle"))}</strong>
            <p>${escapeHtml(t("planPolicyCopy"))}</p>
            <button class="button button-ghost" type="button" data-action="open-plan-policy">${escapeHtml(t("planPolicyButton"))}</button>
          </div>
        </div>
        <div class="modal-footer">
          <button class="button button-secondary" type="button" data-action="close-modal">${escapeHtml(t("cancel"))}</button>
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
    const displayName = getUserDisplayName(friend) || friend.loginId || friend.name;
    const genderLabel =
      friend.gender === "male"
        ? t("authGenderMale")
        : friend.gender === "female"
          ? t("authGenderFemale")
          : t("profilePopupEmpty");
    return `
      <section class="modal">
        <div class="modal-header">
          <h3>${escapeHtml(t("profilePopupTitle"))}</h3>
          <p>${escapeHtml(displayName)}</p>
        </div>
        <div class="modal-body profile-preview-grid">
          <div class="profile-preview-item"><span>${escapeHtml(t("profilePopupName"))}</span><strong>${escapeHtml(friend.name || t("profilePopupEmpty"))}</strong></div>
          <div class="profile-preview-item"><span>${escapeHtml(t("profilePopupId"))}</span><strong>${escapeHtml(friend.loginId || "")}</strong></div>
          <div class="profile-preview-item"><span>${escapeHtml(t("profilePopupGender"))}</span><strong>${escapeHtml(genderLabel)}</strong></div>
          <div class="profile-preview-item"><span>${escapeHtml(t("profilePopupAge"))}</span><strong>${escapeHtml(friend.age || t("profilePopupEmpty"))}</strong></div>
        </div>
        <div class="modal-footer">
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

  function renderUsageLimitModal() {
    const data = uiState.modal?.data || {};
    const isFree = data.kind === "free";
    const lines = t(isFree ? "planFreeExceededCopy" : "planPremiumAbuseCopy", {
      time: formatPlanResetTime(data.nextResetAt || getUsageWindowInfo().nextResetAt),
    })
      .split("\n")
      .filter(Boolean);
    return `
      <section class="modal notice-modal">
        <div class="modal-header">
          <h3>${escapeHtml(t(isFree ? "planFreeExceededTitle" : "planPremiumAbuseTitle"))}</h3>
        </div>
        <div class="modal-body">
          ${lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}
        </div>
        <div class="modal-footer">
          <button class="button button-secondary" type="button" data-action="close-modal">${escapeHtml(t("cancel"))}</button>
          <button class="button button-primary" type="button" data-action="open-modal" data-modal="plan">${escapeHtml(t("planChangeButton"))}</button>
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
    scheduleReceiptRefresh({ delay: 70 });
  }

  function captureChatScrollState() {
    const scroll = document.getElementById("chat-scroll");
    if (!(scroll instanceof HTMLElement)) {
      return null;
    }

    const distanceFromBottom = Math.max(0, scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop);
    return {
      roomId: uiState.activeRoomId || null,
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

    if (!(force || runtime.chatPinnedToBottom || isComposerFocused())) {
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
    if (!(target instanceof HTMLInputElement) || target.dataset.input !== "composer") {
      return;
    }
    runtime.chatPinnedToBottom = true;
    keepChatBottomVisible(true);
    scheduleReceiptRefresh({ force: true, delay: 40 });
  }

  function escapeSelector(value) {
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
      return CSS.escape(String(value));
    }
    return String(value).replace(/["\\]/g, "\\$&");
  }

  function onRootClick(event) {
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
      const currentUser = getCurrentUser();
      stopTypingForRoom(uiState.activeRoomId);
      uiState.activeRoomId = null;
      uiState.directoryTab = "chat";
      uiState.chatDetailsOpen = false;
      uiState.attachmentMenuOpen = false;
      markUserPresence(null);
      if (currentUser) {
        markAllChatNotificationsSeen(currentUser.id);
        persistState();
      }
      render();
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
    if (action === "close-modal") {
      uiState.modal = null;
      uiState.previewMedia = null;
      render();
      return;
    }
    if (action === "apply-plan-selection") {
      const currentUser = getCurrentUser();
      const planTier = actionTarget.dataset.planTier;
      if (!currentUser || !["free", "monthly", "yearly"].includes(planTier)) return;
      currentUser.planTier = planTier;
      currentUser.planUpdatedAt = Date.now();
      currentUser.planPolicyAcknowledgedAt = Date.now();
      persistState();
      pushToast("planUpdatedTitle", "planUpdatedCopy");
      uiState.modal = null;
      render();
      return;
    }
    if (action === "open-plan-policy") {
      openNoticeModal("planPolicyTitle", "planPolicyCopy");
      render();
      return;
    }
    if (action === "open-checkout-placeholder") {
      openNoticeModal("planModalTitle", "planModalCopy");
      render();
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
      triggerHiddenInput("image-file", actionTarget.dataset.roomId);
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
        if (attachment?.kind === "video" && attachment.runtimeId) {
          revokeRuntimeVideo(attachment.runtimeId);
        }
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
    if (action === "toggle-fail-translation") {
      const roomId = actionTarget.dataset.roomId;
      const draft = getDraft(roomId);
      setDraft(roomId, { failTranslation: !draft.failTranslation });
      if (!draft.failTranslation) {
        pushToast("toastTranslationFailed", "toastTranslationFailedCopy");
      }
      render();
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
        pushToast("toastProfileImageRemoved", "toastProfileImageRemovedCopy");
        render();
      }
      return;
    }
    if (action === "save-basic-profile") {
      saveBasicProfile();
      return;
    }
    if (action === "open-profile-preview") {
      uiState.modal = {
        type: "profile-preview",
        data: { userId: actionTarget.dataset.userId },
      };
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
    if (action === "reset-demo") {
      resetDemo();
      return;
    }
    if (action === "fast-forward-room") {
      fastForwardRoom(actionTarget.dataset.roomId);
    }
  }

  function onRootInput(event) {
    const target = event.target;
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
    if (target.dataset.input === "image-file") {
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
      target instanceof HTMLInputElement &&
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
    if (target instanceof HTMLInputElement && target.dataset.input === "composer") {
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
    if (input instanceof HTMLInputElement) {
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

  function findUserByLoginName(name) {
    return appState.users.find((user) => normalizeAccountId(user.loginId || user.name) === normalizeAccountId(name)) || null;
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

    applySpecialUserFlags(user);
    user.name = normalizeDisplayText(user.name).trim();
    user.loginId = normalizeAccountId(user.loginId || user.name);
    user.uiLanguage = uiState.landing.uiLanguage;
    user.nativeLanguage = user.nativeLanguage || defaultLanguage;
    user.preferredChatLanguage = user.preferredChatLanguage || user.nativeLanguage;
    if (options.useLandingProfile && uiState.landing.profileImage) {
      user.profileImage = uiState.landing.profileImage;
    }
    user.auth = {
      provider: user?.auth?.provider || "test-name",
      subject: normalizeAccountId(user.loginId || user.name),
      email: user?.auth?.email || null,
      phoneNumber: user?.auth?.phoneNumber || null,
      phoneVerified: Boolean(user?.auth?.phoneVerified),
    };
    user.lastSeenAt = now;
    user.lastLoginAt = now;
    user.loginState = "online";

    setActiveUserId(user.id);
    localStorage.setItem(LANDING_UI_KEY, user.uiLanguage);
    uiState.activeRoomId = user.currentRoomId || null;
    uiState.directoryTab = "chat";
    uiState.chatDetailsOpen = false;
    uiState.attachmentMenuOpen = false;
    uiState.mobileRoomsOpen = false;
    uiState.landing.name = user.loginId || user.name;
    uiState.landing.password = "";
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
    if (options.toastKey !== false) {
      pushToast(options.toastKey || "toastEnter", options.toastCopyKey || "toastEnterCopy", { name: getUserDisplayName(user) || user.loginId || user.name });
    }
    render();
  }

  function enterLandingUser() {
    const baseId = normalizeAccountId(uiState.landing.name);
    const password = String(uiState.landing.password || "");
    if (!baseId) return;
    const existingUser = findUserByLoginName(baseId);
    if (!isAllowedPrivateTester(baseId) && !(existingUser && (isAllowedPrivateTester(existingUser.name) || isAdminUser(existingUser)))) {
      uiState.landing.error = t("toastAccessDeniedCopy");
      pushToast("toastAccessDenied", "toastAccessDeniedCopy");
      render();
      return;
    }

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
    if (!isAllowedPrivateTester(signupId) && !isAllowedPrivateTester(realName)) {
      uiState.landing.error = t("toastAccessDeniedCopy");
      pushToast("toastAccessDenied", "toastAccessDeniedCopy");
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
        recoveryQuestionKey: getDeterministicRecoveryQuestionKey(signupId),
        recoveryAnswer: realName,
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
    };
    sendPresenceSignal(effectiveRoomId);
  }

  function switchUser(userId) {
    stopTypingForRoom(uiState.activeRoomId);
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
  }

  function resetDemo() {
    stopTypingForRoom(uiState.activeRoomId);
    Array.from(runtime.videoUrls.keys()).forEach((runtimeId) => revokeRuntimeVideo(runtimeId));
    appState = createInitialState();
    sessionStorage.removeItem(SESSION_USER_KEY);
    uiState.activeRoomId = null;
    uiState.modal = null;
    uiState.drawer = null;
    uiState.directoryTab = "chat";
    uiState.chatDetailsOpen = false;
    uiState.attachmentMenuOpen = false;
    uiState.mobileRoomsOpen = false;
    uiState.drafts = {};
    uiState.profileEditor = {
      userId: null,
      name: "",
      nickname: "",
      gender: "",
      age: "",
    };
    uiState.landing.nativeAccordionOpen = false;
    uiState.landing.profileImage = null;
    persistState();
    render();
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
    if (room.creatorId === currentUser.id) {
      deleteRoom(roomId);
      persistState();
      pushToast("toastRoomDeleted", "toastRoomDeletedCopy", { title: room.title });
      render();
      return;
    }
    room.participants = room.participants.filter((participantId) => participantId !== currentUser.id);
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

    // Policy alignment: inline media previews live only inside room state and are revoked when the room is deleted or expires.
    room.messages.forEach((message) => {
      if (message.media?.kind === "video" && message.media.runtimeId) {
        revokeRuntimeVideo(message.media.runtimeId);
      }
    });

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

    const ownedRoomIds = appState.rooms.filter((room) => room.creatorId === userId).map((room) => room.id);
    ownedRoomIds.forEach((roomId) => deleteRoom(roomId));

    appState.rooms.forEach((room) => {
      if ((room.participants || []).includes(userId)) {
        room.participants = room.participants.filter((participantId) => participantId !== userId);
        room.messages.push(systemMessage(uid("sys"), "systemUserLeft", { name: user.name }, Date.now()));
      }
      if (room.accessByUser) {
        delete room.accessByUser[userId];
      }
      if (room.unreadByUser) {
        delete room.unreadByUser[userId];
      }
    });

    Object.keys(runtime.typingSignals).forEach((roomId) => {
      if (!runtime.typingSignals[roomId]) return;
      delete runtime.typingSignals[roomId][userId];
      if (!Object.keys(runtime.typingSignals[roomId]).length) {
        delete runtime.typingSignals[roomId];
      }
    });

    delete runtime.presenceSignals[userId];
    appState.invites = appState.invites.filter((invite) => invite.inviterId !== userId && invite.inviteeId !== userId);
    appState.deletedUsers = {
      ...(appState.deletedUsers || {}),
      [userId]: Date.now(),
    };
    appState.users = appState.users.filter((item) => item.id !== userId);
  }

  function logoutCurrentUser() {
    const currentUser = getCurrentUser();
    if (!currentUser) return;

    stopTypingForRoom(uiState.activeRoomId);
    currentUser.loginState = "offline";
    currentUser.currentRoomId = null;
    currentUser.lastSeenAt = Date.now();
    delete runtime.presenceSignals[currentUser.id];
    localStorage.setItem(LANDING_UI_KEY, currentUser.uiLanguage || uiState.landing.uiLanguage || "ko");
    uiState.landing.name = "";
    uiState.landing.password = "";
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
    render();
  }

  function normalizeAttachmentForMessage(attachment) {
    if (attachment.kind === "image") {
      return {
        kind: "image",
        name: attachment.name,
        size: attachment.size,
        previewUrl: attachment.previewUrl,
        storage: "inline",
      };
    }
    if (attachment.kind === "file") {
      return {
        kind: "file",
        name: attachment.name,
        size: attachment.size,
        mimeType: attachment.mimeType || "",
      };
    }
    return {
      kind: "video",
      name: attachment.name,
      size: attachment.size,
      storage: "runtime",
      runtimeId: attachment.runtimeId,
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
    const liveText = getComposerValue(roomId);
    if (liveText !== draft.text) {
      setDraft(roomId, { text: liveText });
    }
    const text = liveText.trim();
    const attachment = draft.attachment;
    if (!text && !attachment) {
      pushToast("toastEmptyDraft", "toastEmptyDraftCopy");
      return;
    }
    const limitState = getMessageLimitState(currentUser);
    if (limitState.blocked) {
      uiState.modal = {
        type: "usage-limit",
        data: {
          kind: limitState.kind,
          nextResetAt: limitState.summary.nextResetAt,
        },
      };
      render();
      return;
    }
    stopTypingForRoom(roomId);
    setDraft(roomId, { processing: true });
    ensureParticipant(room, currentUser.id, false);

    const message = userMessage(
      uid("msg"),
      currentUser.id,
      text,
      currentUser.nativeLanguage,
      {},
      Date.now(),
      "composing",
      attachment ? normalizeAttachmentForMessage(attachment) : null
    );
    message.translationMeta = text
      ? { provider: "pending", model: runtime.backend.model || null, live: runtime.backend.liveTranslationEnabled, pending: true }
      : { provider: "none", model: null, live: false, pending: false };
    room.messages.push(message);
    room.lastMessageAt = Date.now();
    currentUser.currentRoomId = room.id;
    currentUser.lastSeenAt = Date.now();
    recordMessageUsage(room, currentUser.id, message.createdAt);
    const softLimitWarning = maybeFlagPremiumSoftLimit(currentUser);
    markRoomRead(room.id, currentUser.id);
    room.participants.forEach((participantId) => {
      if (participantId !== currentUser.id) {
        room.unreadByUser[participantId] = (room.unreadByUser[participantId] || 0) + 1;
      }
    });
    persistState();
    render();

    if (draft.failTranslation) {
      pushToast("toastTranslationFailed", "toastTranslationFailedCopy");
    }

    const translationBundle = text
      ? await buildTranslations(room, text, currentUser.id, currentUser.nativeLanguage, draft.failTranslation)
      : {
          translations: {
            ko: { text: "", failed: false },
            en: { text: "", failed: false },
            vi: { text: "", failed: false },
          },
          meta: { provider: "none", model: null, live: false },
        };
    message.translations = translationBundle.translations;
    message.translationMeta = {
      ...translationBundle.meta,
      pending: false,
    };
    message.status = "sent";

    setDraft(roomId, { text: "", attachment: null, failTranslation: false, processing: false });
    uiState.attachmentMenuOpen = false;
    persistState();
    scheduleReceiptRefresh({ delay: 90 });
    if (softLimitWarning) {
      pushToast("planPremiumAbuseTitle", "planSoftLimitToast");
    }
    pushToast("toastMessageSent", "toastMessageSentCopy");
    render();
  }

  function getNeededTargetLanguages(room, senderId, fromLanguage) {
    if (!room) return [];

    const audienceIds = new Set(deriveRoomParticipantIds(room));
    audienceIds.add(room.creatorId);
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
      const targetLanguage = participant.preferredChatLanguage || participant.nativeLanguage;
      if (targetLanguage && targetLanguage !== fromLanguage) {
        needed.add(targetLanguage);
      }
    });

    return [...needed];
  }

  async function buildTranslations(room, text, senderId, fromLanguage, forceFail) {
    const languages = Object.keys(CHAT_LANGUAGES);
    const result = {
      [fromLanguage]: { text, failed: false },
    };
    const targetLanguages = getNeededTargetLanguages(room, senderId, fromLanguage);

    languages.forEach((language) => {
      if (!result[language]) {
        result[language] = { text, failed: false };
      }
    });

    if (forceFail || /#fail\b/i.test(text)) {
      targetLanguages.forEach((targetLanguage) => {
        result[targetLanguage] = { text, failed: true };
      });
      return {
        translations: result,
        meta: { provider: "forced-failure", model: null, live: false },
      };
    }

    const liveTranslations = await requestServerTranslations(text, fromLanguage, targetLanguages);
    if (liveTranslations) {
      targetLanguages.forEach((targetLanguage) => {
        const entry = liveTranslations.translations?.[targetLanguage];
        result[targetLanguage] = entry?.text
          ? { text: entry.text, failed: Boolean(entry.failed) }
          : { text, failed: true };
      });
      return {
        translations: result,
        meta: {
          provider: liveTranslations.provider || "openai",
          model: liveTranslations.model || runtime.backend.model || null,
          live: true,
        },
      };
    }

    for (const targetLanguage of targetLanguages) {
      try {
        const translated = await mockTranslate(text, fromLanguage, targetLanguage, { forceFail: false });
        result[targetLanguage] = { text: translated, failed: false };
      } catch (error) {
        result[targetLanguage] = { text, failed: true };
      }
    }
    return {
      translations: result,
      meta: { provider: "mock", model: null, live: false },
    };
  }

  async function requestServerTranslations(text, sourceLanguage, targetLanguages) {
    if (!shouldUseTranslationBackend() || !targetLanguages.length) {
      return null;
    }

    try {
      // Later this request can move to a real auth/session-aware Node.js + WebSocket message pipeline.
      const response = await fetch(CONFIG.translationApiPath, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          sourceLanguage,
          targetLanguages,
        }),
      });

      if (!response.ok) {
        updateBackendStatus({ serverReachable: true, liveTranslationEnabled: false, checkedAt: Date.now() });
        return null;
      }

      const payload = await response.json();
      updateBackendStatus({
        serverReachable: true,
        liveTranslationEnabled: true,
        model: payload?.model || null,
        checkedAt: Date.now(),
      });
      return {
        translations: payload?.translations || null,
        provider: "openai",
        model: payload?.model || null,
      };
    } catch (error) {
      updateBackendStatus({ serverReachable: false, liveTranslationEnabled: false, checkedAt: Date.now() });
      return null;
    }
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
    runtime.presenceSignals[currentUser.id] = {
      userId: currentUser.id,
      currentRoomId: uiState.activeRoomId || currentUser.currentRoomId || null,
      lastSeenAt: now,
    };
    if (now - runtime.lastPresenceSignalAt >= 15000) {
      runtime.lastPresenceSignalAt = now;
      sendPresenceSignal(uiState.activeRoomId || currentUser.currentRoomId || null);
    }
  }

  async function sendPresenceSignal(roomId) {
    const currentUser = getCurrentUser();
    if (!currentUser || !shouldUseTranslationBackend()) return;

    try {
      await fetch("/api/presence", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId: currentUser.id,
          currentRoomId: roomId || null,
          lastSeenAt: Date.now(),
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
      previous.hasServerState !== merged.hasServerState;

    runtime.backend = merged;
    return changed;
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
      if (
        updateBackendStatus({
          serverReachable: true,
          liveTranslationEnabled: Boolean(payload?.liveTranslationEnabled),
          model: payload?.model || null,
          sharedStateEnabled: Boolean(payload?.sharedStateEnabled),
          hasServerState: Boolean(payload?.hasServerState),
          checkedAt: Date.now(),
        })
      ) {
        renderSafelyDuringInput();
      }
      initServerEvents();
    } catch (error) {
      closeServerEvents();
      if (
        updateBackendStatus({
          serverReachable: false,
          liveTranslationEnabled: false,
          model: null,
          sharedStateEnabled: false,
          hasServerState: false,
          checkedAt: Date.now(),
        })
      ) {
        renderSafelyDuringInput();
      }
    }
  }

  async function mockTranslate(text, fromLanguage, targetLanguage, options = {}) {
    // Front-end fallback used when the local Node translation server or OpenAI API is unavailable.
    await wait(320);
    if (options.forceFail || /#fail\b/i.test(text)) {
      throw new Error("Mock translation failure");
    }
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
    const fallbackLabel = { ko: "번역본", en: "Translated message", vi: "Ban dich" }[targetLanguage];
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
    if (existing?.kind === "video" && existing.runtimeId) {
      revokeRuntimeVideo(existing.runtimeId);
    }
    setDraft(roomId, { processing: true });
    render();
    pushToast("imageCompressing", "imageCompressing");
    const attachment = await compressImage(file);
    setDraft(roomId, { attachment, processing: false });
    uiState.attachmentMenuOpen = false;
    render();
  }

  async function compressImage(file) {
    // The browser only processes the specific user-selected file; no broad device storage access is requested.
    // Later this should move into a dedicated media pipeline with permanent storage metadata returned from the backend.
    const bitmap = await createImageBitmap(file);
    const ratio = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
    canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    const context = canvas.getContext("2d");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const previewUrl = canvas.toDataURL("image/jpeg", 0.82);
    bitmap.close();
    return {
      kind: "image",
      name: file.name,
      size: Math.round((previewUrl.length * 3) / 4),
      previewUrl,
    };
  }

  async function handleVideoSelection(roomId, file) {
    if (file.size > CONFIG.videoMaxBytes) {
      pushToast("videoTooLarge", "videoTooLarge");
      return;
    }
    const existing = getDraft(roomId).attachment;
    if (existing?.kind === "video" && existing.runtimeId) {
      revokeRuntimeVideo(existing.runtimeId);
    }
    setDraft(roomId, { processing: true });
    render();
    pushToast("videoPreparing", "videoPreparing");
    const attachment = await prepareVideo(file);
    setDraft(roomId, { attachment, processing: false });
    uiState.attachmentMenuOpen = false;
    render();
  }

  function handleGenericFileSelection(roomId, file) {
    const existing = getDraft(roomId).attachment;
    if (existing?.kind === "video" && existing.runtimeId) {
      revokeRuntimeVideo(existing.runtimeId);
    }
    setDraft(roomId, {
      attachment: {
        kind: "file",
        name: file.name,
        size: file.size,
        mimeType: file.type || "",
      },
      processing: false,
    });
    uiState.attachmentMenuOpen = false;
    render();
  }

  async function prepareVideo(file) {
    // Later this placeholder becomes a real compression hook that returns a stored media URL plus transcoding status.
    await wait(900);
    const runtimeId = uid("video");
    runtime.videoUrls.set(runtimeId, URL.createObjectURL(file));
    return {
      kind: "video",
      name: file.name,
      size: file.size,
      runtimeId,
    };
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
    const room = appState.rooms.find((item) => item.id === invite?.roomId);
    const currentUser = getCurrentUser();
    if (!invite || !room || !currentUser) return;
    invite.status = response === "accept" ? "accepted" : "rejected";
    invite.respondedAt = Date.now();
    invite.seenByInvitee = true;
    if (response === "accept") {
      ensureParticipant(room, currentUser.id);
      room.accessByUser[currentUser.id] = true;
      room.messages.push(systemMessage(uid("sys"), "systemInviteAccepted", { name: currentUser.name }, Date.now()));
      currentUser.currentRoomId = room.id;
      uiState.activeRoomId = room.id;
      uiState.directoryTab = "chat";
      uiState.chatDetailsOpen = false;
      uiState.attachmentMenuOpen = false;
      pushToast("toastInviteAccepted", "toastInviteAcceptedCopy", { name: currentUser.name });
    } else {
      room.messages.push(systemMessage(uid("sys"), "systemInviteRejected", { name: currentUser.name }, Date.now()));
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

  function openMessageMedia(messageId) {
    const room = appState.rooms.find((item) => item.id === uiState.activeRoomId);
    const message = room?.messages.find((item) => item.id === messageId);
    if (!message?.media) return;
    if (message.media.kind === "video" && !resolveMediaSource(message.media)) {
      pushToast("toastMediaMissing", "toastMediaMissingCopy");
    }
    uiState.previewMedia = message.media;
    uiState.modal = { type: "media" };
    render();
  }

  function fastForwardRoom(roomId) {
    const room = appState.rooms.find((item) => item.id === roomId);
    if (!room || room.status === "expired" || room.disableExpiration) return;
    room.lastMessageAt = Date.now() - 31 * 60 * 1000;
    persistState();
    pushToast("toastRoomFastForward", "toastRoomFastForwardCopy");
    checkRoomExpirations();
    render();
  }

  function checkRoomExpirations() {
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
    const viewportHeight = visual ? visual.height : window.innerHeight;
    const viewportBottom = visual ? visual.height + visual.offsetTop : window.innerHeight;
    runtime.viewportBaseHeight = Math.max(runtime.viewportBaseHeight || 0, viewportBottom, window.innerHeight || 0);
    runtime.keyboardOffset = Math.max(0, runtime.viewportBaseHeight - viewportBottom);
    document.documentElement.style.setProperty("--app-height", `${viewportHeight}px`);
    document.documentElement.style.setProperty("--keyboard-offset", `${runtime.keyboardOffset}px`);
    keepChatBottomVisible(Boolean(runtime.keyboardOffset));
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
    window.addEventListener("resize", syncViewport);
    window.addEventListener("orientationchange", () => {
      syncViewport();
      keepChatBottomVisible(true);
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
            appState = parsed;
            syncUiWithCurrentUserState();
            if (shouldDeferNonCriticalRender()) {
              renderSafelyDuringInput();
            } else {
              render();
            }
          }
        } catch (error) {
          console.warn("Failed to sync storage state", error);
        }
      }
    });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        markUserPresence(uiState.activeRoomId);
        checkRoomExpirations();
        scheduleReceiptRefresh({ force: true, delay: 0 });
        render();
      }
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
      if (getStateTimestamp(serverState) < getStateTimestamp(appState)) return;
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
      };
      renderSafelyDuringInput();
    });
    runtime.eventSource.addEventListener("error", () => {
      runtime.serverEventsConnected = false;
      closeServerEvents();
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
    runtime.countdownInterval = setInterval(() => {
      if (pruneTypingSignals()) {
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
  }

  const currentUser = getCurrentUser();
  if (currentUser) {
    uiState.activeRoomId = currentUser.currentRoomId || null;
    uiState.directoryTab = "chat";
    uiState.chatDetailsOpen = false;
    uiState.attachmentMenuOpen = false;
    markUserPresence(uiState.activeRoomId);
  }

  bindGlobalListeners();
  initRealtimeSync();
  startRuntimeLoops();
  checkRoomExpirations();
  refreshBackendStatus();
  render();
  bootstrapServerState();
})();
