import { describe, expect, it } from "vitest";

import {
  parseCatalog,
  parseDevicePoll,
  parseDeviceStart,
  parseJsonRpcMessage,
  parseToolReply,
} from "../src/wire.js";

const START = {
  userCode: "ABCD-1234",
  deviceSecret: "s3cret",
  verifyUrl: "https://atomicreps.com/device",
  expiresAt: 1_700_000_000_000,
  intervalMs: 2000,
};

describe("the sign-in payloads", () => {
  it("reads a whole device start", () => {
    expect(parseDeviceStart(START)).toEqual(START);
  });

  it("refuses a device start missing any field it will use", () => {
    const fields = [
      "userCode",
      "deviceSecret",
      "verifyUrl",
      "expiresAt",
      "intervalMs",
    ] as const satisfies ReadonlyArray<keyof typeof START>;
    for (const field of fields) {
      const rest: Record<string, unknown> = { ...START };
      delete rest[field];
      expect(parseDeviceStart(rest), `${field} missing`).toBeNull();
    }
    expect(parseDeviceStart({ ...START, intervalMs: "2000" })).toBeNull();
    expect(parseDeviceStart({ ...START, expiresAt: Number.NaN })).toBeNull();
    expect(parseDeviceStart(null)).toBeNull();
    expect(parseDeviceStart("approved")).toBeNull();
  });

  it("refuses an approval whose token is not a string", () => {
    expect(parseDevicePoll({ status: "approved", token: "tok_1" })).toEqual({
      status: "approved",
      token: "tok_1",
    });
    expect(parseDevicePoll({ status: "approved" })).toBeNull();
    expect(parseDevicePoll({ status: "approved", token: 12 })).toBeNull();
  });

  it("refuses a status the door does not have", () => {
    expect(parseDevicePoll({ status: "pending" })).toEqual({ status: "pending" });
    expect(parseDevicePoll({ status: "denied" })).toBeNull();
    expect(parseDevicePoll({})).toBeNull();
  });
});

describe("a tool reply", () => {
  it("always answers, and always with a string and an object or null", () => {
    expect(parseToolReply({ text: "⚛ block", data: { kind: "question" } })).toEqual({
      text: "⚛ block",
      data: { kind: "question" },
    });
    for (const payload of [null, "text", 7, [], {}, { text: 12, data: "nope" }]) {
      const reply = parseToolReply(payload);
      expect(typeof reply.text, JSON.stringify(payload)).toBe("string");
      expect(reply.data === null || typeof reply.data === "object").toBe(true);
    }
  });

  it("keeps the client block only where it is one", () => {
    expect(parseToolReply({ text: "", client: { grammarVersion: 3 } }).client).toEqual({});
    expect(parseToolReply({ text: "", client: "v3" }).client).toBeUndefined();
    expect(parseToolReply({ text: "", client: { muteKeys: ["react", 4] } }).client).toEqual({
      muteKeys: ["react"],
    });
  });
});

describe("a catalog", () => {
  it("drops the entries it cannot read and keeps the rest", () => {
    const parsed = parseCatalog({
      topics: [{ slug: "react", name: "React", free: true }, { slug: "no-name" }, null],
      domains: [{ slug: "frontend", name: "Frontend" }, "backend"],
    });
    expect(parsed.topics).toEqual([{ slug: "react", name: "React", free: true }]);
    expect(parsed.domains).toEqual([{ slug: "frontend", name: "Frontend" }]);
  });

  it("answers with an empty catalog rather than throwing", () => {
    expect(parseCatalog(null)).toEqual({ topics: [] });
    expect(parseCatalog({ topics: "all of them" })).toEqual({ topics: [] });
  });
});

describe("a JSON-RPC envelope", () => {
  it("drops an error that is not an error object", () => {
    expect(parseJsonRpcMessage({ jsonrpc: "2.0", id: 1, error: "boom" })?.error).toBeUndefined();
    expect(parseJsonRpcMessage({ error: { message: "no code" } })?.error).toBeUndefined();
    expect(parseJsonRpcMessage({ error: { code: -32_000, message: "gone" } })?.error).toEqual({
      code: -32_000,
      message: "gone",
    });
  });

  it("tells a null id from an absent one", () => {
    expect(parseJsonRpcMessage({ id: null, method: "x" })).toHaveProperty("id", null);
    expect(parseJsonRpcMessage({ method: "x" })).not.toHaveProperty("id");
    expect(parseJsonRpcMessage({ id: { nested: true }, method: "x" })).not.toHaveProperty("id");
  });

  it("keeps params and result only where they are objects", () => {
    expect(parseJsonRpcMessage({ result: "instructions" })?.result).toBeUndefined();
    expect(parseJsonRpcMessage({ params: [1, 2] })?.params).toBeUndefined();
    expect(parseJsonRpcMessage({ result: { tools: [] } })?.result).toEqual({ tools: [] });
  });

  it("is null for anything that is not an object at all", () => {
    expect(parseJsonRpcMessage("2.0")).toBeNull();
    expect(parseJsonRpcMessage([])).toBeNull();
    expect(parseJsonRpcMessage(null)).toBeNull();
  });
});
