import type { APIContext, APIRoute } from "astro";

const CACHE_CONTROL = "no-store";

export const GET = (({ request }) => {
  try {
    const origin = new URL(request.url).origin;
    return new Response(
      `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`,
      {
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": CACHE_CONTROL,
        },
      },
    );
  } catch {
    return new Response("robots_unavailable", {
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
  // HEAD shares GET truth; the endpoint renderer strips the body afterward.
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
