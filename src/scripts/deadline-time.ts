// Local-deadline progressive enhancement, extracted from vote-form.ts so the
// voting page and the direct Results route share one implementation: server
// markup renders a meaningful UTC timestamp, and when JavaScript runs every
// `time[data-deadline]` becomes viewer-local (with the sub-24-hour countdown
// where a `[data-deadline-countdown]` sibling exists).

import { countdownLabel } from "../modules/polls/deadline-display";

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

export function enhanceDeadlineTimes(): void {
  const deadlineTimes = Array.from(
    document.querySelectorAll<HTMLTimeElement>("time[data-deadline]"),
  );
  if (deadlineTimes.length === 0) {
    return;
  }

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

  updateDeadlineDisplays();
}
