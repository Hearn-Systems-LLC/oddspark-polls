import {
  DISCOVERY_COPY,
  DISCOVERY_PAGE_SIZE,
} from "../modules/discovery/index";

let activeController: AbortController | null = null;
let navigationToken = 0;

function currentRegion(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-discover-catalog-region]");
}

function removeSkeletons(region: HTMLElement): void {
  region.querySelector("[data-discover-skeletons]")?.remove();
}

function appendSkeletons(region: HTMLElement): void {
  removeSkeletons(region);
  const loaded = region.querySelector<HTMLElement>("[data-discover-loaded]");
  const template = region.querySelector<HTMLTemplateElement>(
    "[data-discover-skeleton-template]",
  );
  if (!loaded || !template) return;

  loaded.setAttribute("aria-busy", "true");
  const list = document.createElement("ul");
  list.className = "discover-skeletons";
  list.dataset.discoverSkeletons = "";
  list.setAttribute("aria-hidden", "true");
  for (let index = 0; index < DISCOVERY_PAGE_SIZE; index += 1) {
    list.appendChild(template.content.cloneNode(true));
  }
  loaded.insertAdjacentElement("afterend", list);
}

function clearLoading(region: HTMLElement): void {
  removeSkeletons(region);
  region
    .querySelector<HTMLElement>("[data-discover-loaded]")
    ?.setAttribute("aria-busy", "false");
}

function showFailure(region: HTMLElement, target: URL): void {
  clearLoading(region);
  region.querySelector("[data-discover-error]")?.remove();
  region.querySelector("[data-discover-empty]")?.remove();

  const message = document.createElement("p");
  message.className = "discover-message";
  message.dataset.discoverError = "";
  message.appendChild(document.createTextNode(`${DISCOVERY_COPY.error} `));
  const retry = document.createElement("a");
  retry.href = `${target.pathname}${target.search}`;
  retry.dataset.discoverRetry = "";
  retry.textContent = DISCOVERY_COPY.retry;
  message.appendChild(retry);

  const pagination = region.querySelector("[data-discover-pagination]");
  region.insertBefore(message, pagination);
  const status = region.querySelector<HTMLElement>("[data-discover-status]");
  if (status) status.textContent = DISCOVERY_COPY.error;
}

async function navigate(target: URL, push: boolean): Promise<void> {
  if (target.origin !== window.location.origin) return;
  const region = currentRegion();
  if (!region) return;

  activeController?.abort();
  const controller = new AbortController();
  activeController = controller;
  const token = ++navigationToken;
  appendSkeletons(region);

  try {
    const response = await fetch(`${target.pathname}${target.search}`, {
      headers: { accept: "text/html" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("Discover navigation failed");
    const documentText = await response.text();
    const nextDocument = new DOMParser().parseFromString(documentText, "text/html");
    const nextRegion = nextDocument.querySelector<HTMLElement>(
      "[data-discover-catalog-region]",
    );
    if (!nextRegion) throw new Error("Discover replacement missing");
    if (controller.signal.aborted || token !== navigationToken) return;

    region.replaceWith(nextRegion);
    if (push) {
      history.pushState(null, "", `${target.pathname}${target.search}`);
    }
  } catch (cause) {
    if (controller.signal.aborted || token !== navigationToken) return;
    showFailure(region, target);
  }
}

document.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return;
  const link = event.target.closest<HTMLAnchorElement>(
    "[data-discover-page-link], [data-discover-retry]",
  );
  if (!link || event.defaultPrevented) return;
  const target = new URL(link.href, window.location.href);
  if (target.origin !== window.location.origin) return;
  event.preventDefault();
  void navigate(target, true);
});

window.addEventListener("popstate", () => {
  void navigate(new URL(window.location.href), false);
});
