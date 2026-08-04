import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  DISCOVERY_ACTIVE_DEADLINE_QUERY,
  DISCOVERY_NO_DEADLINE_QUERY,
  createDiscoveryPersistence,
} from "../../src/adapters/d1/index";
import type { DiscoveryOrderKey } from "../../src/modules/discovery/index";
import type { PollId, PollType } from "../../src/shared/domain/index";

type MigrationTestEnv = Cloudflare.Env & { TEST_MIGRATIONS: D1Migration[] };

const testEnv = env as MigrationTestEnv;
const NOW = 1_800_000_000_000;
const OWNER = "discovery-owner";

function pollId(index: number): PollId {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}` as PollId;
}

type SeedPoll = {
  index: number;
  createdAtMs?: number;
  discoveryState?: "unlisted" | "listed" | "delisted";
  closedAtMs?: number | null;
  deadlineMs?: number | null;
  question?: string;
  pollType?: PollType;
  resultVisibility?: "live" | "after_close" | "creator_only";
  reference?: string;
};

async function seedPoll(input: SeedPoll): Promise<PollId> {
  const id = pollId(input.index);
  const createdAtMs = input.createdAtMs ?? NOW + input.index;
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT INTO poll (
         id, owner_user_id, poll_type, question, description,
         result_visibility, discovery_state, session_checks_enabled,
         ip_checks_enabled, voter_codes_enabled, captcha_enabled,
         vpn_blocking_enabled, multi_select_enabled, min_selections,
         max_selections, deadline_ms, closed_at_ms, representation_version,
         created_at_ms, updated_at_ms
       ) VALUES (
         ?1, ?2, ?3, ?4, NULL, ?5, ?6, 1, 0, 0, 0, 0, 0, NULL,
         NULL, ?7, ?8, 1, ?9, ?9
       )`,
    ).bind(
      id,
      OWNER,
      input.pollType ?? "multiple_choice",
      input.question ?? `Question ${input.index}?`,
      input.resultVisibility ?? "live",
      input.discoveryState ?? "listed",
      input.deadlineMs ?? null,
      input.closedAtMs ?? null,
      createdAtMs,
    ),
    testEnv.DB.prepare(
      "INSERT INTO poll_reference (reference, poll_id, kind, is_canonical, created_at_ms) VALUES (?1, ?2, 'generated', 1, ?3)",
    ).bind(input.reference ?? `ref-${input.index}`, id, createdAtMs),
  ]);
  return id;
}

async function addVote(
  id: PollId,
  voteIndex: number,
  selectionCount = 1,
): Promise<void> {
  const optionStatements: D1PreparedStatement[] = [];
  for (let index = 0; index < selectionCount; index += 1) {
    const optionId = `option-${id}-${index}`;
    optionStatements.push(
      testEnv.DB.prepare(
        "INSERT OR IGNORE INTO poll_option (id, poll_id, label, position, created_at_ms) VALUES (?1, ?2, ?3, ?4, ?5)",
      ).bind(optionId, id, `Option ${index}`, index, NOW),
    );
  }
  const voteId = `vote-${id}-${voteIndex}`;
  await testEnv.DB.batch([
    ...optionStatements,
    testEnv.DB.prepare(
      "INSERT INTO vote (id, poll_id, submission_id, payload_hash, created_at_ms) VALUES (?1, ?2, ?3, ?4, ?5)",
    ).bind(voteId, id, `submission-${id}-${voteIndex}`, "hash", NOW),
    ...Array.from({ length: selectionCount }, (_, index) =>
      testEnv.DB.prepare(
        "INSERT INTO vote_selection (vote_id, poll_option_id) VALUES (?1, ?2)",
      ).bind(voteId, `option-${id}-${index}`),
    ),
  ]);
}

async function revision(): Promise<number> {
  const row = await testEnv.DB.prepare(
    "SELECT revision FROM discovery_catalog_revision WHERE singleton = 1",
  ).first<{ revision: number }>();
  if (!row) throw new Error("missing discovery revision");
  return row.revision;
}

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  await testEnv.DB.prepare("DELETE FROM vote_selection").run();
  await testEnv.DB.prepare("DELETE FROM voter_claim").run();
  await testEnv.DB.prepare("DELETE FROM vote").run();
  await testEnv.DB.prepare("DELETE FROM poll_option").run();
  await testEnv.DB.prepare("DELETE FROM poll_reference").run();
  await testEnv.DB.prepare("DELETE FROM poll").run();
  await testEnv.DB.prepare(
    "UPDATE discovery_catalog_revision SET revision = 1 WHERE singleton = 1",
  ).run();
  await testEnv.DB.prepare(
    "INSERT OR IGNORE INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?1, 'Discovery Owner', 'discovery@example.test', 1, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z')",
  )
    .bind(OWNER)
    .run();
});

describe("discovery catalog D1 eligibility and public projection", () => {
  it("includes only listed effectively-open polls and closes at deadline equality", async () => {
    await seedPoll({ index: 1, deadlineMs: null });
    await seedPoll({ index: 2, deadlineMs: NOW + 1 });
    await seedPoll({ index: 3, discoveryState: "unlisted" });
    await seedPoll({ index: 4, discoveryState: "delisted" });
    await seedPoll({ index: 5, closedAtMs: NOW - 1 });
    await seedPoll({ index: 6, deadlineMs: NOW - 1 });
    await seedPoll({ index: 7, deadlineMs: NOW });

    const rows = await createDiscoveryPersistence(testEnv.DB).queryCatalogPage({
      direction: "initial",
      boundary: null,
      limit: 21,
      nowMs: NOW,
    });

    expect(rows.map((row) => row.canonicalReference)).toEqual([
      "ref-2",
      "ref-1",
    ]);
    expect(rows.every((row) => Object.keys(row).sort().join(",") ===
      "canonicalReference,createdAtMs,deadlineMs,id,pollType,question,voteCount")).toBe(true);
  });

  it("selects only the canonical reference and preserves its case", async () => {
    const id = await seedPoll({ index: 1, reference: "Case-Sensitive-Ref" });
    await testEnv.DB.prepare(
      "INSERT INTO poll_reference (reference, poll_id, kind, is_canonical, created_at_ms) VALUES ('old-alias', ?1, 'generated', 0, ?2)",
    )
      .bind(id, NOW - 1)
      .run();

    const rows = await createDiscoveryPersistence(testEnv.DB).queryCatalogPage({
      direction: "initial",
      boundary: null,
      limit: 21,
      nowMs: NOW,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.canonicalReference).toBe("Case-Sensitive-Ref");
  });

  it("counts accepted vote rows rather than selections for every visibility", async () => {
    for (const [offset, visibility] of [
      [1, "live"],
      [2, "after_close"],
      [3, "creator_only"],
    ] as const) {
      const id = await seedPoll({ index: offset, resultVisibility: visibility });
      await addVote(id, 1, 2);
    }

    const rows = await createDiscoveryPersistence(testEnv.DB).queryCatalogPage({
      direction: "initial",
      boundary: null,
      limit: 21,
      nowMs: NOW,
    });

    expect(rows.map((row) => row.voteCount)).toEqual([1, 1, 1]);
  });
});

describe("discovery catalog D1 keyset traversal", () => {
  it.each([19, 20, 21, 45])(
    "traverses %i rows in both directions without duplicates",
    async (count) => {
      for (let index = 1; index <= count; index += 1) {
        await seedPoll({ index });
      }
      const persistence = createDiscoveryPersistence(testEnv.DB);
      const first = await persistence.queryCatalogPage({
        direction: "initial",
        boundary: null,
        limit: 21,
        nowMs: NOW,
      });
      const visibleFirst = first.slice(0, 20);

      if (count <= 20) {
        expect(visibleFirst).toHaveLength(count);
        return;
      }

      const boundary: DiscoveryOrderKey = {
        id: visibleFirst.at(-1)!.id,
        createdAtMs: visibleFirst.at(-1)!.createdAtMs,
      };
      const older = await persistence.queryCatalogPage({
        direction: "older",
        boundary,
        limit: 21,
        nowMs: NOW,
      });
      expect(
        new Set([...visibleFirst, ...older.slice(0, 20)].map((row) => row.id))
          .size,
      ).toBe(Math.min(count, 40));

      const newerBoundary: DiscoveryOrderKey = {
        id: older[0]!.id,
        createdAtMs: older[0]!.createdAtMs,
      };
      const newer = await persistence.queryCatalogPage({
        direction: "newer",
        boundary: newerBoundary,
        limit: 21,
        nowMs: NOW,
      });
      expect(newer.slice(0, 20).toReversed().map((row) => row.id)).toEqual(
        visibleFirst.map((row) => row.id),
      );
    },
  );

  it("orders same-millisecond rows by id descending", async () => {
    await seedPoll({ index: 1, createdAtMs: NOW });
    await seedPoll({ index: 3, createdAtMs: NOW });
    await seedPoll({ index: 2, createdAtMs: NOW });

    const rows = await createDiscoveryPersistence(testEnv.DB).queryCatalogPage({
      direction: "initial",
      boundary: null,
      limit: 21,
      nowMs: NOW,
    });
    expect(rows.map((row) => row.id)).toEqual([pollId(3), pollId(2), pollId(1)]);
  });

  it("does not duplicate or skip an addressed older page after a concurrent insert", async () => {
    for (let index = 1; index <= 25; index += 1) await seedPoll({ index });
    const persistence = createDiscoveryPersistence(testEnv.DB);
    const first = await persistence.queryCatalogPage({
      direction: "initial",
      boundary: null,
      limit: 21,
      nowMs: NOW,
    });
    const boundary = first[19]!;
    await seedPoll({ index: 100, createdAtMs: NOW + 100 });

    const older = await persistence.queryCatalogPage({
      direction: "older",
      boundary,
      limit: 21,
      nowMs: NOW,
    });
    expect(older.map((row) => row.id)).toEqual([
      pollId(5),
      pollId(4),
      pollId(3),
      pollId(2),
      pollId(1),
    ]);
  });

  it("continues from a deleted boundary tuple", async () => {
    for (let index = 1; index <= 25; index += 1) await seedPoll({ index });
    const persistence = createDiscoveryPersistence(testEnv.DB);
    const first = await persistence.queryCatalogPage({
      direction: "initial",
      boundary: null,
      limit: 21,
      nowMs: NOW,
    });
    const boundary = first[19]!;
    await testEnv.DB.prepare("DELETE FROM poll WHERE id = ?1")
      .bind(boundary.id)
      .run();

    const older = await persistence.queryCatalogPage({
      direction: "older",
      boundary,
      limit: 21,
      nowMs: NOW,
    });
    expect(older.map((row) => row.id)).toEqual([
      pollId(5),
      pollId(4),
      pollId(3),
      pollId(2),
      pollId(1),
    ]);
  });
});

describe("discovery catalog revision triggers", () => {
  it("bumps only for actual card or eligibility mutations", async () => {
    expect(await revision()).toBe(1);
    const id = await seedPoll({ index: 1, discoveryState: "unlisted" });
    expect(await revision()).toBe(2);

    for (const statement of [
      "UPDATE poll SET discovery_state = 'listed' WHERE id = ?1",
      "UPDATE poll SET discovery_state = 'unlisted' WHERE id = ?1",
      "UPDATE poll SET discovery_state = 'delisted' WHERE id = ?1",
      "UPDATE poll SET closed_at_ms = 123 WHERE id = ?1",
      "UPDATE poll SET deadline_ms = 456 WHERE id = ?1",
      "UPDATE poll SET question = 'Changed?' WHERE id = ?1",
      "UPDATE poll SET poll_type = 'ranked_choice' WHERE id = ?1",
    ]) {
      const before = await revision();
      await testEnv.DB.prepare(statement).bind(id).run();
      expect(await revision()).toBe(before + 1);
    }

    const stable = await revision();
    await testEnv.DB.prepare(
      `UPDATE poll SET
         discovery_state = discovery_state,
         closed_at_ms = closed_at_ms,
         deadline_ms = deadline_ms,
         question = question,
         poll_type = poll_type,
         result_visibility = 'creator_only',
         session_checks_enabled = 0,
         representation_version = representation_version + 1
       WHERE id = ?1`,
    )
      .bind(id)
      .run();
    expect(await revision()).toBe(stable);

    await testEnv.DB.prepare(
      "UPDATE poll SET closed_at_ms = NULL, deadline_ms = NULL WHERE id = ?1",
    )
      .bind(id)
      .run();
    const beforeVote = await revision();
    await addVote(id, 1);
    expect(await revision()).toBe(beforeVote);

    await testEnv.DB.prepare("DELETE FROM poll WHERE id = ?1").bind(id).run();
    expect(await revision()).toBe(beforeVote + 1);
  });

  it("rolls a trigger bump back when the Poll mutation batch fails", async () => {
    const id = await seedPoll({ index: 1 });
    const before = await revision();
    await expect(
      testEnv.DB.batch([
        testEnv.DB.prepare("UPDATE poll SET question = 'Rolled back' WHERE id = ?1").bind(id),
        testEnv.DB.prepare(
          "INSERT INTO poll_reference (reference, poll_id, kind, is_canonical, created_at_ms) VALUES ('ref-1', ?1, 'custom', 0, ?2)",
        ).bind(id, NOW),
      ]),
    ).rejects.toThrow();
    expect(await revision()).toBe(before);
    expect(
      await testEnv.DB.prepare("SELECT question FROM poll WHERE id = ?1")
        .bind(id)
        .first("question"),
    ).toBe("Question 1?");
  });
});

describe("discovery query plans and bounded active-set work", () => {
  it("uses both discovery indexes, the canonical join, and the vote-count index", async () => {
    await seedPoll({ index: 1 });
    await seedPoll({ index: 2, deadlineMs: NOW + 10_000 });

    const noDeadlinePlan = await testEnv.DB.prepare(
      `EXPLAIN QUERY PLAN ${DISCOVERY_NO_DEADLINE_QUERY}`,
    )
      .bind(NOW, null, null, 21)
      .all<{ detail: string }>();
    const deadlinePlan = await testEnv.DB.prepare(
      `EXPLAIN QUERY PLAN ${DISCOVERY_ACTIVE_DEADLINE_QUERY}`,
    )
      .bind(NOW, null, null, 21)
      .all<{ detail: string }>();
    const noDeadlineDetails = noDeadlinePlan.results.map((row) => row.detail).join("\n");
    const deadlineDetails = deadlinePlan.results.map((row) => row.detail).join("\n");

    expect(noDeadlineDetails).toContain("poll_discovery_no_deadline_idx");
    expect(noDeadlineDetails).toContain("poll_reference_canonical_idx");
    expect(noDeadlineDetails).toContain("vote_poll_id_idx");
    expect(deadlineDetails).toContain("poll_discovery_active_deadline_idx");
    expect(deadlineDetails).toMatch(/SEARCH .*deadline_ms/);
    expect(deadlineDetails).toContain("USE TEMP B-TREE FOR ORDER BY");
    expect(deadlineDetails).toContain("poll_reference_canonical_idx");
    expect(deadlineDetails).toContain("vote_poll_id_idx");
    expect(deadlineDetails).not.toMatch(/SCAN (?:TABLE )?p(?:\s|$)/);
  });

  it("range-seeks past a large expired prefix", async () => {
    await testEnv.DB.prepare(
      `WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 2000)
       INSERT INTO poll (
         id, owner_user_id, poll_type, question, description, result_visibility,
         discovery_state, session_checks_enabled, ip_checks_enabled,
         voter_codes_enabled, captcha_enabled, vpn_blocking_enabled,
         multi_select_enabled, min_selections, max_selections, deadline_ms,
         closed_at_ms, representation_version, created_at_ms, updated_at_ms
       )
       SELECT printf('10000000-0000-4000-8000-%012d', n), '${OWNER}',
         'multiple_choice', 'Expired', NULL, 'live', 'listed', 1, 0, 0, 0, 0,
         0, NULL, NULL, ${NOW} - n, NULL, 1, ${NOW} - n, ${NOW} - n
       FROM seq`,
    ).run();
    await seedPoll({ index: 3001, deadlineMs: NOW + 1 });
    const result = await testEnv.DB.prepare(DISCOVERY_ACTIVE_DEADLINE_QUERY)
      .bind(NOW, null, null, 21)
      .all();
    expect(result.meta.rows_read).toBeLessThan(100);
  });

  it("sorts a 5,000-row active Deadline set into the correct merged page", async () => {
    await testEnv.DB.prepare(
      `WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 5000)
       INSERT INTO poll (
         id, owner_user_id, poll_type, question, description, result_visibility,
         discovery_state, session_checks_enabled, ip_checks_enabled,
         voter_codes_enabled, captcha_enabled, vpn_blocking_enabled,
         multi_select_enabled, min_selections, max_selections, deadline_ms,
         closed_at_ms, representation_version, created_at_ms, updated_at_ms
       )
       SELECT printf('20000000-0000-4000-8000-%012d', n), '${OWNER}',
         'multiple_choice', 'Active', NULL, 'live', 'listed', 1, 0, 0, 0, 0,
         0, NULL, NULL, ${NOW} + 60000 + n, NULL, 1, ${NOW} + n, ${NOW} + n
       FROM seq`,
    ).run();
    await testEnv.DB.prepare(
      `WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 5000)
       INSERT INTO poll_reference (reference, poll_id, kind, is_canonical, created_at_ms)
       SELECT printf('active-%d', n), printf('20000000-0000-4000-8000-%012d', n),
         'generated', 1, ${NOW} + n FROM seq`,
    ).run();

    const rows = await createDiscoveryPersistence(testEnv.DB).queryCatalogPage({
      direction: "initial",
      boundary: null,
      limit: 21,
      nowMs: NOW,
    });
    expect(rows).toHaveLength(21);
    expect(rows[0]?.canonicalReference).toBe("active-5000");
    expect(rows[20]?.canonicalReference).toBe("active-4980");

    const evidence = await testEnv.DB.prepare(DISCOVERY_ACTIVE_DEADLINE_QUERY)
      .bind(NOW, null, null, 21)
      .all();
    expect(evidence.meta.rows_read).toBeGreaterThanOrEqual(5000);
    expect(evidence.meta.rows_read).toBeLessThan(15_500);
  });
});

describe("discovery sitemap persistence", () => {
  it("pages every eligible canonical reference without a vote-count projection", async () => {
    for (let index = 1; index <= 25; index += 1) await seedPoll({ index });
    await seedPoll({ index: 100, discoveryState: "unlisted" });
    const persistence = createDiscoveryPersistence(testEnv.DB);
    const first = await persistence.querySitemapPage({
      boundary: null,
      limit: 11,
      nowMs: NOW,
    });
    const second = await persistence.querySitemapPage({
      boundary: first[9]!,
      limit: 11,
      nowMs: NOW,
    });
    expect(new Set([...first.slice(0, 10), ...second.slice(0, 10)].map((row) => row.canonicalReference)).size).toBe(20);
    expect(first[0]).toEqual({
      id: pollId(25),
      canonicalReference: "ref-25",
      createdAtMs: NOW + 25,
      deadlineMs: null,
    });
  });
});
