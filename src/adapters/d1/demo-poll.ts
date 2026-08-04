import type {
  DemoPollSnapshot,
  ReplaceDemoPollInput,
  ReplaceDemoPollOutcome,
} from "../../modules/polls/demo-poll";
import type {
  DiscoveryState,
  PollId,
  PollOptionId,
  PollType,
  ResultVisibility,
  UserId,
} from "../../shared/domain/index";

type DemoRow = {
  id: PollId;
  owner_user_id: UserId;
  canonical_reference: string;
  poll_type: PollType;
  question: string;
  description: string | null;
  discovery_state: DiscoveryState;
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
  representation_version: number;
  voter_count: number;
  moderation_action_count: number;
  option_id: PollOptionId | null;
  option_label: string | null;
  option_position: number | null;
};

export function createDemoPollPersistence(
  db: D1Database,
  generatePollId: () => PollId = () => crypto.randomUUID() as PollId,
) {
  const loadByReference = async (
    reference: string,
  ): Promise<DemoPollSnapshot | null> => {
    const rows = await db
      .prepare(
        `SELECT p.id, p.owner_user_id, r.reference AS canonical_reference,
                p.poll_type, p.question, p.description, p.discovery_state,
                p.result_visibility, p.multi_select_enabled,
                p.min_selections, p.max_selections,
                p.session_checks_enabled, p.ip_checks_enabled,
                p.voter_codes_enabled, p.captcha_enabled,
                p.vpn_blocking_enabled, p.deadline_ms, p.closed_at_ms,
                p.representation_version,
                (SELECT COUNT(*) FROM vote v WHERE v.poll_id = p.id) AS voter_count,
                (SELECT COUNT(*) FROM moderation_action ma WHERE ma.poll_id = p.id)
                  AS moderation_action_count,
                po.id AS option_id, po.label AS option_label,
                po.position AS option_position
         FROM poll_reference r
         JOIN poll p ON p.id = r.poll_id
         LEFT JOIN poll_option po ON po.poll_id = p.id
         WHERE r.reference = ?1 AND r.is_canonical = 1
         ORDER BY po.position`,
      )
      .bind(reference)
      .all<DemoRow>();
    const row = rows.results[0];
    if (!row) return null;
    return {
      pollId: row.id,
      ownerUserId: row.owner_user_id,
      canonicalReference: row.canonical_reference,
      pollType: row.poll_type,
      question: row.question,
      description: row.description,
      discoveryState: row.discovery_state,
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
      representationVersion: row.representation_version,
      voterCount: row.voter_count,
      moderationActionCount: row.moderation_action_count,
      options: rows.results.flatMap((option) =>
        option.option_id !== null &&
        option.option_label !== null &&
        option.option_position !== null
          ? [{ id: option.option_id, label: option.option_label, position: option.option_position }]
          : [],
      ),
    };
  };

  const replace = async (
    input: ReplaceDemoPollInput,
  ): Promise<ReplaceDemoPollOutcome> => {
    const successorId = generatePollId();
    const nowMs = Date.now();
    const oldId = input.expectedPollId;
    const eligible = `
      p.id = ?1
      AND p.owner_user_id = ?2
      AND r.reference = ?3
      AND r.poll_id = p.id
      AND r.is_canonical = 1
      AND p.poll_type = 'multiple_choice'
      AND p.question = 'Best day for a long weekend?'
      AND p.result_visibility = 'live'
      AND p.multi_select_enabled = 0
      AND COALESCE(p.min_selections, 1) = 1
      AND COALESCE(p.max_selections, 1) = 1
      AND p.session_checks_enabled = 1
      AND p.ip_checks_enabled = 0
      AND p.voter_codes_enabled = 0
      AND p.captcha_enabled = 1
      AND p.vpn_blocking_enabled = 0
      AND p.deadline_ms IS NULL
      AND p.closed_at_ms IS NULL
      AND p.discovery_state IN ('unlisted', 'listed')
      AND EXISTS (SELECT 1 FROM vote v WHERE v.poll_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM moderation_action ma WHERE ma.poll_id = p.id)
      AND (SELECT COUNT(*) FROM poll_option po WHERE po.poll_id = p.id) = 3
      AND EXISTS (SELECT 1 FROM poll_option po WHERE po.poll_id = p.id AND po.position = 0 AND po.label = 'Friday')
      AND EXISTS (SELECT 1 FROM poll_option po WHERE po.poll_id = p.id AND po.position = 1 AND po.label = 'Monday')
      AND EXISTS (SELECT 1 FROM poll_option po WHERE po.poll_id = p.id AND po.position = 2 AND po.label = 'Either works')`;

    const statements = [
      db.prepare(
        `INSERT INTO poll (
          id, owner_user_id, poll_type, question, description,
          result_visibility, discovery_state, session_checks_enabled,
          ip_checks_enabled, voter_codes_enabled, captcha_enabled,
          vpn_blocking_enabled, multi_select_enabled, min_selections,
          max_selections, deadline_ms, closed_at_ms, representation_version,
          created_at_ms, updated_at_ms
        )
        SELECT ?4, p.owner_user_id, p.poll_type, p.question, p.description,
               p.result_visibility, p.discovery_state, p.session_checks_enabled,
               p.ip_checks_enabled, p.voter_codes_enabled, p.captcha_enabled,
               p.vpn_blocking_enabled, p.multi_select_enabled, p.min_selections,
               p.max_selections, p.deadline_ms, NULL,
               p.representation_version + 1, p.created_at_ms, ?5
        FROM poll p
        JOIN poll_reference r ON r.poll_id = p.id
        WHERE ${eligible}`,
      ).bind(oldId, input.ownerUserId, input.reference, successorId, nowMs),
      db.prepare(
        `UPDATE poll_option
         SET poll_id = ?4
         WHERE poll_id = ?1
           AND EXISTS (
             SELECT 1 FROM poll old_poll
             JOIN poll_reference old_reference ON old_reference.poll_id = old_poll.id
             JOIN poll successor ON successor.id = ?4
             WHERE old_poll.id = ?1
               AND old_poll.owner_user_id = ?2
               AND old_reference.reference = ?3
               AND old_reference.poll_id = old_poll.id
               AND successor.owner_user_id = ?2
           )`,
      ).bind(oldId, input.ownerUserId, input.reference, successorId),
      db.prepare(
        `UPDATE poll_reference
         SET poll_id = ?4
         WHERE reference = ?3
           AND poll_id = ?1
           AND EXISTS (
             SELECT 1 FROM poll successor
             WHERE successor.id = ?4 AND successor.owner_user_id = ?2
           )`,
      ).bind(oldId, input.ownerUserId, input.reference, successorId),
      db.prepare(
        `DELETE FROM poll
         WHERE id = ?1
           AND owner_user_id = ?2
           AND EXISTS (
             SELECT 1 FROM poll_reference r
             JOIN poll successor ON successor.id = r.poll_id
             WHERE r.reference = ?3
               AND r.poll_id = ?4
               AND successor.owner_user_id = ?2
           )`,
      ).bind(oldId, input.ownerUserId, input.reference, successorId),
      // Rollback assertion: a partial successor deliberately duplicates the
      // still-present configured reference. D1 aborts and rolls back the
      // complete batch on the known UNIQUE constraint. Complete replacement
      // and untouched/no-successor paths both select zero rows.
      db.prepare(
        `INSERT INTO poll_reference (
           reference, poll_id, kind, is_canonical, created_at_ms
         )
         SELECT ?3, ?4, 'custom', 0, ?5
         FROM poll successor
         WHERE successor.id = ?4
           AND NOT (
             NOT EXISTS (SELECT 1 FROM poll old_poll WHERE old_poll.id = ?1)
             AND EXISTS (
               SELECT 1 FROM poll_reference r
               WHERE r.reference = ?3 AND r.poll_id = ?4 AND r.is_canonical = 1
             )
             AND (SELECT COUNT(*) FROM poll_option po WHERE po.poll_id = ?4) = 3
           )`,
      ).bind(oldId, input.ownerUserId, input.reference, successorId, nowMs),
    ];

    let batch: D1Result[];
    try {
      batch = await db.batch(statements);
    } catch (error) {
      if (
        error instanceof Error &&
        /UNIQUE constraint failed: poll_reference\.reference/.test(error.message)
      ) {
        return { kind: "stale" };
      }
      return { kind: "integrity_failure" };
    }

    const changes = batch.map((result) => result.meta.changes ?? 0);
    const untouched = changes.every((count) => count === 0);
    if (untouched) return { kind: "stale" };
    if (
      changes.length !== 5 ||
      changes[0] < 1 ||
      changes[1] !== 3 ||
      changes[2] !== 1 ||
      changes[3] < 1 ||
      changes[4] !== 0
    ) {
      return { kind: "integrity_failure" };
    }

    const current = await loadByReference(input.reference);
    if (
      current === null ||
      current.pollId !== successorId ||
      current.ownerUserId !== input.ownerUserId
    ) {
      return { kind: "integrity_failure" };
    }
    return {
      kind: "replaced",
      pollId: current.pollId,
      representationVersion: current.representationVersion,
    };
  };

  return { loadByReference, replace };
}
