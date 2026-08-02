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
  /** Internal Poll ID for AD-15 correlation; never a public reference. */
  pollId: string | null;
  sessionExpired: boolean;
  /** Set when the Better Auth session lookup itself failed (D1 error, missing
   * binding). The request degrades to signed-out; telemetry marks the record. */
  sessionLookupFailed: boolean;
  /** Set when the read-only vote surface cannot resolve its authorized Results
   * view. The committed vote outcome still renders; telemetry marks the one
   * existing request record as an error. */
  resultsLookupFailed: boolean;
  /** Set by the vote page when it assigns a 422/429 vote-rejection outcome.
   * Only then does telemetry record 422/429 as an error — a creator-surface
   * validation 422 keeps its ordinary "ok" semantics. */
  voteRejection: boolean;
};

export const REQUEST_CONTEXT_KEY = "requestContext" as const;
