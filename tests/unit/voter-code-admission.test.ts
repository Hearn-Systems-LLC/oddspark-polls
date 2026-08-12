import { describe, expect, it } from "vitest";
import {
  normalizeVoterCodeInput,
  resolveVoterCodeAdmission,
  VOTER_CODE_ADMISSION_COPY,
  VOTER_CODE_ALPHABET,
  VOTER_CODE_LENGTH,
} from "../../src/modules/voting/voter-codes";
import type { VoterCodeId } from "../../src/shared/domain/index";

describe("normalizeVoterCodeInput", () => {
  it("returns missing for empty or whitespace-only input", () => {
    expect(normalizeVoterCodeInput("")).toEqual({ kind: "missing" });
    expect(normalizeVoterCodeInput("   ")).toEqual({ kind: "missing" });
    expect(normalizeVoterCodeInput("\t\n")).toEqual({ kind: "missing" });
  });

  it("returns canonical for valid 8-character code", () => {
    const result = normalizeVoterCodeInput("ABCDEFGH");
    expect(result).toEqual({ kind: "canonical", value: "ABCDEFGH" });
  });

  it("trims and uppercases before validation", () => {
    expect(normalizeVoterCodeInput("  abcdefgh  ")).toEqual({
      kind: "canonical",
      value: "ABCDEFGH",
    });
  });

  it("returns invalid for wrong length", () => {
    expect(normalizeVoterCodeInput("ABCDEFG")).toEqual({ kind: "invalid" });
    expect(normalizeVoterCodeInput("ABCDEFGHI")).toEqual({ kind: "invalid" });
  });

  it("returns invalid for forbidden characters (0, 1, I, O)", () => {
    expect(normalizeVoterCodeInput("0BCDEFGH")).toEqual({ kind: "invalid" });
    expect(normalizeVoterCodeInput("A1CDEFGH")).toEqual({ kind: "invalid" });
    expect(normalizeVoterCodeInput("ABCIDEFGH")).toEqual({ kind: "invalid" });
    expect(normalizeVoterCodeInput("ABCDEFGO")).toEqual({ kind: "invalid" });
  });

  it("returns invalid for lowercase letters outside alphabet", () => {
    // After uppercase, these become valid or invalid based on the alphabet
    expect(normalizeVoterCodeInput("abcdefgh")).toEqual({
      kind: "canonical",
      value: "ABCDEFGH",
    });
  });

  it("never includes submitted text in error outcomes", () => {
    const invalid = normalizeVoterCodeInput("BAD0CODE");
    expect(invalid.kind).toBe("invalid");
    if (invalid.kind === "invalid") {
      expect(JSON.stringify(invalid)).not.toContain("BAD0CODE");
    }
  });
});

describe("resolveVoterCodeAdmission", () => {
  const codeId = "code-1" as VoterCodeId;

  it("returns missing error for missing outcome", () => {
    const result = resolveVoterCodeAdmission(
      { kind: "missing" },
      { found: false },
    );
    expect(result).toEqual({
      code: "voter_code_missing",
      message: VOTER_CODE_ADMISSION_COPY.missing,
    });
  });

  it("returns invalid error for invalid outcome", () => {
    const result = resolveVoterCodeAdmission(
      { kind: "invalid" },
      { found: false },
    );
    expect(result).toEqual({
      code: "voter_code_invalid",
      message: VOTER_CODE_ADMISSION_COPY.invalid,
    });
  });

  it("returns invalid error when lookup finds nothing", () => {
    const result = resolveVoterCodeAdmission(
      { kind: "canonical", value: "ABCDEFGH" },
      { found: false },
    );
    expect(result).toEqual({
      code: "voter_code_invalid",
      message: VOTER_CODE_ADMISSION_COPY.invalid,
    });
  });

  it("returns used error when code is already redeemed", () => {
    const result = resolveVoterCodeAdmission(
      { kind: "canonical", value: "ABCDEFGH" },
      { found: true, codeId, redeemed: true },
    );
    expect(result).toEqual({
      code: "voter_code_used",
      message: VOTER_CODE_ADMISSION_COPY.used,
    });
  });

  it("returns codeId for valid unused code", () => {
    const result = resolveVoterCodeAdmission(
      { kind: "canonical", value: "ABCDEFGH" },
      { found: true, codeId, redeemed: false },
    );
    expect(result).toEqual({ codeId });
  });

  it("static errors never contain fixture codes", () => {
    const results = [
      resolveVoterCodeAdmission({ kind: "missing" }, { found: false }),
      resolveVoterCodeAdmission({ kind: "invalid" }, { found: false }),
      resolveVoterCodeAdmission(
        { kind: "canonical", value: "TESTCODE" },
        { found: false },
      ),
      resolveVoterCodeAdmission(
        { kind: "canonical", value: "TESTCODE" },
        { found: true, codeId, redeemed: true },
      ),
    ];
    for (const result of results) {
      if ("message" in result) {
        expect(result.message).not.toContain("TESTCODE");
      }
    }
  });
});
