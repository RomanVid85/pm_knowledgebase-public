// Small helper to read fixture files by name. Tests should import this
// rather than hardcoding paths so the fixtures directory can move later
// without a search-and-replace.

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// `__dirname` isn't available in ESM tsx-runtime contexts; derive it from
// import.meta.url so this works in both CJS and ESM resolution.
const FIXTURES_DIR = dirname(fileURLToPath(import.meta.url));

/** Read a fixture file as a UTF-8 string. */
export function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), "utf-8");
}

/** Read a fixture file as a Buffer (for binary formats like .docx). */
export function loadFixtureBuffer(name: string): Buffer {
  return readFileSync(join(FIXTURES_DIR, name));
}
