import server from "@astrojs/cloudflare/entrypoints/server";
import { createMediaPersistence } from "./adapters/d1/index";
import { createR2MediaStorage } from "./adapters/r2/index";
import {
  drainCleanupOutbox,
  sweepTempKeys,
} from "./modules/media/index";

type CleanupRun = {
  drain: Awaited<ReturnType<typeof drainCleanupOutbox>> | null;
  sweep: Awaited<ReturnType<typeof sweepTempKeys>> | null;
};

export async function runMediaCleanup(
  env: Pick<Cloudflare.Env, "DB" | "MEDIA">,
  nowMs: () => number = () => Date.now(),
): Promise<CleanupRun> {
  const persistence = createMediaPersistence(env.DB);
  const storage = createR2MediaStorage(env.MEDIA);
  const result: CleanupRun = { drain: null, sweep: null };

  try {
    result.drain = await drainCleanupOutbox({
      outbox: persistence,
      objects: storage,
      onFailure(phase, row, cause) {
        console.error("media_cleanup_row_failed", {
          phase,
          cleanupId: row.id,
          r2Key: row.r2Key,
          attempts: row.attempts,
          cause: cause instanceof Error ? cause.message : String(cause),
        });
      },
    });
    if (result.drain.selected === 100) {
      console.warn("media_cleanup_drain_bound_reached", {
        processed: result.drain.selected,
        note: "Additional cleanup rows may remain for the next cron tick.",
      });
    }
  } catch (cause) {
    console.error("media_cleanup_drain_failed", {
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }

  try {
    result.sweep = await sweepTempKeys({
      objects: storage,
      ownership: persistence,
      nowMs,
      onDeleteFailure(object, cause) {
        console.error("media_temp_delete_failed", {
          r2Key: object.key,
          cause: cause instanceof Error ? cause.message : String(cause),
        });
      },
    });
    if (result.sweep.listed === 1_000) {
      console.warn("media_temp_sweep_bound_reached", {
        listed: result.sweep.listed,
        note: "Additional temporary keys may remain for the next cron tick.",
      });
    }
  } catch (cause) {
    // Fail closed: an adoption-check failure leaves the complete page intact.
    console.error("media_temp_sweep_failed", {
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }

  return result;
}

export default {
  fetch: server.fetch,
  async scheduled(
    _controller: ScheduledController,
    env: Cloudflare.Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    const result = await runMediaCleanup(env);
    console.log("media_cleanup_completed", result);
  },
};
