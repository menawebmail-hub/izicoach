// Test-only (never imported by the app): loads named TOP-LEVEL pure declarations of App.jsx so
// regression tests exercise the real Agenda/Cobros functions instead of copies. App.jsx itself
// cannot be imported in node (JSX, Supabase client). Each declaration is sliced from its line to
// the next top-level declaration; App's own imports from ./schedule/ are re-pointed to their
// absolute paths. Call it AFTER mocking Date when a test needs a fixed "today" (TODAY_DATE and
// friends are computed when the generated module is evaluated).
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SRC = new URL("../", import.meta.url);

export async function loadAppFunctions(names) {
  const src = readFileSync(new URL("App.jsx", SRC), "utf8");
  const parts = [];
  for (const m of src.matchAll(/^import \{([^}]+)\} from "\.\/(schedule\/[^"]+)";$/gm)) {
    parts.push(`import {${m[1]}} from ${JSON.stringify(new URL(m[2], SRC).href)};`);
  }
  for (const name of names) {
    const start = new RegExp(`\\n(const ${name}\\s*=|function ${name}\\s*\\()`).exec(src);
    if (!start) throw new Error(`App.jsx has no top-level declaration named ${name}`);
    const from = start.index + 1;
    const next = /\n(const |function |let |var |export )/.exec(src.slice(from + 1));
    parts.push(src.slice(from, next ? from + 1 + next.index : src.length));
  }
  const dir = mkdtempSync(join(tmpdir(), "izi-app-functions-"));
  const file = join(dir, "app-functions.mjs");
  writeFileSync(file, parts.join("\n") + `\nexport { ${names.join(", ")} };\n`);
  return import(pathToFileURL(file).href);
}
