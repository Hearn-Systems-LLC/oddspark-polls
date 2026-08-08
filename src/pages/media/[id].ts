// Public media serving route (Story 6.1 / AC 2). GET/HEAD only; looks up
// media_object by id in D1 (adoption check IS the lookup — no row, 404),
// streams from R2 with immutable caching. Adopted keys are immutable and
// singly owned (AD-12), so long-lived cache is safe.

import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { isUuidShape } from "../../modules/polls/index";

export const prerender = false;

const handleRequest: APIRoute = async ({ params }) => {
  const mediaId = params.id;
  if (!mediaId || !isUuidShape(mediaId)) {
    return new Response(null, { status: 404 });
  }

  // Adoption check: the media_object row must exist for the object to be
  // publicly servable. No row = unadopted = 404, indistinguishable from
  // nonexistence.
  const row = await env.DB.prepare(
    "SELECT r2_key, content_type FROM media_object WHERE id = ?1",
  )
    .bind(mediaId)
    .first<{ r2_key: string; content_type: string }>();

  if (!row) {
    return new Response(null, { status: 404 });
  }

  const object = await env.MEDIA.get(row.r2_key);
  if (!object) {
    return new Response(null, { status: 404 });
  }

  return new Response(object.body, {
    status: 200,
    headers: {
      "content-type": row.content_type,
      "x-content-type-options": "nosniff",
      etag: object.httpEtag ?? `"${object.key}"`,
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
};

export const GET = handleRequest;
export const HEAD: APIRoute = async ({ params }) => {
  const mediaId = params.id;
  if (!mediaId || !isUuidShape(mediaId)) {
    return new Response(null, { status: 404 });
  }

  const row = await env.DB.prepare(
    "SELECT r2_key, content_type FROM media_object WHERE id = ?1",
  )
    .bind(mediaId)
    .first<{ r2_key: string; content_type: string }>();

  if (!row) {
    return new Response(null, { status: 404 });
  }

  // HEAD should not fetch the object body — use head() instead of get().
  const head = await env.MEDIA.head(row.r2_key);
  if (!head) {
    return new Response(null, { status: 404 });
  }

  return new Response(null, {
    status: 200,
    headers: {
      "content-type": row.content_type,
      "x-content-type-options": "nosniff",
      etag: head.httpEtag ?? `"${head.key}"`,
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
};

export const POST: APIRoute = () =>
  new Response(null, { status: 405, headers: { allow: "GET, HEAD" } });

export const PUT: APIRoute = POST;
export const DELETE: APIRoute = POST;
export const PATCH: APIRoute = POST;
