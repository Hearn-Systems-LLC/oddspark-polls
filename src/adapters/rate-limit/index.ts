/**
 * Cloudflare Rate Limiting adapter (AD-16).
 *
 * This is an abuse-floor hint, never an integrity boundary. Missing client
 * identity, a missing binding in local/test runtimes, malformed keys, and
 * provider failures all fail open; D1 constraints remain responsible for
 * exactly-once correctness. The provider key carries only a branded
 * Poll-scoped rate-limit digest — never a raw or normalized address.
 */

import {
  isVoteRateLimitDigest,
  type VoteRateLimitDigest,
} from "../../modules/voting/ip-address";

export type RateLimitBinding = {
  limit(input: { key: string }): Promise<{ success: boolean }>;
};

export async function allowVoteSubmission(
  binding: RateLimitBinding | undefined,
  clientKey: VoteRateLimitDigest | null,
  pollId: string,
): Promise<boolean> {
  if (!binding || clientKey === null) {
    return true;
  }

  // Runtime-reject non-64-hex values without calling the provider.
  if (!isVoteRateLimitDigest(clientKey)) {
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
