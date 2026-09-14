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

export const PICKS = ["A", "B", "C", "D"] as const;
export type Pick = (typeof PICKS)[number];

export function asPick(value: unknown): Pick | null {
  if (typeof value !== "string") return null;
  const upper = value.toUpperCase();
  return (PICKS as readonly string[]).includes(upper) ? (upper as Pick) : null;
}

export type ClientState = {
  grammarVersion?: string;
  muteKeys?: string[];
  release?: { version?: string; notes?: string };
};

export type ToolReply = {
  text: string;
  data: Record<string, unknown> | null;
  isError?: boolean;
  client?: ClientState;
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
  | { ok: true; value: T; ms: number; status: number }
  | { ok: false; reason: ReportableFailure; ms: number; detail?: string };

export type DeviceStart = {
  userCode: string;
  deviceSecret: string;
  verifyUrl: string;
  expiresAt: EpochMs;
  intervalMs: number;
};

export type DevicePoll =
  | { status: "pending" }
  | { status: "expired" }
  | { status: "rate_limited" }
  | { status: "approved"; token: string };

export type RepRequest = {
  topic?: string;
  touched?: string[];
  ask?: string;
  hints?: LocalHints;
  kind?: "auto" | "question" | "insight";
  exclude?: string;
  lane?: "asked";
};

export type Show = "summary" | "skills" | "reps" | "streak" | "mutes";

export type TopicEntry = { slug: string; name: string; free: boolean; domain?: string };
export type DomainEntry = { slug: string; name: string };

export type Intensity = (typeof INTENSITIES)[number];

export type SettingsPatch = {
  intensity?: Intensity;
  confidencePrompt?: string;
  muteMinutes?: number;
  mute?: string;
  days?: number;
  unmute?: string;
  prefer?: string[];
  dialog?: boolean;
  topics?: string[];
  levels?: { min: number; max: number };
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
  dialog?: boolean;
  setupAt?: EpochMs;
  lastPushTouch?: string;
  bridgeVersion?: string | undefined;
};

export type OfferEntry = { handle: string; name: string };

export type StoredRep = {
  id: string;
  topicSlug: string;
  handle?: string;
  lane?: "pushed" | "asked";
  text: string;
  servedAt: EpochMs;
  answeredAt?: EpochMs;
  correct?: boolean;
  verdict?: string;
  offer?: OfferEntry[];
};

export type PathRule = { pattern: string; key: string; weight: number };
export type WordRule = { words: string; key: string; weight: number };

export type TouchVocabulary = {
  handles: readonly string[];
  packages: readonly string[];
  extensions: readonly string[];
};

export type TouchGrammar = {
  version: string;
  paths: readonly PathRule[];
  words: readonly WordRule[];
  vocabulary: TouchVocabulary;
};

export type TouchedEntry = { key: string; weight: number };

export type TouchInput = {
  paths: readonly string[];
  addedLines: readonly string[];
  heads: readonly string[];
  deadline: Deadline;
};

export type LocalHints = { packages: string[]; extensions: string[]; touched: TouchedEntry[] };

export type HookInput = {
  hook_event_name?: string;
  prompt?: string;
  cwd?: string;
  last_assistant_message?: string;
};

export type HookOutput =
  | { hookSpecificOutput: { hookEventName: "UserPromptSubmit"; additionalContext: string } }
  | { systemMessage: string };

export type Draft = {
  prefer: string[];
  topics: string[];
  intensity: Intensity;
  levels: { min: number; max: number };
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
