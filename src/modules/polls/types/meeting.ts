// Meeting Poll creation strategy (Story 7.1). Candidate rows are civil times
// in the Creator's zone at the delivery boundary and become absolute UTC
// instants plus that retained IANA zone before persistence.

import {
  POLL_TYPE_CONTRACT_VERSION,
  type PollTypeStrategy,
} from "../../../shared/application/index";
import { POLL_CAPS } from "../caps";
import { DEFINITION_COPY } from "../definition";
import { CIVIL_TIME_NONEXISTENT, civilToUtcMs, isUsableTimeZone } from "../index";
import type { Result } from "../../../shared/application/index";
import { AVAILABILITY_STATES, isAvailabilityState, type AvailabilityState } from "../../../shared/domain/index";

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

export type MeetingVoteSubmission = {
  kind: "meeting";
  selectedOptionIds?: readonly string[];
  displayName: string;
  availability: readonly { slotId: string; state: string; position?: number }[];
};

export type MeetingValidatedSubmission = {
  kind: "meeting";
  selectedOptionIds: readonly never[];
  displayName: string;
  availability: { meetingSlotId: string; state: AvailabilityState; position: number }[];
};

export const MEETING_VOTE_COPY = {
  displayNameMissing: "Add your name so everyone knows whose availability this is.",
  displayNameInvalid: "Use a name between 1 and 80 characters.",
  availabilityMissing: "Answer every time slot, then save.",
  availabilityInvalid: "Choose Yes, If need be, or No for every time slot.",
  availabilitySlotUnknown: "The available times changed. Review them and try again.",
} as const;

export function validateMeetingSubmission(
  submission: MeetingVoteSubmission,
  facts: { slots: readonly { id: string; position: number }[] },
): Result<MeetingValidatedSubmission> {
  const displayName = submission.displayName.trim();
  if (displayName.length === 0) return validationFailure({ display_name: MEETING_VOTE_COPY.displayNameMissing }, { display_name: "display_name_missing" });
  if (displayName.length > 80) return validationFailure({ display_name: MEETING_VOTE_COPY.displayNameInvalid }, { display_name: "display_name_invalid" });
  const known = new Map(facts.slots.map((slot) => [slot.id, slot.position]));
  const seen = new Set<string>();
  const availability: MeetingValidatedSubmission["availability"] = [];
  for (const row of submission.availability) {
    if (!known.has(row.slotId) || seen.has(row.slotId)) return validationFailure({ availability: MEETING_VOTE_COPY.availabilitySlotUnknown }, { availability: "availability_slot_unknown" });
    if (!isAvailabilityState(row.state)) return validationFailure({ availability: MEETING_VOTE_COPY.availabilityInvalid }, { availability: "availability_invalid" });
    seen.add(row.slotId);
    availability.push({ meetingSlotId: row.slotId, state: row.state, position: known.get(row.slotId)! });
  }
  if (availability.length !== facts.slots.length) return validationFailure({ availability: MEETING_VOTE_COPY.availabilityMissing }, { availability: "availability_missing" });
  availability.sort((a, b) => a.position - b.position);
  return { ok: true, value: { kind: "meeting", selectedOptionIds: [], displayName, availability } };
}

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
    const rawZone = input.timeZone.trim();
    const timeZone = rawZone && isUsableTimeZone(rawZone) ? rawZone : "UTC";
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
    if (slots.length > POLL_CAPS.maxOptions) {
      return validationFailure(
        { slots: DEFINITION_COPY.optionsTooMany },
        { slots: "options_too_many" },
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
