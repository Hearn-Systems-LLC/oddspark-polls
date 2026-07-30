// Progressive enhancement only: server rendering keeps VOTE enabled so the
// full submission works without JavaScript; this script supplies UX-DR8's
// disabled-until-selection affordance when JS is available.

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

  const syncSelectionState = (): void => {
    const hasSelection = options.some((option) => option.checked);
    if (voteButton) {
      voteButton.disabled = locked || !hasSelection;
    }
    if (hint) {
      hint.hidden = locked || hasSelection;
    }
  };

  for (const option of options) {
    option.addEventListener("change", syncSelectionState);
  }
  syncSelectionState();
}
