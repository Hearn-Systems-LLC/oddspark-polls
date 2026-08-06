// Named Cache API adapter for the public Discovery projection (Story 3.2).
// D1 revision keys provide logical global invalidation; Cache API storage is
// only a data-center-local, short-lived optimization.

import {
  parseDiscoveryRequest,
  type DiscoveryCatalogCachePort,
  type DiscoveryCatalogItem,
  type DiscoveryCatalogPage,
  type DiscoveryCatalogRequest,
} from "../../modules/discovery/index";
import { POLL_TYPES } from "../../shared/domain/index";

export const DISCOVERY_CACHE_NAME = "oddspark-discovery-v1";
export const DISCOVERY_CACHE_WARNING_CODE = "discovery_cache_failed";

const CACHE_PROJECTION_VERSION = 1;
const MAX_CACHE_AGE_MS = 30_000;
const CACHE_KEY_ORIGIN = "https://cache.oddspark.invalid";
const CACHE_KEY_PATH = "/__oddspark/discovery/v1/revision";

type DiscoveryCacheEntry = {
  version: typeof CACHE_PROJECTION_VERSION;
  expiresAtMs: number;
  page: DiscoveryCatalogPage;
};

type DiscoveryCacheAdapterDeps = {
  cacheStorage?: Pick<CacheStorage, "open">;
  waitUntil: (promise: Promise<unknown>) => void;
};

function exactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  return Object.keys(value).sort().join(",") === expected.toSorted().join(",");
}

function safeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function validPagingUrl(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== "string" || !value.startsWith("/discover?")) {
    return false;
  }
  try {
    const url = new URL(value, CACHE_KEY_ORIGIN);
    return (
      url.origin === CACHE_KEY_ORIGIN &&
      url.pathname === "/discover" &&
      parseDiscoveryRequest(url.searchParams).ok
    );
  } catch {
    return false;
  }
}

function validCatalogItem(value: unknown): value is DiscoveryCatalogItem {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (
    !exactKeys(item, [
      "canonicalReference",
      "question",
      "pollType",
      "voteCount",
      "deadlineMs",
      "createdAtMs",
      "status",
    ])
  ) {
    return false;
  }
  return (
    typeof item.canonicalReference === "string" &&
    item.canonicalReference.length > 0 &&
    item.canonicalReference.length <= 128 &&
    typeof item.question === "string" &&
    item.question.length > 0 &&
    item.question.length <= 500 &&
    typeof item.pollType === "string" &&
    POLL_TYPES.includes(item.pollType as (typeof POLL_TYPES)[number]) &&
    safeInteger(item.voteCount) &&
    (item.deadlineMs === null || safeInteger(item.deadlineMs)) &&
    safeInteger(item.createdAtMs) &&
    item.status === "open"
  );
}

function validCatalogPage(value: unknown): value is DiscoveryCatalogPage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const page = value as Record<string, unknown>;
  return (
    exactKeys(page, ["items", "newerUrl", "olderUrl"]) &&
    Array.isArray(page.items) &&
    page.items.length <= 20 &&
    page.items.every(validCatalogItem) &&
    validPagingUrl(page.newerUrl) &&
    validPagingUrl(page.olderUrl)
  );
}

function validCacheEntry(
  value: unknown,
  nowMs: number,
): value is DiscoveryCacheEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return (
    exactKeys(entry, ["version", "expiresAtMs", "page"]) &&
    entry.version === CACHE_PROJECTION_VERSION &&
    safeInteger(entry.expiresAtMs) &&
    entry.expiresAtMs > nowMs &&
    validCatalogPage(entry.page)
  );
}

function warningKind(cause: unknown): string {
  return cause instanceof Error ? cause.name : typeof cause;
}

function warn(operation: "read" | "write" | "delete" | "corrupt", cause: unknown): void {
  console.warn(DISCOVERY_CACHE_WARNING_CODE, {
    operation,
    kind: warningKind(cause),
  });
}

export function buildDiscoveryCacheKey(
  revision: number,
  request: DiscoveryCatalogRequest,
): Request {
  const identity =
    request.direction === "initial"
      ? "initial"
      : `${request.direction}/${encodeURIComponent(request.cursor)}`;
  return new Request(
    `${CACHE_KEY_ORIGIN}${CACHE_KEY_PATH}/${revision}/${identity}`,
    { method: "GET" },
  );
}

function expiryFor(page: DiscoveryCatalogPage, nowMs: number): number | null {
  if (!safeInteger(nowMs)) return null;
  let lifetimeMs = MAX_CACHE_AGE_MS;
  for (const item of page.items) {
    if (item.deadlineMs !== null) {
      if (!safeInteger(item.deadlineMs)) return null;
      lifetimeMs = Math.min(lifetimeMs, item.deadlineMs - nowMs);
    }
  }
  if (!Number.isSafeInteger(lifetimeMs) || lifetimeMs <= 0) return null;
  const expiresAtMs = nowMs + lifetimeMs;
  return safeInteger(expiresAtMs) ? expiresAtMs : null;
}

function httpDateFor(expiresAtMs: number): string | null {
  const expires = new Date(expiresAtMs);
  const year = expires.getUTCFullYear();
  if (!Number.isInteger(year) || year < 1_000 || year > 9_999) return null;
  const value = expires.toUTCString();
  return /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/u.test(
    value,
  )
    ? value
    : null;
}

export function createDiscoveryCache(
  deps: DiscoveryCacheAdapterDeps,
): DiscoveryCatalogCachePort {
  const cacheStorage = deps.cacheStorage ?? caches;

  async function deleteEntry(cache: Cache, key: Request): Promise<void> {
    try {
      await cache.delete(key);
    } catch (cause) {
      warn("delete", cause);
    }
  }

  return {
    async get(input): Promise<DiscoveryCatalogPage | null> {
      const key = buildDiscoveryCacheKey(input.revision, input.request);
      let cache: Cache;
      let response: Response | undefined;
      try {
        cache = await cacheStorage.open(DISCOVERY_CACHE_NAME);
        response = await cache.match(key);
      } catch (cause) {
        warn("read", cause);
        return null;
      }
      if (!response) return null;

      let decoded: unknown;
      try {
        decoded = await response.json();
      } catch (cause) {
        warn("corrupt", cause);
        await deleteEntry(cache, key);
        return null;
      }
      if (!validCacheEntry(decoded, input.nowMs)) {
        warn("corrupt", new Error("invalid projection"));
        await deleteEntry(cache, key);
        return null;
      }
      return decoded.page;
    },

    async put(input): Promise<void> {
      const expiresAtMs = expiryFor(input.page, input.nowMs);
      if (expiresAtMs === null) return;
      const maxAgeSeconds = Math.floor((expiresAtMs - input.nowMs) / 1000);
      if (maxAgeSeconds <= 0) return;

      const key = buildDiscoveryCacheKey(input.revision, input.request);
      const entry: DiscoveryCacheEntry = {
        version: CACHE_PROJECTION_VERSION,
        expiresAtMs,
        page: input.page,
      };
      const headers = new Headers({
        "cache-control": `public, max-age=${Math.min(30, maxAgeSeconds)}`,
        "content-type": "application/json; charset=utf-8",
      });
      const expires = httpDateFor(expiresAtMs);
      if (expires !== null) headers.set("expires", expires);
      const response = new Response(JSON.stringify(entry), { headers });

      const population = (async () => {
        const cache = await cacheStorage.open(DISCOVERY_CACHE_NAME);
        await cache.put(key, response);
      })().catch((cause) => warn("write", cause));
      deps.waitUntil(population);
    },
  };
}
