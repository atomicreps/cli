import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let configHome: string;

beforeEach(() => {
  configHome = mkdtempSync(join(tmpdir(), "atomicreps-bridge-"));
  process.env.XDG_CONFIG_HOME = configHome;
  process.env.ATOMICREPS_API = "https://door.invalid";
  process.env.ATOMICREPS_UNSAFE_ORIGIN = "1";
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ATOMICREPS_API;
  delete process.env.ATOMICREPS_UNSAFE_ORIGIN;
});

type Sent = { headers: Record<string, string>; body: Record<string, unknown> };

const BLOCK =
  "⚛ **Atomic Reps · React**\n──────────────────────────\nWhich hook?\n\nA. useState\nB. useRef\n\n_From memory. Reply with a letter._";

function fakeDoor(answer: (body: Record<string, unknown>) => unknown | null) {
  const seen: Sent[] = [];
  const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    const headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [
        k.toLowerCase(),
        v,
      ]),
    );
    seen.push({ headers, body });
    const result = answer(body);
    if (result === null) throw new Error("ECONNREFUSED");
    if (result instanceof Response) return result;
    if (typeof result === "string" && /^\d{3}$/.test(result)) {
      return new Response("", { status: Number(result) });
    }
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  return { seen, fetchImpl: fetchImpl as unknown as typeof fetch };
}

async function bridgeWith(door: ReturnType<typeof fakeDoor>) {
  const { Bridge } = await import("../src/mcp.js");
  const { writeConfig } = await import("../src/config.js");
  writeConfig({ token: "arep_test" });
  const out: Array<Record<string, unknown>> = [];
  const bridge = new Bridge(
    (m) => out.push(m as Record<string, unknown>),
    configHome,
    door.fetchImpl,
  );
  const send = (message: object) => bridge.handleLine(JSON.stringify(message));
  return { bridge, out, send };
}

const DISCOVER = {
  resultType: "complete",
  supportedVersions: ["2026-07-28"],
  capabilities: { tools: {}, prompts: {}, resources: {}, completions: {} },
  instructions: "Atomic Reps serves one short retrieval question.",
  ttlMs: 3_600_000,
  cacheScope: "private",
  _meta: { "io.modelcontextprotocol/serverInfo": { name: "atomicreps", version: "0.0.1" } },
};

const TOOLS = {
  resultType: "complete",
  tools: [{ name: "rep" }, { name: "answer" }, { name: "me" }, { name: "settings" }],
  ttlMs: 3_600_000,
  cacheScope: "private",
  _meta: {},
};

describe("the stdio bridge", () => {
  it("serves a legacy client its handshake from the door's discover, and stamps _meta on every request", async () => {
    const door = fakeDoor((body) => (body.method === "server/discover" ? DISCOVER : TOOLS));
    const { out, send } = await bridgeWith(door);
    await send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: { elicitation: { form: {} } },
        clientInfo: { name: "codex-mcp-client", version: "0.147.0" },
      },
    });
    await send({ jsonrpc: "2.0", method: "notifications/initialized" });
    await send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });

    expect(door.seen[0]?.body.method).toBe("server/discover");
    const discoverParams = door.seen[0]?.body.params as
      | { _meta: Record<string, unknown> }
      | undefined;
    const meta = discoverParams?._meta ?? {};
    expect(meta["io.modelcontextprotocol/protocolVersion"]).toBe("2026-07-28");
    expect(meta["io.modelcontextprotocol/clientInfo"]).toMatchObject({ name: "codex-mcp-client" });
    expect(meta["io.modelcontextprotocol/clientCapabilities"]).toEqual({
      elicitation: { form: {} },
    });
    expect(door.seen[0]?.headers["mcp-protocol-version"]).toBe("2026-07-28");
    expect(door.seen[0]?.headers["mcp-method"]).toBe("server/discover");
    expect(door.seen[0]?.headers.authorization).toBe("Bearer arep_test");

    const init = out[0] as { result: Record<string, unknown> };
    expect(init.result.protocolVersion).toBe("2025-06-18");
    expect(init.result.instructions).toBe(DISCOVER.instructions);
    expect(init.result.serverInfo).toMatchObject({ name: "atomicreps" });
    expect(init.result.resultType).toBeUndefined();

    expect(door.seen[1]?.headers["mcp-method"]).toBe("tools/list");
    const listed = out[1] as { result: Record<string, unknown> };
    expect((listed.result.tools as Array<{ name: string }>).map((t) => t.name)).toEqual([
      "rep",
      "answer",
      "me",
      "settings",
    ]);
    expect(listed.result).not.toHaveProperty("resultType");
    expect(listed.result).not.toHaveProperty("ttlMs");
    expect(listed.result).not.toHaveProperty("_meta");
  });

  it("passes a modern client through untouched, envelope and all", async () => {
    const door = fakeDoor((body) => (body.method === "server/discover" ? DISCOVER : TOOLS));
    const { out, send } = await bridgeWith(door);
    const meta = {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientInfo": { name: "claude-code", version: "2.1.268" },
      "io.modelcontextprotocol/clientCapabilities": { elicitation: {} },
    };
    await send({ jsonrpc: "2.0", id: 1, method: "server/discover", params: { _meta: meta } });
    await send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: { _meta: meta } });
    expect(door.seen[1]?.body.params).toEqual({ _meta: meta });
    const listed = out[1] as { result: Record<string, unknown> };
    expect(listed.result.resultType).toBe("complete");
    expect(listed.result.ttlMs).toBe(3_600_000);
  });

  it("rep: the quiet clock opens no socket; otherwise hints ride along and the serve is noted", async () => {
    const door = fakeDoor((body) => {
      if (body.method === "server/discover") return DISCOVER;
      return {
        resultType: "complete",
        content: [{ type: "text", text: BLOCK }],
        structuredContent: {
          kind: "question",
          text: BLOCK,
          id: "q1",
          topicSlug: "react",
          topicSource: "touched",
          gated: null,
          nextEligibleAt: Date.now() + 60 * 60_000,
          lane: "pushed",
          handle: "react.hooks_core",
          offer: [{ handle: "css.grid", name: "CSS · Grid" }],
        },
      };
    });
    const { out, send } = await bridgeWith(door);
    const { updateConfig, readConfig } = await import("../src/config.js");
    const store = await import("../src/store.js");
    await send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-11-25" },
    });

    updateConfig({ nextEligibleAt: Date.now() + 60_000 });
    await send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "rep", arguments: {} },
    });
    expect(door.seen).toHaveLength(1);
    const quiet = out[1] as { result: { structuredContent: { kind: string; reason: string } } };
    expect(quiet.result.structuredContent).toMatchObject({ kind: "quiet", reason: "gap" });

    updateConfig({ nextEligibleAt: 0 });
    await send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "rep", arguments: { touched: ["useEffect cleanup"] } },
    });
    const call = door.seen[1];
    expect(call?.headers["mcp-name"]).toBe("rep");
    const callParams = call?.body.params as { arguments: Record<string, unknown> } | undefined;
    const args = callParams?.arguments ?? {};
    expect(args.touched).toBeUndefined();
    expect(args.hints).toMatchObject({ packages: expect.any(Array), touched: expect.any(Array) });
    expect(store.pendingRep()?.id).toBe("q1");
    expect(store.pendingRep()?.handle).toBe("react.hooks_core");
    expect((readConfig().nextEligibleAt ?? 0) > Date.now()).toBe(true);
    const served = out[2] as { result: { structuredContent: { id: string } } };
    expect(served.result.structuredContent.id).toBe("q1");
  });

  function argumentsOf(call: Sent | undefined): Record<string, unknown> {
    const params = call?.body.params as { arguments?: Record<string, unknown> } | undefined;
    return params?.arguments ?? {};
  }

  function cacheGrammar(): void {
    mkdirSync(join(configHome, "atomicreps"), { recursive: true });
    writeFileSync(
      join(configHome, "atomicreps", "grammar.json"),
      JSON.stringify({
        fetchedAt: Date.now(),
        grammar: {
          version: "v1",
          paths: [],
          words: [{ words: "useeffect cleanup", key: "react.effects", weight: 2 }],
          vocabulary: {
            handles: ["react.effects", "react.hooks_core"],
            packages: ["react"],
            extensions: ["ts"],
          },
        },
      }),
    );
  }

  function servingDoor() {
    return fakeDoor((body) => {
      if (body.method === "server/discover") return DISCOVER;
      return {
        resultType: "complete",
        content: [{ type: "text", text: BLOCK }],
        structuredContent: { kind: "question", text: BLOCK, id: "q1", topicSlug: "react" },
      };
    });
  }

  it("rep: the host's own words never reach the door, only what the catalog names", async () => {
    const door = servingDoor();
    const { send } = await bridgeWith(door);
    cacheGrammar();
    await send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-11-25" },
    });
    await send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "rep",
        arguments: {
          touched: ["def add(x, xs=[]):", "useEffect cleanup"],
          topic: "customer fraud scoring in checkout",
          packages: ["@bank/risk-engine"],
          notes: "the user said their card was declined",
          kind: "sideways",
        },
      },
    });
    const sent = JSON.stringify(door.seen[1]?.body);
    for (const leak of ["add(", "fraud", "bank", "notes", "declined", "sideways"]) {
      expect(sent, leak).not.toContain(leak);
    }
    const args = argumentsOf(door.seen[1]);
    const hints = args.hints as { touched: Array<{ key: string; weight: number }> };
    expect(hints.touched).toContainEqual({ key: "react.effects", weight: 3 });
    expect(Object.keys(args).toSorted()).toEqual(["hints"]);
  });

  it("rep: an ask is forwarded only when it is a handle the door publishes", async () => {
    const door = servingDoor();
    const { send } = await bridgeWith(door);
    cacheGrammar();
    await send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-11-25" },
    });
    await send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "rep", arguments: { ask: "internal.secret_project" } },
    });
    const dropped = argumentsOf(door.seen[1]);
    expect(dropped.ask).toBeUndefined();
    expect(JSON.stringify(door.seen[1]?.body)).not.toContain("secret_project");

    await send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "rep", arguments: { ask: "React.Hooks_core", lane: "asked" } },
    });
    const kept = argumentsOf(door.seen[2]);
    expect(kept.ask).toBe("react.hooks_core");
    expect(kept.lane).toBe("asked");
    expect(kept.hints).toBeUndefined();
  });

  it("answer: the verdict and its offer are noted so a digit resolves locally", async () => {
    const door = fakeDoor((body) => {
      if (body.method === "server/discover") return DISCOVER;
      return {
        resultType: "complete",
        content: [{ type: "text", text: "✅ **Correct** · useRef" }],
        structuredContent: {
          status: "answered",
          text: "✅ **Correct** · useRef",
          correct: true,
          currentStreak: 2,
          handle: "react.hooks_core",
          lane: "pushed",
          offer: [{ handle: "css.grid", name: "CSS · Grid" }],
          shareUrl: null,
          upgradeUrl: null,
        },
      };
    });
    const { send } = await bridgeWith(door);
    const store = await import("../src/store.js");
    store.observeRep(
      { kind: "question", id: "q1", topicSlug: "react" },
      BLOCK,
      Date.now() - 10_000,
    );
    await send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    await send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "answer", arguments: { pick: "B" } },
    });
    expect(store.pendingRep()).toBeUndefined();
    expect(store.openOffer()).toEqual([{ handle: "css.grid", name: "CSS · Grid" }]);
  });

  it("MRTR for a legacy client: input_required becomes an elicitation over stdio, answered into the retry", async () => {
    let calls = 0;
    const door = fakeDoor((body) => {
      if (body.method === "server/discover") return DISCOVER;
      calls += 1;
      const params = body.params as {
        inputResponses?: Record<string, unknown>;
        requestState?: string;
      };
      if (params.inputResponses === undefined) {
        return {
          resultType: "input_required",
          inputRequests: {
            pick: {
              method: "elicitation/create",
              params: { mode: "form", message: BLOCK, requestedSchema: { type: "object" } },
            },
          },
          requestState: "opaque-state",
        };
      }
      expect(params.requestState).toBe("opaque-state");
      expect(params.inputResponses).toEqual({
        pick: { action: "accept", content: { pick: "B" } },
      });
      return {
        resultType: "complete",
        content: [{ type: "text", text: "✅ **Correct** · useRef" }],
        structuredContent: { kind: "question", id: "q1", text: "✅ **Correct** · useRef" },
      };
    });
    const { out, send } = await bridgeWith(door);
    await send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-11-25", capabilities: { elicitation: {} } },
    });
    const call = send({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: "rep", arguments: {} },
    });
    await vi.waitFor(() => expect(out.some((m) => m.method === "elicitation/create")).toBe(true));
    const ask = out.find((m) => m.method === "elicitation/create") as {
      id: string;
      params: { message: string };
    };
    expect(ask.params.message).toBe(BLOCK);
    await send({
      jsonrpc: "2.0",
      id: ask.id,
      result: { action: "accept", content: { pick: "B" } },
    });
    await call;
    expect(calls).toBe(2);
    const final = out.find((m) => m.id === 7) as { result: { content: Array<{ text: string }> } };
    expect(final.result.content[0]?.text).toContain("Correct");
  });

  it("says to sign in rather than answering an empty list when the door refuses the token", async () => {
    const door = fakeDoor(() => "401");
    const { out, send } = await bridgeWith(door);
    await send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    const answer = out[0] as { result?: unknown; error?: { code: number; message: string } };
    expect(answer.result, "an empty list would be silent").toBeUndefined();
    expect(answer.error?.message).toContain("npx atomicreps login");
  });

  it("stays connected through a blip AND still offers the four tools", async () => {
    const door = fakeDoor(() => null);
    const { out, send } = await bridgeWith(door);
    await send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    const tools = (out[0] as { result: { tools: Array<{ name: string }> } }).result.tools;
    expect(tools.map((t) => t.name)).toEqual(["rep", "answer", "me", "settings"]);
  });

  const OFF_PROTOCOL: ReadonlyArray<[label: string, reply: () => unknown]> = [
    ["a retired deployment, 404 and empty", () => "404"],
    [
      "a site origin serving its page, 200 and HTML",
      () => new Response("<!doctype html><title>Atomic Reps</title>", { status: 200 }),
    ],
    [
      "a stranger's JSON API, 200 and well-formed nonsense",
      () => new Response(JSON.stringify(["not", "a", "message"]), { status: 200 }),
    ],
  ];

  for (const [label, reply] of OFF_PROTOCOL) {
    it(`names the origin when it is ${label}, rather than waiting it out`, async () => {
      const door = fakeDoor(reply);
      const { out, send } = await bridgeWith(door);
      await send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
      const answer = out[0] as { result?: unknown; error?: { message: string } };
      expect(answer.result, "a tool list would hide the typo").toBeUndefined();
      expect(answer.error?.message).toContain("https://door.invalid");
      expect(answer.error?.message).toContain("ATOMICREPS_API");
    });
  }

  it("says so on rep when the door is misrouted, and stays quiet when it is merely down", async () => {
    const { readConfig } = await import("../src/config.js");
    const call = { name: "rep", arguments: {} };

    const wrong = await bridgeWith(fakeDoor(() => "404"));
    await wrong.send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: call });
    const spoke = wrong.out[0] as { result: { isError?: boolean; content: [{ text: string }] } };
    expect(spoke.result.isError).toBe(true);
    expect(spoke.result.content[0].text).toContain("https://door.invalid");
    expect(readConfig().nextEligibleAt, "a dead origin must not book a retry").toBeUndefined();

    const down = await bridgeWith(fakeDoor(() => "500"));
    await down.send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: call });
    const quiet = down.out[0] as { result: { structuredContent: { kind: string } } };
    expect(quiet.result.structuredContent).toMatchObject({ kind: "quiet", reason: "degraded" });
  });

  it("a dead door is quiet for rep, the offline list for lists, a readable error otherwise; legacy ping is local", async () => {
    const door = fakeDoor(() => null);
    const { out, send } = await bridgeWith(door);
    const { readConfig } = await import("../src/config.js");
    await send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    const init = out[0] as { result: { instructions: string } };
    expect(init.result.instructions).toContain("Atomic Reps");

    await send({ jsonrpc: "2.0", id: 2, method: "ping", params: {} });
    expect(out[1]).toEqual({ jsonrpc: "2.0", id: 2, result: {} });
    expect(door.seen).toHaveLength(1);

    await send({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} });
    const offline = (out[2] as { result: { tools: Array<{ name: string }> } }).result.tools;
    expect(offline.map((t) => t.name)).toEqual(["rep", "answer", "me", "settings"]);

    await send({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "rep", arguments: {} },
    });
    const rep = out[3] as { result: { structuredContent: { kind: string; reason: string } } };
    expect(rep.result.structuredContent).toMatchObject({ kind: "quiet", reason: "degraded" });
    expect((readConfig().nextEligibleAt ?? 0) > Date.now()).toBe(true);

    await send({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "me", arguments: {} },
    });
    const me = out[4] as { result: { isError: boolean; content: Array<{ text: string }> } };
    expect(me.result.isError).toBe(true);
    expect(me.result.content[0]?.text).toContain("doctor");

    await send({
      jsonrpc: "2.0",
      id: 6,
      method: "prompts/get",
      params: { name: "rep", arguments: {} },
    });
    expect((out[5] as { error: { code: number } }).error.code).toBe(-32_000);
  });

  it("a revoked token is unauthorized: rep backs the clock off an hour and says so in the store", async () => {
    const door = fakeDoor(() => "401");
    const { send } = await bridgeWith(door);
    const { readConfig } = await import("../src/config.js");
    await send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    await send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "rep", arguments: {} },
    });
    expect((readConfig().nextEligibleAt ?? 0) - Date.now()).toBeGreaterThan(50 * 60_000);
    expect(readConfig().lastQuiet).toContain("unauthorized");
  });
});
