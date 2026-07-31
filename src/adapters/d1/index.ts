// D1 adapter — poll repositories and batches. Implements the Polls module's
// persistence port over the DB binding (AD-1: adapters implement ports and
// never call delivery code). Only Polls-module commands write these tables
// (AD-19).

import {
  DuplicatePollIdError,
  ReferenceTakenError,
  type PollPersistenceRows,
} from "../../modules/polls/index";
import {
  AlreadyVotedError,
  PollClosedError,
  PollGoneError,
  SubmissionReplayError,
  type StoredVoteOutcome,
  type VotePersistenceBatch,
  type VotingPollSnapshot,
} from "../../modules/voting/index";
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
  canonicalReferenceKind: PollPersistenceRows["reference"]["kind"];
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
        // Poll-ID precedence preserves D4 dedupe when a replay collides on
        // both the Poll and reference rows. Reference uniqueness is the
        // authoritative Custom Link availability decision (AD-16).
        if (
          error instanceof Error &&
          /UNIQUE constraint failed: poll\.id/.test(error.message)
        ) {
          throw new DuplicatePollIdError(error.message);
        }
        if (
          error instanceof Error &&
          /UNIQUE constraint failed: poll_reference\.reference/.test(
            error.message,
          )
        ) {
          throw new ReferenceTakenError(error.message);
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

    // Case-variant resolution for custom links only (Story 1.4 review):
    // custom slugs are stored lowercase-folded ([a-z0-9-] by validation), so
    // an ASCII-only NOCASE match restricted to canonical kind='custom' rows
    // finds the canonical row for `/Team-Lunch`-style hits without ever
    // folding a case-sensitive base64url generated reference. The NOCASE
    // comparison can't use the BINARY primary key (a scan, tolerable on the
    // case-variant path only). The negated GLOB skips any out-of-band row
    // containing a non-slug byte; at most one all-lowercase form of a string
    // can exist under the BINARY primary key, so no ordering is needed.
    async findCanonicalCustomReference(
      reference: string,
    ): Promise<string | null> {
      const row = await db
        .prepare(
          "SELECT reference FROM poll_reference WHERE reference = ?1 COLLATE NOCASE AND kind = 'custom' AND is_canonical = 1 AND reference NOT GLOB '*[^a-z0-9-]*'",
        )
        .bind(reference)
        .first<{ reference: string }>();
      return row?.reference ?? null;
    },

    async findPollForOwner(
      pollId: PollId,
      ownerUserId: UserId,
    ): Promise<OwnedPoll | null> {
      const row = await db
        .prepare(
          "SELECT p.id, p.question, p.description, p.poll_type, p.result_visibility, p.deadline_ms, p.closed_at_ms, p.created_at_ms, r.reference AS canonical_reference, r.kind AS canonical_reference_kind FROM poll p JOIN poll_reference r ON r.poll_id = p.id AND r.is_canonical = 1 WHERE p.id = ?1 AND p.owner_user_id = ?2",
        )
        .bind(pollId, ownerUserId)
        .first<
          PollRow & {
            canonical_reference: string;
            canonical_reference_kind: PollPersistenceRows["reference"]["kind"];
            created_at_ms: number;
          }
        >();
      if (!row) {
        return null;
      }
      return {
        ...toPollPage(row, await loadOptions(db, row.id)),
        canonicalReference: row.canonical_reference,
        canonicalReferenceKind: row.canonical_reference_kind,
        createdAtMs: row.created_at_ms,
      };
    },
  };
}

export function createVotePersistence(db: D1Database) {
  return {
    async insertVote(batch: VotePersistenceBatch): Promise<void> {
      const statements: D1PreparedStatement[] = [
        db
          .prepare(
            "INSERT INTO vote (id, poll_id, submission_id, payload_hash, created_at_ms) VALUES (?1, ?2, ?3, ?4, ?5)",
          )
          .bind(
            batch.vote.id,
            batch.vote.pollId,
            batch.vote.submissionId,
            batch.vote.payloadHash,
            batch.vote.createdAtMs,
          ),
      ];

      for (const contribution of batch.contributions) {
        if (contribution.kind === "vote_selection") {
          statements.push(
            db
              .prepare(
                "INSERT INTO vote_selection (vote_id, poll_option_id) VALUES (?1, ?2)",
              )
              .bind(contribution.voteId, contribution.pollOptionId),
          );
          continue;
        }
        if (contribution.kind === "voter_claim") {
          statements.push(
            db
              .prepare(
                "INSERT INTO voter_claim (poll_id, check_kind, digest, vote_id, created_at_ms) VALUES (?1, ?2, ?3, ?4, ?5)",
              )
              .bind(
                contribution.pollId,
                contribution.checkKind,
                contribution.digest,
                contribution.voteId,
                contribution.createdAtMs,
              ),
          );
          continue;
        }
        throw new Error(`Unsupported vote contribution kind: ${contribution.kind}`);
      }

      statements.push(
        db
          .prepare(
            "UPDATE poll SET representation_version = representation_version + 1, updated_at_ms = ?2 WHERE id = ?1",
          )
          .bind(
            batch.representationVersion.pollId,
            batch.representationVersion.updatedAtMs,
          ),
      );

      try {
        await db.batch(statements);
      } catch (error) {
        if (
          error instanceof Error &&
          /UNIQUE constraint failed: vote\.poll_id, vote\.submission_id/.test(
            error.message,
          )
        ) {
          throw new SubmissionReplayError();
        }
        if (
          error instanceof Error &&
          /UNIQUE constraint failed: voter_claim\.poll_id, voter_claim\.check_kind, voter_claim\.digest/.test(
            error.message,
          )
        ) {
          throw new AlreadyVotedError();
        }
        if (error instanceof Error && /poll_closed/.test(error.message)) {
          throw new PollClosedError();
        }
        if (
          error instanceof Error &&
          /FOREIGN KEY constraint failed/i.test(error.message)
        ) {
          throw new PollGoneError();
        }
        throw error;
      }
    },

    async findPoll(pollId: PollId): Promise<VotingPollSnapshot | null> {
      const row = await db
        .prepare(
          "SELECT id, poll_type, session_checks_enabled, deadline_ms, closed_at_ms FROM poll WHERE id = ?1",
        )
        .bind(pollId)
        .first<{
          id: PollId;
          poll_type: PollType;
          session_checks_enabled: number;
          deadline_ms: number | null;
          closed_at_ms: number | null;
        }>();
      if (!row) {
        return null;
      }
      return {
        id: row.id,
        pollType: row.poll_type,
        options: await loadOptions(db, row.id),
        sessionChecksEnabled: row.session_checks_enabled === 1,
        deadlineMs: row.deadline_ms,
        closedAtMs: row.closed_at_ms,
      };
    },

    async findVoteBySubmission(
      pollId: PollId,
      submissionId: string,
    ): Promise<StoredVoteOutcome | null> {
      const row = await db
        .prepare(
          "SELECT id, payload_hash, created_at_ms FROM vote WHERE poll_id = ?1 AND submission_id = ?2",
        )
        .bind(pollId, submissionId)
        .first<{
          id: string;
          payload_hash: string;
          created_at_ms: number;
        }>();
      return row
        ? {
            voteId: row.id,
            payloadHash: row.payload_hash,
            createdAtMs: row.created_at_ms,
          }
        : null;
    },

    async findClaim(
      pollId: PollId,
      checkKind: "session" | "ip",
      digest: string,
    ): Promise<boolean> {
      const row = await db
        .prepare(
          "SELECT 1 AS found FROM voter_claim WHERE poll_id = ?1 AND check_kind = ?2 AND digest = ?3",
        )
        .bind(pollId, checkKind, digest)
        .first<{ found: number }>();
      return row?.found === 1;
    },

    // Read-only states mark the voter's own cast selection: resolve the
    // claim to its vote, then to that vote's selected options.
    async findVoteSelectionByClaim(
      pollId: PollId,
      checkKind: "session" | "ip",
      digest: string,
    ): Promise<PollOptionId[]> {
      const rows = await db
        .prepare(
          "SELECT vs.poll_option_id AS poll_option_id FROM voter_claim vc JOIN vote_selection vs ON vs.vote_id = vc.vote_id WHERE vc.poll_id = ?1 AND vc.check_kind = ?2 AND vc.digest = ?3",
        )
        .bind(pollId, checkKind, digest)
        .all<{ poll_option_id: PollOptionId }>();
      return rows.results.map((row) => row.poll_option_id);
    },
  };
}

export type PollPersistence = ReturnType<typeof createPollPersistence>;
export type VotePersistence = ReturnType<typeof createVotePersistence>;
