// Direct Results route enhancement: the hidden After Close explanation's
// deadline becomes viewer-local when JavaScript runs (server markup keeps
// the meaningful UTC floor). The Tally's cold-load skeleton enhancement is
// inline in results-tally.astro — no client-side fetching here, ever.

import { enhanceDeadlineTimes } from "./deadline-time";

enhanceDeadlineTimes();

let restorationRefreshStarted = false;

window.addEventListener("pageshow", (event) => {
  if (!event.persisted || restorationRefreshStarted) {
    return;
  }

  const deadlineValue = document.querySelector<HTMLTimeElement>(
    "time[data-deadline]",
  )?.dataset.deadline;
  if (!deadlineValue) {
    return;
  }

  const deadlineMs = Number(deadlineValue);
  if (!Number.isFinite(deadlineMs) || deadlineMs > Date.now()) {
    return;
  }

  // A BFCache restore does not ask the server to reevaluate After Close
  // visibility. Refresh exactly once when the cached deadline is now due;
  // the resulting navigation is a non-persisted pageshow and the visible
  // response no longer includes this hidden-state enhancer.
  restorationRefreshStarted = true;
  window.location.reload();
});
