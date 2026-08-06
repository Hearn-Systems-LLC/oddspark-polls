import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { serializeXlsxExport } from "../../../../adapters/xlsx/index";
import { queryD1BoundedOwnerExport } from "../../../../lib/export-delivery";
import {
  exportBaseHeaders,
  safeExportFilename,
} from "../../../../lib/export-http";
import type { PollId, UserId } from "../../../../shared/domain/index";

export const XLSX_OVERSIZE_MESSAGE =
  "XLSX export supports up to 1,000 accepted votes. Download CSV for larger Polls.";

function responseForRequest(
  request: Request,
  body: BodyInit | null,
  init: ResponseInit,
): Response {
  return new Response(request.method === "HEAD" ? null : body, init);
}

export const ALL: APIRoute = () => {
  const headers = exportBaseHeaders();
  headers.set("allow", "GET, HEAD");
  return new Response("Method not allowed.", { status: 405, headers });
};

export function createXlsxExportHandler(
  serialize: typeof serializeXlsxExport = serializeXlsxExport,
): APIRoute {
  return async ({ request, params, locals }) => {
    const principal =
      locals.requestContext?.principal ?? locals.principal ?? null;
    if (!principal) {
      const headers = exportBaseHeaders();
      headers.set("location", "/sign-in?return=%2Fcreator");
      return new Response(null, { status: 303, headers });
    }

    const pollId = (params.pollId ?? "") as PollId;
    try {
      const result = await queryD1BoundedOwnerExport(env.DB, pollId, {
        userId: principal.userId as UserId,
      });
      if (!result) {
        return responseForRequest(request, "Not found.", {
          status: 404,
          headers: exportBaseHeaders(),
        });
      }
      if (result.status === "oversize") {
        return responseForRequest(request, XLSX_OVERSIZE_MESSAGE, {
          status: 409,
          headers: exportBaseHeaders(),
        });
      }

      const headers = exportBaseHeaders();
      headers.set(
        "content-type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      headers.set(
        "content-disposition",
        `attachment; filename="${safeExportFilename(result.export.canonicalReference, "xlsx")}"`,
      );
      if (request.method === "HEAD") {
        return new Response(null, { status: 200, headers });
      }
      const body = await serialize(result.export.dataset);
      return responseForRequest(request, body, { status: 200, headers });
    } catch {
      if (locals.requestContext) {
        locals.requestContext.resultsLookupFailed = true;
      }
      return responseForRequest(request, "Export unavailable.", {
        status: 500,
        headers: exportBaseHeaders(),
      });
    }
  };
}

const handle = createXlsxExportHandler();

export const GET: APIRoute = handle;
export const HEAD: APIRoute = handle;
