// Meeting Poll creation strategy (Story 7.1). Candidate rows are civil times
// in the Creator's zone at the delivery boundary and become absolute UTC
// instants plus that retained IANA zone before persistence.

import {
  POLL_TYPE_CONTRACT_VERSION,
  type PollTypeStrategy,
} from "../../../shared/application/index";
import { CIVIL_TIME_NONEXISTENT, civilToUtcMs } from "../index";

export type MeetingSlotInput = {
  date: string;
  start: string;
  end: string;
};

export type MeetingCreateInput = {
  slots: MeetingSlotInput[];
  timeZone: string;
};

export type MeetingSlotFact = {
  startsAtMs: number;
  endsAtMs: number;
  timeZone: string;
  position: number;
};

export type MeetingCreationFacts = {
  slots: MeetingSlotFact[];
};

export const MEETING_DEFINITION_COPY = {
  slotsMissing: "A Poll needs options. Add at least two.",
  slotsInsufficient: "One option isn't a Poll. Add at least one more.",
  slotIncomplete: "Complete the date, start, and end for this slot.",
  slotInvalid: "Check this slot's date and times.",
  slotTimeNonexistent:
    "That time never happens — the clock skips right over it.",
  slotEndsBeforeStart:
    "This slot ends before it starts. Check the times.",
} as const;

function invalid(
  key: string,
  message: string,
  reasonCode: string,
): ReturnType<typeof validationFailure> {
  return validationFailure({ [key]: message }, { [key]: reasonCode });
}

function validationFailure(
  fieldErrors: Record<string, string>,
  reasonCodes: Record<string, string>,
) {
  return {
    ok: false as const,
    error: {
      code: "poll_validation_failed",
      message: "Fix the fields below.",
      fieldErrors,
      reasonCodes,
    },
  };
}

export const meetingStrategy: PollTypeStrategy<
  MeetingCreateInput,
  MeetingCreationFacts
> = {
  type: "meeting",
  contractVersion: POLL_TYPE_CONTRACT_VERSION,
  create: (input) => {
    const timeZone = input.timeZone.trim() || "UTC";
    const slots: MeetingSlotFact[] = [];

    for (let index = 0; index < input.slots.length; index += 1) {
      const row = input.slots[index]!;
      const date = row.date.trim();
      const start = row.start.trim();
      const end = row.end.trim();
      if (date.length === 0 && start.length === 0 && end.length === 0) {
        continue;
      }
      const key = `slots[${index}]`;
      if (date.length === 0 || start.length === 0 || end.length === 0) {
        return invalid(key, MEETING_DEFINITION_COPY.slotIncomplete, "slot_incomplete");
      }

      const startsAtMs = civilToUtcMs(`${date}T${start}`, timeZone);
      const endsAtMs = civilToUtcMs(`${date}T${end}`, timeZone);
      if (
        startsAtMs === CIVIL_TIME_NONEXISTENT ||
        endsAtMs === CIVIL_TIME_NONEXISTENT
      ) {
        return invalid(
          key,
          MEETING_DEFINITION_COPY.slotTimeNonexistent,
          "civil_time_nonexistent",
        );
      }
      if (startsAtMs === null || endsAtMs === null) {
        return invalid(key, MEETING_DEFINITION_COPY.slotInvalid, "slot_invalid");
      }
      if (endsAtMs <= startsAtMs) {
        return invalid(
          key,
          MEETING_DEFINITION_COPY.slotEndsBeforeStart,
          "slot_ends_before_start",
        );
      }
      slots.push({
        startsAtMs,
        endsAtMs,
        timeZone,
        position: slots.length,
      });
    }

    if (slots.length === 0) {
      return validationFailure(
        { slots: MEETING_DEFINITION_COPY.slotsMissing },
        { slots: "slots_missing" },
      );
    }
    if (slots.length === 1) {
      return validationFailure(
        { slots: MEETING_DEFINITION_COPY.slotsInsufficient },
        { slots: "slots_insufficient" },
      );
    }
    return { ok: true, value: { slots } };
  },
  projectExport: () => ({
    ok: false,
    error: {
      code: "poll_type_export_unsupported",
      message: "Meeting Poll export is not available yet.",
    },
  }),
};
