// Progressive enhancement for share-action (Story 1.13).
// No-JS floor: the canonical URL is always visible and selectable; SHARE
// stays hidden until this script proves the browser can share or copy.

export type ShareCapability = "share" | "clipboard" | "none";
export type ShareActionResult =
  | "shared"
  | "copied"
  | "cancelled"
  | "failed"
  | "pending";

export type ShareOperations = {
  share?: (data: ShareData) => Promise<void>;
  copy?: (url: string) => Promise<void>;
};

export type SharePresentation = {
  setConfirmation: (visible: boolean) => void;
  setPending: (pending: boolean) => void;
};

type ShareNavigator = Pick<Navigator, "share" | "clipboard">;

function resolveShareOperations(nav: ShareNavigator): ShareOperations {
  const operations: ShareOperations = {};
  try {
    const share = nav.share;
    if (typeof share === "function") {
      operations.share = (data) => share.call(nav, data);
    }
  } catch {
    // A guarded read keeps feature detection and activation console-silent.
  }
  try {
    const clipboard = nav.clipboard;
    const writeText = clipboard?.writeText;
    if (typeof writeText === "function") {
      operations.copy = (url) => writeText.call(clipboard, url);
    }
  } catch {
    // Fall through with no clipboard operation.
  }
  return operations;
}

function capabilityFor(operations: ShareOperations): ShareCapability {
  if (operations.share) {
    return "share";
  }
  if (operations.copy) {
    return "clipboard";
  }
  return "none";
}

export function detectShareCapability(
  nav: ShareNavigator,
): ShareCapability {
  return capabilityFor(resolveShareOperations(nav));
}

export function isAbortError(error: unknown): boolean {
  try {
    return (
      (typeof DOMException !== "undefined" &&
        error instanceof DOMException &&
        error.name === "AbortError") ||
      (typeof error === "object" &&
        error !== null &&
        "name" in error &&
        (error as { name: string }).name === "AbortError")
    );
  } catch {
    return false;
  }
}

export function createShareActionController(
  operations: ShareOperations,
  presentation: SharePresentation,
): (url: string) => Promise<ShareActionResult> {
  let pending = false;

  return async (url: string): Promise<ShareActionResult> => {
    if (pending) {
      return "pending";
    }

    pending = true;
    try {
      // Clear first so every successful repeat copy creates one fresh live-region
      // reveal, while all other outcomes leave stale confirmation hidden.
      presentation.setConfirmation(false);
      presentation.setPending(true);

      if (operations.share) {
        try {
          // URL only — no title/text so targets receive the canonical link.
          await operations.share({ url });
          return "shared";
        } catch (error) {
          if (isAbortError(error)) {
            return "cancelled";
          }
          // Non-abort: fall through to clipboard.
        }
      }

      if (!operations.copy) {
        return "failed";
      }
      try {
        await operations.copy(url);
        presentation.setConfirmation(true);
        return "copied";
      } catch {
        // Permission denied / insecure context — silent; URL remains visible.
        return "failed";
      }
    } finally {
      pending = false;
      presentation.setPending(false);
    }
  };
}

function enhanceRoot(root: HTMLElement): void {
  const url = root.dataset.shareUrl?.trim() ?? "";
  const trigger = root.querySelector<HTMLButtonElement>(".share-trigger");
  const confirmation = root.querySelector<HTMLElement>(
    "[data-share-confirmation]",
  );
  if (!url || !trigger || !confirmation) {
    return;
  }

  const operations = resolveShareOperations(navigator);
  const capability = capabilityFor(operations);
  if (capability === "none") {
    return;
  }

  trigger.hidden = false;
  const activate = createShareActionController(operations, {
    setConfirmation(visible) {
      if (!visible) {
        confirmation.textContent = "";
        confirmation.hidden = true;
        return;
      }
      // Reveal the empty live region first, then add its one announcement.
      confirmation.hidden = false;
      confirmation.textContent = "LINK COPIED";
    },
    setPending(pending) {
      trigger.disabled = pending;
    },
  });

  trigger.addEventListener("click", () => {
    void activate(url);
  });
}

function enhance(): void {
  if (typeof document === "undefined") {
    return;
  }
  document
    .querySelectorAll<HTMLElement>("[data-share-action]")
    .forEach(enhanceRoot);
}

enhance();
