import { describe, expect, it } from "vitest";
import { isLiveResultsPayload } from "../../src/scripts/results-live";

const payload = {
  status: "open",
  multiSelectEnabled: false,
  voterCount: 1,
  selectionCount: 1,
  tied: false,
  empty: false,
  options: [{
    id: "option-1",
    label: "Alpha",
    position: 0,
    count: 1,
    percent: 100,
    pieShare: 1,
    leading: true,
  }],
  comments: [
    { body: "Newest", displayName: null, createdAtMs: 20 },
    { body: "Older", displayName: "Reader", createdAtMs: 10 },
  ],
};

describe("live Results Comment payload validation", () => {
  it("accepts the purpose-shaped complete ordered Comment list", () => {
    expect(isLiveResultsPayload(payload)).toBe(true);
  });

  it("rejects malformed order, hostile fields, and moderation IDs", () => {
    expect(
      isLiveResultsPayload({
        ...payload,
        comments: [...payload.comments].reverse(),
      }),
    ).toBe(false);
    expect(
      isLiveResultsPayload({
        ...payload,
        comments: [{ ...payload.comments[0], commentId: "private-id" }],
      }),
    ).toBe(false);
    expect(
      isLiveResultsPayload({
        ...payload,
        comments: [{ body: "Good", displayName: "bad\nname", createdAtMs: 1 }],
      }),
    ).toBe(false);
    expect(
      isLiveResultsPayload({
        ...payload,
        ownerComments: [],
      }),
    ).toBe(false);
    expect(isLiveResultsPayload({ ...payload, unknown: true })).toBe(false);
  });
});
