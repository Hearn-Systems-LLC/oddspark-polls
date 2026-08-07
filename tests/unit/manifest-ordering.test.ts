import { describe, expect, it } from "vitest";
import type { BallotManifestRow } from "../../src/modules/results/index";

function sortManifestCanonical(
  ballots: BallotManifestRow[],
): BallotManifestRow[] {
  return [...ballots].sort((left, right) => {
    const a = left.rankedOptionLabels;
    const b = right.rankedOptionLabels;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      if (a[i] < b[i]) return -1;
      if (a[i] > b[i]) return 1;
    }
    return a.length - b.length;
  });
}

describe("manifest canonical ordering", () => {
  it("sorts ballots lexicographically by ranking content", () => {
    const input: BallotManifestRow[] = [
      { rankedOptionLabels: ["C", "A"], count: 1 },
      { rankedOptionLabels: ["A", "B"], count: 1 },
      { rankedOptionLabels: ["A", "C"], count: 1 },
      { rankedOptionLabels: ["B"], count: 1 },
    ];
    const sorted = sortManifestCanonical(input);
    expect(sorted.map((b) => b.rankedOptionLabels)).toEqual([
      ["A", "B"],
      ["A", "C"],
      ["B"],
      ["C", "A"],
    ]);
  });

  it("places shorter identical-prefix ballots before longer ones", () => {
    const input: BallotManifestRow[] = [
      { rankedOptionLabels: ["A", "B", "C"], count: 1 },
      { rankedOptionLabels: ["A", "B"], count: 1 },
      { rankedOptionLabels: ["A"], count: 1 },
    ];
    const sorted = sortManifestCanonical(input);
    expect(sorted.map((b) => b.rankedOptionLabels)).toEqual([
      ["A"],
      ["A", "B"],
      ["A", "B", "C"],
    ]);
  });

  it("output order is independent of insertion order", () => {
    const a: BallotManifestRow[] = [
      { rankedOptionLabels: ["Z"], count: 1 },
      { rankedOptionLabels: ["A"], count: 1 },
      { rankedOptionLabels: ["M"], count: 1 },
    ];
    const b: BallotManifestRow[] = [
      { rankedOptionLabels: ["M"], count: 1 },
      { rankedOptionLabels: ["Z"], count: 1 },
      { rankedOptionLabels: ["A"], count: 1 },
    ];
    expect(sortManifestCanonical(a)).toEqual(sortManifestCanonical(b));
  });

  it("contains no IDs, timestamps, or voter data", () => {
    const row: BallotManifestRow = {
      rankedOptionLabels: ["Alpha", "Beta"],
      count: 1,
    };
    const serialized = JSON.stringify(row);
    expect(serialized).not.toMatch(/id|timestamp|voter|vote_id/i);
    expect(Object.keys(row).sort()).toEqual(["count", "rankedOptionLabels"]);
  });

  it("collapses identical ballots into a count regardless of insertion order", () => {
    // Simulate unsorted ballots with identical content but different
    // insertion orders — the collapse must produce the same counts
    // regardless of input order.
    const collapse = (rows: BallotManifestRow[]): BallotManifestRow[] => {
      const sorted = sortManifestCanonical(rows);
      const result: BallotManifestRow[] = [];
      for (let i = 0; i < sorted.length; ) {
        const entry = sorted[i]!;
        let count = entry.count;
        while (
          i + count < sorted.length &&
          JSON.stringify(sorted[i + count]!.rankedOptionLabels) ===
            JSON.stringify(entry.rankedOptionLabels)
        ) {
          count += sorted[i + count]!.count;
        }
        result.push({
          rankedOptionLabels: entry.rankedOptionLabels,
          count,
        });
        i += count;
      }
      return result;
    };

    const orderA: BallotManifestRow[] = [
      { rankedOptionLabels: ["A", "B"], count: 1 },
      { rankedOptionLabels: ["A", "B"], count: 1 },
      { rankedOptionLabels: ["C"], count: 1 },
      { rankedOptionLabels: ["A", "B"], count: 1 },
    ];
    const orderB: BallotManifestRow[] = [
      { rankedOptionLabels: ["C"], count: 1 },
      { rankedOptionLabels: ["A", "B"], count: 1 },
      { rankedOptionLabels: ["A", "B"], count: 1 },
      { rankedOptionLabels: ["A", "B"], count: 1 },
    ];

    const collapsedA = collapse(orderA);
    const collapsedB = collapse(orderB);

    expect(collapsedA).toEqual(collapsedB);
    expect(collapsedA).toEqual([
      { rankedOptionLabels: ["A", "B"], count: 3 },
      { rankedOptionLabels: ["C"], count: 1 },
    ]);
  });
});