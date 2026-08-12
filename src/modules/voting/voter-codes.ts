// Voting — Voter Code generation and management policy (AD-19, AD-25).
// Provider-free: no Astro, no D1, no Web APIs. Adapters supply persistence,
// random bytes, IDs, and clock.

import type { Result } from "../../shared/application/index";
import type { PollId, VoterCodeId } from "../../shared/domain/index";

export const VOTER_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ" as const;
export const VOTER_CODE_LENGTH = 8;
export const VOTER_CODE_BATCH_MIN = 1;
export const VOTER_CODE_BATCH_MAX = 100;
export const VOTER_CODE_BATCH_DEFAULT = 25;
export const VOTER_CODE_TOTAL_CAP = 1000;

export const VOTER_CODE_COPY = {
  countInvalid: "Enter a whole number from 1 to 100.",
  generationClosed: "This Poll is closed. Existing codes are still available.",
  generationDisabled: "Turn on Voter Codes before generating a batch.",
  limitReached: "This Poll can have up to 1,000 Voter Codes.",
  batchConflict: "That generation request changed. Reload and try again.",
  generationExhausted: "Codes weren't generated. Try again.",
  generationFailed: "Codes weren't generated. Try again.",
} as const;

export const VOTER_CODE_ADMISSION_COPY = {
  missing: "This Poll needs a Voter Code. The Creator hands them out; we can't issue one.",
  invalid: "That code doesn't work on this Poll. Check for a typo \u2014 codes are short and unforgiving.",
  used: "That code has already been used. Each one works exactly once. Either someone got there first, or you did.",
} as const;

export type VoterCodeAdmissionOutcome =
  | { kind: "missing" }
  | { kind: "invalid" }
  | { kind: "canonical"; value: string };

export type VoterCodeLookupResult =
  | { found: false }
  | { found: true; codeId: VoterCodeId; redeemed: boolean };

export type VoterCodeAdmissionError =
  | { code: "voter_code_missing"; message: string }
  | { code: "voter_code_invalid"; message: string }
  | { code: "voter_code_used"; message: string };

const VALID_CODE_REGEX = /^[2-9A-HJ-NP-Z]{8}$/;

export function normalizeVoterCodeInput(raw: string): VoterCodeAdmissionOutcome {
  const trimmed = raw.trim().toUpperCase();
  if (trimmed.length === 0) {
    return { kind: "missing" };
  }
  if (!VALID_CODE_REGEX.test(trimmed)) {
    return { kind: "invalid" };
  }
  return { kind: "canonical", value: trimmed };
}

export function resolveVoterCodeAdmission(
  outcome: VoterCodeAdmissionOutcome,
  lookup: VoterCodeLookupResult,
): VoterCodeAdmissionError | { codeId: VoterCodeId } {
  if (outcome.kind === "missing") {
    return { code: "voter_code_missing", message: VOTER_CODE_ADMISSION_COPY.missing };
  }
  if (outcome.kind === "invalid") {
    return { code: "voter_code_invalid", message: VOTER_CODE_ADMISSION_COPY.invalid };
  }
  if (!lookup.found) {
    return { code: "voter_code_invalid", message: VOTER_CODE_ADMISSION_COPY.invalid };
  }
  if (lookup.redeemed) {
    return { code: "voter_code_used", message: VOTER_CODE_ADMISSION_COPY.used };
  }
  return { codeId: lookup.codeId };
}

export type VoterCodeRedemptionContribution = {
  kind: "voter_code_redemption";
  codeId: VoterCodeId;
  voteId: string;
  redeemedAtMs: number;
};

export type VoterCodeProjection = {
  id: VoterCodeId;
  code: string;
  redeemed: boolean;
};

export type VoterCodeInventory = {
  pollId: PollId;
  total: number;
  redeemed: number;
  codes: VoterCodeProjection[];
};

export type GenerateVoterCodesInput = {
  pollId: PollId;
  ownerId: string;
  count: number;
  batchId: string;
};

export type StoredVoterCodeBatch = {
  batchId: string;
  count: number;
  codes: VoterCodeProjection[];
};

export type GenerateVoterCodesDeps = {
  findPollOwner: (pollId: PollId) => Promise<{ ownerId: string; voterCodesEnabled: boolean; closedAtMs: number | null; deadlineMs: number | null } | null>;
  findExistingBatch: (pollId: PollId, batchId: string) => Promise<StoredVoterCodeBatch | null>;
  countExistingCodes: (pollId: PollId) => Promise<number>;
  generateRandomBytes: (length: number) => Uint8Array;
  generateId: () => string;
  persistBatch: (input: { pollId: PollId; batchId: string; codes: { id: string; code: string; position: number }[]; createdAtMs: number }) => Promise<void>;
  nowMs: () => number;
  getInventory: (pollId: PollId) => Promise<VoterCodeInventory | null>;
};

export function isValidBatchCount(count: unknown): count is number {
  return typeof count === "number" && Number.isInteger(count) && count >= VOTER_CODE_BATCH_MIN && count <= VOTER_CODE_BATCH_MAX;
}

export function generateCodesFromBytes(
  count: number,
  randomBytes: Uint8Array,
): string[] {
  if (randomBytes.length < count * VOTER_CODE_LENGTH) {
    throw new Error("Insufficient random bytes provided for code generation.");
  }
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    let code = "";
    for (let j = 0; j < VOTER_CODE_LENGTH; j++) {
      const byteIndex = i * VOTER_CODE_LENGTH + j;
      code += VOTER_CODE_ALPHABET[randomBytes[byteIndex] & 31];
    }
    codes.push(code);
  }
  return codes;
}

export async function generateVoterCodes(
  deps: GenerateVoterCodesDeps,
  input: GenerateVoterCodesInput,
): Promise<Result<VoterCodeInventory>> {
  if (!isValidBatchCount(input.count)) {
    return failure("voter_code_count_invalid", VOTER_CODE_COPY.countInvalid);
  }

  const poll = await deps.findPollOwner(input.pollId);
  if (!poll) {
    return failure("poll_not_found", "Poll not found.");
  }
  if (poll.ownerId !== input.ownerId) {
    return failure("poll_not_found", "Poll not found.");
  }

  const existing = await deps.findExistingBatch(input.pollId, input.batchId);
  if (existing) {
    if (existing.count !== input.count) {
      return failure("voter_code_batch_conflict", VOTER_CODE_COPY.batchConflict);
    }
    const inventory = await buildInventory(deps, input.pollId);
    if (!inventory.ok) return inventory;
    return { ok: true, value: inventory.value };
  }

  if (!poll.voterCodesEnabled) {
    return failure("voter_code_generation_disabled", VOTER_CODE_COPY.generationDisabled);
  }

  const nowMs = deps.nowMs();
  if (poll.closedAtMs !== null || (poll.deadlineMs !== null && poll.deadlineMs <= nowMs)) {
    return failure("voter_code_generation_closed", VOTER_CODE_COPY.generationClosed);
  }

  const existingCount = await deps.countExistingCodes(input.pollId);
  if (existingCount + input.count > VOTER_CODE_TOTAL_CAP) {
    return failure("voter_code_limit_reached", VOTER_CODE_COPY.limitReached);
  }

  const maxRetries = 3;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const bytesNeeded = input.count * VOTER_CODE_LENGTH;
    const randomBytes = deps.generateRandomBytes(bytesNeeded);
    const rawCodes = generateCodesFromBytes(input.count, randomBytes);

    const uniqueCodes = new Set(rawCodes);
    if (uniqueCodes.size !== rawCodes.length) {
      continue;
    }

    const codeEntries = rawCodes.map((code, position) => ({
      id: deps.generateId(),
      code,
      position,
    }));

    try {
      await deps.persistBatch({
        pollId: input.pollId,
        batchId: input.batchId,
        codes: codeEntries,
        createdAtMs: nowMs,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("voter_code_poll_closed")) {
        return failure("voter_code_generation_closed", VOTER_CODE_COPY.generationClosed);
      }
      if (message.includes("voter_code_toggle_disabled")) {
        return failure("voter_code_generation_disabled", VOTER_CODE_COPY.generationDisabled);
      }
      if (message.includes("voter_code_total_cap")) {
        return failure("voter_code_limit_reached", VOTER_CODE_COPY.limitReached);
      }
      if (message.includes("UNIQUE constraint failed") || message.includes("voter_code_poll_code_idx")) {
        // A concurrent exact-batch race lost at the batch-position unique index.
        // Re-adjudicate: if the winning batch matches our (pollId, batchId),
        // return its inventory. Otherwise treat as a random-code collision and retry.
        const winningBatch = await deps.findExistingBatch(input.pollId, input.batchId);
        if (winningBatch) {
          if (winningBatch.count !== input.count) {
            return failure("voter_code_batch_conflict", VOTER_CODE_COPY.batchConflict);
          }
          const inventory = await buildInventory(deps, input.pollId);
          if (!inventory.ok) return inventory;
          return { ok: true, value: inventory.value };
        }
        continue;
      }
      return failure("voter_code_generation_failed", VOTER_CODE_COPY.generationFailed);
    }

    const inventory = await buildInventory(deps, input.pollId);
    if (!inventory.ok) return inventory;
    return { ok: true, value: inventory.value };
  }

  return failure("voter_code_generation_exhausted", VOTER_CODE_COPY.generationExhausted);
}

async function buildInventory(
  deps: Pick<GenerateVoterCodesDeps, "getInventory">,
  pollId: PollId,
): Promise<Result<VoterCodeInventory>> {
  const inventory = await deps.getInventory(pollId);
  if (!inventory) {
    return failure("poll_not_found", "Poll not found.");
  }
  return { ok: true, value: inventory };
}

function failure(code: string, message: string): Result<never> {
  return { ok: false, error: { code, message } };
}
