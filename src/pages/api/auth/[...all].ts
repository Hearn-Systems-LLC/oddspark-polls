import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { createAuth } from "../../../adapters/auth/index";
import { SIGN_IN_DENIED_PATH } from "../../../modules/identity/index";

export const prerender = false;

export const ALL: APIRoute = async ({ request }) => {
  try {
    return await createAuth(env).handler(request);
  } catch {
    // Non-APIError throws (D1 failure mid-callback, constraint violations)
    // reach here via onAPIError.throw. Browser navigations land on the
    // denial outcome; API callers get a JSON error instead of a redirect
    // into an HTML page.
    if (request.method === "GET" || request.method === "HEAD") {
      return new Response(null, {
        status: 303,
        headers: { location: SIGN_IN_DENIED_PATH, "cache-control": "no-store" },
      });
    }
    return Response.json(
      { code: "auth_unavailable" },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
};
