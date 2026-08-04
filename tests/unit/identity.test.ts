import { describe, expect, it } from "vitest";
import {
  createSignInDestinations,
  hasAdministratorCapability,
  isCreatorSurfacePath,
  parseUserRole,
  resolveSignInPageOutcome,
  validateReturnAddress,
  type CreatorPrincipal,
  type CreatorSession,
} from "../../src/modules/identity/index";

const session: CreatorSession = {
  id: "session-id",
  userId: "internal-user-id",
  token: "session-token",
  expiresAt: new Date("2030-01-01T00:00:00.000Z"),
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

describe("return-address policy", () => {
  it.each([
    ["https://evil.example", "/creator"],
    ["//evil.example", "/creator"],
    ["/\\evil", "/creator"],
    ["javascript:alert(1)", "/creator"],
    ["/", "/creator"],
    ["/sign-in", "/creator"],
    ["/creatorish", "/creator"],
    ["", "/creator"],
    [null, "/creator"],
  ])("rejects unsafe return value %j", (value, expected) => {
    expect(validateReturnAddress(value)).toBe(expected);
  });

  it.each([
    ["/creator/new", "/creator/new"],
    ["/creator/new?draft=1", "/creator/new?draft=1"],
    ["/creator#question", "/creator#question"],
  ])("preserves a safe creator-surface path %j", (value, expected) => {
    expect(validateReturnAddress(value)).toBe(expected);
  });

  it("rejects encoded path separators and control characters", () => {
    for (const value of [
      "/%5cevil.example",
      "/%2f%2fevil.example",
      "/%2e%2e//evil.example",
      "/creator\nLocation:https://evil.example",
    ]) {
      expect(validateReturnAddress(value)).toBe("/creator");
    }
  });

  it("rejects an oversized return value that would break the state cookie", () => {
    expect(validateReturnAddress(`/creator?pad=${"a".repeat(4096)}`)).toBe(
      "/creator",
    );
  });

  it("rejects multibyte input whose percent-encoded form exceeds the cap", () => {
    // 500 × "€" is 500 UTF-16 units (passes the raw check) but ~4500 chars
    // once URL-normalized — over the state-cookie budget.
    expect(validateReturnAddress(`/creator/${"€".repeat(500)}`)).toBe(
      "/creator",
    );
  });

  it("matches only the creator route boundary", () => {
    expect(isCreatorSurfacePath("/creator")).toBe(true);
    expect(isCreatorSurfacePath("/creator/new")).toBe(true);
    expect(isCreatorSurfacePath("/creatorish")).toBe(false);
  });
});

describe("sign-in destination policy", () => {
  it("carries a validated creator return through success and denial", () => {
    expect(createSignInDestinations("/creator/new?draft=1")).toEqual({
      callbackURL: "/creator/new?draft=1&outcome=signed-in",
      errorCallbackURL:
        "/sign-in?outcome=denied&return=%2Fcreator%2Fnew%3Fdraft%3D1",
    });
  });

  it("falls back before putting an unsafe return address into either URL", () => {
    expect(createSignInDestinations("https://evil.example")).toEqual({
      callbackURL: "/creator?outcome=signed-in",
      errorCallbackURL: "/sign-in?outcome=denied&return=%2Fcreator",
    });
  });

  it("replaces a supplied outcome marker and preserves the fragment", () => {
    expect(
      createSignInDestinations(
        "/creator?outcome=forged&draft=1#question",
      ).callbackURL,
    ).toBe("/creator?outcome=signed-in&draft=1#question");
  });
});

describe("sign-in outcome policy", () => {
  it("returns the exact denial contract", () => {
    expect(resolveSignInPageOutcome("denied", null)).toEqual({
      title: "That didn't sign you in — Oddspark Polls",
      message:
        "That didn't sign you in. Nothing was created, and nothing was lost — the create form is right where you left it.",
    });
  });

  it("returns the exact expiry contract", () => {
    expect(resolveSignInPageOutcome(null, "expired")).toEqual({
      title: "You've been signed out — Oddspark Polls",
      message:
        "You've been signed out. Sign back in to pick up where you left off.",
    });
  });

  it("ignores unknown outcome parameters", () => {
    expect(resolveSignInPageOutcome("forged", "forged")).toBeNull();
  });
});

describe("administrator capability policy", () => {
  it.each([
    ["creator", "creator"],
    ["administrator", "administrator"],
    [undefined, "creator"],
    [null, "creator"],
    ["admin", "creator"],
    ["ADMINISTRATOR", "creator"],
    [1, "creator"],
    [{ role: "administrator" }, "creator"],
  ] as const)("parses role value %j through the explicit allowlist", (value, expected) => {
    expect(parseUserRole(value)).toBe(expected);
  });

  it("grants capability only from the provider-neutral principal role", () => {
    const principal: CreatorPrincipal = {
      userId: "internal-user-id",
      role: "administrator",
      session,
    };

    expect(hasAdministratorCapability(principal)).toBe(true);
    expect(
      hasAdministratorCapability({
        ...principal,
        role: "creator",
        email: "administrator@example.test",
        providerId: "github",
        providerAccountId: "administrator",
      } as CreatorPrincipal & {
        email: string;
        providerId: string;
        providerAccountId: string;
      }),
    ).toBe(false);
    expect(hasAdministratorCapability(null)).toBe(false);
  });
});
