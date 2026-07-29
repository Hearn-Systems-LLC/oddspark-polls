/**
 * Progressive enhancement: manual light/dark override.
 * Page renders correctly with JS disabled via prefers-color-scheme.
 * Override persists in localStorage under "oddspark-mode".
 */

const STORAGE_KEY = "oddspark-mode";

type Mode = "light" | "dark";

function isMode(value: string | null): value is Mode {
  return value === "light" || value === "dark";
}

function readStoredMode(): Mode | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return isMode(value) ? value : null;
  } catch {
    return null;
  }
}

function writeStoredMode(mode: Mode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // ignore quota / private mode
  }
}

function applyMode(mode: Mode | null): void {
  if (mode) {
    document.documentElement.setAttribute("data-mode", mode);
  } else {
    document.documentElement.removeAttribute("data-mode");
  }
}

function opposite(mode: Mode): Mode {
  return mode === "dark" ? "light" : "dark";
}

function currentResolvedMode(): Mode {
  const attr = document.documentElement.getAttribute("data-mode");
  if (isMode(attr)) return attr;
  return window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

function init(): void {
  const stored = readStoredMode();
  if (stored) applyMode(stored);

  const buttons = document.querySelectorAll<HTMLElement>("[data-mode-toggle]");
  for (const button of buttons) {
    button.addEventListener("click", () => {
      const next = opposite(currentResolvedMode());
      applyMode(next);
      writeStoredMode(next);
      // Sync every toggle on the page, not just the clicked one.
      for (const b of buttons) syncToggle(b, next);
    });

    syncToggle(button, currentResolvedMode());
  }
}

/** Keep label and aria-pressed truthful for the resolved mode. */
function syncToggle(button: HTMLElement, resolved: Mode): void {
  button.setAttribute("aria-pressed", String(resolved === "dark"));
  button.textContent =
    resolved === "dark" ? "Use light mode" : "Use dark mode";
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
