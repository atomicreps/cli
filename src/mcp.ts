import { createInterface } from "node:readline";

import * as clock from "./clock.js";
import { apiOrigin, isAlpha, noteFailure, noteQuiet, readConfig, updateConfig } from "./config.js";
import {
  ALPHA_API,
  ANSWER_DEADLINE_MS,
  CALL_DEADLINE_MS,
  DEFAULT_API,
  DEGRADED_BACKOFF_MS,
  DOCTOR_HINT,
  INFER_BUDGET_MS,
  LEGACY_VERSIONS,
  LOGIN_DEADLINE_MS,
  MAX_INPUT_ROUNDS,
  MAX_MUTE_MINUTES,
  META_CLIENT_CAPABILITIES,
  META_CLIENT_INFO,
  META_VERSION,
  MODERN_ENVELOPE_KEYS,
  MODERN_VERSION,
  MS_PER_MINUTE,
  SIGN_IN_MESSAGE,
  UNAUTHORIZED_BACKOFF_MS,
} from "./constants.js";
import { FALLBACK_INSTRUCTIONS, FALLBACK_TOOLS } from "./format.js";
import { inferHints } from "./infer.js";
import { cachedGrammar, observeRep, observeVerdict, writeStatusCache } from "./store.js";
import { EMPTY_GRAMMAR, knownHandle, resolvePhrases, resolveTopic } from "./touch.js";
import {
  isRecord,
  type DoorCall,
  type DoorFailure,
  type JsonRpcId,
  type JsonRpcMessage,
  type ReportableFailure,
  type TouchGrammar,
} from "./types.js";
import { SERVER_VERSION } from "./version.js";

export { SERVER_VERSION };

const FAILURE_KIND = {
  unauthorized: "terminal",
  misrouted: "terminal",
  timeout: "transient",
  network: "transient",
  server: "transient",
  closed: "transient",
  cancelled: "silent",
} as const satisfies Record<DoorFailure, "terminal" | "transient" | "silent">;

const TERMINAL_MESSAGE = {
  unauthorized: () => SIGN_IN_MESSAGE,
  misrouted: () => {
    const origin = apiOrigin();
    const expected = isAlpha() ? ALPHA_API : DEFAULT_API;
    if (origin === expected) return `Atomic Reps is not answering at ${origin}. ${DOCTOR_HINT}`;
    return `Atomic Reps is not served at ${origin}. Unset ATOMICREPS_API to use ${expected}, or point it at the right origin.`;
  },
} as const satisfies Record<TerminalFailure, () => string>;

type TerminalFailure = {
  [K in ReportableFailure]: (typeof FAILURE_KIND)[K] extends "terminal" ? K : never;
}[ReportableFailure];

function isTerminal(reason: ReportableFailure): reason is TerminalFailure {
  return FAILURE_KIND[reason] === "terminal";
}

function isReportable(reason: DoorFailure): reason is ReportableFailure {
  return FAILURE_KIND[reason] !== "silent";
}

const DEGRADED_LIST: Record<string, Record<string, unknown>> = {
  "tools/list": { tools: FALLBACK_TOOLS },
  "prompts/list": { prompts: [] },
  "resources/list": { resources: [] },
  "resources/templates/list": { resourceTemplates: [] },
};

function unreachableText(reason: string): string {
  return `Atomic Reps is unreachable (${reason}). ${DOCTOR_HINT}`;
}

const REP_KINDS: ReadonlySet<string> = new Set(["auto", "question", "insight"]);
const REP_LANES: ReadonlySet<string> = new Set(["asked", "pushed"]);

const NAMED: Record<string, "name" | "uri"> = {
  "tools/call": "name",
  "prompts/get": "name",
  "resources/read": "uri",
};

function log(message: string): void {
  process.stderr.write(`[atomicreps] ${message}\n`);
}

function headerValue(value: string): string {
  const ascii = /^[\x21-\x7e][\x20-\x7e]*[\x21-\x7e]$|^[\x21-\x7e]$/.test(value);
  if (ascii && !value.startsWith("=?base64?")) return value;
  return `=?base64?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

type Era =
  | { kind: "opening" }
  | {
      kind: "legacy";
      clientInfo: Record<string, unknown>;
      clientCapabilities: Record<string, unknown>;
    }
  | {
      kind: "modern";
      clientInfo: Record<string, unknown>;
      clientCapabilities: Record<string, unknown>;
    };

export class Bridge {
  private era: Era = { kind: "opening" };
  private readonly inflight = new Map<string, AbortController>();
  private readonly awaitingClient = new Map<string, (message: JsonRpcMessage) => void>();
  private serverRequestId = 0;

  constructor(
    private readonly write: (message: JsonRpcMessage) => void,
    private readonly cwd: string = process.cwd(),
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async callDoor(
    message: JsonRpcMessage,
    deadlineMs: number,
    signal?: AbortSignal,
  ): Promise<DoorCall> {
    const token = readConfig().token;
    if (!token) return { ok: false, reason: "unauthorized" };
    const within = clock.within(deadlineMs, signal);
    const headers: Record<string, string> = {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      "mcp-protocol-version": MODERN_VERSION,
      "mcp-method": message.method ?? "",
    };
    const field = message.method ? NAMED[message.method] : undefined;
    const named = field ? message.params?.[field] : undefined;
    if (typeof named === "string") headers["mcp-name"] = headerValue(named);
    try {
      const response = await this.fetchImpl(`${apiOrigin()}/mcp`, {
        method: "POST",
        headers,
        body: JSON.stringify(message),
        signal: within,
      });
      if (response.status === 401) return { ok: false, reason: "unauthorized" };
      if (response.status === 503) return { ok: false, reason: "closed" };
      if (response.status === 202) return { ok: true, body: {} };
      const serverSide = response.status >= 500;
      const offProtocol: DoorCall = { ok: false, reason: serverSide ? "server" : "misrouted" };
      if (response.redirected && !serverSide) return { ok: false, reason: "misrouted" };
      let body: JsonRpcMessage = {};
      try {
        const parsed: unknown = JSON.parse(await response.text());
        if (!isRecord(parsed)) return offProtocol;
        body = parsed as JsonRpcMessage;
      } catch {
        return offProtocol;
      }
      if (!response.ok && body.error === undefined) return offProtocol;
      return { ok: true, body };
    } catch (error) {
      if (signal?.aborted) return { ok: false, reason: "cancelled" };
      const expired = Error.isError(error) && error.name === "TimeoutError";
      return { ok: false, reason: expired ? "timeout" : "network" };
    }
  }

  private async roundTrip(
    id: JsonRpcId,
    message: JsonRpcMessage,
    deadlineMs: number,
    then?: (door: DoorCall, signal: AbortSignal) => Promise<DoorCall>,
  ): Promise<DoorCall> {
    const controller = new AbortController();
    using _registered = this.track(id, controller);
    const door = await this.callDoor(this.modernize(message), deadlineMs, controller.signal);
    return then ? await then(door, controller.signal) : door;
  }

  private track(id: JsonRpcId, controller: AbortController): Disposable {
    const key = String(id);
    this.inflight.set(key, controller);
    return {
      [Symbol.dispose]: () => {
        this.inflight.delete(key);
      },
    };
  }

  private modernize(message: JsonRpcMessage): JsonRpcMessage {
    const era = this.era;
    if (era.kind === "modern") return message;
    const info = era.kind === "legacy" ? era.clientInfo : {};
    const params: Record<string, unknown> = { ...message.params };
    const meta = isRecord(params._meta) ? { ...params._meta } : {};
    meta[META_VERSION] = MODERN_VERSION;
    meta[META_CLIENT_INFO] = { ...info, name: info.name ?? "unknown" };
    meta[META_CLIENT_CAPABILITIES] = era.kind === "legacy" ? era.clientCapabilities : {};
    params._meta = meta;
    return { ...message, params };
  }

  private legacyResult(result: Record<string, unknown>): Record<string, unknown> {
    if (this.era.kind === "modern") return result;
    return Object.fromEntries(
      Object.entries(result).filter(([key]) => !MODERN_ENVELOPE_KEYS.has(key)),
    );
  }

  private reply(id: JsonRpcId, result: Record<string, unknown>): void {
    this.write({ jsonrpc: "2.0", id, result: this.legacyResult(result) });
  }

  private fail(id: JsonRpcId, code: number, message: string): void {
    this.write({ jsonrpc: "2.0", id, error: { code, message } });
  }

  private forward(id: JsonRpcId, body: JsonRpcMessage): void {
    if (body.error) this.write({ jsonrpc: "2.0", id, error: body.error });
    else if (isRecord(body.result)) this.reply(id, body.result);
    else this.fail(id, -32_000, "Atomic Reps answered with nothing.");
  }

  private unreachable(
    id: JsonRpcId,
    method: string,
    reason: ReportableFailure,
    now: clock.EpochMs,
  ): void {
    noteFailure(`${method}: ${reason}`, now);
    switch (FAILURE_KIND[reason]) {
      case "terminal":
        this.fail(id, -32_001, TERMINAL_MESSAGE[reason as TerminalFailure]());
        return;
      case "transient": {
        const list = DEGRADED_LIST[method];
        if (list) this.reply(id, list);
        else this.fail(id, -32_000, unreachableText(reason));
        return;
      }
    }
  }

  async handleLine(line: string): Promise<void> {
    const trimmed = line.trim();
    if (trimmed === "") return;
    let message: JsonRpcMessage;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (!isRecord(parsed)) throw new Error("not an object");
      message = parsed as JsonRpcMessage;
    } catch {
      this.fail(null, -32_700, "Parse error: invalid JSON");
      return;
    }
    if (message.method === undefined) {
      const key = message.id === undefined ? undefined : String(message.id);
      const waiting = key === undefined ? undefined : this.awaitingClient.get(key);
      if (waiting && key !== undefined) {
        this.awaitingClient.delete(key);
        waiting(message);
      }
      return;
    }
    if (message.id === undefined) {
      if (message.method === "notifications/cancelled") {
        const requestId = message.params?.requestId;
        if (requestId !== undefined) this.inflight.get(String(requestId))?.abort();
      }
      return;
    }
    await this.handleRequest(message);
  }

  private async handleRequest(message: JsonRpcMessage): Promise<void> {
    const id = message.id ?? null;
    const method = message.method ?? "";
    const params = message.params ?? {};

    if (method === "initialize") return await this.handleInitialize(id, params);
    if (method === "server/discover") {
      const meta = isRecord(params._meta) ? params._meta : {};
      this.era = {
        kind: "modern",
        clientInfo: isRecord(meta[META_CLIENT_INFO]) ? meta[META_CLIENT_INFO] : {},
        clientCapabilities: isRecord(meta[META_CLIENT_CAPABILITIES])
          ? meta[META_CLIENT_CAPABILITIES]
          : {},
      };
    }
    if (method === "ping" && this.era.kind !== "modern") return this.reply(id, {});
    if (method === "tools/call") return await this.handleToolCall(id, params);

    const door = await this.roundTrip(id, message, LOGIN_DEADLINE_MS);
    if (door.ok) return this.forward(id, door.body);
    if (isReportable(door.reason)) this.unreachable(id, method, door.reason, clock.now());
  }

  private async handleInitialize(id: JsonRpcId, params: Record<string, unknown>): Promise<void> {
    this.era = {
      kind: "legacy",
      clientInfo: isRecord(params.clientInfo) ? params.clientInfo : {},
      clientCapabilities: isRecord(params.capabilities) ? params.capabilities : {},
    };
    const requested = params.protocolVersion;
    const protocolVersion = LEGACY_VERSIONS.find((v) => v === requested) ?? LEGACY_VERSIONS[0];
    const discover = await this.roundTrip(
      id,
      { jsonrpc: "2.0", id: "discover", method: "server/discover", params: {} },
      LOGIN_DEADLINE_MS,
    );
    const instructions =
      discover.ok && typeof discover.body.result?.instructions === "string"
        ? discover.body.result.instructions
        : FALLBACK_INSTRUCTIONS;
    if (!discover.ok) log(`door unreachable at connect (${discover.reason}); serving fallback`);
    this.write({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion,
        capabilities: {
          tools: { listChanged: false },
          prompts: { listChanged: false },
          resources: { subscribe: false, listChanged: false },
          completions: {},
        },
        serverInfo: { name: "atomicreps", title: "Atomic Reps", version: SERVER_VERSION },
        instructions,
      },
    });
  }

  private async repArguments(
    raw: Record<string, unknown>,
    grammar: TouchGrammar,
    ask: string | undefined,
    lane: string | undefined,
    asked: boolean,
  ): Promise<Record<string, unknown>> {
    const args: Record<string, unknown> = {};
    if (!asked) {
      const hints = await inferHints(this.cwd, INFER_BUDGET_MS, grammar);
      const phrases = Array.isArray(raw.touched) ? resolvePhrases(grammar, raw.touched) : [];
      args.hints = { ...hints, touched: [...phrases, ...hints.touched] };
    }
    const topic = typeof raw.topic === "string" ? resolveTopic(grammar, raw.topic) : undefined;
    if (topic !== undefined) args.topic = topic;
    if (ask !== undefined) args.ask = ask;
    if (lane !== undefined) args.lane = lane;
    const exclude = typeof raw.exclude === "string" ? knownHandle(grammar, raw.exclude) : undefined;
    if (exclude !== undefined) args.exclude = exclude;
    if (typeof raw.kind === "string" && REP_KINDS.has(raw.kind)) args.kind = raw.kind;
    return args;
  }

  private async handleToolCall(id: JsonRpcId, params: Record<string, unknown>): Promise<void> {
    const name = typeof params.name === "string" ? params.name : "";
    const raw = isRecord(params.arguments) ? params.arguments : {};
    const now = clock.now();

    let args: Record<string, unknown>;
    let asked: boolean;
    if (name === "rep") {
      const grammar = cachedGrammar() ?? EMPTY_GRAMMAR;
      const ask = typeof raw.ask === "string" ? knownHandle(grammar, raw.ask) : undefined;
      const lane = typeof raw.lane === "string" && REP_LANES.has(raw.lane) ? raw.lane : undefined;
      asked = ask !== undefined || lane === "asked";
      if (!asked) {
        const quietUntil = readConfig().nextEligibleAt;
        if (typeof quietUntil === "number" && clock.locallyQuiet(quietUntil, now)) {
          return this.reply(id, {
            content: [{ type: "text", text: "" }],
            structuredContent: { kind: "quiet", reason: "gap", nextEligibleAt: quietUntil },
          });
        }
      }
      args = await this.repArguments(raw, grammar, ask, lane, asked);
    } else {
      args = { ...raw };
      asked = false;
    }

    const message: JsonRpcMessage = {
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { ...params, arguments: args },
    };
    const deadline = name === "rep" && !asked ? CALL_DEADLINE_MS : ANSWER_DEADLINE_MS;
    const door = await this.roundTrip(id, message, deadline, (first, signal) =>
      this.answerInputRequests(message, first, signal),
    );

    if (!door.ok) {
      if (door.reason === "cancelled") return;
      noteFailure(`${name}: ${door.reason}`, now);
      if (name !== "rep" || door.reason === "misrouted") {
        const text = isTerminal(door.reason)
          ? TERMINAL_MESSAGE[door.reason]()
          : unreachableText(door.reason);
        return this.reply(id, { content: [{ type: "text", text }], isError: true });
      }
      const nextEligibleAt =
        now + (door.reason === "unauthorized" ? UNAUTHORIZED_BACKOFF_MS : DEGRADED_BACKOFF_MS);
      updateConfig({ nextEligibleAt });
      noteQuiet("degraded", door.reason, now);
      return this.reply(id, {
        content: [{ type: "text", text: "" }],
        structuredContent: {
          kind: "quiet",
          reason: "degraded",
          detail: door.reason,
          nextEligibleAt,
        },
      });
    }
    if (isRecord(door.body.result)) this.observe(name, args, door.body.result, now);
    this.forward(id, door.body);
  }

  private async answerInputRequests(
    original: JsonRpcMessage,
    first: DoorCall,
    signal: AbortSignal,
  ): Promise<DoorCall> {
    let door = first;
    for (let round = 1; round <= MAX_INPUT_ROUNDS; round += 1) {
      if (!door.ok || this.era.kind === "modern") return door;
      const result = door.body.result;
      if (result?.resultType !== "input_required") return door;
      const requests = isRecord(result.inputRequests) ? result.inputRequests : {};
      const inputResponses: Record<string, unknown> = Object.create(null) as Record<
        string,
        unknown
      >;
      for (const [key, value] of Object.entries(requests)) {
        if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
        if (!isRecord(value) || typeof value.method !== "string") continue;
        inputResponses[key] = await this.askClient(
          value.method,
          isRecord(value.params) ? value.params : {},
        );
      }
      const requestState = result.requestState;
      const retry: JsonRpcMessage = {
        jsonrpc: "2.0",
        id: `${String(original.id)}:retry${round}`,
        ...(original.method === undefined ? {} : { method: original.method }),
        params: {
          ...original.params,
          inputResponses,
          ...(typeof requestState === "string" ? { requestState } : {}),
        },
      };
      door = await this.callDoor(this.modernize(retry), LOGIN_DEADLINE_MS, signal);
    }
    return door;
  }

  private askClient(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = `s${++this.serverRequestId}`;
    const { promise, resolve } = Promise.withResolvers<unknown>();
    this.awaitingClient.set(id, (message) => {
      resolve(isRecord(message.result) ? message.result : { action: "cancel" });
    });
    this.write({ jsonrpc: "2.0", id, method, params });
    return promise;
  }

  private observe(
    name: string,
    args: Record<string, unknown>,
    result: Record<string, unknown>,
    now: number,
  ): void {
    const data = isRecord(result.structuredContent) ? result.structuredContent : {};
    const textBlock = Array.isArray(result.content)
      ? result.content.find((c) => isRecord(c) && c.type === "text")
      : undefined;
    const text = isRecord(textBlock) && typeof textBlock.text === "string" ? textBlock.text : "";
    if (name === "rep") observeRep(data, text, now);
    if (name === "answer")
      observeVerdict(typeof args.id === "string" ? args.id : undefined, data, text, now);
    if (name === "me" && data.show === "summary") writeStatusCache(data, now);
    if (name === "settings" && typeof args.muteMinutes === "number" && args.muteMinutes > 0) {
      updateConfig({
        nextEligibleAt: now + Math.min(args.muteMinutes, MAX_MUTE_MINUTES) * MS_PER_MINUTE,
      });
    }
  }
}

export function serve(): void {
  const bridge = new Bridge((message) => {
    process.stdout.write(`${JSON.stringify(message)}\n`);
  });
  process.stdout.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") process.exit(0);
  });
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  let chain: Promise<void> = Promise.resolve();
  lines.on("line", (line) => {
    chain = chain
      .then(() => bridge.handleLine(line))
      .catch((error: unknown) => {
        log(`bridge: ${Error.isError(error) ? error.message : String(error)}`);
      });
  });
  lines.on("close", () => process.exit(0));
  updateConfig({ bridgeVersion: SERVER_VERSION });
  log(`bridge to ${apiOrigin()} on stdio (${SERVER_VERSION})`);
}
