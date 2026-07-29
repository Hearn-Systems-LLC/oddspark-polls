import { defineMiddleware, sequence } from "astro:middleware";
import {
  createRequestId,
  emitTelemetry,
} from "./adapters/telemetry/index";
import { checkCsrf } from "./lib/csrf";
import type { RequestContext } from "./lib/request-context";

/**
 * Single delivery middleware chain (AD-22):
 * 1. Request context + request ID
 * 2. CSRF / same-origin boundary before any handler
 * 3. Telemetry on completion
 *
 * Session extraction lands with Story 1.2.
 */

const requestContextMiddleware = defineMiddleware(async (context, next) => {
  const requestId =
    context.request.headers.get("cf-ray") ?? createRequestId();
  const startedAtMs = Date.now();

  const requestContext: RequestContext = {
    requestId,
    startedAtMs,
  };

  context.locals.requestContext = requestContext;

  return next();
});

const csrfMiddleware = defineMiddleware(async (context, next) => {
  const { request } = context;
  const result = checkCsrf({
    method: request.method,
    url: request.url,
    origin: request.headers.get("origin"),
    secFetchSite: request.headers.get("sec-fetch-site"),
  });

  if (!result.ok) {
    const requestId =
      context.locals.requestContext?.requestId ?? createRequestId();
    const startedAtMs =
      context.locals.requestContext?.startedAtMs ?? Date.now();

    emitTelemetry({
      requestId,
      operation: "csrf.check",
      result: "csrf_rejected",
      durationMs: Date.now() - startedAtMs,
      providerOutcome: "none",
    });

    return new Response("Forbidden", {
      status: 403,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "x-request-id": requestId,
      },
    });
  }

  return next();
});

const telemetryMiddleware = defineMiddleware(async (context, next) => {
  const response = await next();
  const rc = context.locals.requestContext;
  if (rc) {
    const status = response.status;
    const result =
      status >= 500 ? "error" : status === 404 ? "not_found" : "ok";

    emitTelemetry({
      requestId: rc.requestId,
      operation: `${context.request.method} ${new URL(context.request.url).pathname}`,
      result,
      durationMs: Date.now() - rc.startedAtMs,
      providerOutcome: "none",
    });
  }
  return response;
});

export const onRequest = sequence(
  requestContextMiddleware,
  csrfMiddleware,
  telemetryMiddleware,
);
