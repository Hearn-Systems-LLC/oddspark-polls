#!/usr/bin/env node
/**
 * Reject out-of-order migration numbering and edits to committed migrations.
 * Compares db/migrations/*.sql against db/migrations.manifest.json.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
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

let dirEntries;
try {
  dirEntries = await readdir(migrationsDir);
} catch {
  fail("cannot read db/migrations/ — directory missing or unreadable");
}

// Match .sql case-insensitively so uppercase .SQL files are validated
// (and rejected by the filename check) instead of passing invisibly.
const files = dirEntries
  .filter((f) => /\.sql$/i.test(f))
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

let manifest;
try {
  manifest = JSON.parse(await readFile(manifestPath, "utf8"));
} catch {
  fail("db/migrations.manifest.json is not valid JSON — regenerate: pnpm migrations:checksum");
}

const migrations = manifest.migrations ?? [];
if (!Array.isArray(migrations)) {
  fail("manifest 'migrations' must be an array — regenerate: pnpm migrations:checksum");
}
const seenFiles = new Set();
for (const m of migrations) {
  if (
    typeof m?.file !== "string" ||
    !/^\d{4}_.+\.sql$/.test(m.file) ||
    typeof m?.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(m.sha256)
  ) {
    fail(
      `malformed manifest entry (${JSON.stringify(m)}) — regenerate: pnpm migrations:checksum`,
    );
  }
  if (seenFiles.has(m.file)) {
    fail(`duplicate manifest entry for ${m.file} — regenerate: pnpm migrations:checksum`);
  }
  seenFiles.add(m.file);
}

const byFile = new Map(migrations.map((m) => [m.file, m.sha256]));

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

// New files not yet in manifest are allowed only at the end (higher numbers),
// and must be checksummed in the same commit — an unmanifested migration
// would otherwise apply at the deploy gate without integrity protection.
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
  fail(
    `${newFiles.length} new migration(s) not in manifest (${newFiles.join(", ")}) — run: pnpm migrations:checksum and commit the manifest`,
  );
}

// Historical immutability against the base branch (CI sets MIGRATIONS_BASE).
// The manifest check above anchors the working tree to itself; this anchors
// it to history, so edit + re-checksum in one commit is still rejected.
const migrationsBase = process.env.MIGRATIONS_BASE;
if (migrationsBase) {
  let diff;
  try {
    diff = execFileSync(
      "git",
      // --no-renames: a pure rename must surface as D+A so the D is caught
      // (D1 tracks applied migrations by filename; a rename is a re-apply).
      ["diff", "--name-status", "--no-renames", `${migrationsBase}...HEAD`, "--", "db/migrations"],
      { cwd: root, encoding: "utf8" },
    );
  } catch {
    fail(`cannot diff migrations against ${migrationsBase} (fetch the base ref, e.g. fetch-depth: 0)`);
  }
  for (const line of diff.split("\n").filter(Boolean)) {
    const [status, file] = line.split("\t");
    if (!status?.startsWith("A")) {
      fail(
        `historical migration changed vs ${migrationsBase} (${status}): ${file} — migrations are forward-only`,
      );
    }
  }
}

console.log(
  `migrations-guard: ok (${files.length} file(s), ${byFile.size} checksummed)`,
);
