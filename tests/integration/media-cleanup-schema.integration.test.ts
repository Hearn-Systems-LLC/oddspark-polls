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

describe("cleanup_outbox schema (migration 0015)", () => {
  it("stores self-contained cleanup keys without a poll foreign key", async () => {
    const columns = await testEnv.DB.prepare(
      "PRAGMA table_info('cleanup_outbox')",
    ).all<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }>();

    expect(columns.results).toEqual([
      expect.objectContaining({ name: "id", type: "TEXT", notnull: 1, pk: 1 }),
      expect.objectContaining({ name: "r2_key", type: "TEXT", notnull: 1 }),
      expect.objectContaining({ name: "enqueued_at_ms", type: "INTEGER", notnull: 1 }),
      expect.objectContaining({
        name: "attempts",
        type: "INTEGER",
        notnull: 1,
        dflt_value: "0",
      }),
    ]);

    const foreignKeys = await testEnv.DB.prepare(
      "PRAGMA foreign_key_list('cleanup_outbox')",
    ).all();
    expect(foreignKeys.results).toEqual([]);
  });

  it("indexes cleanup rows by enqueue time", async () => {
    const indexes = await testEnv.DB.prepare(
      "PRAGMA index_list('cleanup_outbox')",
    ).all<{ name: string }>();

    expect(indexes.results.map(({ name }) => name)).toContain(
      "cleanup_outbox_enqueued_at_ms_idx",
    );
  });
});
