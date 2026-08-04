import { describe, expect, it, vi } from "vitest";
import {
  DISCOVERY_PAGE_SIZE,
  DISCOVERY_COPY,
  LISTING_CHOICES,
  encodeDiscoveryCursor,
  parseListingDraft,
  parseDiscoveryRequest,
  queryDiscoveryCatalog,
  setPollListing,
} from "../../src/modules/discovery/index";
import type {
  DiscoveryCatalogCachePort,
  DiscoveryCatalogPersistencePort,
  DiscoveryCatalogRecord,
  DiscoveryCatalogRequest,
} from "../../src/modules/discovery/index";
import type { PollId, UserId } from "../../src/shared/domain/index";

const POLL_ID = "poll-1" as PollId;
const OWNER = "owner-1" as UserId;
const NOW = 1_800_000_000_000;

describe("parseListingDraft", () => {
  it.each([
    ["unlisted", "unlisted"],
    ["listed", "listed"],
  ] as const)("accepts the creator-settable %s state", (value, expected) => {
    expect(parseListingDraft(value)).toBe(expected);
  });

  it.each(["delisted", "junk", ""])(
    "rejects the non-settable %s value",
    (value) => {
      expect(parseListingDraft(value)).toBeNull();
    },
  );
});

describe("setPollListing", () => {
  it("returns an idempotent success without writing when the state is unchanged", async () => {
    const updateListing = vi.fn();
    const result = await setPollListing(
      {
        loadOwnedPoll: async () => ({ discoveryState: "unlisted" }),
        updateListing,
        nowMs: () => NOW,
      },
      POLL_ID,
      OWNER,
      "unlisted",
    );

    expect(result).toEqual({
      ok: true,
      value: { kind: "unchanged", state: "unlisted" },
    });
    expect(updateListing).not.toHaveBeenCalled();
  });

  it.each(["unlisted", "listed"] as const)(
    "refuses a creator request for %s when the poll is delisted",
    async (requested) => {
      const updateListing = vi.fn();
      const result = await setPollListing(
        {
          loadOwnedPoll: async () => ({ discoveryState: "delisted" }),
          updateListing,
          nowMs: () => NOW,
        },
        POLL_ID,
        OWNER,
        requested,
      );

      expect(result).toEqual({
        ok: false,
        error: { code: "poll_delisted", message: DISCOVERY_COPY.delisted },
      });
      expect(updateListing).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["updated", { ok: true, value: { kind: "updated", state: "listed" } }],
    [
      "unchanged",
      { ok: true, value: { kind: "unchanged", state: "listed" } },
    ],
    [
      "delisted",
      {
        ok: false,
        error: { code: "poll_delisted", message: DISCOVERY_COPY.delisted },
      },
    ],
    [
      "not_found",
      {
        ok: false,
        error: { code: "poll_not_found", message: DISCOVERY_COPY.notFound },
      },
    ],
  ] as const)("maps the adapter %s outcome", async (outcome, expected) => {
    const updateListing = vi.fn(async () => outcome);
    const result = await setPollListing(
      {
        loadOwnedPoll: async () => ({ discoveryState: "unlisted" }),
        updateListing,
        nowMs: () => NOW,
      },
      POLL_ID,
      OWNER,
      "listed",
    );

    expect(result).toEqual(expected);
    expect(updateListing).toHaveBeenCalledWith({
      pollId: POLL_ID,
      ownerUserId: OWNER,
      state: "listed",
      updatedAtMs: NOW,
    });
  });

  it("maps a missing owned snapshot to poll_not_found", async () => {
    const result = await setPollListing(
      {
        loadOwnedPoll: async () => null,
        updateListing: async () => "updated",
        nowMs: () => NOW,
      },
      POLL_ID,
      OWNER,
      "listed",
    );

    expect(result).toEqual({
      ok: false,
      error: { code: "poll_not_found", message: DISCOVERY_COPY.notFound },
    });
  });

  it("maps persistence failures to a stable safe error", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await setPollListing(
      {
        loadOwnedPoll: async () => ({ discoveryState: "unlisted" }),
        updateListing: async () => {
          throw new Error("provider detail");
        },
        nowMs: () => NOW,
      },
      POLL_ID,
      OWNER,
      "listed",
    );

    expect(result).toEqual({
      ok: false,
      error: { code: "poll_edit_failed", message: DISCOVERY_COPY.editFailed },
    });
    expect(log).toHaveBeenCalledWith("poll_edit_failed", {
      pollId: POLL_ID,
      cause: "provider detail",
    });
    log.mockRestore();
  });
});

describe("discovery copy", () => {
  it("keeps the exact chooser and refusal language in one catalog", () => {
    expect(DISCOVERY_COPY).toMatchObject({
      unlistedDescription:
        "reachable only by link; absent from Discover and sitemaps",
      listedDescription:
        "appears on Discover and in sitemaps while the Poll is open",
      listingInvalid: "Pick a Discovery Setting.",
      delisted: "Delisted by the Administrator.",
    });
    expect(LISTING_CHOICES).toEqual([
      {
        value: "unlisted",
        label: "UNLISTED",
        description: DISCOVERY_COPY.unlistedDescription,
      },
      {
        value: "listed",
        label: "LISTED",
        description: DISCOVERY_COPY.listedDescription,
      },
    ]);
  });

  it("centralizes the exact public catalog states and controls", () => {
    expect(DISCOVERY_COPY).toMatchObject({
      empty:
        "Nothing here yet. Polls appear when their Creators opt them in. Yours could be the first.",
      error:
        "The directory didn't load. Try again — everything that was on screen is still there.",
      newer: "NEWER",
      older: "OLDER",
      retry: "TRY AGAIN",
      createPrompt: "CREATE A POLL",
    });
    expect(DISCOVERY_PAGE_SIZE).toBe(20);
  });
});

const IDS = Array.from(
  { length: DISCOVERY_PAGE_SIZE + 2 },
  (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}` as PollId,
);

function catalogRecord(index: number): DiscoveryCatalogRecord {
  return {
    id: IDS[index]!,
    canonicalReference: `poll-${index + 1}`,
    question: `Question ${index + 1}?`,
    pollType: "multiple_choice",
    voteCount: index,
    deadlineMs: index % 2 === 0 ? null : NOW + 60_000,
    createdAtMs: NOW - index,
  };
}

describe("Discovery catalog cursor boundary", () => {
  const encodeRawCursor = (value: unknown): string =>
    btoa(typeof value === "string" ? value : JSON.stringify(value))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/u, "");

  it.each(["newer", "older"] as const)(
    "round-trips a versioned %s cursor without exposing its tuple in the URL",
    (direction) => {
      const encoded = encodeDiscoveryCursor(direction, {
        createdAtMs: NOW,
        id: IDS[0]!,
      });

      expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(encoded).not.toContain(IDS[0]!);
      expect(
        parseDiscoveryRequest(new URLSearchParams([[direction, encoded]])),
      ).toEqual({
        ok: true,
        value: {
          direction,
          cursor: encoded,
          boundary: { createdAtMs: NOW, id: IDS[0]! },
        },
      });
    },
  );

  it("accepts a request without a cursor as the first page", () => {
    expect(parseDiscoveryRequest(new URLSearchParams())).toEqual({
      ok: true,
      value: { direction: "initial" },
    });
  });

  it.each([
    ["both directions", `newer=a&older=b`],
    ["duplicate newer", `newer=a&newer=b`],
    ["duplicate older", `older=a&older=b`],
    ["empty cursor", `older=`],
    ["malformed base64url", `older=%%%`],
    ["malformed JSON", `older=${encodeRawCursor("not json")}`],
    [
      "wrong version",
      `older=${encodeRawCursor({ v: 2, d: "older", t: NOW, i: IDS[0] })}`,
    ],
    [
      "mismatched direction",
      `older=${encodeDiscoveryCursor("newer", { createdAtMs: NOW, id: IDS[0]! })}`,
    ],
    [
      "unsafe timestamp",
      `older=${encodeRawCursor({ v: 1, d: "older", t: Number.MAX_SAFE_INTEGER + 1, i: IDS[0] })}`,
    ],
    [
      "negative timestamp",
      `older=${encodeRawCursor({ v: 1, d: "older", t: -1, i: IDS[0] })}`,
    ],
    [
      "invalid poll id",
      `older=${encodeRawCursor({ v: 1, d: "older", t: NOW, i: "not-an-id" })}`,
    ],
    [
      "extra payload key",
      `older=${encodeRawCursor({ v: 1, d: "older", t: NOW, i: IDS[0], extra: true })}`,
    ],
    ["oversized transport", `older=${"a".repeat(513)}`],
  ])("rejects %s with one stable safe error", (_case, query) => {
    const result = parseDiscoveryRequest(new URLSearchParams(query));
    expect(result).toEqual({
      ok: false,
      error: {
        code: "invalid_discovery_cursor",
        message: DISCOVERY_COPY.error,
      },
    });
    expect(JSON.stringify(result)).not.toContain(query);
  });
});

describe("queryDiscoveryCatalog", () => {
  function depsFor(rows: DiscoveryCatalogRecord[]) {
    return {
      persistence: {
        readRevision: vi.fn<DiscoveryCatalogPersistencePort["readRevision"]>(
          async () => 7,
        ),
        queryCatalogPage: vi.fn<
          DiscoveryCatalogPersistencePort["queryCatalogPage"]
        >(async () => rows),
      },
      cache: {
        get: vi.fn<DiscoveryCatalogCachePort["get"]>(async () => null),
        put: vi.fn<DiscoveryCatalogCachePort["put"]>(async () => undefined),
      },
    };
  }

  it("sequences revision, cache miss, bounded query, and cache write", async () => {
    const callOrder: string[] = [];
    const rows = [catalogRecord(0)];
    const deps = {
      persistence: {
        readRevision: vi.fn(async () => {
          callOrder.push("revision");
          return 7;
        }),
        queryCatalogPage: vi.fn(async () => {
          callOrder.push("query");
          return rows;
        }),
      },
      cache: {
        get: vi.fn(async () => {
          callOrder.push("cache-get");
          return null;
        }),
        put: vi.fn(async () => {
          callOrder.push("cache-put");
        }),
      },
    };
    const request: DiscoveryCatalogRequest = { direction: "initial" };

    const result = await queryDiscoveryCatalog(deps, request, NOW);

    expect(callOrder).toEqual(["revision", "cache-get", "query", "cache-put"]);
    expect(deps.persistence.queryCatalogPage).toHaveBeenCalledWith({
      direction: "initial",
      boundary: null,
      limit: 21,
      nowMs: NOW,
    });
    expect(result).toEqual({
      ok: true,
      value: {
        items: [
          {
            canonicalReference: "poll-1",
            question: "Question 1?",
            pollType: "multiple_choice",
            voteCount: 0,
            deadlineMs: null,
            createdAtMs: NOW,
            status: "open",
          },
        ],
        newerUrl: null,
        olderUrl: null,
      },
    });
    expect(JSON.stringify(result)).not.toContain(IDS[0]!);
  });

  it("returns a cached public page without querying or writing D1", async () => {
    const deps = depsFor([]);
    const cached = {
      items: [],
      newerUrl: null,
      olderUrl: null,
    };
    deps.cache.get.mockResolvedValue(cached);

    const result = await queryDiscoveryCatalog(
      deps,
      { direction: "initial" },
      NOW,
    );

    expect(result).toEqual({ ok: true, value: cached });
    expect(deps.persistence.queryCatalogPage).not.toHaveBeenCalled();
    expect(deps.cache.put).not.toHaveBeenCalled();
  });

  it("fails open when cache reads and writes reject", async () => {
    const deps = depsFor([catalogRecord(0)]);
    deps.cache.get.mockRejectedValue(new Error("cache read"));
    deps.cache.put.mockRejectedValue(new Error("cache write"));

    await expect(
      queryDiscoveryCatalog(deps, { direction: "initial" }, NOW),
    ).resolves.toMatchObject({ ok: true });
    expect(deps.persistence.queryCatalogPage).toHaveBeenCalledOnce();
  });

  it.each([
    ["missing revision", async () => null],
    ["unsafe revision", async () => Number.MAX_SAFE_INTEGER + 1],
    ["revision read failure", async () => Promise.reject(new Error("revision"))],
  ])("maps %s to the stable catalog error", async (_case, readRevision) => {
    const deps = depsFor([]);
    deps.persistence.readRevision.mockImplementation(readRevision);

    expect(
      await queryDiscoveryCatalog(deps, { direction: "initial" }, NOW),
    ).toEqual({
      ok: false,
      error: {
        code: "discovery_catalog_unavailable",
        message: DISCOVERY_COPY.error,
      },
    });
    expect(deps.cache.get).not.toHaveBeenCalled();
  });

  it("maps a D1 page failure to the stable catalog error", async () => {
    const deps = depsFor([]);
    deps.persistence.queryCatalogPage.mockRejectedValue(new Error("query"));

    expect(
      await queryDiscoveryCatalog(deps, { direction: "initial" }, NOW),
    ).toEqual({
      ok: false,
      error: {
        code: "discovery_catalog_unavailable",
        message: DISCOVERY_COPY.error,
      },
    });
    expect(deps.cache.put).not.toHaveBeenCalled();
  });

  it("uses the 21st descending row only as the OLDER sentinel", async () => {
    const rows = Array.from({ length: 21 }, (_, index) => catalogRecord(index));
    const deps = depsFor(rows);

    const result = await queryDiscoveryCatalog(
      deps,
      { direction: "initial" },
      NOW,
    );

    expect(result.ok && result.value.items).toHaveLength(20);
    expect(result.ok && result.value.items.at(-1)?.canonicalReference).toBe(
      "poll-20",
    );
    expect(result.ok && result.value.newerUrl).toBeNull();
    expect(result.ok && result.value.olderUrl).toMatch(/^\/discover\?older=/);
    expect(JSON.stringify(result)).not.toContain(IDS[20]!);
  });

  it("drops the farthest newer sentinel before reversing the adjacent page", async () => {
    const ascendingRows = Array.from({ length: 21 }, (_, index) =>
      catalogRecord(20 - index),
    );
    const deps = depsFor(ascendingRows);
    const cursor = encodeDiscoveryCursor("newer", {
      createdAtMs: NOW - 40,
      id: IDS[0]!,
    });

    const result = await queryDiscoveryCatalog(
      deps,
      {
        direction: "newer",
        cursor,
        boundary: { createdAtMs: NOW - 40, id: IDS[0]! },
      },
      NOW,
    );

    expect(result.ok && result.value.items.map((item) => item.canonicalReference)).toEqual(
      Array.from({ length: 20 }, (_, index) => `poll-${index + 2}`),
    );
    expect(result.ok && result.value.newerUrl).toMatch(/^\/discover\?newer=/);
    expect(result.ok && result.value.olderUrl).toMatch(/^\/discover\?older=/);
    expect(JSON.stringify(result)).not.toContain(IDS[0]!);
  });

  it("exposes the adjacent NEWER link while seeking OLDER strictly below the boundary", async () => {
    const deps = depsFor([catalogRecord(10), catalogRecord(11)]);
    const cursor = encodeDiscoveryCursor("older", {
      createdAtMs: NOW - 9,
      id: IDS[9]!,
    });

    const result = await queryDiscoveryCatalog(
      deps,
      {
        direction: "older",
        cursor,
        boundary: { createdAtMs: NOW - 9, id: IDS[9]! },
      },
      NOW,
    );

    expect(deps.persistence.queryCatalogPage).toHaveBeenCalledWith({
      direction: "older",
      boundary: { createdAtMs: NOW - 9, id: IDS[9]! },
      limit: 21,
      nowMs: NOW,
    });
    expect(result.ok && result.value.newerUrl).toMatch(/^\/discover\?newer=/);
    expect(result.ok && result.value.olderUrl).toBeNull();
  });
});
