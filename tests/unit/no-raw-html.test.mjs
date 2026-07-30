import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// AC #5 guard: creator-supplied text renders as escaped plain text on every
// surface. Framework defaults escape; the raw-HTML bypasses are the only
// hazard, so none may appear in src — on a public-signup platform Creators
// are untrusted input too. The walker covers the .astro sources in use today
// plus .tsx/.jsx/.svelte so a future framework island can't silently void
// the guard.
// (.mjs like provision-auth-secrets.test.mjs: node APIs without node types.)

const RAW_HTML_BYPASSES = [
  [".astro", "set:html"],
  [".tsx", "dangerouslySetInnerHTML"],
  [".jsx", "dangerouslySetInnerHTML"],
  [".svelte", "{@html}"],
  [".vue", "v-html"],
  // No .ts in src has a legitimate innerHTML use — text goes through
  // textContent, markup through the framework.
  [".ts", "innerHTML"],
];

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return walk(full);
    }
    return [full];
  });
}

describe("no rich-HTML path for user-supplied content", () => {
  it.each(RAW_HTML_BYPASSES.map(([extension, bypass]) => [extension, bypass]))(
    "uses %s nowhere in src (%s files)",
    (extension, bypass) => {
      const offenders = walk("src")
        .filter((file) => file.endsWith(extension))
        .filter((file) => readFileSync(file, "utf8").includes(bypass));
      expect(offenders).toEqual([]);
    },
  );
});
