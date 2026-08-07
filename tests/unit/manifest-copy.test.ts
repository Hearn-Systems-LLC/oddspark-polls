import { describe, expect, it } from "vitest";
import { RESULTS_COPY } from "../../src/modules/results/index";

describe("RESULTS_COPY manifest strings", () => {
  it("manifestNotYet contains the {deadline} placeholder for splitting", () => {
    expect(RESULTS_COPY.manifestNotYet).toContain("{deadline}");
    const parts = RESULTS_COPY.manifestNotYet.split("{deadline}");
    expect(parts).toHaveLength(2);
    expect(parts[0].length).toBeGreaterThan(0);
  });

  it("manifestNotYetNoDeadline has no placeholder", () => {
    expect(RESULTS_COPY.manifestNotYetNoDeadline).not.toContain("{deadline}");
  });
});
