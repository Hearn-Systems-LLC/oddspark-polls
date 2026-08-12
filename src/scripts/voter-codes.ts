// Progressive enhancement for Voter Code generation and clipboard (Story 8.1).
// Suppresses duplicate generation submission; changes only the submit label
// to exact GENERATING…; no spinner or new motion. Clipboard success produces
// one adjacent aria-live="polite" label that persists until panel close.

function enhanceGenerationForm(): void {
  const form = document.getElementById("voter-code-form") as HTMLFormElement | null;
  if (!form) return;

  form.addEventListener("submit", (event) => {
    if (form instanceof HTMLFormElement && !form.checkValidity()) {
      return;
    }
    if (form.dataset.submitting === "true") {
      event.preventDefault();
      return;
    }
    form.dataset.submitting = "true";
    const submitBtn = form.querySelector<HTMLButtonElement>("#generate-btn");
    if (submitBtn) {
      submitBtn.textContent = "GENERATING\u2026";
      submitBtn.setAttribute("aria-disabled", "true");
      submitBtn.style.pointerEvents = "none";
    }
  });

  window.addEventListener("pageshow", (e) => {
    if (e.persisted) {
      delete form.dataset.submitting;
      const submitBtn = form.querySelector<HTMLButtonElement>("#generate-btn");
      if (submitBtn) {
        submitBtn.textContent = "GENERATE CODES";
        submitBtn.removeAttribute("aria-disabled");
        submitBtn.style.pointerEvents = "";
      }
    }
  });
}

function enhanceCopyButtons(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-copy-text]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const text = btn.getAttribute("data-copy-text") ?? "";
      const feedbackTarget = btn.getAttribute("data-feedback-target");
      const count = btn.getAttribute("data-count") ?? "0";
      const feedbackEl = feedbackTarget ? document.getElementById(feedbackTarget) : null;

      try {
        await navigator.clipboard.writeText(text);
        if (feedbackEl) {
          feedbackEl.textContent = `${count} codes copied.`;
        }
      } catch {
        // Clipboard denied — leave the visible list usable, never claim success.
        if (feedbackEl) {
          feedbackEl.textContent = "";
        }
      }
    });
  });
}

function enhanceFeedbackReset(): void {
  document.querySelectorAll<HTMLElement>("[data-overlay-cancel]").forEach((cancelBtn) => {
    cancelBtn.addEventListener("click", () => {
      const overlay = cancelBtn.closest<HTMLElement>("[data-overlay]");
      if (!overlay) return;
      const feedbackEl = overlay.querySelector("[aria-live='polite']");
      if (feedbackEl) {
        feedbackEl.textContent = "";
      }
    });
  });
}

enhanceGenerationForm();
enhanceCopyButtons();
enhanceFeedbackReset();
