import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  createShareActionController,
  detectShareCapability,
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
