import { describe, expect, it } from "vitest";
import {
  generateCodesFromBytes,
  isValidBatchCount,
  VOTER_CODE_ALPHABET,
  VOTER_CODE_LENGTH,
  VOTER_CODE_BATCH_MIN,
  VOTER_CODE_BATCH_MAX,
  VOTER_CODE_TOTAL_CAP,
} from "../../src/modules/voting/voter-codes";

describe("voter code generation", () => {
  it("generates codes of exact length from the 32-symbol alphabet", () => {
    const bytes = new Uint8Array(VOTER_CODE_LENGTH);
    bytes.fill(0);
    const codes = generateCodesFromBytes(1, bytes);
    expect(codes).toHaveLength(1);
    expect(codes[0]).toHaveLength(VOTER_CODE_LENGTH);
    for (const char of codes[0]) {
      expect(VOTER_CODE_ALPHABET).toContain(char);
    }
  });

  it("maps each byte to a symbol via byte & 31 (rejection-free 5-bit)", () => {
    const bytes = new Uint8Array(VOTER_CODE_LENGTH);
    for (let i = 0; i < VOTER_CODE_LENGTH; i++) {
      bytes[i] = i;
    }
    const codes = generateCodesFromBytes(1, bytes);
    for (let i = 0; i < VOTER_CODE_LENGTH; i++) {
      expect(codes[0][i]).toBe(VOTER_CODE_ALPHABET[i & 31]);
    }
  });

  it("generates N codes of correct length", () => {
    const count = 25;
    const bytes = new Uint8Array(count * VOTER_CODE_LENGTH);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = i % 256;
    }
    const codes = generateCodesFromBytes(count, bytes);
    expect(codes).toHaveLength(count);
    for (const code of codes) {
      expect(code).toHaveLength(VOTER_CODE_LENGTH);
    }
  });

  it("avoids 0, 1, I, and O in the alphabet", () => {
    expect(VOTER_CODE_ALPHABET).not.toContain("0");
    expect(VOTER_CODE_ALPHABET).not.toContain("1");
    expect(VOTER_CODE_ALPHABET).not.toContain("I");
    expect(VOTER_CODE_ALPHABET).not.toContain("O");
    expect(VOTER_CODE_ALPHABET).toHaveLength(32);
  });

  it("provides exactly 40 bits of entropy per code (8 symbols × 5 bits)", () => {
    expect(VOTER_CODE_LENGTH).toBe(8);
    expect(Math.log2(VOTER_CODE_ALPHABET.length)).toBe(5);
    expect(VOTER_CODE_LENGTH * 5).toBe(40);
  });

  it("throws an error when randomBytes length is insufficient", () => {
    const bytes = new Uint8Array(4); // needs 8
    expect(() => generateCodesFromBytes(1, bytes)).toThrow("Insufficient random bytes");
  });
});

describe("batch count validation", () => {
  it("accepts whole integers from 1 to 100", () => {
    expect(isValidBatchCount(1)).toBe(true);
    expect(isValidBatchCount(25)).toBe(true);
    expect(isValidBatchCount(100)).toBe(true);
  });

  it("rejects zero, negatives, floats, and values over 100", () => {
    expect(isValidBatchCount(0)).toBe(false);
    expect(isValidBatchCount(-1)).toBe(false);
    expect(isValidBatchCount(1.5)).toBe(false);
    expect(isValidBatchCount(101)).toBe(false);
    expect(isValidBatchCount(NaN)).toBe(false);
    expect(isValidBatchCount(Infinity)).toBe(false);
  });

  it("rejects non-number types", () => {
    expect(isValidBatchCount("25")).toBe(false);
    expect(isValidBatchCount(null)).toBe(false);
    expect(isValidBatchCount(undefined)).toBe(false);
  });
});

describe("constants", () => {
  it("has correct bounds", () => {
    expect(VOTER_CODE_BATCH_MIN).toBe(1);
    expect(VOTER_CODE_BATCH_MAX).toBe(100);
    expect(VOTER_CODE_TOTAL_CAP).toBe(1000);
  });
});
