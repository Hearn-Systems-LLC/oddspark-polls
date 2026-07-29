/**
 * Per-request context attached by delivery middleware.
 * Session extraction lands with Story 1.2.
 */

export type RequestContext = {
  requestId: string;
  startedAtMs: number;
};

export const REQUEST_CONTEXT_KEY = "requestContext" as const;
