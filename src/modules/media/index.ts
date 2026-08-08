// Media module — lifecycle policy for adopted and temporary R2 objects.
// Provider-free: D1 and R2 adapters implement these ports (AD-1/AD-19).

import type { Result } from "../../shared/application/index";
import type {
  PollId,
  PollOptionId,
  UserId,
} from "../../shared/domain/index";

export const CLEANUP_BATCH_LIMIT = 100;
export const TEMP_LIST_LIMIT = 1_000;
export const ADOPTION_QUERY_CHUNK_SIZE = 100;
export const TEMP_KEY_MAX_AGE_MS = 24 * 60 * 60 * 1_000;

export type CleanupOutboxRow = {
  id: string;
  r2Key: string;
  enqueuedAtMs: number;
  attempts: number;
};

export type TempObject = {
  key: string;
  uploadedAtMs: number;
};

export type TempObjectPage = {
  objects: TempObject[];
  truncated: boolean;
  cursor?: string;
};

export type CleanupOutboxPort = {
  listDue(limit: number): Promise<CleanupOutboxRow[]>;
  deleteRow(id: string): Promise<void>;
  incrementAttempts(id: string): Promise<void>;
};

export type CleanupObjectPort = {
  deleteObject(key: string): Promise<void>;
};

export type TempObjectPort = CleanupObjectPort & {
  listTempKeys(cursor: string | undefined, limit: number): Promise<TempObjectPage>;
};

export type MediaOwnershipPort = {
  findAdoptedKeys(keys: string[]): Promise<Set<string>>;
};

export type CleanupFailureReporter = (
  phase: "delete" | "remove_row" | "attempt_increment",
  row: CleanupOutboxRow,
  cause: unknown,
) => void;

export async function drainCleanupOutbox(deps: {
  outbox: CleanupOutboxPort;
  objects: CleanupObjectPort;
  onFailure?: CleanupFailureReporter;
}): Promise<{
  selected: number;
  deleted: number;
  failed: number;
  /** True when rows remain beyond this batch for the next cron tick. */
  hasMore: boolean;
}> {
  // Select one past the batch limit so a backlog of exactly the limit does
  // not masquerade as "more work remains".
  const rows = await deps.outbox.listDue(CLEANUP_BATCH_LIMIT + 1);
  const hasMore = rows.length > CLEANUP_BATCH_LIMIT;
  const batch = rows.slice(0, CLEANUP_BATCH_LIMIT);
  let deleted = 0;
  let failed = 0;

  for (const row of batch) {
    // Report the phase that actually failed: "delete" is the R2 object
    // removal, "remove_row" the D1 outbox-row removal. A row-delete failure
    // after a successful object delete is retried next tick; the R2 delete
    // is idempotent, so the replay is safe.
    let objectDeleted = false;
    try {
      await deps.objects.deleteObject(row.r2Key);
      objectDeleted = true;
      await deps.outbox.deleteRow(row.id);
      deleted += 1;
    } catch (cause) {
      failed += 1;
      deps.onFailure?.(objectDeleted ? "remove_row" : "delete", row, cause);
      try {
        await deps.outbox.incrementAttempts(row.id);
      } catch (attemptCause) {
        deps.onFailure?.("attempt_increment", row, attemptCause);
      }
    }
  }

  return { selected: batch.length, deleted, failed, hasMore };
}

export async function sweepTempKeys(deps: {
  objects: TempObjectPort;
  ownership: MediaOwnershipPort;
  nowMs: () => number;
  onDeleteFailure?: (object: TempObject, cause: unknown) => void;
}): Promise<{
  listed: number;
  eligible: number;
  adopted: number;
  deleted: number;
  /** True when unlisted keys remain beyond this scan for the next tick. */
  hasMore: boolean;
}> {
  // Scan one past the list limit so exactly-at-limit backlogs do not read as
  // "more keys remain".
  const SCAN_LIMIT = TEMP_LIST_LIMIT + 1;
  const scanned: TempObject[] = [];
  let cursor: string | undefined;

  do {
    const page = await deps.objects.listTempKeys(
      cursor,
      SCAN_LIMIT - scanned.length,
    );
    scanned.push(...page.objects.slice(0, SCAN_LIMIT - scanned.length));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor !== undefined && scanned.length < SCAN_LIMIT);

  const hasMore = scanned.length > TEMP_LIST_LIMIT;
  const listed = scanned.slice(0, TEMP_LIST_LIMIT);
  const cutoffMs = deps.nowMs() - TEMP_KEY_MAX_AGE_MS;
  const eligible = listed.filter(({ uploadedAtMs }) => uploadedAtMs < cutoffMs);

  // Re-check adoption per chunk immediately before that chunk's deletes, so
  // a key adopted while an earlier chunk was being deleted is never
  // destroyed. A check rejection still fails closed: the run aborts before
  // touching that chunk and every later one.
  let adopted = 0;
  let deleted = 0;
  for (let offset = 0; offset < eligible.length; offset += ADOPTION_QUERY_CHUNK_SIZE) {
    const chunkObjects = eligible.slice(offset, offset + ADOPTION_QUERY_CHUNK_SIZE);
    const chunkAdopted = await deps.ownership.findAdoptedKeys(
      chunkObjects.map(({ key }) => key),
    );
    adopted += chunkAdopted.size;
    for (const object of chunkObjects) {
      if (chunkAdopted.has(object.key)) continue;
      try {
        await deps.objects.deleteObject(object.key);
        deleted += 1;
      } catch (cause) {
        deps.onDeleteFailure?.(object, cause);
      }
    }
  }

  return {
    listed: listed.length,
    eligible: eligible.length,
    adopted,
    deleted,
    hasMore,
  };
}

export type ReplaceOptionImageInput = {
  pollId: PollId;
  ownerUserId: UserId;
  optionId: PollOptionId;
  r2Key: string;
  contentType: string;
  sizeBytes: number;
  altText: string;
  caption: string | null;
};

export type ReplaceOptionImagePersistenceInput = ReplaceOptionImageInput & {
  enqueuedAtMs: number;
};

export type ReplaceOptionImagePort = (
  input: ReplaceOptionImagePersistenceInput,
) => Promise<"replaced" | "locked" | "not_found">;

export async function replaceOptionImage(
  deps: { replaceOptionImage: ReplaceOptionImagePort; nowMs: () => number },
  input: ReplaceOptionImageInput,
): Promise<Result<{ kind: "replaced" }>> {
  let outcome: "replaced" | "locked" | "not_found";
  try {
    outcome = await deps.replaceOptionImage({
      ...input,
      enqueuedAtMs: deps.nowMs(),
    });
  } catch (cause) {
    console.error("image_replacement_failed", {
      pollId: input.pollId,
      optionId: input.optionId,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
    return {
      ok: false,
      error: {
        code: "image_replacement_failed",
        message: "That image wasn't replaced. Nothing changed — try again.",
      },
    };
  }
  if (outcome === "locked") {
    return {
      ok: false,
      error: {
        code: "image_replacement_locked",
        message: "Locked — the first Vote has been cast.",
      },
    };
  }
  if (outcome === "not_found") {
    return {
      ok: false,
      error: {
        code: "image_not_found",
        message: "That image option doesn't exist.",
      },
    };
  }
  return { ok: true, value: { kind: "replaced" } };
}
