import { describe, expect, it } from "vitest";
import {
  createSignInDestinations,
  isCreatorSurfacePath,
  resolveSignInPageOutcome,
  validateReturnAddress,
} from "../../src/modules/identity/index";

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
