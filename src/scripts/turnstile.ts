/**
 * Progressive enhancement: load/render Cloudflare Turnstile explicitly for
 * CAPTCHA-enabled vote forms. Server validation remains the integrity boundary.
 *
 * Configuration: appearance interaction-only, action vote, size flexible,
 * theme from the product-resolved mode (manual override wins over OS).
 */

// Client script as a module so it does not collide with other page scripts.
export {};

const SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const SCRIPT_ID = "oddspark-turnstile-api";

type TurnstileTheme = "light" | "dark";

type TurnstileApi = {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      action: string;
      appearance: "interaction-only";
      size: "flexible";
      theme: TurnstileTheme;
      callback?: (token: string) => void;
      "expired-callback"?: () => void;
      "error-callback"?: () => void;
    },
  ) => string;
  remove: (widgetId: string) => void;
  reset: (widgetId?: string) => void;
};

type TurnstileWindow = Window & { turnstile?: TurnstileApi };

function turnstileWindow(): TurnstileWindow {
  return window as TurnstileWindow;
}

function isTurnstileTheme(
  value: string | null | undefined,
): value is TurnstileTheme {
  return value === "light" || value === "dark";
}

function resolvedTurnstileTheme(): TurnstileTheme {
  const attr = document.documentElement.getAttribute("data-mode");
  if (isTurnstileTheme(attr)) return attr;
  return window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

function loadScript(): Promise<void> {
  if (turnstileWindow().turnstile) {
    return Promise.resolve();
  }
  const existing = document.getElementById(SCRIPT_ID);
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("turnstile script failed")),
        { once: true },
      );
    });
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener(
      "error",
      () => reject(new Error("turnstile script failed")),
      { once: true },
    );
    document.head.appendChild(script);
  });
}

type WidgetState = {
  container: HTMLElement;
  form: HTMLFormElement;
  siteKey: string;
  widgetId: string | null;
  theme: TurnstileTheme;
};

const widgets: WidgetState[] = [];

function clearChallengeFields(form: HTMLFormElement): void {
  for (const field of form.querySelectorAll(
    'textarea[name="cf-turnstile-response"], input[name="cf-turnstile-response"]',
  )) {
    if (field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement) {
      field.value = "";
    }
  }
}

function renderWidget(state: WidgetState): void {
  const api = turnstileWindow().turnstile;
  if (!api) return;

  if (state.widgetId !== null) {
    try {
      api.remove(state.widgetId);
    } catch {
      // Widget may already be gone.
    }
    state.widgetId = null;
  }

  // Ensure a clean container — remove prior vendor nodes.
  state.container.replaceChildren();
  clearChallengeFields(state.form);

  const theme = resolvedTurnstileTheme();
  state.theme = theme;

  try {
    state.widgetId = api.render(state.container, {
      sitekey: state.siteKey,
      action: "vote",
      appearance: "interaction-only",
      size: "flexible",
      theme,
      "expired-callback": () => {
        clearChallengeFields(state.form);
        const current = turnstileWindow().turnstile;
        if (state.widgetId !== null && current) {
          try {
            current.reset(state.widgetId);
          } catch {
            // ignore
          }
        }
      },
      "error-callback": () => {
        clearChallengeFields(state.form);
        const current = turnstileWindow().turnstile;
        if (state.widgetId !== null && current) {
          try {
            current.reset(state.widgetId);
          } catch {
            // ignore
          }
        }
      },
    });
  } catch {
    // Page remains readable; server fails closed without a token.
    state.widgetId = null;
  }
}

function resetChallenge(state: WidgetState): void {
  const api = turnstileWindow().turnstile;
  if (state.widgetId !== null && api) {
    try {
      api.reset(state.widgetId);
      clearChallengeFields(state.form);
      return;
    } catch {
      // fall through to re-render
    }
  }
  renderWidget(state);
}

async function enhanceContainer(container: HTMLElement): Promise<void> {
  const form = container.closest<HTMLFormElement>("[data-vote-form]");
  const siteKey = container.dataset.sitekey;
  if (!form || !siteKey) return;

  const state: WidgetState = {
    container,
    form,
    siteKey,
    widgetId: null,
    theme: resolvedTurnstileTheme(),
  };
  widgets.push(state);

  form.addEventListener("oddspark:vote-retry-reset", () => {
    resetChallenge(state);
  });

  try {
    await loadScript();
  } catch {
    return;
  }
  renderWidget(state);
}

function onTurnstileModeChange(event: Event): void {
  const detail = (event as CustomEvent<{ mode?: string }>).detail;
  const mode = isTurnstileTheme(detail?.mode)
    ? detail.mode
    : resolvedTurnstileTheme();
  for (const state of widgets) {
    if (state.theme !== mode) {
      renderWidget(state);
    }
  }
}

function initTurnstileWidgets(): void {
  const containers = document.querySelectorAll<HTMLElement>("[data-turnstile]");
  if (containers.length === 0) return;

  document.addEventListener("oddspark:modechange", onTurnstileModeChange);

  for (const container of containers) {
    void enhanceContainer(container);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initTurnstileWidgets);
} else {
  initTurnstileWidgets();
}
