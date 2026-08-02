import type { PollStatus } from "../shared/domain/index";

// Motion math for the live reconciler (Story 1.10) — pure so the unit
// project can pin it without a browser. The durations and easing it honors
// live in tokens.css (--motion-count-up, --motion-ease); the wiring layer
// reads both tokens at enhancement time. The named CSS token is therefore
// the sole source of the count-up curve rather than a duplicated JS tuple.

// Fallback when the --motion-count-up token cannot be read or parsed; the
// token remains the source of truth.
export const RESULTS_COUNT_UP_DEFAULT_DURATION_MS = 400;

export type CubicBezierCurve = readonly [
  x1: number,
  y1: number,
  x2: number,
  y2: number,
];

// A safe degradation when the CSS token is absent or malformed. This is
// deliberately linear rather than a second copy of the product easing.
export const LINEAR_MOTION_EASE: CubicBezierCurve = [0, 0, 1, 1];

export type CountUpTween = {
  from: number;
  to: number;
  startedAtMs: number;
  durationMs: number;
  easing: CubicBezierCurve;
};

export type ResultsRefreshTrigger =
  | "cadence"
  | "visibility-return"
  | "online"
  | "pageshow";

export type ResultsMotionContext = {
  trigger: ResultsRefreshTrigger;
  wasStale: boolean;
  nextStatus: PollStatus;
};

// Cubic bezier with endpoints pinned to (0, 0) and (1, 1), sampled as
// B(t) = ((1 - 3a2 + 3a1)t + (3a2 - 6a1))t² + 3a1·t along one axis.
const bezierSample = (a1: number, a2: number, t: number): number =>
  ((1 - 3 * a2 + 3 * a1) * t + (3 * a2 - 6 * a1)) * t * t + 3 * a1 * t;

const bezierDerivative = (a1: number, a2: number, t: number): number =>
  3 * (1 - 3 * a2 + 3 * a1) * t * t + 2 * (3 * a2 - 6 * a1) * t + 3 * a1;

// Progress (y) at a given time fraction (x), solving the parameterization
// with Newton-Raphson and a bisection fallback.
export function cubicBezierProgress(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x: number,
): number {
  if (x <= 0) {
    return 0;
  }
  if (x >= 1) {
    return 1;
  }
  let t = x;
  for (let iteration = 0; iteration < 8; iteration += 1) {
    const error = bezierSample(x1, x2, t) - x;
    if (Math.abs(error) < 1e-6) {
      return bezierSample(y1, y2, t);
    }
    const slope = bezierDerivative(x1, x2, t);
    if (Math.abs(slope) < 1e-6) {
      break;
    }
    t = Math.min(1, Math.max(0, t - error / slope));
  }
  let low = 0;
  let high = 1;
  t = x;
  while (high - low > 1e-6) {
    if (bezierSample(x1, x2, t) < x) {
      low = t;
    } else {
      high = t;
    }
    t = (low + high) / 2;
  }
  return bezierSample(y1, y2, t);
}

export function resultsMotionEase(
  timeFraction: number,
  easing: CubicBezierCurve,
): number {
  return cubicBezierProgress(...easing, timeFraction);
}

export function startCountUp(
  from: number,
  to: number,
  startedAtMs: number,
  durationMs: number,
  easing: CubicBezierCurve,
): CountUpTween {
  return { from, to, startedAtMs, durationMs, easing };
}

export function isCountUpComplete(tween: CountUpTween, nowMs: number): boolean {
  return nowMs >= tween.startedAtMs + tween.durationMs;
}

// The integer shown at a moment in the tween: eased, rounded, and pinned to
// the exact target the instant the window closes, so a count never
// overshoots and never lands on a stale intermediate.
export function countUpDisplayValue(
  tween: CountUpTween,
  nowMs: number,
): number {
  if (tween.durationMs <= 0 || isCountUpComplete(tween, nowMs)) {
    return tween.to;
  }
  if (nowMs <= tween.startedAtMs) {
    return tween.from;
  }
  const timeFraction = (nowMs - tween.startedAtMs) / tween.durationMs;
  return Math.round(
    tween.from +
      (tween.to - tween.from) *
        resultsMotionEase(timeFraction, tween.easing),
  );
}

// Coalescing: a newer payload retargets the tween from wherever it currently
// is — never restarting from the old value, never queueing.
export function retargetCountUp(
  tween: CountUpTween,
  to: number,
  nowMs: number,
  durationMs: number,
): CountUpTween {
  return {
    from: countUpDisplayValue(tween, nowMs),
    to,
    startedAtMs: nowMs,
    durationMs,
    easing: tween.easing,
  };
}

// The reduced-motion decision: state changes still land, instantly.
export function resolveCountUpDurationMs(
  baseDurationMs: number,
  reducedMotion: boolean,
): number {
  return reducedMotion ? 0 : baseDurationMs;
}

// The spark fires on increase only (DESIGN.md — "when a bar's value
// increases"), never on an equal, decreased, or first-seen count.
export function shouldSparkOnCountChange(
  previousCount: number,
  nextCount: number,
): boolean {
  return nextCount > previousCount;
}

// Snap contexts (EXPERIENCE.md — "the truth, not a highlight reel"): every
// recovery refresh and the closed final snapshot land at current values;
// only an ordinary in-cadence poll animates.
export function shouldSnapResultsMotion(
  context: ResultsMotionContext,
): boolean {
  return (
    context.trigger !== "cadence" ||
    context.wasStale ||
    context.nextStatus === "closed"
  );
}

// Reads a CSS duration token value ("400ms" / "0.4s") into milliseconds.
export function parseMotionDurationMs(value: string | null): number | null {
  if (value === null) {
    return null;
  }
  const match = /^\s*(\d+(?:\.\d+)?)\s*(ms|s)\s*$/.exec(value);
  if (!match) {
    return null;
  }
  const durationMs = match[2] === "s" ? Number(match[1]) * 1000 : Number(match[1]);
  return Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : null;
}

// Parses the named CSS timing-function token into the control points the
// count-up needs. CSS requires the x coordinates to stay within [0, 1]; the
// y coordinates may extend beyond that range, so only finiteness applies.
export function parseMotionEasing(
  value: string | null,
): CubicBezierCurve | null {
  if (value === null) {
    return null;
  }
  const number = "([+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+))";
  const match = new RegExp(
    `^\\s*cubic-bezier\\(\\s*${number}\\s*,\\s*${number}\\s*,\\s*${number}\\s*,\\s*${number}\\s*\\)\\s*$`,
  ).exec(value);
  if (!match) {
    return null;
  }
  const points = match.slice(1).map(Number);
  const [x1, y1, x2, y2] = points;
  if (
    points.length !== 4 ||
    points.some((point) => !Number.isFinite(point)) ||
    x1 === undefined ||
    y1 === undefined ||
    x2 === undefined ||
    y2 === undefined ||
    x1 < 0 ||
    x1 > 1 ||
    x2 < 0 ||
    x2 > 1
  ) {
    return null;
  }
  return [x1, y1, x2, y2];
}

// Reads the first integer out of rendered value text ("47%", " · 122",
// "3 VOTES") so a tween can start from what the server rendered.
export function parseLeadingInteger(text: string | null): number | null {
  if (text === null) {
    return null;
  }
  const match = /-?\d+/.exec(text);
  if (!match) {
    return null;
  }
  const value = Number(match[0]);
  return Number.isSafeInteger(value) ? value : null;
}
