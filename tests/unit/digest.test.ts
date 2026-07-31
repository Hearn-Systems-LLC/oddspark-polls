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
  it("uses deterministic HMAC-SHA256 that a raw-token lookup cannot reproduce", async () => {
    const input = {
      pollId: "poll-a" as PollId,
      checkKind: "session" as const,
      token: "raw-browser-token",
    };
    const digest = await createVoteDigest("test-vote-digest-secret", input);
    const repeated = await createVoteDigest("test-vote-digest-secret", input);

    expect(digest).toBe(repeated);
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    // Keyed, not a plain hash: the digest must differ from an unkeyed
    // SHA-256 of the scoped message anyone holding the token could compute.
    const unkeyed = await sha256Hex(
      JSON.stringify([input.pollId, input.checkKind, input.token]),
    );
    expect(digest).not.toBe(unkeyed);
  });

  it("derives a different digest for the same input under a different secret", async () => {
    const input = {
      pollId: "poll-a" as PollId,
      checkKind: "session" as const,
      token: "raw-browser-token",
    };
    const first = await createVoteDigest("first-secret", input);
    const second = await createVoteDigest("second-secret", input);

    expect(first).not.toBe(second);
  });

  it("matches a known-answer HMAC-SHA256 vector", async () => {
    // Expected value computed once with Node's crypto:
    //   createHmac("sha256", "known-answer-secret")
    //     .update('["poll-a","session","raw-browser-token"]')
    // A construction like plain sha256(secret ‖ payload) fails this test.
    await expect(
      createVoteDigest("known-answer-secret", {
        pollId: "poll-a" as PollId,
        checkKind: "session",
        token: "raw-browser-token",
      }),
    ).resolves.toBe(
      "40edf52c6edc3b5fbe7c78ee41e548cfdb35b4229d3eb9e109efc499c681d4b7",
    );
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

  it("refuses a whitespace-only secret instead of hashing with a fallback", async () => {
    await expect(
      createVoteDigest("   \n\t  ", {
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
  it("hex-encodes the 128 bits from its random source", () => {
    const token = createVoterToken(() =>
      Uint8Array.from([
        0, 1, 2, 3, 4, 5, 6, 7,
        8, 9, 10, 11, 12, 13, 14, 15,
      ]),
    );

    expect(token).toBe("000102030405060708090a0b0c0d0e0f");
    expect(token).toMatch(/^[a-f0-9]{32}$/);
  });

  it("mints distinct tokens from the default crypto source", () => {
    expect(createVoterToken()).not.toBe(createVoterToken());
  });

  it("rejects a random source that does not return exactly 128 bits", () => {
    expect(() => createVoterToken(() => new Uint8Array(15))).toThrow(
      "128 bits",
    );
    expect(() => createVoterToken(() => new Uint8Array(17))).toThrow(
      "128 bits",
    );
  });

  it("rejects a malformed token when serializing the cookie", () => {
    expect(() =>
      createVoterCookie("not-a-hex-token", "https://polls.example.test/poll"),
    ).toThrow("128-bit lowercase hex");
    expect(() =>
      createVoterCookie(
        "000102030405060708090A0B0C0D0E0F",
        "https://polls.example.test/poll",
      ),
    ).toThrow("128-bit lowercase hex");
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
