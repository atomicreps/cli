export const CALL_DEADLINE_MS = 1200;
export const ANSWER_DEADLINE_MS = 4000;
export const LOGIN_DEADLINE_MS = 8000;
export const HOOK_DEADLINE_MS = 1200;
export const CATALOG_DEADLINE_MS = 8000;
export const INFER_BUDGET_MS = 150;
export const TUI_INFER_BUDGET_MS = INFER_BUDGET_MS * 4;
export const UNAUTHORIZED_BACKOFF_MS = 60 * 60_000;
export const DEGRADED_BACKOFF_MS = 5 * 60_000;

export const MAX_LOCAL_QUIET_MS = 60 * 60_000;

export const TOPICS_TTL_MS = 24 * 60 * 60_000;
export const GRAMMAR_TTL_MS = 30 * 24 * 60 * 60_000;
export const STATUS_TTL_MS = 24 * 60 * 60_000;
export const PENDING_TTL_MS = 4 * 60 * 60_000;
export const REMIND_LIMIT = 2;
export const REMIND_GAP_MS = 20 * 60_000;
export const OFFER_TTL_MS = 30 * 60_000;
export const REPS_KEPT = 20;

export const MS_PER_MINUTE = 60_000;
export const MAX_MUTE_MINUTES = 1440;
export const MAX_QUIET_MS = MAX_MUTE_MINUTES * MS_PER_MINUTE;
export const QUICK_MUTE_MINUTES = 120;
export const QUICK_MUTE_MS = QUICK_MUTE_MINUTES * MS_PER_MINUTE;

export const MAX_FILES_READ = 8;
export const MAX_BYTES_PER_FILE = 8 * 1024;
export const MAX_CHANGED = 40;
export const MAX_DIFF_BYTES = 96 * 1024;
export const MAX_IMPORTS_PER_FILE = 24;
export const MAX_MANIFEST_DEPS = 60;
export const MAX_PACKAGES_SENT = 64;
export const MAX_EXTENSIONS_SENT = 32;
export const MAX_ROOT_HOPS = 64;

export const MAX_SCAN_DEPTH = 4;
export const MAX_SCAN_FILES = 1500;

export const SCAN_SKIP: ReadonlySet<string> = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  "target",
  "vendor",
  "venv",
  "coverage",
  "__pycache__",
  "Pods",
  "DerivedData",
]);

export const TOUCHED_SENT = 12;
export const MAX_ADDED_LINES = 400;
export const HEAD_LINES = 60;
export const MAX_RULES = 8192;
export const MAX_PATTERN = 200;
export const MAX_HITS_PER_PHRASE = 3;
export const MIN_WEIGHT = 1;
export const MAX_WEIGHT = 10;

export const MAX_VOCABULARY = 4096;
export const MAX_VOCABULARY_ENTRY = 120;
export const MAX_PHRASES = 8;
export const MAX_PHRASE_CHARS = 80;
export const MAX_TOPIC_CHARS = 200;
export const PHRASE_WEIGHT = 3;

export const MAX_SHORT_PROMPT_CHARS = 60;

export const DEFAULT_SITE = "https://atomicreps.com";
export const DEFAULT_API = "https://api.atomicreps.com";
export const ALPHA_SITE = "https://staging.atomicreps.com";
export const ALPHA_API = "https://api.staging.atomicreps.com";

export const CONFIG_DIR_NAME = "atomicreps";

export const FILES = {
  config: "config.json",
  errorLog: "last-error.log",
  topics: "topics.json",
  grammar: "grammar.json",
  reps: "reps.json",
  status: "status.json",
} as const;

export const FILE_MODE = 0o600;
export const DIR_MODE = 0o700;
export const MAX_ERROR_LOG_BYTES = 256 * 1024;
export const MAX_NOTE_CHARS = 200;

export const ENV = {
  api: "ATOMICREPS_API",
  site: "ATOMICREPS_SITE",
  channel: "ATOMICREPS_CHANNEL",
  client: "ATOMICREPS_CLIENT",
  pluginHint: "ATOMICREPS_PLUGIN_HINT",
  unsafeOrigin: "ATOMICREPS_UNSAFE_ORIGIN",
} as const;

export const MODERN_VERSION = "2026-07-28";
export const LEGACY_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"] as const;
export const META_VERSION = "io.modelcontextprotocol/protocolVersion";
export const META_CLIENT_INFO = "io.modelcontextprotocol/clientInfo";
export const META_CLIENT_CAPABILITIES = "io.modelcontextprotocol/clientCapabilities";
export const MODERN_ENVELOPE_KEYS: ReadonlySet<string> = new Set([
  "resultType",
  "ttlMs",
  "cacheScope",
  "_meta",
]);
export const MAX_INPUT_ROUNDS = 3;
export const TOOL_NAMES = ["rep", "answer", "me", "settings"] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export const SIGN_IN_MESSAGE =
  "Atomic Reps is not signed in on this machine. Run: npx atomicreps login";
export const DOCTOR_HINT = "Run npx atomicreps doctor.";

export const ESC = "";
export const ENTER = "\r";
export const CLEAR = "[2J[H";
export const HIDE_CURSOR = "[?25l";
export const SHOW_CURSOR = "[?25h";
export const MAX_LINE = 4000;
export const ART_WIDTH = 19;
export const ART_GUTTER = 21;
export const ART_WIDTH_WIDE = 26;
export const ART_GUTTER_WIDE = 29;
export const STREAK_DOTS = 7;
export const STAT_LABEL = 10;
export const PROBE_MS = 2000;
export const TOKEN_PREFIX_CHARS = 12;
export const TOUCHED_SHOWN = 8;
export const FREE_MAX_LEVEL = 1;

export const INTENSITIES = ["off", "light", "regular", "intense"] as const;

export const HARD_QUIET: ReadonlySet<string> = new Set(["off", "muted", "spent"]);

export const WATCHED_RESOURCE = "atomicreps://today";
