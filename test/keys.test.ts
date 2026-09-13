import { describe, expect, it } from "vitest";

import { ESC } from "../src/constants.js";
import { decodeKey } from "../src/keys.js";

describe("arrows", () => {
  it("reads normal cursor mode", () => {
    expect(decodeKey(`${ESC}[A`)).toEqual({ kind: "up" });
    expect(decodeKey(`${ESC}[B`)).toEqual({ kind: "down" });
    expect(decodeKey(`${ESC}[C`)).toEqual({ kind: "right" });
    expect(decodeKey(`${ESC}[D`)).toEqual({ kind: "left" });
  });

  it("reads application cursor mode, which anything that has run vim leaves behind", () => {
    expect(decodeKey(`${ESC}OA`)).toEqual({ kind: "up" });
    expect(decodeKey(`${ESC}OD`)).toEqual({ kind: "left" });
  });
});

describe("leaving", () => {
  it("Esc alone is not an arrow", () => {
    expect(decodeKey(ESC)).toEqual({ kind: "escape" });
  });

  it("Ctrl-C is a key here, because raw mode has taken the signal away", () => {
    expect(decodeKey("")).toEqual({ kind: "cancel" });
  });
});

describe("typing", () => {
  it("a printable character filters", () => {
    expect(decodeKey("r")).toEqual({ kind: "char", value: "r" });
  });

  it("a paste is not a keypress and toggles nothing", () => {
    expect(decodeKey("react postgres redis")).toEqual({ kind: "other" });
  });

  it("space and enter keep their own names rather than arriving as characters", () => {
    expect(decodeKey(" ")).toEqual({ kind: "space" });
    expect(decodeKey("\r")).toEqual({ kind: "enter" });
  });
});
