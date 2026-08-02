import { barAccessibleName, barWidthPercent } from "../components/results-bar";
import { formatVoteTotal } from "../components/live-indicator";
import type { LiveResultsPayload } from "../modules/results/index";
import { RESULTS_CHART_FORM_CHANGE_EVENT } from "./chart-form-contract";
import {
  RESULTS_LIVE_MAX_CONSECUTIVE_RELOADS,
  createResultsLiveState,
  markResultsLiveFailure,
  markResultsLiveSuccess,
  nextResultsPollDelayMs,
  parseResultsValidator,
  shouldAdoptResultsValidator,
  shouldPollResults,
} from "./results-live-core";
import {
  RESULTS_COUNT_UP_DEFAULT_DURATION_MS,
  LINEAR_MOTION_EASE,
  countUpDisplayValue,
  isCountUpComplete,
  parseLeadingInteger,
  parseMotionDurationMs,
  parseMotionEasing,
  resolveCountUpDurationMs,
  retargetCountUp,
  shouldSnapResultsMotion,
  shouldSparkOnCountChange,
  startCountUp,
  type CountUpTween,
  type ResultsRefreshTrigger,
} from "./results-motion-core";
import {
  clearResultsSparks,
  prepareResultsSparks,
} from "./results-spark";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isNonNegativeSafeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const isPercent = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 100;

const isUnitShare = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 1;

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
      isUnitShare(option.pieShare) &&
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

// Reload recovery is bounded per tab: the count survives the reload it
// triggers, so a persistent cause degrades to the stale presentation instead
// of reloading every poll cycle.
const RELOAD_COUNT_STORAGE_KEY = "oddspark.results-live.reload-count";

const readReloadCount = (): number => {
  try {
    const raw = window.sessionStorage.getItem(RELOAD_COUNT_STORAGE_KEY);
    const parsed = raw === null ? 0 : Number(raw);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
  } catch {
    return 0;
  }
};

const writeReloadCount = (count: number): void => {
  try {
    window.sessionStorage.setItem(RELOAD_COUNT_STORAGE_KEY, String(count));
  } catch {
    // Storage can be unavailable (private mode); the cap then holds per load.
  }
};

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
  const totalVisual = root.querySelector<HTMLElement>(
    "[data-live-total-visual]",
  );
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
    !totalVisual ||
    !tied ||
    !empty ||
    !barsContainer
  ) {
    return;
  }

  root.dataset.liveEnhanced = "true";

  // Motion arms lazily, in the same task as the first animated reconcile
  // (Story 1.10): the server-rendered state never animates, and neither
  // does an idle warm load — arming on a post-paint timer would arm a
  // tally that has nothing to move yet and break the executable
  // initial-paint guard for no user's benefit. The first in-cadence update
  // arms and animates in one task (a transition starts from the previously
  // computed value when the gate and the write land together).
  let motionArmed = false;
  const armMotion = (): void => {
    if (motionArmed) {
      return;
    }
    motionArmed = true;
    root.classList.add("is-motion-armed");
  };

  const reducedMotionQuery = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  );
  const countUpDurationMs =
    parseMotionDurationMs(
      getComputedStyle(root).getPropertyValue("--motion-count-up"),
    ) ?? RESULTS_COUNT_UP_DEFAULT_DURATION_MS;
  const countUpEasing =
    parseMotionEasing(
      getComputedStyle(root).getPropertyValue("--motion-ease"),
    ) ?? LINEAR_MOTION_EASE;

  // Last reconciled count per option — the spark's increase detector. The
  // first reconcile seeds from the server-rendered text, so a Vote that
  // landed between paint and the first poll still reads as an increase.
  const previousCounts = new Map<string, number>();

  const initialRenderAtMs = Number(root.dataset.liveInitialRenderAt);
  let state = createResultsLiveState(
    Number.isFinite(initialRenderAtMs) ? initialRenderAtMs : Date.now(),
  );
  let validator: string | null = null;
  let timer: number | null = null;
  let controller: AbortController | null = null;
  let requestGeneration = 0;
  let reloadStarted = false;
  let reloadCount = readReloadCount();
  const resetReloadCount = (): void => {
    if (reloadCount !== 0) {
      reloadCount = 0;
      writeReloadCount(0);
    }
  };
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
    if (reloadStarted) {
      return;
    }
    reloadStarted = true;
    clearTimer();
    abortRefresh();
    if (reloadCount >= RESULTS_LIVE_MAX_CONSECUTIVE_RELOADS) {
      // The cause survived repeated reloads — stop polling and present the
      // last known Tally as stale rather than reloading every poll cycle.
      state = markResultsLiveFailure(state);
      showStale();
      return;
    }
    reloadCount += 1;
    writeReloadCount(reloadCount);
    clearAnnouncements();
    window.location.reload();
  };

  type CountUpSlot = {
    set(target: number, animate: boolean, startedAtMs: number): void;
    snap(): void;
  };

  // One rAF count-up per element (Story 1.10). New data retargets the tween
  // from wherever it currently is — never a restart, never a queue — and the
  // exact final value is written on completion. animate=false (snap contexts,
  // the pre-arm window) or reduced motion lands the value instantly.
  const createCountUpSlot = (
    element: HTMLElement,
    format: (value: number) => string,
  ): CountUpSlot => {
    let displayed: number | null = null;
    let tween: CountUpTween | null = null;
    let frame: number | null = null;
    let reservedCharacters = element.textContent?.length ?? 0;

    const cancel = (): void => {
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
        frame = null;
      }
      tween = null;
    };

    const write = (value: number): void => {
      displayed = value;
      const text = format(value);
      if (element.textContent !== text) {
        element.textContent = text;
      }
    };

    const reserveTargetWidth = (target: number): void => {
      const characters = format(target).length;
      if (characters > reservedCharacters) {
        reservedCharacters = characters;
        element.style.minInlineSize = `${characters}ch`;
      }
    };

    const step = (nowMs: number): void => {
      frame = null;
      if (tween === null) {
        return;
      }
      if (isCountUpComplete(tween, nowMs)) {
        const finalValue = tween.to;
        tween = null;
        write(finalValue);
        return;
      }
      write(countUpDisplayValue(tween, nowMs));
      frame = window.requestAnimationFrame(step);
    };

    return {
      set(target, animate, startedAtMs) {
        if (displayed === null) {
          displayed = parseLeadingInteger(element.textContent) ?? target;
        }
        // Reserve the target column before any tick. Monotonic growth means
        // a 9→10 boundary cannot make the neighbouring label walk per frame.
        reserveTargetWidth(target);
        const durationMs = resolveCountUpDurationMs(
          countUpDurationMs,
          reducedMotionQuery.matches,
        );
        if (!animate || durationMs === 0) {
          cancel();
          if (displayed !== target) {
            write(target);
          }
          return;
        }
        if (tween !== null) {
          if (tween.to === target) {
            return;
          }
          tween = retargetCountUp(
            tween,
            target,
            startedAtMs,
            durationMs,
          );
        } else {
          if (displayed === target) {
            return;
          }
          tween = startCountUp(
            displayed,
            target,
            startedAtMs,
            durationMs,
            countUpEasing,
          );
        }
        if (frame === null) {
          frame = window.requestAnimationFrame(step);
        }
      },
      snap() {
        if (tween === null) {
          return;
        }
        const target = tween.to;
        cancel();
        reserveTargetWidth(target);
        write(target);
      },
    };
  };

  // The one snap mechanism (UX-DR15 — "snap to current on resume"): strip
  // the arming class, apply the final values, flush, re-arm. Every recovery
  // path lands instantly; only ordinary in-cadence reconciles animate.
  const withSnappedMotion = <T>(apply: () => T): T => {
    if (motionArmed) {
      root.classList.remove("is-motion-armed");
    }
    clearResultsSparks(root);
    const result = apply();
    if (motionArmed) {
      void root.offsetWidth;
      root.classList.add("is-motion-armed");
    }
    return result;
  };

  let barSlots: { percent: CountUpSlot; count: CountUpSlot }[] | null = null;
  let totalSlot: CountUpSlot | null = null;

  const snapMotionState = (): void => {
    withSnappedMotion(() => {
      for (const slot of barSlots ?? []) {
        slot.percent.snap();
        slot.count.snap();
      }
      totalSlot?.snap();
    });
  };

  root.addEventListener(RESULTS_CHART_FORM_CHANGE_EVENT, snapMotionState);
  reducedMotionQuery.addEventListener("change", (event) => {
    if (event.matches) {
      snapMotionState();
    }
  });

  const reconcile = (
    payload: LiveResultsPayload,
    animate: boolean,
  ): boolean => {
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
      fill: HTMLElement;
      label: HTMLElement;
      percent: HTMLElement;
      count: HTMLElement;
      leaderMark: HTMLElement;
    }[] = [];
    for (const bar of bars) {
      const track = bar.querySelector<HTMLElement>(".results-bar-track");
      const fill = bar.querySelector<HTMLElement>(".results-bar-fill");
      const label = bar.querySelector<HTMLElement>(".results-bar-label");
      const percent = bar.querySelector<HTMLElement>(".results-bar-pct");
      const count = bar.querySelector<HTMLElement>(".results-bar-count");
      const leaderMark = bar.querySelector<HTMLElement>(
        ".results-bar-leader-mark",
      );
      if (!track || !fill || !label || !percent || !count || !leaderMark) {
        reloadOnce();
        return false;
      }
      barHooks.push({ bar, track, fill, label, percent, count, leaderMark });
    }

    let slots = barSlots;
    let totals = totalSlot;
    if (slots === null || totals === null) {
      slots = barHooks.map((hooks) => ({
        percent: createCountUpSlot(hooks.percent, (value) => `${value}%`),
        count: createCountUpSlot(hooks.count, (value) => ` · ${value}`),
      }));
      totals = createCountUpSlot(totalVisual, formatVoteTotal);
      barSlots = slots;
      totalSlot = totals;
    }

    const shouldAnimate =
      animate && root.dataset.chartFormState !== "pie";
    const startedAtMs = performance.now();
    const plans = payload.options.map((option, index) => {
      const hooks = barHooks[index];
      const slot = slots[index];
      const normalizedPercent = barWidthPercent(option.percent);
      const previousCount =
        previousCounts.get(option.id) ??
        parseLeadingInteger(hooks.count.textContent) ??
        option.count;
      return {
        option,
        hooks,
        slot,
        normalizedPercent,
        spark:
          shouldAnimate &&
          !reducedMotionQuery.matches &&
          shouldSparkOnCountChange(previousCount, option.count),
      };
    });
    const sparkFills = plans.flatMap(({ hooks, spark }) =>
      spark ? [hooks.fill] : []
    );
    const startSparks = prepareResultsSparks(sparkFills);

    for (const { option, hooks, slot, normalizedPercent } of plans) {
      const { bar, track, label, leaderMark } = hooks;
      const width = `${normalizedPercent}%`;
      if (track.style.getPropertyValue("--bar-width") !== width) {
        track.style.setProperty("--bar-width", width);
      }
      if (label.textContent !== option.label) {
        label.textContent = option.label;
      }
      slot.percent.set(normalizedPercent, shouldAnimate, startedAtMs);
      slot.count.set(option.count, shouldAnimate, startedAtMs);
      // The pie view's one coherent source (Story 1.10): display values and
      // exact server-owned geometry land on the bar root in this same batch.
      const percentData = String(normalizedPercent);
      if (bar.dataset.percent !== percentData) {
        bar.dataset.percent = percentData;
      }
      const countData = String(option.count);
      if (bar.dataset.count !== countData) {
        bar.dataset.count = countData;
      }
      const pieShareData = String(option.pieShare);
      if (bar.dataset.pieShare !== pieShareData) {
        bar.dataset.pieShare = pieShareData;
      }
      previousCounts.set(option.id, option.count);
      // The accessible name stays immediate and final-valued — a ticking
      // name would spam AT and break role/name locators.
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
      const zero = option.count === 0;
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
      // The announced copy: final value, exactly once per reconcile. The
      // tick lives on the aria-hidden visual span beside it.
      total.textContent = totalText;
    }
    totals.set(payload.voterCount, shouldAnimate, startedAtMs);

    // All bar widths, leader colors/markers, data attributes, and numeric
    // targets are now staged. One shared flush starts every CSS settle; the
    // changed fills join it together and remove themselves on animationend.
    if (sparkFills.length > 0) {
      void root.offsetWidth;
      startSparks();
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
      void refresh("cadence");
    }, nextResultsPollDelayMs(state));
  };

  const refresh = async (trigger: ResultsRefreshTrigger): Promise<void> => {
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
        if (
          shouldSnapResultsMotion({
            trigger,
            wasStale,
            nextStatus: parsed.status,
          })
        ) {
          // A recovery can truthfully return no body. Snap the latest known
          // targets anyway; otherwise a paused pre-recovery tween resumes.
          snapMotionState();
        }
        validator = incomingValidator;
        state = markResultsLiveSuccess(state, Date.now(), parsed.status);
        if (wasStale) {
          showConnected(parsed.status);
          announce("Updates resumed.");
        }
        schedule();
        return;
      }

      // Lost entitlement (204) and a vanished Poll (404) are terminal for
      // this page, not transient failures — reload into the truthful page
      // state instead of polling forever under a misleading stale notice.
      if (response.status === 204 || response.status === 404) {
        reloadOnce();
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
      // A version regression means the server's world moved backwards (e.g.
      // a D1 Time Travel restore) — reload to snap to its reality rather
      // than ignoring healthy responses and staying stale forever.
      if (!shouldAdoptResultsValidator(validator, incomingValidator)) {
        reloadOnce();
        return;
      }
      if (payload.status === "closed") {
        clearAnnouncements();
      }
      const wasStale = state.connection.kind === "stale";
      const snap =
        root.dataset.chartFormState === "pie" ||
        shouldSnapResultsMotion({
          trigger,
          wasStale,
          nextStatus: payload.status,
        });
      let reconciled: boolean;
      if (snap) {
        reconciled = withSnappedMotion(() => reconcile(payload, false));
      } else {
        armMotion();
        reconciled = reconcile(payload, true);
      }
      if (!reconciled) {
        return;
      }

      validator = incomingValidator;
      state = markResultsLiveSuccess(state, Date.now(), payload.status);
      resetReloadCount();
      if (wasStale || root.dataset.liveStatus !== payload.status) {
        showConnected(payload.status);
      }
      if (wasStale && payload.status !== "closed") {
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
      void refresh("visibility-return");
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
  window.addEventListener("online", () => void refresh("online"));
  window.addEventListener("pageshow", (event) => {
    if (
      !event.persisted ||
      reloadStarted ||
      state.connection.kind === "closed"
    ) {
      return;
    }
    if (navigator.onLine) {
      void refresh("pageshow");
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
