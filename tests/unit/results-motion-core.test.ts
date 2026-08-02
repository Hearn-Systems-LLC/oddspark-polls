import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  countUpDisplayValue,
  cubicBezierProgress,
  isCountUpComplete,
  parseLeadingInteger,
  parseMotionDurationMs,
  parseMotionEasing,
  resolveCountUpDurationMs,
  resultsMotionEase,
  retargetCountUp,
  shouldSnapResultsMotion,
  shouldSparkOnCountChange,
  startCountUp,
  type ResultsMotionContext,
} from "../../src/scripts/results-motion-core";

const MOTION_EASE = parseMotionEasing(
  "cubic-bezier(0.22, 1, 0.36, 1)",
);
if (MOTION_EASE === null) {
  throw new Error("Expected a valid --motion-ease token");
}

const startTween = (
  from: number,
  to: number,
  startedAtMs: number,
  durationMs: number,
) => startCountUp(from, to, startedAtMs, durationMs, MOTION_EASE);

describe("resultsMotionEase", () => {
  it("lands exactly on 0 and 1 at the endpoints", () => {
    expect(resultsMotionEase(0, MOTION_EASE)).toBe(0);
    expect(resultsMotionEase(1, MOTION_EASE)).toBe(1);
    expect(cubicBezierProgress(...MOTION_EASE, 0)).toBe(0);
    expect(cubicBezierProgress(...MOTION_EASE, 1)).toBe(1);
  });

  it("is monotonic nondecreasing, so eased progress never runs backwards", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (a, b) => {
          const [earlier, later] = a <= b ? [a, b] : [b, a];
          expect(resultsMotionEase(later, MOTION_EASE)).toBeGreaterThanOrEqual(
            resultsMotionEase(earlier, MOTION_EASE) - 1e-9,
          );
        },
      ),
    );
  });

  it("stays within [0, 1] so no eased value ever overshoots", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1, noNaN: true }), (x) => {
        const eased = resultsMotionEase(x, MOTION_EASE);
        expect(eased).toBeGreaterThanOrEqual(0);
        expect(eased).toBeLessThanOrEqual(1);
      }),
    );
  });
});

describe("count-up interpolation", () => {
  it("starts exactly on the from value", () => {
    const tween = startTween(3, 47, 1_000, 400);
    expect(countUpDisplayValue(tween, 1_000)).toBe(3);
    expect(countUpDisplayValue(tween, 900)).toBe(3);
  });

  it("lands exactly on the true final value at completion", () => {
    const tween = startTween(3, 47, 1_000, 400);
    expect(isCountUpComplete(tween, 1_399)).toBe(false);
    expect(isCountUpComplete(tween, 1_400)).toBe(true);
    expect(countUpDisplayValue(tween, 1_400)).toBe(47);
    expect(countUpDisplayValue(tween, 9_999)).toBe(47);
  });

  it("never overshoots and always settles on the target", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000, max: 1_000 }),
        fc.integer({ min: -1_000, max: 1_000 }),
        fc.integer({ min: 1, max: 10_000 }),
        fc.integer({ min: 0, max: 20_000 }),
        (from, to, durationMs, elapsedMs) => {
          const tween = startTween(from, to, 0, durationMs);
          const value = countUpDisplayValue(tween, elapsedMs);
          const [low, high] = from <= to ? [from, to] : [to, from];
          expect(value).toBeGreaterThanOrEqual(low);
          expect(value).toBeLessThanOrEqual(high);
          if (elapsedMs >= durationMs) {
            expect(value).toBe(to);
          }
        },
      ),
    );
  });

  it("counts down without dipping below the target", () => {
    const tween = startTween(122, 3, 0, 400);
    for (let elapsed = 0; elapsed <= 400; elapsed += 25) {
      const value = countUpDisplayValue(tween, elapsed);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThanOrEqual(122);
    }
    expect(countUpDisplayValue(tween, 400)).toBe(3);
  });

  it("treats a zero-duration tween as complete at the target", () => {
    const tween = startTween(3, 47, 1_000, 0);
    expect(isCountUpComplete(tween, 1_000)).toBe(true);
    expect(countUpDisplayValue(tween, 1_000)).toBe(47);
  });
});

describe("count-up retargeting", () => {
  it("retargets from the currently displayed value, never the original", () => {
    const tween = startTween(0, 100, 1_000, 400);
    const midway = countUpDisplayValue(tween, 1_200);
    // The motion.ease curve is fast out of the gate, so halfway through the
    // window the displayed value is well past the linear midpoint.
    expect(midway).toBeGreaterThan(50);
    expect(midway).toBeLessThan(100);

    const retargeted = retargetCountUp(tween, 200, 1_200, 400);
    expect(retargeted.from).toBe(midway);
    expect(retargeted.to).toBe(200);
    expect(retargeted.startedAtMs).toBe(1_200);
    expect(countUpDisplayValue(retargeted, 1_200)).toBe(midway);
    expect(countUpDisplayValue(retargeted, 1_600)).toBe(200);
  });

  it("coalesces rapid updates into one settle on the latest value", () => {
    let tween = startTween(0, 100, 0, 400);
    tween = retargetCountUp(tween, 150, 100, 400);
    tween = retargetCountUp(tween, 80, 200, 400);
    expect(tween.to).toBe(80);
    for (let elapsed = 200; elapsed <= 600; elapsed += 20) {
      const value = countUpDisplayValue(tween, elapsed);
      expect(value).toBeGreaterThanOrEqual(80 - 1);
    }
    expect(countUpDisplayValue(tween, 600)).toBe(80);
  });
});

describe("resolveCountUpDurationMs", () => {
  it("keeps the base duration when motion is allowed", () => {
    expect(resolveCountUpDurationMs(400, false)).toBe(400);
  });

  it("collapses to zero duration under reduced motion", () => {
    expect(resolveCountUpDurationMs(400, true)).toBe(0);
  });
});

describe("shouldSparkOnCountChange", () => {
  it("sparks only when the count increased", () => {
    expect(shouldSparkOnCountChange(46, 47)).toBe(true);
    expect(shouldSparkOnCountChange(0, 1)).toBe(true);
  });

  it("never sparks on an equal, decreased, or no-op count", () => {
    expect(shouldSparkOnCountChange(47, 47)).toBe(false);
    expect(shouldSparkOnCountChange(47, 46)).toBe(false);
    expect(shouldSparkOnCountChange(0, 0)).toBe(false);
  });
});

describe("shouldSnapResultsMotion", () => {
  it.each([
    {
      context: {
        trigger: "cadence",
        wasStale: false,
        nextStatus: "open",
      } satisfies ResultsMotionContext,
      expected: false,
    },
    {
      context: {
        trigger: "visibility-return",
        wasStale: false,
        nextStatus: "open",
      } satisfies ResultsMotionContext,
      expected: true,
    },
    {
      context: {
        trigger: "online",
        wasStale: false,
        nextStatus: "open",
      } satisfies ResultsMotionContext,
      expected: true,
    },
    {
      context: {
        trigger: "pageshow",
        wasStale: false,
        nextStatus: "open",
      } satisfies ResultsMotionContext,
      expected: true,
    },
    {
      context: {
        trigger: "cadence",
        wasStale: true,
        nextStatus: "open",
      } satisfies ResultsMotionContext,
      expected: true,
    },
    {
      context: {
        trigger: "cadence",
        wasStale: false,
        nextStatus: "closed",
      } satisfies ResultsMotionContext,
      expected: true,
    },
  ])(
    "returns $expected for $context.trigger (stale=$context.wasStale, $context.nextStatus)",
    ({ context, expected }) => {
      expect(shouldSnapResultsMotion(context)).toBe(expected);
    },
  );
});

describe("parseMotionDurationMs", () => {
  it("parses millisecond and second token values", () => {
    expect(parseMotionDurationMs("400ms")).toBe(400);
    expect(parseMotionDurationMs("0.4s")).toBe(400);
    expect(parseMotionDurationMs(" 480ms ")).toBe(480);
  });

  it("rejects missing and malformed values", () => {
    expect(parseMotionDurationMs(null)).toBeNull();
    expect(parseMotionDurationMs("")).toBeNull();
    expect(parseMotionDurationMs("soon")).toBeNull();
  });
});

describe("parseMotionEasing", () => {
  it("reads the named cubic-bezier token into four control points", () => {
    expect(MOTION_EASE).toEqual([0.22, 1, 0.36, 1]);
    expect(parseMotionEasing(" cubic-bezier(.1, -0.2, 1, 1.3) ")).toEqual([
      0.1, -0.2, 1, 1.3,
    ]);
  });

  it.each([
    null,
    "",
    "ease-out",
    "cubic-bezier(-0.1, 0, 1, 1)",
    "cubic-bezier(0, 0, 1.1, 1)",
    "cubic-bezier(nope, 0, 1, 1)",
  ])("rejects malformed or CSS-invalid timing function %s", (value) => {
    expect(parseMotionEasing(value)).toBeNull();
  });
});

describe("parseLeadingInteger", () => {
  it("reads the first integer out of rendered value text", () => {
    expect(parseLeadingInteger("47%")).toBe(47);
    expect(parseLeadingInteger(" · 122")).toBe(122);
    expect(parseLeadingInteger("3 VOTES")).toBe(3);
  });

  it("rejects text without digits", () => {
    expect(parseLeadingInteger(null)).toBeNull();
    expect(parseLeadingInteger("")).toBeNull();
    expect(parseLeadingInteger("no digits")).toBeNull();
  });
});
