import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { MEETING_VOTE_COPY, validateMeetingSubmission } from "../../src/modules/polls/types/meeting";
import { normalizeMeetingVotePayload } from "../../src/modules/voting/index";
import { formatMeetingSlotLocal, meetingSlotDayKey } from "../../src/lib/datetime";

const slots = [{ id: "slot-a", position: 0 }, { id: "slot-b", position: 1 }];

describe("Meeting response policy", () => {
  it("requires a trimmed display name and every slot", () => {
    expect(validateMeetingSubmission({ kind: "meeting", displayName: " ", availability: [] }, { slots })).toMatchObject({ ok: false, error: { reasonCodes: { display_name: "display_name_missing" } } });
    expect(validateMeetingSubmission({ kind: "meeting", displayName: "Alex", availability: [{ slotId: "slot-a", state: "yes" }] }, { slots })).toMatchObject({ ok: false, error: { reasonCodes: { availability: "availability_missing" } } });
  });

  it("rejects unknown slots and invalid availability states with exact copy", () => {
    expect(validateMeetingSubmission({ kind: "meeting", displayName: "Alex", availability: [{ slotId: "unknown", state: "yes" }] }, { slots })).toMatchObject({ ok: false, error: { message: "Fix the fields below.", fieldErrors: { availability: MEETING_VOTE_COPY.availabilitySlotUnknown } } });
    expect(validateMeetingSubmission({ kind: "meeting", displayName: "Alex", availability: [{ slotId: "slot-a", state: "maybe" }] }, { slots })).toMatchObject({ ok: false, error: { reasonCodes: { availability: "availability_invalid" } } });
  });

  it("canonicalizes valid availability by slot position", () => {
    const result = validateMeetingSubmission({ kind: "meeting", displayName: " Alex ", availability: [{ slotId: "slot-b", state: "no" }, { slotId: "slot-a", state: "yes" }] }, { slots });
    expect(result).toMatchObject({ ok: true, value: { displayName: "Alex", availability: [{ meetingSlotId: "slot-a", state: "yes", position: 0 }, { meetingSlotId: "slot-b", state: "no", position: 1 }] } });
    expect(normalizeMeetingVotePayload("poll" as never, "Alex", [{ slotId: "slot-b", state: "no", position: 1 }, { slotId: "slot-a", state: "yes", position: 0 }])).toBe(normalizeMeetingVotePayload("poll" as never, "Alex", [{ slotId: "slot-a", state: "yes", position: 0 }, { slotId: "slot-b", state: "no", position: 1 }]));
  });
});

describe("Meeting voter-local time rendering", () => {
  it("renders the FR-13 EST to CET worked example", () => {
    const start = Date.UTC(2027, 0, 15, 20, 0);
    expect(formatMeetingSlotLocal(start, start + 60 * 60_000, "Europe/Paris")).toContain("21:00");
  });

  it("stays total and day-aware across DST boundaries", () => {
    fc.assert(fc.property(
      fc.constantFrom("America/Detroit", "America/New_York", "Europe/London", "Europe/Paris"),
      fc.integer({ min: Date.UTC(2025, 0, 1), max: Date.UTC(2030, 11, 31) }),
      fc.integer({ min: 1, max: 180 }),
      (zone, start, minutes) => {
        expect(formatMeetingSlotLocal(start, start + minutes * 60_000, zone)).toMatch(/\d{2}:\d{2}/u);
        expect(meetingSlotDayKey(start, zone)).toMatch(/\d{2}/u);
      },
    ));
  });
});
