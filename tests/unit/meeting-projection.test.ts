import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  projectMeetingTally,
  type MeetingProjectionInput,
  type MeetingSlotProjectionInput,
} from "../../src/modules/results/meeting-projection";

const NOW = 1_800_000_000_000;

function slot(
  position: number,
  overrides: Partial<MeetingSlotProjectionInput> = {},
): MeetingSlotProjectionInput {
  return {
    startsAtMs: NOW + position * 3_600_000,
    endsAtMs: NOW + (position + 1) * 3_600_000,
    timeZone: "America/Detroit",
    position,
    yesCount: 0,
    ifNeedBeCount: 0,
    noCount: 0,
    ...overrides,
  };
}

function projection(
  overrides: Partial<MeetingProjectionInput> = {},
): MeetingProjectionInput {
  return {
    representationVersion: 4,
    effectiveStatus: "open",
    slots: [slot(0), slot(1), slot(2)],
    voters: [],
    ...overrides,
  };
}

describe("Meeting Tally projection", () => {
  it("uses yes first and if-need-be only as a tie break", () => {
    const view = projectMeetingTally(
      projection({
        slots: [
          slot(0, { yesCount: 2, ifNeedBeCount: 0 }),
          slot(1, { yesCount: 1, ifNeedBeCount: 99 }),
          slot(2, { yesCount: 2, ifNeedBeCount: 1 }),
        ],
      }),
    );

    expect(view.slots.map(({ position }) => position)).toEqual([0, 1, 2]);
    expect(view.slots.map(({ isBest }) => isBest)).toEqual([
      false,
      false,
      true,
    ]);
  });

  it("marks every slot tied on yes and if-need-be without reordering display columns", () => {
    const view = projectMeetingTally(
      projection({
        // Deliberately not in display order.
        slots: [
          slot(2, { yesCount: 3, ifNeedBeCount: 2 }),
          slot(0, { yesCount: 3, ifNeedBeCount: 2 }),
          slot(1, { yesCount: 3, ifNeedBeCount: 1 }),
        ],
      }),
    );

    expect(view.slots.map(({ position }) => position)).toEqual([0, 1, 2]);
    expect(view.slots.map(({ isBest }) => isBest)).toEqual([
      true,
      false,
      true,
    ]);
  });

  it("marks no best slot when every yes count is zero", () => {
    const view = projectMeetingTally(
      projection({
        slots: [
          slot(0, { ifNeedBeCount: 10 }),
          slot(1, { ifNeedBeCount: 5 }),
          slot(2, { ifNeedBeCount: 0 }),
        ],
      }),
    );

    expect(view.slots.every(({ isBest }) => !isBest)).toBe(true);
  });

  it("preserves unanswered cells as null in a serializable identifier-free view", () => {
    const view = projectMeetingTally(
      projection({
        voters: [
          {
            displayName: "<Alex & Co>",
            availability: ["yes", null, "no"],
          },
        ],
      }),
    );

    expect(view).toMatchObject({
      representationVersion: 4,
      effectiveStatus: "open",
      empty: false,
      voterCount: 1,
      voters: [
        {
          displayName: "<Alex & Co>",
          availability: ["yes", null, "no"],
        },
      ],
    });
    expect(JSON.parse(JSON.stringify(view))).toEqual(view);
    expect(JSON.stringify(view)).not.toMatch(/voteId|slotId/);
  });

  it("projects zero responses as an explicit empty view", () => {
    expect(projectMeetingTally(projection())).toMatchObject({
      empty: true,
      voterCount: 0,
      voters: [],
    });
  });

  it("marks every positive top-key tie together for arbitrary slot order", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 0, max: 20 }), {
          minLength: 2,
          maxLength: 8,
        }),
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 0, max: 100 }),
        (positions, yesCount, ifNeedBeCount) => {
          const view = projectMeetingTally(
            projection({
              slots: positions.map((position) =>
                slot(position, { yesCount, ifNeedBeCount }),
              ),
            }),
          );
          expect(view.slots.every(({ isBest }) => isBest)).toBe(true);
          expect(view.slots.map(({ position }) => position)).toEqual(
            [...positions].sort((left, right) => left - right),
          );
        },
      ),
    );
  });
});
