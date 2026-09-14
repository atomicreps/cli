import * as clock from "./clock.js";
import { apiOrigin, readConfig } from "./config.js";
import { ANSWER_DEADLINE_MS, CALL_DEADLINE_MS, LOGIN_DEADLINE_MS } from "./constants.js";
import type {
  ApiResult,
  DevicePoll,
  DeviceStart,
  DomainEntry,
  RepRequest,
  SettingsPatch,
  Show,
  ToolReply,
  TopicEntry,
} from "./types.js";
import { parseCatalog, parseDevicePoll, parseDeviceStart, parseToolReply } from "./wire.js";

type CallInit = {
  method: "GET" | "POST";
  body?: unknown;
  token?: string | undefined;
  deadlineMs?: number | undefined;
  headers?: Record<string, string> | undefined;
  signal?: AbortSignal | undefined;
  allowNotModified?: boolean | undefined;
};

async function call(path: string, init: CallInit): Promise<ApiResult<unknown>> {
  const started = clock.now();
  const signal = clock.within(init.deadlineMs ?? CALL_DEADLINE_MS, init.signal);
  try {
    const headers: Record<string, string> = { accept: "application/json", ...init.headers };
    if (init.body !== undefined) headers["content-type"] = "application/json";
    if (init.token) headers.authorization = `Bearer ${init.token}`;
    const response = await fetch(`${apiOrigin()}${path}`, {
      method: init.method,
      headers,
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal,
    });
    const ms = clock.now() - started;
    if (response.status === 304 && init.allowNotModified) {
      return { ok: true, value: null, ms, status: 304 };
    }
    if (response.status === 401) return { ok: false, reason: "unauthorized", ms };
    if (response.status === 503) return { ok: false, reason: "closed", ms };
    const offProtocol = (): ApiResult<unknown> => ({
      ok: false,
      reason: response.status >= 500 ? "server" : "misrouted",
      ms,
      detail: `${response.status}`,
    });
    if (!response.ok) return offProtocol();
    if (response.redirected) return offProtocol();
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      return offProtocol();
    }
    return { ok: true, value, ms, status: response.status };
  } catch (error) {
    const ms = clock.now() - started;
    const expired = Error.isError(error) && error.name === "TimeoutError";
    return {
      ok: false,
      reason: expired ? "timeout" : "network",
      ms,
      detail: Error.isError(error) ? error.message : String(error),
    };
  }
}

function token(): string | undefined {
  return readConfig().token;
}

async function parsed<T>(
  result: Promise<ApiResult<unknown>>,
  parse: (value: unknown) => T | null,
): Promise<ApiResult<T>> {
  const answered = await result;
  if (!answered.ok) return answered;
  const value = parse(answered.value);
  if (value === null) {
    return { ok: false, reason: "server", ms: answered.ms, detail: "unreadable payload" };
  }
  return { ok: true, value, ms: answered.ms, status: answered.status };
}

export function startDeviceLogin(
  clientName: string,
  host: string,
): Promise<ApiResult<DeviceStart>> {
  return parsed(
    call("/mcp/device/start", {
      method: "POST",
      body: { clientName, host },
      deadlineMs: LOGIN_DEADLINE_MS,
    }),
    parseDeviceStart,
  );
}

export function pollDeviceLogin(deviceSecret: string): Promise<ApiResult<DevicePoll>> {
  return parsed(
    call("/mcp/device/poll", {
      method: "POST",
      body: { deviceSecret },
      deadlineMs: LOGIN_DEADLINE_MS,
    }),
    parseDevicePoll,
  );
}

export function rep(
  request: RepRequest,
  deadlineMs?: number,
  signal?: AbortSignal,
): Promise<ApiResult<ToolReply>> {
  return parsed(
    call("/mcp/rep", { method: "POST", body: request, token: token(), deadlineMs, signal }),
    parseToolReply,
  );
}

export function answer(
  id: string | undefined,
  pick: string,
  sure?: boolean,
): Promise<ApiResult<ToolReply>> {
  return parsed(
    call("/mcp/answer", {
      method: "POST",
      body: {
        ...(id === undefined ? {} : { id }),
        pick,
        ...(sure === undefined ? {} : { sure }),
      },
      token: token(),
      deadlineMs: ANSWER_DEADLINE_MS,
    }),
    parseToolReply,
  );
}

export function me(show: Show = "summary", deadlineMs?: number): Promise<ApiResult<ToolReply>> {
  return parsed(
    call(`/mcp/me?show=${show}`, { method: "GET", token: token(), deadlineMs }),
    parseToolReply,
  );
}

export function topics(
  deadlineMs?: number,
): Promise<ApiResult<{ topics: TopicEntry[]; domains?: DomainEntry[] }>> {
  return parsed(call("/mcp/topics", { method: "GET", token: token(), deadlineMs }), parseCatalog);
}

export function grammar(knownVersion?: string, deadlineMs?: number): Promise<ApiResult<unknown>> {
  return call("/mcp/grammar", {
    method: "GET",
    token: token(),
    deadlineMs: deadlineMs ?? LOGIN_DEADLINE_MS,
    headers: knownVersion === undefined ? {} : { "if-none-match": `"${knownVersion}"` },
    allowNotModified: true,
  });
}

export function settings(patch: SettingsPatch): Promise<ApiResult<ToolReply>> {
  return parsed(
    call("/mcp/settings", {
      method: "POST",
      body: patch,
      token: token(),
      deadlineMs: ANSWER_DEADLINE_MS,
    }),
    parseToolReply,
  );
}
