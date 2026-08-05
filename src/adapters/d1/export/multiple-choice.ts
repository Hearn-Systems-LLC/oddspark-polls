// Multiple-Choice export fact driver. This is the only layer allowed to use
// D1 identifiers to join and byte-order facts; every returned shape is
// purpose-built and identifier-free before the type strategy sees it.

import type { MultipleChoiceExportFacts } from "../../../modules/polls/types/multiple-choice";
import type {
  ExportFactDriver,
  SharedExportVoteFacts,
} from "../../../modules/results/export";
import type { PollId, PollOptionId } from "../../../shared/domain/index";

type ProjectionRow = {
  row_kind: "summary" | "option" | "vote" | "selection";
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
};

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

function safeCount(value: number | null, name: string): number {
  if (value === null || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Malformed multiple-choice export: ${name}`);
  }
  return value;
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
      const summary = result.results.find(({ row_kind }) => row_kind === "summary");
      if (!summary) return null;

      const internalOptions = result.results
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
      const internalVotes = result.results
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
      for (const row of result.results) {
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
    },
  };
}
