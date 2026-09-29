const IDENTIFIER = /[A-Za-z_][A-Za-z0-9_]*/g;
const CAMEL_BOUNDARY = /([a-z0-9])([A-Z])|([A-Z]+)([A-Z][a-z])/g;

function keep(token: string): boolean {
  return token.length >= 2 && !/^[0-9_]+$/.test(token);
}

export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const [raw] of text.matchAll(IDENTIFIER)) {
    const whole = raw.toLowerCase();
    if (keep(whole)) out.push(whole);
    const parts = raw
      .replace(CAMEL_BOUNDARY, "$1$3 $2$4")
      .split(/[\s_]+/)
      .map((part) => part.toLowerCase());
    if (parts.length < 2) continue;
    for (const part of parts) if (keep(part) && part !== whole) out.push(part);
  }
  return out;
}
