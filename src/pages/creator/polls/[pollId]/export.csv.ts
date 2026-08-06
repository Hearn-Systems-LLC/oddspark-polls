import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { serializeCsvExport } from "../../../../adapters/csv/index";
import { queryD1OwnerExport } from "../../../../lib/export-delivery";
import {
  exportBaseHeaders,
  safeExportFilename,
} from "../../../../lib/export-http";
import type { PollId, UserId } from "../../../../shared/domain/index";

export const ALL: APIRoute = () => {
  const headers = exportBaseHeaders();
  headers.set("allow", "GET, HEAD");
  return new Response("Method not allowed.", { status: 405, headers });
};

const handle: APIRoute = async ({ params, locals }) => {
  const principal = locals.requestContext?.principal ?? locals.principal ?? null;
  if (!principal) {
    const headers = exportBaseHeaders();
    headers.set("location", "/sign-in?return=%2Fcreator");
    return new Response(null, {
      status: 303,
      headers,
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
        headers: exportBaseHeaders(),
      });
    }
    const headers = exportBaseHeaders();
    headers.set("content-type", "text/csv; charset=utf-8");
    headers.set(
      "content-disposition",
      `attachment; filename="${safeExportFilename(result.canonicalReference, "csv")}"`,
    );
    return new Response(serializeCsvExport(result.dataset), {
      status: 200,
      headers,
    });
  } catch {
    if (locals.requestContext) locals.requestContext.resultsLookupFailed = true;
    return new Response("Export unavailable.", {
      status: 500,
      headers: exportBaseHeaders(),
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
