#!/usr/bin/env node
/**
 * Reject out-of-order migration numbering and edits to committed migrations.
 * Compares db/migrations/*.sql against db/migrations.manifest.json.
 */
import { createHash } from "node:crypto";
import { readdir, readFile, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { constants } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(root, "db", "migrations");
const manifestPath = join(root, "db", "migrations.manifest.json");

function fail(message) {
  console.error(`migrations-guard: ${message}`);
  process.exit(1);
}

const files = (await readdir(migrationsDir))
  .filter((f) => f.endsWith(".sql"))
  .sort();

if (files.length === 0) {
  fail("no migration files found in db/migrations/");
}

const numbers = [];
for (const file of files) {
  const match = file.match(/^(\d{4})_(.+)\.sql$/);
  if (!match) {
    fail(
      `invalid filename "${file}" — expected NNNN_description.sql (four digits)`,
    );
  }
  numbers.push(Number(match[1]));
}

// Strict forward-only sequence: must be unique and sorted ascending.
for (let i = 0; i < numbers.length; i++) {
  if (i > 0 && numbers[i] <= numbers[i - 1]) {
    fail(
      `out-of-order or duplicate numbering: ${files[i - 1]} then ${files[i]}`,
    );
  }
}

// Expected contiguous from 0001 for this project baseline.
if (numbers[0] !== 1) {
  fail(`first migration must be 0001_*, found ${files[0]}`);
}
for (let i = 0; i < numbers.length; i++) {
  if (numbers[i] !== i + 1) {
    fail(
      `gap in migration sequence at index ${i}: expected ${(i + 1).toString().padStart(4, "0")}, found ${files[i]}`,
    );
  }
}

let manifestExists = true;
try {
  await access(manifestPath, constants.R_OK);
} catch {
  manifestExists = false;
}

if (!manifestExists) {
  fail(
    "missing db/migrations.manifest.json — run: pnpm migrations:checksum",
  );
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const byFile = new Map(
  (manifest.migrations ?? []).map((m) => [m.file, m.sha256]),
);

// Historical files in the manifest must still match checksums.
for (const [file, expected] of byFile) {
  if (!files.includes(file)) {
    fail(`manifest lists ${file} but file is missing (historical migrations cannot be deleted)`);
  }
  const body = await readFile(join(migrationsDir, file));
  const actual = createHash("sha256").update(body).digest("hex");
  if (actual !== expected) {
    fail(
      `historical migration edited: ${file} checksum mismatch (expected ${expected}, got ${actual})`,
    );
  }
}

// New files not yet in manifest are allowed only at the end (higher numbers).
const newFiles = files.filter((f) => !byFile.has(f));
if (newFiles.length > 0) {
  const maxManifest = Math.max(
    0,
    ...[...byFile.keys()].map((f) => Number(f.slice(0, 4))),
  );
  for (const file of newFiles) {
    const n = Number(file.slice(0, 4));
    if (n <= maxManifest) {
      fail(
        `new migration ${file} must number after last manifest entry (${maxManifest.toString().padStart(4, "0")})`,
      );
    }
  }
  console.warn(
    `migrations-guard: ${newFiles.length} new migration(s) not yet in manifest — run pnpm migrations:checksum after review`,
  );
}

console.log(
  `migrations-guard: ok (${files.length} file(s), ${byFile.size} checksummed)`,
);
