import { describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  VOTER_COOKIE_MAX_AGE_SECONDS,
  VOTER_COOKIE_NAME,
  createVoteDigest,
  createVoterCookie,
  createVoterToken,
  sha256Hex,
} from "../../src/adapters/digest/index";
import {
  isVoteRateLimitDigest,
  isVoterClaimDigest,
  normalizeIpIdentity,
  type VoteDigestPurpose,
  type VoteRateLimitDigest,
  type VoterClaimDigest,
} from "../../src/modules/voting/ip-address";
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
    expect(isVoterClaimDigest(sessionA)).toBe(true);
    expect(isVoterClaimDigest(ipA)).toBe(true);
  });

  it("pins purpose-separated claim and rate_limit known-answer vectors", async () => {
    const secret = "known-answer-secret";
    const pollId = "poll-a" as PollId;

    await expect(
      createVoteDigest(secret, {
        pollId,
        checkKind: "ip",
        token: "v4:192.0.2.1",
      }),
    ).resolves.toBe(
      "5a83d0d00875c677d7c8ae10a9f3b4cd46fe39d0bd4d6f74321737a0cedf33c1",
    );
    await expect(
      createVoteDigest(secret, {
        pollId,
        checkKind: "rate_limit",
        token: "v4-full:192.0.2.1",
      }),
    ).resolves.toBe(
      "e5ce5dc0cf0302fe18efdcdfd53cc60b9e8de0692d390b49571db5624cd63592",
    );

    const ipV6 = await createVoteDigest(secret, {
      pollId,
      checkKind: "ip",
      token: "v6:20010db800000000",
    });
    const rateA = await createVoteDigest(secret, {
      pollId,
      checkKind: "rate_limit",
      token: "v6-full:20010db8000000000000000000000001",
    });
    const rateB = await createVoteDigest(secret, {
      pollId,
      checkKind: "rate_limit",
      token: "v6-full:20010db8000000000000000000000002",
    });

    expect(ipV6).toBe(
      "2f9975e608a9610fdbdd0345a0024c94d8376a624194800fdba31ee62acd54f0",
    );
    expect(rateA).toBe(
      "4d61dbfb564faf00499b857ec5664cb13cc55ea6e5d53745b5bec1911ccf6891",
    );
    expect(rateB).toBe(
      "de6c422519f96a08269aab90a9bf4dd77ea4e1339e2cae2d86ac7acd306f17d4",
    );
    expect(isVoteRateLimitDigest(rateA)).toBe(true);
    expect(rateA).not.toBe(rateB);
    expect(rateA).not.toBe(ipV6);
  });

  it("returns the canonical output brand for each digest purpose", async () => {
    const claim = await createVoteDigest("brand-secret", {
      pollId: "poll-a" as PollId,
      checkKind: "ip",
      token: "v4:192.0.2.1",
    });
    const rateLimit = await createVoteDigest("brand-secret", {
      pollId: "poll-a" as PollId,
      checkKind: "rate_limit",
      token: "v4-full:192.0.2.1",
    });

    expectTypeOf(claim).toEqualTypeOf<VoterClaimDigest>();
    expectTypeOf(rateLimit).toEqualTypeOf<VoteRateLimitDigest>();
  });

  it("rejects an unknown purpose before invoking WebCrypto signing", async () => {
    const sign = vi.spyOn(crypto.subtle, "sign");
    try {
      await expect(
        createVoteDigest("purpose-secret", {
          pollId: "poll-a" as PollId,
          // Deliberately hostile runtime value at the typed adapter boundary.
          checkKind: "unknown" as unknown as VoteDigestPurpose,
          token: "raw-token",
        }),
      ).rejects.toThrow("Unsupported vote digest purpose");
      expect(sign).not.toHaveBeenCalled();
    } finally {
      sign.mockRestore();
    }
  });

  it("proves two IPv6 hosts in one /64 share the claim digest but not the limiter digest", async () => {
    const secret = "test-vote-digest-secret";
    const pollId = "poll-a" as PollId;
    const a = normalizeIpIdentity("2001:db8::1");
    const b = normalizeIpIdentity("2001:db8::2");
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) {
      return;
    }

    const claimA = await createVoteDigest(secret, {
      pollId,
      checkKind: "ip",
      token: a.value.claimToken,
    });
    const claimB = await createVoteDigest(secret, {
      pollId,
      checkKind: "ip",
      token: b.value.claimToken,
    });
    const limitA = await createVoteDigest(secret, {
      pollId,
      checkKind: "rate_limit",
      token: a.value.rateLimitToken,
    });
    const limitB = await createVoteDigest(secret, {
      pollId,
      checkKind: "rate_limit",
      token: b.value.rateLimitToken,
    });

    expect(claimA).toBe(claimB);
    expect(limitA).not.toBe(limitB);
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
