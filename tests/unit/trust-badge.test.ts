import { describe, expect, it } from "vitest";
import {
  ENFORCED_TOGGLES,
  TRUST_BADGE_COPY,
  trustBadgeItems,
} from "../../src/components/trust-badge";
import { SECURITY_TOGGLES } from "../../src/shared/domain/index";

const ALL_ON = {
  sessionChecks: true,
  ipChecks: true,
  voterCodes: true,
  captcha: true,
  vpnBlocking: true,
} as const;
const ALL_OFF = {
  sessionChecks: false,
  ipChecks: false,
  voterCodes: false,
  captcha: false,
  vpnBlocking: false,
} as const;

describe("trust badge copy catalog (Story 2.4, EXPERIENCE.md § Trust Surfaces)", () => {
  it("maps every Security Toggle to its exact voter-terms string", () => {
    expect(TRUST_BADGE_COPY).toEqual({
      sessionChecks: "ONE VOTE PER BROWSER",
      ipChecks: "ONE VOTE PER NETWORK",
      voterCodes: "INVITE CODE REQUIRED",
      captcha: "HUMAN CHECK ON SUBMIT",
      vpnBlocking: "NO VPN OR DATACENTER CONNECTIONS",
    });
  });

  it("declares exactly the four enforced toggles (FR-19 VPN deferred to Epic 8.3)", () => {
    expect(ENFORCED_TOGGLES).toEqual(["sessionChecks", "ipChecks", "voterCodes", "captcha"]);
  });
});

describe("trustBadgeItems", () => {
  it("returns an empty array when every Toggle is off (SM-C1: the badge is absent)", () => {
    expect(trustBadgeItems(ALL_OFF)).toEqual([]);
  });

  it("returns an empty array when only unenforced Toggles are on", () => {
    expect(
      trustBadgeItems({ ...ALL_OFF, vpnBlocking: true }),
    ).toEqual([]);
  });

  it("lists items in SECURITY_TOGGLES order, never in enabled-set order", () => {
    expect(
      trustBadgeItems({ ...ALL_OFF, captcha: true, sessionChecks: true }),
    ).toEqual(["ONE VOTE PER BROWSER", "HUMAN CHECK ON SUBMIT"]);
    expect(
      trustBadgeItems({ ...ALL_OFF, ipChecks: true, sessionChecks: true }),
    ).toEqual(["ONE VOTE PER BROWSER", "ONE VOTE PER NETWORK"]);
  });

  it("lists the full enforced set when every Toggle is on", () => {
    expect(trustBadgeItems(ALL_ON)).toEqual([
      "ONE VOTE PER BROWSER",
      "ONE VOTE PER NETWORK",
      "INVITE CODE REQUIRED",
      "HUMAN CHECK ON SUBMIT",
    ]);
  });

  it("emits one item per enforced toggle with no duplicates", () => {
    const items = trustBadgeItems(ALL_ON);
    expect(items.length).toBe(ENFORCED_TOGGLES.length);
    expect(new Set(items).size).toBe(items.length);
    expect(items.every((item) => typeof item === "string" && item.length > 0)).toBe(
      true,
    );
    // Order contract: items follow the shared-kernel vocabulary order.
    const order = SECURITY_TOGGLES.filter(
      (t) => (ENFORCED_TOGGLES as readonly string[]).includes(t) && ALL_ON[t],
    ).map((t) => TRUST_BADGE_COPY[t]);
    expect(items).toEqual(order);
  });
});
