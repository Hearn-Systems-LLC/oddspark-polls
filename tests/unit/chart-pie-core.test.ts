import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  pieSlicePathD,
  pieSlicePoint,
  pieSlices,
} from "../../src/scripts/chart-pie-core";

describe("pieSlices", () => {
  it("lays slices clockwise from 12 o'clock in creator option order", () => {
    expect(pieSlices([0.25, 0.25, 0.5])).toEqual([
      { optionIndex: 0, startAngleDeg: 0, endAngleDeg: 90 },
      { optionIndex: 1, startAngleDeg: 90, endAngleDeg: 180 },
      { optionIndex: 2, startAngleDeg: 180, endAngleDeg: 360 },
    ]);
  });

  it("omits zero-share options from the ring but keeps their legend index", () => {
    expect(pieSlices([0.5, 0, 0.5])).toEqual([
      { optionIndex: 0, startAngleDeg: 0, endAngleDeg: 180 },
      { optionIndex: 2, startAngleDeg: 180, endAngleDeg: 360 },
    ]);
  });

  it("closes only unit-total floating drift and never rebases incomplete data", () => {
    const thirds = pieSlices([1 / 3, 1 / 3, 1 / 3]);
    expect(thirds).toHaveLength(3);
    expect(thirds.at(-1)?.endAngleDeg).toBe(360);
    expect(pieSlices([0.25, 0.25]).at(-1)?.endAngleDeg).toBe(180);
  });

  it("renders a single full-value option as one full-circle slice", () => {
    expect(pieSlices([1])).toEqual([
      { optionIndex: 0, startAngleDeg: 0, endAngleDeg: 360 },
    ]);
    expect(pieSlices([0, 1, 0])).toEqual([
      { optionIndex: 1, startAngleDeg: 0, endAngleDeg: 360 },
    ]);
  });

  it("renders no slices when every option is zero", () => {
    expect(pieSlices([0, 0, 0])).toEqual([]);
    expect(pieSlices([])).toEqual([]);
  });

  it("keeps all 30 positive wedges when rounded display values would overshoot", () => {
    const counts = [...Array(24).fill(2), ...Array(6).fill(1)];
    const shares = counts.map((count) => count / 54);
    const slices = pieSlices(shares);
    expect(counts.map((count) => Math.round((count / 54) * 100))).toEqual([
      ...Array(24).fill(4),
      ...Array(6).fill(2),
    ]);
    expect(slices).toHaveLength(30);
    expect(slices.every((slice) => slice.endAngleDeg > slice.startAngleDeg))
      .toBe(true);
    expect(slices.at(-1)?.endAngleDeg).toBe(360);
  });

  it("keeps a positive wedge whose rounded display percentage is zero", () => {
    const slices = pieSlices([200 / 201, 1 / 201]);
    expect(Math.round((1 / 201) * 100)).toBe(0);
    expect(slices).toHaveLength(2);
    expect(slices[1]?.endAngleDeg).toBeGreaterThan(
      slices[1]?.startAngleDeg ?? 0,
    );
  });

  it("tiles the ring contiguously and closes at exactly 360 for unit shares", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 1_000 }), {
          minLength: 1,
          maxLength: 30,
        }),
        (weights) => {
          const total = weights.reduce((sum, weight) => sum + weight, 0);
          const slices = pieSlices(weights.map((weight) => weight / total));
          expect(slices).toHaveLength(weights.length);
          expect(slices[0]?.startAngleDeg).toBe(0);
          for (const [index, slice] of slices.entries()) {
            expect(slice.startAngleDeg).toBeGreaterThanOrEqual(0);
            expect(slice.endAngleDeg).toBeLessThanOrEqual(360);
            expect(slice.endAngleDeg).toBeGreaterThan(slice.startAngleDeg);
            if (index > 0) {
              expect(slice.startAngleDeg).toBeCloseTo(
                slices[index - 1]?.endAngleDeg ?? 0,
                10,
              );
            }
          }
          expect(slices[slices.length - 1]?.endAngleDeg).toBe(360);
        },
      ),
    );
  });
});

describe("pieSlicePoint", () => {
  it("maps 0° to 12 o'clock and grows clockwise", () => {
    const top = pieSlicePoint(100, 100, 80, 0);
    expect(top.x).toBeCloseTo(100, 10);
    expect(top.y).toBeCloseTo(20, 10);
    const right = pieSlicePoint(100, 100, 80, 90);
    expect(right.x).toBeCloseTo(180, 10);
    expect(right.y).toBeCloseTo(100, 10);
    const bottom = pieSlicePoint(100, 100, 80, 180);
    expect(bottom.x).toBeCloseTo(100, 10);
    expect(bottom.y).toBeCloseTo(180, 10);
    const left = pieSlicePoint(100, 100, 80, 270);
    expect(left.x).toBeCloseTo(20, 10);
    expect(left.y).toBeCloseTo(100, 10);
  });
});

describe("pieSlicePathD", () => {
  it("returns null for a full circle so the caller draws a circle element", () => {
    expect(pieSlicePathD(100, 100, 80, 0, 360)).toBeNull();
  });

  it("returns null for an empty sweep", () => {
    expect(pieSlicePathD(100, 100, 80, 45, 45)).toBeNull();
    expect(pieSlicePathD(100, 100, 80, 90, 45)).toBeNull();
  });

  it("draws a wedge from the center with a clockwise sweep", () => {
    const d = pieSlicePathD(100, 100, 80, 0, 90);
    expect(d).toContain("M 100 100 L");
    expect(d).toContain("A 80 80 0 0 1");
    expect(d).toMatch(/Z$/);
  });

  it("raises the large-arc flag only past a half turn", () => {
    expect(pieSlicePathD(100, 100, 80, 0, 90)).toContain("A 80 80 0 0 1");
    expect(pieSlicePathD(100, 100, 80, 0, 270)).toContain("A 80 80 0 1 1");
  });
});
