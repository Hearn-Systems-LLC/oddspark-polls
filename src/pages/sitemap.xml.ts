import { env } from "cloudflare:workers";
import type { APIContext, APIRoute } from "astro";
import { createDiscoveryPersistence } from "../adapters/d1/index";
import {
  buildDiscoverySitemap,
  parseDiscoverySitemapRequest,
} from "../modules/discovery/index";

const CACHE_CONTROL = "no-store";
const SITEMAP_BUILD_BUDGET_MS = 10_000;

function textResponse(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": CACHE_CONTROL,
    },
  });
}

export const GET = (async ({ request }) => {
  try {
    const requestUrl = new URL(request.url);
    const parsed = parseDiscoverySitemapRequest(requestUrl.searchParams);
    if (!parsed.ok) return textResponse(parsed.error.code, 400);
    const nowMs = Date.now();
    const signal = AbortSignal.any([
      request.signal,
      AbortSignal.timeout(SITEMAP_BUILD_BUDGET_MS),
    ]);
    const result = await buildDiscoverySitemap(
      createDiscoveryPersistence(env.DB),
      requestUrl,
      nowMs,
      {
        request: parsed.value,
        signal,
        deadlineAtMs: nowMs + SITEMAP_BUILD_BUDGET_MS,
        clock: Date.now,
      },
    );
    if (!result.ok) {
      const status = result.error.code === "sitemap_range_gone" ? 410 : 503;
      return textResponse(result.error.code, status);
    }
    return new Response(result.value.xml, {
      headers: {
        "content-type": "application/xml; charset=utf-8",
        "cache-control": CACHE_CONTROL,
      },
    });
  } catch {
    return textResponse("sitemap_unavailable", 500);
  }
}) satisfies APIRoute;

export const ALL = (async (context: APIContext) => {
  // Astro 7.1 resolves ALL before its GET-to-HEAD fallback. Delegate here so
  // HEAD still owns the one GET enumeration path; Astro then strips the body.
  if (context.request.method === "HEAD") return GET(context);
  return new Response("Method not allowed.", {
    status: 405,
    headers: {
      allow: "GET, HEAD",
      "cache-control": CACHE_CONTROL,
      "content-type": "text/plain; charset=utf-8",
    },
  });
}) satisfies APIRoute;
