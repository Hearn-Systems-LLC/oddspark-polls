import {
  applyD1Migrations,
  type D1Migration,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import worker, { runMediaCleanup } from "../../src/worker";

type MigrationTestEnv = Cloudflare.Env & {
  TEST_MIGRATIONS: D1Migration[];
};

const testEnv = env as MigrationTestEnv;

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  await testEnv.DB.prepare("DELETE FROM cleanup_outbox").run();
});

describe("scheduled Media cleanup Worker entry", () => {
  it("exports Astro fetch and a scheduled handler", () => {
    expect(worker.fetch).toBeTypeOf("function");
    expect(worker.scheduled).toBeTypeOf("function");
  });

  it("drains cleanup rows through the real D1 and R2 bindings", async () => {
    await testEnv.MEDIA.put("tmp/scheduled/orphan", "bytes");
    await testEnv.DB.prepare(
      "INSERT INTO cleanup_outbox (id, r2_key, enqueued_at_ms) VALUES ('scheduled-1', 'tmp/scheduled/orphan', 1)",
    ).run();

    const result = await runMediaCleanup(testEnv, () => 1_784_000_000_000);

    expect(result.drain).toEqual({ selected: 1, deleted: 1, failed: 0, hasMore: false });
    expect(await testEnv.MEDIA.head("tmp/scheduled/orphan")).toBeNull();
    expect(await testEnv.DB.prepare(
      "SELECT id FROM cleanup_outbox WHERE id = 'scheduled-1'",
    ).first()).toBeNull();
  });

  it("clears a row whose R2 object is already missing", async () => {
    await testEnv.DB.prepare(
      "INSERT INTO cleanup_outbox (id, r2_key, enqueued_at_ms) VALUES ('scheduled-2', 'tmp/scheduled/missing', 1)",
    ).run();

    const result = await runMediaCleanup(testEnv, () => 1_784_000_000_000);

    expect(result.drain).toEqual({ selected: 1, deleted: 1, failed: 0, hasMore: false });
    expect(await testEnv.DB.prepare(
      "SELECT id FROM cleanup_outbox WHERE id = 'scheduled-2'",
    ).first()).toBeNull();
  });
});
