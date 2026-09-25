import { describe, expect, it } from "vitest";

import { nodeGuard } from "../src/node-guard.js";

describe("nodeGuard", () => {
  it("lets Node 24 and newer through", () => {
    expect(nodeGuard("24.0.0", ["mcp"])).toBeNull();
    expect(nodeGuard("26.9.0", ["hook"])).toBeNull();
  });

  it("fails every ordinary command on an older Node with the version message", () => {
    const verdict = nodeGuard("22.11.0", ["doctor"]);
    expect(verdict?.code).toBe(1);
    expect(verdict?.stderr).toContain("you have v22.11.0");
    expect(verdict?.stdout).toBeUndefined();
    expect(nodeGuard("20.20.2", ["mcp"])?.code).toBe(1);
    expect(nodeGuard("22.11.0", [])?.code).toBe(1);
  });

  it("never breaks the editor: hook exits 0 with no output", () => {
    expect(nodeGuard("22.11.0", ["hook"])).toEqual({ code: 0 });
    expect(nodeGuard("22.11.0", ["--alpha", "hook"])).toEqual({ code: 0 });
  });

  it("puts the message in the status bar", () => {
    const verdict = nodeGuard("22.11.0", ["statusline"]);
    expect(verdict?.code).toBe(0);
    expect(verdict?.stdout).toContain("Node 24+");
  });
});
