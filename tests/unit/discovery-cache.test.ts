import { describe, expect, it, vi } from "vitest";
import {
  DISCOVERY_CACHE_NAME,
  DISCOVERY_CACHE_WARNING_CODE,
  buildDiscoveryCacheKey,
  createDiscoveryCache,
} from "../../src/adapters/cache/discovery";
import type {
  DiscoveryCatalogPage,
  DiscoveryCatalogRequest,
} from "../../src/modules/discovery/index";
import type { PollId } from "../../src/shared/domain/index";

const NOW = 1_800_000_000_000;
const ID = "00000000-0000-4000-8000-000000000001" as PollId;

const initial: DiscoveryCatalogRequest = { direction: "initial" };
const page: DiscoveryCatalogPage = {
  items: [
    {
      canonicalReference: "public-ref",
      question: "Question <plain>?",
      pollType: "multiple_choice",
      voteCount: 3,
      deadlineMs: NOW + 20_000,
      createdAtMs: NOW - 1,
      status: "open",
    },
  ],
  newerUrl: null,
  olderUrl: "/discover?older=eyJ2IjoxLCJkIjoib2xkZXIiLCJ0IjoxODAwMDAwMDAwMDAwLCJpIjoiMDAwMDAwMDAtMDAwMC00MDAwLTgwMDAtMDAwMDAwMDAwMDAxIn0",
};

class MemoryCache {
  readonly values = new Map<string, Response>();
  readonly matches: Request[] = [];
  readonly puts: { request: Request; response: Response }[] = [];
  readonly deletes: Request[] = [];

  async match(request: Request): Promise<Response | undefined> {
    this.matches.push(request);
    return this.values.get(request.url)?.clone();
  }

  async put(request: Request, response: Response): Promise<void> {
    this.puts.push({ request, response: response.clone() });
    this.values.set(request.url, response.clone());
  }

  async delete(request: Request): Promise<boolean> {
    this.deletes.push(request);
    return this.values.delete(request.url);
  }
}

function harness(cache = new MemoryCache()) {
  const names: string[] = [];
  const scheduled: Promise<unknown>[] = [];
  const adapter = createDiscoveryCache({
    cacheStorage: {
      open: async (name: string) => {
        names.push(name);
        return cache as unknown as Cache;
      },
    },
    waitUntil: (promise) => scheduled.push(promise),
  });
  return { adapter, cache, names, scheduled };
}

describe("Discovery named Cache API adapter", () => {
  it("builds one headerless synthetic GET key from revision and validated identity", () => {
    const key = buildDiscoveryCacheKey(7, initial);
    expect(key.method).toBe("GET");
    expect([...key.headers]).toEqual([]);
    expect(key.url).toBe(
      "https://cache.oddspark.invalid/__oddspark/discovery/v1/revision/7/initial",
    );

    const cursorRequest: DiscoveryCatalogRequest = {
      direction: "older",
      cursor: "opaque-cursor",
      boundary: { id: ID, createdAtMs: NOW },
    };
    expect(buildDiscoveryCacheKey(8, cursorRequest).url).toBe(
      "https://cache.oddspark.invalid/__oddspark/discovery/v1/revision/8/older/opaque-cursor",
    );
  });

  it("opens only the discovery namespace and schedules population with waitUntil", async () => {
    const { adapter, cache, names, scheduled } = harness();

    await adapter.put({ revision: 7, request: initial, page, nowMs: NOW });
    expect(scheduled).toHaveLength(1);
    await scheduled[0];

    expect(names).toEqual([DISCOVERY_CACHE_NAME]);
    expect(cache.puts).toHaveLength(1);
    expect(cache.puts[0]?.request.method).toBe("GET");
    expect([...cache.puts[0]!.request.headers]).toEqual([]);
    expect(cache.puts[0]?.response.headers.get("cache-control")).toBe(
      "public, max-age=20",
    );
    expect(cache.puts[0]?.response.headers.has("set-cookie")).toBe(false);
    expect(await adapter.get({ revision: 7, request: initial, nowMs: NOW })).toEqual(
      page,
    );
  });

  it("isolates generations even when an older fill completes later", async () => {
    const { adapter, scheduled } = harness();
    await adapter.put({ revision: 1, request: initial, page, nowMs: NOW });
    await scheduled[0];

    expect(await adapter.get({ revision: 2, request: initial, nowMs: NOW })).toBeNull();
    expect(await adapter.get({ revision: 1, request: initial, nowMs: NOW })).toEqual(
      page,
    );
  });

  it("caps expiry at 30 seconds and at the earliest page Deadline", async () => {
    const noDeadlinePage: DiscoveryCatalogPage = {
      ...page,
      items: page.items.map((item) => ({ ...item, deadlineMs: null })),
    };
    const first = harness();
    await first.adapter.put({
      revision: 1,
      request: initial,
      page: noDeadlinePage,
      nowMs: NOW,
    });
    await first.scheduled[0];
    expect(first.cache.puts[0]?.response.headers.get("cache-control")).toBe(
      "public, max-age=30",
    );

    const deadline = harness();
    await deadline.adapter.put({
      revision: 1,
      request: initial,
      page,
      nowMs: NOW,
    });
    await deadline.scheduled[0];
    const body = (await deadline.cache.puts[0]?.response.json()) as {
      expiresAtMs: number;
    };
    expect(body.expiresAtMs).toBe(NOW + 20_000);
  });

  it("skips storage when no positive whole-second lifetime remains", async () => {
    const { adapter, scheduled } = harness();
    await adapter.put({
      revision: 1,
      request: initial,
      page: {
        ...page,
        items: page.items.map((item) => ({ ...item, deadlineMs: NOW + 999 })),
      },
      nowMs: NOW,
    });
    expect(scheduled).toHaveLength(0);
  });

  it("skips population when expiry arithmetic cannot produce a safe timestamp", async () => {
    const { adapter, scheduled } = harness();
    await adapter.put({
      revision: 1,
      request: initial,
      page: {
        ...page,
        items: page.items.map((item) => ({ ...item, deadlineMs: null })),
      },
      nowMs: Number.MAX_SAFE_INTEGER - 10_000,
    });
    expect(scheduled).toHaveLength(0);
  });

  it("omits Expires when the representable lifetime has a five-digit year", async () => {
    const deadlineMs = Date.UTC(10_000, 0, 1);
    const nowMs = deadlineMs - 10_000;
    const { adapter, cache, scheduled } = harness();
    await adapter.put({
      revision: 1,
      request: initial,
      page: {
        ...page,
        items: page.items.map((item) => ({ ...item, deadlineMs })),
      },
      nowMs,
    });
    expect(scheduled).toHaveLength(1);
    await scheduled[0];
    expect(cache.puts[0]?.response.headers.get("cache-control")).toBe(
      "public, max-age=10",
    );
    expect(cache.puts[0]?.response.headers.has("expires")).toBe(false);
  });

  it("retains a valid four-digit-year Expires header", async () => {
    const nowMs = Date.UTC(9_999, 0, 1);
    const { adapter, cache, scheduled } = harness();
    await adapter.put({
      revision: 1,
      request: initial,
      page: {
        ...page,
        items: page.items.map((item) => ({ ...item, deadlineMs: null })),
      },
      nowMs,
    });
    await scheduled[0];
    expect(cache.puts[0]?.response.headers.get("expires")).toMatch(
      / \d{4} \d{2}:\d{2}:\d{2} GMT$/u,
    );
  });

  it.each([
    ["corrupt JSON", "not-json"],
    ["wrong version", JSON.stringify({ version: 2, expiresAtMs: NOW + 1, page })],
    [
      "private extra field",
      JSON.stringify({
        version: 1,
        expiresAtMs: NOW + 1,
        page: { ...page, ownerUserId: "private" },
      }),
    ],
  ])("deletes %s and falls through to D1", async (_case, body) => {
    const { adapter, cache } = harness();
    const key = buildDiscoveryCacheKey(1, initial);
    cache.values.set(key.url, new Response(body));

    expect(await adapter.get({ revision: 1, request: initial, nowMs: NOW })).toBeNull();
    expect(cache.deletes).toHaveLength(1);
  });

  it("deletes an entry when its absolute Deadline has crossed", async () => {
    const { adapter, cache } = harness();
    const key = buildDiscoveryCacheKey(1, initial);
    cache.values.set(
      key.url,
      new Response(
        JSON.stringify({ version: 1, expiresAtMs: NOW, page }),
      ),
    );
    expect(await adapter.get({ revision: 1, request: initial, nowMs: NOW })).toBeNull();
    expect(cache.deletes).toHaveLength(1);
  });

  it("fails open with one privacy-safe operational warning", async () => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const adapter = createDiscoveryCache({
      cacheStorage: {
        open: async () => Promise.reject(new Error("secret cursor question")),
      },
      waitUntil: () => undefined,
    });

    expect(await adapter.get({ revision: 1, request: initial, nowMs: NOW })).toBeNull();
    expect(log).toHaveBeenCalledWith(DISCOVERY_CACHE_WARNING_CODE, {
      operation: "read",
      kind: "Error",
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret cursor question");
    log.mockRestore();
  });
});
