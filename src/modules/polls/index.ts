// Polls module — CreatePoll policy and command (Story 1.3). Provider-free:
// no Astro, no Cloudflare, no adapter imports (AD-1). The D1 adapter
// implements the persistence port; pages wire the two together.

import {
  type ApplicationError,
  type Result,
} from "../../shared/application/index";
import {
  RESULT_VISIBILITIES,
  type PollId,
  type PollOptionId,
  type ResultVisibility,
  type UserId,
} from "../../shared/domain/index";
import { multipleChoiceStrategy } from "./types/multiple-choice";
import { isReservedSlug } from "./reserved-slugs";
import { POLL_CAPS } from "./caps";

// Re-exported for the module's existing consumers; the caps live in
// ./caps.ts so browser code can import them without the domain command.
export { POLL_CAPS, RENDER_OPTION_CEILING } from "./caps";

// Raw form values exactly as the delivery boundary hands them over —
// blank option rows included (blank = removed).
export type CreatePollDraft = {
  question: string;
  description: string;
  options: string[];
  resultVisibility: string;
  deadlineLocal: string;
  timeZone: string;
  customLink: string;
  multiSelect: string;
  minSelections: string;
  maxSelections: string;
  // No-JS duplicate-POST dedupe (D4, decision 2026-07-29): the form renders
  // with a pre-minted poll UUID; a retried publish carrying the same ID
  // collides on the poll PRIMARY KEY instead of minting a second Poll.
  // Absent or non-UUID values fall back to a freshly generated ID; valid
  // IDs are normalized to lowercase (the D1 TEXT key is case-sensitive).
  idempotencyId?: string;
};

const UUID_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuidShape(value: string): boolean {
  return UUID_SHAPE.test(value);
}

export type ValidatedCreatePoll = {
  question: string;
  description: string | null;
  options: { label: string; position: number }[];
  resultVisibility: ResultVisibility;
  deadlineMs: number | null;
  customLink: string | null;
  multiSelect: boolean;
  minSelections: number | null;
  maxSelections: number | null;
};

// Voice-and-Tone catalog for creation failures. The three epic-specified
// lines are verbatim; the rest follow the same flat, layout-neutral idiom.
export const CREATE_POLL_COPY = {
  questionMissing: "A Poll needs a question. Ask something.",
  questionTooLong: `That question is too long. Keep it to ${POLL_CAPS.maxQuestionLength} characters.`,
  optionsMissing: "A Poll needs options. Add at least two.",
  optionsInsufficient: "One option isn't a Poll. Add at least one more.",
  optionsTooMany: `That's too many options. Keep it to ${POLL_CAPS.maxOptions}.`,
  optionTooLong: `That option is too long. Keep it to ${POLL_CAPS.maxOptionLength} characters.`,
  optionsDuplicate: "Two options say the same thing. Make one of them different.",
  descriptionTooLong: `That description is too long. Keep it to ${POLL_CAPS.maxDescriptionLength.toLocaleString("en-US")} characters.`,
  visibilityInvalid: "Pick a Visibility Setting.",
  deadlinePast:
    "That Deadline has already passed. The Poll would close before anyone saw it.",
  deadlineUnparseable: "That Deadline didn't parse. Check the date and time.",
  deadlineNonexistent:
    "That Deadline never happens — the clock skips right over it.",
  customLinkInvalid:
    "A Custom Link uses lowercase letters, digits, and hyphens. Nothing else.",
  customLinkTooLong: `That Custom Link is too long. Keep it to ${POLL_CAPS.maxCustomLinkLength} characters.`,
  customLinkReserved:
    "`{slug}` is reserved by the application itself. Pick something less structural.",
  customLinkTaken: "`{slug}` is taken. Pick another.",
  boundsMinTooLow:
    "Min is at least 1 — a Poll someone can't vote in isn't a Poll.",
  boundsOrder: "Min can't be more than max.",
  boundsMaxTooHigh: `Max can't be more than the option count ({count}).`,
  boundsWithoutMultiSelect: "Bounds only apply when multi-select is on.",
  createFailed: "That didn't publish. Nothing was created — try again.",
  duplicateDivergent: "That Poll already published. Start a new one.",
  dedupeUnconfirmable:
    "That may have published. Try again — a retry won't create it twice.",
  rowsTooMany: "That's too many rows. Clear the blank ones first.",
} as const;

// `datetime-local` values; the seconds component (step attributes,
// non-browser clients) is accepted with an optional fractional part that
// truncates to whole seconds.
const CIVIL_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?$/;

function isUsableTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

// What the given UTC instant reads as on a wall clock in `timeZone`,
// expressed as a Unix-ms value of that wall time taken as UTC.
function wallTimeAsUtcMs(timeZone: string, utcMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(utcMs));
  const get = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  return Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
}

// Returned when the civil value is format-valid but names a wall-clock time
// that never occurs in the zone (a spring-forward DST gap) — distinct from
// malformed input, which returns null.
export const CIVIL_TIME_NONEXISTENT = "nonexistent" as const;

// Converts a civil `datetime-local` value to UTC Unix ms, interpreting it in
// the given IANA zone. Missing or invalid zones fall back to UTC — the no-JS
// baseline (decision, 2026-07-29). Returns null when the value itself does
// not parse as a real calendar datetime, CIVIL_TIME_NONEXISTENT when it
// parses but never happens on that zone's clock.
export function civilToUtcMs(
  civil: string,
  timeZone: string | null,
): number | null | typeof CIVIL_TIME_NONEXISTENT {
  const match = CIVIL_PATTERN.exec(civil);
  if (!match) {
    return null;
  }
  const [, year, month, day, hour, minute] = match.map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const second = match[6] === undefined ? 0 : Number(match[6]);
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const check = new Date(asUtc);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    check.getUTCHours() !== hour ||
    check.getUTCMinutes() !== minute ||
    check.getUTCSeconds() !== second
  ) {
    return null;
  }
  const zone =
    timeZone && timeZone !== "UTC" && isUsableTimeZone(timeZone)
      ? timeZone
      : null;
  if (zone === null) {
    return asUtc;
  }
  // Iterate the zone offset twice so a guess that lands across a DST
  // transition converges on the instant whose wall time matches the input.
  let utc = asUtc;
  for (let i = 0; i < 2; i += 1) {
    utc = asUtc - (wallTimeAsUtcMs(zone, utc) - utc);
  }
  // A spring-forward gap time never converges — reject it rather than hand
  // back an instant whose wall clock doesn't match what the Creator typed.
  // Ambiguous fall-back times resolve to their first occurrence, which does
  // match.
  if (wallTimeAsUtcMs(zone, utc) !== asUtc) {
    return CIVIL_TIME_NONEXISTENT;
  }
  return utc;
}

const BASE64URL_REFERENCE_BYTES = 16;

// Generated public references: 16 random bytes = 128 bits, above the 96-bit
// AD-13 floor, base64url without padding. Injectable bytes for tests only.
export function generatePollReference(bytes?: Uint8Array): string {
  const source =
    bytes ?? crypto.getRandomValues(new Uint8Array(BASE64URL_REFERENCE_BYTES));
  let binary = "";
  for (const byte of source) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function isResultVisibility(value: string): value is ResultVisibility {
  return (RESULT_VISIBILITIES as readonly string[]).includes(value);
}

// The one Custom Link normalization: trim + lowercase-fold, blank folds to
// null (the generated-reference path). Validation and the deadline-past
// dedupe compare share it so the two can never drift. The string fallback
// keeps the command safe if an older/non-TypeScript client omits the newly
// introduced field.
function normalizeCustomLink(value: string | undefined): string | null {
  return (value ?? "").trim().toLowerCase() || null;
}

// Is a root-path URL param a plausible case variant of a custom slug? The
// public resolver pays a NOCASE scan only when this holds (Story 1.4
// review). The raw form must be ASCII: stored slugs are [a-z0-9-] and only
// ASCII letters have case, so a non-ASCII byte can never be a case variant
// — testing the raw form keeps Unicode fold quirks (ſ, ı, Kelvin K) out by
// construction, with no `/i` or fold semantics consulted at all. Bounded by
// the slug cap so oversized probes skip the scan too. Pure domain policy
// (AD-1); the route decides what to do with the answer.
export function isCustomSlugCaseVariant(reference: string): boolean {
  return (
    reference.length <= POLL_CAPS.maxCustomLinkLength &&
    /^[a-zA-Z0-9-]+$/.test(reference) &&
    reference !== reference.toLowerCase()
  );
}

export function validateCreatePoll(
  draft: CreatePollDraft,
  nowMs: number,
): Result<ValidatedCreatePoll> {
  const fieldErrors: Record<string, string> = {};
  // Stable per-field reason codes — policy (e.g. retry-after-deadline
  // dedupe) keys off these, never off the Voice copy.
  const reasonCodes: Record<string, string> = {};
  const fail = (field: string, reason: string, message: string): void => {
    fieldErrors[field] = message;
    reasonCodes[field] = reason;
  };

  // The Voice copy says "characters" — count code points, not UTF-16 code
  // units, so emoji and other astral characters count as one.
  const codePoints = (value: string): number => [...value].length;

  const question = draft.question.trim();
  if (question.length === 0) {
    fail("question", "question_missing", CREATE_POLL_COPY.questionMissing);
  } else if (codePoints(question) > POLL_CAPS.maxQuestionLength) {
    fail("question", "question_too_long", CREATE_POLL_COPY.questionTooLong);
  }

  const labels = draft.options
    .map((label) => label.trim())
    .filter((label) => label.length > 0);
  if (labels.length === 0) {
    fail("options", "options_missing", CREATE_POLL_COPY.optionsMissing);
  } else if (labels.length === 1) {
    fail("options", "options_insufficient", CREATE_POLL_COPY.optionsInsufficient);
  } else if (labels.length > POLL_CAPS.maxOptions) {
    fail("options", "options_too_many", CREATE_POLL_COPY.optionsTooMany);
  } else if (
    labels.some((label) => codePoints(label) > POLL_CAPS.maxOptionLength)
  ) {
    fail("options", "option_too_long", CREATE_POLL_COPY.optionTooLong);
  } else if (new Set(labels).size !== labels.length) {
    // Exact duplicates after trimming are rejected (decision, 2026-07-29).
    fail("options", "options_duplicate", CREATE_POLL_COPY.optionsDuplicate);
  }

  const multiSelect = draft.multiSelect === "true";
  const rawMinSelections = draft.minSelections.trim();
  const rawMaxSelections = draft.maxSelections.trim();
  let minSelections: number | null = null;
  let maxSelections: number | null = null;

  if (!multiSelect) {
    if (rawMinSelections.length > 0 || rawMaxSelections.length > 0) {
      fail(
        "multiSelect",
        "bounds_without_multi_select",
        CREATE_POLL_COPY.boundsWithoutMultiSelect,
      );
    }
  } else {
    if (rawMinSelections.length > 0) {
      const parsedMin = Number(rawMinSelections);
      if (!Number.isInteger(parsedMin) || parsedMin < 1) {
        fail(
          "minSelections",
          "bounds_min_too_low",
          CREATE_POLL_COPY.boundsMinTooLow,
        );
      } else {
        minSelections = parsedMin;
      }
    }

    if (rawMaxSelections.length > 0) {
      const parsedMax = Number(rawMaxSelections);
      if (!Number.isInteger(parsedMax)) {
        fail(
          "maxSelections",
          "bounds_max_too_high",
          CREATE_POLL_COPY.boundsMaxTooHigh.replace(
            "{count}",
            String(labels.length),
          ),
        );
      } else {
        maxSelections = parsedMax;
      }
    }

    const effectiveMin = minSelections ?? 1;
    const effectiveMax = maxSelections ?? labels.length;
    if (
      fieldErrors["minSelections"] === undefined &&
      fieldErrors["maxSelections"] === undefined &&
      effectiveMin > effectiveMax
    ) {
      fail("minSelections", "bounds_order", CREATE_POLL_COPY.boundsOrder);
    } else if (
      fieldErrors["maxSelections"] === undefined &&
      effectiveMax > labels.length
    ) {
      fail(
        "maxSelections",
        "bounds_max_too_high",
        CREATE_POLL_COPY.boundsMaxTooHigh.replace(
          "{count}",
          String(labels.length),
        ),
      );
    }
  }

  const description = draft.description.trim();
  if (codePoints(description) > POLL_CAPS.maxDescriptionLength) {
    fail(
      "description",
      "description_too_long",
      CREATE_POLL_COPY.descriptionTooLong,
    );
  }

  if (!isResultVisibility(draft.resultVisibility)) {
    fail("visibility", "visibility_invalid", CREATE_POLL_COPY.visibilityInvalid);
  }

  const customLink = normalizeCustomLink(draft.customLink);
  if (customLink !== null) {
    // AC #3 requires structural names such as `/`, `_astro`, and dotted
    // filenames to receive reserved-path copy. Treat an exact registry match
    // as admitted by the format gate, then retain format -> length -> reserved
    // ordering for every other value.
    const customLinkReserved = isReservedSlug(customLink);
    if (!/^[a-z0-9-]+$/.test(customLink) && !customLinkReserved) {
      fail(
        "customLink",
        "custom_link_invalid",
        CREATE_POLL_COPY.customLinkInvalid,
      );
    } else if (customLink.length > POLL_CAPS.maxCustomLinkLength) {
      fail(
        "customLink",
        "custom_link_too_long",
        CREATE_POLL_COPY.customLinkTooLong,
      );
    } else if (customLinkReserved) {
      fail(
        "customLink",
        "custom_link_reserved",
        CREATE_POLL_COPY.customLinkReserved.replace("{slug}", customLink),
      );
    }
  }

  let deadlineMs: number | null = null;
  const deadlineLocal = draft.deadlineLocal.trim();
  if (deadlineLocal.length > 0) {
    const timeZone = draft.timeZone.trim();
    const parsed = civilToUtcMs(deadlineLocal, timeZone.length > 0 ? timeZone : null);
    if (parsed === CIVIL_TIME_NONEXISTENT) {
      fail("deadline", "deadline_nonexistent", CREATE_POLL_COPY.deadlineNonexistent);
    } else if (parsed === null) {
      fail("deadline", "deadline_unparseable", CREATE_POLL_COPY.deadlineUnparseable);
    } else if (parsed <= nowMs) {
      fail("deadline", "deadline_past", CREATE_POLL_COPY.deadlinePast);
    } else {
      deadlineMs = parsed;
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      ok: false,
      error: {
        code: "poll_validation_failed",
        message: "Fix the fields below.",
        fieldErrors,
        reasonCodes,
      },
    };
  }

  const facts = multipleChoiceStrategy.create(
    {
      optionLabels: labels,
      multiSelect,
      minSelections,
      maxSelections,
    },
    { nowMs },
  );
  if (!facts.ok) {
    return facts;
  }

  return {
    ok: true,
    value: {
      question,
      description: description.length > 0 ? description : null,
      options: facts.value.options,
      resultVisibility: draft.resultVisibility as ResultVisibility,
      deadlineMs,
      customLink,
      multiSelect: facts.value.multiSelect,
      minSelections: facts.value.minSelections,
      maxSelections: facts.value.maxSelections,
    },
  };
}

// Persistence rows for the one D1 batch (AD-3). The adapter maps these to
// statements; a failed batch leaves no reachable Poll.
export type PollPersistenceRows = {
  poll: {
    id: PollId;
    ownerUserId: UserId;
    pollType: "multiple_choice";
    question: string;
    description: string | null;
    resultVisibility: ResultVisibility;
    discoveryState: "unlisted";
    sessionChecksEnabled: true;
    multiSelectEnabled: boolean;
    minSelections: number | null;
    maxSelections: number | null;
    deadlineMs: number | null;
    representationVersion: 1;
    createdAtMs: number;
  };
  options: {
    id: PollOptionId;
    pollId: PollId;
    label: string;
    position: number;
    createdAtMs: number;
  }[];
  reference: {
    reference: string;
    pollId: PollId;
    kind: "generated" | "custom";
    createdAtMs: number;
  };
};

// Thrown by the persistence adapter when the batch fails on the poll PRIMARY
// KEY — the typed signal for a duplicate publish carrying an already-used
// idempotency ID (D4 dedupe). All other failures keep the generic mapping.
export class DuplicatePollIdError extends Error {
  constructor(message = "duplicate poll id") {
    super(message);
    this.name = "DuplicatePollIdError";
  }
}

// Thrown by the persistence adapter when the reference PRIMARY KEY collides.
// The command maps it to a Custom Link field error only when the submitted
// draft actually used a custom link; generated-reference collisions remain
// generic failures.
export class ReferenceTakenError extends Error {
  constructor(message = "poll reference taken") {
    super(message);
    this.name = "ReferenceTakenError";
  }
}

// The read port the dedupe policy needs: the already-published Poll behind a
// colliding ID, scoped to its owner. Structurally satisfied by the D1
// adapter's `findPollForOwner`; the module stays provider-free (AD-1).
export type ExistingPollSnapshot = {
  question: string;
  description: string | null;
  resultVisibility: ResultVisibility;
  deadlineMs: number | null;
  multiSelectEnabled: boolean;
  minSelections: number | null;
  maxSelections: number | null;
  options: { label: string; position: number }[];
  canonicalReference: string;
  canonicalReferenceKind: PollPersistenceRows["reference"]["kind"];
  createdAtMs: number;
};

// The "Your Poll is live." outcome belongs to a fresh publish; a late retry
// lands on the plain confirmation instead. Shared by both creator routes.
export const RECENTLY_CREATED_WINDOW_MS = 10 * 60 * 1000;

export type CreatePollCommandDeps = {
  persist: (rows: PollPersistenceRows) => Promise<void>;
  generateId: () => string;
  generateReference: () => string;
  nowMs: () => number;
  // Consulted only on a duplicate-ID collision; absent (or throwing) falls
  // back to the generic poll_create_failed mapping.
  findExistingPoll?: (
    pollId: PollId,
    ownerUserId: UserId,
  ) => Promise<ExistingPollSnapshot | null>;
};

export type CreatePollOutcome = {
  pollId: PollId;
  reference: string;
  createdAtMs: number;
  /** true when the payload matched an already-published Poll (retry dedupe). */
  existing: boolean;
};

// A retried publish is the same Poll only when every persisted field matches
// — question, description, ordered trimmed option labels, visibility,
// deadline, and canonical reference. Anything else is a divergent
// resubmission (back-button edit).
// The deadline compares as resolved UTC instants: a retry from a different
// browser zone recomputes deadlineMs from the same civil value, so a
// zone-shifted retry is intentionally adjudicated divergent.
function matchesExistingPoll(
  validated: ValidatedCreatePoll,
  existing: ExistingPollSnapshot,
): boolean {
  const referenceMatches =
    validated.customLink === null
      ? existing.canonicalReferenceKind === "generated"
      : existing.canonicalReferenceKind === "custom" &&
        validated.customLink === existing.canonicalReference;
  return (
    referenceMatches &&
    validated.question === existing.question &&
    validated.description === existing.description &&
    validated.resultVisibility === existing.resultVisibility &&
    validated.deadlineMs === existing.deadlineMs &&
    validated.multiSelect === existing.multiSelectEnabled &&
    validated.minSelections === existing.minSelections &&
    validated.maxSelections === existing.maxSelections &&
    validated.options.length === existing.options.length &&
    validated.options.every(
      (option, index) =>
        option.label === existing.options[index]?.label &&
        option.position === existing.options[index]?.position,
    )
  );
}

// True only when deadlinePast is the sole validation failure — the shape a
// retry of a Poll whose own Deadline has since passed arrives in. Keys off
// the stable reason code, never the rendered copy.
function isOnlyDeadlinePastError(error: ApplicationError): boolean {
  const reasons = error.reasonCodes ?? {};
  return (
    Object.keys(reasons).length === 1 &&
    reasons["deadline"] === "deadline_past"
  );
}

// Rebuilds the validated content shape for a draft whose only failure is a
// past deadline — every other field is known clean, and normalization comes
// from the same helpers validation uses (normalizeCustomLink, trim/filter).
function draftContentForCompare(
  draft: CreatePollDraft,
): ValidatedCreatePoll | null {
  const timeZone = draft.timeZone.trim();
  const deadlineMs = civilToUtcMs(
    draft.deadlineLocal.trim(),
    timeZone.length > 0 ? timeZone : null,
  );
  if (
    deadlineMs === null ||
    deadlineMs === CIVIL_TIME_NONEXISTENT ||
    !isResultVisibility(draft.resultVisibility)
  ) {
    return null;
  }
  const description = draft.description.trim();
  const multiSelect = draft.multiSelect === "true";
  const rawMinSelections = draft.minSelections.trim();
  const rawMaxSelections = draft.maxSelections.trim();
  return {
    question: draft.question.trim(),
    description: description.length > 0 ? description : null,
    options: draft.options
      .map((label) => label.trim())
      .filter((label) => label.length > 0)
      .map((label, position) => ({ label, position })),
    resultVisibility: draft.resultVisibility as ResultVisibility,
    deadlineMs,
    customLink: normalizeCustomLink(draft.customLink),
    multiSelect,
    minSelections:
      multiSelect && rawMinSelections.length > 0
        ? Number(rawMinSelections)
        : null,
    maxSelections:
      multiSelect && rawMaxSelections.length > 0
        ? Number(rawMaxSelections)
        : null,
  };
}

// Failure-contained dedupe lookup: a throw (D1 outage) reads the same as
// "not found" to the caller, which maps both to the unconfirmable-retry
// outcome — never an unhandled 500.
async function lookupExistingPoll(
  deps: CreatePollCommandDeps,
  pollId: PollId,
  ownerUserId: UserId,
): Promise<ExistingPollSnapshot | null> {
  if (!deps.findExistingPoll) {
    return null;
  }
  try {
    return await deps.findExistingPoll(pollId, ownerUserId);
  } catch {
    return null;
  }
}

export async function createPoll(
  deps: CreatePollCommandDeps,
  ownerUserId: UserId,
  draft: CreatePollDraft,
): Promise<Result<CreatePollOutcome>> {
  const nowMs = deps.nowMs();
  const validated = validateCreatePoll(draft, nowMs);

  const idempotencyId: PollId | null =
    draft.idempotencyId && isUuidShape(draft.idempotencyId)
      ? (draft.idempotencyId.toLowerCase() as PollId)
      : null;

  if (!validated.ok) {
    // Retry-after-deadline: an identical retry of a Poll whose own Deadline
    // has since passed must dedupe to the existing Poll, not 422 about a
    // live Poll's past Deadline. A divergent retry gets the divergent error
    // (the route mints a fresh nonce so the edit can publish as a new Poll);
    // only a failed or empty lookup falls back to the validation error.
    if (idempotencyId && isOnlyDeadlinePastError(validated.error)) {
      const content = draftContentForCompare(draft);
      const existing = await lookupExistingPoll(deps, idempotencyId, ownerUserId);
      if (content && existing) {
        if (matchesExistingPoll(content, existing)) {
          return {
            ok: true,
            value: {
              pollId: idempotencyId,
              reference: existing.canonicalReference,
              createdAtMs: existing.createdAtMs,
              existing: true,
            },
          };
        }
        const error: ApplicationError = {
          code: "poll_duplicate_divergent",
          message: CREATE_POLL_COPY.duplicateDivergent,
        };
        return { ok: false, error };
      }
    }
    return validated;
  }

  const pollId: PollId = idempotencyId ?? (deps.generateId() as PollId);

  const createFailed = (
    cause: unknown,
    message: string = CREATE_POLL_COPY.createFailed,
  ): Result<CreatePollOutcome> => {
    // The driver message is logged server-side for diagnostics (AD-15:
    // IDs/codes only, never creator text bodies or raw SQL). The client
    // only ever receives the stable code + safe message below.
    console.error("poll_create_failed", {
      pollId,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
    // Stable code, safe message — never provider or SQL detail
    // (Consistency Conventions).
    const error: ApplicationError = {
      code: "poll_create_failed",
      message,
    };
    return { ok: false, error };
  };

  let reference: string;
  let referenceKind: PollPersistenceRows["reference"]["kind"];
  if (validated.value.customLink !== null) {
    // A Custom Link substitutes for the random reference. One canonical row,
    // one public URL, and no generated-reference draw (FR-3, AD-13).
    reference = validated.value.customLink;
    referenceKind = "custom";
  } else {
    // Generated references are checked against the reserved-slug registry
    // (AD-13): a collision is practically impossible, the check still applies.
    // Bounded — a generator that keeps returning reserved slugs is broken, so
    // fail the create rather than loop forever.
    reference = deps.generateReference();
    for (
      let attempt = 0;
      attempt < 2 && isReservedSlug(reference);
      attempt += 1
    ) {
      reference = deps.generateReference();
    }
    if (isReservedSlug(reference)) {
      return createFailed(
        new Error("reference generator returned reserved slugs after 3 draws"),
      );
    }
    referenceKind = "generated";
  }
  const rows: PollPersistenceRows = {
    poll: {
      id: pollId,
      ownerUserId,
      pollType: "multiple_choice",
      question: validated.value.question,
      description: validated.value.description,
      resultVisibility: validated.value.resultVisibility,
      discoveryState: "unlisted",
      sessionChecksEnabled: true,
      multiSelectEnabled: validated.value.multiSelect,
      minSelections: validated.value.minSelections,
      maxSelections: validated.value.maxSelections,
      deadlineMs: validated.value.deadlineMs,
      representationVersion: 1,
      createdAtMs: nowMs,
    },
    options: validated.value.options.map((option) => ({
      id: deps.generateId() as PollOptionId,
      pollId,
      label: option.label,
      position: option.position,
      createdAtMs: nowMs,
    })),
    reference: {
      reference,
      pollId,
      kind: referenceKind,
      createdAtMs: nowMs,
    },
  };

  try {
    await deps.persist(rows);
  } catch (cause) {
    if (cause instanceof DuplicatePollIdError && deps.findExistingPoll) {
      // D4 dedupe policy: the ID already published. Identical payload → the
      // retry is safe, return the existing Poll. Divergent payload → a
      // back-button edit, which must never silently redirect to the old one.
      const existing = await lookupExistingPoll(deps, pollId, ownerUserId);
      if (existing) {
        if (matchesExistingPoll(validated.value, existing)) {
          return {
            ok: true,
            value: {
              pollId,
              reference: existing.canonicalReference,
              createdAtMs: existing.createdAtMs,
              existing: true,
            },
          };
        }
        const error: ApplicationError = {
          code: "poll_duplicate_divergent",
          message: CREATE_POLL_COPY.duplicateDivergent,
        };
        return { ok: false, error };
      }
      // The nonce collided but the existing Poll can't be confirmed (the
      // lookup failed, or it belongs to someone else): "nothing was
      // created" may be a lie here, so the copy says so instead.
      return createFailed(cause, CREATE_POLL_COPY.dedupeUnconfirmable);
    }
    if (
      cause instanceof ReferenceTakenError &&
      validated.value.customLink !== null
    ) {
      const error: ApplicationError = {
        code: "poll_validation_failed",
        message: "Fix the fields below.",
        fieldErrors: {
          customLink: CREATE_POLL_COPY.customLinkTaken.replace(
            "{slug}",
            validated.value.customLink,
          ),
        },
        reasonCodes: { customLink: "custom_link_taken" },
      };
      return { ok: false, error };
    }
    return createFailed(cause);
  }

  return {
    ok: true,
    value: { pollId, reference, createdAtMs: nowMs, existing: false },
  };
}
