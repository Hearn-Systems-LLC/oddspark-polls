import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createShareActionController,
  detectShareCapability,
  enhanceRoot,
  isAbortError,
} from "../../src/scripts/share-action.ts";

const componentSource = readFileSync(
  "src/components/share-action.astro",
  "utf8",
);
const secondaryButtonSource = readFileSync(
  "src/components/button-secondary.astro",
  "utf8",
);
const creatorDetail = readFileSync(
  "src/pages/creator/polls/[pollId].astro",
  "utf8",
);
const votingSurface = readFileSync(
  "src/components/poll-voting-surface.astro",
  "utf8",
);
const resultsPage = readFileSync("src/pages/[reference]/results.astro", "utf8");
const canonicalUrl = "https://polls.example/share-me";

function presentationState(initialConfirmation = true) {
  const state = {
    confirmationVisible: initialConfirmation,
    confirmationText: initialConfirmation ? "LINK COPIED" : "",
    announcements: 0,
    pending: false,
    confirmationTransitions: [],
    pendingTransitions: [],
  };
  return {
    state,
    presentation: {
      setConfirmation(visible) {
        state.confirmationVisible = visible;
        state.confirmationText = visible ? "LINK COPIED" : "";
        if (visible) {
          state.announcements += 1;
        }
        state.confirmationTransitions.push(visible);
      },
      setPending(pending) {
        state.pending = pending;
        state.pendingTransitions.push(pending);
      },
    },
  };
}

describe("share-action component contract (Story 1.13)", () => {
  it("renders the canonical URL as visible selectable text", () => {
    expect(componentSource).toContain("data-share-url-text");
    expect(componentSource).toContain("user-select: all");
    expect(componentSource).toContain("overflow-wrap: anywhere");
    expect(componentSource).toContain("{canonicalUrl}");
  });

  it("keeps the URL, SHARE control, and confirmation in one wrapping row", () => {
    expect(componentSource).toMatch(
      /\.share-action\s*\{[\s\S]*?display:\s*flex;[\s\S]*?flex-wrap:\s*wrap;/,
    );
    expect(componentSource).toMatch(
      /data-share-url-text[\s\S]*?<div class="share-controls">[\s\S]*?SHARE[\s\S]*?LINK COPIED/,
    );
  });

  it("hides the text-labelled SHARE control and LINK COPIED until enhancement", () => {
    expect(componentSource).toContain("SHARE");
    expect(componentSource).toContain('class="share-trigger"');
    expect(componentSource).not.toContain("data-share-trigger");
    expect(componentSource).toContain("LINK COPIED");
    expect(componentSource).toContain('aria-live="polite"');
    expect(componentSource).toContain("data-share-confirmation");
    // Button and confirmation start hidden in server markup.
    expect(componentSource).toMatch(/class="share-trigger"[\s\S]*?hidden=\{true\}/);
    expect(componentSource).toMatch(/data-share-confirmation[\s\S]*?hidden/);
  });

  it("keeps hidden generic while removing the share-specific button API", () => {
    expect(secondaryButtonSource).toContain("hidden?: boolean");
    expect(secondaryButtonSource).toContain(".btn-secondary[hidden]");
    expect(secondaryButtonSource).not.toContain("data-share-trigger");
  });

  it("uses token-only styling and never injects raw HTML", () => {
    expect(componentSource).toContain("var(--type-body-size)");
    expect(componentSource).toContain("var(--color-text)");
    expect(componentSource).toContain("var(--type-label-caps-size)");
    expect(componentSource).toContain("var(--font-machine)");
    expect(componentSource).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
    expect(componentSource).not.toContain("set:html");
    expect(componentSource).toContain("ButtonSecondary");
  });

  it("exposes a single data-share-action root contract", () => {
    expect(componentSource).toContain("data-share-action");
    expect(componentSource).toContain("data-share-url={canonicalUrl}");
  });

  it("keeps data-share-url-text on the .canonical-url element the enhancer binds", () => {
    expect(componentSource).toMatch(
      /<p class="canonical-url" data-share-url-text>/,
    );
  });
});

describe("share-action enhancer decisions (Story 1.13)", () => {
  it("detects share-only, clipboard-only, and neither", () => {
    expect(
      detectShareCapability({
        share: async () => undefined,
        clipboard: undefined,
      }),
    ).toBe("share");
    expect(
      detectShareCapability({
        share: undefined,
        clipboard: { writeText: async () => undefined },
      }),
    ).toBe("clipboard");
    expect(
      detectShareCapability({
        share: undefined,
        clipboard: undefined,
      }),
    ).toBe("none");
  });

  it("prefers Web Share when both APIs exist", () => {
    expect(
      detectShareCapability({
        share: async () => undefined,
        clipboard: { writeText: async () => undefined },
      }),
    ).toBe("share");
  });

  it("treats AbortError as cancellation", () => {
    expect(isAbortError(new DOMException("cancelled", "AbortError"))).toBe(
      true,
    );
    expect(isAbortError(new Error("nope"))).toBe(false);
    expect(isAbortError({ name: "AbortError" })).toBe(true);
  });

  it("falls back to clipboard after a non-Abort share failure", async () => {
    const share = vi.fn().mockRejectedValue(new Error("native share failed"));
    const copy = vi.fn().mockResolvedValue(undefined);
    const { state, presentation } = presentationState();
    const activate = createShareActionController({ share, copy }, presentation);

    await expect(activate(canonicalUrl)).resolves.toBe("copied");
    expect(share).toHaveBeenCalledWith({ url: canonicalUrl });
    expect(copy).toHaveBeenCalledWith(canonicalUrl);
    expect(state.confirmationTransitions).toEqual([false, true]);
    expect(state.pendingTransitions).toEqual([true, false]);
  });

  it("clears confirmation after native success and cancellation", async () => {
    for (const [share, expected] of [
      [vi.fn().mockResolvedValue(undefined), "shared"],
      [
        vi
          .fn()
          .mockRejectedValue(new DOMException("Share canceled", "AbortError")),
        "cancelled",
      ],
    ]) {
      const copy = vi.fn().mockResolvedValue(undefined);
      const { state, presentation } = presentationState();
      const activate = createShareActionController(
        { share, copy },
        presentation,
      );

      await expect(activate(canonicalUrl)).resolves.toBe(expected);
      expect(copy).not.toHaveBeenCalled();
      expect(state.confirmationVisible).toBe(false);
      expect(state.confirmationText).toBe("");
      expect(state.announcements).toBe(0);
      expect(state.confirmationTransitions).toEqual([false]);
      expect(state.pending).toBe(false);
    }
  });

  it(
    "shows confirmation only after clipboard success and keeps failure silent",
    async () => {
      const success = presentationState();
      const successfulCopy = vi.fn().mockResolvedValue(undefined);
      const activateSuccess = createShareActionController(
        { copy: successfulCopy },
        success.presentation,
      );
      await expect(activateSuccess(canonicalUrl)).resolves.toBe("copied");
      expect(successfulCopy).toHaveBeenCalledWith(canonicalUrl);
      expect(success.state.confirmationText).toBe("LINK COPIED");
      expect(success.state.announcements).toBe(1);
      expect(success.state.confirmationTransitions).toEqual([false, true]);

      const failure = presentationState();
      const failedCopy = vi
        .fn()
        .mockRejectedValue(new Error("permission denied"));
      const activateFailure = createShareActionController(
        { copy: failedCopy },
        failure.presentation,
      );
      await expect(activateFailure(canonicalUrl)).resolves.toBe("failed");
      expect(failure.state.confirmationVisible).toBe(false);
      expect(failure.state.confirmationText).toBe("");
      expect(failure.state.announcements).toBe(0);
      expect(failure.state.confirmationTransitions).toEqual([false]);
      expect(failure.state.pending).toBe(false);
    },
  );

  it("clears and re-announces confirmation once for each repeated copy", async () => {
    const copy = vi.fn().mockResolvedValue(undefined);
    const { state, presentation } = presentationState(false);
    const activate = createShareActionController({ copy }, presentation);

    await expect(activate(canonicalUrl)).resolves.toBe("copied");
    await expect(activate(canonicalUrl)).resolves.toBe("copied");

    expect(copy).toHaveBeenCalledTimes(2);
    expect(state.confirmationTransitions).toEqual([false, true, false, true]);
    expect(state.confirmationText).toBe("LINK COPIED");
    expect(state.announcements).toBe(2);
  });

  it("ignores another activation while one is pending", async () => {
    let finishCopy;
    const copy = vi.fn(
      () =>
        new Promise((resolve) => {
          finishCopy = resolve;
        }),
    );
    const { state, presentation } = presentationState();
    const activate = createShareActionController({ copy }, presentation);

    const first = activate(canonicalUrl);
    await expect(activate(canonicalUrl)).resolves.toBe("pending");
    expect(copy).toHaveBeenCalledTimes(1);
    expect(state.confirmationTransitions).toEqual([false]);
    expect(state.confirmationText).toBe("");
    expect(state.announcements).toBe(0);
    expect(state.pending).toBe(true);

    finishCopy();
    await expect(first).resolves.toBe("copied");
    expect(state.confirmationTransitions).toEqual([false, true]);
    expect(state.confirmationText).toBe("LINK COPIED");
    expect(state.announcements).toBe(1);
    expect(state.pendingTransitions).toEqual([true, false]);
  });
});

function enhanceHarness() {
  const listeners = { trigger: [], urlText: [], urlTextPointerDown: [] };
  const trigger = {
    hidden: true,
    disabled: false,
    addEventListener: vi.fn((type, handler) => {
      if (type === "click") {
        listeners.trigger.push(handler);
      }
    }),
  };
  const reveals = { count: 0 };
  const confirmation = {
    textContent: "",
    get hidden() {
      return this._hidden;
    },
    set hidden(value) {
      if (value === false) {
        reveals.count += 1;
      }
      this._hidden = value;
    },
    _hidden: true,
  };
  const urlText = {
    style: {},
    addEventListener: vi.fn((type, handler) => {
      if (type === "click") {
        listeners.urlText.push(handler);
      }
      if (type === "pointerdown") {
        listeners.urlTextPointerDown.push(handler);
      }
    }),
  };
  const root = {
    dataset: { shareUrl: canonicalUrl },
    querySelector(selector) {
      if (selector === ".share-trigger") return trigger;
      if (selector === "[data-share-confirmation]") return confirmation;
      if (selector === "[data-share-url-text]") return urlText;
      return null;
    },
  };
  // Simulates a pointer activation: pointerdown records the pointer, click
  // carries detail/coordinates. Defaults to a stationary mouse click.
  function clickUrlText({
    detail = 1,
    pointerType = "mouse",
    downClientX = 0,
    downClientY = 0,
    clickClientX = 0,
    clickClientY = 0,
  } = {}) {
    for (const handler of listeners.urlTextPointerDown) {
      handler({ pointerType, clientX: downClientX, clientY: downClientY });
    }
    for (const handler of listeners.urlText) {
      handler({ detail, clientX: clickClientX, clientY: clickClientY });
    }
  }
  return { root, trigger, confirmation, urlText, listeners, reveals, clickUrlText };
}

describe("share-action URL text copy binding", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("binds copy-on-click to the URL text when clipboard is the only capability", async () => {
    const copy = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", {
      share: undefined,
      clipboard: { writeText: copy },
    });
    const { root, trigger, confirmation, urlText, clickUrlText } =
      enhanceHarness();

    enhanceRoot(root);

    expect(trigger.hidden).toBe(false);
    expect(urlText.addEventListener).toHaveBeenCalledWith(
      "click",
      expect.any(Function),
    );
    expect(urlText.style.cursor).toBe("copy");

    clickUrlText();
    await vi.waitFor(() => {
      expect(copy).toHaveBeenCalledWith(canonicalUrl);
    });
    await vi.waitFor(() => {
      expect(confirmation.hidden).toBe(false);
    });
    expect(confirmation.textContent).toBe("LINK COPIED");
  });

  it("binds the URL text to copy when both clipboard and Web Share exist, and never opens the share sheet from the text", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const copy = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", {
      share,
      clipboard: { writeText: copy },
    });
    const { root, confirmation, clickUrlText } = enhanceHarness();

    enhanceRoot(root);
    clickUrlText();

    await vi.waitFor(() => {
      expect(copy).toHaveBeenCalledWith(canonicalUrl);
    });
    expect(share).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(confirmation.textContent).toBe("LINK COPIED");
    });
  });

  it("never binds the URL text when only the Web Share API exists", () => {
    vi.stubGlobal("navigator", {
      share: async () => undefined,
      clipboard: undefined,
    });
    const { root, trigger, urlText, listeners } = enhanceHarness();

    enhanceRoot(root);

    expect(trigger.hidden).toBe(false);
    expect(urlText.addEventListener).not.toHaveBeenCalled();
    expect(listeners.urlText).toHaveLength(0);
    expect(urlText.style.cursor).toBeUndefined();
  });

  it("never binds the URL text when no share capability exists", () => {
    vi.stubGlobal("navigator", {
      share: undefined,
      clipboard: undefined,
    });
    const { root, trigger, urlText } = enhanceHarness();

    enhanceRoot(root);

    expect(trigger.hidden).toBe(true);
    expect(urlText.addEventListener).not.toHaveBeenCalled();
    expect(urlText.style.cursor).toBeUndefined();
  });

  it("ignores keyboard-synthesized clicks (detail 0) on the URL text", async () => {
    const copy = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", {
      share: undefined,
      clipboard: { writeText: copy },
    });
    const { root, confirmation, clickUrlText } = enhanceHarness();

    enhanceRoot(root);
    clickUrlText({ detail: 0 });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(copy).not.toHaveBeenCalled();
    expect(confirmation.hidden).toBe(true);
  });

  it("ignores non-mouse pointer activations (touch) on the URL text", async () => {
    const copy = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", {
      share: undefined,
      clipboard: { writeText: copy },
    });
    const { root, confirmation, clickUrlText } = enhanceHarness();

    enhanceRoot(root);
    clickUrlText({ pointerType: "touch" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(copy).not.toHaveBeenCalled();
    expect(confirmation.hidden).toBe(true);
  });

  it("ignores a drag-to-select gesture that moves between pointerdown and click", async () => {
    const copy = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", {
      share: undefined,
      clipboard: { writeText: copy },
    });
    const { root, confirmation, clickUrlText } = enhanceHarness();

    enhanceRoot(root);
    clickUrlText({ clickClientX: 24, clickClientY: 3 });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(copy).not.toHaveBeenCalled();
    expect(confirmation.hidden).toBe(true);
  });

  it("keeps a rejected copy from the URL text silent with no confirmation", async () => {
    const copy = vi.fn().mockRejectedValue(new Error("permission denied"));
    vi.stubGlobal("navigator", {
      share: undefined,
      clipboard: { writeText: copy },
    });
    const { root, trigger, confirmation, clickUrlText } = enhanceHarness();

    enhanceRoot(root);
    clickUrlText();

    await vi.waitFor(() => {
      expect(trigger.disabled).toBe(true);
    });
    await vi.waitFor(() => {
      expect(trigger.disabled).toBe(false);
    });
    expect(copy).toHaveBeenCalledWith(canonicalUrl);
    expect(confirmation.hidden).toBe(true);
    expect(confirmation.textContent).toBe("");
  });

  it("ignores a repeat URL text click while the first copy is pending", async () => {
    let finishCopy;
    const copy = vi.fn(
      () =>
        new Promise((resolve) => {
          finishCopy = resolve;
        }),
    );
    vi.stubGlobal("navigator", {
      share: undefined,
      clipboard: { writeText: copy },
    });
    const { root, confirmation, reveals, clickUrlText } = enhanceHarness();

    enhanceRoot(root);
    clickUrlText();
    await vi.waitFor(() => {
      expect(copy).toHaveBeenCalledTimes(1);
    });
    clickUrlText();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(copy).toHaveBeenCalledTimes(1);

    finishCopy();
    await vi.waitFor(() => {
      expect(confirmation.textContent).toBe("LINK COPIED");
    });
    // One reveal per completed activation — a repeat activation after
    // completion re-reveals by design (fresh live-region announcement).
    expect(reveals.count).toBe(1);
  });
});

describe("share-action page wiring (Story 1.13)", () => {
  it("wires the creator detail link block and script", () => {
    expect(creatorDetail).toContain("ShareAction");
    expect(creatorDetail).toContain("share-action.ts");
    expect(creatorDetail).toContain("canonicalUrl={canonicalUrl}");
    expect(creatorDetail).toContain("POLL LINK");
  });

  it("wires the voting page outside the tally root", () => {
    expect(votingSurface).toContain("share-action.ts");
    const tallyIndex = votingSurface.indexOf("<ResultsTally");
    const renderedShareIndex = votingSurface.indexOf("<ShareAction");
    const surfaceCloseIndex = votingSurface.indexOf("</section>", renderedShareIndex);
    expect(tallyIndex).toBeGreaterThan(-1);
    expect(renderedShareIndex).toBeGreaterThan(tallyIndex);
    expect(surfaceCloseIndex).toBeGreaterThan(renderedShareIndex);
    expect(votingSurface.slice(renderedShareIndex, surfaceCloseIndex)).toContain(
      "canonicalUrl={canonicalUrl}",
    );
  });

  it("wires the results page to share the voting URL", () => {
    expect(resultsPage).toContain("ShareAction");
    expect(resultsPage).toContain("share-action.ts");
    expect(resultsPage).toContain("view.canonicalReference");
    expect(resultsPage).not.toMatch(
      /canonicalUrl=\{`\$\{Astro\.url\.origin\}\/\$\{view\.canonicalReference\}\/results`\}/,
    );
  });
});
