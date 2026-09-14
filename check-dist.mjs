// Refuses a publish whose dist does not match the sources beside it.
import { readFileSync, statSync } from "node:fs";
const bin = new URL('dist/cli.js', import.meta.url);
const bundle = readFileSync(bin, 'utf8');
const prose = /^\s*(\/\/(?! src\/)|\*)\s+\w/m;
if (prose.test(bundle)) {
  console.error('dist/cli.js carries comments; rebuild it from the stripped sources.');
  process.exit(1);
}
if ((statSync(bin).mode & 0o111) === 0) {
  console.error('dist/cli.js is not executable; npx upgrades in place would fail with permission denied.');
  process.exit(1);
}
