import { describe, expect, it } from "vitest";
import {
  createDemoResetFlash,
  verifyDemoResetFlash,
} from "../../src/lib/demo-reset-flash";
import type { PollId, UserId } from "../../src/shared/domain/index";

const input = {
  sessionId: "session-1",
  ownerUserId: "owner-1" as UserId,
  pollId: "poll-1" as PollId,
  representationVersion: 8,
};
const secret = "test-secret-that-is-long-enough";

describe("Demo reset causal flash", () => {
  it("round-trips only for the same session, owner, Poll, and version", async () => {
    const token = await createDemoResetFlash(secret, input);
    await expect(verifyDemoResetFlash(secret, token, input)).resolves.toBe(8);
    await expect(
      verifyDemoResetFlash(secret, token, { ...input, sessionId: "other" }),
    ).resolves.toBeNull();
    await expect(
      verifyDemoResetFlash(secret, token, { ...input, pollId: "poll-2" as PollId }),
    ).resolves.toBeNull();
  });

  it("rejects malformed, forged, and lower-current-version tokens", async () => {
    const token = await createDemoResetFlash(secret, input);
    await expect(verifyDemoResetFlash(secret, `${token}x`, input)).resolves.toBeNull();
    await expect(verifyDemoResetFlash(secret, "garbage", input)).resolves.toBeNull();
    await expect(
      verifyDemoResetFlash(secret, token, { ...input, representationVersion: 7 }),
    ).resolves.toBeNull();
  });
});
