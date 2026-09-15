import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  apiOrigin,
  channelFollowedSignIn,
  channelOf,
  configPath,
  isAlpha,
  launchChannel,
  rejectedOverrides,
  siteOrigin,
  setChannel,
  signedInOn,
  writeConfig,
} from "../src/config.js";
import { bridgeArgs, claudeAddCommand, serverName, toolAllowlist } from "../src/connect.js";
import { ALPHA_API, ALPHA_SITE, DEFAULT_API, DEFAULT_SITE } from "../src/constants.js";
import { SERVER_VERSION } from "../src/version.js";

afterEach(() => {
  setChannel("default");
  delete process.env.ATOMICREPS_API;
  delete process.env.ATOMICREPS_SITE;
  delete process.env.ATOMICREPS_UNSAFE_ORIGIN;
});

describe("switching channel", () => {
  it("moves both origins together", () => {
    expect(apiOrigin()).toBe(DEFAULT_API);
    expect(siteOrigin()).toBe(DEFAULT_SITE);
    setChannel("alpha");
    expect(apiOrigin()).toBe(ALPHA_API);
    expect(siteOrigin()).toBe(ALPHA_SITE);
    expect(isAlpha()).toBe(true);
    expect(channelOf()).toBe("alpha");
  });

  it("gives alpha its own token file, under the same root", () => {
    const live = configPath();
    setChannel("alpha");
    const alpha = configPath();
    expect(alpha).not.toBe(live);
    expect(dirname(alpha)).toBe(join(dirname(live), "alpha"));
  });

  it("an explicit origin still wins over the channel", () => {
    process.env.ATOMICREPS_API = "http://127.0.0.1:47035";
    setChannel("alpha");
    expect(apiOrigin()).toBe("http://127.0.0.1:47035");
  });

  it("the site origin no longer trails the API origin", () => {
    process.env.ATOMICREPS_API = "https://api.staging.atomicreps.com";
    expect(siteOrigin()).toBe(DEFAULT_SITE);
  });
});

describe("which origins an override may name", () => {
  it("ignores a stranger and says which value it ignored", () => {
    process.env.ATOMICREPS_API = "https://evil.example";
    expect(apiOrigin()).toBe(DEFAULT_API);
    expect(rejectedOverrides()).toEqual([
      { name: "ATOMICREPS_API", value: "https://evil.example" },
    ]);
  });

  it("honours the stranger once the unsafe flag is set, and reports nothing", () => {
    process.env.ATOMICREPS_API = "https://evil.example";
    process.env.ATOMICREPS_UNSAFE_ORIGIN = "1";
    expect(apiOrigin()).toBe("https://evil.example");
    expect(rejectedOverrides()).toEqual([]);
  });

  it("takes our own servers and a loopback port without the flag", () => {
    for (const origin of [ALPHA_API, "http://localhost:47035", "http://[::1]:8080/"]) {
      process.env.ATOMICREPS_API = origin;
      expect(apiOrigin(), origin).toBe(origin.replace(/\/+$/, ""));
      expect(rejectedOverrides(), origin).toEqual([]);
    }
  });
});

describe("what an editor gets registered", () => {
  it("registers the two servers under different names", () => {
    expect(serverName()).toBe("atomicreps");
    setChannel("alpha");
    expect(serverName()).toBe("atomicreps-alpha");
  });

  it("carries the flag into the launch args so the bridge stays on staging", () => {
    expect(bridgeArgs()).not.toContain("--alpha");
    setChannel("alpha");
    expect(bridgeArgs()).toContain("--alpha");
    expect(claudeAddCommand()).toContain("atomicreps-alpha");
    expect(claudeAddCommand()).toContain("--alpha");
  });

  it("stays unpinned by default, so npx always resolves the latest", () => {
    expect(bridgeArgs()).toContain("atomicreps");
    expect(bridgeArgs().some((arg) => arg.startsWith("atomicreps@"))).toBe(false);
  });

  it("pin writes the exact version this CLI is running, alpha flag intact", () => {
    expect(bridgeArgs(true)).toContain(`atomicreps@${SERVER_VERSION}`);
    expect(claudeAddCommand(true)).toContain(`atomicreps@${SERVER_VERSION}`);
    setChannel("alpha");
    const pinned = bridgeArgs(true);
    expect(pinned).toContain(`atomicreps@${SERVER_VERSION}`);
    expect(pinned).toContain("--alpha");
  });

  it("allowlists the alpha tool names, which are not the live ones", () => {
    const live = toolAllowlist();
    setChannel("alpha");
    const alpha = toolAllowlist();
    expect(live).toContain("mcp__atomicreps__rep");
    expect(alpha).toContain("mcp__atomicreps-alpha__rep");
    expect(alpha).not.toEqual(live);
    expect(alpha).toHaveLength(4);
  });
});

describe("which channel an unflagged launch runs on", () => {
  const only = (channel: "default" | "alpha" | null) => (target: "default" | "alpha") =>
    target === channel;

  it("follows the alpha sign-in for the commands nobody types a flag for", () => {
    for (const command of ["hook", "mcp", "statusline", "doctor"]) {
      expect(
        launchChannel({ command, flagged: false, env: undefined, signedIn: only("alpha") }),
        command,
      ).toEqual({ channel: "alpha", followed: true });
    }
  });

  it("keeps a typed command on production, whatever is signed in", () => {
    for (const command of ["login", "connect", "logout", "setup", undefined]) {
      expect(
        launchChannel({ command, flagged: false, env: undefined, signedIn: only("alpha") }),
        String(command),
      ).toEqual({ channel: "default", followed: false });
    }
  });

  it("lets the live sign-in win when both are present, and stays put with neither", () => {
    const both = () => true;
    expect(
      launchChannel({ command: "hook", flagged: false, env: undefined, signedIn: both }),
    ).toEqual({
      channel: "default",
      followed: false,
    });
    expect(
      launchChannel({ command: "hook", flagged: false, env: undefined, signedIn: only(null) }),
    ).toEqual({ channel: "default", followed: false });
  });

  it("a flag or the environment still names the channel outright", () => {
    expect(
      launchChannel({ command: "login", flagged: true, env: undefined, signedIn: only(null) }),
    ).toEqual({ channel: "alpha", followed: false });
    expect(
      launchChannel({ command: "login", flagged: false, env: "alpha", signedIn: only(null) }),
    ).toEqual({ channel: "alpha", followed: false });
  });

  it("reads each channel's own token file without switching to it", () => {
    const home = mkdtempSync(join(tmpdir(), "atomicreps-channel-"));
    const saved = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = home;
    try {
      expect(signedInOn("default")).toBe(false);
      expect(signedInOn("alpha")).toBe(false);
      setChannel("alpha");
      writeConfig({ token: "arep_test" });
      setChannel("default");
      expect(signedInOn("alpha")).toBe(true);
      expect(signedInOn("default")).toBe(false);
      expect(channelOf()).toBe("default");
      setChannel("alpha", { followed: true });
      expect(channelFollowedSignIn()).toBe(true);
      setChannel("default");
      expect(channelFollowedSignIn()).toBe(false);
    } finally {
      if (saved === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = saved;
      rmSync(home, { recursive: true, force: true });
    }
  });
});
