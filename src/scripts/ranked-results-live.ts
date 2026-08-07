// Minimal live poller for ranked Results summary (Story 5.2). Full round-table
// enhancement and Comment list live with Story 5.3. Conditional GET against
// the same /results/live endpoint; MC bar/pie enhancer is not used.

import {
  RESULTS_POLL_CADENCE_MS,
  RESULTS_POLL_MAX_BACKOFF_MS,
} from "./results-live-core";

type RankedLivePayload = {
  pollType: "ranked_choice";
  status: "open" | "closed";
  empty: boolean;
  voterCount: number;
  resolved: boolean;
  winnerId: string | null;
  winnerLabel: string | null;
  tiedOptionIds: string[];
  tiedOptionLabels: string[];
  finalCounts: {
    optionId: string;
    label: string;
    position: number;
    count: number;
  }[];
  rounds: unknown[];
  comments: unknown[];
};

function isRankedLivePayload(value: unknown): value is RankedLivePayload {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.pollType === "ranked_choice" &&
    (record.status === "open" || record.status === "closed") &&
    typeof record.empty === "boolean" &&
    typeof record.voterCount === "number" &&
    typeof record.resolved === "boolean" &&
    Array.isArray(record.finalCounts) &&
    Array.isArray(record.tiedOptionLabels) &&
    Array.isArray(record.rounds)
  );
}

function outcomeText(payload: RankedLivePayload): string {
  if (payload.empty) {
    return "No Votes yet. Yours would be the first, which is a kind of power.";
  }
  if (payload.resolved) {
    return `Winner: ${payload.winnerLabel ?? "—"}`;
  }
  if (payload.tiedOptionLabels.length > 0) {
    return `Unresolved tie: ${payload.tiedOptionLabels.join(", ")}`;
  }
  return "Unresolved";
}

function applyPayload(root: HTMLElement, payload: RankedLivePayload): void {
  const outcome = root.querySelector("[data-ranked-outcome]");
  if (outcome) {
    outcome.textContent = outcomeText(payload);
  }
  const meta = root.querySelector("[data-ranked-meta]");
  if (meta) {
    const ballots =
      payload.voterCount === 1 ? "1 BALLOT" : `${payload.voterCount} BALLOTS`;
    const rounds =
      payload.rounds.length > 0
        ? ` · ${payload.rounds.length} ROUND${payload.rounds.length === 1 ? "" : "S"}`
        : "";
    meta.textContent = `${ballots}${rounds}`;
  }
  root.dataset.status = payload.status;
}

function init(): void {
  const root = document.querySelector<HTMLElement>("[data-ranked-results]");
  if (!root) return;
  const endpoint = root.dataset.liveEndpoint;
  if (!endpoint) return;

  let validator = root.dataset.initialValidator ?? null;
  let consecutiveFailures = 0;
  let stopped = false;

  const schedule = (delayMs: number) => {
    window.setTimeout(() => {
      void poll();
    }, delayMs);
  };

  const poll = async () => {
    if (stopped) return;
    try {
      const headers: Record<string, string> = {
        accept: "application/json",
      };
      if (validator) {
        headers["if-none-match"] = validator;
      }
      const response = await fetch(endpoint, {
        method: "GET",
        headers,
        credentials: "same-origin",
        cache: "no-store",
      });
      if (response.status === 204) {
        stopped = true;
        return;
      }
      if (response.status === 304) {
        consecutiveFailures = 0;
        schedule(RESULTS_POLL_CADENCE_MS);
        return;
      }
      if (!response.ok) {
        throw new Error(`ranked live ${response.status}`);
      }
      const etag = response.headers.get("etag");
      if (etag) {
        validator = etag;
      }
      const body: unknown = await response.json();
      if (!isRankedLivePayload(body)) {
        throw new Error("ranked live payload shape");
      }
      applyPayload(root, body);
      if (body.status === "closed") {
        stopped = true;
        return;
      }
      consecutiveFailures = 0;
      schedule(RESULTS_POLL_CADENCE_MS);
    } catch {
      consecutiveFailures += 1;
      const backoff = Math.min(
        RESULTS_POLL_CADENCE_MS * 2 ** consecutiveFailures,
        RESULTS_POLL_MAX_BACKOFF_MS,
      );
      schedule(backoff);
    }
  };

  schedule(RESULTS_POLL_CADENCE_MS);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
