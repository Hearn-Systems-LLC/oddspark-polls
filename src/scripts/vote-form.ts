// Progressive enhancement only: server rendering keeps VOTE enabled so the
// full submission works without JavaScript; this script supplies UX-DR8's
// disabled-until-selection affordance when JS is available.

import { enhanceDeadlineTimes } from "./deadline-time";
import { COMMENT_CAPS } from "../modules/comments/index";

// Local deadline timestamps + sub-24-hour countdowns (shared with the
// direct Results route's hidden After Close explanation).
enhanceDeadlineTimes();

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
  const boundsHint = form.querySelector<HTMLElement>("[data-bounds-hint]");
  const options = Array.from(
    form.querySelectorAll<HTMLInputElement>('input[name="option_id"]'),
  );
  const commentBody = form.querySelector<HTMLTextAreaElement>(
    "[data-comment-body]",
  );
  const commentDisplayName = form.querySelector<HTMLInputElement>(
    "[data-comment-display-name]",
  );
  const commentCounter = form.querySelector<HTMLElement>(
    "[data-comment-counter]",
  );
  const syncCommentCounter = (): void => {
    if (!commentBody || !commentCounter) return;
    const remaining = Math.max(0, COMMENT_CAPS.body - commentBody.value.length);
    commentCounter.textContent = `${remaining} ${remaining === 1 ? "character" : "characters"} left`;
    commentCounter.hidden = remaining > 50;
  };
  commentBody?.addEventListener("input", syncCommentCounter);
  syncCommentCounter();
  const locked = form.dataset.voteLocked === "true";
  const multiSelect = form.dataset.multiSelect === "true";
  const parsedMin = Number(form.dataset.min);
  const parsedMax = Number(form.dataset.max);
  const minSelections =
    Number.isInteger(parsedMin) && parsedMin >= 1 ? parsedMin : 1;
  const maxSelections =
    Number.isInteger(parsedMax) && parsedMax >= minSelections
      ? parsedMax
      : Math.max(minSelections, options.length);
  const idleVoteLabel = voteButton?.textContent?.trim() || "VOTE";
  let inFlightSelection = new Set<string>();
  let boundsAnnouncementRevision = 0;

  const selectedCount = (): number =>
    options.filter((option) => option.checked).length;

  const boundsMessage = (count: number): string => {
    if (count < minSelections) {
      return `Pick at least ${minSelections}.`;
    }
    if (count >= maxSelections) {
      return `Pick up to ${maxSelections}. ${count} chosen.`;
    }
    return "";
  };

  const syncSelectionState = (): void => {
    if (form.dataset.voteInflight === "true") {
      return;
    }
    const count = selectedCount();
    if (multiSelect) {
      if (voteButton) {
        voteButton.disabled =
          locked || count < minSelections || count > maxSelections;
      }
      if (boundsHint) {
        const nextMessage = boundsMessage(count);
        // Only rewrite when the caption changes — reassigning the same
        // "Pick at least {min}." string on every below-min toggle re-chatters
        // the polite live region without new information.
        if (boundsHint.textContent !== nextMessage) {
          boundsAnnouncementRevision += 1;
          boundsHint.textContent = nextMessage;
        }
      }
      if (count >= maxSelections) {
        form.dataset.maxReached = "true";
      } else {
        delete form.dataset.maxReached;
      }
      return;
    }

    const hasSelection = count > 0;
    if (voteButton) {
      voteButton.disabled = locked || !hasSelection;
    }
    if (commentBody) commentBody.readOnly = false;
    if (commentDisplayName) commentDisplayName.readOnly = false;
    if (hint) {
      hint.hidden = locked || hasSelection;
    }
  };

  const reannounceBounds = (): void => {
    if (!boundsHint) {
      return;
    }
    const message = boundsHint.textContent ?? "";
    if (message.length === 0) {
      return;
    }
    const revision = (boundsAnnouncementRevision += 1);
    boundsHint.textContent = "";
    window.requestAnimationFrame(() => {
      if (revision === boundsAnnouncementRevision) {
        boundsHint.textContent = message;
      }
    });
  };

  // In flight the ballot is frozen: block only selection-changing keys so
  // browser shortcuts (reload, Escape, Home/End) keep working.
  const radioSelectionKeys = new Set([
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
      if (multiSelect && option.checked && selectedCount() > maxSelections) {
        option.checked = false;
        syncSelectionState();
        reannounceBounds();
        return;
      }
      syncSelectionState();
    });
    option.addEventListener("keydown", (event) => {
      if (
        form.dataset.voteInflight === "true" &&
        (event.key === " " ||
          (option.type === "radio" && radioSelectionKeys.has(event.key)))
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
    if (commentBody) commentBody.readOnly = false;
    if (commentDisplayName) commentDisplayName.readOnly = false;
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
    if (commentBody) commentBody.readOnly = true;
    if (commentDisplayName) commentDisplayName.readOnly = true;
    // Esc/stop mid-POST fires no pageshow. A completed navigation discards
    // this timer with the document; an aborted one restores the usable form.
    // A TIMED restore cannot tell an aborted POST from a slow one — the
    // request may still commit — so the restored form keeps the ORIGINAL
    // submission_id and the server's idempotency contract adjudicates every
    // retry: an identical resubmit replays to the stored outcome, and an
    // edited resubmit conflicts so the committed original stands. The client
    // never mints submission IDs; only server re-renders do (the
    // pageshow/bfcache restore already keeps the original id).
    restoreTimer = window.setTimeout(() => {
      restoreIdleState();
      // The retained submission ID must couple with a fresh challenge: the
      // prior one-use token may have been consumed by a slow/lost first
      // request.
      form.dispatchEvent(new CustomEvent("oddspark:vote-retry-reset"));
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

  window.addEventListener("pageshow", (event) => {
    restoreIdleState();
    // bfcache restore: keep the original submission_id (exact replay must
    // remain possible) but reset a potentially spent challenge token.
    if (event.persisted) {
      form.dispatchEvent(new CustomEvent("oddspark:vote-retry-reset"));
    }
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
