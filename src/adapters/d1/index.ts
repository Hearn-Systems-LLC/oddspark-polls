// D1 adapter — poll repositories and batches. Implements the Polls module's
// persistence port over the DB binding (AD-1: adapters implement ports and
// never call delivery code). Only Polls-module commands write these tables
// (AD-19).

import {
  DuplicatePollIdError,
  type PollPersistenceRows,
} from "../../modules/polls/index";
import type {
  PollId,
  PollOptionId,
  PollType,
  ResultVisibility,
  UserId,
} from "../../shared/domain/index";

export type PollPage = {
  pollId: PollId;
  question: string;
  description: string | null;
  pollType: PollType;
  resultVisibility: ResultVisibility;
  deadlineMs: number | null;
  closedAtMs: number | null;
  options: { id: PollOptionId; label: string; position: number }[];
};

export type OwnedPoll = PollPage & {
  canonicalReference: string;
  createdAtMs: number;
};

type PollRow = {
  id: PollId;
  question: string;
  description: string | null;
  poll_type: PollType;
  result_visibility: ResultVisibility;
  deadline_ms: number | null;
  closed_at_ms: number | null;
};

async function loadOptions(
  db: D1Database,
  pollId: PollId,
): Promise<PollPage["options"]> {
  const options = await db
    .prepare(
      "SELECT id, label, position FROM poll_option WHERE poll_id = ?1 ORDER BY position",
    )
    .bind(pollId)
    .all<{ id: PollOptionId; label: string; position: number }>();
  return options.results;
}

function toPollPage(row: PollRow, options: PollPage["options"]): PollPage {
  return {
    pollId: row.id,
    question: row.question,
    description: row.description,
    pollType: row.poll_type,
    resultVisibility: row.result_visibility,
    deadlineMs: row.deadline_ms,
    closedAtMs: row.closed_at_ms,
    options,
  };
}

export function createPollPersistence(db: D1Database) {
  return {
    // The one AD-3 creation batch: poll + options + reference commit
    // together or not at all — a failed batch leaves no reachable Poll.
    async insertPoll(rows: PollPersistenceRows): Promise<void> {
      const { poll, options, reference } = rows;
      try {
        await db.batch([
          db
            .prepare(
              "INSERT INTO poll (id, owner_user_id, poll_type, question, description, result_visibility, discovery_state, session_checks_enabled, deadline_ms, representation_version, created_at_ms, updated_at_ms) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)",
            )
            .bind(
              poll.id,
              poll.ownerUserId,
              poll.pollType,
              poll.question,
              poll.description,
              poll.resultVisibility,
              poll.discoveryState,
              poll.sessionChecksEnabled ? 1 : 0,
              poll.deadlineMs,
              poll.representationVersion,
              poll.createdAtMs,
            ),
          ...options.map((option) =>
            db
              .prepare(
                "INSERT INTO poll_option (id, poll_id, label, position, created_at_ms) VALUES (?1, ?2, ?3, ?4, ?5)",
              )
              .bind(
                option.id,
                option.pollId,
                option.label,
                option.position,
                option.createdAtMs,
              ),
          ),
          db
            .prepare(
              "INSERT INTO poll_reference (reference, poll_id, kind, is_canonical, created_at_ms) VALUES (?1, ?2, ?3, 1, ?4)",
            )
            .bind(
              reference.reference,
              reference.pollId,
              reference.kind,
              reference.createdAtMs,
            ),
        ]);
      } catch (error) {
        // Translate the one collision the domain has policy for (D4 dedupe);
        // everything else propagates to the generic failure mapping.
        if (
          error instanceof Error &&
          /UNIQUE constraint failed: poll\.id/.test(error.message)
        ) {
          throw new DuplicatePollIdError(error.message);
        }
        throw error;
      }
    },

    async findPollByReference(reference: string): Promise<PollPage | null> {
      const row = await db
        .prepare(
          "SELECT p.id, p.question, p.description, p.poll_type, p.result_visibility, p.deadline_ms, p.closed_at_ms FROM poll p JOIN poll_reference r ON r.poll_id = p.id WHERE r.reference = ?1",
        )
        .bind(reference)
        .first<PollRow>();
      if (!row) {
        return null;
      }
      return toPollPage(row, await loadOptions(db, row.id));
    },

    async findPollForOwner(
      pollId: PollId,
      ownerUserId: UserId,
    ): Promise<OwnedPoll | null> {
      const row = await db
        .prepare(
          "SELECT p.id, p.question, p.description, p.poll_type, p.result_visibility, p.deadline_ms, p.closed_at_ms, p.created_at_ms, r.reference AS canonical_reference FROM poll p JOIN poll_reference r ON r.poll_id = p.id AND r.is_canonical = 1 WHERE p.id = ?1 AND p.owner_user_id = ?2",
        )
        .bind(pollId, ownerUserId)
        .first<
          PollRow & { canonical_reference: string; created_at_ms: number }
        >();
      if (!row) {
        return null;
      }
      return {
        ...toPollPage(row, await loadOptions(db, row.id)),
        canonicalReference: row.canonical_reference,
        createdAtMs: row.created_at_ms,
      };
    },
  };
}

export type PollPersistence = ReturnType<typeof createPollPersistence>;
