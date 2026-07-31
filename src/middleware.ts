import { defineMiddleware, sequence } from "astro:middleware";
import { env as workerEnv } from "cloudflare:workers";
import { createAuth } from "./adapters/auth/index";
import {
  classifyAuthProviderOutcome,
  createRequestId,
  emitTelemetry,
  telemetryResultForStatus,
} from "./adapters/telemetry/index";
import {
  checkCsrf,
  createSessionCsrfToken,
  isBetterAuthMountPath,
  readRequestCsrfToken,
} from "./lib/csrf";
import type { RequestContext } from "./lib/request-context";
import {
  isCreatorSurfacePath,
  validateReturnAddress,
  type CreatorPrincipal,
} from "./modules/identity/index";

/**
 * Single delivery middleware chain (AD-22):
 * 1. Request context + request ID
 * 2. Better Auth session extraction
 * 3. CSRF / same-origin boundary before any handler
 * 4. Creator-surface authentication guard
 * 5. Telemetry on completion
 */

const SESSION_COOKIE_PATTERN =
  /(?:^|;\s*)(?:__Secure-)?better-auth\.session_token=[^;\s]+/u;
const CREATOR_SESSION_MARKER_COOKIE = "oddspark.creator_session_seen";
const CREATOR_SESSION_MARKER_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function escapeRegExpLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const CREATOR_SESSION_MARKER_PATTERN = new RegExp(
  `(?:^|;\\s*)${escapeRegExpLiteral(CREATOR_SESSION_MARKER_COOKIE)}=1(?:;|$)`,
  "u",
);

function hasSessionCookie(headers: Headers): boolean {
  return SESSION_COOKIE_PATTERN.test(headers.get("cookie") ?? "");
}

function hasCreatorSessionMarker(headers: Headers): boolean {
  return CREATOR_SESSION_MARKER_PATTERN.test(headers.get("cookie") ?? "");
}

function creatorSessionMarkerCookie(
  requestUrl: string,
  expired = false,
): string {
  const secure = new URL(requestUrl).protocol === "https:" ? "; Secure" : "";
  if (expired) {
    return `${CREATOR_SESSION_MARKER_COOKIE}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax${secure}`;
  }

  return `${CREATOR_SESSION_MARKER_COOKIE}=1; Path=/; Max-Age=${CREATOR_SESSION_MARKER_MAX_AGE_SECONDS}; HttpOnly; SameSite=Lax${secure}`;
}

function appendResponseCookie(response: Response, cookie: string): Response {
  try {
    response.headers.append("set-cookie", cookie);
    return response;
  } catch {
    const headers = new Headers(response.headers);
    headers.append("set-cookie", cookie);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
}

function appendAuthCookies(response: Response, headers: Headers): Response {
  let finalResponse = response;
  for (const cookie of headers.getSetCookie()) {
    finalResponse = appendResponseCookie(finalResponse, cookie);
  }
  return finalResponse;
}

const requestContextMiddleware = defineMiddleware(async (context, next) => {
  const requestId =
    context.request.headers.get("cf-ray") ?? createRequestId();
  const startedAtMs = Date.now();

  const requestContext: RequestContext = {
    requestId,
    startedAtMs,
    principal: null,
    csrfToken: null,
    pollId: null,
    sessionExpired: false,
    sessionLookupFailed: false,
  };

  context.locals.requestContext = requestContext;
  context.locals.principal = null;

  return next();
});

const sessionMiddleware = defineMiddleware(async (context, next) => {
  const requestContext = context.locals.requestContext;
  if (!requestContext) {
    return next();
  }

  if (!hasSessionCookie(context.request.headers)) {
    requestContext.sessionExpired = hasCreatorSessionMarker(
      context.request.headers,
    );
    return next();
  }

  const lookupSession = () =>
    createAuth(workerEnv).api.getSession({
      headers: context.request.headers,
      returnHeaders: true,
    });
  let authResult: Awaited<ReturnType<typeof lookupSession>> | null = null;
  try {
    authResult = await lookupSession();
  } catch {
    // A failed auth lookup (missing binding, D1 error) must degrade to
    // signed-out, not 500 every route for cookie-bearing visitors. Flag it so
    // the outer telemetry record marks this request as an error — one record
    // per request, no double emission.
    requestContext.sessionLookupFailed = true;
  }
  const authData = authResult?.response ?? null;

  if (authData) {
    const principal: CreatorPrincipal = {
      userId: authData.user.id,
      session: authData.session,
    };
    requestContext.principal = principal;
    requestContext.csrfToken = await createSessionCsrfToken(
      authData.session.id,
      workerEnv.BETTER_AUTH_SECRET,
    );
    context.locals.principal = principal;
  } else if (!requestContext.sessionLookupFailed) {
    // Definitive "session invalid" — only when the lookup itself succeeded.
    // A failed lookup leaves session state unknown; showing the expiry line
    // then would be wrong.
    requestContext.sessionExpired = true;
  }

  const pathname = new URL(context.request.url).pathname;
  const isSignOutRequest =
    pathname === "/api/auth/sign-out" &&
    context.request.method.toUpperCase() === "POST";
  let response = await next();

  // A sign-out response owns the session-cookie deletion. Appending refresh
  // headers from the preceding getSession call could otherwise restore it.
  // The same hazard applies to every Better Auth handler route — they manage
  // their own cookies, so never append getSession headers on the mount path.
  if (!isSignOutRequest && !isBetterAuthMountPath(pathname) && authResult) {
    response = appendAuthCookies(response, authResult.headers);
  }

  if (isSignOutRequest) {
    return appendResponseCookie(
      response,
      creatorSessionMarkerCookie(context.request.url, true),
    );
  }
  if (authData) {
    return appendResponseCookie(
      response,
      creatorSessionMarkerCookie(context.request.url),
    );
  }
  return response;
});

const csrfMiddleware = defineMiddleware(async (context, next) => {
  const { request } = context;
  const pathname = new URL(request.url).pathname;
  const isAuthenticatedMutation =
    Boolean(context.locals.principal) &&
    !SAFE_METHODS.has(request.method.toUpperCase()) &&
    (isCreatorSurfacePath(pathname) ||
      pathname === "/admin" ||
      pathname.startsWith("/admin/"));
  const csrfToken = isAuthenticatedMutation
    ? await readRequestCsrfToken(request)
    : null;
  const result = checkCsrf({
    method: request.method,
    url: request.url,
    origin: request.headers.get("origin"),
    secFetchSite: request.headers.get("sec-fetch-site"),
    csrfToken,
    expectedCsrfToken:
      context.locals.requestContext?.csrfToken?.value ?? null,
    requireSessionToken: isAuthenticatedMutation,
  });

  if (!result.ok) {
    const requestId =
      context.locals.requestContext?.requestId ?? createRequestId();

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

const creatorGuardMiddleware = defineMiddleware(async (context, next) => {
  const url = new URL(context.request.url);
  if (!isCreatorSurfacePath(url.pathname) || context.locals.principal) {
    return next();
  }

  const returnAddress = validateReturnAddress(`${url.pathname}${url.search}`);
  const params = new URLSearchParams({ return: returnAddress });
  if (context.locals.requestContext?.sessionExpired) {
    params.set("reason", "expired");
  }

  let response = new Response(null, {
    status: 303,
    headers: {
      location: `/sign-in?${params.toString()}`,
    },
  });
  if (context.locals.requestContext?.sessionExpired) {
    response = appendResponseCookie(
      response,
      creatorSessionMarkerCookie(context.request.url, true),
    );
  }
  return response;
});

const telemetryMiddleware = defineMiddleware(async (context, next) => {
  const rc = context.locals.requestContext;
  const pathname = new URL(context.request.url).pathname;
  try {
    const response = await next();
    if (rc) {
      // Surface the request ID on every response so users can report it.
      // Responses with immutable headers (e.g. Response.redirect()) are
      // cloned instead of throwing — which would double-emit via catch.
      let finalResponse = response;
      try {
        response.headers.set("x-request-id", rc.requestId);
      } catch {
        const headers = new Headers(response.headers);
        headers.set("x-request-id", rc.requestId);
        finalResponse = new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      }

      const status = response.status;
      const result = telemetryResultForStatus(status, rc.sessionLookupFailed);

      emitTelemetry({
        requestId: rc.requestId,
        operation: `${context.request.method} ${pathname}`,
        result,
        durationMs: Date.now() - rc.startedAtMs,
        providerOutcome: classifyAuthProviderOutcome(
          pathname,
          status,
          response.headers.get("location"),
        ),
        pollId: rc.pollId,
      });

      return finalResponse;
    }
    return response;
  } catch (error) {
    // One record per operation, even when the handler throws.
    if (rc) {
      emitTelemetry({
        requestId: rc.requestId,
        operation: `${context.request.method} ${pathname}`,
        result: "error",
        durationMs: Date.now() - rc.startedAtMs,
        providerOutcome: classifyAuthProviderOutcome(pathname, 500, null),
        pollId: rc.pollId,
      });
    }
    throw error;
  }
});

export const onRequest = sequence(
  requestContextMiddleware,
  telemetryMiddleware,
  sessionMiddleware,
  csrfMiddleware,
  creatorGuardMiddleware,
);
