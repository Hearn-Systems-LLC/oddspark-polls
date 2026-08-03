// Progressive enhancement for confirmation overlays (Story 1.12).
// No-JS floor: invoker is a real link (?confirm=delete); Cancel is a real
// link back; confirm is a POST form. JS intercepts only when ready.

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type OverlayController = {
  open: (invoker: HTMLElement | null) => void;
  close: (options?: { restoreFocus?: boolean; cleanUrl?: boolean }) => void;
  isOpen: () => boolean;
};

let activeController: OverlayController | null = null;

function focusableIn(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute("disabled") && el.getAttribute("aria-hidden") !== "true",
  );
}

function enhanceOverlay(root: HTMLElement): OverlayController {
  const panel = root.querySelector<HTMLElement>("[data-overlay-panel]");
  const scrim = root.querySelector<HTMLElement>("[data-overlay-scrim]");
  let invoker: HTMLElement | null = null;
  let previousOverflow = "";
  let controller: OverlayController;

  function setOpen(open: boolean): void {
    root.hidden = !open;
    if (open) {
      root.removeAttribute("inert");
    } else {
      root.setAttribute("inert", "");
    }
    root.dataset.overlayOpen = open ? "true" : "false";
    root.setAttribute("data-overlay-open", open ? "true" : "false");
  }

  function cleanCloseUrl(): void {
    const href = panel
      ?.querySelector<HTMLElement>("[data-overlay-cancel]")
      ?.getAttribute("href");
    if (href) {
      history.replaceState(null, "", href);
    }
  }

  function open(nextInvoker: HTMLElement | null): void {
    if (!panel) {
      return;
    }
    // Never stack overlays. Close through the previous controller so its
    // scroll snapshot and invoker state cannot be orphaned.
    if (activeController && activeController !== controller) {
      activeController.close({ restoreFocus: false, cleanUrl: false });
    }
    invoker = nextInvoker;
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    setOpen(true);
    activeController = controller;
    invoker?.setAttribute("aria-expanded", "true");
    const focusables = focusableIn(panel);
    const cancel =
      panel.querySelector<HTMLElement>("[data-overlay-cancel]") ??
      focusables[0];
    cancel?.focus();
  }

  function close(
    { restoreFocus = true, cleanUrl = true }: {
      restoreFocus?: boolean;
      cleanUrl?: boolean;
    } = {},
  ): void {
    setOpen(false);
    if (activeController === controller) {
      document.body.style.overflow = previousOverflow;
      activeController = null;
    }
    const returnTo = invoker;
    invoker = null;
    returnTo?.setAttribute("aria-expanded", "false");
    if (cleanUrl) {
      cleanCloseUrl();
    }
    if (restoreFocus) {
      returnTo?.focus();
    }
  }

  function isOpen(): boolean {
    return root.dataset.overlayOpen === "true" && !root.hidden;
  }

  scrim?.addEventListener("click", (event) => {
    if (event.target === scrim) {
      close();
    }
  });

  root.addEventListener("keydown", (event) => {
    if (!isOpen() || !panel) {
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") {
      return;
    }
    const focusables = focusableIn(panel);
    if (focusables.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (event.shiftKey) {
      if (active === first || !panel.contains(active)) {
        event.preventDefault();
        last.focus();
      }
    } else if (active === last) {
      event.preventDefault();
      first.focus();
    }
  });

  // Clicks inside the panel do not dismiss.
  panel?.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  controller = { open, close, isOpen };
  return controller;
}

function enhance(): void {
  const controllers = new Map<string, OverlayController>();

  document.querySelectorAll<HTMLElement>("[data-overlay]").forEach((root) => {
    if (!root.id) {
      return;
    }
    const controller = enhanceOverlay(root);
    controllers.set(root.id, controller);
  });

  document.querySelectorAll<HTMLElement>("[data-overlay-open-for]").forEach(
    (invoker) => {
      const targetId = invoker.getAttribute("data-overlay-open-for");
      if (!targetId) {
        return;
      }
      const controller = controllers.get(targetId);
      if (!controller) {
        return;
      }
      invoker.setAttribute(
        "aria-expanded",
        controller.isOpen() ? "true" : "false",
      );
      invoker.addEventListener("click", (event) => {
        // Intercept only when the enhancer found the dialog.
        event.preventDefault();
        controller.open(invoker);
      });
    },
  );

  // Adopt server-rendered open state only after every invoker/controller pair
  // is known. This gives Esc, scrim, and enhanced Cancel the exact focus
  // return target instead of leaving focus on the document body.
  document.querySelectorAll<HTMLElement>("[data-overlay]").forEach((root) => {
    if (
      !root.id ||
      (root.dataset.overlayOpen !== "true" && root.hidden)
    ) {
      return;
    }
    const invoker = Array.from(
      document.querySelectorAll<HTMLElement>("[data-overlay-open-for]"),
    ).find(
      (candidate) =>
        candidate.getAttribute("data-overlay-open-for") === root.id,
    );
    controllers.get(root.id)?.open(invoker ?? null);
  });

  document.querySelectorAll<HTMLElement>("[data-overlay-cancel]").forEach(
    (cancel) => {
      cancel.addEventListener("click", (event) => {
        const root = cancel.closest<HTMLElement>("[data-overlay]");
        if (!root?.id) {
          return;
        }
        const controller = controllers.get(root.id);
        if (!controller) {
          return;
        }
        // Link Cancel still works without JS; with JS, close without a full
        // navigation and drop any ?confirm= query so a refresh does not reopen.
        if (controller.isOpen() && cancel.tagName === "A") {
          event.preventDefault();
          controller.close();
        }
      });
    },
  );
}

enhance();
