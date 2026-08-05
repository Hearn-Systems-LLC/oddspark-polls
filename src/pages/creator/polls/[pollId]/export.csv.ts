import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { serializeCsvExport } from "../../../../adapters/csv/index";
import { queryD1OwnerExport } from "../../../../lib/export-delivery";
import type { PollId, UserId } from "../../../../shared/domain/index";

const NO_STORE = "private, no-store";

function baseHeaders(): Headers {
  return new Headers({
    "cache-control": NO_STORE,
    "x-content-type-options": "nosniff",
  });
}

function safeFilename(reference: string): string {
  const safe = reference
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80);
  return `oddspark-${safe || "poll"}.csv`;
}

export const ALL: APIRoute = () => {
  const headers = baseHeaders();
  headers.set("allow", "GET, HEAD");
  return new Response("Method not allowed.", { status: 405, headers });
};

const handle: APIRoute = async ({ params, locals }) => {
  const principal = locals.requestContext?.principal ?? locals.principal ?? null;
  if (!principal) {
    return new Response(null, {
      status: 303,
      headers: {
        location: "/sign-in?return=%2Fcreator",
        "cache-control": NO_STORE,
      },
    });
  }
  const pollId = (params.pollId ?? "") as PollId;
  try {
    const result = await queryD1OwnerExport(
      env.DB,
      pollId,
      { userId: principal.userId as UserId },
    );
    if (!result) {
      return new Response("Not found.", {
        status: 404,
        headers: baseHeaders(),
      });
    }
    const headers = baseHeaders();
    headers.set("content-type", "text/csv; charset=utf-8");
    headers.set(
      "content-disposition",
      `attachment; filename="${safeFilename(result.canonicalReference)}"`,
    );
    return new Response(serializeCsvExport(result.dataset), {
      status: 200,
      headers,
    });
  } catch {
    if (locals.requestContext) locals.requestContext.resultsLookupFailed = true;
    return new Response("Export unavailable.", {
      status: 500,
      headers: baseHeaders(),
    });
  }
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
