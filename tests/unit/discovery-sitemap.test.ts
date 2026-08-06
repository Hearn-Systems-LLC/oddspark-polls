import { describe, expect, it, vi } from "vitest";
import {
  SITEMAP_BATCH_SIZE,
  SITEMAP_MAX_PAGES,
  SITEMAP_SHARD_POLL_URLS,
  buildDiscoverySitemap,
  encodeDiscoverySitemapRange,
  parseDiscoverySitemapRequest,
  renderDiscoverySitemapIndexXml,
  renderDiscoverySitemapXml,
  type DiscoverySitemapRecord,
  type DiscoverySitemapRequest,
} from "../../src/modules/discovery/index";
import type { PollId } from "../../src/shared/domain/index";

const NOW = 1_800_000_000_000;

function row(index: number, reference = `poll-${index}`): DiscoverySitemapRecord {
  return {
    id: `50000000-0000-4000-8000-${String(index).padStart(12, "0")}` as PollId,
    createdAtMs: NOW - index,
    canonicalReference: reference,
    deadlineMs: null,
  };
}

function pagedPort(total: number, removed = new Set<number>()) {
  const querySitemapPage = vi.fn(
    async ({ startExclusive, endInclusive, limit }) => {
      const start =
        startExclusive === null ? 0 : Number(startExclusive.id.slice(-12));
      const end =
        endInclusive === null ? total : Number(endInclusive.id.slice(-12));
      const rows: DiscoverySitemapRecord[] = [];
      for (let index = start + 1; index <= end && rows.length < limit; index += 1) {
        if (!removed.has(index)) rows.push(row(index));
      }
      return rows;
    },
  );
  return { querySitemapPage };
}

function childRequests(xml: string): DiscoverySitemapRequest[] {
  return [...xml.matchAll(/<sitemap><loc>([^<]+)<\/loc><\/sitemap>/gu)].map(
    (match) => {
      const url = new URL((match[1] as string).replaceAll("&amp;", "&"));
      const parsed = parseDiscoverySitemapRequest(url.searchParams);
      if (!parsed.ok) throw new Error("invalid generated child URL");
      return parsed.value;
    },
  );
}

function pollUrls(xml: string): string[] {
  return [...xml.matchAll(/<url><loc>([^<]+)<\/loc><\/url>/gu)]
    .map((match) => match[1] as string)
    .filter((url) => /\/poll-\d+$/u.test(url));
}

describe("buildDiscoverySitemap", () => {
  it("preserves the small-catalog XML bytes and two static URLs", async () => {
    const querySitemapPage = vi.fn(async () => [row(1, "tea&toast")]);
    const result = await buildDiscoverySitemap(
      { querySitemapPage },
      new URL("https://polls.example.test/ignored?x=1"),
      NOW,
    );
    expect(result).toEqual({
      ok: true,
      value: {
        pageCount: 1,
        pollUrlCount: 1,
        xml:
          '<?xml version="1.0" encoding="UTF-8"?>\n' +
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
          "  <url><loc>https://polls.example.test/</loc></url>\n" +
          "  <url><loc>https://polls.example.test/discover</loc></url>\n" +
          "  <url><loc>https://polls.example.test/tea%26toast</loc></url>\n" +
          "</urlset>\n",
      },
    });
    expect(querySitemapPage).toHaveBeenCalledWith({
      startExclusive: null,
      endInclusive: null,
      limit: SITEMAP_BATCH_SIZE + 1,
      nowMs: NOW,
    });
  });

  it("walks merged keyset pages without duplicating a sentinel", async () => {
    const port = pagedPort(2_001);
    const result = await buildDiscoverySitemap(
      port,
      new URL("https://polls.example.test"),
      NOW,
    );
    expect(result.ok && result.value.pollUrlCount).toBe(2_001);
    expect(result.ok && result.value.pageCount).toBe(3);
    expect(result.ok && result.value.xml.match(/poll-1001/g)).toHaveLength(1);
  });

  it("keeps one URL set through exactly 45,000 Polls", async () => {
    const result = await buildDiscoverySitemap(
      pagedPort(SITEMAP_SHARD_POLL_URLS),
      new URL("https://polls.example.test"),
      NOW,
    );
    expect(result.ok && result.value.xml).toContain("<urlset");
    expect(result.ok && result.value.xml).not.toContain("<sitemapindex");
  });

  it("covers a stable large dataset exactly once across bounded children", async () => {
    const total = SITEMAP_SHARD_POLL_URLS + 1;
    const port = pagedPort(total);
    const root = await buildDiscoverySitemap(
      port,
      new URL("https://polls.example.test/sitemap.xml"),
      NOW,
    );
    expect(root.ok && root.value.xml).toContain("<sitemapindex");
    const requests = root.ok ? childRequests(root.value.xml) : [];
    expect(requests).toHaveLength(2);
    const urls: string[] = [];
    for (const request of requests) {
      const child = await buildDiscoverySitemap(
        port,
        new URL("https://polls.example.test/sitemap.xml"),
        NOW,
        { request },
      );
      expect(child.ok).toBe(true);
      if (child.ok) urls.push(...pollUrls(child.value.xml));
    }
    expect(urls).toHaveLength(total);
    expect(new Set(urls)).toHaveLength(total);
  });

  it("retains disjoint coverage when the shared boundary row is deleted", async () => {
    const total = SITEMAP_SHARD_POLL_URLS + 1;
    const rootPort = pagedPort(total);
    const root = await buildDiscoverySitemap(
      rootPort,
      new URL("https://polls.example.test/sitemap.xml"),
      NOW,
    );
    const requests = root.ok ? childRequests(root.value.xml) : [];
    const childPort = pagedPort(total, new Set([SITEMAP_SHARD_POLL_URLS]));
    const urls: string[] = [];
    for (const request of requests) {
      const child = await buildDiscoverySitemap(
        childPort,
        new URL("https://polls.example.test/sitemap.xml"),
        NOW,
        { request },
      );
      expect(child.ok).toBe(true);
      if (child.ok) urls.push(...pollUrls(child.value.xml));
    }
    expect(urls).toHaveLength(total - 1);
    expect(new Set(urls)).toHaveLength(total - 1);
    expect(urls).not.toContain(
      `https://polls.example.test/poll-${SITEMAP_SHARD_POLL_URLS}`,
    );
  });

  it("returns gone when a non-static child becomes empty", async () => {
    const request: DiscoverySitemapRequest = {
      kind: "range",
      range: { startExclusive: row(45_000), endInclusive: row(45_001) },
    };
    await expect(
      buildDiscoverySitemap(
        pagedPort(45_001, new Set([45_001])),
        new URL("https://polls.example.test/sitemap.xml"),
        NOW,
        { request },
      ),
    ).resolves.toEqual({
      ok: false,
      error: { code: "sitemap_range_gone" },
    });
  });

  it("keeps the two static URLs when the first child becomes empty", async () => {
    const request: DiscoverySitemapRequest = {
      kind: "range",
      range: { startExclusive: null, endInclusive: row(1) },
    };
    const result = await buildDiscoverySitemap(
      pagedPort(1, new Set([1])),
      new URL("https://polls.example.test/sitemap.xml"),
      NOW,
      { request },
    );
    expect(result.ok && result.value.xml.match(/<url><loc>/g)).toHaveLength(2);
  });

  it("fails the first child closed after growth consumes its headroom", async () => {
    const request: DiscoverySitemapRequest = {
      kind: "range",
      range: { startExclusive: null, endInclusive: row(60_000) },
    };
    await expect(
      buildDiscoverySitemap(
        pagedPort(49_999),
        new URL("https://polls.example.test/sitemap.xml"),
        NOW,
        { request },
      ),
    ).resolves.toEqual({
      ok: false,
      error: { code: "sitemap_capacity_exceeded" },
    });
  });

  it("allows exactly 50,000 Poll URLs in a non-static child", async () => {
    const request: DiscoverySitemapRequest = {
      kind: "range",
      range: { startExclusive: row(1), endInclusive: row(50_001) },
    };
    const result = await buildDiscoverySitemap(
      pagedPort(50_001),
      new URL("https://polls.example.test/sitemap.xml"),
      NOW,
      { request },
    );
    expect(result.ok && result.value.pollUrlCount).toBe(50_000);
    expect(result.ok && result.value.xml.match(/<url><loc>/g)).toHaveLength(
      50_000,
    );
  });

  it("fails a non-static child closed at 50,001 Poll URLs", async () => {
    const request: DiscoverySitemapRequest = {
      kind: "range",
      range: { startExclusive: row(1), endInclusive: row(50_002) },
    };
    await expect(
      buildDiscoverySitemap(
        pagedPort(50_002),
        new URL("https://polls.example.test/sitemap.xml"),
        NOW,
        { request },
      ),
    ).resolves.toEqual({
      ok: false,
      error: { code: "sitemap_capacity_exceeded" },
    });
  });

  it("stops at the 500-page whole-build ceiling", async () => {
    const querySitemapPage = vi.fn(async ({ startExclusive, limit }) => {
      const start =
        startExclusive === null ? 0 : Number(startExclusive.id.slice(-12));
      return Array.from({ length: limit }, (_, offset) => row(start + offset + 1));
    });
    await expect(
      buildDiscoverySitemap(
        { querySitemapPage },
        new URL("https://polls.example.test"),
        NOW,
      ),
    ).resolves.toEqual({
      ok: false,
      error: { code: "sitemap_capacity_exceeded" },
    });
    expect(querySitemapPage).toHaveBeenCalledTimes(SITEMAP_MAX_PAGES);
  });

  it("does no persistence work when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const querySitemapPage = vi.fn(async () => []);
    await expect(
      buildDiscoverySitemap(
        { querySitemapPage },
        new URL("https://polls.example.test"),
        NOW,
        { signal: controller.signal },
      ),
    ).resolves.toEqual({
      ok: false,
      error: { code: "sitemap_generation_aborted" },
    });
    expect(querySitemapPage).not.toHaveBeenCalled();
  });

  it("stops awaiting an in-flight page after abort", async () => {
    const controller = new AbortController();
    const querySitemapPage = vi.fn(
      () => new Promise<DiscoverySitemapRecord[]>(() => undefined),
    );
    const build = buildDiscoverySitemap(
      { querySitemapPage },
      new URL("https://polls.example.test"),
      NOW,
      { signal: controller.signal },
    );
    controller.abort();
    await expect(build).resolves.toEqual({
      ok: false,
      error: { code: "sitemap_generation_aborted" },
    });
    expect(querySitemapPage).toHaveBeenCalledTimes(1);
  });

  it("maps a page rejection after the deadline to the stable abort result", async () => {
    const clock = vi.fn().mockReturnValueOnce(0).mockReturnValue(100);
    const querySitemapPage = vi.fn(async () => {
      throw new Error("late persistence failure");
    });
    await expect(
      buildDiscoverySitemap(
        { querySitemapPage },
        new URL("https://polls.example.test"),
        NOW,
        { deadlineAtMs: 100, clock },
      ),
    ).resolves.toEqual({
      ok: false,
      error: { code: "sitemap_generation_aborted" },
    });
  });

  it.each([
    [[100], "before enumeration"],
    [[0, 0, 0, 100], "before rendering"],
    [[0, 0, 0, 0, 100], "after rendering"],
  ])("checks the synchronous deadline %s", async (clockValues, _label) => {
    const clock = vi.fn(() => clockValues.shift() ?? 0);
    await expect(
      buildDiscoverySitemap(
        pagedPort(1),
        new URL("https://polls.example.test"),
        NOW,
        { deadlineAtMs: 100, clock },
      ),
    ).resolves.toEqual({
      ok: false,
      error: { code: "sitemap_generation_aborted" },
    });
  });
});

describe("sitemap range codec", () => {
  it("round-trips one canonical v1 range", () => {
    const token = encodeDiscoverySitemapRange({
      startExclusive: row(1),
      endInclusive: row(2),
    });
    expect(parseDiscoverySitemapRequest(new URLSearchParams({ range: token }))).toEqual({
      ok: true,
      value: {
        kind: "range",
        range: {
          startExclusive: { id: row(1).id, createdAtMs: row(1).createdAtMs },
          endInclusive: { id: row(2).id, createdAtMs: row(2).createdAtMs },
        },
      },
    });
  });

  it.each([
    "range=",
    "range=not-base64url!",
    "range=e30",
    "range=a&range=b",
    "range=a&extra=b",
    "extra=b",
  ])("rejects malformed, duplicate, or extra input: %s", (query) => {
    expect(parseDiscoverySitemapRequest(new URLSearchParams(query))).toEqual({
      ok: false,
      error: { code: "invalid_sitemap_range", message: "Invalid sitemap range." },
    });
  });

  it("refuses to construct non-UUID or reversed boundaries", () => {
    expect(() =>
      encodeDiscoverySitemapRange({
        startExclusive: null,
        endInclusive: { ...row(1), id: "not-a-uuid" as PollId },
      }),
    ).toThrow("Invalid sitemap range");
    expect(() =>
      encodeDiscoverySitemapRange({
        startExclusive: row(2),
        endInclusive: row(1),
      }),
    ).toThrow("Invalid sitemap range");
  });
});

describe("sitemap XML renderers", () => {
  it("escapes XML text", () => {
    const result = renderDiscoverySitemapXml(
      ["https://polls.example.test/?a=1&b=<tag>\"'"],
      1_000,
    );
    expect(result.ok && result.value.xml).toContain(
      "?a=1&amp;b=&lt;tag&gt;&quot;&apos;",
    );
  });

  it("enforces the UTF-8 byte ceiling for sets and indexes", () => {
    expect(renderDiscoverySitemapXml(["https://polls.example.test/é"], 100)).toEqual({
      ok: false,
      error: { code: "sitemap_capacity_exceeded" },
    });
    expect(renderDiscoverySitemapIndexXml(["https://polls.example.test/é"], 100)).toEqual({
      ok: false,
      error: { code: "sitemap_capacity_exceeded" },
    });
  });
});
