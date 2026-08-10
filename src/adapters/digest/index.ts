// WebCrypto digest adapter. Raw browser/network identifiers enter only here;
// callers receive one-way branded hex digests and never log the inputs or outputs.

import type { PollId } from "../../shared/domain/index";
import {
  asVoteRateLimitDigest,
  asVoterClaimDigest,
  asRevisionCapabilityDigest,
  isVoteDigestPurpose,
  type VoteDigestPurpose,
  type VoteRateLimitDigest,
  type VoterClaimCheckKind,
  type VoterClaimDigest,
  type RevisionCapabilityDigest,
} from "../../modules/voting/ip-address";

export const VOTER_COOKIE_NAME = "oddspark.voter";
export const VOTER_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

type RandomBytes = (length: number) => Uint8Array;

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function sha256Hex(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value);
  return toHex(await crypto.subtle.digest("SHA-256", encoded));
}

/**
 * Purpose-separated HMAC-SHA256 of JSON `[pollId, purpose, token]`.
 * Returns a branded digest: claim purposes → `VoterClaimDigest`,
 * `rate_limit` → `VoteRateLimitDigest`. Never reuses one purpose for another.
 */
export async function createVoteDigest(
  secret: string,
  input: {
    pollId: PollId;
    checkKind: VoterClaimCheckKind;
    token: string;
  },
): Promise<VoterClaimDigest>;
export async function createVoteDigest(
  secret: string,
  input: {
    pollId: PollId;
    checkKind: "rate_limit";
    token: string;
  },
): Promise<VoteRateLimitDigest>;
export async function createVoteDigest(
  secret: string,
  input: { pollId: PollId; checkKind: "revision"; token: string },
): Promise<RevisionCapabilityDigest>;
export async function createVoteDigest(
  secret: string,
  input: {
    pollId: PollId;
    checkKind: VoteDigestPurpose;
    token: string;
  },
): Promise<VoterClaimDigest | VoteRateLimitDigest | RevisionCapabilityDigest>;
export async function createVoteDigest(
  secret: string,
  input: {
    pollId: PollId;
    checkKind: VoteDigestPurpose;
    token: string;
  },
): Promise<VoterClaimDigest | VoteRateLimitDigest | RevisionCapabilityDigest> {
  if (!isVoteDigestPurpose(input.checkKind)) {
    throw new Error("Unsupported vote digest purpose");
  }
  if (secret.trim().length === 0) {
    throw new Error("VOTE_DIGEST_SECRET is required");
  }

  const encodedSecret = new TextEncoder().encode(secret);
  const key = await crypto.subtle.importKey(
    "raw",
    encodedSecret,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const scopedMessage = JSON.stringify([
    input.pollId,
    input.checkKind,
    input.token,
  ]);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(scopedMessage),
  );
  const hex = toHex(signature);

  if (input.checkKind === "rate_limit") {
    const branded = asVoteRateLimitDigest(hex);
    if (branded === null) {
      throw new Error(
        "digest construction produced an invalid rate-limit digest",
      );
    }
    return branded;
  }
  if (input.checkKind === "revision") {
    const branded = asRevisionCapabilityDigest(hex);
    if (branded === null) throw new Error("digest construction produced an invalid revision digest");
    return branded;
  }

  const branded = asVoterClaimDigest(hex);
  if (branded === null) {
    throw new Error("digest construction produced an invalid claim digest");
  }
  return branded;
}

export function createVoterToken(
  randomBytes: RandomBytes = (length) =>
    crypto.getRandomValues(new Uint8Array(length)),
): string {
  const bytes = randomBytes(16);
  if (bytes.byteLength !== 16) {
    throw new Error("Voter token source must return exactly 128 bits");
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export function createRevisionCapability(
  randomBytes: RandomBytes = (length) => crypto.getRandomValues(new Uint8Array(length)),
): string {
  const bytes = randomBytes(16);
  if (bytes.byteLength !== 16) throw new Error("Revision capability source must return exactly 128 bits");
  const binary = String.fromCharCode(...bytes);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function createVoterCookie(token: string, requestUrl: string): string {
  if (!/^[a-f0-9]{32}$/.test(token)) {
    throw new Error("Voter token must be a 128-bit lowercase hex value");
  }
  const secure =
    new URL(requestUrl).protocol === "https:" ? "; Secure" : "";
  return `${VOTER_COOKIE_NAME}=${token}; Path=/; Max-Age=${VOTER_COOKIE_MAX_AGE_SECONDS}; HttpOnly; SameSite=Lax${secure}`;
}
