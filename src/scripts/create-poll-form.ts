// Isolated vanilla enhancement for /creator/new (AD-2). Without JavaScript
// the form still works end to end: ADD OPTION is a server round-trip,
// blank rows count as removed, and the deadline falls back to UTC.

import { POLL_CAPS, RENDER_OPTION_CEILING } from "../modules/polls/caps";

function enhance(): void {
  const form = document.querySelector<HTMLFormElement>("[data-create-poll-form]");
  if (!form) {
    return;
  }

  // Deadline: carry the browser's IANA zone so the server interprets the
  // civil datetime in the Creator's local time.
  const timeZoneInput = form.querySelector<HTMLInputElement>(
    'input[name="timezone"]',
  );
  if (timeZoneInput) {
    try {
      // A no-ICU browser resolves to undefined — never write the literal
      // string "undefined"; an empty value falls back to UTC server-side.
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (timeZone) {
        timeZoneInput.value = timeZone;
      }
    } catch {
      // Leave empty — the server treats an absent zone as UTC.
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
  minSelections?.addEventListener("input", syncMultiSelectBounds);
  maxSelections?.addEventListener("input", syncMultiSelectBounds);
  syncMultiSelectBounds();

  // In-flight state is a label swap plus disabled submits, never a spinner —
  // a double-click (or repeated Enter) must not double-POST. With JS active
  // every submit is a publish: ADD OPTION's click is preventDefault()ed.
  const publish = form.querySelector<HTMLButtonElement>(
    'button[name="intent"][value="publish"]',
  );

  const submitButtons = (): HTMLButtonElement[] =>
    Array.from(
      form.querySelectorAll<HTMLButtonElement>('button[type="submit"]'),
    );

  // An aborted navigation (offline, bfcache restore, Esc/stop) leaves the
  // in-flight state behind — remove stale intent stamps and idle the form.
  let restoreTimer = 0;
  const restoreIdleState = (): void => {
    window.clearTimeout(restoreTimer);
    form
      .querySelectorAll("input[data-stamped-intent]")
      .forEach((stamped) => stamped.remove());
    if (publish) {
      publish.textContent = "PUBLISH POLL";
    }
    submitButtons().forEach((button) => {
      button.disabled = false;
    });
    syncAddButton();
    syncMultiSelectBounds();
  };

  form.addEventListener("submit", () => {
    // Disabled buttons are excluded from the form's entry list (HTML spec) —
    // including the submitter, whose name/value would otherwise carry the
    // intent. Stamp the intent explicitly first, THEN disable. The stamp is
    // marked so a bfcache restore can remove it (below).
    const intent = document.createElement("input");
    intent.type = "hidden";
    intent.name = "intent";
    intent.value = "publish";
    intent.setAttribute("data-stamped-intent", "");
    form.appendChild(intent);
    if (publish) {
      publish.textContent = "PUBLISHING…";
    }
    submitButtons().forEach((button) => {
      button.disabled = true;
    });
    // Esc/stop mid-POST fires no pageshow — if the page is still here when
    // the navigation window closes, put the form back to idle. A real
    // navigation discards the timer with the page.
    restoreTimer = window.setTimeout(restoreIdleState, 10_000);
  });

  window.addEventListener("pageshow", restoreIdleState);
}

enhance();
