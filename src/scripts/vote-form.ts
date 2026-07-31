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
  offlineOutcome.setAttribute("aria-live", moveFocus ? "off" : "polite");
  offlineOutcome.hidden = false;
  offlineHeading.textContent = offlineOutcome.dataset.offlineHeadingCopy ?? "";
  const body = offlineOutcome.dataset.offlineBodyCopy ?? "";
  offlineBody.textContent = body ? ` ${body}` : "";
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
        event.key !== "Tab" &&
        event.key !== "Shift"
      ) {
        event.preventDefault();
      }
    });
  }
  syncSelectionState();

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

  form.addEventListener("submit", (event) => {
    if (!navigator.onLine) {
      event.preventDefault();
      restoreIdleState();
      showOfflineOutcome(true);
      return;
    }
    if (form.dataset.voteInflight === "true") {
      event.preventDefault();
      return;
    }
    hideOfflineOutcome();
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
    restoreTimer = window.setTimeout(restoreIdleState, 10_000);
  });

  window.addEventListener("pageshow", restoreIdleState);
  window.addEventListener("offline", () => {
    restoreIdleState();
    showOfflineOutcome(false);
  });
  window.addEventListener("online", () =>
    hideOfflineOutcome(voteButton ?? undefined),
  );
}
