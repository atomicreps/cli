import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  apiOrigin,
  channelOf,
  configPath,
  isAlpha,
  siteOrigin,
  setChannel,
} from "../src/config.js";
import { bridgeArgs, claudeAddCommand, serverName, toolAllowlist } from "../src/connect.js";
import { ALPHA_API, ALPHA_SITE, DEFAULT_API, DEFAULT_SITE } from "../src/constants.js";

afterEach(() => {
  setChannel("default");
  delete process.env.ATOMICREPS_API;
  delete process.env.ATOMICREPS_SITE;
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

describe("what an editor gets registered", () => {
  it("registers the two doors under different names", () => {
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
