// Purpose-shaped D1 adapter for Voter Code inventory and management (AD-25).
// Separate from the general D1 adapter to keep concerns isolated.
// Owner authorization and Poll resolution happen before reading code facts;
// missing/non-owner targets are indistinguishable (404).

import type {
  GenerateVoterCodesDeps,
  StoredVoterCodeBatch,
  VoterCodeInventory,
  VoterCodeProjection,
} from "../../modules/voting/voter-codes";
import type { PollId, VoterCodeId } from "../../shared/domain/index";

export type VoterCodesD1Adapter = {
  generateDeps: (ownerId: string) => GenerateVoterCodesDeps;
  getInventory: (pollId: PollId, ownerId: string) => Promise<VoterCodeInventory | null>;
};

export function createVoterCodesD1Adapter(db: D1Database): VoterCodesD1Adapter {
  const adapter: VoterCodesD1Adapter = {
    generateDeps(ownerId: string): GenerateVoterCodesDeps {
      return {
        async findPollOwner(pollId: PollId) {
          const row = await db.prepare(
            "SELECT owner_user_id, voter_codes_enabled, closed_at_ms, deadline_ms FROM poll WHERE id = ?1",
          ).bind(pollId).first<{ owner_user_id: string; voter_codes_enabled: number; closed_at_ms: number | null; deadline_ms: number | null }>();
          if (!row) return null;
          return {
            ownerId: row.owner_user_id,
            voterCodesEnabled: row.voter_codes_enabled === 1,
            closedAtMs: row.closed_at_ms,
            deadlineMs: row.deadline_ms,
          };
        },

        async findExistingBatch(pollId: PollId, batchId: string) {
          const rows = await db.prepare(
            "SELECT id, code FROM voter_code WHERE poll_id = ?1 AND batch_id = ?2 ORDER BY position",
          ).bind(pollId, batchId).all<{ id: string; code: string }>();
          if (rows.results.length === 0) return null;

          const codeIds = rows.results.map((r) => r.id);
          const redeemedSet = new Set<string>();
          if (codeIds.length > 0) {
            const placeholders = codeIds.map(() => "?").join(",");
            const redeemedRows = await db.prepare(
              `SELECT code_id FROM voter_code_redemptions WHERE code_id IN (${placeholders})`,
            ).bind(...codeIds).all<{ code_id: string }>();
            for (const row of redeemedRows.results) {
              redeemedSet.add(row.code_id);
            }
          }

          return {
            batchId,
            count: rows.results.length,
            codes: rows.results.map((r) => ({
              id: r.id as VoterCodeId,
              code: r.code,
              redeemed: redeemedSet.has(r.id),
            })),
          };
        },

        async countExistingCodes(pollId: PollId) {
          const row = await db.prepare(
            "SELECT COUNT(*) AS cnt FROM voter_code WHERE poll_id = ?1",
          ).bind(pollId).first<{ cnt: number }>();
          return row?.cnt ?? 0;
        },

        generateRandomBytes(length: number) {
          const bytes = new Uint8Array(length);
          crypto.getRandomValues(bytes);
          return bytes;
        },

        generateId() {
          return crypto.randomUUID();
        },

        async persistBatch(input) {
          const statements = input.codes.map((entry) =>
            db.prepare(
              "INSERT INTO voter_code (id, poll_id, batch_id, position, code, created_at_ms) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            ).bind(entry.id, input.pollId, input.batchId, entry.position, entry.code, input.createdAtMs),
          );
          await db.batch(statements);
        },

        nowMs() {
          return Date.now();
        },

        async getInventory(pollId: PollId) {
          return adapter.getInventory(pollId, ownerId);
        },
      };
    },

    async getInventory(pollId: PollId, ownerId: string) {
      const pollRow = await db.prepare(
        "SELECT owner_user_id FROM poll WHERE id = ?1",
      ).bind(pollId).first<{ owner_user_id: string }>();
      if (!pollRow || pollRow.owner_user_id !== ownerId) return null;

      const codes = await db.prepare(
        `SELECT vc.id, vc.code, CASE WHEN vcr.code_id IS NOT NULL THEN 1 ELSE 0 END AS redeemed
         FROM voter_code vc
         LEFT JOIN voter_code_redemptions vcr ON vcr.code_id = vc.id
         WHERE vc.poll_id = ?1
         ORDER BY vc.created_at_ms, vc.batch_id, vc.position`,
      ).bind(pollId).all<{ id: string; code: string; redeemed: number }>();

      const projections: VoterCodeProjection[] = codes.results.map((r) => ({
        id: r.id as VoterCodeId,
        code: r.code,
        redeemed: r.redeemed === 1,
      }));

      const redeemedCount = projections.filter((c) => c.redeemed).length;

      return {
        pollId,
        total: projections.length,
        redeemed: redeemedCount,
        codes: projections,
      };
    },
  };
  return adapter;
}

