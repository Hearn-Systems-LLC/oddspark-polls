/**
 * Cloudflare Rate Limiting adapter (AD-16).
 *
 * This is an abuse-floor hint, never an integrity boundary. Missing client
 * identity, a missing binding in local/test runtimes, and provider failures all
 * fail open; D1 constraints remain responsible for exactly-once correctness.
 */

export type RateLimitBinding = {
  limit(input: { key: string }): Promise<{ success: boolean }>;
};

export async function allowVoteSubmission(
  binding: RateLimitBinding | undefined,
  clientKey: string | null,
  pollId: string,
): Promise<boolean> {
  if (!binding || !clientKey) {
    return true;
  }

  try {
    const result = await binding.limit({
      key: `vote:${pollId}:${clientKey}`,
    });
    return result.success;
  } catch {
    return true;
  }
}
