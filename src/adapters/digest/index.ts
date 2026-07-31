// WebCrypto digest adapter. Raw browser/network identifiers enter only here;
// callers receive one-way hex digests and never log the inputs or outputs.

import type { PollId } from "../../shared/domain/index";

export const VOTER_COOKIE_NAME = "oddspark.voter";
export const VOTER_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

type DuplicateCheckKind = "session" | "ip";
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

export async function createVoteDigest(
  secret: string,
  input: {
    pollId: PollId;
    checkKind: DuplicateCheckKind;
    token: string;
  },
): Promise<string> {
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
  return toHex(signature);
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

export function createVoterCookie(token: string, requestUrl: string): string {
  if (!/^[a-f0-9]{32}$/.test(token)) {
    throw new Error("Voter token must be a 128-bit lowercase hex value");
  }
  const secure =
    new URL(requestUrl).protocol === "https:" ? "; Secure" : "";
  return `${VOTER_COOKIE_NAME}=${token}; Path=/; Max-Age=${VOTER_COOKIE_MAX_AGE_SECONDS}; HttpOnly; SameSite=Lax${secure}`;
}
