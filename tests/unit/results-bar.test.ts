import { describe, expect, it } from "vitest";
import {
  barAccessibleName,
  barWidthPercent,
} from "../../src/components/results-bar";

describe("barWidthPercent", () => {
  it.each([
    { input: 0, expected: 0 },
    { input: 47, expected: 47 },
    { input: 100, expected: 100 },
    { input: -5, expected: 0 },
    { input: 150, expected: 100 },
    { input: Number.NaN, expected: 0 },
    { input: Number.POSITIVE_INFINITY, expected: 0 },
    { input: Number.NEGATIVE_INFINITY, expected: 0 },
  ])("normalizes $input to $expected", ({ input, expected }) => {
    expect(barWidthPercent(input)).toBe(expected);
  });
});

describe("barAccessibleName", () => {
  it("names a plain bar with its label, percent, and count", () => {
    expect(barAccessibleName("Pizza", 47, 122, false)).toBe(
      "Pizza, 47 percent, 122 votes",
    );
  });

  it("names the sole leader with its leading suffix", () => {
    expect(barAccessibleName("Pizza", 47, 122, true)).toBe(
      "Pizza, 47 percent, 122 votes, leading",
    );
  });

  it("names a zero-count bar without any special case", () => {
    expect(barAccessibleName("Sushi", 0, 0, false)).toBe(
      "Sushi, 0 percent, 0 votes",
    );
  });

  it("pluralizes a single vote", () => {
    expect(barAccessibleName("Sushi", 33, 1, false)).toBe(
      "Sushi, 33 percent, 1 vote",
    );
  });

  it.each([
    { input: -5, expected: 0 },
    { input: 150, expected: 100 },
    { input: Number.NaN, expected: 0 },
    { input: Number.POSITIVE_INFINITY, expected: 0 },
  ])(
    "uses the normalized $input percentage in the accessible value",
    ({ input, expected }) => {
      const normalizedPercent = barWidthPercent(input);

      expect(barAccessibleName("Sushi", normalizedPercent, 2, false)).toBe(
        `Sushi, ${expected} percent, 2 votes`,
      );
    },
  );
});
