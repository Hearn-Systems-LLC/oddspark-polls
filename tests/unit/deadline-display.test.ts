import { describe, expect, it, vi } from "vitest";
import { countdownLabel } from "../../src/modules/polls/deadline-display";

const NOW = Date.UTC(2026, 6, 31, 12, 0, 0);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

describe("countdownLabel", () => {
  it.each([
    { remainingMs: 24 * HOUR, expected: null },
    { remainingMs: 24 * HOUR + 1, expected: null },
    { remainingMs: 23 * HOUR + 59 * MINUTE, expected: "CLOSES IN 23H" },
    { remainingMs: 90 * MINUTE, expected: "CLOSES IN 1H" },
    { remainingMs: 59 * MINUTE, expected: "CLOSES IN 59M" },
    { remainingMs: MINUTE, expected: "CLOSES IN 1M" },
    { remainingMs: 30_000, expected: "CLOSES IN 1M" },
    { remainingMs: 0, expected: null },
    { remainingMs: -1, expected: null },
  ])(
    "returns $expected with $remainingMs milliseconds remaining",
    ({ remainingMs, expected }) => {
      expect(countdownLabel(NOW + remainingMs, NOW)).toBe(expected);
    },
  );

  it("uses only the injected current time", async () => {
    const clock = vi.spyOn(Date, "now");
    try {
      vi.resetModules();
      const freshModule = await import(
        "../../src/modules/polls/deadline-display"
      );
      expect(freshModule.countdownLabel(NOW + 30_000, NOW)).toBe(
        "CLOSES IN 1M",
      );
      expect(clock).not.toHaveBeenCalled();
    } finally {
      clock.mockRestore();
    }
  });
});
