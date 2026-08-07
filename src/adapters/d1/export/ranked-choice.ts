// Ranked-Choice export fact driver (Story 5.3). One-statement UNION ALL
// snapshot; positions never IDs in the outward shape; oversize sentinel for
// XLSX capacity gate.

import type { RankedChoiceExportFacts } from "../../../modules/polls/types/ranked-choice";
import {
  XLSX_ACCEPTED_VOTE_LIMIT,
  type BoundedExportFactDriver,
  type ExportFactDriver,
  type ExportDriverFacts,
  type SharedExportVoteFacts,
} from "../../../modules/results/export";
import type { PollId, PollOptionId } from "../../../shared/domain/index";

type ProjectionRow = {
  row_kind: "capacity" | "summary" | "option" | "vote" | "preference";
  option_id: PollOptionId | null;
  option_label: string | null;
  option_position: number | null;
  option_count: number | null;
  vote_id: string | null;
  vote_created_at_ms: number | null;
  comment_body: string | null;
  comment_display_name: string | null;
  comment_created_at_ms: number | null;
  preference_option_id: PollOptionId | null;
  preference_rank: number | null;
  voter_count: number | null;
  selection_count: number | null;
  accepted_vote_count: number | null;
  oversized: number | null;
};

const RANKED_CHOICE_EXPORT_PROJECTION_QUERY = `WITH target_votes AS MATERIALIZED (
  SELECT id, created_at_ms
  FROM vote
  WHERE poll_id = ?1
), option_counts AS MATERIALIZED (
  SELECT rvp.poll_option_id, COUNT(*) AS option_count
  FROM target_votes tv
  JOIN ranked_vote_preference rvp ON rvp.vote_id = tv.id
  GROUP BY rvp.poll_option_id
)
SELECT 'summary' AS row_kind,
       NULL AS option_id, NULL AS option_label, NULL AS option_position,
       NULL AS option_count, NULL AS vote_id, NULL AS vote_created_at_ms,
       NULL AS comment_body, NULL AS comment_display_name,
       NULL AS comment_created_at_ms, NULL AS preference_option_id,
       NULL AS preference_rank,
       (SELECT COUNT(*) FROM target_votes) AS voter_count,
       (SELECT COUNT(*) FROM target_votes tv JOIN ranked_vote_preference rvp ON rvp.vote_id = tv.id) AS selection_count,
       NULL AS accepted_vote_count, NULL AS oversized,
       0 AS row_order, 0 AS primary_order, X'' AS secondary_order
FROM poll WHERE id = ?1 AND poll_type = 'ranked_choice'
UNION ALL
SELECT 'option', po.id, po.label, po.position,
       COALESCE(oc.option_count, 0), NULL, NULL, NULL, NULL, NULL, NULL, NULL,
       NULL, NULL, NULL,
       1, po.position, CAST(po.id AS BLOB)
FROM poll_option po
LEFT JOIN option_counts oc ON oc.poll_option_id = po.id
WHERE po.poll_id = ?1
UNION ALL
SELECT 'vote', NULL, NULL, NULL, NULL, tv.id, tv.created_at_ms,
       vc.body, vc.display_name, vc.created_at_ms, NULL, NULL,
       NULL, NULL, NULL, NULL,
       2, tv.created_at_ms, CAST(tv.id AS BLOB)
FROM target_votes tv
LEFT JOIN vote_comment vc ON vc.vote_id = tv.id
UNION ALL
SELECT 'preference', NULL, NULL, NULL, NULL, tv.id, NULL,
       NULL, NULL, NULL, rvp.poll_option_id, rvp.preference_rank,
       NULL, NULL, NULL, NULL,
       3, tv.created_at_ms, CAST(tv.id || ':' || rvp.preference_rank AS BLOB)
FROM target_votes tv
JOIN ranked_vote_preference rvp ON rvp.vote_id = tv.id
ORDER BY row_order, primary_order, secondary_order`;

const RANKED_CHOICE_BOUNDED_EXPORT_PROJECTION_QUERY = `WITH candidate_votes AS MATERIALIZED (
  SELECT id, created_at_ms
  FROM vote
  WHERE poll_id = ?1
  LIMIT ${XLSX_ACCEPTED_VOTE_LIMIT + 1}
), capacity AS MATERIALIZED (
  SELECT COUNT(*) AS accepted_vote_count
  FROM candidate_votes
), target_votes AS MATERIALIZED (
  SELECT cv.id, cv.created_at_ms
  FROM candidate_votes cv
  CROSS JOIN capacity c
  WHERE c.accepted_vote_count <= ${XLSX_ACCEPTED_VOTE_LIMIT}
  ORDER BY cv.created_at_ms, CAST(cv.id AS BLOB)
), option_counts AS MATERIALIZED (
  SELECT rvp.poll_option_id, COUNT(*) AS option_count
  FROM target_votes tv
  JOIN ranked_vote_preference rvp ON rvp.vote_id = tv.id
  GROUP BY rvp.poll_option_id
)
SELECT 'capacity' AS row_kind,
       NULL AS option_id, NULL AS option_label, NULL AS option_position,
       NULL AS option_count, NULL AS vote_id, NULL AS vote_created_at_ms,
       NULL AS comment_body, NULL AS comment_display_name,
       NULL AS comment_created_at_ms, NULL AS preference_option_id,
       NULL AS preference_rank,
       NULL AS voter_count, NULL AS selection_count,
       accepted_vote_count,
       CASE WHEN accepted_vote_count > ${XLSX_ACCEPTED_VOTE_LIMIT} THEN 1 ELSE 0 END AS oversized,
       0 AS row_order, 0 AS primary_order, X'' AS secondary_order
FROM capacity
UNION ALL
SELECT 'summary', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
       c.accepted_vote_count,
       (SELECT COUNT(*) FROM target_votes tv JOIN ranked_vote_preference rvp ON rvp.vote_id = tv.id),
       NULL, NULL,
       1, 0, X''
FROM poll p
CROSS JOIN capacity c
WHERE p.id = ?1 AND p.poll_type = 'ranked_choice'
  AND c.accepted_vote_count <= ${XLSX_ACCEPTED_VOTE_LIMIT}
UNION ALL
SELECT 'option', po.id, po.label, po.position,
       COALESCE(oc.option_count, 0), NULL, NULL, NULL, NULL, NULL, NULL, NULL,
       NULL, NULL, NULL, NULL,
       2, po.position, CAST(po.id AS BLOB)
FROM poll_option po
LEFT JOIN option_counts oc ON oc.poll_option_id = po.id
CROSS JOIN capacity c
WHERE po.poll_id = ?1 AND c.accepted_vote_count <= ${XLSX_ACCEPTED_VOTE_LIMIT}
UNION ALL
SELECT 'vote', NULL, NULL, NULL, NULL, tv.id, tv.created_at_ms,
       vc.body, vc.display_name, vc.created_at_ms, NULL, NULL,
       NULL, NULL, NULL, NULL,
       3, tv.created_at_ms, CAST(tv.id AS BLOB)
FROM target_votes tv
LEFT JOIN vote_comment vc ON vc.vote_id = tv.id
UNION ALL
SELECT 'preference', NULL, NULL, NULL, NULL, tv.id, NULL,
       NULL, NULL, NULL, rvp.poll_option_id, rvp.preference_rank,
       NULL, NULL, NULL, NULL,
       4, tv.created_at_ms, CAST(tv.id || ':' || rvp.preference_rank AS BLOB)
FROM target_votes tv
JOIN ranked_vote_preference rvp ON rvp.vote_id = tv.id
ORDER BY row_order, primary_order, secondary_order`;

function safeCount(value: number | null, name: string): number {
  if (value === null || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Malformed ranked-choice export: ${name}`);
  }
  return value;
}

function parseProjectionRows(
  rows: readonly ProjectionRow[],
): ExportDriverFacts<RankedChoiceExportFacts> | null {
  const summary = rows.find((row) => row.row_kind === "summary");
  if (!summary) return null;

  const voterCount = safeCount(summary.voter_count, "voter_count");
  const selectionCount = safeCount(summary.selection_count, "selection_count");

  const options = rows
    .filter((row) => row.row_kind === "option")
    .map((row) => ({
      label: row.option_label ?? "",
      position: row.option_position ?? 0,
      count: safeCount(row.option_count, "option_count"),
    }))
    .sort((left, right) => left.position - right.position);

  const optionLabelById = new Map<string, string>();
  const optionPositionById = new Map<string, number>();
  for (const row of rows.filter((r) => r.row_kind === "option")) {
    if (row.option_id && row.option_label !== null) {
      optionLabelById.set(row.option_id, row.option_label);
    }
    if (row.option_id && row.option_position !== null) {
      optionPositionById.set(row.option_id, row.option_position);
    }
  }

  const voteMap = new Map<
    string,
    { createdAtMs: number; comment: SharedExportVoteFacts["comment"]; prefs: { rank: number; optionPosition: number }[] }
  >();

  for (const row of rows.filter((r) => r.row_kind === "vote")) {
    if (
      !row.vote_id ||
      row.vote_created_at_ms === null ||
      !Number.isSafeInteger(row.vote_created_at_ms) ||
      row.vote_created_at_ms < 0 ||
      (row.comment_body === null) !== (row.comment_created_at_ms === null)
    ) {
      continue;
    }
    voteMap.set(row.vote_id, {
      createdAtMs: row.vote_created_at_ms,
      comment:
        row.comment_body === null
          ? null
          : {
              body: row.comment_body,
              displayName: row.comment_display_name,
              createdAtMs: row.comment_created_at_ms as number,
            },
      prefs: [],
    });
  }

  for (const row of rows.filter((r) => r.row_kind === "preference")) {
    if (!row.vote_id || !row.preference_option_id || row.preference_rank === null) continue;
    const vote = voteMap.get(row.vote_id);
    if (!vote) continue;
    const pos = optionPositionById.get(row.preference_option_id);
    if (pos === undefined) continue;
    vote.prefs.push({ rank: row.preference_rank, optionPosition: pos });
  }

  const sortedVotes = [...voteMap.entries()]
    .sort(([idA, a], [idB, b]) => {
      if (a.createdAtMs !== b.createdAtMs) return a.createdAtMs - b.createdAtMs;
      // Tie-break by vote_id to keep ordering deterministic across runs
      // (the bounded query already orders by (created_at_ms, id BLOB)).
      return idA < idB ? -1 : idA > idB ? 1 : 0;
    })
    .map(([, vote], index) => ({
      alignmentKey: index,
      createdAtMs: vote.createdAtMs,
      comment: vote.comment,
      rankedOptionPositions: vote.prefs
        .sort((a, b) => a.rank - b.rank)
        .map((p) => p.optionPosition),
    }));

  const sharedVotes: SharedExportVoteFacts[] = sortedVotes.map((v) => ({
    alignmentKey: v.alignmentKey,
    createdAtMs: v.createdAtMs,
    comment: v.comment,
  }));

  const votes = sortedVotes.map((v) => ({
    alignmentKey: v.alignmentKey,
    createdAtMs: v.createdAtMs,
    rankedOptionPositions: v.rankedOptionPositions,
  }));

  return {
    sharedVotes,
    typeFacts: {
      options,
      votes,
      voterCount,
      selectionCount,
    },
  };
}

export function createRankedChoiceExportFactDriver(db: D1Database): ExportFactDriver<RankedChoiceExportFacts> {
  return {
    type: "ranked_choice",
    async projectFacts(pollId: PollId) {
      const result = await db
        .prepare(RANKED_CHOICE_EXPORT_PROJECTION_QUERY)
        .bind(pollId)
        .all<ProjectionRow>();
      try {
        return parseProjectionRows(result.results);
      } catch {
        return null;
      }
    },
  };
}

export function createBoundedRankedChoiceExportFactDriver(db: D1Database): BoundedExportFactDriver<RankedChoiceExportFacts> {
  return {
    type: "ranked_choice",
    async projectFacts(pollId: PollId) {
      const result = await db
        .prepare(RANKED_CHOICE_BOUNDED_EXPORT_PROJECTION_QUERY)
        .bind(pollId)
        .all<ProjectionRow>();
      const capacityRow = result.results.find((r) => r.row_kind === "capacity");
      if (capacityRow?.oversized === 1) {
        return { status: "oversize" };
      }
      try {
        const facts = parseProjectionRows(result.results);
        if (!facts) return null;
        return { status: "ready", facts };
      } catch {
        return null;
      }
    },
  };
}
