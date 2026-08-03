/**
 * Progressive enhancement: manual light/dark override.
 * Page renders correctly with JS disabled via prefers-color-scheme.
 * Override persists in localStorage under "oddspark-mode".
 *
 * Owns the single client-side resolved-mode policy for product UI (including
 * Turnstile theme): manual data-mode wins; otherwise OS prefers-color-scheme.
 * Dispatches `oddspark:modechange` only when the resolved value changes.
 */

// Client script as a module so it does not collide with other page scripts.
export {};

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

function publishModeChange(mode: Mode): void {
  document.dispatchEvent(
    new CustomEvent("oddspark:modechange", { detail: { mode } }),
  );
}

function syncAllToggles(resolved: Mode): void {
  const buttons = document.querySelectorAll<HTMLElement>("[data-mode-toggle]");
  for (const button of buttons) {
    syncToggle(button, resolved);
  }
}

function init(): void {
  const stored = readStoredMode();
  if (stored) applyMode(stored);

  let lastPublished = currentResolvedMode();

  const setResolved = (mode: Mode, persist: boolean): void => {
    if (persist) {
      applyMode(mode);
      writeStoredMode(mode);
    }
    const resolved = currentResolvedMode();
    syncAllToggles(resolved);
    if (resolved !== lastPublished) {
      lastPublished = resolved;
      publishModeChange(resolved);
    }
  };

  const buttons = document.querySelectorAll<HTMLElement>("[data-mode-toggle]");
  for (const button of buttons) {
    button.addEventListener("click", () => {
      setResolved(opposite(currentResolvedMode()), true);
    });
    syncToggle(button, currentResolvedMode());
  }

  // OS preference changes apply only when no manual data-mode override exists.
  const media = window.matchMedia("(prefers-color-scheme: light)");
  const onMediaChange = (): void => {
    if (isMode(document.documentElement.getAttribute("data-mode"))) {
      return;
    }
    const resolved = currentResolvedMode();
    syncAllToggles(resolved);
    if (resolved !== lastPublished) {
      lastPublished = resolved;
      publishModeChange(resolved);
    }
  };
  if (typeof media.addEventListener === "function") {
    media.addEventListener("change", onMediaChange);
  } else {
    // Safari < 14
    media.addListener(onMediaChange);
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
