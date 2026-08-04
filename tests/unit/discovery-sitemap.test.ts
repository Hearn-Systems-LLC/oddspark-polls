import { describe, expect, it, vi } from "vitest";
import {
  SITEMAP_BATCH_SIZE,
  SITEMAP_MAX_POLL_URLS,
  buildDiscoverySitemap,
  renderDiscoverySitemapXml,
  type DiscoverySitemapRecord,
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

function pagedPort(total: number) {
  const querySitemapPage = vi.fn(async ({ boundary, limit }) => {
    const start = boundary === null ? 0 : Number(boundary.id.slice(-12));
    return Array.from(
      { length: Math.min(limit, Math.max(0, total - start)) },
      (_, offset) => row(start + offset + 1),
    );
  });
  return { querySitemapPage };
}

describe("buildDiscoverySitemap", () => {
  it("emits the two static URLs and XML-escaped canonical Poll URLs", async () => {
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
      boundary: null,
      limit: SITEMAP_BATCH_SIZE + 1,
      nowMs: NOW,
    });
  });

  it("walks every merged keyset page without duplicating its sentinel", async () => {
    const port = pagedPort(2_001);

    const result = await buildDiscoverySitemap(
      port,
      new URL("https://polls.example.test"),
      NOW,
    );

    expect(result.ok && result.value.pollUrlCount).toBe(2_001);
    expect(result.ok && result.value.pageCount).toBe(3);
    expect(port.querySitemapPage).toHaveBeenCalledTimes(3);
    expect(result.ok && (result.value.xml.match(/<url><loc>/g) ?? [])).toHaveLength(
      2_003,
    );
    expect(result.ok && result.value.xml.match(/poll-1001/g)).toHaveLength(1);
  });

  it("accepts exactly 49,998 Poll URLs in 50 merged pages", async () => {
    const port = pagedPort(SITEMAP_MAX_POLL_URLS);

    const result = await buildDiscoverySitemap(
      port,
      new URL("https://polls.example.test"),
      NOW,
    );

    expect(result.ok && result.value.pollUrlCount).toBe(49_998);
    expect(result.ok && result.value.pageCount).toBe(50);
    expect(port.querySitemapPage).toHaveBeenCalledTimes(50);
  });

  it("fails closed without partial XML at the 49,999th Poll URL", async () => {
    const port = pagedPort(SITEMAP_MAX_POLL_URLS + 1);

    const result = await buildDiscoverySitemap(
      port,
      new URL("https://polls.example.test"),
      NOW,
    );

    expect(result).toEqual({
      ok: false,
      error: { code: "sitemap_capacity_exceeded" },
    });
    expect(port.querySitemapPage).toHaveBeenCalledTimes(50);
  });

  it("rejects a persistence page larger than the bounded sentinel request", async () => {
    const querySitemapPage = vi.fn(async () =>
      Array.from({ length: SITEMAP_BATCH_SIZE + 2 }, (_, index) => row(index + 1)),
    );

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
  });
});

describe("renderDiscoverySitemapXml", () => {
  it("escapes XML text rather than trusting URL-shaped input", () => {
    const result = renderDiscoverySitemapXml(
      ["https://polls.example.test/?a=1&b=<tag>\"'"],
      1_000,
    );
    expect(result.ok && result.value.xml).toContain(
      "?a=1&amp;b=&lt;tag&gt;&quot;&apos;",
    );
  });

  it("enforces the uncompressed UTF-8 byte ceiling", () => {
    expect(
      renderDiscoverySitemapXml(["https://polls.example.test/é"], 100),
    ).toEqual({ ok: false, error: { code: "sitemap_capacity_exceeded" } });
  });
});
