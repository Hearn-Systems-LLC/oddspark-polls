// Live poller for ranked Results summary (Story 5.3). Round-table + Comment
// list live updates via DOM manipulation; conditional GET against the same
// /results/live endpoint. textContent/createElement only — no raw HTML APIs.

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

type RankedEliminationLive = {
  optionIds: string[];
  labels: string[];
  reason: "fewest_votes" | "safe_batch" | "backward_tie_break";
  backwardTieBreakRound?: number;
};

type RankedRoundLive = {
  roundNumber: number;
  counts: RankedCountRow[];
  exhaustedCount: number;
  activeBallotCount: number;
  eliminated: RankedEliminationLive | null;
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
  rounds: RankedRoundLive[];
  comments: unknown[];
};

function isCountRow(value: unknown): value is RankedCountRow {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.optionId === "string" &&
    typeof row.label === "string" &&
    typeof row.position === "number" &&
    Number.isSafeInteger(row.position) &&
    row.position >= 0 &&
    typeof row.count === "number" &&
    Number.isSafeInteger(row.count) &&
    row.count >= 0
  );
}

function isElimination(value: unknown): value is RankedEliminationLive {
  if (typeof value !== "object" || value === null) return false;
  const elim = value as Record<string, unknown>;
  if (
    !Array.isArray(elim.optionIds) ||
    !elim.optionIds.every((id) => typeof id === "string") ||
    !Array.isArray(elim.labels) ||
    !elim.labels.every((l) => typeof l === "string") ||
    typeof elim.reason !== "string"
  ) {
    return false;
  }
  if (
    elim.reason !== "fewest_votes" &&
    elim.reason !== "safe_batch" &&
    elim.reason !== "backward_tie_break"
  ) {
    return false;
  }
  if (
    elim.backwardTieBreakRound !== undefined &&
    (typeof elim.backwardTieBreakRound !== "number" ||
      !Number.isSafeInteger(elim.backwardTieBreakRound) ||
      elim.backwardTieBreakRound < 1)
  ) {
    return false;
  }
  return true;
}

function isCommentView(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.body === "string" &&
    c.body.length > 0 &&
    (c.displayName === null || typeof c.displayName === "string") &&
    typeof c.createdAtMs === "number" &&
    Number.isSafeInteger(c.createdAtMs) &&
    c.createdAtMs >= 0
  );
}

function isRound(value: unknown): value is RankedRoundLive {
  if (typeof value !== "object" || value === null) return false;
  const round = value as Record<string, unknown>;
  if (
    typeof round.roundNumber !== "number" ||
    !Number.isSafeInteger(round.roundNumber) ||
    round.roundNumber < 1 ||
    !Array.isArray(round.counts) ||
    !round.counts.every(isCountRow) ||
    typeof round.exhaustedCount !== "number" ||
    !Number.isSafeInteger(round.exhaustedCount) ||
    round.exhaustedCount < 0 ||
    typeof round.activeBallotCount !== "number" ||
    !Number.isSafeInteger(round.activeBallotCount) ||
    round.activeBallotCount < 0
  ) {
    return false;
  }
  if (round.eliminated !== null && !isElimination(round.eliminated)) {
    return false;
  }
  return true;
}

function isRankedLivePayload(value: unknown): value is RankedLivePayload {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (
    record.pollType !== "ranked_choice" ||
    (record.status !== "open" && record.status !== "closed") ||
    typeof record.empty !== "boolean" ||
    typeof record.voterCount !== "number" ||
    !Number.isSafeInteger(record.voterCount) ||
    record.voterCount < 0 ||
    typeof record.resolved !== "boolean" ||
    !Array.isArray(record.finalCounts) ||
    !record.finalCounts.every(isCountRow) ||
    !Array.isArray(record.tiedOptionIds) ||
    !record.tiedOptionIds.every((id) => typeof id === "string") ||
    !Array.isArray(record.tiedOptionLabels) ||
    !record.tiedOptionLabels.every((label) => typeof label === "string") ||
    !Array.isArray(record.rounds) ||
    !record.rounds.every(isRound) ||
    !Array.isArray(record.comments) ||
    !record.comments.every(isCommentView)
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

function eliminationStatement(elim: RankedEliminationLive): string {
  const names = elim.labels.map((l) => (l.trim() ? l : "—"));
  switch (elim.reason) {
    case "fewest_votes":
      return `${names.join(", ")} had the fewest votes and was eliminated.`;
    case "safe_batch":
      return `${names.join(", ")} together held fewer votes than any remaining option and were eliminated as a group.`;
    case "backward_tie_break": {
      const round = elim.backwardTieBreakRound ?? "?";
      return `${names.join(", ")} were tied; the tie was broken by their counts in Round ${round}, where they had fewer votes.`;
    }
  }
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

    li.appendChild(label);
    li.appendChild(count);
    if (isWinner) {
      const mark = document.createElement("span");
      mark.className = "ranked-standing-mark";
      mark.textContent = "Winner";
      li.appendChild(mark);
    } else if (isTied) {
      const mark = document.createElement("span");
      mark.className = "ranked-standing-mark";
      mark.textContent = "TIED";
      li.appendChild(mark);
    }
    list.appendChild(li);
  }
}

function isEliminatedBefore(
  rounds: RankedRoundLive[],
  optionId: string,
  roundIndex: number,
): boolean {
  for (let i = 0; i < roundIndex; i++) {
    const elim = rounds[i]?.eliminated;
    if (elim && elim.optionIds.includes(optionId)) {
      return true;
    }
  }
  return false;
}

function countForOption(
  round: RankedRoundLive,
  optionId: string,
): number | null {
  const entry = round.counts.find((c) => c.optionId === optionId);
  return entry ? entry.count : null;
}

function applyRoundTable(
  root: HTMLElement,
  payload: RankedLivePayload,
): void {
  const existingScroll = root.querySelector("[data-round-table-scroll]");
  if (payload.empty || payload.rounds.length === 0) {
    existingScroll?.remove();
    root.querySelectorAll("[data-elimination-round]").forEach((el) => el.remove());
    return;
  }

  const allOptionIds = payload.rounds[0].counts.map((c) => c.optionId);

  let scrollContainer = existingScroll as HTMLDivElement | null;
  if (!scrollContainer) {
    scrollContainer = document.createElement("div");
    scrollContainer.className = "round-table-scroll";
    scrollContainer.dataset.roundTableScroll = "";
    const standing = root.querySelector("[data-ranked-standing]");
    const unresolved = root.querySelector("[data-ranked-unresolved]");
    const anchor = unresolved ?? standing;
    if (anchor?.nextSibling) {
      root.insertBefore(scrollContainer, anchor.nextSibling);
    } else if (anchor) {
      root.appendChild(scrollContainer);
    } else {
      root.appendChild(scrollContainer);
    }
  }

  const table = document.createElement("table");
  table.className = "round-table";
  table.dataset.roundTable = "";

  const caption = document.createElement("caption");
  caption.className = "visually-hidden";
  caption.textContent = "Per-round vote counts";
  table.appendChild(caption);

  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  const optionHeader = document.createElement("th");
  optionHeader.scope = "col";
  optionHeader.className = "round-table-head";
  optionHeader.textContent = "OPTION";
  headerRow.appendChild(optionHeader);
  for (const round of payload.rounds) {
    const th = document.createElement("th");
    th.scope = "col";
    th.className = "round-table-head";
    th.textContent = `ROUND ${round.roundNumber}`;
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const optionId of allOptionIds) {
    const label =
      payload.rounds[0].counts.find((c) => c.optionId === optionId)?.label ??
      "—";
    const isWinnerOption =
      payload.resolved && payload.winnerId === optionId;
    const isTiedOption =
      !payload.resolved && payload.tiedOptionIds.includes(optionId);

    const tr = document.createElement("tr");
    tr.className = "round-table-row";
    if (isTiedOption) tr.classList.add("is-tied-option");
    tr.dataset.optionId = optionId;

    const th = document.createElement("th");
    th.scope = "row";
    th.className = "round-table-option";
    th.textContent = label;
    tr.appendChild(th);

    for (let ri = 0; ri < payload.rounds.length; ri++) {
      const round = payload.rounds[ri];
      const count = countForOption(round, optionId);
      const eliminatedBefore = isEliminatedBefore(
        payload.rounds,
        optionId,
        ri,
      );
      const eliminatedThisRound =
        round.eliminated?.optionIds.includes(optionId) ?? false;
      const isWinnerCell =
        isWinnerOption && ri === payload.rounds.length - 1;
      const faint = eliminatedBefore || eliminatedThisRound;

      const td = document.createElement("td");
      td.className = "round-table-cell";
      if (faint) td.classList.add("is-faint");
      if (isWinnerCell) td.classList.add("is-winner-cell");
      td.textContent = count !== null ? String(count) : "—";
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }

  const hasExhausted = payload.rounds.some((r) => r.exhaustedCount > 0);
  if (hasExhausted) {
    const exRow = document.createElement("tr");
    exRow.className = "round-table-row round-table-exhausted";
    const exTh = document.createElement("th");
    exTh.scope = "row";
    exTh.className = "round-table-option";
    exTh.textContent = "EXHAUSTED";
    exRow.appendChild(exTh);
    for (const round of payload.rounds) {
      const td = document.createElement("td");
      td.className = "round-table-cell";
      td.textContent =
        round.exhaustedCount > 0 ? String(round.exhaustedCount) : "—";
      exRow.appendChild(td);
    }
    tbody.appendChild(exRow);
  }

  table.appendChild(tbody);
  scrollContainer.replaceChildren(table);

  root.querySelectorAll("[data-elimination-round]").forEach((el) => el.remove());
  let lastChild = scrollContainer;
  for (const round of payload.rounds) {
    if (!round.eliminated) continue;
    const p = document.createElement("p");
    p.className = "round-table-elimination";
    p.dataset.eliminationRound = String(round.roundNumber);
    p.textContent = eliminationStatement(round.eliminated);
    if (lastChild.nextSibling) {
      root.insertBefore(p, lastChild.nextSibling);
    } else {
      root.appendChild(p);
    }
    lastChild = p;
  }
}

function applyUnresolvedCopy(
  root: HTMLElement,
  payload: RankedLivePayload,
): void {
  const existing = root.querySelector("[data-ranked-unresolved]");
  if (
    !payload.resolved &&
    payload.tiedOptionLabels.length > 0 &&
    payload.rounds.length > 0
  ) {
    const tiedLabels = payload.tiedOptionLabels.map((l) =>
      l.trim() ? l : "—",
    );
    const text = `Unresolved at Round ${payload.rounds.length}. ${tiedLabels.join(" and ")} are tied, and have been tied in every Round before this one. Rather than eliminate one at random, the count stops here. Standing counts below.`;
    if (existing) {
      existing.textContent = text;
    } else {
      const p = document.createElement("p");
      p.className = "ranked-unresolved-copy";
      p.dataset.rankedUnresolved = "";
      p.textContent = text;
      const standing = root.querySelector("[data-ranked-standing]");
      if (standing?.nextSibling) {
        root.insertBefore(p, standing.nextSibling);
      } else if (standing) {
        root.appendChild(p);
      }
    }
  } else {
    existing?.remove();
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
  applyUnresolvedCopy(root, payload);
  applyRoundTable(root, payload);
  root.dataset.status = payload.status;
  applyComments(root, payload.comments);
}

function applyComments(root: HTMLElement, incomingComments: unknown[]): boolean {
  const list = root.querySelector<HTMLElement>("[data-comment-list]");
  if (!list) {
    // No comment list in the DOM — nothing to reconcile.
    return true;
  }
  const renderedItems = Array.from(
    list.querySelectorAll<HTMLElement>("[data-comment-item]"),
  );
  const renderedSnapshot = renderedItems.map((item) => {
    const body = item.querySelector<HTMLElement>("[data-comment-body]");
    const displayName = item.querySelector<HTMLElement>(
      "[data-comment-display-name]",
    );
    const createdAtMs = Number(item.dataset.commentCreatedAtMs);
    return {
      body: body?.textContent ?? "",
      displayName: displayName?.dataset.commentAnonymous === "true" ? null : (displayName?.textContent ?? null),
      createdAtMs,
    };
  });
  // Compare: comment count, body, displayName, createdAtMs must match.
  if (renderedSnapshot.length !== incomingComments.length) return false;
  return incomingComments.every((incoming, index) => {
    if (typeof incoming !== "object" || incoming === null) return false;
    const c = incoming as Record<string, unknown>;
    const rendered = renderedSnapshot[index];
    return (
      rendered.body === c.body &&
      rendered.displayName === (c.displayName ?? null) &&
      rendered.createdAtMs === c.createdAtMs
    );
  });
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
      // Comment changes trigger a full-page reload to avoid exposing
      // moderation IDs in the public JSON (mirrors MC live behavior).
      const commentsChanged = !applyComments(root, body.comments);
      applyPayload(root, body);
      if (commentsChanged) {
        reloadOnce();
        return;
      }
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
