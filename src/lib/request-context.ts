/**
 * Per-request context attached by delivery middleware.
 */

import type { SessionCsrfToken } from "./csrf";
import type { CreatorPrincipal } from "../modules/identity/index";

export type RequestContext = {
  requestId: string;
  startedAtMs: number;
  principal: CreatorPrincipal | null;
  csrfToken: SessionCsrfToken | null;
  sessionExpired: boolean;
  /** Set when the Better Auth session lookup itself failed (D1 error, missing
   * binding). The request degrades to signed-out; telemetry marks the record. */
  sessionLookupFailed: boolean;
};

export const REQUEST_CONTEXT_KEY = "requestContext" as const;
