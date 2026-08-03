// Inbound delivery helper for the trusted Cloudflare client identity.
// Selects and normalizes the address at the edge boundary; never accepts
// FormData, query params, X-Forwarded-For, X-Real-IP, cookies, or client JS.
// Returns only canonical in-memory tokens (or a static failure code) — no
// error payload carries a header value.

import {
  normalizeIpIdentity,
  type NormalizedIpIdentity,
} from "../modules/voting/ip-address";

export type ClientAddressResult =
  | { ok: true; value: NormalizedIpIdentity }
  | { ok: false; code: "identity_unavailable" };

/**
 * Class E (240.0.0.0/4) pseudo-IPv4 addresses used when Cloudflare's
 * "Pseudo IPv4 / Overwrite Headers" mode rewrites CF-Connecting-IP.
 */
function isClassEPseudoIpv4(address: string): boolean {
  const normalized = normalizeIpIdentity(address);
  if (
    !normalized.ok ||
    normalized.value.rateLimitToken !== `v4-full:${address}`
  ) {
    return false;
  }
  const first = Number(address.slice(0, address.indexOf(".")));
  return first >= 240 && first <= 255;
}

/**
 * Select the trusted client identity from Cloudflare delivery headers.
 *
 * Normally uses `CF-Connecting-IP`. Under Pseudo IPv4 "Overwrite Headers",
 * recovers a valid `CF-Connecting-IPv6` only when the primary header is a
 * Class E pseudo address. Missing/malformed guarded pairs fail as one
 * unavailable identity. Never logs header values.
 */
export function selectCloudflareClientAddress(
  headers: Headers,
): ClientAddressResult {
  const primary = headers.get("cf-connecting-ip");
  if (primary === null || primary.length === 0) {
    return { ok: false, code: "identity_unavailable" };
  }

  // Pseudo IPv4 overwrite: primary is Class E; recover real IPv6.
  if (isClassEPseudoIpv4(primary)) {
    const ipv6 = headers.get("cf-connecting-ipv6");
    if (ipv6 === null || ipv6.length === 0) {
      return { ok: false, code: "identity_unavailable" };
    }
    // Preserve the source-family distinction through normalization: mapped
    // IPv6 is valid even though it produces v4 tokens, but a plain IPv4 value
    // in the auxiliary IPv6 header is not a valid guarded pair.
    if (!ipv6.includes(":")) {
      return { ok: false, code: "identity_unavailable" };
    }
    const recovered = normalizeIpIdentity(ipv6);
    if (!recovered.ok) {
      return { ok: false, code: "identity_unavailable" };
    }
    // Recovered identity must be IPv6 (or mapped IPv4 as v4 tokens). A
    // Class-E pair with a non-address IPv6 header is unavailable.
    return { ok: true, value: recovered.value };
  }

  // Non-Class-E: use the primary header; ignore auxiliary/spoofed IPv6.
  const normalized = normalizeIpIdentity(primary);
  if (!normalized.ok) {
    return { ok: false, code: "identity_unavailable" };
  }
  return { ok: true, value: normalized.value };
}
