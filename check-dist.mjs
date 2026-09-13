// Refuses a publish whose dist does not match the sources beside it.
import { readFileSync } from "node:fs";
const bundle = readFileSync(new URL('dist/cli.js', import.meta.url), 'utf8');
const prose = /^\s*(\/\/(?! src\/)|\*)\s+\w/m;
if (prose.test(bundle)) {
  console.error('dist/cli.js carries comments; rebuild it from the stripped sources.');
  process.exit(1);
}
