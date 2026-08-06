// Multiple-Choice export fact driver. This is the only layer allowed to use
// D1 identifiers to join and byte-order facts; every returned shape is
// purpose-built and identifier-free before the type strategy sees it.

import type { MultipleChoiceExportFacts } from "../../../modules/polls/types/multiple-choice";
import type {
  BoundedExportFactDriver,
  ExportFactDriver,
  ExportDriverFacts,
  SharedExportVoteFacts,
} from "../../../modules/results/export";
import type { PollId, PollOptionId } from "../../../shared/domain/index";

type ProjectionRow = {
  row_kind: "capacity" | "summary" | "option" | "vote" | "selection";
  option_id: PollOptionId | null;
  option_label: string | null;
  option_position: number | null;
  option_count: number | null;
  vote_id: string | null;
  vote_created_at_ms: number | null;
  comment_body: string | null;
  comment_display_name: string | null;
  comment_created_at_ms: number | null;
  selected_option_id: PollOptionId | null;
  voter_count: number | null;
  selection_count: number | null;
  multi_select_enabled: number | null;
  min_selections: number | null;
  max_selections: number | null;
  accepted_vote_count: number | null;
  oversized: number | null;
};

export const XLSX_ACCEPTED_VOTE_LIMIT = 1_000;

/** One statement / one D1 snapshot; only the positive privacy allowlist. */
export const MULTIPLE_CHOICE_EXPORT_PROJECTION_QUERY = `WITH target_votes AS MATERIALIZED (
  SELECT id, created_at_ms
  FROM vote
  WHERE poll_id = ?1
), option_counts AS MATERIALIZED (
  SELECT vs.poll_option_id, COUNT(*) AS option_count
  FROM target_votes tv
  JOIN vote_selection vs ON vs.vote_id = tv.id
  GROUP BY vs.poll_option_id
)
SELECT 'summary' AS row_kind,
       NULL AS option_id, NULL AS option_label, NULL AS option_position,
       NULL AS option_count, NULL AS vote_id, NULL AS vote_created_at_ms,
       NULL AS comment_body, NULL AS comment_display_name,
       NULL AS comment_created_at_ms, NULL AS selected_option_id,
       (SELECT COUNT(*) FROM target_votes) AS voter_count,
       (SELECT COUNT(*) FROM target_votes tv JOIN vote_selection vs ON vs.vote_id = tv.id) AS selection_count,
       multi_select_enabled, min_selections, max_selections,
       0 AS row_order, 0 AS primary_order, X'' AS secondary_order
FROM poll WHERE id = ?1 AND poll_type = 'multiple_choice'
UNION ALL
SELECT 'option', po.id, po.label, po.position,
       COALESCE(oc.option_count, 0), NULL, NULL, NULL, NULL, NULL, NULL,
       NULL, NULL, NULL, NULL, NULL, 1, po.position, CAST(po.id AS BLOB)
FROM poll_option po
LEFT JOIN option_counts oc ON oc.poll_option_id = po.id
WHERE po.poll_id = ?1
UNION ALL
SELECT 'vote', NULL, NULL, NULL, NULL, tv.id, tv.created_at_ms,
       vc.body, vc.display_name, vc.created_at_ms, NULL,
       NULL, NULL, NULL, NULL, NULL, 2, tv.created_at_ms, CAST(tv.id AS BLOB)
FROM target_votes tv
LEFT JOIN vote_comment vc ON vc.vote_id = tv.id
UNION ALL
SELECT 'selection', NULL, NULL, NULL, NULL, tv.id, NULL,
       NULL, NULL, NULL, vs.poll_option_id,
       NULL, NULL, NULL, NULL, NULL, 3, tv.created_at_ms,
       CAST(tv.id || ':' || vs.poll_option_id AS BLOB)
FROM target_votes tv
JOIN vote_selection vs ON vs.vote_id = tv.id
ORDER BY row_order, primary_order, secondary_order`;

/**
 * One bounded XLSX fact statement / one D1 snapshot. The unordered candidate
 * LIMIT finds only the capacity sentinel; canonical sorting and every private
 * branch are downstream of the capacity gate.
 */
export const MULTIPLE_CHOICE_BOUNDED_EXPORT_PROJECTION_QUERY = `WITH candidate_votes AS MATERIALIZED (
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
  SELECT vs.poll_option_id, COUNT(*) AS option_count
  FROM target_votes tv
  JOIN vote_selection vs ON vs.vote_id = tv.id
  GROUP BY vs.poll_option_id
)
SELECT 'capacity' AS row_kind,
       NULL AS option_id, NULL AS option_label, NULL AS option_position,
       NULL AS option_count, NULL AS vote_id, NULL AS vote_created_at_ms,
       NULL AS comment_body, NULL AS comment_display_name,
       NULL AS comment_created_at_ms, NULL AS selected_option_id,
       NULL AS voter_count, NULL AS selection_count,
       NULL AS multi_select_enabled, NULL AS min_selections,
       NULL AS max_selections, accepted_vote_count,
       CASE WHEN accepted_vote_count > ${XLSX_ACCEPTED_VOTE_LIMIT} THEN 1 ELSE 0 END AS oversized,
       0 AS row_order, 0 AS primary_order, X'' AS secondary_order
FROM capacity
UNION ALL
SELECT 'summary', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
       c.accepted_vote_count,
       (SELECT COUNT(*) FROM target_votes tv JOIN vote_selection vs ON vs.vote_id = tv.id),
       p.multi_select_enabled, p.min_selections, p.max_selections,
       NULL, NULL, 1, 0, X''
FROM poll p
CROSS JOIN capacity c
WHERE p.id = ?1 AND p.poll_type = 'multiple_choice'
  AND c.accepted_vote_count <= ${XLSX_ACCEPTED_VOTE_LIMIT}
UNION ALL
SELECT 'option', po.id, po.label, po.position,
       COALESCE(oc.option_count, 0), NULL, NULL, NULL, NULL, NULL, NULL,
       NULL, NULL, NULL, NULL, NULL, NULL, NULL,
       2, po.position, CAST(po.id AS BLOB)
FROM poll_option po
LEFT JOIN option_counts oc ON oc.poll_option_id = po.id
CROSS JOIN capacity c
WHERE po.poll_id = ?1 AND c.accepted_vote_count <= ${XLSX_ACCEPTED_VOTE_LIMIT}
UNION ALL
SELECT 'vote', NULL, NULL, NULL, NULL, tv.id, tv.created_at_ms,
       vc.body, vc.display_name, vc.created_at_ms, NULL,
       NULL, NULL, NULL, NULL, NULL, NULL, NULL,
       3, tv.created_at_ms, CAST(tv.id AS BLOB)
FROM target_votes tv
LEFT JOIN vote_comment vc ON vc.vote_id = tv.id
UNION ALL
SELECT 'selection', NULL, NULL, NULL, NULL, tv.id, NULL,
       NULL, NULL, NULL, vs.poll_option_id,
       NULL, NULL, NULL, NULL, NULL, NULL, NULL,
       4, tv.created_at_ms, CAST(tv.id || ':' || vs.poll_option_id AS BLOB)
FROM target_votes tv
JOIN vote_selection vs ON vs.vote_id = tv.id
ORDER BY row_order, primary_order, secondary_order`;

function safeCount(value: number | null, name: string): number {
  if (value === null || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Malformed multiple-choice export: ${name}`);
  }
  return value;
}

function parseProjectionRows(
  rows: readonly ProjectionRow[],
): ExportDriverFacts<MultipleChoiceExportFacts> | null {
  const summary = rows.find(({ row_kind }) => row_kind === "summary");
  if (!summary) return null;

  const internalOptions = rows
    .filter(({ row_kind }) => row_kind === "option")
    .map((row) => {
      if (
        row.option_id === null ||
        typeof row.option_label !== "string" ||
        row.option_position === null ||
        !Number.isSafeInteger(row.option_position) ||
        row.option_position < 0
      ) {
        throw new Error("Malformed multiple-choice export option");
      }
      return {
        id: row.option_id,
        label: row.option_label,
        position: row.option_position,
        count: safeCount(row.option_count, "option count"),
      };
    });
  const positionById = new Map(
    internalOptions.map(({ id, position }) => [id, position]),
  );
  const internalVotes = rows
    .filter(({ row_kind }) => row_kind === "vote")
    .map((row, alignmentKey) => {
      if (
        row.vote_id === null ||
        row.vote_created_at_ms === null ||
        !Number.isSafeInteger(row.vote_created_at_ms) ||
        row.vote_created_at_ms < 0 ||
        (row.comment_body === null) !== (row.comment_created_at_ms === null)
      ) {
        throw new Error("Malformed multiple-choice export Vote");
      }
      return {
        id: row.vote_id,
        shared: {
          alignmentKey,
          createdAtMs: row.vote_created_at_ms,
          comment:
            row.comment_body === null
              ? null
              : {
                  body: row.comment_body,
                  displayName: row.comment_display_name,
                  createdAtMs: row.comment_created_at_ms as number,
                },
        } satisfies SharedExportVoteFacts,
        type: {
          alignmentKey,
          createdAtMs: row.vote_created_at_ms,
          selections: [] as { optionPosition: number }[],
        },
      };
    });
  const voteById = new Map(internalVotes.map((vote) => [vote.id, vote]));
  for (const row of rows) {
    if (row.row_kind !== "selection") continue;
    const vote = row.vote_id === null ? undefined : voteById.get(row.vote_id);
    const position =
      row.selected_option_id === null
        ? undefined
        : positionById.get(row.selected_option_id);
    if (!vote || position === undefined) {
      throw new Error("Malformed multiple-choice export selection");
    }
    vote.type.selections.push({ optionPosition: position });
  }

  return {
    sharedVotes: internalVotes.map(({ shared }) => shared),
    typeFacts: {
      multiSelectEnabled:
        summary.multi_select_enabled === 1
          ? true
          : summary.multi_select_enabled === 0
            ? false
            : (() => {
                throw new Error("Malformed export multi-select setting");
              })(),
      minSelections:
        summary.min_selections === null
          ? null
          : safeCount(summary.min_selections, "minimum selections"),
      maxSelections:
        summary.max_selections === null
          ? null
          : safeCount(summary.max_selections, "maximum selections"),
      options: internalOptions.map(({ label, position, count }) => ({
        label,
        position,
        count,
      })),
      votes: internalVotes.map(({ type }) => type),
      voterCount: safeCount(summary.voter_count, "Voter count"),
      selectionCount: safeCount(summary.selection_count, "selection count"),
    },
  };
}

export function createMultipleChoiceExportFactDriver(
  db: D1Database,
): ExportFactDriver<MultipleChoiceExportFacts> {
  return {
    type: "multiple_choice",
    async projectFacts(pollId) {
      const result = await db
        .prepare(MULTIPLE_CHOICE_EXPORT_PROJECTION_QUERY)
        .bind(pollId)
        .all<ProjectionRow>();
      return parseProjectionRows(result.results);
    },
  };
}

export function createBoundedMultipleChoiceExportFactDriver(
  db: D1Database,
): BoundedExportFactDriver<MultipleChoiceExportFacts> {
  return {
    type: "multiple_choice",
    async projectFacts(pollId) {
      const result = await db
        .prepare(MULTIPLE_CHOICE_BOUNDED_EXPORT_PROJECTION_QUERY)
        .bind(pollId)
        .all<ProjectionRow>();
      const capacityRows = result.results.filter(
        ({ row_kind }) => row_kind === "capacity",
      );
      if (capacityRows.length !== 1) {
        throw new Error("Malformed bounded export capacity");
      }
      const capacity = capacityRows[0]!;
      const acceptedVoteCount = safeCount(
        capacity.accepted_vote_count,
        "bounded accepted Vote count",
      );
      if (capacity.oversized === 1) {
        if (
          acceptedVoteCount !== XLSX_ACCEPTED_VOTE_LIMIT + 1 ||
          result.results.length !== 1
        ) {
          throw new Error("Malformed bounded export oversize result");
        }
        return { status: "oversize" };
      }
      if (
        capacity.oversized !== 0 ||
        acceptedVoteCount > XLSX_ACCEPTED_VOTE_LIMIT
      ) {
        throw new Error("Malformed bounded export capacity");
      }
      const facts = parseProjectionRows(result.results);
      if (!facts || facts.sharedVotes.length !== acceptedVoteCount) {
        throw new Error("Malformed bounded export projection");
      }
      return { status: "ready", facts };
    },
  };
}
