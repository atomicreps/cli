import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SERVER_VERSION } from "../src/version.js";

const CLI = resolve(__dirname, "../dist/cli.js");
const CONFIG_HOME = resolve(__dirname, "tmp-config");
const ESC = "\u001b";

const seen: Array<{ method: string; headers: Record<string, string | string[] | undefined> }> = [];
let origin = "";
const door = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const message = JSON.parse(body) as { id: unknown; method: string };
    seen.push({ method: message.method, headers: req.headers });
    const result =
      message.method === "server/discover"
        ? {
            resultType: "complete",
            supportedVersions: ["2026-07-28"],
            capabilities: { tools: {} },
            instructions: "Atomic Reps serves one short retrieval question.",
            ttlMs: 60_000,
            cacheScope: "private",
          }
        : {
            resultType: "complete",
            tools: [
              {
                name: "rep",
                annotations: { openWorldHint: false },
                outputSchema: { type: "object" },
              },
              {
                name: "answer",
                annotations: { openWorldHint: false },
                outputSchema: { type: "object" },
              },
              {
                name: "me",
                annotations: { openWorldHint: false, readOnlyHint: true },
                outputSchema: { type: "object" },
              },
              {
                name: "settings",
                annotations: { openWorldHint: false },
                outputSchema: { type: "object" },
              },
            ],
            ttlMs: 60_000,
            cacheScope: "private",
          };
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
  });
});

beforeAll(async () => {
  await new Promise<void>((done) => door.listen(0, "127.0.0.1", () => done()));
  const address = door.address();
  origin = typeof address === "object" && address ? `http://127.0.0.1:${address.port}` : "";
  mkdirSync(resolve(CONFIG_HOME, "atomicreps"), { recursive: true });
  writeFileSync(
    resolve(CONFIG_HOME, "atomicreps", "config.json"),
    JSON.stringify({ token: "arep_test" }),
  );
});

afterAll(() => {
  door.close();
});

function probe(messages: object[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [CLI, "mcp"], {
      env: {
        ...process.env,
        FORCE_COLOR: "1",
        XDG_CONFIG_HOME: CONFIG_HOME,
        ATOMICREPS_API: origin,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c: Buffer) => (stdout += c.toString("utf8")));
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString("utf8")));
    child.on("error", fail);
    child.on("close", () => done({ stdout, stderr }));
    child.stdin.write(messages.map((m) => `${JSON.stringify(m)}\n`).join(""));
    setTimeout(() => child.stdin.end(), 800);
  });
}

describe("atomicreps mcp over stdio", () => {
  it("stdout is JSON-RPC only: first byte is {, no escape byte, instructions from the server", async () => {
    const { stdout, stderr } = await probe([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "t", version: "0" },
        },
      },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
    ]);
    expect(stdout.charAt(0)).toBe("{");
    expect(stdout.includes(ESC)).toBe(false);
    const lines = stdout
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { id?: number; result?: Record<string, unknown> });
    const init = lines.find((l) => l.id === 1);
    expect(init?.result?.instructions).toBe("Atomic Reps serves one short retrieval question.");
    expect(init?.result?.protocolVersion).toBe("2025-11-25");
    const serverInfo = init?.result?.serverInfo as { version: string };
    expect(SERVER_VERSION).not.toBe("0.0.0");
    expect(serverInfo.version).toBe(SERVER_VERSION);

    const list = lines.find((l) => l.id === 2);
    const tools = (list?.result?.tools as Array<{ name: string }>) ?? [];
    expect(tools.map((t) => t.name)).toEqual(["rep", "answer", "me", "settings"]);
    expect(list?.result).not.toHaveProperty("resultType");
    expect(stderr).toContain("[atomicreps]");

    expect(seen.map((s) => s.method)).toEqual(["server/discover", "tools/list"]);
    expect(seen[0]?.headers["mcp-protocol-version"]).toBe("2026-07-28");
    expect(seen[1]?.headers["mcp-method"]).toBe("tools/list");
  }, 10_000);
});
