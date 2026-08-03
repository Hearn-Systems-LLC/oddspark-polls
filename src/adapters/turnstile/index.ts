/**
 * Turnstile outbound adapter (AD-1 / AR-1).
 *
 * Server-side Siteverify only. Never throws with token/secret/provider detail;
 * never logs. Returns provider-neutral proof plus a coarse provider outcome.
 */

import type { HumanChallengeProof, ProviderOutcome } from "../../shared/application/index";

/** Official always-pass visible test site key (public; local/loopback only). */
export const TURNSTILE_ALWAYS_PASS_SITE_KEY = "1x00000000000000000000AA";

const SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const MAX_TOKEN_LENGTH = 2048;
const MAX_BODY_BYTES = 16 * 1024;
const ATTEMPT_TIMEOUT_MS = 5_000;
const EXPECTED_ACTION = "vote";

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

export type { HumanChallengeProof };

export type TurnstileVerifyResult = {
  proof: HumanChallengeProof;
  providerOutcome: ProviderOutcome;
};

export type TurnstileVerifyInput = {
  /** All form values for `cf-turnstile-response` (getAll). */
  responseFields: readonly FormDataEntryValue[];
  secret: string | undefined;
  /** Public site key for the bounded loopback metadata seam only. */
  siteKey: string;
  /** Request hostname from Astro.url.hostname — never client-supplied. */
  hostname: string;
  /** Validated submission UUID used as Siteverify idempotency_key. */
  submissionId: string;
  /** Injected for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
};

function localReject(
  providerOutcome: TurnstileVerifyResult["providerOutcome"],
): TurnstileVerifyResult {
  return { proof: "failed", providerOutcome };
}

/**
 * Extract exactly one well-formed opaque token, or null if local validation fails.
 * Never trims an otherwise valid value before forwarding.
 */
export function extractTurnstileToken(
  responseFields: readonly FormDataEntryValue[],
): string | null {
  if (responseFields.length !== 1) {
    return null;
  }
  const candidate = responseFields[0];
  if (typeof candidate !== "string") {
    return null;
  }
  if (candidate.length < 1 || candidate.length > MAX_TOKEN_LENGTH) {
    return null;
  }
  if (candidate.trim().length === 0) {
    return null;
  }
  return candidate;
}

function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTNAMES.has(hostname);
}

type SiteverifyJson = {
  success?: unknown;
  action?: unknown;
  hostname?: unknown;
  "error-codes"?: unknown;
};

async function readBoundedText(
  response: Response,
  maxBytes: number,
): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) {
    // No body stream — fall back to text with a hard cap via arrayBuffer.
    try {
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > maxBytes) {
        return null;
      }
      return new TextDecoder().decode(buffer);
    } catch {
      return null;
    }
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

/**
 * Verify a Turnstile challenge token via Siteverify.
 * Fail-closed on any unverifiable condition.
 */
export async function verifyTurnstileToken(
  input: TurnstileVerifyInput,
): Promise<TurnstileVerifyResult> {
  const token = extractTurnstileToken(input.responseFields);
  if (token === null) {
    return localReject("skipped");
  }

  if (typeof input.secret !== "string" || input.secret.trim().length === 0) {
    return localReject("error");
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);

  try {
    const body = new URLSearchParams();
    body.set("secret", input.secret);
    body.set("response", token);
    body.set("idempotency_key", input.submissionId);
    // Deliberately omit remoteip and cData (Story 2.2 privacy boundary).

    let response: Response;
    try {
      response = await fetchImpl(SITEVERIFY_URL, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
        signal: controller.signal,
      });
    } catch (cause) {
      if (
        cause instanceof Error &&
        (cause.name === "AbortError" || controller.signal.aborted)
      ) {
        return localReject("timeout");
      }
      return localReject("error");
    }

    if (!response.ok) {
      return localReject("error");
    }

    const text = await readBoundedText(response, MAX_BODY_BYTES);
    if (text === null) {
      return localReject("error");
    }

    let parsed: SiteverifyJson;
    try {
      parsed = JSON.parse(text) as SiteverifyJson;
    } catch {
      return localReject("error");
    }

    if (parsed.success !== true) {
      return localReject("error");
    }

    // Official always-pass test site key: Siteverify returns synthetic success
    // without production action/hostname attestation. Accept only on exact
    // loopback hostnames after success === true.
    if (input.siteKey === TURNSTILE_ALWAYS_PASS_SITE_KEY) {
      if (!isLoopbackHostname(input.hostname)) {
        return localReject("error");
      }
      return { proof: "passed", providerOutcome: "ok" };
    }

    if (parsed.action !== EXPECTED_ACTION) {
      return localReject("error");
    }
    if (parsed.hostname !== input.hostname) {
      return localReject("error");
    }

    return { proof: "passed", providerOutcome: "ok" };
  } finally {
    clearTimeout(timer);
  }
}
