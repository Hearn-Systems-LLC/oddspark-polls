import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  meetingStrategy,
  MEETING_DEFINITION_COPY,
  type MeetingCreateInput,
} from "../../src/modules/polls/types/meeting";

const NOW = 1_800_000_000_000;

function input(overrides: Partial<MeetingCreateInput> = {}): MeetingCreateInput {
  return {
    timeZone: "America/Detroit",
    slots: [
      { date: "2027-01-15", start: "09:00", end: "09:30" },
      { date: "2027-01-16", start: "14:00", end: "15:30" },
    ],
    ...overrides,
  };
}

describe("meeting strategy", () => {
  it("returns positioned absolute slot facts with the Creator timezone", () => {
    const result = meetingStrategy.create(input(), { nowMs: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.slots).toEqual([
      {
        startsAtMs: Date.parse("2027-01-15T14:00:00.000Z"),
        endsAtMs: Date.parse("2027-01-15T14:30:00.000Z"),
        timeZone: "America/Detroit",
        position: 0,
      },
      {
        startsAtMs: Date.parse("2027-01-16T19:00:00.000Z"),
        endsAtMs: Date.parse("2027-01-16T20:30:00.000Z"),
        timeZone: "America/Detroit",
        position: 1,
      },
    ]);
  });

  it("drops fully blank rows before enforcing the two-slot minimum", () => {
    const result = meetingStrategy.create(
      input({
        slots: [
          { date: "", start: "", end: "" },
          { date: "2027-01-15", start: "09:00", end: "09:30" },
          { date: "2027-01-16", start: "14:00", end: "15:30" },
        ],
      }),
      { nowMs: NOW },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.slots.map((slot) => slot.position)).toEqual([0, 1]);
  });

  it("rejects zero and one complete slot with the options-minimum idiom", () => {
    const missing = meetingStrategy.create(input({ slots: [] }), { nowMs: NOW });
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.error.fieldErrors?.slots).toBe(
        MEETING_DEFINITION_COPY.slotsMissing,
      );
      expect(missing.error.reasonCodes?.slots).toBe("slots_missing");
    }

    const one = meetingStrategy.create(
      input({
        slots: [{ date: "2027-01-15", start: "09:00", end: "09:30" }],
      }),
      { nowMs: NOW },
    );
    expect(one.ok).toBe(false);
    if (!one.ok) {
      expect(one.error.fieldErrors?.slots).toBe(
        MEETING_DEFINITION_COPY.slotsInsufficient,
      );
      expect(one.error.reasonCodes?.slots).toBe("slots_insufficient");
    }
  });

  it("rejects an end before start with the acceptance-copy literal", () => {
    const result = meetingStrategy.create(
      input({
        slots: [
          { date: "2027-01-15", start: "10:00", end: "09:00" },
          { date: "2027-01-16", start: "14:00", end: "15:30" },
        ],
      }),
      { nowMs: NOW },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.fieldErrors?.["slots[0]"]).toBe(
      "This slot ends before it starts. Check the times.",
    );
    expect(result.error.reasonCodes?.["slots[0]"]).toBe(
      "slot_ends_before_start",
    );
  });

  it("converts across spring-forward using absolute instants", () => {
    const result = meetingStrategy.create(
      input({
        slots: [
          { date: "2025-03-09", start: "01:30", end: "03:30" },
          { date: "2025-03-10", start: "09:00", end: "10:00" },
        ],
      }),
      { nowMs: NOW },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.slots[0]).toMatchObject({
      startsAtMs: Date.parse("2025-03-09T06:30:00.000Z"),
      endsAtMs: Date.parse("2025-03-09T07:30:00.000Z"),
    });
  });

  it("rejects a nonexistent spring-forward civil time per row", () => {
    const result = meetingStrategy.create(
      input({
        slots: [
          { date: "2025-03-09", start: "02:30", end: "03:30" },
          { date: "2025-03-10", start: "09:00", end: "10:00" },
        ],
      }),
      { nowMs: NOW },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.fieldErrors?.["slots[0]"]).toBe(
      MEETING_DEFINITION_COPY.slotTimeNonexistent,
    );
    expect(result.error.reasonCodes?.["slots[0]"]).toBe(
      "civil_time_nonexistent",
    );
  });

  it("preserves 30-minute absolute durations on days bracketing DST changes", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("2025-03-08", "2025-03-10", "2025-11-01", "2025-11-03"),
        fc.integer({ min: 0, max: 22 * 60 + 59 }),
        (date, minuteOfDay) => {
          const hhmm = (minute: number): string =>
            `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
          const result = meetingStrategy.create(
            input({
              slots: [
                {
                  date,
                  start: hhmm(minuteOfDay),
                  end: hhmm(minuteOfDay + 30),
                },
                { date: "2027-01-16", start: "14:00", end: "15:30" },
              ],
            }),
            { nowMs: NOW },
          );
          expect(result.ok).toBe(true);
          if (result.ok) {
            expect(
              result.value.slots[0]!.endsAtMs - result.value.slots[0]!.startsAtMs,
            ).toBe(30 * 60_000);
          }
        },
      ),
    );
  });

  it("rejects partially filled rows rather than dropping them", () => {
    const result = meetingStrategy.create(
      input({
        slots: [
          { date: "2027-01-15", start: "09:00", end: "" },
          { date: "2027-01-16", start: "14:00", end: "15:30" },
        ],
      }),
      { nowMs: NOW },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.fieldErrors?.["slots[0]"]).toBe(
      MEETING_DEFINITION_COPY.slotIncomplete,
    );
  });

  it("falls back to UTC when given an invalid IANA timezone string", () => {
    const result = meetingStrategy.create(
      input({
        timeZone: "Invalid/Zone_Name",
        slots: [
          { date: "2027-01-15", start: "09:00", end: "09:30" },
          { date: "2027-01-16", start: "14:00", end: "15:30" },
        ],
      }),
      { nowMs: NOW },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.slots[0]?.timeZone).toBe("UTC");
    expect(result.value.slots[0]?.startsAtMs).toBe(
      Date.parse("2027-01-15T09:00:00.000Z"),
    );
  });

  it("rejects more than 50 meeting slots with options_too_many", () => {
    const fiftyOneSlots = Array.from({ length: 51 }, (_, i) => ({
      date: "2027-01-15",
      start: "09:00",
      end: "09:30",
    }));
    const result = meetingStrategy.create(
      input({ slots: fiftyOneSlots }),
      { nowMs: NOW },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reasonCodes?.slots).toBe("options_too_many");
  });
});

