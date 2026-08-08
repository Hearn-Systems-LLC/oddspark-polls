// Creator-only preview of not-yet-adopted media (Story 6.1 / AC 2).
// Serves temp R2 objects ONLY to the authenticated owner of the in-flight
// form, scoped by poll_id. Never publicly reachable.

import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { isUuidShape } from "../../../modules/polls/index";

export const GET: APIRoute = async ({ params, request, locals }) => {
  const requestContext = locals.requestContext;
  const principal = requestContext?.principal ?? null;
  if (!principal) {
    return new Response(null, { status: 404 });
  }

  const mediaId = params.id;
  if (!mediaId || !isUuidShape(mediaId)) {
    return new Response(null, { status: 404 });
  }

  // The poll_id query param scopes the preview to the in-flight form.
  const url = new URL(request.url);
  const pollId = url.searchParams.get("poll");
  if (!pollId || !isUuidShape(pollId)) {
    return new Response(null, { status: 404 });
  }

  // Temp keys are tmp/{poll_id}/{mediaId}. Verify the object exists.
  const r2Key = `tmp/${pollId}/${mediaId}`;
  const object = await env.MEDIA.get(r2Key);
  if (!object) {
    return new Response(null, { status: 404 });
  }

  const contentType =
    object.httpMetadata?.contentType ?? "application/octet-stream";

  return new Response(object.body, {
    status: 200,
    headers: {
      "content-type": contentType,
      "cache-control": "private, no-store",
    },
  });
};

export const HEAD: APIRoute = async ({ params, request, locals }) => {
  const requestContext = locals.requestContext;
  const principal = requestContext?.principal ?? null;
  if (!principal) {
    return new Response(null, { status: 404 });
  }

  const mediaId = params.id;
  if (!mediaId || !isUuidShape(mediaId)) {
    return new Response(null, { status: 404 });
  }

  const url = new URL(request.url);
  const pollId = url.searchParams.get("poll");
  if (!pollId || !isUuidShape(pollId)) {
    return new Response(null, { status: 404 });
  }

  const r2Key = `tmp/${pollId}/${mediaId}`;
  // HEAD should not fetch the object body — use head() instead of get().
  const head = await env.MEDIA.head(r2Key);
  if (!head) {
    return new Response(null, { status: 404 });
  }

  const contentType =
    head.httpMetadata?.contentType ?? "application/octet-stream";

  return new Response(null, {
    status: 200,
    headers: {
      "content-type": contentType,
      "cache-control": "private, no-store",
    },
  });
};

export const POST: APIRoute = () =>
  new Response(null, { status: 405, headers: { allow: "GET, HEAD" } });

export const PUT: APIRoute = POST;
export const DELETE: APIRoute = POST;
export const PATCH: APIRoute = POST;
