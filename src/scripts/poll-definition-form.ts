// Shared definition-form enhancer for create + edit (Story 1.12 / AD-2).
// Without JavaScript the form still works: ADD OPTION is a server round-trip
// and blank rows count as removed.

import { POLL_CAPS, RENDER_OPTION_CEILING } from "../modules/polls/caps";

export type DefinitionFormOptions = {
  formSelector: string;
  /** Intent value for the primary save/publish submit. */
  primaryIntent: "publish" | "update-definition" | "update-description";
  primarySelector: string;
  pendingLabel: string;
  idleLabel: string;
  /** When true, stamp timezone on the form (create only). */
  stampTimeZone?: boolean;
};

export function enhanceDefinitionForm(options: DefinitionFormOptions): void {
  const form = document.querySelector<HTMLFormElement>(options.formSelector);
  if (!form) {
    return;
  }

  if (options.stampTimeZone) {
    // Deadline: carry the browser's IANA zone so the server interprets the
    // civil datetime in the Creator's local time.
    const timeZoneInput = form.querySelector<HTMLInputElement>(
      'input[name="timezone"]',
    );
    if (timeZoneInput) {
      try {
        const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (timeZone) {
          timeZoneInput.value = timeZone;
        }
      } catch {
        // Leave empty — the server treats an absent zone as UTC.
      }
    }
  }

  const optionList = form.querySelector<HTMLElement>("[data-option-list]");
  const addButton = form.querySelector<HTMLButtonElement>(
    'button[name="intent"][value="add-option"]',
  );
  const multiSelectChoices = Array.from(
    form.querySelectorAll<HTMLInputElement>('input[name="multiSelect"]'),
  );
  const bounds = form.querySelector<HTMLElement>("[data-multi-select-bounds]");
  const minSelections = form.querySelector<HTMLInputElement>(
    'input[name="minSelections"]',
  );
  const maxSelections = form.querySelector<HTMLInputElement>(
    'input[name="maxSelections"]',
  );
  const pollTypeChoices = Array.from(
    form.querySelectorAll<HTMLInputElement>('input[name="pollType"]'),
  );
  const multipleChoiceFields = form.querySelector<HTMLElement>(
    "[data-multiple-choice-fields]",
  );

  function syncPollTypeFields(): void {
    if (!multipleChoiceFields) return;
    const ranked = pollTypeChoices.some(
      (choice) => choice.value === "ranked_choice" && choice.checked,
    );
    multipleChoiceFields.hidden = ranked;
    for (const input of multipleChoiceFields.querySelectorAll<HTMLInputElement>(
      'input[name="multiSelect"], input[name="minSelections"], input[name="maxSelections"]',
    )) {
      input.disabled = ranked;
    }
  }

  function optionRows(): HTMLElement[] {
    return Array.from(
      optionList?.querySelectorAll<HTMLElement>("[data-option-row]") ?? [],
    );
  }

  // The JS path enforces the same rule as the no-JS round-trip: non-blank
  // rows count against the option cap, raw rows against the render ceiling.
  function nonBlankRows(): number {
    return optionRows().filter(
      (row) =>
        (row.querySelector<HTMLInputElement>("input")?.value.trim().length ??
          0) > 0,
    ).length;
  }

  function addOptionDeclined(): boolean {
    return (
      nonBlankRows() >= POLL_CAPS.maxOptions ||
      optionRows().length >= RENDER_OPTION_CEILING
    );
  }

  function syncAddButton(): void {
    if (addButton) {
      addButton.disabled = addOptionDeclined();
    }
  }

  // Mirror the domain's integer floor and option-count ceiling without
  // making browser constraint UI authoritative. The form is `novalidate`, so
  // publish still reaches the server and receives the designed inline 422.
  // Track option count so we clamp bounds only when options shrink — not on
  // every keystroke into min/max (that would hide the server 422 path).
  let lastOptionCountForBounds = Math.max(1, nonBlankRows());
  function syncMultiSelectBounds(): void {
    if (!bounds) {
      return;
    }
    const enabled = multiSelectChoices.some(
      (choice) => choice.value === "true" && choice.checked,
    );
    const hasValues = Boolean(
      minSelections?.value.trim() || maxSelections?.value.trim(),
    );
    const hasServerError = bounds.dataset.hasBoundsError === "true";
    // With no JS this block stays rendered, preserving the server-first
    // floor. With enhancement it collapses for a clean single-select form,
    // but never hides typed values or a returned error.
    const shouldHide = !enabled && !hasValues && !hasServerError;
    if (shouldHide && bounds.contains(document.activeElement)) {
      multiSelectChoices
        .find((choice) => choice.value === "false" && choice.checked)
        ?.focus();
    }
    bounds.hidden = shouldHide;

    const optionCount = Math.max(1, nonBlankRows());
    const optionsShrank = optionCount < lastOptionCountForBounds;
    lastOptionCountForBounds = optionCount;
    for (const input of [minSelections, maxSelections]) {
      if (input) {
        input.min = "1";
        input.max = String(optionCount);
        input.step = "1";
        // Only when options shrink: an oversized typed max would otherwise
        // linger until 422. Typing an oversize max while the count is stable
        // must still reach the server so invalid bounds preserve on 422.
        if (optionsShrank) {
          const raw = input.value.trim();
          if (raw.length > 0) {
            const parsed = Number(raw);
            if (Number.isInteger(parsed) && parsed > optionCount) {
              input.value = String(optionCount);
            }
          }
        }
      }
    }
  }

  function attachRemove(row: HTMLElement): void {
    if (row.querySelector("[data-remove-option]")) {
      return;
    }
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "REMOVE";
    remove.className = "option-remove";
    remove.setAttribute("data-remove-option", "");
    remove.addEventListener("click", () => {
      const removedIndex = optionRows().indexOf(row);
      // Keep at least two rows on screen — the floor a Poll needs.
      if (optionRows().length > 2) {
        row.remove();
        // The focused REMOVE left the DOM with its row — move focus to the
        // adjacent row's input (previous, or the new first row).
        const remaining = optionRows();
        const target =
          remaining[Math.max(0, removedIndex - 1)] ?? remaining[0];
        target?.querySelector<HTMLInputElement>("input")?.focus();
      } else {
        const input = row.querySelector<HTMLInputElement>("input");
        if (input) {
          input.value = "";
          input.focus();
        }
      }
      renumber();
      syncAddButton();
      syncMultiSelectBounds();
    });
    row.appendChild(remove);
  }

  function renumber(): void {
    optionRows().forEach((row, index) => {
      const label = row.querySelector<HTMLLabelElement>("label");
      const input = row.querySelector<HTMLInputElement>("input");
      if (label && input) {
        label.textContent = `OPTION ${index + 1}`;
        const id = `option-${index + 1}`;
        label.htmlFor = id;
        input.id = id;
      }
      // Every remove control names its row.
      row
        .querySelector("[data-remove-option]")
        ?.setAttribute("aria-label", `Remove option ${index + 1}`);
    });
  }

  function addRow(): void {
    const rows = optionRows();
    const last = rows[rows.length - 1];
    if (!last || !optionList || addOptionDeclined()) {
      return;
    }
    const next = last.cloneNode(true) as HTMLElement;
    next.querySelector("[data-remove-option]")?.remove();
    const input = next.querySelector<HTMLInputElement>("input");
    if (input) {
      input.value = "";
      // A row cloned after a failed publish carries the group error's visual
      // state — the new blank row has no error of its own.
      input.classList.remove("is-error");
      input.removeAttribute("aria-invalid");
    }
    optionList.appendChild(next);
    attachRemove(next);
    renumber();
    syncAddButton();
    syncMultiSelectBounds();
    next.querySelector<HTMLInputElement>("input")?.focus();
  }

  if (addButton && optionList) {
    addButton.addEventListener("click", (event) => {
      event.preventDefault();
      addRow();
    });
    optionRows().forEach(attachRemove);
    renumber();
    syncAddButton();
    // Typing changes the non-blank count, which the cap rule reads.
    optionList.addEventListener("input", () => {
      syncAddButton();
      syncMultiSelectBounds();
    });
  }

  multiSelectChoices.forEach((choice) => {
    choice.addEventListener("change", syncMultiSelectBounds);
  });
  pollTypeChoices.forEach((choice) => {
    choice.addEventListener("change", () => {
      syncPollTypeFields();
      syncMultiSelectBounds();
    });
  });
  minSelections?.addEventListener("input", syncMultiSelectBounds);
  maxSelections?.addEventListener("input", syncMultiSelectBounds);
  syncPollTypeFields();
  syncMultiSelectBounds();

  const primary = form.querySelector<HTMLButtonElement>(options.primarySelector);

  const submitButtons = (): HTMLButtonElement[] =>
    Array.from(
      form.querySelectorAll<HTMLButtonElement>('button[type="submit"]'),
    );

  const restoreIdleState = (): void => {
    form
      .querySelectorAll("input[data-stamped-intent]")
      .forEach((stamped) => stamped.remove());
    if (primary) {
      primary.textContent = options.idleLabel;
    }
    submitButtons().forEach((button) => {
      button.disabled = false;
    });
    syncAddButton();
    syncPollTypeFields();
    syncMultiSelectBounds();
  };

  form.addEventListener("submit", (event) => {
    const submitter = (event as SubmitEvent).submitter as
      | HTMLButtonElement
      | null;
    const intentValue =
      submitter?.getAttribute("value") ?? options.primaryIntent;
    // ADD OPTION is handled client-side; never leave it as a double path.
    if (intentValue === "add-option") {
      return;
    }
    const intent = document.createElement("input");
    intent.type = "hidden";
    intent.name = "intent";
    intent.value = intentValue;
    intent.setAttribute("data-stamped-intent", "");
    form.appendChild(intent);
    if (primary && intentValue === options.primaryIntent) {
      primary.textContent = options.pendingLabel;
    }
    submitButtons().forEach((button) => {
      button.disabled = true;
    });
  });

  window.addEventListener("pageshow", (event) => {
    // Only a restored back-forward-cache document needs its pre-navigation
    // controls reset. A fresh pageshow or timer must not re-enable a form
    // while its original POST is still in flight.
    if (event.persisted) {
      restoreIdleState();
    }
  });
}
