import { describe, expect, it, vi } from "vitest";
import {
  allowVoteSubmission,
  type RateLimitBinding,
} from "../../src/adapters/rate-limit/index";

describe("vote rate-limit adapter", () => {
  it("allows a submission when the binding admits its Poll-scoped client key", async () => {
    const limit = vi.fn().mockResolvedValue({ success: true });
    const binding: RateLimitBinding = { limit };

    await expect(
      allowVoteSubmission(binding, "203.0.113.8", "poll-123"),
    ).resolves.toBe(true);
    expect(limit).toHaveBeenCalledWith({
      key: "vote:poll-123:203.0.113.8",
    });
  });

  it("rejects a submission when the binding exhausts the client allowance", async () => {
    const binding: RateLimitBinding = {
      limit: vi.fn().mockResolvedValue({ success: false }),
    };

    await expect(
      allowVoteSubmission(binding, "203.0.113.8", "poll-123"),
    ).resolves.toBe(false);
  });

  it("fails open when the binding is absent or the edge supplies no client key", async () => {
    const limit = vi.fn().mockResolvedValue({ success: false });

    await expect(
      allowVoteSubmission(undefined, "203.0.113.8", "poll-123"),
    ).resolves.toBe(true);
    await expect(
      allowVoteSubmission({ limit }, null, "poll-123"),
    ).resolves.toBe(true);
    expect(limit).not.toHaveBeenCalled();
  });

  it("fails open when the provider throws", async () => {
    const binding: RateLimitBinding = {
      limit: vi.fn().mockRejectedValue(new Error("provider unavailable")),
    };

    await expect(
      allowVoteSubmission(binding, "203.0.113.8", "poll-123"),
    ).resolves.toBe(true);
  });
});
