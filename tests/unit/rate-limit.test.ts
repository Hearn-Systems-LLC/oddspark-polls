import { describe, expect, it, vi } from "vitest";
import {
  allowVoteSubmission,
  type RateLimitBinding,
} from "../../src/adapters/rate-limit/index";
import { asVoteRateLimitDigest } from "../../src/modules/voting/ip-address";

const VALID_KEY = asVoteRateLimitDigest("ab".repeat(32));
if (VALID_KEY === null) {
  throw new Error("fixture rate-limit digest construction failed");
}

describe("vote rate-limit adapter", () => {
  it("allows a submission when the binding admits its Poll-scoped digest key", async () => {
    const limit = vi.fn().mockResolvedValue({ success: true });
    const binding: RateLimitBinding = { limit };

    await expect(
      allowVoteSubmission(binding, VALID_KEY, "poll-123"),
    ).resolves.toBe(true);
    expect(limit).toHaveBeenCalledWith({
      key: `vote:poll-123:${VALID_KEY}`,
    });
    // Provider key contains only the validated digest — never a raw address.
    expect(String(limit.mock.calls[0]?.[0]?.key)).not.toContain("203.0.113");
    expect(String(limit.mock.calls[0]?.[0]?.key)).not.toContain("v4:");
  });

  it("rejects a submission when the binding exhausts the client allowance", async () => {
    const binding: RateLimitBinding = {
      limit: vi.fn().mockResolvedValue({ success: false }),
    };

    await expect(
      allowVoteSubmission(binding, VALID_KEY, "poll-123"),
    ).resolves.toBe(false);
  });

  it("fails open when the binding is absent or the edge supplies no client key", async () => {
    const limit = vi.fn().mockResolvedValue({ success: false });

    await expect(
      allowVoteSubmission(undefined, VALID_KEY, "poll-123"),
    ).resolves.toBe(true);
    await expect(
      allowVoteSubmission({ limit }, null, "poll-123"),
    ).resolves.toBe(true);
    expect(limit).not.toHaveBeenCalled();
  });

  it("fails open on malformed keys without calling the provider", async () => {
    const limit = vi.fn().mockResolvedValue({ success: false });
    const binding: RateLimitBinding = { limit };

    await expect(
      allowVoteSubmission(
        binding,
        "203.0.113.8" as unknown as typeof VALID_KEY,
        "poll-123",
      ),
    ).resolves.toBe(true);
    await expect(
      allowVoteSubmission(
        binding,
        "not-hex" as unknown as typeof VALID_KEY,
        "poll-123",
      ),
    ).resolves.toBe(true);
    expect(limit).not.toHaveBeenCalled();
  });

  it("fails open when the provider throws", async () => {
    const binding: RateLimitBinding = {
      limit: vi.fn().mockRejectedValue(new Error("provider unavailable")),
    };

    await expect(
      allowVoteSubmission(binding, VALID_KEY, "poll-123"),
    ).resolves.toBe(true);
  });
});
