import { describe, expect, it } from "vitest";
import {
  VOTER_COOKIE_MAX_AGE_SECONDS,
  VOTER_COOKIE_NAME,
  createVoteDigest,
  createVoterCookie,
  createVoterToken,
  sha256Hex,
} from "../../src/adapters/digest/index";
import type { PollId } from "../../src/shared/domain/index";

describe("vote digest adapter", () => {
  it("uses deterministic HMAC-SHA256 without exposing the raw token", async () => {
    const token = "raw-browser-token";
    const digest = await createVoteDigest(
      "test-vote-digest-secret",
      {
        pollId: "poll-a" as PollId,
        checkKind: "session",
        token,
      },
    );
    const repeated = await createVoteDigest(
      "test-vote-digest-secret",
      {
        pollId: "poll-a" as PollId,
        checkKind: "session",
        token,
      },
    );

    expect(digest).toBe(repeated);
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(digest).not.toContain(token);
  });

  it("scopes one token independently by Poll and check kind", async () => {
    const secret = "test-vote-digest-secret";
    const token = "same-browser-token";
    const sessionA = await createVoteDigest(secret, {
      pollId: "poll-a" as PollId,
      checkKind: "session",
      token,
    });
    const sessionB = await createVoteDigest(secret, {
      pollId: "poll-b" as PollId,
      checkKind: "session",
      token,
    });
    const ipA = await createVoteDigest(secret, {
      pollId: "poll-a" as PollId,
      checkKind: "ip",
      token,
    });

    expect(new Set([sessionA, sessionB, ipA]).size).toBe(3);
  });

  it("refuses an empty secret instead of hashing with a fallback", async () => {
    await expect(
      createVoteDigest("", {
        pollId: "poll-a" as PollId,
        checkKind: "session",
        token: "token",
      }),
    ).rejects.toThrow("VOTE_DIGEST_SECRET is required");
  });

  it("provides canonical SHA-256 for normalized payload hashing", async () => {
    await expect(sha256Hex("abc")).resolves.toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("first-party voter token", () => {
  it("creates a 128-bit URL-safe token", () => {
    const token = createVoterToken(() =>
      Uint8Array.from([
        0, 1, 2, 3, 4, 5, 6, 7,
        8, 9, 10, 11, 12, 13, 14, 15,
      ]),
    );

    expect(token).toBe("000102030405060708090a0b0c0d0e0f");
    expect(token).toMatch(/^[a-f0-9]{32}$/);
  });

  it("serializes the one-year HttpOnly SameSite cookie with Secure on HTTPS", () => {
    expect(VOTER_COOKIE_NAME).toBe("oddspark.voter");
    expect(VOTER_COOKIE_MAX_AGE_SECONDS).toBe(31_536_000);
    expect(
      createVoterCookie(
        "000102030405060708090a0b0c0d0e0f",
        "https://polls.example.test/poll",
      ),
    ).toBe(
      "oddspark.voter=000102030405060708090a0b0c0d0e0f; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax; Secure",
    );
    expect(
      createVoterCookie(
        "000102030405060708090a0b0c0d0e0f",
        "http://localhost:4321/poll",
      ),
    ).not.toContain("; Secure");
  });
});
