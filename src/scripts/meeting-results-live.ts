// Progressive live enhancement for Meeting availability results. The server
// remains the sole tally authority; this client validates and renders only the
// identifier-free projection returned by /results/live.

import { formatMeetingSlotLocal, meetingSlotDayKey } from "../lib/datetime";
import {
  COMMENT_CAPS,
  isCommentTimestamp,
  type CommentView,
} from "../modules/comments/index";
import { isUsableTimeZone } from "../modules/polls/index";
import type { LiveMeetingResultsPayload } from "../modules/results/index";
import {
  isAvailabilityState,
  type AvailabilityState,
} from "../shared/domain/index";
import {
  createResultsLiveState,
  markResultsLiveFailure,
  markResultsLiveSuccess,
  nextResultsPollDelayMs,
  parseResultsValidator,
  reserveResultsReload,
  sameCommentSnapshot,
  shouldAdoptResultsValidator,
  shouldPollResults,
  shouldReloadOwnerCommentControls,
} from "./results-live-core";

/** Keep in sync with RESULTS_COPY.empty; scripts must remain browser-safe. */
const MEETING_EMPTY_COPY =
  "No Votes yet. Yours would be the first, which is a kind of power.";
const RELOAD_COUNT_STORAGE_KEY_PREFIX =
  "oddspark.meeting-results-live.reload-count";

type MeetingLiveSlot = LiveMeetingResultsPayload["slots"][number];
type MeetingLiveVoter = LiveMeetingResultsPayload["voters"][number];
type ReloadRecovery = { token: string; count: number };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const hasExactKeys = (
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean => {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => key in value);
};

const isNonNegativeSafeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const isDateTimestamp = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  Number.isFinite(new Date(value).getTime());

const isMeetingSlot = (value: unknown): value is MeetingLiveSlot => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "startsAtMs",
      "endsAtMs",
      "timeZone",
      "position",
      "yesCount",
      "ifNeedBeCount",
      "noCount",
      "isBest",
    ])
  ) {
    return false;
  }
  return (
    isDateTimestamp(value.startsAtMs) &&
    isDateTimestamp(value.endsAtMs) &&
    value.endsAtMs > value.startsAtMs &&
    typeof value.timeZone === "string" &&
    isUsableTimeZone(value.timeZone) &&
    isNonNegativeSafeInteger(value.position) &&
    isNonNegativeSafeInteger(value.yesCount) &&
    isNonNegativeSafeInteger(value.ifNeedBeCount) &&
    isNonNegativeSafeInteger(value.noCount) &&
    typeof value.isBest === "boolean"
  );
};

const isMeetingVoter = (
  value: unknown,
  slotCount: number,
): value is MeetingLiveVoter => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["displayName", "availability"]) ||
    typeof value.displayName !== "string" ||
    value.displayName.length < 1 ||
    value.displayName.length > 80 ||
    value.displayName !== value.displayName.trim() ||
    /[\0\r\n]/u.test(value.displayName) ||
    !Array.isArray(value.availability) ||
    value.availability.length !== slotCount
  ) {
    return false;
  }
  return value.availability.every(
    (state) => state === null || isAvailabilityState(state),
  );
};

const isCommentView = (value: unknown): value is CommentView => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["body", "displayName", "createdAtMs"]) ||
    typeof value.body !== "string" ||
    value.body.length < 1 ||
    value.body.length > COMMENT_CAPS.body ||
    value.body !== value.body.trim() ||
    /[\0\r]/u.test(value.body) ||
    (value.displayName !== null &&
      (typeof value.displayName !== "string" ||
        value.displayName.length < 1 ||
        value.displayName.length > COMMENT_CAPS.displayName ||
        value.displayName !== value.displayName.trim() ||
        /[\0\r\n]/u.test(value.displayName))) ||
    !isCommentTimestamp(value.createdAtMs)
  ) {
    return false;
  }
  return true;
};

/**
 * Exact guard for the public Meeting live representation. Besides rejecting
 * unknown keys (and therefore private IDs), it verifies the position-aligned
 * matrix, server totals, and best-slot marks before any DOM is changed.
 */
export function isMeetingLivePayload(
  value: unknown,
): value is LiveMeetingResultsPayload {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "pollType",
      "status",
      "empty",
      "voterCount",
      "slots",
      "voters",
      "comments",
    ]) ||
    value.pollType !== "meeting" ||
    (value.status !== "open" && value.status !== "closed") ||
    typeof value.empty !== "boolean" ||
    !isNonNegativeSafeInteger(value.voterCount) ||
    !Array.isArray(value.slots) ||
    !Array.isArray(value.voters) ||
    !Array.isArray(value.comments)
  ) {
    return false;
  }

  const slots = value.slots;
  const voters = value.voters;
  const comments = value.comments;
  if (
    !slots.every(isMeetingSlot) ||
    !voters.every((voter) => isMeetingVoter(voter, slots.length)) ||
    !comments.every(isCommentView)
  ) {
    return false;
  }
  if (
    value.voterCount !== voters.length ||
    value.empty !== (voters.length === 0) ||
    slots.some(
      (slot, index) =>
        index > 0 && slot.position <= (slots[index - 1]?.position ?? -1),
    ) ||
    comments.some(
      (comment, index) =>
        index > 0 &&
        comment.createdAtMs > (comments[index - 1]?.createdAtMs ?? 0),
    )
  ) {
    return false;
  }

  for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
    const slot = slots[slotIndex];
    if (!slot) return false;
    let yesCount = 0;
    let ifNeedBeCount = 0;
    let noCount = 0;
    for (const voter of voters) {
      switch (voter.availability[slotIndex]) {
        case "yes":
          yesCount += 1;
          break;
        case "if_need_be":
          ifNeedBeCount += 1;
          break;
        case "no":
          noCount += 1;
          break;
        case null:
          break;
      }
    }
    if (
      slot.yesCount !== yesCount ||
      slot.ifNeedBeCount !== ifNeedBeCount ||
      slot.noCount !== noCount
    ) {
      return false;
    }
  }

  const leader = [...slots].sort(
    (left, right) =>
      right.yesCount - left.yesCount ||
      right.ifNeedBeCount - left.ifNeedBeCount ||
      left.position - right.position,
  )[0];
  return slots.every(
    (slot) =>
      slot.isBest ===
      Boolean(
        leader &&
          leader.yesCount > 0 &&
          slot.yesCount === leader.yesCount &&
          slot.ifNeedBeCount === leader.ifNeedBeCount,
      ),
  );
}

const readReloadRecovery = (key: string): ReloadRecovery => {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (raw === null) return { token: "", count: 0 };
    const parsed: unknown = JSON.parse(raw);
    if (
      isRecord(parsed) &&
      hasExactKeys(parsed, ["token", "count"]) &&
      typeof parsed.token === "string" &&
      isNonNegativeSafeInteger(parsed.count)
    ) {
      return { token: parsed.token, count: parsed.count };
    }
  } catch {
    // Storage may be unavailable; the reload cap still holds for this load.
  }
  return { token: "", count: 0 };
};

const writeReloadRecovery = (key: string, recovery: ReloadRecovery): void => {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(recovery));
  } catch {
    // Storage may be unavailable; retain the in-memory recovery count.
  }
};

const clearReloadRecovery = (key: string): void => {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // Storage may be unavailable; callers still reset their in-memory count.
  }
};

const renderedComments = (root: HTMLElement): CommentView[] => {
  const region = root.closest<HTMLElement>("[data-results-region]");
  return Array.from(
    region?.querySelectorAll<HTMLElement>("[data-comment-item]") ?? [],
  ).flatMap((item) => {
    const body = item.querySelector<HTMLElement>("[data-comment-body]");
    const displayName = item.querySelector<HTMLElement>(
      "[data-comment-display-name]",
    );
    const createdAtMs = Number(item.dataset.commentCreatedAtMs);
    if (!body || !displayName || !isCommentTimestamp(createdAtMs)) return [];
    return [
      {
        body: body.textContent ?? "",
        displayName:
          displayName.dataset.commentAnonymous === "true"
            ? null
            : (displayName.textContent ?? ""),
        createdAtMs,
      },
    ];
  });
};

const scopeAttributeNames = (content: HTMLElement): string[] => {
  const names = new Set<string>();
  const collect = (element: Element): void => {
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.name.startsWith("data-astro-cid-")) {
        names.add(attribute.name);
      }
    }
  };
  collect(content);
  const descendant = content.querySelector("*");
  if (descendant) collect(descendant);
  return [...names];
};

const createScopedFactory = (content: HTMLElement) => {
  const scopeAttributes = scopeAttributeNames(content);
  return <K extends keyof HTMLElementTagNameMap>(
    tagName: K,
    className?: string,
  ): HTMLElementTagNameMap[K] => {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    for (const attribute of scopeAttributes) {
      element.setAttribute(attribute, "");
    }
    return element;
  };
};

const safeZone = (candidate: string | undefined): string =>
  candidate && isUsableTimeZone(candidate) ? candidate : "UTC";

const currentRenderZone = (root: HTMLElement): string => {
  if (
    root.dataset.fixedZone === "true" &&
    isUsableTimeZone(root.dataset.renderZone ?? "")
  ) {
    return root.dataset.renderZone as string;
  }
  const select = root.querySelector(
    "[data-timezone-select]",
  ) as unknown as HTMLSelectElement | null;
  if (select && isUsableTimeZone(select.value)) return select.value;
  if (isUsableTimeZone(root.dataset.renderZone ?? "")) {
    return root.dataset.renderZone as string;
  }
  return safeZone(root.dataset.sourceZone);
};

const stateLabel = (state: AvailabilityState | null): string => {
  switch (state) {
    case "yes":
      return "Yes";
    case "if_need_be":
      return "If need be";
    case "no":
      return "No";
    case null:
      return "Unanswered";
  }
};

const enhanceMeetingResults = (root: HTMLElement): void => {
  if (root.dataset.liveEnhanced === "true") return;
  const endpoint = root.dataset.liveEndpoint;
  if (!endpoint || root.dataset.status !== "open") return;

  const content = root.querySelector<HTMLElement>(
    "[data-meeting-tally-content]",
  );
  if (!content) return;
  root.dataset.liveEnhanced = "true";

  const create = createScopedFactory(content);
  let liveState = root.querySelector<HTMLElement>(
    "[data-meeting-live-status]",
  );
  if (!liveState) {
    liveState = create("p", "meeting-live-status");
    liveState.dataset.meetingLiveStatus = "";
    liveState.dataset.liveState = "live";
    liveState.setAttribute("role", "status");
    liveState.setAttribute("aria-live", "polite");
    root.insertBefore(liveState, content);
  }

  const initialRenderAtMs = Number(root.dataset.initialRenderAt);
  let state = createResultsLiveState(
    Number.isFinite(initialRenderAtMs) ? initialRenderAtMs : Date.now(),
  );
  const initialValidator = root.dataset.initialValidator;
  let validator: string | null =
    initialValidator !== undefined && parseResultsValidator(initialValidator)
      ? initialValidator
      : null;
  const reloadStorageKey = `${RELOAD_COUNT_STORAGE_KEY_PREFIX}:${endpoint}`;
  const storedRecovery = readReloadRecovery(reloadStorageKey);
  let reloadToken = storedRecovery.token;
  let reloadCount = storedRecovery.count;
  let reloadStarted = false;
  let timer: number | null = null;
  let controller: AbortController | null = null;
  let requestGeneration = 0;

  const clearTimer = (): void => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
  };

  const abortRefresh = (): void => {
    requestGeneration += 1;
    controller?.abort();
    controller = null;
  };

  const resetReloadCount = (): void => {
    reloadToken = "";
    reloadCount = 0;
    clearReloadRecovery(reloadStorageKey);
  };

  const showReconnecting = (): void => {
    liveState.textContent = "RECONNECTING";
    liveState.dataset.liveState = "reconnecting";
    root.dataset.liveConnection = "stale";
  };

  const showConnected = (status: "open" | "closed"): void => {
    root.dataset.status = status;
    root.dataset.liveConnection = status === "closed" ? "closed" : "live";
    liveState.dataset.liveState = status;
    liveState.textContent = status === "closed" ? "CLOSED" : "LIVE";
  };

  const enterReconnecting = (): void => {
    if (
      reloadStarted ||
      state.connection.kind === "closed" ||
      state.connection.kind === "stale"
    ) {
      return;
    }
    state = markResultsLiveFailure(state);
    showReconnecting();
  };

  const reloadOnce = (token: string): void => {
    if (reloadStarted) return;
    reloadStarted = true;
    clearTimer();
    abortRefresh();
    const reservation = reserveResultsReload(
      { token: reloadToken, count: reloadCount },
      token,
    );
    reloadToken = reservation.recovery.token;
    reloadCount = reservation.recovery.count;
    if (!reservation.allowed) {
      state = markResultsLiveFailure(state);
      liveState.textContent = "RESULTS MAY BE OUT OF DATE";
      liveState.dataset.liveState = "stale";
      root.dataset.liveConnection = "stale";
      return;
    }
    writeReloadRecovery(reloadStorageKey, reservation.recovery);
    window.location.reload();
  };

  const decorateSlot = (
    element: HTMLElement,
    slot: MeetingLiveSlot,
  ): void => {
    element.dataset.slot = "";
    element.dataset.slotPosition = String(slot.position);
    element.dataset.startsAt = String(slot.startsAtMs);
    element.dataset.endsAt = String(slot.endsAtMs);
    element.dataset.sourceZone = safeZone(slot.timeZone);
  };

  const sourceCaption = (slot: MeetingLiveSlot): string => {
    const zone = safeZone(slot.timeZone);
    const zoneName =
      new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        timeZoneName: "short",
      })
        .formatToParts(slot.startsAtMs)
        .find((part) => part.type === "timeZoneName")?.value ?? zone;
    return `created ${formatMeetingSlotLocal(slot.startsAtMs, slot.endsAtMs, zone)} ${zoneName}`;
  };

  const appendSlotTime = (
    parent: HTMLElement,
    slot: MeetingLiveSlot,
    renderZone: string,
    heading: boolean,
  ): void => {
    const label = create(heading ? "h3" : "span", "slot-label");
    label.dataset.localTime = "";
    label.textContent = formatMeetingSlotLocal(
      slot.startsAtMs,
      slot.endsAtMs,
      renderZone,
    );
    const caption = create("span", "source-caption");
    caption.textContent = sourceCaption(slot);
    const shift = create("span", "day-shift");
    shift.dataset.dayShift = "";
    const sourceDay = meetingSlotDayKey(
      slot.startsAtMs,
      safeZone(slot.timeZone),
    );
    const renderedDay = meetingSlotDayKey(slot.startsAtMs, renderZone);
    if (sourceDay === renderedDay) {
      shift.hidden = true;
      shift.textContent = "+1 day";
    } else {
      shift.textContent = renderedDay.localeCompare(sourceDay) > 0
        ? "+1 day"
        : "-1 day";
    }
    parent.appendChild(label);
    parent.appendChild(caption);
    parent.appendChild(shift);
  };

  const availabilityCell = (
    cellState: AvailabilityState | null,
  ): HTMLSpanElement => {
    const cell = create("span", "availability-cell");
    if (cellState !== null) {
      cell.classList.add(`is-${cellState}`, "is-selected");
    }
    cell.setAttribute("role", "img");
    cell.setAttribute("aria-label", stateLabel(cellState));
    return cell;
  };

  const slotTotals = (slot: MeetingLiveSlot): HTMLParagraphElement => {
    const totals = create("p", "slot-totals");
    const yes = create("span");
    yes.textContent = `YES ${slot.yesCount}`;
    const ifNeedBe = create("span");
    ifNeedBe.textContent = `IF NEED BE ${slot.ifNeedBeCount}`;
    totals.appendChild(yes);
    totals.appendChild(ifNeedBe);
    return totals;
  };

  const buildMobile = (
    payload: LiveMeetingResultsPayload,
    renderZone: string,
  ): HTMLDivElement => {
    const mobile = create("div", "meeting-tally-mobile");
    mobile.dataset.meetingTallyMobile = "";
    payload.slots.forEach((slot, slotIndex) => {
      const section = create("section", "meeting-slot-block");
      if (slot.isBest) section.classList.add("is-best");
      decorateSlot(section, slot);
      const header = create("header", "slot-header");
      appendSlotTime(header, slot, renderZone, true);
      section.appendChild(header);
      const voters = create("div", "mobile-voters");
      for (const voter of payload.voters) {
        const row = create("div", "mobile-voter-row");
        const name = create("span", "voter-name");
        name.textContent = voter.displayName;
        row.appendChild(name);
        row.appendChild(
          availabilityCell(voter.availability[slotIndex] ?? null),
        );
        voters.appendChild(row);
      }
      section.appendChild(voters);
      section.appendChild(slotTotals(slot));
      mobile.appendChild(section);
    });
    return mobile;
  };

  const buildMatrix = (
    payload: LiveMeetingResultsPayload,
    renderZone: string,
  ): HTMLDivElement => {
    const matrix = create("div", "meeting-tally-matrix");
    matrix.dataset.meetingTallyMatrix = "";
    const table = create("table");
    const caption = create("caption", "visually-hidden");
    caption.textContent = "Voter availability by proposed meeting slot";
    table.appendChild(caption);

    const thead = create("thead");
    const headingRow = create("tr");
    const voterHeading = create("th", "voter-heading");
    voterHeading.scope = "col";
    voterHeading.textContent = "VOTER";
    headingRow.appendChild(voterHeading);
    for (const slot of payload.slots) {
      const slotHeading = create("th", "slot-column-heading");
      slotHeading.scope = "col";
      if (slot.isBest) slotHeading.classList.add("is-best");
      decorateSlot(slotHeading, slot);
      appendSlotTime(slotHeading, slot, renderZone, false);
      headingRow.appendChild(slotHeading);
    }
    thead.appendChild(headingRow);
    table.appendChild(thead);

    const tbody = create("tbody");
    for (const voter of payload.voters) {
      const row = create("tr");
      const name = create("th", "voter-name");
      name.scope = "row";
      name.textContent = voter.displayName;
      row.appendChild(name);
      payload.slots.forEach((_slot, slotIndex) => {
        const cell = create("td", "matrix-cell");
        cell.appendChild(
          availabilityCell(voter.availability[slotIndex] ?? null),
        );
        row.appendChild(cell);
      });
      tbody.appendChild(row);
    }
    table.appendChild(tbody);

    const tfoot = create("tfoot");
    const totalsRow = create("tr");
    const totalsHeading = create("th", "totals-heading");
    totalsHeading.scope = "row";
    totalsHeading.textContent = "TOTALS";
    totalsRow.appendChild(totalsHeading);
    for (const slot of payload.slots) {
      const totalsCell = create("td", "slot-totals");
      const yes = create("span");
      yes.textContent = `YES ${slot.yesCount}`;
      const ifNeedBe = create("span");
      ifNeedBe.textContent = `IF NEED BE ${slot.ifNeedBeCount}`;
      totalsCell.appendChild(yes);
      totalsCell.appendChild(ifNeedBe);
      totalsRow.appendChild(totalsCell);
    }
    tfoot.appendChild(totalsRow);
    table.appendChild(tfoot);
    matrix.appendChild(table);
    return matrix;
  };

  const applyPayload = (payload: LiveMeetingResultsPayload): void => {
    const fragment = document.createDocumentFragment();
    if (payload.empty) {
      const empty = create("p", "meeting-empty");
      empty.textContent = MEETING_EMPTY_COPY;
      fragment.appendChild(empty);
    } else {
      const meta = create("p", "meeting-meta");
      meta.textContent =
        payload.voterCount === 1
          ? "1 VOTER"
          : `${payload.voterCount} VOTERS`;
      const renderZone = currentRenderZone(root);
      root.dataset.renderZone = renderZone;
      fragment.appendChild(meta);
      fragment.appendChild(buildMobile(payload, renderZone));
      fragment.appendChild(buildMatrix(payload, renderZone));
    }
    content.replaceChildren(fragment);
    root.dataset.status = payload.status;
    const select = root.querySelector(
      "[data-timezone-select]",
    ) as unknown as HTMLSelectElement | null;
    select?.dispatchEvent(new Event("change"));
  };

  const schedule = (): void => {
    clearTimer();
    if (
      reloadStarted ||
      !shouldPollResults(state, document.visibilityState, navigator.onLine)
    ) {
      return;
    }
    timer = window.setTimeout(() => {
      timer = null;
      void refresh();
    }, nextResultsPollDelayMs(state));
  };

  const refresh = async (): Promise<void> => {
    clearTimer();
    if (
      reloadStarted ||
      !shouldPollResults(state, document.visibilityState, navigator.onLine)
    ) {
      return;
    }

    abortRefresh();
    const generation = requestGeneration;
    const nextController = new AbortController();
    controller = nextController;
    const headers = new Headers({ accept: "application/json" });
    if (validator !== null) headers.set("if-none-match", validator);

    try {
      const response = await fetch(endpoint, {
        method: "GET",
        headers,
        cache: "no-store",
        credentials: "same-origin",
        signal: nextController.signal,
      });
      if (generation !== requestGeneration || nextController.signal.aborted) {
        return;
      }

      const incomingValidator = response.headers.get("etag");
      if (response.status === 304) {
        const parsed = parseResultsValidator(incomingValidator);
        if (!parsed || validator === null || incomingValidator !== validator) {
          reloadOnce("validator:304");
          return;
        }
        state = markResultsLiveSuccess(state, Date.now(), parsed.status);
        validator = incomingValidator;
        resetReloadCount();
        showConnected(parsed.status);
        schedule();
        return;
      }
      if (response.status === 204 || response.status === 404) {
        reloadOnce(`status:${response.status}`);
        return;
      }
      if (response.status !== 200 || incomingValidator === null) {
        throw new Error("Meeting live refresh failed");
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        reloadOnce("structural:json");
        return;
      }
      if (!isMeetingLivePayload(payload)) {
        reloadOnce("structural:payload");
        return;
      }
      const parsed = parseResultsValidator(incomingValidator);
      if (!parsed || parsed.status !== payload.status) {
        reloadOnce("structural:validator");
        return;
      }
      if (!shouldAdoptResultsValidator(validator, incomingValidator)) {
        reloadOnce(incomingValidator);
        return;
      }

      // Creator detail intentionally renders the tally without a Comment
      // list. Comment drift is relevant only on Results regions that own that
      // projection; otherwise a valid vote update would cause a reload loop.
      const region = root.closest<HTMLElement>("[data-results-region]");
      const commentsMatch =
        region === null ||
        sameCommentSnapshot(renderedComments(root), payload.comments);
      if (!commentsMatch) {
        reloadOnce(incomingValidator);
        return;
      }
      if (
        region !== null &&
        shouldReloadOwnerCommentControls({
          hasOwnerModeration: Boolean(
            region?.querySelector("[data-comment-moderation]"),
          ),
          previousValidator: validator,
          incomingValidator,
          commentsMatch,
        })
      ) {
        reloadOnce(incomingValidator);
        return;
      }

      applyPayload(payload);
      validator = incomingValidator;
      state = markResultsLiveSuccess(state, Date.now(), payload.status);
      resetReloadCount();
      showConnected(payload.status);
      schedule();
    } catch {
      if (generation !== requestGeneration || nextController.signal.aborted) {
        return;
      }
      state = markResultsLiveFailure(state);
      showReconnecting();
      schedule();
    } finally {
      if (controller === nextController) controller = null;
    }
  };

  document.addEventListener("visibilitychange", () => {
    if (reloadStarted || state.connection.kind === "closed") return;
    if (document.visibilityState === "hidden") {
      clearTimer();
      abortRefresh();
      return;
    }
    if (navigator.onLine) {
      void refresh();
    } else {
      enterReconnecting();
    }
  });
  window.addEventListener("offline", () => {
    if (reloadStarted || state.connection.kind === "closed") return;
    clearTimer();
    abortRefresh();
    enterReconnecting();
  });
  window.addEventListener("online", () => void refresh());
  window.addEventListener("pageshow", (event) => {
    if (
      !event.persisted ||
      reloadStarted ||
      state.connection.kind === "closed"
    ) {
      return;
    }
    if (navigator.onLine) void refresh();
    else enterReconnecting();
  });

  if (navigator.onLine) schedule();
  else enterReconnecting();
};

if (typeof document !== "undefined") {
  for (const root of document.querySelectorAll<HTMLElement>(
    "[data-meeting-results][data-live-endpoint]",
  )) {
    enhanceMeetingResults(root);
  }
}
