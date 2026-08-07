import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { createResultsPersistence } from "../../../adapters/d1/index";
import { isReservedSlug } from "../../../modules/polls/reserved-slugs";
import {
  queryLiveResults,
  type LiveResultsPayload,
} from "../../../modules/results/index";
import type { UserId } from "../../../shared/domain/index";

// Thin inbound adapter for AD-10 conditional polling. Authorization,
// effective closure, percentage/leader projection, and validator composition
// remain owned by Results; delivery maps its closed union to HTTP only.
const CACHE_CONTROL = "private, no-store";

const cacheHeaders = (): Headers => {
  const headers = new Headers();
  headers.set("cache-control", CACHE_CONTROL);
  return headers;
};

export const ALL: APIRoute = () =>
  new Response("Method not allowed.", {
    status: 405,
    headers: {
      allow: "GET, HEAD",
      "cache-control": CACHE_CONTROL,
    },
  });

const handle: APIRoute = async ({ request, params, locals }) => {
  const reference = params.reference ?? "";
  if (isReservedSlug(reference)) {
    return new Response("Not found.", {
      status: 404,
      headers: cacheHeaders(),
    });
  }

  const principalId = locals.principal?.userId;
  const view = await queryLiveResults(
    createResultsPersistence(env.DB),
    reference,
    { userId: principalId === undefined ? null : (principalId as UserId) },
    Date.now(),
    request.headers.get("if-none-match"),
  );

  if (view.kind !== "not_found" && locals.requestContext) {
    locals.requestContext.pollId = view.pollId;
  }

  if (view.kind === "not_found") {
    return new Response("Not found.", {
      status: 404,
      headers: cacheHeaders(),
    });
  }

  if (
    view.kind === "after_close_hidden" ||
    view.kind === "creator_only_hidden" ||
    view.kind === "ranked_unavailable"
  ) {
    return new Response(null, {
      status: 204,
      headers: cacheHeaders(),
    });
  }

  const headers = cacheHeaders();
  headers.set("etag", view.validator);
  if (view.kind === "not_modified") {
    return new Response(null, { status: 304, headers });
  }

  headers.set("content-type", "application/json; charset=utf-8");
  const payload: LiveResultsPayload =
    view.kind === "ranked_visible"
      ? {
          ...view.ranked,
          status: view.status,
          pollType: "ranked_choice",
          comments: view.comments,
        }
      : {
          ...view.tally,
          status: view.status,
          comments: view.comments,
        };
  return new Response(JSON.stringify(payload), { status: 200, headers });
};

export const GET: APIRoute = handle;

export const HEAD: APIRoute = async (context) => {
  const response = await handle(context);
  return new Response(null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
};
