import { describe, expect, it } from "vitest";
import { isMeetingLivePayload } from "../../src/scripts/meeting-results-live";

const validPayload = {
  pollType: "meeting",
  status: "open",
  empty: false,
  voterCount: 1,
  slots: [
    {
      startsAtMs: Date.parse("2027-01-15T14:00:00.000Z"),
      endsAtMs: Date.parse("2027-01-15T14:30:00.000Z"),
      timeZone: "America/Detroit",
      position: 0,
      yesCount: 1,
      ifNeedBeCount: 0,
      noCount: 0,
      isBest: true,
    },
  ],
  voters: [{ displayName: "Alex", availability: ["yes"] }],
  comments: [],
} as const;

describe("Meeting Results live payload", () => {
  it("accepts the exact identifier-free Meeting projection", () => {
    expect(isMeetingLivePayload(validPayload)).toBe(true);
  });

  it("rejects identifiers, malformed cells, and misaligned matrices", () => {
    expect(isMeetingLivePayload({ ...validPayload, voteId: "private" })).toBe(false);
    expect(
      isMeetingLivePayload({
        ...validPayload,
        voters: [
          { displayName: "Alex", availability: ["yes"], voteId: "private" },
        ],
      }),
    ).toBe(false);
    expect(
      isMeetingLivePayload({
        ...validPayload,
        voters: [{ displayName: "Alex", availability: ["maybe"] }],
      }),
    ).toBe(false);
    expect(
      isMeetingLivePayload({
        ...validPayload,
        voters: [{ displayName: "Alex", availability: [] }],
      }),
    ).toBe(false);
  });

  it("rejects client-forged totals and best-slot marks", () => {
    expect(
      isMeetingLivePayload({
        ...validPayload,
        slots: [{ ...validPayload.slots[0], yesCount: 2 }],
      }),
    ).toBe(false);
    expect(
      isMeetingLivePayload({
        ...validPayload,
        slots: [{ ...validPayload.slots[0], isBest: false }],
      }),
    ).toBe(false);
    expect(
      isMeetingLivePayload({
        ...validPayload,
        slots: [
          {
            ...validPayload.slots[0],
            yesCount: 0,
            noCount: 1,
            isBest: true,
          },
        ],
        voters: [{ displayName: "Alex", availability: ["no"] }],
      }),
    ).toBe(false);
  });
});
