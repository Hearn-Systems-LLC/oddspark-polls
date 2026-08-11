// D1 adapter — poll repositories and batches. Implements the Polls module's
// persistence port over the DB binding (AD-1: adapters implement ports and
// never call delivery code). Only Polls-module commands write these tables
// (AD-19). Discovery-module commands own subsequent listing transitions.

import {
  DuplicatePollIdError,
  POLL_CAPS,
  ReferenceTakenError,
  isCanonicalCustomReference,
  type PollPersistenceRows,
  type PollLifecycleSnapshot,
  type ValidatedPollDefinition,
} from "../../modules/polls/index";
import type {
  AdministratorModerationIntent,
  DiscoveryCatalogRecord,
  DiscoveryCatalogRequest,
  DiscoveryOrderKey,
  DiscoverySitemapRecord,
  ModerationTargetRecord,
  ModerationPersistenceOutcome,
} from "../../modules/discovery/index";
import type {
  ResultsAccessEnvelope,
  BallotManifestRow,
  ResultsProjection,
  ResultsTallyProjection,
  VersionedRankedTallyProjection,
  VersionedResultsProjection,
  VersionedResultsTallyProjection,
} from "../../modules/results/index";
import { tabulateAndProjectRanked } from "../../modules/results/index";
import type {
  IrvBallot,
  IrvOptionSet,
} from "../../modules/results/tabulate-irv";
import type { ExportOwnerEnvelope } from "../../modules/results/export";
import {
  COMMENT_CAPS,
  isCommentId,
  isCommentTimestamp,
  type AdministratorCommentLoadOutcome,
  type CommentModerationPersistenceOutcome,
  type CommentResultsProjection,
  type CommentView,
  type OwnerCommentView,
  type VoteCommentContribution,
} from "../../modules/comments/index";
import {
  AlreadyVotedError,
  asVoterClaimDigest,
  asRevisionCapabilityDigest,
  CommentsDisabledError,
  isVoterClaimCheckKind,
  PollClosedError,
  PollDefinitionChangedError,
  PollGoneError,
  SubmissionReplayError,
  type StoredVoteOutcome,
  type RankedPreferenceContribution,
  type MeetingAvailabilityContribution,
  type MeetingResponseContribution,
  type ReviseMeetingResponseBatch,
  type StoredMeetingResponse,
  type RevisionCapabilityDigest,
  type VotePersistenceBatch,
  type VoteSelectionContribution,
  type VoterClaimCheckKind,
  type VoterClaimContribution,
  type VoterClaimDigest,
  type VotingPollSnapshot,
} from "../../modules/voting/index";
import type { RepresentationVersionIncrement } from "../../shared/application/index";
import type {
  DiscoveryState,
  CommentId,
  PollId,
  PollOptionId,
  PollSecurityToggles,
  PollType,
  ResultVisibility,
  UserId,
} from "../../shared/domain/index";
import {
  DISCOVERY_STATES,
  makeSecurityToggles,
  POLL_TYPES,
} from "../../shared/domain/index";
import type {
  CleanupOutboxRow,
  ReplaceOptionImagePersistenceInput,
} from "../../modules/media/index";

const DISCOVERY_CATALOG_COLUMNS = `p.id,
       pr.reference AS canonical_reference,
       p.question,
       p.poll_type,
       p.deadline_ms,
       p.created_at_ms,
       (
         SELECT COUNT(*)
         FROM vote AS v INDEXED BY vote_poll_id_idx
         WHERE v.poll_id = p.id
       ) AS vote_count`;

const DISCOVERY_SITEMAP_COLUMNS = `p.id,
       pr.reference AS canonical_reference,
       p.deadline_ms,
       p.created_at_ms`;

function discoveryNoDeadlineQuery(
  columns: string,
  direction: "newer" | "older",
): string {
  const comparison = direction === "newer" ? ">" : "<";
  const order = direction === "newer" ? "ASC" : "DESC";
  return `SELECT ${columns}
    FROM poll AS p INDEXED BY poll_discovery_no_deadline_idx
    JOIN poll_reference AS pr INDEXED BY poll_reference_canonical_idx
      ON pr.poll_id = p.id AND pr.is_canonical = 1
    WHERE p.discovery_state = 'listed'
      AND p.closed_at_ms IS NULL
      AND p.deadline_ms IS NULL
      AND ?1 >= 0
      AND (
        ?2 IS NULL
        OR p.created_at_ms ${comparison} ?2
        OR (p.created_at_ms = ?2 AND p.id ${comparison} ?3)
      )
    ORDER BY p.created_at_ms ${order}, p.id ${order}
    LIMIT ?4`;
}

function discoveryActiveDeadlineQuery(
  columns: string,
  direction: "newer" | "older",
): string {
  const comparison = direction === "newer" ? ">" : "<";
  const order = direction === "newer" ? "ASC" : "DESC";
  return `SELECT ${columns}
    FROM poll AS p INDEXED BY poll_discovery_active_deadline_idx
    JOIN poll_reference AS pr INDEXED BY poll_reference_canonical_idx
      ON pr.poll_id = p.id AND pr.is_canonical = 1
    WHERE p.discovery_state = 'listed'
      AND p.closed_at_ms IS NULL
      AND p.deadline_ms IS NOT NULL
      AND p.deadline_ms > ?1
      AND (
        ?2 IS NULL
        OR p.created_at_ms ${comparison} ?2
        OR (p.created_at_ms = ?2 AND p.id ${comparison} ?3)
      )
    ORDER BY p.created_at_ms ${order}, p.id ${order}
    LIMIT ?4`;
}

export const DISCOVERY_NO_DEADLINE_QUERY = discoveryNoDeadlineQuery(
  DISCOVERY_CATALOG_COLUMNS,
  "older",
);
export const DISCOVERY_ACTIVE_DEADLINE_QUERY = discoveryActiveDeadlineQuery(
  DISCOVERY_CATALOG_COLUMNS,
  "older",
);

const DISCOVERY_NO_DEADLINE_NEWER_QUERY = discoveryNoDeadlineQuery(
  DISCOVERY_CATALOG_COLUMNS,
  "newer",
);
const DISCOVERY_ACTIVE_DEADLINE_NEWER_QUERY = discoveryActiveDeadlineQuery(
  DISCOVERY_CATALOG_COLUMNS,
  "newer",
);

type DiscoverySitemapQueryBounds = "root" | "start" | "end" | "both";

function discoverySitemapQuery(
  deadline: "none" | "active",
  bounds: DiscoverySitemapQueryBounds,
): string {
  const deadlinePredicate =
    deadline === "none"
      ? "p.deadline_ms IS NULL"
      : "p.deadline_ms IS NOT NULL AND p.deadline_ms > ?1";
  const index =
    deadline === "none"
      ? "poll_discovery_no_deadline_idx"
      : "poll_discovery_active_deadline_idx";
  const startPredicate =
    bounds === "start" || bounds === "both"
      ? "AND (p.created_at_ms, p.id) < (?2, ?3)"
      : "";
  const endParameter = bounds === "both" ? 4 : 2;
  const endPredicate =
    bounds === "end" || bounds === "both"
      ? `AND (p.created_at_ms, p.id) >= (?${endParameter}, ?${endParameter + 1})`
      : "";
  const limitParameter =
    bounds === "both" ? 6 : bounds === "root" ? 2 : 4;
  return `SELECT ${DISCOVERY_SITEMAP_COLUMNS}
    FROM poll AS p INDEXED BY ${index}
    JOIN poll_reference AS pr INDEXED BY poll_reference_canonical_idx
      ON pr.poll_id = p.id AND pr.is_canonical = 1
    WHERE p.discovery_state = 'listed'
      AND p.closed_at_ms IS NULL
      AND ${deadlinePredicate}
      AND ?1 >= 0
      ${startPredicate}
      ${endPredicate}
    ORDER BY p.created_at_ms DESC, p.id DESC
    LIMIT ?${limitParameter}`;
}

export const DISCOVERY_SITEMAP_NO_DEADLINE_QUERY =
  discoverySitemapQuery("none", "both");
export const DISCOVERY_SITEMAP_ACTIVE_DEADLINE_QUERY =
  discoverySitemapQuery("active", "both");
const DISCOVERY_SITEMAP_NO_DEADLINE_ROOT_QUERY = discoverySitemapQuery(
  "none",
  "root",
);
const DISCOVERY_SITEMAP_ACTIVE_DEADLINE_ROOT_QUERY = discoverySitemapQuery(
  "active",
  "root",
);
const DISCOVERY_SITEMAP_NO_DEADLINE_START_QUERY = discoverySitemapQuery(
  "none",
  "start",
);
const DISCOVERY_SITEMAP_ACTIVE_DEADLINE_START_QUERY = discoverySitemapQuery(
  "active",
  "start",
);
const DISCOVERY_SITEMAP_NO_DEADLINE_END_QUERY = discoverySitemapQuery(
  "none",
  "end",
);
const DISCOVERY_SITEMAP_ACTIVE_DEADLINE_END_QUERY = discoverySitemapQuery(
  "active",
  "end",
);

export type PollOptionMedia = {
  mediaId: string;
  altText: string;
  caption: string | null;
};

export type PollPage = {
  pollId: PollId;
  canonicalReference: string;
  discoveryState: DiscoveryState;
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
  commentsEnabled: boolean;
  deadlineMs: number | null;
  closedAtMs: number | null;
  options: {
    id: PollOptionId;
    label: string;
    position: number;
    /** Adopted image plate (Story 6.2) — present only for image-poll
     * options; the LEFT JOIN keeps it absent for every other type. */
    media?: PollOptionMedia;
  }[];
  slots?: {
    id: string;
    startsAtMs: number;
    endsAtMs: number;
    timeZone: string;
    position: number;
  }[];
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
  discoveryState: DiscoveryState;
  deadlineMs: number | null;
  closedAtMs: number | null;
  createdAtMs: number;
  /** Distinct accepted Vote rows for this poll (voters, not selections). */
  voterCount: number;
};

type PollRow = {
  id: PollId;
  canonical_reference: string;
  discovery_state: DiscoveryState;
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
  comments_enabled: number;
  deadline_ms: number | null;
  closed_at_ms: number | null;
};

async function loadOptions(
  db: D1Database,
  pollId: PollId,
): Promise<PollPage["options"]> {
  // LEFT JOIN media_object: only image polls have rows (0014 guard
  // triggers enforce poll_type='image'), so every other type's media
  // columns come back NULL and the option carries no media field.
  const options = await db
    .prepare(
      `SELECT po.id AS id, po.label AS label, po.position AS position,
         mo.id AS media_id, mo.alt_text AS media_alt_text,
         mo.caption AS media_caption
       FROM poll_option po
       LEFT JOIN media_object mo ON mo.option_id = po.id
       WHERE po.poll_id = ?1
       ORDER BY po.position`,
    )
    .bind(pollId)
    .all<{
      id: PollOptionId;
      label: string;
      position: number;
      media_id: string | null;
      media_alt_text: string | null;
      media_caption: string | null;
    }>();
  return options.results.map((row) =>
    row.media_id === null || row.media_alt_text === null
      ? { id: row.id, label: row.label, position: row.position }
      : {
          id: row.id,
          label: row.label,
          position: row.position,
          media: {
            mediaId: row.media_id,
            altText: row.media_alt_text,
            caption: row.media_caption,
          },
        },
  );
}

async function loadMeetingSlots(
  db: D1Database,
  pollId: PollId,
): Promise<NonNullable<PollPage["slots"]>> {
  const rows = await db
    .prepare(
      "SELECT id, starts_at_ms, ends_at_ms, time_zone, position FROM meeting_slot WHERE poll_id = ?1 ORDER BY position",
    )
    .bind(pollId)
    .all<{
      id: string;
      starts_at_ms: number;
      ends_at_ms: number;
      time_zone: string;
      position: number;
    }>();
  return rows.results.map((row) => ({
    id: row.id,
    startsAtMs: row.starts_at_ms,
    endsAtMs: row.ends_at_ms,
    timeZone: row.time_zone,
    position: row.position,
  }));
}

function toPollPage(
  row: PollRow,
  options: PollPage["options"],
  slots: NonNullable<PollPage["slots"]>,
): PollPage {
  return {
    pollId: row.id,
    canonicalReference: row.canonical_reference,
    discoveryState: row.discovery_state,
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
    commentsEnabled: row.comments_enabled === 1,
    deadlineMs: row.deadline_ms,
    closedAtMs: row.closed_at_ms,
    options,
    ...(slots.length > 0 ? { slots } : {}),
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
      const { poll, options, reference, media, slots } = rows;
      try {
        await db.batch([
          db
            .prepare(
              "INSERT INTO poll (id, owner_user_id, poll_type, question, description, result_visibility, discovery_state, session_checks_enabled, ip_checks_enabled, voter_codes_enabled, captcha_enabled, vpn_blocking_enabled, comments_enabled, multi_select_enabled, min_selections, max_selections, deadline_ms, representation_version, created_at_ms, updated_at_ms) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?19)",
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
              poll.commentsEnabled ? 1 : 0,
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
          ...(media ?? []).map((m) =>
            db
              .prepare(
                "INSERT INTO media_object (id, poll_id, option_id, r2_key, content_type, size_bytes, alt_text, caption, created_at_ms) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
              )
              .bind(
                m.id,
                m.pollId,
                m.optionId,
                m.r2Key,
                m.contentType,
                m.sizeBytes,
                m.altText,
                m.caption,
                m.createdAtMs,
              ),
          ),
          ...(slots ?? []).map((slot) =>
            db
              .prepare(
                "INSERT INTO meeting_slot (id, poll_id, position, starts_at_ms, ends_at_ms, time_zone, created_at_ms) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
              )
              .bind(
                slot.id,
                slot.pollId,
                slot.position,
                slot.startsAtMs,
                slot.endsAtMs,
                slot.timeZone,
                slot.createdAtMs,
              ),
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
          "SELECT p.id, p.question, p.description, p.poll_type, p.result_visibility, p.discovery_state, p.multi_select_enabled, p.min_selections, p.max_selections, p.session_checks_enabled, p.ip_checks_enabled, p.voter_codes_enabled, p.captcha_enabled, p.vpn_blocking_enabled, p.comments_enabled, p.deadline_ms, p.closed_at_ms, canonical.reference AS canonical_reference FROM poll_reference requested JOIN poll p ON p.id = requested.poll_id JOIN poll_reference canonical ON canonical.poll_id = p.id AND canonical.is_canonical = 1 WHERE requested.reference = ?1",
        )
        .bind(reference)
        .first<PollRow>();
      if (!row) {
        return null;
      }
      const [options, slots] = await Promise.all([
        loadOptions(db, row.id),
        loadMeetingSlots(db, row.id),
      ]);
      return toPollPage(row, options, slots);
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
          "SELECT p.id, p.question, p.description, p.poll_type, p.result_visibility, p.discovery_state, p.multi_select_enabled, p.min_selections, p.max_selections, p.session_checks_enabled, p.ip_checks_enabled, p.voter_codes_enabled, p.captcha_enabled, p.vpn_blocking_enabled, p.comments_enabled, p.deadline_ms, p.closed_at_ms, p.created_at_ms, r.reference AS canonical_reference, r.kind AS canonical_reference_kind FROM poll p JOIN poll_reference r ON r.poll_id = p.id AND r.is_canonical = 1 WHERE p.id = ?1 AND p.owner_user_id = ?2",
        )
        .bind(pollId, ownerUserId)
        .first<
          PollRow & {
            canonical_reference: string;
            canonical_reference_kind: PollPersistenceRows["reference"]["kind"];
            discovery_state: DiscoveryState;
            created_at_ms: number;
          }
        >();
      if (!row) {
        return null;
      }
      const [options, slots] = await Promise.all([
        loadOptions(db, row.id),
        loadMeetingSlots(db, row.id),
      ]);
      return {
        ...toPollPage(row, options, slots),
        canonicalReference: row.canonical_reference as string,
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
          `SELECT p.id, p.question, p.poll_type, p.discovery_state, p.deadline_ms, p.closed_at_ms, p.created_at_ms,
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
          discovery_state: DiscoveryState;
          deadline_ms: number | null;
          closed_at_ms: number | null;
          created_at_ms: number;
          voter_count: number;
        }>();

      return result.results.map((row) => ({
        pollId: row.id,
        question: row.question,
        pollType: row.poll_type,
        discoveryState: row.discovery_state,
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
                  p.discovery_state,
                  p.multi_select_enabled, p.min_selections, p.max_selections,
                  p.session_checks_enabled, p.ip_checks_enabled,
                  p.voter_codes_enabled, p.captcha_enabled, p.vpn_blocking_enabled,
                  p.comments_enabled,
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
          discovery_state: DiscoveryState;
          multi_select_enabled: number;
          min_selections: number | null;
          max_selections: number | null;
          session_checks_enabled: number;
          ip_checks_enabled: number;
          voter_codes_enabled: number;
          captcha_enabled: number;
          vpn_blocking_enabled: number;
          comments_enabled: number;
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
        discoveryState: row.discovery_state,
        multiSelectEnabled: row.multi_select_enabled === 1,
        minSelections: row.min_selections,
        maxSelections: row.max_selections,
        sessionChecksEnabled: row.session_checks_enabled === 1,
        ipChecksEnabled: row.ip_checks_enabled === 1,
        voterCodesEnabled: row.voter_codes_enabled === 1,
        captchaEnabled: row.captcha_enabled === 1,
        vpnBlockingEnabled: row.vpn_blocking_enabled === 1,
        commentsEnabled: row.comments_enabled === 1,
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
      // Discovery revision triggers may add one same-transaction metadata
      // change; the guarded Poll UPDATE itself still proves success.
      if ((result.meta.changes ?? 0) >= 1) {
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

    async updateListingForOwner(input: {
      pollId: PollId;
      ownerUserId: UserId;
      state: Exclude<DiscoveryState, "delisted">;
      updatedAtMs: number;
    }): Promise<"updated" | "unchanged" | "delisted" | "not_found"> {
      // Listing is presentation, so AD-24 intentionally excludes a
      // representation_version increment from this guarded write.
      const result = await db
        .prepare(
          `UPDATE poll
           SET discovery_state = ?3,
               updated_at_ms = ?4
           WHERE id = ?1
             AND owner_user_id = ?2
             AND discovery_state != 'delisted'
             AND discovery_state != ?3`,
        )
        .bind(input.pollId, input.ownerUserId, input.state, input.updatedAtMs)
        .run();
      // A listing transition also bumps the Discovery cache generation.
      if ((result.meta.changes ?? 0) >= 1) {
        return "updated";
      }
      const existing = await this.loadLifecycleForOwner(
        input.pollId,
        input.ownerUserId,
      );
      if (!existing) {
        return "not_found";
      }
      if (existing.discoveryState === "delisted") {
        return "delisted";
      }
      if (existing.discoveryState === input.state) {
        return "unchanged";
      }
      throw new Error("Listing update guard changed no row");
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
      pollType: "multiple_choice" | "ranked_choice";
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
                   AND poll.poll_type = ?4
                   AND poll.representation_version = ?3
                   AND ${noVoteGuard}
               )`,
          )
          .bind(
            version.pollId,
            input.ownerUserId,
            input.expectedRepresentationVersion,
            input.pollType,
          ),
        ...input.options.map((option) =>
          db
            .prepare(
              `INSERT INTO poll_option (id, poll_id, label, position, created_at_ms)
               SELECT ?5, poll.id, ?6, ?7, ?8
               FROM poll
               WHERE poll.id = ?1
                 AND poll.owner_user_id = ?2
                 AND poll.poll_type = ?4
                 AND poll.representation_version = ?3
                 AND ${noVoteGuard}`,
            )
            .bind(
              version.pollId,
              input.ownerUserId,
              input.expectedRepresentationVersion,
              input.pollType,
              option.id,
              option.label,
              option.position,
              version.updatedAtMs,
            ),
        ),
        db
          .prepare(
            `UPDATE poll
                 SET question = ?5,
                 description = ?6,
                 multi_select_enabled = ?7,
                 min_selections = ?8,
                 max_selections = ?9,
                 comments_enabled = ?10,
                 updated_at_ms = ?11,
                 representation_version = representation_version + 1
             WHERE id = ?1
               AND owner_user_id = ?2
               AND poll_type = ?4
               AND representation_version = ?3
               AND ${noVoteGuard}`,
          )
          .bind(
            version.pollId,
            input.ownerUserId,
            input.expectedRepresentationVersion,
            input.pollType,
            input.definition.question,
            input.definition.description,
            input.definition.multiSelect ? 1 : 0,
            input.definition.minSelections,
            input.definition.maxSelections,
            input.definition.commentsEnabled ? 1 : 0,
            version.updatedAtMs,
          ),
      ];

      const batch = await db.batch(statements);
      const parentChanges = batch.at(-1)?.meta.changes ?? 0;
      // Question changes also bump the Discovery cache generation.
      if (parentChanges >= 1) {
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
        existing.pollType !== "multiple_choice" &&
        existing.pollType !== "ranked_choice"
      ) {
        return "unsupported";
      }
      if (existing.voterCount > 0) {
        return "locked";
      }
      return "conflict";
    },

    // Hard delete: capture self-contained Media cleanup keys and remove the
    // Poll plus D1 children in one atomic batch (AD-12).
    async deletePollForOwner(input: {
      pollId: PollId;
      ownerUserId: UserId;
      enqueuedAtMs: number;
    }): Promise<"deleted" | "not_found"> {
      const [, result] = await db.batch([
        db
          .prepare(
            `INSERT INTO cleanup_outbox (id, r2_key, enqueued_at_ms)
             SELECT lower(hex(randomblob(16))), media.r2_key, ?3
             FROM media_object AS media
             WHERE media.poll_id = ?1
               AND EXISTS (
                 SELECT 1 FROM poll
                 WHERE poll.id = ?1
                   AND poll.owner_user_id = ?2
               )`,
          )
          .bind(input.pollId, input.ownerUserId, input.enqueuedAtMs),
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

export function createMediaPersistence(db: D1Database) {
  return {
    async listDue(limit: number): Promise<CleanupOutboxRow[]> {
      const rows = await db
        .prepare(
          // Least-attempted first: permanently failing rows must not fill
          // every batch and starve rows that have never been tried.
          `SELECT id, r2_key, enqueued_at_ms, attempts
           FROM cleanup_outbox
           ORDER BY attempts, enqueued_at_ms, id
           LIMIT ?1`,
        )
        .bind(limit)
        .all<{
          id: string;
          r2_key: string;
          enqueued_at_ms: number;
          attempts: number;
        }>();
      return rows.results.map((row) => ({
        id: row.id,
        r2Key: row.r2_key,
        enqueuedAtMs: row.enqueued_at_ms,
        attempts: row.attempts,
      }));
    },

    async deleteRow(id: string): Promise<void> {
      await db.prepare("DELETE FROM cleanup_outbox WHERE id = ?1").bind(id).run();
    },

    async incrementAttempts(id: string): Promise<void> {
      await db
        .prepare("UPDATE cleanup_outbox SET attempts = attempts + 1 WHERE id = ?1")
        .bind(id)
        .run();
    },

    async findAdoptedKeys(keys: string[]): Promise<Set<string>> {
      if (keys.length === 0) return new Set();
      const placeholders = keys.map((_, index) => `?${index + 1}`).join(", ");
      const rows = await db
        .prepare(`SELECT r2_key FROM media_object WHERE r2_key IN (${placeholders})`)
        .bind(...keys)
        .all<{ r2_key: string }>();
      return new Set(rows.results.map(({ r2_key }) => r2_key));
    },

    async replaceOptionImage(
      input: ReplaceOptionImagePersistenceInput,
    ): Promise<"replaced" | "locked" | "not_found"> {
      const ownerAndVoteGuard = `EXISTS (
        SELECT 1 FROM poll
        WHERE poll.id = ?1
          AND poll.owner_user_id = ?2
          AND poll.poll_type = 'image'
          AND NOT EXISTS (SELECT 1 FROM vote WHERE vote.poll_id = poll.id)
      )`;
      const [, update] = await db.batch([
        db
          .prepare(
            `INSERT INTO cleanup_outbox (id, r2_key, enqueued_at_ms)
             SELECT lower(hex(randomblob(16))), media.r2_key, ?9
             FROM media_object AS media
             WHERE media.poll_id = ?1
               AND media.option_id = ?3
               AND media.r2_key <> ?4
               AND ${ownerAndVoteGuard}`,
          )
          .bind(
            input.pollId,
            input.ownerUserId,
            input.optionId,
            input.r2Key,
            input.contentType,
            input.sizeBytes,
            input.altText,
            input.caption,
            input.enqueuedAtMs,
          ),
        db
          .prepare(
            `UPDATE media_object
             SET r2_key = ?4,
                 content_type = ?5,
                 size_bytes = ?6,
                 alt_text = ?7,
                 caption = ?8
             WHERE poll_id = ?1
               AND option_id = ?3
               AND ${ownerAndVoteGuard}`,
          )
          .bind(
            input.pollId,
            input.ownerUserId,
            input.optionId,
            input.r2Key,
            input.contentType,
            input.sizeBytes,
            input.altText,
            input.caption,
          ),
      ]);
      if ((update?.meta.changes ?? 0) >= 1) return "replaced";

      const existing = await db
        .prepare(
          `SELECT EXISTS (
             SELECT 1
             FROM media_object AS media
             JOIN poll ON poll.id = media.poll_id
             WHERE media.poll_id = ?1
               AND media.option_id = ?2
               AND poll.owner_user_id = ?3
               AND poll.poll_type = 'image'
           ) AS owned,
           EXISTS (SELECT 1 FROM vote WHERE poll_id = ?1) AS has_vote`,
        )
        .bind(input.pollId, input.optionId, input.ownerUserId)
        .first<{ owned: number; has_vote: number }>();
      if (existing?.owned === 1 && existing.has_vote === 1) return "locked";
      return "not_found";
    },
  };
}

const MAX_RFC3339_TIMESTAMP_MS = 253_402_300_799_999;

function isVotePersistenceTimestamp(value: unknown): value is number {
  return (
    isCommentTimestamp(value) && value <= MAX_RFC3339_TIMESTAMP_MS
  );
}

export function createVotePersistence(db: D1Database) {
  return {
    async findMeetingResponseByRevisionDigest(
      pollId: PollId,
      digest: RevisionCapabilityDigest,
    ): Promise<StoredMeetingResponse | null> {
      const validated = asRevisionCapabilityDigest(digest);
      if (validated === null) return null;
      const response = await db.prepare(
        `SELECT mr.vote_id AS vote_id, mr.display_name AS display_name
         FROM meeting_response mr
         JOIN vote v ON v.id = mr.vote_id
         WHERE v.poll_id = ?1 AND mr.revision_capability_digest = ?2`,
      ).bind(pollId, validated).first<{ vote_id: string; display_name: string }>();
      if (!response) return null;
      const rows = await db.prepare(
        `SELECT meeting_slot_id, availability
         FROM meeting_availability
         WHERE vote_id = ?1
         ORDER BY meeting_slot_id`,
      ).bind(response.vote_id).all<{ meeting_slot_id: string; availability: "yes" | "if_need_be" | "no" }>();
      return {
        voteId: response.vote_id,
        displayName: response.display_name,
        availability: rows.results.map((row) => ({ meetingSlotId: row.meeting_slot_id, availability: row.availability })),
      };
    },

    async reviseMeetingResponse(batch: ReviseMeetingResponseBatch): Promise<void> {
      if (
        batch.availability.length < 1 ||
        new Set(batch.availability.map((entry) => entry.meetingSlotId)).size !== batch.availability.length
      ) throw new Error("invalid meeting revision batch");
      try {
        const results = await db.batch([
          db.prepare("DELETE FROM meeting_availability WHERE vote_id = ?1").bind(batch.voteId),
          ...batch.availability.map((entry) => db.prepare(
            "INSERT INTO meeting_availability (vote_id, meeting_slot_id, availability) VALUES (?1, ?2, ?3)",
          ).bind(batch.voteId, entry.meetingSlotId, entry.availability)),
          db.prepare("UPDATE meeting_response SET display_name = ?2 WHERE vote_id = ?1").bind(batch.voteId, batch.displayName),
          db.prepare("UPDATE poll SET representation_version = representation_version + 1, updated_at_ms = ?2 WHERE id = ?1 AND EXISTS (SELECT 1 FROM meeting_response WHERE vote_id = ?3)").bind(batch.pollId, batch.updatedAtMs, batch.voteId),
        ]);
        const responseUpdate = results.at(-2);
        const pollUpdate = results.at(-1);
        if ((responseUpdate?.meta?.changes ?? 0) !== 1 || (pollUpdate?.meta?.changes ?? 0) !== 1) throw new PollGoneError();
      } catch (error) {
        if (error instanceof PollGoneError) throw error;
        if (error instanceof Error && /poll_closed/.test(error.message)) throw new PollClosedError();
        if (error instanceof Error && /meeting_availability_slot_invalid/.test(error.message)) {
          const vote = await db.prepare("SELECT 1 AS found FROM vote WHERE id = ?1 AND poll_id = ?2").bind(batch.voteId, batch.pollId).first<{ found: number }>();
          if (!vote) throw new PollGoneError();
          throw new PollDefinitionChangedError();
        }
        if (error instanceof Error && /FOREIGN KEY constraint failed/i.test(error.message)) throw new PollGoneError();
        throw error;
      }
    },

    async insertVote(batch: VotePersistenceBatch): Promise<void> {
      // Validate and sanitize the complete contribution set before touching
      // D1. Every contribution and the shared version increment must belong
      // to this Vote/Poll/timestamp; a malformed fact anywhere in the batch
      // causes zero prepare/bind/batch calls, even after valid facts.
      let rawBatch: unknown;
      try {
        // Snapshot once so accessor-backed or externally mutated inputs
        // cannot change after validation but before statement binding.
        rawBatch = structuredClone(batch);
      } catch {
        throw new Error("invalid vote persistence batch");
      }
      if (
        !isExactRecord(rawBatch, [
          "vote",
          "contributions",
          "representationVersion",
        ]) ||
        !isExactRecord(rawBatch.vote, [
          "id",
          "pollId",
          "submissionId",
          "payloadHash",
          "createdAtMs",
        ]) ||
        typeof rawBatch.vote.id !== "string" ||
        rawBatch.vote.id.length === 0 ||
        typeof rawBatch.vote.pollId !== "string" ||
        rawBatch.vote.pollId.length === 0 ||
        typeof rawBatch.vote.submissionId !== "string" ||
        rawBatch.vote.submissionId.length === 0 ||
        typeof rawBatch.vote.payloadHash !== "string" ||
        rawBatch.vote.payloadHash.length === 0 ||
        !isVotePersistenceTimestamp(rawBatch.vote.createdAtMs) ||
        !Array.isArray(rawBatch.contributions) ||
        rawBatch.contributions.length > POLL_CAPS.maxOptions + 4 ||
        !isExactRecord(rawBatch.representationVersion, [
          "kind",
          "pollId",
          "updatedAtMs",
        ]) ||
        rawBatch.representationVersion.kind !==
          "increment_representation_version" ||
        rawBatch.representationVersion.pollId !== rawBatch.vote.pollId ||
        !isVotePersistenceTimestamp(
          rawBatch.representationVersion.updatedAtMs,
        ) ||
        rawBatch.representationVersion.updatedAtMs !==
          rawBatch.vote.createdAtMs
      ) {
        throw new Error("invalid vote persistence batch");
      }

      const voteId = rawBatch.vote.id;
      const pollId = rawBatch.vote.pollId;
      const submissionId = rawBatch.vote.submissionId;
      const payloadHash = rawBatch.vote.payloadHash;
      const createdAtMs = rawBatch.vote.createdAtMs;
      const selectionOptionIds = new Set<string>();
      const rankedOptionIds = new Set<string>();
      const rankedRanks = new Set<number>();
      const claimKinds = new Set<VoterClaimCheckKind>();
      let commentCount = 0;
      let meetingResponseCount = 0;
      const meetingSlotIds = new Set<string>();
      const contributions: Array<
        | VoteSelectionContribution
        | RankedPreferenceContribution
        | VoterClaimContribution
        | VoteCommentContribution
        | MeetingAvailabilityContribution
        | MeetingResponseContribution
      > = [];

      for (let index = 0; index < rawBatch.contributions.length; index += 1) {
        if (!Object.hasOwn(rawBatch.contributions, index)) {
          throw new Error("invalid vote contribution array");
        }
        const contribution: unknown = rawBatch.contributions[index];
        if (
          isExactRecord(contribution, ["kind", "voteId", "meetingSlotId", "availability"]) &&
          contribution.kind === "meeting_availability"
        ) {
          if (contribution.voteId !== voteId || typeof contribution.meetingSlotId !== "string" || contribution.meetingSlotId.length === 0 || meetingSlotIds.has(contribution.meetingSlotId) || !["yes", "if_need_be", "no"].includes(String(contribution.availability))) throw new Error("invalid meeting availability contribution");
          meetingSlotIds.add(contribution.meetingSlotId);
          contributions.push(contribution as unknown as MeetingAvailabilityContribution);
          continue;
        }
        if (
          isExactRecord(contribution, ["kind", "voteId", "displayName", "revisionCapabilityDigest"]) &&
          contribution.kind === "meeting_response"
        ) {
          if (contribution.voteId !== voteId || typeof contribution.displayName !== "string" || contribution.displayName.length < 1 || contribution.displayName.length > 80 || contribution.displayName !== contribution.displayName.trim() || asRevisionCapabilityDigest(contribution.revisionCapabilityDigest) === null || meetingResponseCount !== 0) throw new Error("invalid meeting response contribution");
          meetingResponseCount += 1;
          contributions.push(contribution as unknown as MeetingResponseContribution);
          continue;
        }
        if (
          isExactRecord(contribution, ["kind", "voteId", "pollOptionId"]) &&
          contribution.kind === "vote_selection"
        ) {
          if (
            contribution.voteId !== voteId ||
            typeof contribution.pollOptionId !== "string" ||
            contribution.pollOptionId.length === 0 ||
            selectionOptionIds.has(contribution.pollOptionId)
          ) {
            throw new Error("invalid vote selection contribution");
          }
          selectionOptionIds.add(contribution.pollOptionId);
          contributions.push(
            contribution as unknown as VoteSelectionContribution,
          );
          continue;
        }
        if (
          isExactRecord(contribution, [
            "kind",
            "voteId",
            "pollOptionId",
            "rank",
          ]) &&
          contribution.kind === "ranked_preference"
        ) {
          if (
            contribution.voteId !== voteId ||
            typeof contribution.pollOptionId !== "string" ||
            contribution.pollOptionId.length === 0 ||
            typeof contribution.rank !== "number" ||
            !Number.isSafeInteger(contribution.rank) ||
            contribution.rank < 1 ||
            rankedOptionIds.has(contribution.pollOptionId) ||
            rankedRanks.has(contribution.rank)
          ) {
            throw new Error("invalid ranked preference contribution");
          }
          rankedOptionIds.add(contribution.pollOptionId);
          rankedRanks.add(contribution.rank);
          contributions.push(
            contribution as unknown as RankedPreferenceContribution,
          );
          continue;
        }
        if (
          isExactRecord(contribution, [
            "kind",
            "pollId",
            "checkKind",
            "digest",
            "voteId",
            "createdAtMs",
          ]) &&
          contribution.kind === "voter_claim"
        ) {
          const digest = asVoterClaimDigest(contribution.digest);
          if (
            digest === null ||
            typeof contribution.checkKind !== "string" ||
            !isVoterClaimCheckKind(contribution.checkKind)
          ) {
            throw new Error("invalid voter claim digest");
          }
          if (
            contribution.pollId !== pollId ||
            contribution.voteId !== voteId ||
            !isVotePersistenceTimestamp(contribution.createdAtMs) ||
            contribution.createdAtMs !== createdAtMs ||
            claimKinds.has(contribution.checkKind)
          ) {
            throw new Error("invalid voter claim contribution");
          }
          claimKinds.add(contribution.checkKind);
          contributions.push({
            ...contribution,
            checkKind: contribution.checkKind,
            digest,
          } as VoterClaimContribution);
          continue;
        }
        if (
          isExactRecord(contribution, [
            "kind",
            "id",
            "voteId",
            "body",
            "displayName",
            "createdAtMs",
          ]) &&
          contribution.kind === "vote_comment"
        ) {
          if (
            !isCommentId(contribution.id) ||
            contribution.voteId !== voteId ||
            typeof contribution.body !== "string" ||
            !isVotePersistenceTimestamp(contribution.createdAtMs) ||
            contribution.createdAtMs !== createdAtMs ||
            contribution.body.length < 1 ||
            contribution.body.length > COMMENT_CAPS.body ||
            contribution.body !== contribution.body.trim() ||
            contribution.body.includes("\r") ||
            contribution.body.includes("\0") ||
            (contribution.displayName !== null &&
              typeof contribution.displayName !== "string") ||
            (typeof contribution.displayName === "string" &&
              (contribution.displayName.length < 1 ||
                contribution.displayName.length > COMMENT_CAPS.displayName ||
                contribution.displayName !== contribution.displayName.trim() ||
                /[\0\r\n]/.test(contribution.displayName))) ||
            commentCount !== 0
          ) {
            throw new Error("invalid vote comment contribution");
          }
          commentCount += 1;
          contributions.push(
            contribution as unknown as VoteCommentContribution,
          );
          continue;
        }
        if (
          isExactRecord(contribution, ["kind", "payload"]) &&
          typeof contribution.kind === "string" &&
          contribution.kind.startsWith("extension:")
        ) {
          throw new Error(
            `Unsupported vote contribution kind: ${contribution.kind}`,
          );
        }
        throw new Error("invalid vote contribution");
      }

      const hasSelections = selectionOptionIds.size > 0;
      const hasPreferences = rankedOptionIds.size > 0;
      if (
        ((meetingResponseCount === 1 || meetingSlotIds.size > 0)
          ? (hasSelections || hasPreferences || meetingResponseCount !== 1 || meetingSlotIds.size < 1)
          : hasSelections === hasPreferences) ||
        selectionOptionIds.size > POLL_CAPS.maxOptions ||
        rankedOptionIds.size > POLL_CAPS.maxOptions ||
        (hasPreferences &&
          !Array.from(
            { length: rankedRanks.size },
            (_, index) => index + 1,
          ).every((rank) => rankedRanks.has(rank)))
      ) {
        throw new Error("invalid vote persistence batch");
      }

      const statements: D1PreparedStatement[] = [
        db
          .prepare(
            "INSERT INTO vote (id, poll_id, submission_id, payload_hash, created_at_ms) VALUES (?1, ?2, ?3, ?4, ?5)",
          )
          .bind(voteId, pollId, submissionId, payloadHash, createdAtMs),
      ];

      const statementContributions = hasPreferences
        ? [
            ...contributions
              .filter(
                (contribution): contribution is RankedPreferenceContribution =>
                  contribution.kind === "ranked_preference",
              )
              .sort((left, right) => left.rank - right.rank),
            ...contributions.filter(
              (contribution) => contribution.kind !== "ranked_preference",
            ),
          ]
        : contributions;
      for (const contribution of statementContributions) {
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
        if (contribution.kind === "ranked_preference") {
          statements.push(
            db
              .prepare(
                "INSERT INTO ranked_vote_preference (vote_id, poll_option_id, preference_rank) VALUES (?1, ?2, ?3)",
              )
              .bind(
                contribution.voteId,
                contribution.pollOptionId,
                contribution.rank,
              ),
          );
          continue;
        }
        if (contribution.kind === "vote_comment") {
          statements.push(
            db
              .prepare(
                "INSERT INTO vote_comment (id, vote_id, body, display_name, created_at_ms) VALUES (?1, ?2, ?3, ?4, ?5)",
              )
              .bind(
                contribution.id,
                contribution.voteId,
                contribution.body,
                contribution.displayName,
                contribution.createdAtMs,
              ),
          );
          continue;
        }
        if (contribution.kind === "meeting_response") {
          statements.push(db.prepare("INSERT INTO meeting_response (vote_id, display_name, revision_capability_digest) VALUES (?1, ?2, ?3)").bind(contribution.voteId, contribution.displayName, contribution.revisionCapabilityDigest));
          continue;
        }
        if (contribution.kind === "meeting_availability") {
          statements.push(db.prepare("INSERT INTO meeting_availability (vote_id, meeting_slot_id, availability) VALUES (?1, ?2, ?3)").bind(contribution.voteId, contribution.meetingSlotId, contribution.availability));
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
          .bind(pollId, createdAtMs),
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
        if (error instanceof Error && /comments_disabled/.test(error.message)) {
          throw new CommentsDisabledError();
        }
        if (
          error instanceof Error &&
          /ranked_preference_option_invalid/.test(error.message)
        ) {
          throw new PollDefinitionChangedError();
        }
        if (error instanceof Error && /meeting_(availability_slot|response_vote)_invalid/.test(error.message)) throw new PollDefinitionChangedError();
        if (
          error instanceof Error &&
          /FOREIGN KEY constraint failed/i.test(error.message)
        ) {
          // Distinguish deleted Poll vs edited options (Story 1.12). Re-read
          // the Poll and selected option reachability before classifying.
          const pollStillExists = await db
            .prepare("SELECT 1 AS found FROM poll WHERE id = ?1")
            .bind(pollId)
            .first<{ found: number }>();
          if (!pollStillExists) {
            throw new PollGoneError();
          }
          const selectedOptionIds = contributions.flatMap((contribution) =>
            contribution.kind === "vote_selection" ||
            contribution.kind === "ranked_preference"
              ? [contribution.pollOptionId]
              : [],
          );
          if (selectedOptionIds.length > 0) {
            const placeholders = selectedOptionIds
              .map((_, index) => `?${index + 2}`)
              .join(", ");
            const reachable = await db
              .prepare(
                `SELECT COUNT(*) AS count FROM poll_option
                 WHERE poll_id = ?1 AND id IN (${placeholders})`,
              )
              .bind(pollId, ...selectedOptionIds)
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
          "SELECT id, poll_type, session_checks_enabled, ip_checks_enabled, captcha_enabled, comments_enabled, multi_select_enabled, min_selections, max_selections, deadline_ms, closed_at_ms FROM poll WHERE id = ?1",
        )
        .bind(pollId)
        .first<{
          id: PollId;
          poll_type: PollType;
          session_checks_enabled: number;
          ip_checks_enabled: number;
          captcha_enabled: number;
          comments_enabled: number;
          multi_select_enabled: number;
          min_selections: number | null;
          max_selections: number | null;
          deadline_ms: number | null;
          closed_at_ms: number | null;
        }>();
      if (!row) {
        return null;
      }
      const snapshot = {
        id: row.id,
        pollType: row.poll_type,
        options: await loadOptions(db, row.id),
        sessionChecksEnabled: row.session_checks_enabled === 1,
        ipChecksEnabled: row.ip_checks_enabled === 1,
        captchaEnabled: row.captcha_enabled === 1,
        commentsEnabled: row.comments_enabled === 1,
        multiSelectEnabled: row.multi_select_enabled === 1,
        minSelections: row.min_selections,
        maxSelections: row.max_selections,
        deadlineMs: row.deadline_ms,
        closedAtMs: row.closed_at_ms,
      };
      return row.poll_type === "meeting"
        ? { ...snapshot, slots: (await loadMeetingSlots(db, row.id)).map(({ id, position }) => ({ id, position })) }
        : snapshot;
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

    async findRankedPreferencesByClaim(
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
          "SELECT rvp.poll_option_id AS poll_option_id FROM voter_claim vc JOIN ranked_vote_preference rvp ON rvp.vote_id = vc.vote_id WHERE vc.poll_id = ?1 AND vc.check_kind = ?2 AND vc.digest = ?3 ORDER BY rvp.preference_rank ASC",
        )
        .bind(pollId, checkKind, validated)
        .all<{ poll_option_id: PollOptionId }>();
      return rows.results.map((row) => row.poll_option_id);
    },
  };
}

export type PollPersistence = ReturnType<typeof createPollPersistence>;
export type VotePersistence = ReturnType<typeof createVotePersistence>;

type CommentJsonRecord = {
  body: unknown;
  displayName: unknown;
  createdAtMs: unknown;
};

type OwnerCommentJsonRecord = CommentJsonRecord & {
  commentId: unknown;
};

function parseJsonRecords(value: unknown, label: string): unknown[] {
  if (typeof value !== "string") {
    throw new Error(`Malformed ${label} projection`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`Malformed ${label} projection`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`Malformed ${label} projection`);
  }
  return parsed;
}

function isExactRecord(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const actual = Reflect.ownKeys(value);
  return (
    actual.length === keys.length &&
    keys.every(
      (key) =>
        Object.hasOwn(value, key) &&
        Object.prototype.propertyIsEnumerable.call(value, key),
    )
  );
}

function mapCommentJson(value: unknown): CommentView {
  if (
    !isExactRecord(value, ["body", "displayName", "createdAtMs"])
  ) {
    throw new Error("Malformed Comment projection");
  }
  const row = value as CommentJsonRecord;
  if (
    typeof row.body !== "string" ||
    row.body.length < 1 ||
    row.body.length > COMMENT_CAPS.body ||
    row.body !== row.body.trim() ||
    /[\0\r]/u.test(row.body) ||
    (row.displayName !== null &&
      (typeof row.displayName !== "string" ||
        row.displayName.length < 1 ||
        row.displayName.length > COMMENT_CAPS.displayName ||
        row.displayName !== row.displayName.trim() ||
        /[\0\r\n]/u.test(row.displayName))) ||
    !isCommentTimestamp(row.createdAtMs)
  ) {
    throw new Error("Malformed Comment projection");
  }
  return {
    body: row.body,
    displayName: row.displayName,
    createdAtMs: row.createdAtMs,
  };
}

function mapOwnerCommentJson(value: unknown): OwnerCommentView {
  if (
    !isExactRecord(value, [
      "commentId",
      "body",
      "displayName",
      "createdAtMs",
    ])
  ) {
    throw new Error("Malformed owner Comment projection");
  }
  const row = value as OwnerCommentJsonRecord;
  if (
    !isCommentId(row.commentId)
  ) {
    throw new Error("Malformed owner Comment projection");
  }
  const comment = mapCommentJson({
    body: row.body,
    displayName: row.displayName,
    createdAtMs: row.createdAtMs,
  });
  return { commentId: row.commentId as CommentId, ...comment };
}

function validateCommentOrder(
  comments: readonly CommentView[],
  ownerComments: readonly OwnerCommentView[] | null,
): void {
  for (let index = 1; index < comments.length; index += 1) {
    if (comments[index - 1]!.createdAtMs < comments[index]!.createdAtMs) {
      throw new Error("Malformed Comment projection order");
    }
  }
  if (ownerComments === null) {
    return;
  }
  if (
    ownerComments.length !== comments.length ||
    ownerComments.some((ownerComment, index) => {
      const comment = comments[index];
      return (
        comment === undefined ||
        ownerComment.body !== comment.body ||
        ownerComment.displayName !== comment.displayName ||
        ownerComment.createdAtMs !== comment.createdAtMs
      );
    })
  ) {
    throw new Error("Malformed owner Comment projection");
  }
}

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
          "SELECT p.id, p.question, p.poll_type, p.result_visibility, p.owner_user_id, p.deadline_ms, p.closed_at_ms, p.multi_select_enabled, p.session_checks_enabled, p.ip_checks_enabled, p.voter_codes_enabled, p.captcha_enabled, p.vpn_blocking_enabled, canonical.reference AS canonical_reference FROM poll_reference requested JOIN poll p ON p.id = requested.poll_id JOIN poll_reference canonical ON canonical.poll_id = p.id AND canonical.is_canonical = 1 WHERE requested.reference = ?1",
        )
        .bind(reference)
        .first<{
          id: PollId;
          question: string;
          poll_type: PollType;
          result_visibility: ResultVisibility;
          owner_user_id: UserId;
          deadline_ms: number | null;
          closed_at_ms: number | null;
          multi_select_enabled: number;
          session_checks_enabled: number;
          ip_checks_enabled: number;
          voter_codes_enabled: number;
          captcha_enabled: number;
          vpn_blocking_enabled: number;
          canonical_reference: string;
        }>();
      if (!row) {
        return null;
      }
      if (!POLL_TYPES.includes(row.poll_type)) {
        throw new Error("Malformed Results Poll Type");
      }
      return {
        pollId: row.id,
        question: row.question,
        pollType: row.poll_type,
        resultVisibility: row.result_visibility,
        ownerUserId: row.owner_user_id,
        deadlineMs: row.deadline_ms,
        closedAtMs: row.closed_at_ms,
        multiSelectEnabled: row.multi_select_enabled === 1,
        securityToggles: makeSecurityToggles(
          row.session_checks_enabled === 1,
          row.ip_checks_enabled === 1,
          row.voter_codes_enabled === 1,
          row.captcha_enabled === 1,
          row.vpn_blocking_enabled === 1,
        ),
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

    // The accepted-fact Results projection (AD-9/AD-21): Tally, complete
    // ordered Comment list, optional owner moderation targets, and version
    // come from one statement/snapshot. Public/live callers pass false so a
    // Comment identifier never enters their adapter result.
    async projectVersionedResults(
      pollId: PollId,
      includeOwnerModeration = false,
    ): Promise<VersionedResultsProjection | null> {
      const rows = await db
        .prepare(
          `WITH target_votes AS MATERIALIZED (
             SELECT id FROM vote WHERE poll_id = ?1
           ),
           target_comments AS MATERIALIZED (
             SELECT vc.id, vc.body, vc.display_name, vc.created_at_ms
             FROM target_votes tv
             JOIN vote_comment vc ON vc.vote_id = tv.id
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
             mo.id AS media_id,
             mo.alt_text AS media_alt_text,
             mo.caption AS media_caption,
             totals.voter_count AS voter_count,
             totals.selection_count AS selection_count,
             p.representation_version AS representation_version,
             (
               SELECT json_group_array(json_object(
                 'body', ordered.body,
                 'displayName', ordered.display_name,
                 'createdAtMs', ordered.created_at_ms
               ))
               FROM (
                 SELECT body, display_name, created_at_ms
                 FROM target_comments
                 ORDER BY created_at_ms DESC, id DESC
               ) AS ordered
             ) AS comments_json,
             CASE WHEN ?2 = 1 THEN (
               SELECT json_group_array(json_object(
                 'commentId', ordered.id,
                 'body', ordered.body,
                 'displayName', ordered.display_name,
                 'createdAtMs', ordered.created_at_ms
               ))
               FROM (
                 SELECT id, body, display_name, created_at_ms
                 FROM target_comments
                 ORDER BY created_at_ms DESC, id DESC
               ) AS ordered
             ) ELSE NULL END AS owner_comments_json
           FROM poll p
           CROSS JOIN totals
           LEFT JOIN poll_option po ON po.poll_id = p.id
           LEFT JOIN option_counts oc ON oc.poll_option_id = po.id
           LEFT JOIN media_object mo ON mo.option_id = po.id
           WHERE p.id = ?1
           ORDER BY po.position`,
        )
        .bind(pollId, includeOwnerModeration ? 1 : 0)
        .all<{
          id: PollOptionId | null;
          label: string | null;
          position: number | null;
          option_count: number;
          media_id: string | null;
          media_alt_text: string | null;
          media_caption: string | null;
          voter_count: number;
          selection_count: number;
          representation_version: number;
          comments_json: string;
          owner_comments_json: string | null;
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
      if (
        rows.results.some(
          (row) =>
            row.comments_json !== first.comments_json ||
            row.owner_comments_json !== first.owner_comments_json,
        )
      ) {
        throw new Error("Malformed Comment projection snapshot");
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
        const option: ResultsTallyProjection["options"][number] = {
          id: row.id,
          label: row.label,
          position: row.position,
          count: toCount(row.option_count, "option_count"),
        };
        // Only image polls carry media rows; the LEFT JOIN leaves every
        // other type's columns NULL and the option media-free.
        if (row.media_id !== null && row.media_alt_text !== null) {
          option.media = {
            mediaId: row.media_id,
            altText: row.media_alt_text,
            caption: row.media_caption,
          };
        }
        return option;
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
      const comments = parseJsonRecords(
        first.comments_json,
        "Comment",
      ).map(mapCommentJson);
      const ownerComments = includeOwnerModeration
        ? parseJsonRecords(
            first.owner_comments_json,
            "owner Comment",
          ).map(mapOwnerCommentJson)
        : null;
      validateCommentOrder(comments, ownerComments);
      return {
        representationVersion: first.representation_version,
        options,
        voterCount,
        selectionCount,
        comments,
        ownerComments,
      };
    },

    // Narrow compatibility methods keep adapter consumers which need only a
    // Tally from widening their contract. They still use the same coherent
    // SQL statement; the extra purpose-shaped fields are dropped here.
    async projectVersionedTally(
      pollId: PollId,
    ): Promise<VersionedResultsTallyProjection | null> {
      const projection = await this.projectVersionedResults(pollId, false);
      if (!projection) {
        return null;
      }
      const {
        comments: _comments,
        ownerComments: _ownerComments,
        ...tally
      } = projection;
      return tally;
    },

    async projectResults(
      pollId: PollId,
      includeOwnerModeration: boolean,
    ): Promise<VersionedResultsProjection | null> {
      const projection = await this.projectVersionedResults(
        pollId,
        includeOwnerModeration,
      );
      return projection;
    },

    // Full-page Results consumes the exact same SQL projection and simply
    // drops the live-only version after the adapter has validated it.
    async projectTally(pollId: PollId): Promise<ResultsTallyProjection> {
      const projection = await this.projectVersionedResults(pollId, false);
      if (!projection) {
        return { options: [], voterCount: 0, selectionCount: 0 };
      }
      return {
        options: projection.options,
        voterCount: projection.voterCount,
        selectionCount: projection.selectionCount,
      };
    },

    /**
     * Ranked IRV projection (Story 5.2). Options + ordered preferences +
     * representation_version; pure tabulator owns the count.
     * Does not authorize visibility — callers must gate first (AD-21).
     * AD-24: re-reads representation_version after ballots and retries on
     * skew so the validator and body describe one coherent generation.
     */
    async projectRankedResults(
      pollId: PollId,
    ): Promise<VersionedRankedTallyProjection | null> {
      return this.projectVersionedRankedResults(pollId);
    },

    async projectVersionedRankedResults(
      pollId: PollId,
    ): Promise<VersionedRankedTallyProjection | null> {
      const maxAttempts = 3;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const pollRow = await db
          .prepare(
            `SELECT poll_type, representation_version
             FROM poll
             WHERE id = ?1
             LIMIT 1`,
          )
          .bind(pollId)
          .first<{
            poll_type: unknown;
            representation_version: number;
          }>();
        if (!pollRow) {
          return null;
        }
        if (pollRow.poll_type !== "ranked_choice") {
          throw new Error("Ranked projection requested for non-ranked Poll");
        }
        if (
          !Number.isSafeInteger(pollRow.representation_version) ||
          pollRow.representation_version < 1
        ) {
          throw new Error("Malformed representation version");
        }
        const versionAtStart = pollRow.representation_version;

        const optionRows = await db
          .prepare(
            `SELECT id, label, position
             FROM poll_option
             WHERE poll_id = ?1
             ORDER BY position`,
          )
          .bind(pollId)
          .all<{
            id: PollOptionId;
            label: string;
            position: number;
          }>();

        if (optionRows.results.length === 0) {
          throw new Error(
            "Malformed ranked projection: resolved Poll has no options",
          );
        }

        const options: IrvOptionSet[] = optionRows.results.map((row) => {
          if (
            typeof row.id !== "string" ||
            typeof row.label !== "string" ||
            !Number.isSafeInteger(row.position) ||
            row.position < 0
          ) {
            throw new Error("Malformed ranked projection: invalid option row");
          }
          return {
            id: row.id,
            label: row.label,
            position: row.position,
          };
        });

        const voteCountRow = await db
          .prepare(
            `SELECT COUNT(*) AS vote_count
             FROM vote
             WHERE poll_id = ?1`,
          )
          .bind(pollId)
          .first<{ vote_count: number }>();
        const voteCount = voteCountRow?.vote_count ?? 0;
        if (!Number.isSafeInteger(voteCount) || voteCount < 0) {
          throw new Error("Malformed ranked projection: invalid vote count");
        }

        const preferenceRows = await db
          .prepare(
            `SELECT v.id AS vote_id,
                    rvp.poll_option_id AS poll_option_id,
                    rvp.preference_rank AS preference_rank
             FROM vote v
             JOIN ranked_vote_preference rvp ON rvp.vote_id = v.id
             WHERE v.poll_id = ?1
             ORDER BY v.id, rvp.preference_rank`,
          )
          .bind(pollId)
          .all<{
            vote_id: string;
            poll_option_id: PollOptionId;
            preference_rank: number;
          }>();

        const knownOptionIds = new Set(options.map((option) => option.id));
        const byVote = new Map<
          string,
          { rank: number; optionId: PollOptionId }[]
        >();
        for (const row of preferenceRows.results) {
          if (
            typeof row.vote_id !== "string" ||
            typeof row.poll_option_id !== "string" ||
            !Number.isSafeInteger(row.preference_rank) ||
            row.preference_rank < 1 ||
            !knownOptionIds.has(row.poll_option_id)
          ) {
            throw new Error(
              "Malformed ranked projection: invalid preference row",
            );
          }
          const existing = byVote.get(row.vote_id) ?? [];
          existing.push({
            rank: row.preference_rank,
            optionId: row.poll_option_id,
          });
          byVote.set(row.vote_id, existing);
        }

        // Accepted ranked Votes always carry ≥1 preference. Orphan vote rows
        // (zero preferences) must fail closed rather than silently undercount.
        if (byVote.size !== voteCount) {
          throw new Error(
            "Malformed ranked projection: vote rows without preferences",
          );
        }

        const ballots: IrvBallot[] = [...byVote.values()].map((prefs) => {
          const ordered = [...prefs].sort((a, b) => a.rank - b.rank);
          return {
            preferences: ordered.map((preference) => preference.optionId),
          };
        });

        // Confirm version still matches after ballot/option reads (AD-24).
        const versionAfter = await db
          .prepare(
            `SELECT representation_version
             FROM poll
             WHERE id = ?1
             LIMIT 1`,
          )
          .bind(pollId)
          .first<{ representation_version: number }>();
        if (
          !versionAfter ||
          !Number.isSafeInteger(versionAfter.representation_version) ||
          versionAfter.representation_version < 1
        ) {
          throw new Error("Malformed representation version");
        }
        if (versionAfter.representation_version !== versionAtStart) {
          continue;
        }

        const ranked = tabulateAndProjectRanked({ ballots, options });
        return {
          ...ranked,
          representationVersion: versionAtStart,
        };
      }
      throw new Error("Ranked projection snapshot race");
    },

    async projectRankedComments(
      pollId: PollId,
      includeOwnerModeration: boolean,
    ): Promise<CommentResultsProjection | null> {
      const row = await db
        .prepare(
          `WITH target_votes AS MATERIALIZED (
             SELECT id FROM vote WHERE poll_id = ?1
           ),
           target_comments AS MATERIALIZED (
             SELECT vc.id, vc.body, vc.display_name, vc.created_at_ms
             FROM target_votes tv
             JOIN vote_comment vc ON vc.vote_id = tv.id
           )
           SELECT
             (
               SELECT json_group_array(json_object(
                 'body', ordered.body,
                 'displayName', ordered.display_name,
                 'createdAtMs', ordered.created_at_ms
               ))
               FROM (
                 SELECT body, display_name, created_at_ms
                 FROM target_comments
                 ORDER BY created_at_ms DESC, id DESC
               ) AS ordered
             ) AS comments_json,
             CASE WHEN ?2 = 1 THEN (
               SELECT json_group_array(json_object(
                 'commentId', ordered.id,
                 'body', ordered.body,
                 'displayName', ordered.display_name,
                 'createdAtMs', ordered.created_at_ms
               ))
               FROM (
                 SELECT id, body, display_name, created_at_ms
                 FROM target_comments
                 ORDER BY created_at_ms DESC, id DESC
               ) AS ordered
             ) ELSE NULL END AS owner_comments_json`,
        )
        .bind(pollId, includeOwnerModeration ? 1 : 0)
        .first<{
          comments_json: string | null;
          owner_comments_json: string | null;
        }>();

      if (!row) return null;

      const comments = parseJsonRecords(row.comments_json, "Comment").map(
        mapCommentJson,
      );
      const ownerComments = includeOwnerModeration
        ? parseJsonRecords(row.owner_comments_json, "owner Comment").map(
            mapOwnerCommentJson,
          )
        : null;
      validateCommentOrder(comments, ownerComments);
      return { comments, ownerComments };
    },

    async projectBallotManifest(
      pollId: PollId,
    ): Promise<readonly BallotManifestRow[] | null> {
      const maxAttempts = 3;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const pollRow = await db
          .prepare(
            `SELECT representation_version FROM poll WHERE id = ?1 LIMIT 1`,
          )
          .bind(pollId)
          .first<{ representation_version: number }>();

        if (!pollRow) return null;
        if (
          !Number.isSafeInteger(pollRow.representation_version) ||
          pollRow.representation_version < 1
        ) {
          throw new Error("Malformed representation version");
        }
        const versionAtStart = pollRow.representation_version;

        const optionRows = await db
          .prepare(
            "SELECT id, label, position FROM poll_option WHERE poll_id = ?1 ORDER BY position",
          )
          .bind(pollId)
          .all<{ id: string; label: string; position: number }>();

        if (optionRows.results.length === 0) return [];

        const optionLabelById = new Map<string, string>();
        const optionPositionById = new Map<string, number>();
        for (const row of optionRows.results) {
          optionLabelById.set(row.id, row.label);
          optionPositionById.set(row.id, row.position);
        }

        const prefRows = await db
          .prepare(
            `SELECT v.id AS vote_id, rvp.poll_option_id, rvp.preference_rank
             FROM vote v
             JOIN ranked_vote_preference rvp ON rvp.vote_id = v.id
             WHERE v.poll_id = ?1
             ORDER BY v.id, rvp.preference_rank`,
          )
          .bind(pollId)
          .all<{ vote_id: string; poll_option_id: string; preference_rank: number }>();

        // Build ballots keyed by vote_id, storing positions for canonical sort.
        const ballotMap = new Map<string, { positions: number[]; labels: string[] }>();
        for (const row of prefRows.results) {
          let entry = ballotMap.get(row.vote_id);
          if (!entry) {
            entry = { positions: [], labels: [] };
            ballotMap.set(row.vote_id, entry);
          }
          const pos = optionPositionById.get(row.poll_option_id);
          const label = optionLabelById.get(row.poll_option_id) ?? "—";
          if (pos !== undefined) {
            entry.positions.push(pos);
          } else {
            // Orphan option ID: use NaN sentinel so it sorts last within
            // the ballot, and render "—" in output.
            entry.positions.push(Number.NaN);
          }
          entry.labels.push(label);
        }

        // Canonical order: sort by numeric position sequence, not labels.
        // Identical position sequences are adjacent regardless of insertion order.
        const sortedEntries = [...ballotMap.values()];
        sortedEntries.sort((left, right) => {
          const aPos = left.positions;
          const bPos = right.positions;
          const len = Math.min(aPos.length, bPos.length);
          for (let i = 0; i < len; i++) {
            const aVal = aPos[i];
            const bVal = bPos[i];
            // NaN (orphan) sorts after any integer.
            if (Number.isNaN(aVal) && !Number.isNaN(bVal)) return 1;
            if (!Number.isNaN(aVal) && Number.isNaN(bVal)) return -1;
            if (aVal < bVal) return -1;
            if (aVal > bVal) return 1;
          }
          return aPos.length - bPos.length;
        });

        // Collapse adjacent identical ballots into a count. The sort above
        // groups identical position sequences regardless of vote.id insertion
        // order, so the count is deterministic and never correlates with
        // persistence identifiers (AC 2, Trap 2).
        const ballots: BallotManifestRow[] = [];
        for (let i = 0; i < sortedEntries.length; ) {
          const entry = sortedEntries[i]!;
          const labels = entry.labels;
          let count = 1;
          while (i + count < sortedEntries.length) {
            const next = sortedEntries[i + count]!;
            if (next.positions.length !== entry.positions.length) break;
            let same = true;
            for (let j = 0; j < entry.positions.length; j++) {
              const aVal = entry.positions[j]!;
              const bVal = next.positions[j]!;
              if (Number.isNaN(aVal as number) && Number.isNaN(bVal as number))
                continue;
              if (aVal !== bVal) {
                same = false;
                break;
              }
            }
            if (!same) break;
            count++;
          }
          ballots.push({ rankedOptionLabels: labels, count });
          i += count;
        }

        // Confirm version still matches after reads (AD-24).
        const versionAfter = await db
          .prepare(
            `SELECT representation_version FROM poll WHERE id = ?1 LIMIT 1`,
          )
          .bind(pollId)
          .first<{ representation_version: number }>();
        if (
          !versionAfter ||
          !Number.isSafeInteger(versionAfter.representation_version) ||
          versionAfter.representation_version < 1
        ) {
          throw new Error("Malformed representation version");
        }
        if (versionAfter.representation_version !== versionAtStart) {
          continue;
        }

        return ballots;
      }
      throw new Error("Ballot Manifest projection snapshot race");
    },
  };
}

export function createOwnerExportPersistence(db: D1Database) {
  return {
    async findOwnerEnvelope(
      pollId: PollId,
      ownerUserId: UserId,
    ): Promise<ExportOwnerEnvelope | null> {
      const row = await db
        .prepare(
          `SELECT p.id, p.poll_type, canonical.reference AS canonical_reference,
                  canonical.kind AS canonical_reference_kind
           FROM poll p
           LEFT JOIN poll_reference canonical
             ON canonical.poll_id = p.id AND canonical.is_canonical = 1
           WHERE p.id = ?1 AND p.owner_user_id = ?2
           LIMIT 1`,
        )
        .bind(pollId, ownerUserId)
        .first<{
          id: PollId;
          poll_type: PollType;
          canonical_reference: unknown;
          canonical_reference_kind: unknown;
        }>();
      if (!row) return null;
      const validReference =
        (row.canonical_reference_kind === "generated" &&
          typeof row.canonical_reference === "string" &&
          /^[A-Za-z0-9_-]{22}$/u.test(row.canonical_reference)) ||
        (row.canonical_reference_kind === "custom" &&
          typeof row.canonical_reference === "string" &&
          isCanonicalCustomReference(row.canonical_reference));
      if (
        !POLL_TYPES.includes(row.poll_type) ||
        !validReference
      ) {
        throw new Error("Malformed export owner envelope");
      }
      return {
        pollId: row.id,
        pollType: row.poll_type,
        canonicalReference: row.canonical_reference as string,
      };
    },
  };
}

// Voting-owned Comment moderation adapter (AD-19/AD-24). Both delete paths
// recheck authority in the same D1 batch that removes only vote_comment and
// advances the Poll representation version exactly once.
export function createCommentModerationPersistence(db: D1Database) {
  const liveAdministrator = async (actorUserId: UserId): Promise<boolean> => {
    const row = await db
      .prepare("SELECT role FROM user WHERE id = ?1")
      .bind(actorUserId)
      .first<{ role: unknown }>();
    return row?.role === "administrator";
  };

  const findTarget = async (
    actorUserId: UserId,
    commentId: CommentId,
    mode: "owner" | "administrator",
  ): Promise<{ pollId: PollId; canonicalReference: string } | null> => {
    const authority =
      mode === "owner"
        ? "p.owner_user_id = ?2"
        : "EXISTS (SELECT 1 FROM user u WHERE u.id = ?2 AND u.role = 'administrator')";
    const row = await db
      .prepare(
        `SELECT p.id, canonical.reference AS canonical_reference
         FROM vote_comment vc
         JOIN vote v ON v.id = vc.vote_id
         JOIN poll p ON p.id = v.poll_id
         JOIN poll_reference canonical
           ON canonical.poll_id = p.id AND canonical.is_canonical = 1
         WHERE vc.id = ?1 AND ${authority}
         LIMIT 1`,
      )
      .bind(commentId, actorUserId)
      .first<{ id: PollId; canonical_reference: unknown }>();
    if (!row) {
      return null;
    }
    if (
      typeof row.canonical_reference !== "string" ||
      row.canonical_reference.length < 1 ||
      row.canonical_reference.length > 128
    ) {
      throw new Error("Malformed Comment moderation canonical reference");
    }
    return {
      pollId: row.id,
      canonicalReference: row.canonical_reference,
    };
  };

  const deleteGuarded = async (
    input: {
      actorUserId: UserId;
      commentId: CommentId;
      updatedAtMs: number;
    },
    mode: "owner" | "administrator",
  ): Promise<CommentModerationPersistenceOutcome> => {
    const target = await findTarget(
      input.actorUserId,
      input.commentId,
      mode,
    );
    if (target === null) {
      if (
        mode === "administrator" &&
        !(await liveAdministrator(input.actorUserId))
      ) {
        return { kind: "authorization_denied" };
      }
      return { kind: "not_found" };
    }
    const { pollId, canonicalReference } = target;

    const pollAuthority =
      mode === "owner"
        ? "poll.owner_user_id = ?3"
        : "EXISTS (SELECT 1 FROM user u WHERE u.id = ?3 AND u.role = 'administrator')";
    const commentAuthority =
      mode === "owner"
        ? "p.owner_user_id = ?3"
        : "EXISTS (SELECT 1 FROM user u WHERE u.id = ?3 AND u.role = 'administrator')";
    const canonicalGuard =
      "EXISTS (SELECT 1 FROM poll_reference canonical WHERE canonical.poll_id = poll.id AND canonical.is_canonical = 1 AND typeof(canonical.reference) = 'text' AND length(canonical.reference) BETWEEN 1 AND 128)";
    const [versionResult, deleteResult] = await db.batch([
      db
        .prepare(
          `UPDATE poll
           SET representation_version = representation_version + 1,
               updated_at_ms = ?4
           WHERE id = ?1
             AND ${pollAuthority}
             AND ${canonicalGuard}
             AND EXISTS (
               SELECT 1
               FROM vote_comment vc
               JOIN vote v ON v.id = vc.vote_id
               WHERE vc.id = ?2 AND v.poll_id = poll.id
             )`,
        )
        .bind(pollId, input.commentId, input.actorUserId, input.updatedAtMs),
      db
        .prepare(
          `DELETE FROM vote_comment
           WHERE id = ?2
             AND EXISTS (
               SELECT 1
               FROM vote v
               JOIN poll p ON p.id = v.poll_id
               WHERE v.id = vote_comment.vote_id
                 AND p.id = ?1
                 AND ${commentAuthority}
                 AND EXISTS (
                   SELECT 1 FROM poll_reference canonical
                   WHERE canonical.poll_id = p.id
                     AND canonical.is_canonical = 1
                     AND typeof(canonical.reference) = 'text'
                     AND length(canonical.reference) BETWEEN 1 AND 128
                 )
             )`,
        )
        .bind(pollId, input.commentId, input.actorUserId),
    ]);

    const versionChanges = versionResult.meta.changes ?? 0;
    const deleteChanges = deleteResult.meta.changes ?? 0;
    if (versionChanges === 1 && deleteChanges === 1) {
      return {
        kind: "deleted",
        pollId,
        canonicalReference,
      };
    }
    if (versionChanges === 0 && deleteChanges === 0) {
      if (
        mode === "administrator" &&
        !(await liveAdministrator(input.actorUserId))
      ) {
        return { kind: "authorization_denied" };
      }
      return { kind: "not_found" };
    }
    throw new Error("Comment moderation transaction mismatch");
  };

  return {
    async loadForAdministrator(
      actorUserId: UserId,
      pollId: PollId,
    ): Promise<AdministratorCommentLoadOutcome> {
      const row = await db
        .prepare(
          `WITH authorized AS (
             SELECT 1 AS allowed
             FROM user
             WHERE id = ?1 AND role = 'administrator'
           )
           SELECT
             EXISTS(SELECT 1 FROM authorized) AS authorized,
             CASE WHEN EXISTS(SELECT 1 FROM authorized) THEN (
               SELECT json_group_array(json_object(
                 'commentId', ordered.id,
                 'body', ordered.body,
                 'displayName', ordered.display_name,
                 'createdAtMs', ordered.created_at_ms
               ))
               FROM (
                 SELECT vc.id, vc.body, vc.display_name, vc.created_at_ms
                 FROM vote v
                 JOIN vote_comment vc ON vc.vote_id = v.id
                 WHERE v.poll_id = ?2
                 ORDER BY vc.created_at_ms DESC, vc.id DESC
               ) AS ordered
             ) ELSE NULL END AS comments_json`,
        )
        .bind(actorUserId, pollId)
        .first<{ authorized: number; comments_json: string | null }>();
      if (row?.authorized !== 1) {
        return { kind: "authorization_denied" };
      }
      const comments = parseJsonRecords(
        row.comments_json,
        "Administrator Comment",
      ).map(mapOwnerCommentJson);
      validateCommentOrder(comments, comments);
      return { kind: "found", comments };
    },

    deleteForOwner(input: {
      actorUserId: UserId;
      commentId: CommentId;
      updatedAtMs: number;
    }): Promise<CommentModerationPersistenceOutcome> {
      return deleteGuarded(input, "owner");
    },

    deleteForAdministrator(input: {
      actorUserId: UserId;
      commentId: CommentId;
      updatedAtMs: number;
    }): Promise<CommentModerationPersistenceOutcome> {
      return deleteGuarded(input, "administrator");
    },
  };
}

type DiscoveryCatalogRow = {
  id: PollId;
  canonical_reference: string;
  question: string;
  poll_type: PollType;
  vote_count: number;
  deadline_ms: number | null;
  created_at_ms: number;
};

type DiscoverySitemapRow = {
  id: PollId;
  canonical_reference: string;
  deadline_ms: number | null;
  created_at_ms: number;
};

function isSafeTimestamp(value: number | null): boolean {
  return value === null || (Number.isSafeInteger(value) && value >= 0);
}

const UUID_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function mapDiscoveryCatalogRow(
  row: DiscoveryCatalogRow,
): DiscoveryCatalogRecord {
  if (
    typeof row.id !== "string" ||
    typeof row.canonical_reference !== "string" ||
    row.canonical_reference.length === 0 ||
    row.canonical_reference.length > 128 ||
    typeof row.question !== "string" ||
    row.question.length > 500 ||
    !POLL_TYPES.includes(row.poll_type) ||
    !Number.isSafeInteger(row.vote_count) ||
    row.vote_count < 0 ||
    !isSafeTimestamp(row.deadline_ms) ||
    !Number.isSafeInteger(row.created_at_ms) ||
    row.created_at_ms < 0
  ) {
    throw new Error("Malformed discovery catalog projection");
  }
  return {
    id: row.id,
    canonicalReference: row.canonical_reference,
    question: row.question,
    pollType: row.poll_type,
    voteCount: row.vote_count,
    deadlineMs: row.deadline_ms,
    createdAtMs: row.created_at_ms,
  };
}

function mapDiscoverySitemapRow(
  row: DiscoverySitemapRow,
): DiscoverySitemapRecord {
  if (
    typeof row.id !== "string" ||
    !UUID_SHAPE.test(row.id) ||
    typeof row.canonical_reference !== "string" ||
    row.canonical_reference.length === 0 ||
    row.canonical_reference.length > 128 ||
    !isSafeTimestamp(row.deadline_ms) ||
    !Number.isSafeInteger(row.created_at_ms) ||
    row.created_at_ms < 0
  ) {
    throw new Error("Malformed discovery sitemap projection");
  }
  return {
    id: row.id,
    canonicalReference: row.canonical_reference,
    deadlineMs: row.deadline_ms,
    createdAtMs: row.created_at_ms,
  };
}

function compareDiscoveryOrder(
  left: DiscoveryOrderKey,
  right: DiscoveryOrderKey,
  direction: "newer" | "older",
): number {
  const timestamp = left.createdAtMs - right.createdAtMs;
  const id = left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  const ascending = timestamp === 0 ? id : timestamp;
  return direction === "newer" ? ascending : -ascending;
}

function mergeDiscoveryStreams<T extends DiscoveryOrderKey>(
  left: T[],
  right: T[],
  direction: "newer" | "older",
  limit: number,
): T[] {
  const merged: T[] = [];
  const seen = new Set<string>();
  let leftIndex = 0;
  let rightIndex = 0;
  while (
    merged.length < limit &&
    (leftIndex < left.length || rightIndex < right.length)
  ) {
    const leftValue = left[leftIndex];
    const rightValue = right[rightIndex];
    let next: T;
    if (
      rightValue === undefined ||
      (leftValue !== undefined &&
        compareDiscoveryOrder(leftValue, rightValue, direction) <= 0)
    ) {
      next = leftValue as T;
      leftIndex += 1;
    } else {
      next = rightValue;
      rightIndex += 1;
    }
    if (!seen.has(next.id)) {
      seen.add(next.id);
      merged.push(next);
    }
  }
  return merged;
}

const DELIST_ACTION_QUERY = `INSERT INTO moderation_action
  (poll_id, actor_user_id, action, prior_state, next_state, created_at_ms)
SELECT p.id, ?2, 'delist', p.discovery_state, 'delisted', ?3
FROM poll AS p
WHERE p.id = ?1
  AND p.discovery_state IN ('unlisted', 'listed')
  AND EXISTS (
    SELECT 1 FROM user AS u
    WHERE u.id = ?2 AND u.role = 'administrator'
  )`;

const DELIST_STATE_QUERY = `UPDATE poll
SET discovery_state = 'delisted',
    updated_at_ms = ?3
WHERE id = ?1
  AND discovery_state IN ('unlisted', 'listed')
  AND EXISTS (
    SELECT 1 FROM user AS u
    WHERE u.id = ?2 AND u.role = 'administrator'
  )`;

const CLEAR_DELISTED_ACTION_QUERY = `INSERT INTO moderation_action
  (poll_id, actor_user_id, action, prior_state, next_state, created_at_ms)
SELECT p.id,
       ?2,
       'clear_delisted',
       'delisted',
       COALESCE((
         SELECT CASE
           WHEN ma.action = 'delist'
             AND ma.next_state = 'delisted'
             AND ma.prior_state IN ('unlisted', 'listed')
           THEN ma.prior_state
         END
         FROM moderation_action AS ma
         WHERE ma.poll_id = p.id
         ORDER BY ma.sequence DESC
         LIMIT 1
       ), 'unlisted'),
       ?3
FROM poll AS p
WHERE p.id = ?1
  AND p.discovery_state = 'delisted'
  AND EXISTS (
    SELECT 1 FROM user AS u
    WHERE u.id = ?2 AND u.role = 'administrator'
  )`;

const CLEAR_DELISTED_STATE_QUERY = `UPDATE poll
SET discovery_state = (
      SELECT ma.next_state
      FROM moderation_action AS ma
      WHERE ma.poll_id = poll.id
        AND ma.action = 'clear_delisted'
      ORDER BY ma.sequence DESC
      LIMIT 1
    ),
    updated_at_ms = ?3
WHERE id = ?1
  AND discovery_state = 'delisted'
  AND EXISTS (
    SELECT 1 FROM user AS u
    WHERE u.id = ?2 AND u.role = 'administrator'
  )`;

function isDiscoveryState(value: unknown): value is DiscoveryState {
  return (
    typeof value === "string" &&
    (DISCOVERY_STATES as readonly string[]).includes(value)
  );
}

/** Dedicated arbitrary-owner moderation adapter; creator listing stays scoped. */
export function createModerationPersistence(
  db: D1Database,
  runtimeDiscoveryStates: readonly string[] = DISCOVERY_STATES,
) {
  async function classifyNoChange(
    actorUserId: string,
    pollId: PollId,
    intent: AdministratorModerationIntent,
  ): Promise<ModerationPersistenceOutcome> {
    // Role first: a revoked principal must not learn whether the target exists.
    const actor = await db
      .prepare("SELECT role FROM user WHERE id = ?1")
      .bind(actorUserId)
      .first<{ role: unknown }>();
    if (actor?.role !== "administrator") {
      return "authorization_denied";
    }

    const poll = await db
      .prepare("SELECT discovery_state FROM poll WHERE id = ?1")
      .bind(pollId)
      .first<{ discovery_state: unknown }>();
    if (!poll) {
      return "not_found";
    }
    if (
      typeof poll.discovery_state !== "string" ||
      !runtimeDiscoveryStates.includes(poll.discovery_state)
    ) {
      throw new Error("Malformed Poll discovery state");
    }
    if (intent === "delist" && poll.discovery_state === "delisted") {
      return "unchanged";
    }
    if (intent === "clear_delisted" && poll.discovery_state !== "delisted") {
      return "invalid_transition";
    }
    if (
      poll.discovery_state !== "unlisted" &&
      poll.discovery_state !== "listed" &&
      poll.discovery_state !== "delisted"
    ) {
      return "invalid_transition";
    }
    throw new Error("Moderation transaction guard changed no row");
  }

  return {
    async findTargetByReference(
      reference: string,
    ): Promise<ModerationTargetRecord | null> {
      const row = await db
        .prepare(
          `SELECT p.id,
                  p.question,
                  canonical.reference AS canonical_reference,
                  p.discovery_state,
                  p.deadline_ms,
                  p.closed_at_ms
           FROM poll_reference AS requested
           JOIN poll AS p ON p.id = requested.poll_id
           JOIN poll_reference AS canonical
             ON canonical.poll_id = p.id AND canonical.is_canonical = 1
           WHERE requested.reference = ?1
           LIMIT 1`,
        )
        .bind(reference)
        .first<{
          id: PollId;
          question: unknown;
          canonical_reference: unknown;
          discovery_state: unknown;
          deadline_ms: unknown;
          closed_at_ms: unknown;
        }>();
      if (!row) {
        return null;
      }
      const validTimestamp = (value: unknown): value is number | null =>
        value === null ||
        (typeof value === "number" &&
          Number.isSafeInteger(value) &&
          value >= 0);
      if (
        typeof row.id !== "string" ||
        typeof row.question !== "string" ||
        row.question.length === 0 ||
        typeof row.canonical_reference !== "string" ||
        row.canonical_reference.length === 0 ||
        !isDiscoveryState(row.discovery_state) ||
        !validTimestamp(row.deadline_ms) ||
        !validTimestamp(row.closed_at_ms)
      ) {
        throw new Error("Malformed moderation target projection");
      }
      return {
        pollId: row.id,
        question: row.question,
        canonicalReference: row.canonical_reference,
        discoveryState: row.discovery_state,
        deadlineMs: row.deadline_ms,
        closedAtMs: row.closed_at_ms,
      };
    },

    async applyModeration(input: {
      actorUserId: string;
      pollId: PollId;
      intent: AdministratorModerationIntent;
      updatedAtMs: number;
    }): Promise<ModerationPersistenceOutcome> {
      const actionQuery =
        input.intent === "delist"
          ? DELIST_ACTION_QUERY
          : CLEAR_DELISTED_ACTION_QUERY;
      const stateQuery =
        input.intent === "delist"
          ? DELIST_STATE_QUERY
          : CLEAR_DELISTED_STATE_QUERY;
      const [actionResult, stateResult] = await db.batch([
        db
          .prepare(actionQuery)
          .bind(input.pollId, input.actorUserId, input.updatedAtMs),
        db
          .prepare(stateQuery)
          .bind(input.pollId, input.actorUserId, input.updatedAtMs),
      ]);
      const actionChanges = actionResult.meta.changes ?? 0;
      const stateChanges = stateResult.meta.changes ?? 0;
      // D1 reports the poll UPDATE together with its catalog-revision trigger
      // in the second statement's change count. The action INSERT has no
      // trigger and therefore remains the exact one-row side of the invariant.
      if (actionChanges === 1 && stateChanges >= 1) {
        return "updated";
      }
      if (actionChanges === 0 && stateChanges === 0) {
        return classifyNoChange(input.actorUserId, input.pollId, input.intent);
      }
      // INSERT succeeded but UPDATE failed — the moderation_action row is
      // orphaned. Classify current state to surface a coherent outcome
      // instead of a 500. The orphaned row carries correct prior/next state
      // data (fill-in was a no-row sub-expression when the poll already
      // satisfied the target guard); a future clear cycle reads it
      // correctly through the action-type filter in the COALESCE.
      if (actionChanges === 1 && stateChanges === 0) {
        return classifyNoChange(input.actorUserId, input.pollId, input.intent);
      }
      throw new Error("Moderation action/state transaction mismatch");
    },
  };
}

/** Separate Discovery read adapter: no creator or Results repository widening. */
export function createDiscoveryPersistence(db: D1Database) {
  async function queryCatalogStream(
    query: string,
    nowMs: number,
    boundary: DiscoveryOrderKey | null,
    limit: number,
  ): Promise<DiscoveryCatalogRecord[]> {
    const result = await db
      .prepare(query)
      .bind(nowMs, boundary?.createdAtMs ?? null, boundary?.id ?? null, limit)
      .all<DiscoveryCatalogRow>();
    return result.results.map(mapDiscoveryCatalogRow);
  }

  async function querySitemapStream(
    deadline: "none" | "active",
    nowMs: number,
    startExclusive: DiscoveryOrderKey | null,
    endInclusive: DiscoveryOrderKey | null,
    limit: number,
  ): Promise<DiscoverySitemapRecord[]> {
    let query: string;
    let bindings: readonly (number | string)[];
    if (startExclusive !== null && endInclusive !== null) {
      query =
        deadline === "none"
          ? DISCOVERY_SITEMAP_NO_DEADLINE_QUERY
          : DISCOVERY_SITEMAP_ACTIVE_DEADLINE_QUERY;
      bindings = [
        nowMs,
        startExclusive.createdAtMs,
        startExclusive.id,
        endInclusive.createdAtMs,
        endInclusive.id,
        limit,
      ];
    } else if (startExclusive !== null) {
      query =
        deadline === "none"
          ? DISCOVERY_SITEMAP_NO_DEADLINE_START_QUERY
          : DISCOVERY_SITEMAP_ACTIVE_DEADLINE_START_QUERY;
      bindings = [
        nowMs,
        startExclusive.createdAtMs,
        startExclusive.id,
        limit,
      ];
    } else if (endInclusive !== null) {
      query =
        deadline === "none"
          ? DISCOVERY_SITEMAP_NO_DEADLINE_END_QUERY
          : DISCOVERY_SITEMAP_ACTIVE_DEADLINE_END_QUERY;
      bindings = [
        nowMs,
        endInclusive.createdAtMs,
        endInclusive.id,
        limit,
      ];
    } else {
      query =
        deadline === "none"
          ? DISCOVERY_SITEMAP_NO_DEADLINE_ROOT_QUERY
          : DISCOVERY_SITEMAP_ACTIVE_DEADLINE_ROOT_QUERY;
      bindings = [nowMs, limit];
    }
    const result = await db
      .prepare(query)
      .bind(...bindings)
      .all<DiscoverySitemapRow>();
    return result.results.map(mapDiscoverySitemapRow);
  }

  return {
    async readRevision(): Promise<number | null> {
      const row = await db
        .prepare(
          "SELECT revision FROM discovery_catalog_revision WHERE singleton = 1",
        )
        .first<{ revision: number }>();
      if (!row || !Number.isSafeInteger(row.revision) || row.revision < 1) {
        return null;
      }
      return row.revision;
    },

    async queryCatalogPage(input: {
      direction: DiscoveryCatalogRequest["direction"];
      boundary: DiscoveryOrderKey | null;
      limit: number;
      nowMs: number;
    }): Promise<DiscoveryCatalogRecord[]> {
      const direction = input.direction === "newer" ? "newer" : "older";
      const noDeadlineQuery =
        direction === "newer"
          ? DISCOVERY_NO_DEADLINE_NEWER_QUERY
          : DISCOVERY_NO_DEADLINE_QUERY;
      const activeDeadlineQuery =
        direction === "newer"
          ? DISCOVERY_ACTIVE_DEADLINE_NEWER_QUERY
          : DISCOVERY_ACTIVE_DEADLINE_QUERY;
      const [noDeadline, activeDeadline] = await Promise.all([
        queryCatalogStream(
          noDeadlineQuery,
          input.nowMs,
          input.boundary,
          input.limit,
        ),
        queryCatalogStream(
          activeDeadlineQuery,
          input.nowMs,
          input.boundary,
          input.limit,
        ),
      ]);
      return mergeDiscoveryStreams(
        noDeadline,
        activeDeadline,
        direction,
        input.limit,
      );
    },

    async querySitemapPage(input: {
      startExclusive: DiscoveryOrderKey | null;
      endInclusive: DiscoveryOrderKey | null;
      limit: number;
      nowMs: number;
    }): Promise<DiscoverySitemapRecord[]> {
      const [noDeadline, activeDeadline] = await Promise.all([
        querySitemapStream(
          "none",
          input.nowMs,
          input.startExclusive,
          input.endInclusive,
          input.limit,
        ),
        querySitemapStream(
          "active",
          input.nowMs,
          input.startExclusive,
          input.endInclusive,
          input.limit,
        ),
      ]);
      return mergeDiscoveryStreams(
        noDeadline,
        activeDeadline,
        "older",
        input.limit,
      );
    },
  };
}

export type ResultsPersistence = ReturnType<typeof createResultsPersistence>;
