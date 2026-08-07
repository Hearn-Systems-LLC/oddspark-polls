// Minimal live poller for ranked Results summary (Story 5.2). Full round-table
// enhancement and Comment list live with Story 5.3. Conditional GET against
// the same /results/live endpoint; MC bar/pie enhancer is not used.

import {
  RESULTS_POLL_CADENCE_MS,
  RESULTS_POLL_MAX_BACKOFF_MS,
} from "./results-live-core";

/** Keep in sync with RESULTS_COPY.empty (results module) — scripts stay browser-safe. */
const RANKED_EMPTY_COPY =
  "No Votes yet. Yours would be the first, which is a kind of power.";

type RankedCountRow = {
  optionId: string;
  label: string;
  position: number;
  count: number;
};

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
  finalCounts: RankedCountRow[];
  rounds: unknown[];
  comments: unknown[];
};

function isCountRow(value: unknown): value is RankedCountRow {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.optionId === "string" &&
    typeof row.label === "string" &&
    typeof row.position === "number" &&
    Number.isFinite(row.position) &&
    typeof row.count === "number" &&
    Number.isFinite(row.count) &&
    row.count >= 0
  );
}

function isRankedLivePayload(value: unknown): value is RankedLivePayload {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (
    record.pollType !== "ranked_choice" ||
    (record.status !== "open" && record.status !== "closed") ||
    typeof record.empty !== "boolean" ||
    typeof record.voterCount !== "number" ||
    !Number.isFinite(record.voterCount) ||
    record.voterCount < 0 ||
    typeof record.resolved !== "boolean" ||
    !Array.isArray(record.finalCounts) ||
    !record.finalCounts.every(isCountRow) ||
    !Array.isArray(record.tiedOptionIds) ||
    !record.tiedOptionIds.every((id) => typeof id === "string") ||
    !Array.isArray(record.tiedOptionLabels) ||
    !record.tiedOptionLabels.every((label) => typeof label === "string") ||
    !Array.isArray(record.rounds)
  ) {
    return false;
  }
  if (record.winnerId !== null && typeof record.winnerId !== "string") {
    return false;
  }
  if (record.winnerLabel !== null && typeof record.winnerLabel !== "string") {
    return false;
  }
  return true;
}

function outcomeText(payload: RankedLivePayload): string {
  if (payload.empty) {
    return RANKED_EMPTY_COPY;
  }
  if (payload.resolved) {
    const label = payload.winnerLabel?.trim() ? payload.winnerLabel : "—";
    return `Winner: ${label}`;
  }
  if (payload.tiedOptionLabels.length > 0) {
    const labels = payload.tiedOptionLabels
      .map((label) => (label.trim() ? label : "—"))
      .join(", ");
    return `Unresolved tie: ${labels}`;
  }
  return "Unresolved";
}

function ensureStandingList(root: HTMLElement): HTMLOListElement {
  let list = root.querySelector<HTMLOListElement>("[data-ranked-standing]");
  if (list) return list;
  list = document.createElement("ol");
  list.className = "ranked-standing";
  list.dataset.rankedStanding = "";
  const meta = root.querySelector("[data-ranked-meta]");
  const note = root.querySelector(".ranked-note");
  if (meta?.nextSibling) {
    root.insertBefore(list, meta.nextSibling);
  } else if (note) {
    root.insertBefore(list, note);
  } else {
    root.appendChild(list);
  }
  return list;
}

function applyStanding(root: HTMLElement, payload: RankedLivePayload): void {
  if (payload.empty || payload.finalCounts.length === 0) {
    root.querySelector("[data-ranked-standing]")?.remove();
    return;
  }
  const list = ensureStandingList(root);
  list.replaceChildren();
  for (const option of payload.finalCounts) {
    const isWinner =
      payload.resolved && payload.winnerId === option.optionId;
    const isTied =
      !payload.resolved && payload.tiedOptionIds.includes(option.optionId);
    const li = document.createElement("li");
    li.className = "ranked-standing-row";
    if (isWinner) li.classList.add("is-winner");
    if (isTied) li.classList.add("is-tied");
    li.dataset.optionId = option.optionId;

    const label = document.createElement("span");
    label.className = "ranked-standing-label";
    label.textContent = option.label;

    const count = document.createElement("span");
    count.className = "ranked-standing-count";
    count.textContent = String(option.count);

    li.append(label, count);
    if (isWinner) {
      const mark = document.createElement("span");
      mark.className = "ranked-standing-mark";
      mark.textContent = "Winner";
      li.append(mark);
    } else if (isTied) {
      const mark = document.createElement("span");
      mark.className = "ranked-standing-mark";
      mark.textContent = "TIED";
      li.append(mark);
    }
    list.append(li);
  }
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
  applyStanding(root, payload);
  root.dataset.status = payload.status;
}

function init(): void {
  const root = document.querySelector<HTMLElement>("[data-ranked-results]");
  if (!root) return;
  if (root.dataset.liveEnhanced === "1") return;
  root.dataset.liveEnhanced = "1";

  const endpoint = root.dataset.liveEndpoint;
  if (!endpoint) return;

  let validator = root.dataset.initialValidator ?? null;
  let consecutiveFailures = 0;
  let stopped = false;

  const reloadOnce = (): void => {
    if (stopped) return;
    stopped = true;
    window.location.reload();
  };

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
      // Match MC live: lost entitlement / vanished Poll → full page reload.
      if (response.status === 204 || response.status === 404) {
        reloadOnce();
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
