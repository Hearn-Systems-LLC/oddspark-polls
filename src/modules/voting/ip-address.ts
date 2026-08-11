// Provider-free network-identity policy (AD-1 / AD-8 / AD-23).
// Pure Workers-safe normalizer: ASCII address literal → ephemeral claim and
// rate-limit tokens. Never logs, never echoes the source string, never
// depends on Node `net` or third-party packages.

declare const brand: unique symbol;
type Branded<T, B> = T & { readonly [brand]: B };

/** Claim kinds stored in `voter_claim.check_kind`. */
export type VoterClaimCheckKind = "session" | "ip";

/** HMAC purpose domain: claim kinds plus the abuse-floor purpose. */
export type VoteDigestPurpose = VoterClaimCheckKind | "rate_limit" | "revision";

/** Lowercase 64-hex HMAC for Session/IP voter claims (D1). */
export type VoterClaimDigest = Branded<string, "VoterClaimDigest">;

/** Lowercase 64-hex HMAC for the Poll-scoped rate-limit key. */
export type VoteRateLimitDigest = Branded<string, "VoteRateLimitDigest">;
export type RevisionCapabilityDigest = Branded<string, "RevisionCapabilityDigest">;

const HEX_64 = /^[a-f0-9]{64}$/;

export type NormalizedIpIdentity = {
  /** Ephemeral claim token — full IPv4 or IPv6 /64 prefix. */
  claimToken: string;
  /** Ephemeral full-address token for the abuse floor. */
  rateLimitToken: string;
};

export type IpIdentityResult =
  | { ok: true; value: NormalizedIpIdentity }
  | { ok: false; code: "invalid_address" };

const VOTER_CLAIM_KINDS = new Set<string>(["session", "ip"]);
const DIGEST_PURPOSES = new Set<string>(["session", "ip", "rate_limit", "revision"]);

export function isVoterClaimCheckKind(
  value: string,
): value is VoterClaimCheckKind {
  return VOTER_CLAIM_KINDS.has(value);
}

export function isVoteDigestPurpose(value: string): value is VoteDigestPurpose {
  return DIGEST_PURPOSES.has(value);
}

export function isVoterClaimDigest(value: unknown): value is VoterClaimDigest {
  return typeof value === "string" && HEX_64.test(value);
}

export function isVoteRateLimitDigest(
  value: unknown,
): value is VoteRateLimitDigest {
  return typeof value === "string" && HEX_64.test(value);
}
export function asRevisionCapabilityDigest(value: unknown): RevisionCapabilityDigest | null {
  return typeof value === "string" && HEX_64.test(value) ? value as RevisionCapabilityDigest : null;
}

/**
 * Runtime constructor for a claim digest. Returns null when the value is not
 * lowercase 64-hex — never relies on a TypeScript cast as validation.
 */
export function asVoterClaimDigest(value: unknown): VoterClaimDigest | null {
  return isVoterClaimDigest(value) ? value : null;
}

/**
 * Runtime constructor for a rate-limit digest. Same hex contract as claims;
 * the brand prevents claim/limiter mix-ups at compile time.
 */
export function asVoteRateLimitDigest(
  value: unknown,
): VoteRateLimitDigest | null {
  return isVoteRateLimitDigest(value) ? value : null;
}

/**
 * Normalize one ASCII address literal into the two canonical ephemeral tokens.
 * Rejects before parsing unless length is 1..45 (max single IPv6 with a
 * dotted-decimal tail). No trimming of the source string.
 */
export function normalizeIpIdentity(source: string): IpIdentityResult {
  // Bound before any parse work. 45 is the max single IPv6 literal that can
  // carry a dotted-decimal tail (e.g. ffff:ffff:ffff:ffff:ffff:ffff:255.255.255.255).
  if (source.length < 1 || source.length > 45) {
    return { ok: false, code: "invalid_address" };
  }

  // Reject characters that never appear in a single address literal.
  // No whitespace, brackets, zones, ports, commas, or slash prefixes.
  if (/[^0-9a-fA-F:.]/.test(source)) {
    return { ok: false, code: "invalid_address" };
  }
  if (source.includes("%") || source.includes("/") || source.includes("[")) {
    return { ok: false, code: "invalid_address" };
  }

  // IPv4: four decimal octets, no leading zeros except "0".
  if (source.includes(".") && !source.includes(":")) {
    return normalizeIpv4(source);
  }

  // IPv6 (including IPv4-mapped forms with a dotted tail).
  if (source.includes(":")) {
    return normalizeIpv6(source);
  }

  return { ok: false, code: "invalid_address" };
}

function normalizeIpv4(source: string): IpIdentityResult {
  const parts = source.split(".");
  if (parts.length !== 4) {
    return { ok: false, code: "invalid_address" };
  }

  const octets: number[] = [];
  for (const part of parts) {
    if (part.length === 0 || part.length > 3) {
      return { ok: false, code: "invalid_address" };
    }
    // Leading zeros are ambiguous except the single octet "0".
    if (part.length > 1 && part.startsWith("0")) {
      return { ok: false, code: "invalid_address" };
    }
    if (!/^\d+$/.test(part)) {
      return { ok: false, code: "invalid_address" };
    }
    const value = Number(part);
    if (!Number.isInteger(value) || value < 0 || value > 255) {
      return { ok: false, code: "invalid_address" };
    }
    octets.push(value);
  }

  const dotted = octets.join(".");
  return {
    ok: true,
    value: {
      claimToken: `v4:${dotted}`,
      rateLimitToken: `v4-full:${dotted}`,
    },
  };
}

function normalizeIpv6(source: string): IpIdentityResult {
  // Zone identifiers and ports are already rejected by the character class,
  // but double-check no trailing port form snuck in via digits-after-last-colon
  // ambiguity — we only accept pure hex hextets (+ optional dotted IPv4 tail).

  const lower = source.toLowerCase();

  // At most one "::" compression run.
  const compressionRuns = lower.split("::").length - 1;
  if (compressionRuns > 1) {
    return { ok: false, code: "invalid_address" };
  }

  let dottedTail: number[] | null = null;
  let hextetSource = lower;

  // Optional dotted-decimal IPv4 tail (mapped form or ordinary IPv6 tail).
  const lastColon = lower.lastIndexOf(":");
  if (lastColon >= 0) {
    const tail = lower.slice(lastColon + 1);
    if (tail.includes(".")) {
      const v4 = normalizeIpv4(tail);
      if (!v4.ok) {
        return { ok: false, code: "invalid_address" };
      }
      // Reconstruct octets from the canonical dotted form.
      const dotted = v4.value.claimToken.slice("v4:".length);
      dottedTail = dotted.split(".").map(Number);
      hextetSource = lower.slice(0, lastColon + 1);
      // Drop a trailing empty segment marker when the form ends with ":"
      // before the dotted tail (always true here).
    }
  }

  let hextets: string[];
  if (hextetSource.includes("::")) {
    const [leftRaw, rightRaw] = hextetSource.split("::");
    const left = leftRaw === "" ? [] : leftRaw.split(":");
    const right = rightRaw === "" ? [] : rightRaw.split(":");
    // A trailing empty from a trailing ":" (when we sliced before dotted tail)
    // shows up as [""] after split on a string ending with ":".
    const leftParts = left.filter((part, index, arr) => {
      // Keep empty only if it's the sole element from a pure "::" edge — but
      // left/right of "::" when the side is empty is already [].
      return !(part === "" && arr.length === 1 && index === 0);
    });
    const rightParts = right.filter(
      (part, index, arr) =>
        !(part === "" && arr.length === 1 && index === 0),
    );

    // When hextetSource ends with ":" (dotted-tail case), split yields a
    // trailing empty string on the right of the last colon group.
    const cleanLeft =
      dottedTail === null ? leftParts : dropTrailingEmpty(leftParts);
    const cleanRight =
      dottedTail === null ? rightParts : dropTrailingEmpty(rightParts);

    // Dotted IPv4 tail consumes two hextets.
    const tailHextets = dottedTail === null ? 0 : 2;
    const present = cleanLeft.length + cleanRight.length + tailHextets;
    if (present > 8) {
      return { ok: false, code: "invalid_address" };
    }
    const missing = 8 - present;
    // "::" must compress at least one zero hextet. Accepting an eight-hextet
    // address with an extra compression marker creates a second spelling for
    // the same identity.
    if (missing < 1) {
      return { ok: false, code: "invalid_address" };
    }
    const zeros = Array.from({ length: missing }, () => "0");
    hextets = [...cleanLeft, ...zeros, ...cleanRight];
  } else {
    const rawParts = hextetSource.split(":");
    // Only the internal representation of a dotted tail deliberately ends
    // with ":". A trailing colon in an ordinary IPv6 literal is an alias and
    // remains present so validation rejects it.
    const parts =
      dottedTail === null ? rawParts : dropTrailingEmpty(rawParts);
    const tailHextets = dottedTail === null ? 0 : 2;
    if (parts.length + tailHextets !== 8) {
      return { ok: false, code: "invalid_address" };
    }
    hextets = parts;
  }

  // Validate and zero-pad each hextet.
  const expanded: string[] = [];
  for (const part of hextets) {
    if (part.length === 0 || part.length > 4 || !/^[0-9a-f]+$/.test(part)) {
      return { ok: false, code: "invalid_address" };
    }
    expanded.push(part.padStart(4, "0"));
  }

  if (dottedTail !== null) {
    // Append the two hextets from the dotted IPv4 tail.
    const hi = ((dottedTail[0]! << 8) | dottedTail[1]!)
      .toString(16)
      .padStart(4, "0");
    const lo = ((dottedTail[2]! << 8) | dottedTail[3]!)
      .toString(16)
      .padStart(4, "0");
    expanded.push(hi, lo);
  }

  if (expanded.length !== 8) {
    return { ok: false, code: "invalid_address" };
  }

  // IPv4-mapped IPv6: ::ffff:a.b.c.d (and equivalent ::ffff:c000:0201).
  // First 80 bits zero, next 16 bits 0xffff → treat as the embedded IPv4.
  const isMapped =
    expanded[0] === "0000" &&
    expanded[1] === "0000" &&
    expanded[2] === "0000" &&
    expanded[3] === "0000" &&
    expanded[4] === "0000" &&
    expanded[5] === "ffff";

  if (isMapped) {
    const hi = Number.parseInt(expanded[6]!, 16);
    const lo = Number.parseInt(expanded[7]!, 16);
    const a = (hi >> 8) & 0xff;
    const b = hi & 0xff;
    const c = (lo >> 8) & 0xff;
    const d = lo & 0xff;
    const dotted = `${a}.${b}.${c}.${d}`;
    return {
      ok: true,
      value: {
        claimToken: `v4:${dotted}`,
        rateLimitToken: `v4-full:${dotted}`,
      },
    };
  }

  const fullHex = expanded.join("");
  // claimToken: family tag + first four zero-padded hextets (16 hex digits),
  // no separators — the IPv6 /64 prefix.
  const claimHex = fullHex.slice(0, 16);
  return {
    ok: true,
    value: {
      claimToken: `v6:${claimHex}`,
      rateLimitToken: `v6-full:${fullHex}`,
    },
  };
}

function dropTrailingEmpty(parts: string[]): string[] {
  if (parts.length === 1 && parts[0] === "") {
    return [];
  }
  if (parts.length > 0 && parts[parts.length - 1] === "") {
    return parts.slice(0, -1);
  }
  return parts;
}
