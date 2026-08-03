// Trust badge copy + selection (Story 2.4, UX-DR7). Pure logic for
// trust-badge.astro — keyed by SecurityToggle so rendering never branches on
// rendered copy (AD-23; Story 2.1 decision D2).

import {
  SECURITY_TOGGLES,
  type PollSecurityToggles,
  type SecurityToggle,
} from "../shared/domain/index";

// Voter-terms strings (EXPERIENCE.md § Trust Surfaces — the copy authority).
// Stored uppercase as canonical copy; CSS uppercase is belt-and-braces for the
// label-caps-lg type treatment, not the copy source.
export const TRUST_BADGE_COPY: Record<SecurityToggle, string> = {
  sessionChecks: "ONE VOTE PER BROWSER",
  ipChecks: "ONE VOTE PER NETWORK",
  voterCodes: "INVITE CODE REQUIRED",
  captcha: "HUMAN CHECK ON SUBMIT",
  vpnBlocking: "NO VPN OR DATACENTER CONNECTIONS",
};

// Toggles that actually protect the count today. FR-17 (Voter Codes) and
// FR-19 (VPN Blocking) persist as columns but enforce nothing — Story 2.1
// decision D1; Epic 8 stories 8.2/8.3 add `voterCodes`/`vpnBlocking` here when
// enforcement lands. The badge never claims more than is true (§ Trust
// Surfaces), so it renders the enforced subset only.
export const ENFORCED_TOGGLES: readonly SecurityToggle[] = [
  "sessionChecks",
  "ipChecks",
  "captcha",
];

// Voter-terms strings for enabled + enforced toggles, in SECURITY_TOGGLES
// vocabulary order (locked by tests/unit/shared-kernel.test.ts).
export function trustBadgeItems(toggles: PollSecurityToggles): string[] {
  return SECURITY_TOGGLES.filter(
    (toggle) => ENFORCED_TOGGLES.includes(toggle) && toggles[toggle],
  ).map((toggle) => TRUST_BADGE_COPY[toggle]);
}
