// D1 adapter — poll repositories and batches. Implements the Polls module's
// persistence port over the DB binding (AD-1: adapters implement ports and
// never call delivery code). Only Polls-module commands write these tables
// (AD-19).

import {
  DuplicatePollIdError,
  ReferenceTakenError,
  type PollPersistenceRows,
  type PollLifecycleSnapshot,
  type ValidatedPollDefinition,
} from "../../modules/polls/index";
import type {
  ResultsAccessEnvelope,
  ResultsTallyProjection,
  VersionedResultsTallyProjection,
} from "../../modules/results/index";
import {
  AlreadyVotedError,
  asVoterClaimDigest,
  isVoterClaimCheckKind,
  PollClosedError,
  PollDefinitionChangedError,
  PollGoneError,
  SubmissionReplayError,
  type StoredVoteOutcome,
  type VotePersistenceBatch,
  type VoteSelectionContribution,
  type VoterClaimCheckKind,
  type VoterClaimContribution,
  type VoterClaimDigest,
  type VotingPollSnapshot,
} from "../../modules/voting/index";
import type { RepresentationVersionIncrement } from "../../shared/application/index";
import type {
  PollId,
  PollOptionId,
  PollSecurityToggles,
  PollType,
  ResultVisibility,
  UserId,
} from "../../shared/domain/index";

export type PollPage = {
  pollId: PollId;
  canonicalReference: string;
  question: string;
  description: string | null;
  pollType: PollType;
  resultVisibility: ResultVisibility;
  multiSelectEnabled: boolean;
  minSelections: number | null;
  maxSelections: number | null;
  sessionChecksEnabled: boolean;
  ipChecksEnabled: boolean;
  voterCodesEnabled: boolean;
  captchaEnabled: boolean;
  vpnBlockingEnabled: boolean;
  deadlineMs: number | null;
  closedAtMs: number | null;
  options: { id: PollOptionId; label: string; position: number }[];
};

export type OwnedPoll = PollPage & {
  canonicalReferenceKind: PollPersistenceRows["reference"]["kind"];
  createdAtMs: number;
};

/** Dashboard list row — no options, no reference join (Story 1.11). */
export type OwnerPollListItem = {
  pollId: PollId;
  question: string;
  pollType: PollType;
  deadlineMs: number | null;
  closedAtMs: number | null;
  createdAtMs: number;
  /** Distinct accepted Vote rows for this poll (voters, not selections). */
  voterCount: number;
};

type PollRow = {
  id: PollId;
  canonical_reference: string;
  question: string;
  description: string | null;
  poll_type: PollType;
  result_visibility: ResultVisibility;
  multi_select_enabled: number;
  min_selections: number | null;
  max_selections: number | null;
  session_checks_enabled: number;
  ip_checks_enabled: number;
  voter_codes_enabled: number;
  captcha_enabled: number;
  vpn_blocking_enabled: number;
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
    canonicalReference: row.canonical_reference,
    question: row.question,
    description: row.description,
    pollType: row.poll_type,
    resultVisibility: row.result_visibility,
    multiSelectEnabled: row.multi_select_enabled === 1,
    minSelections: row.min_selections,
    maxSelections: row.max_selections,
    sessionChecksEnabled: row.session_checks_enabled === 1,
    ipChecksEnabled: row.ip_checks_enabled === 1,
    voterCodesEnabled: row.voter_codes_enabled === 1,
    captchaEnabled: row.captcha_enabled === 1,
    vpnBlockingEnabled: row.vpn_blocking_enabled === 1,
    deadlineMs: row.deadline_ms,
    closedAtMs: row.closed_at_ms,
    options,
  };
}

function versionForPoll(
  pollId: PollId,
  version: RepresentationVersionIncrement,
): RepresentationVersionIncrement {
  if (version.pollId !== pollId) {
    throw new Error("Representation-version Poll mismatch");
  }
  return version;
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
              "INSERT INTO poll (id, owner_user_id, poll_type, question, description, result_visibility, discovery_state, session_checks_enabled, ip_checks_enabled, voter_codes_enabled, captcha_enabled, vpn_blocking_enabled, multi_select_enabled, min_selections, max_selections, deadline_ms, representation_version, created_at_ms, updated_at_ms) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?18)",
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
              poll.ipChecksEnabled ? 1 : 0,
              poll.voterCodesEnabled ? 1 : 0,
              poll.captchaEnabled ? 1 : 0,
              poll.vpnBlockingEnabled ? 1 : 0,
              poll.multiSelectEnabled ? 1 : 0,
              poll.minSelections,
              poll.maxSelections,
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

    // Resolve the exact requested reference (including a retained alias) while
    // projecting the Poll's unique canonical reference for every outward URL.
    async findPollByReference(reference: string): Promise<PollPage | null> {
      const row = await db
        .prepare(
          "SELECT p.id, p.question, p.description, p.poll_type, p.result_visibility, p.multi_select_enabled, p.min_selections, p.max_selections, p.session_checks_enabled, p.ip_checks_enabled, p.voter_codes_enabled, p.captcha_enabled, p.vpn_blocking_enabled, p.deadline_ms, p.closed_at_ms, canonical.reference AS canonical_reference FROM poll_reference requested JOIN poll p ON p.id = requested.poll_id JOIN poll_reference canonical ON canonical.poll_id = p.id AND canonical.is_canonical = 1 WHERE requested.reference = ?1",
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
          "SELECT p.id, p.question, p.description, p.poll_type, p.result_visibility, p.multi_select_enabled, p.min_selections, p.max_selections, p.session_checks_enabled, p.ip_checks_enabled, p.voter_codes_enabled, p.captcha_enabled, p.vpn_blocking_enabled, p.deadline_ms, p.closed_at_ms, p.created_at_ms, r.reference AS canonical_reference, r.kind AS canonical_reference_kind FROM poll p JOIN poll_reference r ON r.poll_id = p.id AND r.is_canonical = 1 WHERE p.id = ?1 AND p.owner_user_id = ?2",
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

    // Creator dashboard list (Story 1.11): one owner-driven statement, no
    // N+1. The correlated count probes vote_poll_id_idx only for the owner's
    // polls; COUNT(*) counts vote rows (voters). Sort encodes the same
    // effective-closed predicate as effectivePollStatus (AD-11) with a bound
    // nowMs — never Date.now() inside the adapter.
    async listPollsForOwner(
      ownerUserId: UserId,
      nowMs: number,
    ): Promise<OwnerPollListItem[]> {
      const result = await db
        .prepare(
          `SELECT p.id, p.question, p.poll_type, p.deadline_ms, p.closed_at_ms, p.created_at_ms,
                  (
                    SELECT COUNT(*)
                    FROM vote AS v INDEXED BY vote_poll_id_idx
                    WHERE v.poll_id = p.id
                  ) AS voter_count
           FROM poll p
           WHERE p.owner_user_id = ?1
           ORDER BY (
             p.closed_at_ms IS NOT NULL
             OR (p.deadline_ms IS NOT NULL AND p.deadline_ms <= ?2)
           ) ASC,
           p.created_at_ms DESC`,
        )
        .bind(ownerUserId, nowMs)
        .all<{
          id: PollId;
          question: string;
          poll_type: PollType;
          deadline_ms: number | null;
          closed_at_ms: number | null;
          created_at_ms: number;
          voter_count: number;
        }>();

      return result.results.map((row) => ({
        pollId: row.id,
        question: row.question,
        pollType: row.poll_type,
        deadlineMs: row.deadline_ms,
        closedAtMs: row.closed_at_ms,
        createdAtMs: row.created_at_ms,
        voterCount: row.voter_count,
      }));
    },

    // Lifecycle load (Story 1.12): owner-qualified snapshot with vote count
    // for presentation and definition/description/close/delete commands.
    async loadLifecycleForOwner(
      pollId: PollId,
      ownerUserId: UserId,
    ): Promise<PollLifecycleSnapshot | null> {
      const rows = await db
        .prepare(
          `SELECT p.id, p.owner_user_id, p.poll_type, p.question, p.description,
                  p.multi_select_enabled, p.min_selections, p.max_selections,
                  p.session_checks_enabled, p.ip_checks_enabled,
                  p.voter_codes_enabled, p.captcha_enabled, p.vpn_blocking_enabled,
                  p.deadline_ms, p.closed_at_ms, p.representation_version,
                  (
                    SELECT COUNT(*)
                    FROM vote AS v INDEXED BY vote_poll_id_idx
                    WHERE v.poll_id = p.id
                  ) AS voter_count,
                  po.id AS option_id, po.label AS option_label,
                  po.position AS option_position
           FROM poll p
           LEFT JOIN poll_option po ON po.poll_id = p.id
           WHERE p.id = ?1 AND p.owner_user_id = ?2
           ORDER BY po.position`,
        )
        .bind(pollId, ownerUserId)
        .all<{
          id: PollId;
          owner_user_id: UserId;
          poll_type: PollType;
          question: string;
          description: string | null;
          multi_select_enabled: number;
          min_selections: number | null;
          max_selections: number | null;
          session_checks_enabled: number;
          ip_checks_enabled: number;
          voter_codes_enabled: number;
          captcha_enabled: number;
          vpn_blocking_enabled: number;
          deadline_ms: number | null;
          closed_at_ms: number | null;
          representation_version: number;
          voter_count: number;
          option_id: PollOptionId | null;
          option_label: string | null;
          option_position: number | null;
        }>();
      const row = rows.results[0];
      if (!row) {
        return null;
      }
      return {
        pollId: row.id,
        ownerUserId: row.owner_user_id,
        pollType: row.poll_type,
        question: row.question,
        description: row.description,
        multiSelectEnabled: row.multi_select_enabled === 1,
        minSelections: row.min_selections,
        maxSelections: row.max_selections,
        sessionChecksEnabled: row.session_checks_enabled === 1,
        ipChecksEnabled: row.ip_checks_enabled === 1,
        voterCodesEnabled: row.voter_codes_enabled === 1,
        captchaEnabled: row.captcha_enabled === 1,
        vpnBlockingEnabled: row.vpn_blocking_enabled === 1,
        options: rows.results.flatMap((option) =>
          option.option_id !== null &&
          option.option_label !== null &&
          option.option_position !== null
            ? [
                {
                  id: option.option_id,
                  label: option.option_label,
                  position: option.option_position,
                },
              ]
            : [],
        ),
        deadlineMs: row.deadline_ms,
        closedAtMs: row.closed_at_ms,
        representationVersion: row.representation_version,
        voterCount: row.voter_count,
      };
    },

    // Manual close: one owner + effective-open guarded UPDATE that coalesces
    // closed_at_ms, updated_at_ms, and representation_version (AD-24).
    async closePollForOwner(input: {
      pollId: PollId;
      ownerUserId: UserId;
      version: RepresentationVersionIncrement;
    }): Promise<"closed" | "already_closed" | "not_found"> {
      const version = versionForPoll(input.pollId, input.version);
      const result = await db
        .prepare(
          `UPDATE poll
           SET closed_at_ms = ?3,
               updated_at_ms = ?3,
               representation_version = representation_version + 1
           WHERE id = ?1
             AND owner_user_id = ?2
             AND closed_at_ms IS NULL
             AND (deadline_ms IS NULL OR deadline_ms > ?3)`,
        )
        .bind(version.pollId, input.ownerUserId, version.updatedAtMs)
        .run();
      if ((result.meta.changes ?? 0) === 1) {
        return "closed";
      }
      const existing = await this.loadLifecycleForOwner(
        input.pollId,
        input.ownerUserId,
      );
      if (!existing) {
        return "not_found";
      }
      return "already_closed";
    },

    // Description-only edit: one owner-qualified statement when the value
    // actually changes (command pre-checks no-op before calling).
    async updateDescriptionForOwner(input: {
      pollId: PollId;
      ownerUserId: UserId;
      description: string | null;
      version: RepresentationVersionIncrement;
    }): Promise<"updated" | "unchanged" | "not_found"> {
      const version = versionForPoll(input.pollId, input.version);
      const result = await db
        .prepare(
          `UPDATE poll
           SET description = ?3,
               updated_at_ms = ?4,
               representation_version = representation_version + 1
           WHERE id = ?1
             AND owner_user_id = ?2
             AND description IS NOT ?3`,
        )
        .bind(
          version.pollId,
          input.ownerUserId,
          input.description,
          version.updatedAtMs,
        )
        .run();
      if ((result.meta.changes ?? 0) === 1) {
        return "updated";
      }
      const existing = await this.loadLifecycleForOwner(
        input.pollId,
        input.ownerUserId,
      );
      if (!existing) {
        return "not_found";
      }
      if (existing.description === input.description) {
        return "unchanged";
      }
      throw new Error("Description update guard changed no row");
    },

    // Full definition replacement: every mutating statement carries the same
    // owner + no-accepted-Vote guard so a Vote race cannot delete options
    // after a zero-row parent update (AD-17).
    async updateDefinitionForOwner(input: {
      pollId: PollId;
      ownerUserId: UserId;
      definition: ValidatedPollDefinition;
      options: { id: PollOptionId; label: string; position: number }[];
      expectedRepresentationVersion: number;
      version: RepresentationVersionIncrement;
    }): Promise<
      "updated" | "locked" | "conflict" | "unsupported" | "not_found"
    > {
      const version = versionForPoll(input.pollId, input.version);
      // Child replacement runs before the parent version increment. Every
      // statement compares the expected version, owner, Poll Type, and no-Vote
      // state inside one atomic D1 batch. A stale editor or winning Vote makes
      // the complete batch inert; a later parent failure rolls children back.
      const noVoteGuard =
        "NOT EXISTS (SELECT 1 FROM vote v WHERE v.poll_id = poll.id)";
      const statements: D1PreparedStatement[] = [
        db
          .prepare(
            `DELETE FROM poll_option
             WHERE poll_id = ?1
               AND EXISTS (
                 SELECT 1 FROM poll
                 WHERE poll.id = ?1
                   AND poll.owner_user_id = ?2
                   AND poll.poll_type = 'multiple_choice'
                   AND poll.representation_version = ?3
                   AND ${noVoteGuard}
               )`,
          )
          .bind(
            version.pollId,
            input.ownerUserId,
            input.expectedRepresentationVersion,
          ),
        ...input.options.map((option) =>
          db
            .prepare(
              `INSERT INTO poll_option (id, poll_id, label, position, created_at_ms)
               SELECT ?4, poll.id, ?5, ?6, ?7
               FROM poll
               WHERE poll.id = ?1
                 AND poll.owner_user_id = ?2
                 AND poll.poll_type = 'multiple_choice'
                 AND poll.representation_version = ?3
                 AND ${noVoteGuard}`,
            )
            .bind(
              version.pollId,
              input.ownerUserId,
              input.expectedRepresentationVersion,
              option.id,
              option.label,
              option.position,
              version.updatedAtMs,
            ),
        ),
        db
          .prepare(
            `UPDATE poll
             SET question = ?4,
                 description = ?5,
                 multi_select_enabled = ?6,
                 min_selections = ?7,
                 max_selections = ?8,
                 updated_at_ms = ?9,
                 representation_version = representation_version + 1
             WHERE id = ?1
               AND owner_user_id = ?2
               AND poll_type = 'multiple_choice'
               AND representation_version = ?3
               AND ${noVoteGuard}`,
          )
          .bind(
            version.pollId,
            input.ownerUserId,
            input.expectedRepresentationVersion,
            input.definition.question,
            input.definition.description,
            input.definition.multiSelect ? 1 : 0,
            input.definition.minSelections,
            input.definition.maxSelections,
            version.updatedAtMs,
          ),
      ];

      const batch = await db.batch(statements);
      const parentChanges = batch.at(-1)?.meta.changes ?? 0;
      if (parentChanges === 1) {
        return "updated";
      }
      const existing = await this.loadLifecycleForOwner(
        input.pollId,
        input.ownerUserId,
      );
      if (!existing) {
        return "not_found";
      }
      if (existing.pollType !== "multiple_choice") {
        return "unsupported";
      }
      if (existing.voterCount > 0) {
        return "locked";
      }
      return "conflict";
    },

    // Hard delete: single owner-qualified DELETE; FK cascades remove children.
    async deletePollForOwner(input: {
      pollId: PollId;
      ownerUserId: UserId;
    }): Promise<"deleted" | "not_found"> {
      const [result] = await db.batch([
        db
          .prepare("DELETE FROM poll WHERE id = ?1 AND owner_user_id = ?2")
          .bind(input.pollId, input.ownerUserId),
      ]);
      if ((result?.meta.changes ?? 0) >= 1) {
        return "deleted";
      }
      return "not_found";
    },

    // Security Toggles (Story 2.1): owner-qualified UPDATE with a race-free
    // tighten-only guard — current column <= requested for every toggle when
    // any Vote exists, so a Vote landing between advisory pre-check and write
    // cannot loosen a protection (AD-17).
    async updateSecurityTogglesForOwner(input: {
      pollId: PollId;
      ownerUserId: UserId;
      toggles: PollSecurityToggles;
      version: RepresentationVersionIncrement;
    }): Promise<"updated" | "unchanged" | "locked" | "not_found"> {
      const version = versionForPoll(input.pollId, input.version);
      const session = input.toggles.sessionChecks ? 1 : 0;
      const ip = input.toggles.ipChecks ? 1 : 0;
      const codes = input.toggles.voterCodes ? 1 : 0;
      const captcha = input.toggles.captcha ? 1 : 0;
      const vpn = input.toggles.vpnBlocking ? 1 : 0;
      const result = await db
        .prepare(
          `UPDATE poll
           SET session_checks_enabled = ?3,
               ip_checks_enabled = ?4,
               voter_codes_enabled = ?5,
               captcha_enabled = ?6,
               vpn_blocking_enabled = ?7,
               updated_at_ms = ?8,
               representation_version = representation_version + 1
           WHERE id = ?1
             AND owner_user_id = ?2
             AND (
               NOT EXISTS (SELECT 1 FROM vote v WHERE v.poll_id = poll.id)
               OR (
                 session_checks_enabled <= ?3
                 AND ip_checks_enabled <= ?4
                 AND voter_codes_enabled <= ?5
                 AND captcha_enabled <= ?6
                 AND vpn_blocking_enabled <= ?7
               )
             )
             AND (
               session_checks_enabled IS NOT ?3
               OR ip_checks_enabled IS NOT ?4
               OR voter_codes_enabled IS NOT ?5
               OR captcha_enabled IS NOT ?6
               OR vpn_blocking_enabled IS NOT ?7
             )`,
        )
        .bind(
          version.pollId,
          input.ownerUserId,
          session,
          ip,
          codes,
          captcha,
          vpn,
          version.updatedAtMs,
        )
        .run();
      if ((result.meta.changes ?? 0) === 1) {
        return "updated";
      }
      const existing = await this.loadLifecycleForOwner(
        input.pollId,
        input.ownerUserId,
      );
      if (!existing) {
        return "not_found";
      }
      if (
        existing.sessionChecksEnabled === input.toggles.sessionChecks &&
        existing.ipChecksEnabled === input.toggles.ipChecks &&
        existing.voterCodesEnabled === input.toggles.voterCodes &&
        existing.captchaEnabled === input.toggles.captcha &&
        existing.vpnBlockingEnabled === input.toggles.vpnBlocking
      ) {
        return "unchanged";
      }
      if (existing.voterCount > 0) {
        if (
          (existing.sessionChecksEnabled && !input.toggles.sessionChecks) ||
          (existing.ipChecksEnabled && !input.toggles.ipChecks) ||
          (existing.voterCodesEnabled && !input.toggles.voterCodes) ||
          (existing.captchaEnabled && !input.toggles.captcha) ||
          (existing.vpnBlockingEnabled && !input.toggles.vpnBlocking)
        ) {
          return "locked";
        }
      }
      throw new Error("Security toggle update guard changed no row");
    },
  };
}

export function createVotePersistence(db: D1Database) {
  return {
    async insertVote(batch: VotePersistenceBatch): Promise<void> {
      // Validate and sanitize the complete contribution set before touching
      // D1. A malformed claim anywhere in the batch must cause zero
      // prepare/bind/batch calls, including when it follows valid facts.
      const contributions: Array<
        VoteSelectionContribution | VoterClaimContribution
      > = batch.contributions.map((contribution) => {
        if (contribution.kind === "vote_selection") {
          return contribution;
        }
        if (contribution.kind === "voter_claim") {
          const digest = asVoterClaimDigest(contribution.digest);
          if (
            digest === null ||
            !isVoterClaimCheckKind(contribution.checkKind)
          ) {
            throw new Error("invalid voter claim digest");
          }
          return {
            ...contribution,
            checkKind: contribution.checkKind,
            digest,
          };
        }
        throw new Error(
          `Unsupported vote contribution kind: ${contribution.kind}`,
        );
      });

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

      for (const contribution of contributions) {
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
          // Classify the already-decided constraint failure. Session-first
          // dual-collision precedence; do not guess when no candidate exists.
          const submittedClaims = contributions.filter(
            (contribution): contribution is VoterClaimContribution =>
              contribution.kind === "voter_claim",
          );
          const ordered = [...submittedClaims].sort((left, right) => {
            if (left.checkKind === right.checkKind) {
              return 0;
            }
            return left.checkKind === "session" ? -1 : 1;
          });
          try {
            for (const claim of ordered) {
              const row = await db
                .prepare(
                  "SELECT 1 AS found FROM voter_claim WHERE poll_id = ?1 AND check_kind = ?2 AND digest = ?3",
                )
                .bind(claim.pollId, claim.checkKind, claim.digest)
                .first<{ found: number }>();
              if (row?.found === 1) {
                throw new AlreadyVotedError(claim.checkKind);
              }
            }
          } catch (classificationError) {
            if (classificationError instanceof AlreadyVotedError) {
              throw classificationError;
            }
            // Adjudication read failed — generic safe failure, not a guess.
            throw new Error("voter claim collision could not be classified");
          }
          throw new Error("voter claim collision without confirmed candidate");
        }
        if (error instanceof Error && /poll_closed/.test(error.message)) {
          throw new PollClosedError();
        }
        if (
          error instanceof Error &&
          /FOREIGN KEY constraint failed/i.test(error.message)
        ) {
          // Distinguish deleted Poll vs edited options (Story 1.12). Re-read
          // the Poll and selected option reachability before classifying.
          const pollStillExists = await db
            .prepare("SELECT 1 AS found FROM poll WHERE id = ?1")
            .bind(batch.vote.pollId)
            .first<{ found: number }>();
          if (!pollStillExists) {
            throw new PollGoneError();
          }
          const selectedOptionIds = contributions
            .filter(
              (contribution): contribution is {
                kind: "vote_selection";
                voteId: string;
                pollOptionId: PollOptionId;
              } => contribution.kind === "vote_selection",
            )
            .map((contribution) => contribution.pollOptionId);
          if (selectedOptionIds.length > 0) {
            const placeholders = selectedOptionIds
              .map((_, index) => `?${index + 2}`)
              .join(", ");
            const reachable = await db
              .prepare(
                `SELECT COUNT(*) AS count FROM poll_option
                 WHERE poll_id = ?1 AND id IN (${placeholders})`,
              )
              .bind(batch.vote.pollId, ...selectedOptionIds)
              .first<{ count: number }>();
            if ((reachable?.count ?? 0) !== selectedOptionIds.length) {
              throw new PollDefinitionChangedError();
            }
          }
          // Unrelated malformed-state FK — keep generic for the command layer.
          throw new PollGoneError();
        }
        throw error;
      }
    },

    async optionsStillReachable(
      pollId: PollId,
      optionIds: readonly PollOptionId[],
    ): Promise<boolean> {
      if (optionIds.length === 0) {
        return true;
      }
      const placeholders = optionIds.map((_, index) => `?${index + 2}`).join(", ");
      const reachable = await db
        .prepare(
          `SELECT COUNT(*) AS count FROM poll_option
           WHERE poll_id = ?1 AND id IN (${placeholders})`,
        )
        .bind(pollId, ...optionIds)
        .first<{ count: number }>();
      return (reachable?.count ?? 0) === optionIds.length;
    },

    async findPoll(pollId: PollId): Promise<VotingPollSnapshot | null> {
      const row = await db
        .prepare(
          "SELECT id, poll_type, session_checks_enabled, ip_checks_enabled, captcha_enabled, multi_select_enabled, min_selections, max_selections, deadline_ms, closed_at_ms FROM poll WHERE id = ?1",
        )
        .bind(pollId)
        .first<{
          id: PollId;
          poll_type: PollType;
          session_checks_enabled: number;
          ip_checks_enabled: number;
          captcha_enabled: number;
          multi_select_enabled: number;
          min_selections: number | null;
          max_selections: number | null;
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
        ipChecksEnabled: row.ip_checks_enabled === 1,
        captchaEnabled: row.captcha_enabled === 1,
        multiSelectEnabled: row.multi_select_enabled === 1,
        minSelections: row.min_selections,
        maxSelections: row.max_selections,
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
      checkKind: VoterClaimCheckKind,
      digest: VoterClaimDigest,
    ): Promise<boolean> {
      if (!isVoterClaimCheckKind(checkKind)) {
        return false;
      }
      const validated = asVoterClaimDigest(digest);
      if (validated === null) {
        return false;
      }
      const row = await db
        .prepare(
          "SELECT 1 AS found FROM voter_claim WHERE poll_id = ?1 AND check_kind = ?2 AND digest = ?3",
        )
        .bind(pollId, checkKind, validated)
        .first<{ found: number }>();
      return row?.found === 1;
    },

    // Read-only states mark the voter's own cast selection: resolve the
    // claim to its vote, then to that vote's selected options.
    async findVoteSelectionByClaim(
      pollId: PollId,
      checkKind: VoterClaimCheckKind,
      digest: VoterClaimDigest,
    ): Promise<PollOptionId[]> {
      if (!isVoterClaimCheckKind(checkKind)) {
        return [];
      }
      const validated = asVoterClaimDigest(digest);
      if (validated === null) {
        return [];
      }
      const rows = await db
        .prepare(
          "SELECT vs.poll_option_id AS poll_option_id FROM voter_claim vc JOIN vote_selection vs ON vs.vote_id = vc.vote_id WHERE vc.poll_id = ?1 AND vc.check_kind = ?2 AND vc.digest = ?3",
        )
        .bind(pollId, checkKind, validated)
        .all<{ poll_option_id: PollOptionId }>();
      return rows.results.map((row) => row.poll_option_id);
    },
  };
}

export type PollPersistence = ReturnType<typeof createPollPersistence>;
export type VotePersistence = ReturnType<typeof createVotePersistence>;

// Results reads (AD-9, AD-21): the access envelope resolves entitlement with
// no result-shape fields, and the private tally projection runs only after
// the Results module has authorized a `visible` outcome. The adapter stays
// unaware of request context — the inbound caller sets
// `requestContext.pollId` itself once a real Poll resolves.
export function createResultsPersistence(db: D1Database) {
  return {
    // Safe access read: resolves the exact requested reference, then joins the
    // Poll's separate canonical row for outward links. It reads only the Poll
    // metadata the hidden shapes need. It must NOT read options or
    // join/aggregate vote/vote_selection — hidden responses leak nothing
    // about the result's shape.
    async findAccessEnvelope(
      reference: string,
    ): Promise<ResultsAccessEnvelope | null> {
      const row = await db
        .prepare(
          "SELECT p.id, p.question, p.result_visibility, p.owner_user_id, p.deadline_ms, p.closed_at_ms, p.multi_select_enabled, canonical.reference AS canonical_reference FROM poll_reference requested JOIN poll p ON p.id = requested.poll_id JOIN poll_reference canonical ON canonical.poll_id = p.id AND canonical.is_canonical = 1 WHERE requested.reference = ?1",
        )
        .bind(reference)
        .first<{
          id: PollId;
          question: string;
          result_visibility: ResultVisibility;
          owner_user_id: UserId;
          deadline_ms: number | null;
          closed_at_ms: number | null;
          multi_select_enabled: number;
          canonical_reference: string;
        }>();
      if (!row) {
        return null;
      }
      return {
        pollId: row.id,
        question: row.question,
        resultVisibility: row.result_visibility,
        ownerUserId: row.owner_user_id,
        deadlineMs: row.deadline_ms,
        closedAtMs: row.closed_at_ms,
        multiSelectEnabled: row.multi_select_enabled === 1,
        canonicalReference: row.canonical_reference,
      };
    },

    // Cheap conditional path after Results authorization. The access envelope
    // intentionally does not carry this value (AD-21/AR-17).
    async readRepresentationVersion(pollId: PollId): Promise<number | null> {
      const row = await db
        .prepare(
          "SELECT representation_version FROM poll WHERE id = ?1",
        )
        .bind(pollId)
        .first<{ representation_version: number }>();
      if (!row) {
        return null;
      }
      if (
        !Number.isSafeInteger(row.representation_version) ||
        row.representation_version < 1
      ) {
        throw new Error("Malformed representation version");
      }
      return row.representation_version;
    },

    // The one accepted-fact Tally projection (AD-9, NFR-6): body counts and
    // representation_version come from this same statement/snapshot, so a
    // concurrent Vote can never give an older Tally a newer validator.
    async projectVersionedTally(
      pollId: PollId,
    ): Promise<VersionedResultsTallyProjection | null> {
      const rows = await db
        .prepare(
          `WITH target_votes AS MATERIALIZED (
             SELECT id FROM vote WHERE poll_id = ?1
           ),
           valid_selections AS MATERIALIZED (
             SELECT vs.poll_option_id
             FROM target_votes tv
             JOIN vote_selection vs ON vs.vote_id = tv.id
             JOIN poll_option selected_option
               ON selected_option.id = vs.poll_option_id
              AND selected_option.poll_id = ?1
           ),
           option_counts AS (
             SELECT poll_option_id, COUNT(*) AS option_count
             FROM valid_selections
             GROUP BY poll_option_id
           ),
           totals AS (
             SELECT
               (SELECT COUNT(*) FROM target_votes) AS voter_count,
               (SELECT COUNT(*) FROM valid_selections) AS selection_count
           )
           SELECT po.id AS id, po.label AS label, po.position AS position,
             COALESCE(oc.option_count, 0) AS option_count,
             totals.voter_count AS voter_count,
             totals.selection_count AS selection_count,
             p.representation_version AS representation_version
           FROM poll p
           CROSS JOIN totals
           LEFT JOIN poll_option po ON po.poll_id = p.id
           LEFT JOIN option_counts oc ON oc.poll_option_id = po.id
           WHERE p.id = ?1
           ORDER BY po.position`,
        )
        .bind(pollId)
        .all<{
          id: PollOptionId | null;
          label: string | null;
          position: number | null;
          option_count: number;
          voter_count: number;
          selection_count: number;
          representation_version: number;
        }>();

      // Fail closed on malformed rows: a misleading percentage or validator
      // is worse than an error. Counts are finite non-negative integers and
      // the monotonic version is a positive safe integer.
      const toCount = (value: number, column: string): number => {
        if (!Number.isSafeInteger(value) || value < 0) {
          throw new Error(`Malformed tally row: ${column} is ${value}`);
        }
        return value;
      };

      const first = rows.results[0];
      if (!first) {
        return null;
      }
      if (
        !Number.isSafeInteger(first.representation_version) ||
        first.representation_version < 1 ||
        rows.results.some(
          (row) => row.representation_version !== first.representation_version,
        )
      ) {
        throw new Error("Malformed representation version");
      }
      if (first.id === null) {
        throw new Error(
          "Malformed tally projection: resolved Poll has no options",
        );
      }

      const options = rows.results.map((row) => {
        if (
          row.id === null ||
          row.label === null ||
          row.position === null ||
          !Number.isSafeInteger(row.position) ||
          row.position < 0
        ) {
          throw new Error("Malformed tally projection: invalid option row");
        }
        return {
          id: row.id,
          label: row.label,
          position: row.position,
          count: toCount(row.option_count, "option_count"),
        };
      });
      const voterCount = toCount(first.voter_count, "voter_count");
      const selectionCount = toCount(first.selection_count, "selection_count");
      if (selectionCount < voterCount) {
        throw new Error(
          "Malformed tally projection: fewer selections than Voters",
        );
      }
      const optionCountTotal = options.reduce(
        (total, option) => total + option.count,
        0,
      );
      if (
        !Number.isSafeInteger(optionCountTotal) ||
        optionCountTotal !== selectionCount
      ) {
        throw new Error(
          "Malformed tally projection: option counts do not match selections",
        );
      }
      if (options.some((option) => option.count > voterCount)) {
        throw new Error(
          "Malformed tally projection: option count exceeds Voters",
        );
      }
      return {
        representationVersion: first.representation_version,
        options,
        voterCount,
        selectionCount,
      };
    },

    // Full-page Results consumes the exact same SQL projection and simply
    // drops the live-only version after the adapter has validated it.
    async projectTally(pollId: PollId): Promise<ResultsTallyProjection> {
      const projection = await this.projectVersionedTally(pollId);
      if (!projection) {
        return { options: [], voterCount: 0, selectionCount: 0 };
      }
      const { representationVersion: _representationVersion, ...tally } =
        projection;
      return tally;
    },
  };
}

export type ResultsPersistence = ReturnType<typeof createResultsPersistence>;
