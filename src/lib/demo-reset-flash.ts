import type { PollId, UserId } from "../shared/domain/index";

export const DEMO_RESET_FLASH_COOKIE_NAME = "oddspark.demo_reset_flash";
const DOMAIN = "oddspark-demo-reset-flash:v1";

export type DemoResetFlashContext = {
  sessionId: string;
  ownerUserId: UserId;
  pollId: PollId;
  /** On creation: reset version. On verification: current persisted version. */
  representationVersion: number;
};

const encoder = new TextEncoder();

function toBase64Url(value: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(value)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function message(context: Omit<DemoResetFlashContext, "representationVersion">, version: number): string {
  return [DOMAIN, context.sessionId, context.ownerUserId, context.pollId, String(version)].join(":");
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function createDemoResetFlash(
  secret: string,
  context: DemoResetFlashContext,
): Promise<string> {
  if (!secret || !context.sessionId || context.representationVersion < 1) {
    throw new Error("Demo reset flash context is incomplete");
  }
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret),
    encoder.encode(message(context, context.representationVersion)),
  );
  return `${context.representationVersion}.${toBase64Url(signature)}`;
}

export async function verifyDemoResetFlash(
  secret: string,
  token: string,
  current: DemoResetFlashContext,
): Promise<number | null> {
  const separator = token.indexOf(".");
  if (separator <= 0 || separator === token.length - 1) return null;
  const version = Number(token.slice(0, separator));
  const encodedSignature = token.slice(separator + 1);
  if (
    !Number.isSafeInteger(version) ||
    version < 1 ||
    version > current.representationVersion ||
    !/^[A-Za-z0-9_-]{43}$/.test(encodedSignature)
  ) return null;
  try {
    const padded = encodedSignature.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - encodedSignature.length % 4) % 4);
    const binary = atob(padded);
    const signature = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const valid = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(secret),
      signature,
      encoder.encode(message(current, version)),
    );
    return valid ? version : null;
  } catch {
    return null;
  }
}
