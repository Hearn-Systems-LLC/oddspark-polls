import {
  applyD1Migrations,
  type D1Migration,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

type MigrationTestEnv = Cloudflare.Env & {
  TEST_MIGRATIONS: D1Migration[];
};

const testEnv = env as MigrationTestEnv;

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

async function insertUser(id: string): Promise<void> {
  await testEnv.DB.prepare(
    "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?1, ?2, ?3, 1, ?4, ?4)",
  )
    .bind(id, "Test Creator", `${id}@example.test`, new Date(0).toISOString())
    .run();
}

describe("polls D1 schema (migration 0004)", () => {
  it("creates the poll, poll_option, and poll_reference tables", async () => {
    const rows = await testEnv.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    ).all<{ name: string }>();

    expect(rows.results.map(({ name }) => name)).toEqual(
      expect.arrayContaining(["poll", "poll_option", "poll_reference"]),
    );
  });

  it("shapes poll with discrete columns, defaults, and Unix-ms timestamps", async () => {
    const columns = await testEnv.DB.prepare(
      "PRAGMA table_info('poll')",
    ).all<{ name: string; type: string; notnull: number; dflt_value: string | null }>();

    expect(columns.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "id", type: "TEXT", notnull: 1 }),
        expect.objectContaining({
          name: "owner_user_id",
          type: "TEXT",
          notnull: 1,
        }),
        expect.objectContaining({ name: "poll_type", type: "TEXT", notnull: 1 }),
        expect.objectContaining({ name: "question", type: "TEXT", notnull: 1 }),
        expect.objectContaining({ name: "description", type: "TEXT", notnull: 0 }),
        expect.objectContaining({
          name: "result_visibility",
          type: "TEXT",
          notnull: 1,
        }),
        expect.objectContaining({
          name: "discovery_state",
          type: "TEXT",
          notnull: 1,
          dflt_value: "'unlisted'",
        }),
        expect.objectContaining({
          name: "session_checks_enabled",
          type: "INTEGER",
          notnull: 1,
          dflt_value: "1",
        }),
        expect.objectContaining({
          name: "multi_select_enabled",
          type: "INTEGER",
          notnull: 1,
          dflt_value: "0",
        }),
        expect.objectContaining({
          name: "min_selections",
          type: "INTEGER",
          notnull: 0,
          dflt_value: null,
        }),
        expect.objectContaining({
          name: "max_selections",
          type: "INTEGER",
          notnull: 0,
          dflt_value: null,
        }),
        expect.objectContaining({ name: "deadline_ms", type: "INTEGER", notnull: 0 }),
        expect.objectContaining({ name: "closed_at_ms", type: "INTEGER", notnull: 0 }),
        expect.objectContaining({
          name: "representation_version",
          type: "INTEGER",
          notnull: 1,
          dflt_value: "1",
        }),
        expect.objectContaining({ name: "created_at_ms", type: "INTEGER", notnull: 1 }),
        expect.objectContaining({ name: "updated_at_ms", type: "INTEGER", notnull: 1 }),
      ]),
    );
  });

  it("cascades poll deletion to options and references", async () => {
    await insertUser("user-cascade");
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        "INSERT INTO poll (id, owner_user_id, poll_type, question, result_visibility, created_at_ms, updated_at_ms) VALUES ('p1', 'user-cascade', 'multiple_choice', 'Q?', 'live', 0, 0)",
      ),
      testEnv.DB.prepare(
        "INSERT INTO poll_option (id, poll_id, label, position, created_at_ms) VALUES ('o1', 'p1', 'A', 0, 0)",
      ),
      testEnv.DB.prepare(
        "INSERT INTO poll_reference (reference, poll_id, kind, created_at_ms) VALUES ('abc123', 'p1', 'generated', 0)",
      ),
    ]);

    await testEnv.DB.prepare("DELETE FROM poll WHERE id = 'p1'").run();

    const options = await testEnv.DB.prepare(
      "SELECT COUNT(*) AS n FROM poll_option",
    ).first<{ n: number }>();
    const references = await testEnv.DB.prepare(
      "SELECT COUNT(*) AS n FROM poll_reference",
    ).first<{ n: number }>();
    expect(options?.n).toBe(0);
    expect(references?.n).toBe(0);
  });

  it("rejects a poll without an existing owner", async () => {
    await expect(
      testEnv.DB.prepare(
        "INSERT INTO poll (id, owner_user_id, poll_type, question, result_visibility, created_at_ms, updated_at_ms) VALUES ('p2', 'ghost', 'multiple_choice', 'Q?', 'live', 0, 0)",
      ).run(),
    ).rejects.toThrow(/FOREIGN KEY/i);
  });

  it("enforces unique option positions per poll and unique references", async () => {
    await insertUser("user-unique");
    await testEnv.DB.prepare(
      "INSERT INTO poll (id, owner_user_id, poll_type, question, result_visibility, created_at_ms, updated_at_ms) VALUES ('p3', 'user-unique', 'multiple_choice', 'Q?', 'live', 0, 0)",
    ).run();
    await testEnv.DB.prepare(
      "INSERT INTO poll_option (id, poll_id, label, position, created_at_ms) VALUES ('o2', 'p3', 'A', 0, 0)",
    ).run();

    await expect(
      testEnv.DB.prepare(
        "INSERT INTO poll_option (id, poll_id, label, position, created_at_ms) VALUES ('o3', 'p3', 'B', 0, 0)",
      ).run(),
    ).rejects.toThrow(/UNIQUE/i);

    await testEnv.DB.prepare(
      "INSERT INTO poll_reference (reference, poll_id, kind, created_at_ms) VALUES ('ref-a', 'p3', 'generated', 0)",
    ).run();
    await expect(
      testEnv.DB.prepare(
        "INSERT INTO poll_reference (reference, poll_id, kind, created_at_ms) VALUES ('ref-a', 'p3', 'generated', 0)",
      ).run(),
    ).rejects.toThrow(/UNIQUE|PRIMARY/i);
  });

  it("enforces exactly one canonical reference per poll (migration 0005)", async () => {
    await insertUser("user-canonical");
    await testEnv.DB.prepare(
      "INSERT INTO poll (id, owner_user_id, poll_type, question, result_visibility, created_at_ms, updated_at_ms) VALUES ('p4', 'user-canonical', 'multiple_choice', 'Q?', 'live', 0, 0)",
    ).run();
    await testEnv.DB.prepare(
      "INSERT INTO poll_reference (reference, poll_id, kind, is_canonical, created_at_ms) VALUES ('ref-canonical', 'p4', 'generated', 1, 0)",
    ).run();

    // A second canonical row for the same poll violates the partial index.
    await expect(
      testEnv.DB.prepare(
        "INSERT INTO poll_reference (reference, poll_id, kind, is_canonical, created_at_ms) VALUES ('ref-canonical-2', 'p4', 'custom', 1, 0)",
      ).run(),
    ).rejects.toThrow(/UNIQUE/i);

    // Non-canonical rows for the same poll are unaffected.
    await testEnv.DB.prepare(
      "INSERT INTO poll_reference (reference, poll_id, kind, is_canonical, created_at_ms) VALUES ('ref-alias', 'p4', 'custom', 0, 0)",
    ).run();
    const count = await testEnv.DB.prepare(
      "SELECT COUNT(*) AS n FROM poll_reference WHERE poll_id = 'p4'",
    ).first<{ n: number }>();
    expect(count?.n).toBe(2);
  });
});
