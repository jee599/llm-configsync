const messages = {
  ko: {
    // init
    initTitle: "이 컴퓨터에 GitHub 토큰 등록",
    initHasToken: "이미 토큰이 있으면 바로 붙여넣기 하세요.",
    initNewToken: "처음이면 아래 링크에서 토큰을 만들 수 있습니다:",
    initHint: "(gist 권한만 체크 → Generate token → 복사)",
    tokenPrompt: "  GitHub token: ",
    tokenEmpty: "토큰이 입력되지 않았습니다.",
    tokenChecking: "토큰 확인 중...",
    tokenOk: "인증 완료!",
    tokenSaved: "토큰 저장됨:",
    tokenFail: "토큰 인증 실패:",
    tokenRetry: "토큰을 다시 확인해 주세요.",
    nowReady: "이제 사용할 수 있습니다:",
    saveHint: "← 현재 설정 저장",
    loadHint: "← 다른 컴퓨터에서 불러오기",
    fromOther: "다른 컴퓨터에서:",

    // save
    scanning: "설정 파일 탐색 중...",
    noConfigs: "검색된 LLM CLI 설정이 없습니다.",
    supported: "지원 도구:",
    total: "합계:",
    files: "개 파일",
    noRedactWarn: "API 키 등 민감 정보가 포함된 채로 업로드됩니다.",
    uploading: "Gist에 업로드 중...",
    updated: "업데이트",
    created: "생성",
    done: "완료!",
    uploadFail: "업로드 실패:",

    // load
    downloading: "Gist에서 다운로드 중...",
    savedAt: "저장 시점:",
    savedMachine: "저장 머신:",
    fileCount: "파일 수:",
    identical: "동일",
    restored: "개 파일 복원 완료",
    alreadySame: "개 파일은 이미 동일",
    backedUp: "기존 파일은 .bak으로 백업됨",
    loadFirst: "먼저 다른 컴퓨터에서",
    loadFirstSuffix: "를 실행하세요.",

    // list
    noLocal: "이 컴퓨터에서 검색된 LLM CLI 설정이 없습니다.",

    // status
    initialized: "초기화:",
    account: "계정:",
    local: "로컬:",
    tools: "개 도구",

    // link
    linkUsage: "사용법: lcs link <gist-id>",
    linkDone: "Gist 연결 완료!",

    // help
    helpDesc: "LLM CLI 설정 동기화",
    helpUsage: "사용법:",
    helpOptions: "옵션:",
    helpTools: "지원 도구:",
    helpInit: "GitHub 토큰 설정 (최초 1회)",
    helpSave: "현재 설정 → Gist에 저장",
    helpLoad: "Gist에서 → 현재 컴퓨터에 복원",
    helpList: "로컬에 있는 설정 파일 목록",
    helpStatus: "동기화 상태 확인",
    helpLink: "기존 Gist에 연결",
    helpNoRedact: "API 키 마스킹 없이 저장",
    helpForce: "백업 없이 덮어쓰기",
    helpLang: "언어 변경 (ko/en)",

    // common
    requireInit: "먼저",
    requireInitSuffix: "을 실행하세요.",
    unknownCmd: "알 수 없는 명령어:",
    other: "기타",

    // categories
    catSettings: "세팅",
    catMcp: "MCP 서버",
    catHooks: "훅",
    catSkills: "스킬",
    catInstructions: "인스트럭션",
    catEtc: "기타",
  },

  en: {
    initTitle: "Register GitHub token on this machine",
    initHasToken: "If you already have a token, paste it below.",
    initNewToken: "First time? Create a token here:",
    initHint: "(check gist scope only → Generate token → copy)",
    tokenPrompt: "  GitHub token: ",
    tokenEmpty: "No token provided.",
    tokenChecking: "Verifying token...",
    tokenOk: "Authenticated!",
    tokenSaved: "Token saved:",
    tokenFail: "Authentication failed:",
    tokenRetry: "Please check your token and try again.",
    nowReady: "Ready to use:",
    saveHint: "← save current settings",
    loadHint: "← restore on another machine",
    fromOther: "On another machine:",

    scanning: "Scanning config files...",
    noConfigs: "No LLM CLI configs found.",
    supported: "Supported tools:",
    total: "Total:",
    files: "files",
    noRedactWarn: "Uploading with API keys and secrets INCLUDED.",
    uploading: "Uploading to Gist...",
    updated: "Updated",
    created: "Created",
    done: "Done!",
    uploadFail: "Upload failed:",

    downloading: "Downloading from Gist...",
    savedAt: "Saved at:",
    savedMachine: "Saved from:",
    fileCount: "Files:",
    identical: "identical",
    restored: "files restored",
    alreadySame: "files already identical",
    backedUp: "Existing files backed up as .bak",
    loadFirst: "Run",
    loadFirstSuffix: "on another machine first.",

    noLocal: "No LLM CLI configs found on this machine.",

    initialized: "Initialized:",
    account: "Account:",
    local: "Local:",
    tools: "tools",

    linkUsage: "Usage: lcs link <gist-id>",
    linkDone: "Linked to Gist!",

    helpDesc: "Sync LLM CLI settings across machines",
    helpUsage: "Usage:",
    helpOptions: "Options:",
    helpTools: "Supported tools:",
    helpInit: "Set up GitHub token (once per machine)",
    helpSave: "Upload configs to private Gist",
    helpLoad: "Download and restore configs",
    helpList: "Show detected local configs",
    helpStatus: "Show sync status",
    helpLink: "Link to existing Gist",
    helpNoRedact: "Upload without redacting API keys",
    helpForce: "Overwrite without backups",
    helpLang: "Change language (ko/en)",

    requireInit: "First run",
    requireInitSuffix: ".",
    unknownCmd: "Unknown command:",
    other: "Other",

    catSettings: "Settings",
    catMcp: "MCP",
    catHooks: "Hooks",
    catSkills: "Skills",
    catInstructions: "Instructions",
    catEtc: "Other",
  },
};

function detectLang() {
  const env = process.env.LCS_LANG || process.env.LANG || process.env.LC_ALL || process.env.LANGUAGE || "";
  if (env.toLowerCase().startsWith("ko")) return "ko";
  // Check Windows locale via Intl API
  if (process.platform === "win32") {
    try {
      const locale = Intl.DateTimeFormat().resolvedOptions().locale || "";
      if (locale.toLowerCase().startsWith("ko")) return "ko";
    } catch { /* fallback to en */ }
  }
  return "en";
}

let currentLang = null;

export function setLang(lang) {
  currentLang = lang;
}

export function t(key) {
  const lang = currentLang || detectLang();
  return (messages[lang] && messages[lang][key]) || messages.en[key] || key;
}

export function getLang() {
  return currentLang || detectLang();
}
