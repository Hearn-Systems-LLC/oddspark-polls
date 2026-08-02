import { barAccessibleName, barWidthPercent } from "../components/results-bar";
import { formatVoteTotal } from "../components/live-indicator";
import type { LiveResultsPayload } from "../modules/results/index";
import {
  createResultsLiveState,
  markResultsLiveFailure,
  markResultsLiveSuccess,
  nextResultsPollDelayMs,
  parseResultsValidator,
  shouldAdoptResultsValidator,
  shouldPollResults,
} from "./results-live-core";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isNonNegativeSafeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const isPercent = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 100;

const isLiveResultsPayload = (value: unknown): value is LiveResultsPayload => {
  if (!isRecord(value) || !Array.isArray(value.options)) {
    return false;
  }
  if (
    (value.status !== "open" && value.status !== "closed") ||
    typeof value.multiSelectEnabled !== "boolean" ||
    !isNonNegativeSafeInteger(value.voterCount) ||
    !isNonNegativeSafeInteger(value.selectionCount) ||
    typeof value.tied !== "boolean" ||
    typeof value.empty !== "boolean"
  ) {
    return false;
  }
  const validOptions = value.options.every(
    (option) =>
      isRecord(option) &&
      typeof option.id === "string" &&
      typeof option.label === "string" &&
      isNonNegativeSafeInteger(option.position) &&
      isNonNegativeSafeInteger(option.count) &&
      isPercent(option.percent) &&
      typeof option.leading === "boolean",
  );
  return (
    validOptions &&
    new Set(
      value.options.map((option) =>
        isRecord(option) && typeof option.id === "string" ? option.id : "",
      ),
    ).size === value.options.length
  );
};

const localRefreshTime = (timestampMs: number): string =>
  new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(timestampMs));

const enhanceResultsTally = (root: HTMLElement): void => {
  if (root.dataset.liveEnhanced === "true") {
    return;
  }
  const endpoint = root.dataset.liveEndpoint;
  if (!endpoint || root.dataset.liveStatus !== "open") {
    return;
  }

  const statusContent = root.querySelector<HTMLElement>(
    "[data-live-status-content]",
  );
  const staleContent = root.querySelector<HTMLElement>("[data-live-stale]");
  const staleTime = root.querySelector<HTMLElement>("[data-live-stale-time]");
  const announcement = root.querySelector<HTMLElement>(
    "[data-live-announcement]",
  );
  const indicator = root.querySelector<HTMLElement>("[data-live-indicator]");
  const indicatorDot = root.querySelector<HTMLElement>(
    ".live-indicator-dot",
  );
  const indicatorLabel = root.querySelector<HTMLElement>("[data-live-label]");
  const total = root.querySelector<HTMLElement>("[data-live-total]");
  const tied = root.querySelector<HTMLElement>("[data-live-tied]");
  const empty = root.querySelector<HTMLElement>("[data-live-empty]");
  const summary = root.querySelector<HTMLElement>("[data-live-summary]");
  const barsContainer = root.querySelector<HTMLElement>("[data-tally-final]");
  if (
    !statusContent ||
    !staleContent ||
    !staleTime ||
    !announcement ||
    !indicator ||
    !indicatorDot ||
    !indicatorLabel ||
    !total ||
    !tied ||
    !empty ||
    !barsContainer
  ) {
    return;
  }

  root.dataset.liveEnhanced = "true";
  const initialRenderAtMs = Number(root.dataset.liveInitialRenderAt);
  let state = createResultsLiveState(
    Number.isFinite(initialRenderAtMs) ? initialRenderAtMs : Date.now(),
  );
  let validator: string | null = null;
  let timer: number | null = null;
  let controller: AbortController | null = null;
  let requestGeneration = 0;
  let reloadStarted = false;
  const announcementQueue: string[] = [];
  let announcementActive = false;
  let announcementRevision = 0;
  let announcementTimer: number | null = null;

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

  const announceNext = (): void => {
    if (announcementActive) {
      return;
    }
    const message = announcementQueue.shift();
    if (message === undefined) {
      return;
    }
    announcementActive = true;
    const revision = announcementRevision;
    announcement.textContent = "";
    window.requestAnimationFrame(() => {
      if (revision !== announcementRevision) {
        return;
      }
      announcement.textContent = message;
      announcementTimer = window.setTimeout(() => {
        if (revision !== announcementRevision) {
          return;
        }
        announcement.textContent = "";
        announcementTimer = null;
        announcementActive = false;
        announceNext();
      }, 1_500);
    });
  };

  const announce = (message: string): void => {
    announcementQueue.push(message);
    announceNext();
  };

  const clearAnnouncements = (): void => {
    announcementRevision += 1;
    announcementQueue.length = 0;
    announcementActive = false;
    if (announcementTimer !== null) {
      window.clearTimeout(announcementTimer);
      announcementTimer = null;
    }
    announcement.textContent = "";
  };

  const showStale = (): void => {
    clearAnnouncements();
    statusContent.hidden = true;
    staleTime.textContent = localRefreshTime(
      state.connection.lastSuccessAtMs,
    );
    staleContent.hidden = false;
  };

  const enterStale = (): void => {
    if (
      reloadStarted ||
      state.connection.kind === "closed" ||
      state.connection.kind === "stale"
    ) {
      return;
    }
    state = markResultsLiveFailure(state);
    showStale();
  };

  const showConnected = (status: "open" | "closed"): void => {
    if (!staleContent.hidden) {
      staleContent.hidden = true;
    }
    if (statusContent.hidden) {
      statusContent.hidden = false;
    }
    if (indicator.dataset.status !== status) {
      indicator.dataset.status = status;
    }
    const closed = status === "closed";
    if (indicator.classList.contains("is-closed") !== closed) {
      indicator.classList.toggle("is-closed", closed);
    }
    if (indicatorDot.hidden !== closed) {
      indicatorDot.hidden = closed;
    }
    const label = closed ? "CLOSED" : "LIVE";
    if (indicatorLabel.textContent !== label) {
      indicatorLabel.textContent = label;
    }
    if (root.dataset.liveStatus !== status) {
      root.dataset.liveStatus = status;
    }
  };

  const reloadOnce = (): void => {
    if (!reloadStarted) {
      reloadStarted = true;
      clearTimer();
      abortRefresh();
      clearAnnouncements();
      window.location.reload();
    }
  };

  const reconcile = (payload: LiveResultsPayload): boolean => {
    const bars = Array.from(
      barsContainer.querySelectorAll<HTMLElement>("[data-option-id]"),
    );
    if (
      bars.length !== payload.options.length ||
      bars.some(
        (bar, index) =>
          bar.dataset.optionId !== payload.options[index]?.id,
      ) ||
      Boolean(summary) !== payload.multiSelectEnabled
    ) {
      reloadOnce();
      return false;
    }

    const previousLeaderId =
      bars.find((bar) => bar.classList.contains("is-leader"))?.dataset
        .optionId ?? null;
    const wasTied = !tied.hidden;

    const barHooks: {
      bar: HTMLElement;
      track: HTMLElement;
      label: HTMLElement;
      percent: HTMLElement;
      count: HTMLElement;
      leaderMark: HTMLElement;
    }[] = [];
    for (const bar of bars) {
      const track = bar.querySelector<HTMLElement>(".results-bar-track");
      const label = bar.querySelector<HTMLElement>(".results-bar-label");
      const percent = bar.querySelector<HTMLElement>(".results-bar-pct");
      const count = bar.querySelector<HTMLElement>(".results-bar-count");
      const leaderMark = bar.querySelector<HTMLElement>(
        ".results-bar-leader-mark",
      );
      if (!track || !label || !percent || !count || !leaderMark) {
        reloadOnce();
        return false;
      }
      barHooks.push({ bar, track, label, percent, count, leaderMark });
    }

    for (const [index, option] of payload.options.entries()) {
      const { bar, track, label, percent, count, leaderMark } =
        barHooks[index];
      const normalizedPercent = barWidthPercent(option.percent);
      const width = `${normalizedPercent}%`;
      if (track.style.getPropertyValue("--bar-width") !== width) {
        track.style.setProperty("--bar-width", width);
      }
      if (label.textContent !== option.label) {
        label.textContent = option.label;
      }
      if (percent.textContent !== width) {
        percent.textContent = width;
      }
      const countText = ` · ${option.count}`;
      if (count.textContent !== countText) {
        count.textContent = countText;
      }
      const accessibleName = barAccessibleName(
        option.label,
        normalizedPercent,
        option.count,
        option.leading,
      );
      if (bar.getAttribute("aria-label") !== accessibleName) {
        bar.setAttribute("aria-label", accessibleName);
      }
      if (bar.classList.contains("is-leader") !== option.leading) {
        bar.classList.toggle("is-leader", option.leading);
      }
      const zero = normalizedPercent === 0;
      if (bar.classList.contains("is-zero") !== zero) {
        bar.classList.toggle("is-zero", zero);
      }
      if (leaderMark.hidden === option.leading) {
        leaderMark.hidden = !option.leading;
      }
    }

    if (summary) {
      const summaryText = `${payload.voterCount} VOTERS · ${payload.selectionCount} SELECTIONS`;
      if (summary.textContent?.trim() !== summaryText) {
        summary.textContent = summaryText;
      }
    }
    if (tied.hidden === payload.tied) {
      tied.hidden = !payload.tied;
    }
    if (empty.hidden === payload.empty) {
      empty.hidden = !payload.empty;
    }
    const totalText = formatVoteTotal(payload.voterCount);
    if (total.textContent !== totalText) {
      total.textContent = totalText;
    }

    const nextLeader = payload.options.find((option) => option.leading);
    if (!wasTied && payload.tied) {
      announce("TIED");
    } else if (
      !payload.tied &&
      nextLeader &&
      nextLeader.id !== previousLeaderId
    ) {
      announce(
        `${nextLeader.label} now leading, ${barWidthPercent(nextLeader.percent)} percent.`,
      );
    }
    return true;
  };

  const schedule = (): void => {
    clearTimer();
    if (reloadStarted) {
      return;
    }
    if (
      !shouldPollResults(
        state,
        document.visibilityState,
        navigator.onLine,
      )
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
    if (reloadStarted) {
      return;
    }
    if (
      !shouldPollResults(
        state,
        document.visibilityState,
        navigator.onLine,
      )
    ) {
      return;
    }

    abortRefresh();
    const generation = requestGeneration;
    const nextController = new AbortController();
    controller = nextController;
    const headers = new Headers();
    if (validator !== null) {
      headers.set("if-none-match", validator);
    }

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
        if (
          !parsed ||
          validator === null ||
          incomingValidator !== validator
        ) {
          throw new Error("Invalid live Results validator");
        }
        const wasStale = state.connection.kind === "stale";
        validator = incomingValidator;
        state = markResultsLiveSuccess(state, Date.now(), parsed.status);
        if (wasStale) {
          showConnected(parsed.status);
          announce("Updates resumed.");
        }
        schedule();
        return;
      }

      if (response.status !== 200 || incomingValidator === null) {
        throw new Error("Live Results refresh failed");
      }
      const payload: unknown = await response.json();
      if (!isLiveResultsPayload(payload)) {
        throw new Error("Malformed live Results payload");
      }
      const parsedValidator = parseResultsValidator(incomingValidator);
      if (!parsedValidator || parsedValidator.status !== payload.status) {
        throw new Error("Mismatched live Results validator");
      }
      if (!shouldAdoptResultsValidator(validator, incomingValidator)) {
        schedule();
        return;
      }
      if (payload.status === "closed") {
        clearAnnouncements();
      }
      if (!reconcile(payload)) {
        return;
      }

      const wasStale = state.connection.kind === "stale";
      validator = incomingValidator;
      state = markResultsLiveSuccess(state, Date.now(), payload.status);
      if (wasStale || root.dataset.liveStatus !== payload.status) {
        showConnected(payload.status);
      }
      if (wasStale) {
        announce("Updates resumed.");
      }
      schedule();
    } catch {
      if (generation !== requestGeneration || nextController.signal.aborted) {
        return;
      }
      const wasLive = state.connection.kind === "live";
      state = markResultsLiveFailure(state);
      if (wasLive && state.connection.kind === "stale") {
        showStale();
      }
      schedule();
    } finally {
      if (controller === nextController) {
        controller = null;
      }
    }
  };

  document.addEventListener("visibilitychange", () => {
    if (reloadStarted || state.connection.kind === "closed") {
      return;
    }
    if (document.visibilityState === "hidden") {
      clearTimer();
      abortRefresh();
      return;
    }
    if (navigator.onLine) {
      void refresh();
    } else {
      enterStale();
    }
  });
  window.addEventListener("offline", () => {
    if (reloadStarted || state.connection.kind === "closed") {
      return;
    }
    clearTimer();
    abortRefresh();
    enterStale();
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
    if (navigator.onLine) {
      void refresh();
    } else {
      enterStale();
    }
  });

  if (navigator.onLine) {
    schedule();
  } else {
    enterStale();
  }
};

for (const root of document.querySelectorAll<HTMLElement>(
  "[data-results-tally][data-live-endpoint]",
)) {
  enhanceResultsTally(root);
}
