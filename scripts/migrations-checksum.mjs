#!/usr/bin/env node
/**
 * Generate or refresh db/migrations.manifest.json checksums.
 * Usage: node scripts/migrations-checksum.mjs
 */
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(root, "db", "migrations");
const manifestPath = join(root, "db", "migrations.manifest.json");

const files = (await readdir(migrationsDir))
  .filter((f) => /^\d{4}_.+\.sql$/.test(f))
  .sort();

const entries = [];
for (const file of files) {
  const body = await readFile(join(migrationsDir, file));
  const sha256 = createHash("sha256").update(body).digest("hex");
  entries.push({ file, sha256 });
}

const manifest = {
  version: 1,
  generatedAt: new Date().toISOString(),
  migrations: entries,
};

await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${manifestPath} (${entries.length} migration(s))`);
