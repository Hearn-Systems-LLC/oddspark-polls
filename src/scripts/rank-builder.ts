import { rankSummary } from "../modules/voting/rank-draft";

for (const builder of document.querySelectorAll<HTMLElement>("[data-rank-builder]")) {
  const rows = Array.from(builder.querySelectorAll<HTMLElement>("[data-rank-row]"));
  const summary = builder.querySelector<HTMLElement>("[data-rank-summary]");
  const form = builder.closest<HTMLFormElement>("form");
  const voteButton = form?.querySelector<HTMLButtonElement>(".vote-button");
  const voteHint = form?.querySelector<HTMLElement>("[data-vote-hint]");
  const total = Number(builder.dataset.optionTotal);

  const rankedRows = (): HTMLElement[] =>
    rows
      .filter((row) => {
        const input = row.querySelector<HTMLInputElement>("[data-rank-position-input]");
        return input !== null && !input.disabled;
      })
      .sort((left, right) => {
        const leftRank = Number(left.querySelector<HTMLInputElement>("[data-rank-position-input]")?.value);
        const rightRank = Number(right.querySelector<HTMLInputElement>("[data-rank-position-input]")?.value);
        return leftRank - rightRank;
      });

  const sync = (): void => {
    const ranked = rankedRows();
    const rankByOption = new Map(
      ranked.map((row, index) => [row.dataset.optionId ?? "", index + 1]),
    );
    for (const row of rows) {
      const rank = rankByOption.get(row.dataset.optionId ?? "");
      const optionInput = row.querySelector<HTMLInputElement>("[data-ranked-option-input]");
      const rankInput = row.querySelector<HTMLInputElement>("[data-rank-position-input]");
      const action = row.querySelector<HTMLButtonElement>("[data-rank-action]");
      const marker = row.querySelector<HTMLElement>("[data-rank-marker]");
      const label = row.querySelector<HTMLElement>("[data-rank-label]")?.textContent?.trim() ?? "Option";
      const unranked = rank === undefined;
      if (optionInput) optionInput.disabled = unranked;
      if (rankInput) {
        rankInput.disabled = unranked;
        rankInput.value = unranked ? "" : String(rank);
      }
      if (marker) {
        marker.textContent = unranked ? "–" : String(rank);
        marker.classList.toggle("is-unranked", unranked);
      }
      if (action) {
        action.setAttribute("aria-pressed", unranked ? "false" : "true");
        action.setAttribute(
          "aria-label",
          unranked
            ? `${label}, unranked, activate to rank next`
            : `${label}, rank ${rank} of ${total}, activate to unrank`,
        );
      }
    }
    if (voteButton) {
      voteButton.disabled =
        form?.dataset.voteLocked === "true" || ranked.length === 0;
    }
    if (voteHint) voteHint.hidden = ranked.length > 0;
    const nextSummary = rankSummary(ranked.length, total);
    if (summary && summary.textContent !== nextSummary) {
      // This one text replacement is the sole polite announcement per action.
      summary.textContent = nextSummary;
    }
  };

  for (const row of rows) {
    const action = row.querySelector<HTMLButtonElement>("[data-rank-action]");
    action?.addEventListener("click", (event) => {
      if (form?.dataset.voteInflight === "true") {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      const rankInput = row.querySelector<HTMLInputElement>("[data-rank-position-input]");
      if (!rankInput) return;
      if (rankInput.disabled) {
        rankInput.disabled = false;
        rankInput.value = String(rankedRows().length + 1);
      } else {
        rankInput.disabled = true;
        rankInput.value = "";
      }
      sync();
    });
  }

  sync();
}
