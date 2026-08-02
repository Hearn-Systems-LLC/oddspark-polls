// Pie geometry for the chart-form toggle (Story 1.10) — pure so the unit
// project can pin it without a browser. Angles derive from the SERVER-owned
// unrounded Voter share: share × 360° is geometry, not tabulation, and the
// client never divides counts or rounds a result (AD-9/NFR-6).

export type PieSlice = {
  /** Creator option order index — the legend maps by the same order. */
  optionIndex: number;
  /** 0° is 12 o'clock; angles grow clockwise. */
  startAngleDeg: number;
  endAngleDeg: number;
};

const FULL_CIRCLE_DEG = 360;
const HALF_CIRCLE_DEG = 180;
const UNIT_SHARE_EPSILON = 1e-12;

// Slices run clockwise from 12 o'clock in creator option order (bars never
// reorder — UX-DR3). Zero-share options render no slice; their legend row
// remains. A valid single-select tally sums to one; only floating-point drift
// at that boundary is absorbed by the final slice. Shares are never rebased
// or normalized on the client.
export function pieSlices(shares: number[]): PieSlice[] {
  const slices: PieSlice[] = [];
  let cursorDeg = 0;
  let totalShare = 0;
  for (const [index, share] of shares.entries()) {
    if (!Number.isFinite(share) || share <= 0) {
      continue;
    }
    const endAngleDeg = cursorDeg + share * FULL_CIRCLE_DEG;
    slices.push({
      optionIndex: index,
      startAngleDeg: cursorDeg,
      endAngleDeg,
    });
    cursorDeg = endAngleDeg;
    totalShare += share;
  }
  const lastIndex = slices.length - 1;
  const last = slices[lastIndex];
  if (
    last &&
    Math.abs(totalShare - 1) <= UNIT_SHARE_EPSILON &&
    last.endAngleDeg !== FULL_CIRCLE_DEG
  ) {
    slices[lastIndex] = { ...last, endAngleDeg: FULL_CIRCLE_DEG };
  }
  return slices;
}

// A point on the ring; 0° is 12 o'clock and angles grow clockwise, which in
// SVG's y-down plane is the sine/cosine pairing below.
export function pieSlicePoint(
  centerX: number,
  centerY: number,
  radius: number,
  angleDeg: number,
): { x: number; y: number } {
  const radians = (angleDeg * Math.PI) / 180;
  return {
    x: centerX + radius * Math.sin(radians),
    y: centerY - radius * Math.cos(radians),
  };
}

const coordinate = (value: number): number => Number(value.toFixed(2));

// The wedge path for one slice. A slice spanning the full circle cannot be
// one arc (its endpoints coincide) — null tells the caller to draw a
// <circle> instead.
export function pieSlicePathD(
  centerX: number,
  centerY: number,
  radius: number,
  startAngleDeg: number,
  endAngleDeg: number,
): string | null {
  const sweepDeg = endAngleDeg - startAngleDeg;
  if (sweepDeg <= 0 || sweepDeg >= FULL_CIRCLE_DEG) {
    return null;
  }
  const start = pieSlicePoint(centerX, centerY, radius, startAngleDeg);
  const end = pieSlicePoint(centerX, centerY, radius, endAngleDeg);
  const largeArcFlag = sweepDeg > HALF_CIRCLE_DEG ? 1 : 0;
  return `M ${centerX} ${centerY} L ${coordinate(start.x)} ${coordinate(start.y)} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${coordinate(end.x)} ${coordinate(end.y)} Z`;
}
