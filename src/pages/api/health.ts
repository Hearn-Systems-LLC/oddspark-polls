import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";

// Binding liveness for the deploy gate's smoke probe. The page and auth
// probes never touch VOTE_DIGEST_SECRET or TURNSTILE_SECRET_KEY, so a deploy
// missing them would serve pages fine while every CAPTCHA-on vote fails —
// the forgotten-secret failure class. Only missing binding NAMES are
// reported, never values.
export const GET: APIRoute = () => {
  const missing: string[] = [];
  if (!env.DB) {
    missing.push("DB");
  }
  if (!env.SESSION) {
    missing.push("SESSION");
  }
  if (
    typeof env.VOTE_DIGEST_SECRET !== "string" ||
    env.VOTE_DIGEST_SECRET.trim().length === 0
  ) {
    missing.push("VOTE_DIGEST_SECRET");
  }
  if (
    typeof env.TURNSTILE_SITE_KEY !== "string" ||
    env.TURNSTILE_SITE_KEY.trim().length === 0
  ) {
    missing.push("TURNSTILE_SITE_KEY");
  }
  if (
    typeof env.TURNSTILE_SECRET_KEY !== "string" ||
    env.TURNSTILE_SECRET_KEY.trim().length === 0
  ) {
    missing.push("TURNSTILE_SECRET_KEY");
  }
  if (
    typeof env.DEMO_POLL_REFERENCE !== "string" ||
    env.DEMO_POLL_REFERENCE.trim().length === 0
  ) {
    missing.push("DEMO_POLL_REFERENCE");
  }

  if (missing.length > 0) {
    return Response.json(
      { ok: false, missing },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
  return Response.json(
    { ok: true },
    { status: 200, headers: { "cache-control": "no-store" } },
  );
};
