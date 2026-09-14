import {
  isRecord,
  oneOf,
  stringList,
  type ClientState,
  type DevicePoll,
  type DeviceStart,
  type DomainEntry,
  type JsonRpcId,
  type JsonRpcMessage,
  type ToolReply,
  type TopicEntry,
} from "./types.js";

export function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function bool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function record(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

export function list<T>(value: unknown, parse: (entry: unknown) => T | null): T[] {
  if (!Array.isArray(value)) return [];
  const out: T[] = [];
  for (const entry of value) {
    const parsed = parse(entry);
    if (parsed !== null) out.push(parsed);
  }
  return out;
}

function parseClientState(value: unknown): ClientState | undefined {
  const raw = record(value);
  if (raw === undefined) return undefined;
  const release = record(raw.release);
  const grammarVersion = str(raw.grammarVersion);
  const version = release && str(release.version);
  const notes = release && str(release.notes);
  return {
    ...(grammarVersion === undefined ? {} : { grammarVersion }),
    ...(Array.isArray(raw.muteKeys) ? { muteKeys: stringList(raw.muteKeys) } : {}),
    ...(release === undefined
      ? {}
      : {
          release: {
            ...(version === undefined ? {} : { version }),
            ...(notes === undefined ? {} : { notes }),
          },
        }),
  };
}

export function parseToolReply(value: unknown): ToolReply {
  const raw = record(value);
  if (raw === undefined) return { text: "", data: null };
  const isError = bool(raw.isError);
  const client = parseClientState(raw.client);
  return {
    text: str(raw.text) ?? "",
    data: record(raw.data) ?? null,
    ...(isError === undefined ? {} : { isError }),
    ...(client === undefined ? {} : { client }),
  };
}

export function parseDeviceStart(value: unknown): DeviceStart | null {
  const raw = record(value);
  if (raw === undefined) return null;
  const userCode = str(raw.userCode);
  const deviceSecret = str(raw.deviceSecret);
  const verifyUrl = str(raw.verifyUrl);
  const expiresAt = num(raw.expiresAt);
  const intervalMs = num(raw.intervalMs);
  if (userCode === undefined || deviceSecret === undefined || verifyUrl === undefined) return null;
  if (expiresAt === undefined || intervalMs === undefined) return null;
  return { userCode, deviceSecret, verifyUrl, expiresAt, intervalMs };
}

const POLL_STATUSES = ["pending", "expired", "rate_limited", "approved"] as const;

export function parseDevicePoll(value: unknown): DevicePoll | null {
  const raw = record(value);
  if (raw === undefined) return null;
  const status = oneOf(POLL_STATUSES, raw.status);
  if (status === undefined) return null;
  if (status !== "approved") return { status };
  const token = str(raw.token);
  return token === undefined ? null : { status, token };
}

function parseTopicEntry(value: unknown): TopicEntry | null {
  const raw = record(value);
  if (raw === undefined) return null;
  const slug = str(raw.slug);
  const name = str(raw.name);
  if (slug === undefined || name === undefined) return null;
  const domain = str(raw.domain);
  return { slug, name, free: bool(raw.free) ?? false, ...(domain === undefined ? {} : { domain }) };
}

function parseDomainEntry(value: unknown): DomainEntry | null {
  const raw = record(value);
  if (raw === undefined) return null;
  const slug = str(raw.slug);
  const name = str(raw.name);
  return slug === undefined || name === undefined ? null : { slug, name };
}

export function parseCatalog(value: unknown): {
  topics: TopicEntry[];
  domains?: DomainEntry[];
} {
  const raw = record(value);
  if (raw === undefined) return { topics: [] };
  return {
    topics: list(raw.topics, parseTopicEntry),
    ...(Array.isArray(raw.domains) ? { domains: list(raw.domains, parseDomainEntry) } : {}),
  };
}

function jsonRpcId(value: unknown): JsonRpcId | undefined {
  if (value === null) return null;
  return typeof value === "string" || typeof value === "number" ? value : undefined;
}

function jsonRpcError(value: unknown): JsonRpcMessage["error"] | undefined {
  const raw = record(value);
  if (raw === undefined) return undefined;
  const code = num(raw.code);
  const message = str(raw.message);
  if (code === undefined || message === undefined) return undefined;
  return { code, message, ...("data" in raw ? { data: raw.data } : {}) };
}

export function parseJsonRpcMessage(value: unknown): JsonRpcMessage | null {
  const raw = record(value);
  if (raw === undefined) return null;
  const jsonrpc = str(raw.jsonrpc);
  const id = jsonRpcId(raw.id);
  const method = str(raw.method);
  const params = record(raw.params);
  const result = record(raw.result);
  const error = jsonRpcError(raw.error);
  return {
    ...(jsonrpc === undefined ? {} : { jsonrpc }),
    ...(id === undefined ? {} : { id }),
    ...(method === undefined ? {} : { method }),
    ...(params === undefined ? {} : { params }),
    ...(result === undefined ? {} : { result }),
    ...(error === undefined ? {} : { error }),
  };
}
