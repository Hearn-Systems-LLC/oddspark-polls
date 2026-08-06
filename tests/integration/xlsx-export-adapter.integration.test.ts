import {
  applyD1Migrations,
  type D1Migration,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createBoundedMultipleChoiceExportFactDriver,
  createMultipleChoiceExportFactDriver,
  MULTIPLE_CHOICE_BOUNDED_EXPORT_PROJECTION_QUERY,
} from "../../src/adapters/d1/export/multiple-choice";
import { createOwnerExportPersistence } from "../../src/adapters/d1/index";
import { serializeXlsxExport } from "../../src/adapters/xlsx/index";
import { multipleChoiceStrategy } from "../../src/modules/polls/types/multiple-choice";
import {
  bindBoundedExportDriver,
  bindExportDriver,
  queryBoundedOwnerExport,
  queryOwnerExport,
  XLSX_ACCEPTED_VOTE_LIMIT,
} from "../../src/modules/results/export";
import type { PollId, UserId } from "../../src/shared/domain/index";

type TestEnv = Cloudflare.Env & { TEST_MIGRATIONS: D1Migration[] };
const testEnv = env as TestEnv;
const POLL = "xlsx-bounded-poll" as PollId;
const OWNER = "xlsx-bounded-owner" as UserId;

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  await testEnv.DB.prepare("DELETE FROM vote_comment").run();
  await testEnv.DB.prepare("DELETE FROM voter_claim").run();
  await testEnv.DB.prepare("DELETE FROM vote_selection").run();
  await testEnv.DB.prepare("DELETE FROM vote").run();
  await testEnv.DB.prepare("DELETE FROM poll_option").run();
  await testEnv.DB.prepare("DELETE FROM poll_reference").run();
  await testEnv.DB.prepare("DELETE FROM poll").run();
  await testEnv.DB.prepare(
    "INSERT OR IGNORE INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?1, 'XLSX Creator', 'xlsx-bounded@example.test', 1, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z')",
  )
    .bind(OWNER)
    .run();
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      "INSERT INTO poll (id, owner_user_id, poll_type, question, result_visibility, comments_enabled, multi_select_enabled, min_selections, max_selections, representation_version, created_at_ms, updated_at_ms) VALUES (?1, ?2, 'multiple_choice', 'Bounded export?', 'creator_only', 1, 1, 1, 30, 1, 0, 0)",
    ).bind(POLL, OWNER),
    testEnv.DB.prepare(
      "INSERT INTO poll_reference (reference, poll_id, kind, is_canonical, created_at_ms) VALUES ('xlsx-bounded', ?1, 'custom', 1, 0)",
    ).bind(POLL),
  ]);
});

async function seedOptions(count = 2, labelLength = 5): Promise<void> {
  await testEnv.DB.prepare(
    "UPDATE poll SET max_selections = ?2 WHERE id = ?1",
  )
    .bind(POLL, count)
    .run();
  await testEnv.DB.prepare(
    `WITH RECURSIVE indexes(value) AS (
       SELECT 1 UNION ALL SELECT value + 1 FROM indexes WHERE value < ?2
     )
     INSERT INTO poll_option (id, poll_id, label, position, created_at_ms)
     SELECT printf('xlsx-option-%02d', value), ?1,
            printf('%02d', value) || printf('%.*c', ?3 - 2, char(64 + ((value - 1) % 26) + 1)),
            value - 1, 0
     FROM indexes`,
  )
    .bind(POLL, count, labelLength)
    .run();
}

async function seedVotes(
  count: number,
  selectionsPerVote = 1,
  withMaxText = false,
): Promise<void> {
  if (count === 0) return;
  await testEnv.DB.prepare(
    `WITH RECURSIVE indexes(value) AS (
       SELECT 1 UNION ALL SELECT value + 1 FROM indexes WHERE value < ?2
     )
     INSERT INTO vote (id, poll_id, submission_id, payload_hash, created_at_ms)
     SELECT printf('xlsx-vote-%04d', value), ?1,
            printf('xlsx-submission-%04d', value),
            printf('xlsx-private-hash-%04d', value), 1800000000000 + value
     FROM indexes`,
  )
    .bind(POLL, count)
    .run();
  await testEnv.DB.prepare(
    `INSERT INTO vote_selection (vote_id, poll_option_id)
     SELECT v.id, o.id
     FROM vote v
     JOIN poll_option o ON o.poll_id = v.poll_id
     WHERE v.poll_id = ?1 AND o.position < ?2`,
  )
    .bind(POLL, selectionsPerVote)
    .run();
  if (withMaxText) {
    await testEnv.DB.prepare(
      `INSERT INTO vote_comment (id, vote_id, body, display_name, created_at_ms)
       SELECT 'comment-' || id, id,
              substr(id, -4) || printf('%.*c', 496, 'C'),
              substr(id, -4) || printf('%.*c', 76, 'N'), created_at_ms
       FROM vote WHERE poll_id = ?1`,
    )
      .bind(POLL)
      .run();
  }
}

function boundedDriver(db: D1Database = testEnv.DB) {
  return createBoundedMultipleChoiceExportFactDriver(db);
}

describe("bounded owner XLSX export D1 adapter", () => {
  it("returns a ready zero-Vote projection from exactly one fact statement", async () => {
    await seedOptions();
    const prepared: string[] = [];
    const countingDb = {
      prepare(sql: string) {
        prepared.push(sql);
        return testEnv.DB.prepare(sql);
      },
    } as D1Database;
    await expect(boundedDriver(countingDb).projectFacts(POLL)).resolves.toMatchObject({
      status: "ready",
      facts: {
        sharedVotes: [],
        typeFacts: { voterCount: 0, selectionCount: 0 },
      },
    });
    expect(prepared).toEqual([MULTIPLE_CHOICE_BOUNDED_EXPORT_PROJECTION_QUERY]);
  });

  it("keeps the 1,000-Vote bounded dataset logically identical to CSV", async () => {
    await seedOptions(2);
    await seedVotes(XLSX_ACCEPTED_VOTE_LIMIT, 2);
    const ports = createOwnerExportPersistence(testEnv.DB);
    const ready = await queryBoundedOwnerExport(
      ports,
      POLL,
      { userId: OWNER },
      [bindBoundedExportDriver(boundedDriver(), multipleChoiceStrategy)],
    );
    const csv = await queryOwnerExport(ports, POLL, { userId: OWNER }, [
      bindExportDriver(
        createMultipleChoiceExportFactDriver(testEnv.DB),
        multipleChoiceStrategy,
      ),
    ]);
    expect(ready).toEqual({ status: "ready", export: csv });
    if (ready?.status !== "ready") throw new Error("Expected ready export");
    expect(ready.export.dataset.votes.rows).toHaveLength(1_000);
    expect(ready.export.dataset.summary.rows).toEqual([
      ["VOTERS", 1_000],
      ["SELECTIONS", 2_000],
    ]);
  });

  it.each([1_001, 1_002])(
    "returns only a non-private capacity discriminator at %i Votes",
    async (voteCount) => {
      await seedOptions();
      await seedVotes(voteCount);
      const raw = await testEnv.DB
        .prepare(MULTIPLE_CHOICE_BOUNDED_EXPORT_PROJECTION_QUERY)
        .bind(POLL)
        .all<Record<string, unknown>>();
      expect(raw.results).toHaveLength(1);
      expect(raw.results[0]).toMatchObject({
        row_kind: "capacity",
        accepted_vote_count: 1_001,
        oversized: 1,
      });
      for (const key of [
        "option_id",
        "option_label",
        "vote_id",
        "vote_created_at_ms",
        "comment_body",
        "comment_display_name",
        "selected_option_id",
      ]) {
        expect(raw.results[0]?.[key]).toBeNull();
      }
      await expect(boundedDriver().projectFacts(POLL)).resolves.toEqual({
        status: "oversize",
      });
    },
  );

  it("materializes the maximum-shaped 1,000-Vote snapshot inside workerd", async () => {
    await seedOptions(30, 100);
    await seedVotes(1_000, 30, true);
    const result = await queryBoundedOwnerExport(
      createOwnerExportPersistence(testEnv.DB),
      POLL,
      { userId: OWNER },
      [bindBoundedExportDriver(boundedDriver(), multipleChoiceStrategy)],
    );
    if (result?.status !== "ready") throw new Error("Expected ready export");
    expect(result.export.dataset.votes.rows).toHaveLength(1_000);
    expect(result.export.dataset.votes.columns).toHaveLength(33);
    expect(result.export.dataset.summary.rows).toEqual([
      ["VOTERS", 1_000],
      ["SELECTIONS", 30_000],
    ]);
    expect(result.export.dataset.votes.rows[0]?.[1]).toBe(
      `0001${"N".repeat(76)}`,
    );
    expect(result.export.dataset.votes.rows[0]?.[2]).toBe(
      `0001${"C".repeat(496)}`,
    );
    expect(new Set(result.export.dataset.votes.rows.map((row) => row[1])).size).toBe(
      1_000,
    );
    expect(new Set(result.export.dataset.votes.rows.map((row) => row[2])).size).toBe(
      1_000,
    );
    const bytes = await serializeXlsxExport(result.export.dataset);
    const xlsx = await import("xlsx");
    const workbook = xlsx.read(bytes, { type: "array", cellFormula: true });
    expect(workbook.SheetNames).toEqual(["VOTES", "TALLY", "SUMMARY"]);
    expect(workbook.Sheets.VOTES?.AG1001).toMatchObject({
      t: "s",
      v: result.export.dataset.votes.rows[999]?.[32],
    });
    expect(workbook.Sheets.SUMMARY?.B3).toMatchObject({ t: "n", v: 30_000 });
  });
});
