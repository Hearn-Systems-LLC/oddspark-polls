import { env } from "cloudflare:workers";
import type { APIContext, APIRoute } from "astro";
import { createDiscoveryPersistence } from "../adapters/d1/index";
import { buildDiscoverySitemap } from "../modules/discovery/index";

const CACHE_CONTROL = "no-store";

export const GET = (async ({ request }) => {
  try {
    const result = await buildDiscoverySitemap(
      createDiscoveryPersistence(env.DB),
      new URL(request.url),
      Date.now(),
    );
    if (!result.ok) {
      return new Response(result.error.code, {
        status: 503,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": CACHE_CONTROL,
        },
      });
    }
    return new Response(result.value.xml, {
      headers: {
        "content-type": "application/xml; charset=utf-8",
        "cache-control": CACHE_CONTROL,
      },
    });
  } catch {
    return new Response("sitemap_unavailable", {
      status: 500,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": CACHE_CONTROL,
      },
    });
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
