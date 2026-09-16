import type { Deadline, EpochMs } from "./clock.js";
import { INTENSITIES } from "./constants.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

export function oneOf<T extends string>(values: readonly T[], value: unknown): T | undefined {
  if (typeof value !== "string") return undefined;
  return values.find((entry) => entry === value);
}

export const PICKS = ["A", "B", "C", "D"] as const;
export type Pick = (typeof PICKS)[number];

export function asPick(value: unknown): Pick | null {
  return typeof value === "string" ? (oneOf(PICKS, value.toUpperCase()) ?? null) : null;
}

export const REP_KINDS = ["auto", "question", "insight"] as const;
export type RepKind = (typeof REP_KINDS)[number];

export const REP_LANES = ["asked", "pushed"] as const;
export type RepLane = (typeof REP_LANES)[number];

export type ClientState = {
  readonly grammarVersion?: string;
  readonly muteKeys?: readonly string[];
  readonly release?: { readonly version?: string; readonly notes?: string };
};

export type ToolReply = {
  readonly text: string;
  readonly data: Record<string, unknown> | null;
  readonly isError?: boolean;
  readonly client?: ClientState;
};

export type DoorFailure =
  | "unauthorized"
  | "misrouted"
  | "timeout"
  | "network"
  | "server"
  | "closed"
  | "cancelled";

export type ReportableFailure = Exclude<DoorFailure, "cancelled">;

export type ApiResult<T> =
  | { readonly ok: true; readonly value: T; readonly ms: number; readonly status: number }
  | {
      readonly ok: false;
      readonly reason: ReportableFailure;
      readonly ms: number;
      readonly detail?: string;
    };

export type DeviceStart = {
  readonly userCode: string;
  readonly deviceSecret: string;
  readonly verifyUrl: string;
  readonly expiresAt: EpochMs;
  readonly intervalMs: number;
};

export type DevicePoll =
  | { readonly status: "pending" }
  | { readonly status: "expired" }
  | { readonly status: "rate_limited" }
  | { readonly status: "approved"; readonly token: string };

export type RepRequest = {
  readonly topic?: string;
  readonly touched?: readonly string[];
  readonly ask?: string;
  readonly hints?: LocalHints;
  readonly kind?: RepKind;
  readonly exclude?: string;
  readonly lane?: Extract<RepLane, "asked">;
};

export type Show = "summary" | "skills" | "reps" | "streak" | "mutes";

export type TopicEntry = {
  readonly slug: string;
  readonly name: string;
  readonly free: boolean;
  readonly domain?: string;
};
export type DomainEntry = { readonly slug: string; readonly name: string };

export type LevelBand = { readonly min: number; readonly max: number };

export type Intensity = (typeof INTENSITIES)[number];

export type SettingsPatch = {
  readonly intensity?: Intensity;
  readonly confidencePrompt?: string;
  readonly muteMinutes?: number;
  readonly mute?: string;
  readonly days?: number;
  readonly unmute?: string;
  readonly prefer?: readonly string[];
  readonly dialog?: boolean;
  readonly strict?: boolean;
  readonly topics?: readonly string[];
  readonly levels?: LevelBand;
};

export type JsonRpcId = string | number | null;

export type JsonRpcMessage = {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { code: number; message: string; data?: unknown };
};

export type DoorCall = { ok: true; body: JsonRpcMessage } | { ok: false; reason: DoorFailure };

export type Channel = "default" | "alpha";

export type Config = {
  token?: string;
  tokenPrefix?: string;
  connectedAt?: EpochMs;
  nextEligibleAt?: EpochMs;
  lastFailureAt?: EpochMs;
  lastFailure?: string;
  lastQuietAt?: EpochMs;
  lastQuiet?: string;
  quietReason?: string | undefined;
  dialog?: boolean;
  elicitationCapable?: boolean;
  setupAt?: EpochMs;
  lastPushTouch?: string;
  bridgeVersion?: string | undefined;
};

export type OfferEntry = { readonly handle: string; readonly name: string };

export type StoredRep = {
  readonly id: string;
  readonly topicSlug: string;
  readonly handle?: string;
  readonly lane?: RepLane;
  readonly text: string;
  readonly servedAt: EpochMs;
  readonly answeredAt?: EpochMs;
  readonly shown?: number;
  readonly correct?: boolean;
  readonly verdict?: string;
  readonly offer?: readonly OfferEntry[];
};

export type PathRule = { readonly pattern: string; readonly key: string; readonly weight: number };
export type WordRule = { readonly words: string; readonly key: string; readonly weight: number };

export type TouchVocabulary = {
  handles: readonly string[];
  packages: readonly string[];
  extensions: readonly string[];
};

export type TouchGrammar = {
  readonly version: string;
  readonly paths: readonly PathRule[];
  readonly words: readonly WordRule[];
  readonly vocabulary: TouchVocabulary;
};

export type TouchedEntry = { readonly key: string; readonly weight: number };

export type TouchInput = {
  paths: readonly string[];
  addedLines: readonly string[];
  heads: readonly string[];
  deadline: Deadline;
};

export type LocalHints = {
  readonly packages: readonly string[];
  readonly extensions: readonly string[];
  readonly touched: readonly TouchedEntry[];
};

export type HookInput = {
  readonly hook_event_name?: string;
  readonly prompt?: string;
  readonly cwd?: string;
  readonly last_assistant_message?: string;
};

export type HookOutput =
  | { hookSpecificOutput: { hookEventName: "UserPromptSubmit"; additionalContext: string } }
  | { systemMessage: string };

export type Draft = {
  readonly prefer: readonly string[];
  readonly topics: readonly string[];
  readonly strict: boolean;
  readonly intensity: Intensity;
  readonly levels: LevelBand;
  readonly dialog?: boolean;
};

export type LoopPose = "idle" | "thinking" | "impressed" | "facepalm" | "celebrating" | "sleeping";

export type Tone =
  | "ink"
  | "soft"
  | "faint"
  | "coral"
  | "gold"
  | "green"
  | "red"
  | "body"
  | "gill"
  | "face"
  | "blush"
  | "bold"
  | "dim";
