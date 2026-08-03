import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  asVoteRateLimitDigest,
  asVoterClaimDigest,
  isVoteDigestPurpose,
  isVoteRateLimitDigest,
  isVoterClaimCheckKind,
  isVoterClaimDigest,
  normalizeIpIdentity,
} from "../../src/modules/voting/ip-address";

describe("normalizeIpIdentity", () => {
  it("canonicalizes a valid IPv4 address into v4 and v4-full tokens", () => {
    expect(normalizeIpIdentity("192.0.2.1")).toEqual({
      ok: true,
      value: {
        claimToken: "v4:192.0.2.1",
        rateLimitToken: "v4-full:192.0.2.1",
      },
    });
  });

  it("canonicalizes arbitrary IPv4 octets and their mapped IPv6 spellings", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 255 }), {
          minLength: 4,
          maxLength: 4,
        }),
        (octets) => {
          const dotted = octets.join(".");
          const expected = {
            ok: true as const,
            value: {
              claimToken: `v4:${dotted}`,
              rateLimitToken: `v4-full:${dotted}`,
            },
          };
          expect(normalizeIpIdentity(dotted)).toEqual(expected);
          expect(normalizeIpIdentity(`::ffff:${dotted}`)).toEqual(expected);
        },
      ),
    );
  });

  it("accepts the single-octet zero and rejects leading-zero ambiguity", () => {
    expect(normalizeIpIdentity("0.0.0.0")).toEqual({
      ok: true,
      value: {
        claimToken: "v4:0.0.0.0",
        rateLimitToken: "v4-full:0.0.0.0",
      },
    });
    expect(normalizeIpIdentity("192.0.2.01").ok).toBe(false);
    expect(normalizeIpIdentity("192.0.02.1").ok).toBe(false);
    expect(normalizeIpIdentity("01.0.0.1").ok).toBe(false);
  });

  it("rejects out-of-range octets and non-decimal forms", () => {
    expect(normalizeIpIdentity("192.0.2.256").ok).toBe(false);
    expect(normalizeIpIdentity("192.0.2.-1").ok).toBe(false);
    expect(normalizeIpIdentity("192.0.2").ok).toBe(false);
    expect(normalizeIpIdentity("192.0.2.1.1").ok).toBe(false);
    expect(normalizeIpIdentity("0xC0.0.2.1").ok).toBe(false);
    expect(normalizeIpIdentity("3232235777").ok).toBe(false);
  });

  it("expands compressed and mixed-case IPv6 into stable /64 claim tokens", () => {
    const a = normalizeIpIdentity("2001:db8::1");
    const b = normalizeIpIdentity("2001:0DB8:0000:0000:0000:0000:0000:0001");
    expect(a).toEqual({
      ok: true,
      value: {
        claimToken: "v6:20010db800000000",
        rateLimitToken: "v6-full:20010db8000000000000000000000001",
      },
    });
    expect(b).toEqual(a);
  });

  it("canonicalizes arbitrary full IPv6 and rejects zero-hextet compression aliases", () => {
    fc.assert(
      fc.property(
        fc.tuple(
          fc.integer({ min: 1, max: 0xffff }),
          fc.array(fc.integer({ min: 0, max: 0xffff }), {
            minLength: 7,
            maxLength: 7,
          }),
          fc.integer({ min: 0, max: 8 }),
        ),
        ([first, remainder, compressionBoundary]) => {
          const values = [first, ...remainder];
          const hextets = values.map((value) => value.toString(16));
          const expanded = values
            .map((value) => value.toString(16).padStart(4, "0"))
            .join("");
          expect(normalizeIpIdentity(hextets.join(":"))).toEqual({
            ok: true,
            value: {
              claimToken: `v6:${expanded.slice(0, 16)}`,
              rateLimitToken: `v6-full:${expanded}`,
            },
          });

          const zeroCompressionAlias = `${hextets
            .slice(0, compressionBoundary)
            .join(":")}::${hextets.slice(compressionBoundary).join(":")}`;
          expect(normalizeIpIdentity(zeroCompressionAlias).ok).toBe(false);
        },
      ),
    );
  });

  it("rejects zero-hextet compression and lone trailing-colon aliases", () => {
    const rejected = [
      "1:2:3:4:5:6:7::8",
      "::1:2:3:4:5:6:7:8",
      "1:2:3:4:5:6:7:8::",
      "1:2:3:4:5:6::192.0.2.1",
      "1:2:3:4:5:6:7:8:",
      "2001:db8::1:",
    ];
    for (const source of rejected) {
      expect(normalizeIpIdentity(source)).toEqual({
        ok: false,
        code: "invalid_address",
      });
    }
  });

  it("shares the claim token across one /64 while keeping distinct full tokens", () => {
    const hostA = normalizeIpIdentity("2001:db8:0:0::1");
    const hostB = normalizeIpIdentity("2001:db8:0:0::2");
    expect(hostA.ok && hostB.ok).toBe(true);
    if (!hostA.ok || !hostB.ok) {
      return;
    }
    expect(hostA.value.claimToken).toBe(hostB.value.claimToken);
    expect(hostA.value.claimToken).toBe("v6:20010db800000000");
    expect(hostA.value.rateLimitToken).not.toBe(hostB.value.rateLimitToken);
    expect(hostA.value.rateLimitToken).toBe(
      "v6-full:20010db8000000000000000000000001",
    );
    expect(hostB.value.rateLimitToken).toBe(
      "v6-full:20010db8000000000000000000000002",
    );
  });

  it("canonicalizes IPv4-mapped IPv6 (dotted and hex) to the embedded v4 tokens", () => {
    expect(normalizeIpIdentity("::ffff:192.0.2.1")).toEqual({
      ok: true,
      value: {
        claimToken: "v4:192.0.2.1",
        rateLimitToken: "v4-full:192.0.2.1",
      },
    });
    expect(normalizeIpIdentity("::ffff:c000:0201")).toEqual({
      ok: true,
      value: {
        claimToken: "v4:192.0.2.1",
        rateLimitToken: "v4-full:192.0.2.1",
      },
    });
    expect(normalizeIpIdentity("0:0:0:0:0:ffff:192.0.2.1")).toEqual({
      ok: true,
      value: {
        claimToken: "v4:192.0.2.1",
        rateLimitToken: "v4-full:192.0.2.1",
      },
    });
  });

  it("treats a valid dotted-decimal tail outside ::ffff/96 as ordinary IPv6", () => {
    const result = normalizeIpIdentity("2001:db8::192.0.2.1");
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.claimToken.startsWith("v6:")).toBe(true);
    expect(result.value.rateLimitToken.startsWith("v6-full:")).toBe(true);
    expect(result.value.claimToken).not.toContain("192");
    expect(result).toEqual(
      normalizeIpIdentity("2001:db8:0:0:0:0:192.0.2.1"),
    );
  });

  it("rejects list, port, bracket, zone, whitespace, and malformed shapes", () => {
    const rejected = [
      "192.0.2.1,10.0.0.1",
      "192.0.2.1:8080",
      "[2001:db8::1]",
      "2001:db8::1%eth0",
      " 192.0.2.1",
      "192.0.2.1 ",
      "2001:db8:::1",
      "2001:db8:gggg::1",
      "2001:db8:12345::1",
      "",
      ":",
      ":::",
    ];
    for (const source of rejected) {
      const result = normalizeIpIdentity(source);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("invalid_address");
        // Errors carry only a stable code — never the rejected input payload.
        expect(result).toEqual({ ok: false, code: "invalid_address" });
        expect(Object.keys(result)).toEqual(["ok", "code"]);
      }
    }
  });

  it("rejects addresses longer than 45 characters without echoing input", () => {
    const overlong = "ffff:ffff:ffff:ffff:ffff:ffff:255.255.255.255x";
    expect(overlong.length).toBeGreaterThan(45);
    const result = normalizeIpIdentity(overlong);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(JSON.stringify(result)).not.toContain(overlong);
    }
  });

  it("accepts the 45-character max dotted-tail IPv6 form", () => {
    const max = "ffff:ffff:ffff:ffff:ffff:ffff:255.255.255.255";
    expect(max.length).toBe(45);
    const result = normalizeIpIdentity(max);
    expect(result.ok).toBe(true);
  });
});

describe("claim and digest contracts", () => {
  it("validates claim kinds and digest purposes at runtime", () => {
    expect(isVoterClaimCheckKind("session")).toBe(true);
    expect(isVoterClaimCheckKind("ip")).toBe(true);
    expect(isVoterClaimCheckKind("rate_limit")).toBe(false);
    expect(isVoteDigestPurpose("session")).toBe(true);
    expect(isVoteDigestPurpose("ip")).toBe(true);
    expect(isVoteDigestPurpose("rate_limit")).toBe(true);
    expect(isVoteDigestPurpose("other")).toBe(false);
  });

  it("constructs branded digests only for lowercase 64-hex", () => {
    const good = "a".repeat(64);
    expect(asVoterClaimDigest(good)).toBe(good);
    expect(asVoteRateLimitDigest(good)).toBe(good);
    expect(asVoterClaimDigest("A".repeat(64))).toBeNull();
    expect(asVoterClaimDigest("short")).toBeNull();
    expect(asVoterClaimDigest(`${"a".repeat(63)}g`)).toBeNull();
    expect(asVoteRateLimitDigest("not-hex")).toBeNull();
  });

  it("rejects hostile non-string digest values without coercion", () => {
    const good = "a".repeat(64);
    const hostile: unknown[] = [
      null,
      undefined,
      1n,
      64,
      true,
      Symbol("digest"),
      new String(good),
      Object.create(null),
      {
        toString() {
          throw new Error("must not coerce digest input");
        },
      },
    ];

    for (const value of hostile) {
      expect(isVoterClaimDigest(value)).toBe(false);
      expect(isVoteRateLimitDigest(value)).toBe(false);
      expect(asVoterClaimDigest(value)).toBeNull();
      expect(asVoteRateLimitDigest(value)).toBeNull();
    }
  });
});
