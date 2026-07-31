// Progressive enhancement only: server rendering keeps VOTE enabled so the
// full submission works without JavaScript; this script supplies UX-DR8's
// disabled-until-selection affordance when JS is available.

import { countdownLabel } from "../modules/polls/deadline-display";

const deadlineTimes = Array.from(
  document.querySelectorAll<HTMLTimeElement>("time[data-deadline]"),
);

const deadlineMsFor = (time: HTMLTimeElement): number | null => {
  const deadlineMs = Number(time.dataset.deadline);
  return Number.isFinite(deadlineMs) ? deadlineMs : null;
};

const formatLocalDateTime = (timestampMs: number, nowMs: number): string => {
  const timestamp = new Date(timestampMs);
  const now = new Date(nowMs);
  const options: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  };
  if (timestamp.getFullYear() !== now.getFullYear()) {
    options.year = "numeric";
  }
  return new Intl.DateTimeFormat(undefined, options).format(timestamp);
};

let deadlineTimer = 0;
const updateDeadlineDisplays = (): void => {
  window.clearTimeout(deadlineTimer);
  const nowMs = Date.now();
  let hasFutureDeadline = false;

  for (const time of deadlineTimes) {
    const deadlineMs = deadlineMsFor(time);
    if (deadlineMs === null) {
      continue;
    }
    try {
      time.textContent = formatLocalDateTime(deadlineMs, nowMs);
    } catch {
      // Keep the server-rendered UTC floor if the browser's Intl layer fails.
    }

    const countdown = time.parentElement?.querySelector<HTMLElement>(
      "[data-deadline-countdown]",
    );
    if (countdown) {
      hasFutureDeadline ||= deadlineMs > nowMs;
      const label = countdownLabel(deadlineMs, nowMs);
      countdown.textContent = label ?? "";
      countdown.hidden = label === null;
    }
  }

  if (hasFutureDeadline) {
    deadlineTimer = window.setTimeout(updateDeadlineDisplays, 60_000);
  }
};

if (deadlineTimes.length > 0) {
  updateDeadlineDisplays();
}

const offlineOutcome = document.querySelector<HTMLElement>(
  "[data-offline-outcome]",
);
const offlineHeading = offlineOutcome?.querySelector<HTMLElement>(
  "[data-offline-outcome-heading]",
);
const offlineBody = offlineOutcome?.querySelector<HTMLElement>(
  "[data-offline-outcome-body]",
);

const showOfflineOutcome = (moveFocus: boolean): void => {
  if (!offlineOutcome || !offlineHeading || !offlineBody) {
    return;
  }
  // A rate-limit-locked form (429) already shows its own outcome with
  // reload guidance; the offline line would stack contradictory copy on it.
  if (form?.dataset.voteLocked === "true") {
    return;
  }
  offlineOutcome.setAttribute("aria-live", moveFocus ? "off" : "polite");
  if (offlineOutcome.hidden) {
    offlineOutcome.hidden = false;
    offlineHeading.textContent = offlineOutcome.dataset.offlineHeadingCopy ?? "";
    const body = offlineOutcome.dataset.offlineBodyCopy ?? "";
    offlineBody.textContent = body ? ` ${body}` : "";
  }
  // Already visible: rewriting textContent would re-announce the line on
  // every connectivity flap; only focus (submit-attempt) still applies.
  if (moveFocus) {
    offlineOutcome.focus();
  }
};

const hideOfflineOutcome = (focusTarget?: HTMLElement): void => {
  if (!offlineOutcome || !offlineHeading || !offlineBody) {
    return;
  }
  const restoreFocus = document.activeElement === offlineOutcome;
  offlineOutcome.hidden = true;
  offlineHeading.textContent = "";
  offlineBody.textContent = "";
  offlineOutcome.setAttribute("aria-live", "polite");
  if (restoreFocus) {
    focusTarget?.focus();
  }
};

const form = document.querySelector<HTMLFormElement>("[data-vote-form]");

if (form) {
  const voteButton = form.querySelector<HTMLButtonElement>(
    'button[type="submit"]',
  );
  const hint = form.querySelector<HTMLElement>("[data-vote-hint]");
  const options = Array.from(
    form.querySelectorAll<HTMLInputElement>('input[name="option_id"]'),
  );
  const locked = form.dataset.voteLocked === "true";
  const idleVoteLabel = voteButton?.textContent?.trim() || "VOTE";
  let inFlightSelection = new Set<string>();

  const syncSelectionState = (): void => {
    if (form.dataset.voteInflight === "true") {
      return;
    }
    const hasSelection = options.some((option) => option.checked);
    if (voteButton) {
      voteButton.disabled = locked || !hasSelection;
    }
    if (hint) {
      hint.hidden = locked || hasSelection;
    }
  };

  // In flight the ballot is frozen: block only selection-changing keys so
  // browser shortcuts (reload, Escape, Home/End) keep working.
  const selectionKeys = new Set([
    " ",
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
  ]);
  for (const option of options) {
    option.addEventListener("change", () => {
      if (form.dataset.voteInflight === "true") {
        for (const current of options) {
          current.checked = inFlightSelection.has(current.value);
        }
        return;
      }
      syncSelectionState();
    });
    option.addEventListener("keydown", (event) => {
      if (
        form.dataset.voteInflight === "true" &&
        selectionKeys.has(event.key)
      ) {
        event.preventDefault();
      }
    });
  }
  syncSelectionState();

  const submissionIdInput = form.querySelector<HTMLInputElement>(
    'input[name="submission_id"]',
  );

  let restoreTimer = 0;
  const restoreIdleState = (): void => {
    window.clearTimeout(restoreTimer);
    delete form.dataset.voteInflight;
    inFlightSelection = new Set();
    if (voteButton) {
      voteButton.textContent = idleVoteLabel;
      voteButton.removeAttribute("aria-busy");
    }
    syncSelectionState();
  };

  const beginInFlight = (): void => {
    inFlightSelection = new Set(
      options.filter((option) => option.checked).map((option) => option.value),
    );
    form.dataset.voteInflight = "true";
    if (voteButton) {
      voteButton.textContent = "COUNTING…";
      voteButton.disabled = true;
      voteButton.setAttribute("aria-busy", "true");
    }
    // Esc/stop mid-POST fires no pageshow. A completed navigation discards
    // this timer with the document; an aborted one restores the usable form.
    // A TIMED restore cannot tell an aborted POST from a slow one — the
    // request may still commit — so the restored form gets a FRESH
    // submission_id: an edited resubmit under the original id would dead-end
    // in IDEMPOTENCY_CONFLICT, while a fresh id turns a committed original
    // into a clean already_voted and an uncommitted one into a normal vote.
    // pageshow/bfcache restore keeps the original id: that path only runs
    // after the response page existed, so exact replay (AD-7) must stay
    // possible with the id the server saw.
    restoreTimer = window.setTimeout(() => {
      restoreIdleState();
      if (submissionIdInput) {
        submissionIdInput.value = crypto.randomUUID();
      }
    }, 10_000);
  };

  // navigator.onLine lies outside Chromium (Firefox reports true unless
  // "Work Offline" is chosen; captive portals and dead uplinks read true
  // everywhere), so connectivity is proven with a real same-origin probe
  // before the POST is allowed to navigate. A tiny static asset keeps the
  // probe free of Worker-side effects; cache: "no-store" defeats caching,
  // and an HTTPS captive portal cannot forge a passing response.
  const probeConnectivity = async (): Promise<boolean> => {
    try {
      const response = await fetch("/favicon.svg", {
        method: "HEAD",
        cache: "no-store",
        signal: AbortSignal.timeout(3_000),
      });
      return response.ok;
    } catch {
      return false;
    }
  };

  form.addEventListener("submit", (event) => {
    if (form.dataset.voteInflight === "true") {
      event.preventDefault();
      return;
    }
    // With JS active the script owns submission: always preventDefault,
    // probe, then form.submit() (native submit skips the submit event, so
    // no recursion). Without JS the browser's native POST is the floor.
    event.preventDefault();
    if (!navigator.onLine) {
      restoreIdleState();
      showOfflineOutcome(true);
      return;
    }
    hideOfflineOutcome(voteButton ?? undefined);
    beginInFlight();
    void probeConnectivity().then((reachable) => {
      // A restore (pageshow, 10s timer) may have run while the probe was
      // pending; only a still-locked form may proceed to the real POST.
      if (form.dataset.voteInflight !== "true") {
        return;
      }
      if (!reachable) {
        // The POST never left — the original submission_id is still unused,
        // so a plain restore (no fresh id) is the safe retry path.
        restoreIdleState();
        showOfflineOutcome(true);
        return;
      }
      form.submit();
    });
  });

  window.addEventListener("pageshow", () => {
    restoreIdleState();
    // A bfcache-frozen page misses offline/online events; reconcile the
    // banner with reality on resume so a stale "No connection" line cannot
    // outlive the outage (and a missed outage still surfaces).
    if (navigator.onLine) {
      hideOfflineOutcome();
    } else {
      showOfflineOutcome(false);
    }
  });
  window.addEventListener("offline", () => {
    // Message only — never touch the in-flight lock here. The POST's fate
    // is unknown; unlocking would invite an edited resubmit under the
    // original submission_id (the IDEMPOTENCY_CONFLICT dead end).
    showOfflineOutcome(false);
  });
  window.addEventListener("online", () =>
    hideOfflineOutcome(voteButton ?? undefined),
  );
}
