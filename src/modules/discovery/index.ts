// Discovery listing commands (Story 3.1): creator-controlled presentation
// state with an administrator-owned delisted guard (AD-5 / AD-19).
// Provider-free — D1 implements the ports; routes only map Results (AD-1).

import type {
  ApplicationError,
  Result,
} from "../../shared/application/index";
import {
  effectivePollStatus,
  type DiscoveryState,
  type PollId,
  type PollStatus,
  type PollType,
  type UserId,
} from "../../shared/domain/index";
import {
  hasAdministratorCapability,
  type CreatorPrincipal,
} from "../identity/index";

export const DISCOVERY_COPY = {
  unlistedDescription:
    "reachable only by link; absent from Discover and sitemaps",
  listedDescription:
    "appears on Discover and in sitemaps while the Poll is open",
  listingInvalid: "Pick a Discovery Setting.",
  delisted: "Delisted by the Administrator.",
  notFound: "This Poll doesn't exist.",
  editFailed: "That didn't save. Nothing changed — try again.",
  empty:
    "Nothing here yet. Polls appear when their Creators opt them in. Yours could be the first.",
  error:
    "The directory didn't load. Try again — everything that was on screen is still there.",
  newer: "NEWER",
  older: "OLDER",
  retry: "TRY AGAIN",
  createPrompt: "CREATE A POLL",
} as const;

export const DISCOVERY_PAGE_SIZE = 20;
export const SITEMAP_BATCH_SIZE = 1_000;
export const SITEMAP_SHARD_POLL_URLS = 45_000;
export const SITEMAP_MAX_URLS = 50_000;
export const SITEMAP_MAX_POLL_URLS = 49_998;
export const SITEMAP_MAX_PAGES = 500;
export const SITEMAP_MAX_BYTES = 50 * 1024 * 1024;
const DISCOVERY_CURSOR_VERSION = 1;
const MAX_DISCOVERY_CURSOR_LENGTH = 512;
const SITEMAP_RANGE_VERSION = 1;
const MAX_SITEMAP_RANGE_LENGTH = 1_024;
const UUID_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const LISTING_CHOICES = [
  {
    value: "unlisted",
    label: "UNLISTED",
    description: DISCOVERY_COPY.unlistedDescription,
  },
  {
    value: "listed",
    label: "LISTED",
    description: DISCOVERY_COPY.listedDescription,
  },
] as const;

export type CreatorListingState = Exclude<DiscoveryState, "delisted">;

export type OwnedPollListingSnapshot = {
  discoveryState: DiscoveryState;
};

export type LoadOwnedPollListingPort = (
  pollId: PollId,
  ownerUserId: UserId,
) => Promise<OwnedPollListingSnapshot | null>;

export type UpdateListingPort = (input: {
  pollId: PollId;
  ownerUserId: UserId;
  state: CreatorListingState;
  updatedAtMs: number;
}) => Promise<"updated" | "unchanged" | "delisted" | "not_found">;

export type SetPollListingDeps = {
  loadOwnedPoll: LoadOwnedPollListingPort;
  updateListing: UpdateListingPort;
  nowMs: () => number;
};

export type SetPollListingOutcome = {
  kind: "updated" | "unchanged";
  state: CreatorListingState;
};

export function parseListingDraft(value: string): CreatorListingState | null {
  if (value === "unlisted" || value === "listed") {
    return value;
  }
  return null;
}

function notFoundError(): ApplicationError {
  return { code: "poll_not_found", message: DISCOVERY_COPY.notFound };
}

function delistedError(): ApplicationError {
  return { code: "poll_delisted", message: DISCOVERY_COPY.delisted };
}

function persistenceFailed(pollId: PollId, cause: unknown): ApplicationError {
  console.error("poll_edit_failed", {
    pollId,
    cause: cause instanceof Error ? cause.message : String(cause),
  });
  return { code: "poll_edit_failed", message: DISCOVERY_COPY.editFailed };
}

export async function setPollListing(
  deps: SetPollListingDeps,
  pollId: PollId,
  ownerUserId: UserId,
  requested: CreatorListingState,
): Promise<Result<SetPollListingOutcome>> {
  let existing: OwnedPollListingSnapshot | null;
  try {
    existing = await deps.loadOwnedPoll(pollId, ownerUserId);
  } catch (cause) {
    return { ok: false, error: persistenceFailed(pollId, cause) };
  }
  if (!existing) {
    return { ok: false, error: notFoundError() };
  }
  if (existing.discoveryState === "delisted") {
    return { ok: false, error: delistedError() };
  }
  if (existing.discoveryState === requested) {
    return {
      ok: true,
      value: { kind: "unchanged", state: requested },
    };
  }

  let result: "updated" | "unchanged" | "delisted" | "not_found";
  try {
    // Listing is presentation, not a voter representation contribution.
    // AD-24's enumerated versioned writes exclude discovery transitions, so
    // this port updates updated_at_ms without a representation version input.
    result = await deps.updateListing({
      pollId,
      ownerUserId,
      state: requested,
      updatedAtMs: deps.nowMs(),
    });
  } catch (cause) {
    return { ok: false, error: persistenceFailed(pollId, cause) };
  }

  if (result === "not_found") {
    return { ok: false, error: notFoundError() };
  }
  if (result === "delisted") {
    return { ok: false, error: delistedError() };
  }
  return {
    ok: true,
    value: { kind: result, state: requested },
  };
}

export const MODERATION_COPY = {
  accessRequired: "Administrator access required.",
  lookupLabel: "POLL LINK OR REFERENCE",
  findPoll: "FIND POLL",
  invalidTarget: "Enter a valid Poll link or reference from this site.",
  invalidTransition: "This Poll isn't Delisted.",
  loadFailed: "The Poll couldn't be loaded. Try again.",
  delist: "DELIST",
  clearDelisted: "CLEAR DELISTED",
  delisted: "Poll delisted.",
  cleared: "Delisting cleared.",
  failed:
    "The moderation change couldn't be confirmed. Reload before trying again.",
} as const;

export type AdministratorModerationIntent = "delist" | "clear_delisted";

export type AdministratorModerationActor = Pick<
  CreatorPrincipal,
  "userId" | "role"
>;

export type ModerationPersistenceOutcome =
  | "updated"
  | "unchanged"
  | "not_found"
  | "authorization_denied"
  | "invalid_transition";

export type ApplyModerationPort = (input: {
  actorUserId: string;
  pollId: PollId;
  intent: AdministratorModerationIntent;
  updatedAtMs: number;
}) => Promise<ModerationPersistenceOutcome>;

export type ModeratePollDiscoveryDeps = {
  applyModeration: ApplyModerationPort;
  nowMs: () => number;
};

export type ModeratePollDiscoveryOutcome = {
  kind: "updated" | "unchanged";
  intent: AdministratorModerationIntent;
};

function moderationAuthorizationError(): ApplicationError {
  return {
    code: "authorization_denied",
    message: MODERATION_COPY.accessRequired,
  };
}

function moderationPersistenceFailed(): ApplicationError {
  return {
    code: "poll_moderation_failed",
    message: MODERATION_COPY.failed,
  };
}

/**
 * Discovery-owned Administrator command. The principal role is an early
 * capability check only; the persistence port must repeat it against live D1
 * truth inside the same transaction as the state transition.
 */
export async function moderatePollDiscovery(
  deps: ModeratePollDiscoveryDeps,
  actor: AdministratorModerationActor,
  pollId: PollId,
  intent: AdministratorModerationIntent,
): Promise<Result<ModeratePollDiscoveryOutcome>> {
  if (!hasAdministratorCapability(actor)) {
    return { ok: false, error: moderationAuthorizationError() };
  }

  let outcome: ModerationPersistenceOutcome;
  try {
    outcome = await deps.applyModeration({
      actorUserId: actor.userId,
      pollId,
      intent,
      updatedAtMs: deps.nowMs(),
    });
  } catch {
    return {
      ok: false,
      error: moderationPersistenceFailed(),
    };
  }

  if (outcome === "updated" || outcome === "unchanged") {
    return { ok: true, value: { kind: outcome, intent } };
  }
  if (outcome === "authorization_denied") {
    return { ok: false, error: moderationAuthorizationError() };
  }
  if (outcome === "not_found") {
    return { ok: false, error: notFoundError() };
  }
  return {
    ok: false,
    error: {
      code: "invalid_moderation_transition",
      message: MODERATION_COPY.invalidTransition,
    },
  };
}

export type ModerationTargetRecord = {
  pollId: PollId;
  question: string;
  canonicalReference: string;
  discoveryState: DiscoveryState;
  deadlineMs: number | null;
  closedAtMs: number | null;
};

export type ModerationTarget = ModerationTargetRecord & {
  status: PollStatus;
};

export type LoadModerationTargetPort = (
  reference: string,
) => Promise<ModerationTargetRecord | null>;

export type QueryModerationTargetDeps = {
  loadTarget: LoadModerationTargetPort;
  nowMs: () => number;
};

export async function queryModerationTarget(
  deps: QueryModerationTargetDeps,
  actor: AdministratorModerationActor,
  reference: string,
): Promise<Result<ModerationTarget>> {
  if (!hasAdministratorCapability(actor)) {
    return { ok: false, error: moderationAuthorizationError() };
  }

  let target: ModerationTargetRecord | null;
  try {
    target = await deps.loadTarget(reference);
  } catch {
    return {
      ok: false,
      error: {
        code: "poll_moderation_lookup_failed",
        message: MODERATION_COPY.loadFailed,
      },
    };
  }
  if (!target) {
    return { ok: false, error: notFoundError() };
  }
  return {
    ok: true,
    value: {
      ...target,
      status: effectivePollStatus(target, deps.nowMs()),
    },
  };
}

export type DiscoveryCursorDirection = "newer" | "older";

export type DiscoveryOrderKey = {
  createdAtMs: number;
  id: PollId;
};

export type DiscoveryCatalogRequest =
  | { direction: "initial" }
  | {
      direction: DiscoveryCursorDirection;
      cursor: string;
      boundary: DiscoveryOrderKey;
    };

/**
 * Purpose-shaped persistence record. The internal Poll ID exists only on the
 * query/cursor boundary and is stripped before the public projection leaves
 * this application service.
 */
export type DiscoveryCatalogRecord = DiscoveryOrderKey & {
  canonicalReference: string;
  question: string;
  pollType: PollType;
  voteCount: number;
  deadlineMs: number | null;
};

export type DiscoveryCatalogItem = Omit<DiscoveryCatalogRecord, "id"> & {
  status: "open";
};

export type DiscoveryCatalogPage = {
  items: DiscoveryCatalogItem[];
  newerUrl: string | null;
  olderUrl: string | null;
};

export type DiscoverySitemapRecord = DiscoveryOrderKey & {
  canonicalReference: string;
  deadlineMs: number | null;
};

export type DiscoverySitemapRange = {
  startExclusive: DiscoveryOrderKey | null;
  endInclusive: DiscoveryOrderKey;
};

export type DiscoverySitemapRequest =
  | { kind: "root" }
  | { kind: "range"; range: DiscoverySitemapRange };

export type DiscoverySitemapPersistencePort = {
  querySitemapPage: (input: {
    startExclusive: DiscoveryOrderKey | null;
    endInclusive: DiscoveryOrderKey | null;
    limit: number;
    nowMs: number;
  }) => Promise<DiscoverySitemapRecord[]>;
};

export type DiscoverySitemapBuild = {
  xml: string;
  pollUrlCount: number;
  pageCount: number;
};

export type DiscoverySitemapBuildResult =
  | { ok: true; value: DiscoverySitemapBuild }
  | {
      ok: false;
      error: {
        code:
          | "sitemap_capacity_exceeded"
          | "sitemap_generation_aborted"
          | "sitemap_range_gone";
      };
    };

export type DiscoveryCatalogPersistencePort = {
  readRevision: () => Promise<number | null>;
  queryCatalogPage: (input: {
    direction: DiscoveryCatalogRequest["direction"];
    boundary: DiscoveryOrderKey | null;
    limit: number;
    nowMs: number;
  }) => Promise<DiscoveryCatalogRecord[]>;
};

export type DiscoveryCatalogCachePort = {
  get: (input: {
    revision: number;
    request: DiscoveryCatalogRequest;
    nowMs: number;
  }) => Promise<DiscoveryCatalogPage | null>;
  put: (input: {
    revision: number;
    request: DiscoveryCatalogRequest;
    page: DiscoveryCatalogPage;
    nowMs: number;
  }) => Promise<void>;
};

export type QueryDiscoveryCatalogDeps = {
  persistence: DiscoveryCatalogPersistencePort;
  cache: DiscoveryCatalogCachePort;
};

type EncodedCursor = {
  v: typeof DISCOVERY_CURSOR_VERSION;
  d: DiscoveryCursorDirection;
  t: number;
  i: string;
};

type EncodedSitemapOrderKey = { t: number; i: string };

type EncodedSitemapRange = {
  v: typeof SITEMAP_RANGE_VERSION;
  s: EncodedSitemapOrderKey | null;
  e: EncodedSitemapOrderKey;
};

function invalidCursorError(): ApplicationError {
  return {
    code: "invalid_discovery_cursor",
    message: DISCOVERY_COPY.error,
  };
}

function catalogUnavailableError(): ApplicationError {
  return {
    code: "discovery_catalog_unavailable",
    message: DISCOVERY_COPY.error,
  };
}

function toBase64Url(value: string): string {
  return btoa(value)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function fromBase64Url(value: string): string {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new Error("invalid base64url");
  }
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  return atob(base64 + padding);
}

export function encodeDiscoveryCursor(
  direction: DiscoveryCursorDirection,
  boundary: DiscoveryOrderKey,
): string {
  const payload: EncodedCursor = {
    v: DISCOVERY_CURSOR_VERSION,
    d: direction,
    t: boundary.createdAtMs,
    i: boundary.id,
  };
  return toBase64Url(JSON.stringify(payload));
}

function validSitemapOrderKey(value: unknown): value is DiscoveryOrderKey {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const key = value as Record<string, unknown>;
  return (
    Number.isSafeInteger(key.createdAtMs) &&
    (key.createdAtMs as number) >= 0 &&
    typeof key.id === "string" &&
    UUID_SHAPE.test(key.id)
  );
}

function encodedSitemapOrderKey(
  key: DiscoveryOrderKey,
): EncodedSitemapOrderKey {
  return { t: key.createdAtMs, i: key.id };
}

function decodeSitemapOrderKey(value: unknown): DiscoveryOrderKey | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const key = value as Record<string, unknown>;
  if (Object.keys(key).sort().join(",") !== "i,t") return null;
  const decoded = { createdAtMs: key.t, id: key.i };
  return validSitemapOrderKey(decoded)
    ? (decoded as DiscoveryOrderKey)
    : null;
}

function compareOrderKeys(
  left: DiscoveryOrderKey,
  right: DiscoveryOrderKey,
): number {
  if (left.createdAtMs !== right.createdAtMs) {
    return left.createdAtMs < right.createdAtMs ? -1 : 1;
  }
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

export function encodeDiscoverySitemapRange(
  range: DiscoverySitemapRange,
): string {
  if (
    (range.startExclusive !== null &&
      !validSitemapOrderKey(range.startExclusive)) ||
    !validSitemapOrderKey(range.endInclusive) ||
    (range.startExclusive !== null &&
      compareOrderKeys(range.startExclusive, range.endInclusive) <= 0)
  ) {
    throw new Error("Invalid sitemap range");
  }
  const payload: EncodedSitemapRange = {
    v: SITEMAP_RANGE_VERSION,
    s:
      range.startExclusive === null
        ? null
        : encodedSitemapOrderKey(range.startExclusive),
    e: encodedSitemapOrderKey(range.endInclusive),
  };
  return toBase64Url(JSON.stringify(payload));
}

function decodeDiscoverySitemapRange(
  value: string,
): DiscoverySitemapRange | null {
  if (value.length === 0 || value.length > MAX_SITEMAP_RANGE_LENGTH) return null;
  try {
    const parsed: unknown = JSON.parse(fromBase64Url(value));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const payload = parsed as Record<string, unknown>;
    if (Object.keys(payload).sort().join(",") !== "e,s,v") return null;
    if (payload.v !== SITEMAP_RANGE_VERSION) return null;
    const startExclusive =
      payload.s === null ? null : decodeSitemapOrderKey(payload.s);
    const endInclusive = decodeSitemapOrderKey(payload.e);
    if (
      (payload.s !== null && startExclusive === null) ||
      endInclusive === null ||
      (startExclusive !== null &&
        compareOrderKeys(startExclusive, endInclusive) <= 0)
    ) {
      return null;
    }
    const range = { startExclusive, endInclusive };
    return encodeDiscoverySitemapRange(range) === value ? range : null;
  } catch {
    return null;
  }
}

function invalidSitemapRangeError(): ApplicationError {
  return {
    code: "invalid_sitemap_range",
    message: "Invalid sitemap range.",
  };
}

export function parseDiscoverySitemapRequest(
  searchParams: URLSearchParams,
): Result<DiscoverySitemapRequest> {
  if ([...searchParams].length === 0) {
    return { ok: true, value: { kind: "root" } };
  }
  const values = searchParams.getAll("range");
  if ([...searchParams].length !== 1 || values.length !== 1) {
    return { ok: false, error: invalidSitemapRangeError() };
  }
  const range = decodeDiscoverySitemapRange(values[0] as string);
  return range
    ? { ok: true, value: { kind: "range", range } }
    : { ok: false, error: invalidSitemapRangeError() };
}

function decodeDiscoveryCursor(
  value: string,
  expectedDirection: DiscoveryCursorDirection,
): DiscoveryOrderKey | null {
  if (value.length === 0 || value.length > MAX_DISCOVERY_CURSOR_LENGTH) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(fromBase64Url(value));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const payload = parsed as Record<string, unknown>;
    const keys = Object.keys(payload).sort();
    if (keys.join(",") !== "d,i,t,v") {
      return null;
    }
    if (
      payload.v !== DISCOVERY_CURSOR_VERSION ||
      payload.d !== expectedDirection ||
      !Number.isSafeInteger(payload.t) ||
      (payload.t as number) < 0 ||
      typeof payload.i !== "string" ||
      !UUID_SHAPE.test(payload.i)
    ) {
      return null;
    }
    return {
      createdAtMs: payload.t as number,
      id: payload.i as PollId,
    };
  } catch {
    return null;
  }
}

export function parseDiscoveryRequest(
  searchParams: URLSearchParams,
): Result<DiscoveryCatalogRequest> {
  const newer = searchParams.getAll("newer");
  const older = searchParams.getAll("older");
  if (newer.length === 0 && older.length === 0) {
    return { ok: true, value: { direction: "initial" } };
  }
  if (
    newer.length > 1 ||
    older.length > 1 ||
    (newer.length === 1 && older.length === 1)
  ) {
    return { ok: false, error: invalidCursorError() };
  }

  const direction: DiscoveryCursorDirection =
    newer.length === 1 ? "newer" : "older";
  const cursor = (newer[0] ?? older[0]) as string;
  const boundary = decodeDiscoveryCursor(cursor, direction);
  if (!boundary) {
    return { ok: false, error: invalidCursorError() };
  }
  return {
    ok: true,
    value: { direction, cursor, boundary },
  };
}

function pageUrl(
  direction: DiscoveryCursorDirection,
  record: DiscoveryCatalogRecord,
): string {
  const cursor = encodeDiscoveryCursor(direction, record);
  return `/discover?${direction}=${encodeURIComponent(cursor)}`;
}

function publicItem(record: DiscoveryCatalogRecord): DiscoveryCatalogItem {
  return {
    canonicalReference: record.canonicalReference,
    question: record.question,
    pollType: record.pollType,
    voteCount: record.voteCount,
    deadlineMs: record.deadlineMs,
    createdAtMs: record.createdAtMs,
    status: "open",
  };
}

function buildCatalogPage(
  request: DiscoveryCatalogRequest,
  fetched: DiscoveryCatalogRecord[],
): DiscoveryCatalogPage {
  const hasSentinel = fetched.length > DISCOVERY_PAGE_SIZE;
  const bounded = fetched.slice(0, DISCOVERY_PAGE_SIZE);
  const displayed =
    request.direction === "newer" ? bounded.toReversed() : bounded;
  const first = displayed[0];
  const last = displayed.at(-1);

  return {
    items: displayed.map(publicItem),
    newerUrl:
      first &&
      (request.direction === "older" ||
        (request.direction === "newer" && hasSentinel))
        ? pageUrl("newer", first)
        : null,
    olderUrl:
      last &&
      (request.direction === "newer" ||
        ((request.direction === "initial" || request.direction === "older") &&
          hasSentinel))
        ? pageUrl("older", last)
        : null,
  };
}

export async function queryDiscoveryCatalog(
  deps: QueryDiscoveryCatalogDeps,
  request: DiscoveryCatalogRequest,
  nowMs: number,
): Promise<Result<DiscoveryCatalogPage>> {
  let revision: number | null;
  try {
    revision = await deps.persistence.readRevision();
  } catch {
    return { ok: false, error: catalogUnavailableError() };
  }
  if (!Number.isSafeInteger(revision) || (revision as number) < 1) {
    return { ok: false, error: catalogUnavailableError() };
  }

  try {
    const cached = await deps.cache.get({
      revision: revision as number,
      request,
      nowMs,
    });
    if (cached) {
      return { ok: true, value: cached };
    }
  } catch {
    // Cache is a fail-open optimization; D1 remains the catalog truth.
  }

  let fetched: DiscoveryCatalogRecord[];
  try {
    fetched = await deps.persistence.queryCatalogPage({
      direction: request.direction,
      boundary: request.direction === "initial" ? null : request.boundary,
      limit: DISCOVERY_PAGE_SIZE + 1,
      nowMs,
    });
  } catch {
    return { ok: false, error: catalogUnavailableError() };
  }

  const page = buildCatalogPage(request, fetched);
  try {
    await deps.cache.put({
      revision: revision as number,
      request,
      page,
      nowMs,
    });
  } catch {
    // Population failure must not make a successful D1 read unavailable.
  }
  return { ok: true, value: page };
}

function sitemapCapacityExceeded(): DiscoverySitemapBuildResult {
  return { ok: false, error: { code: "sitemap_capacity_exceeded" } };
}

function sitemapGenerationAborted(): DiscoverySitemapBuildResult {
  return { ok: false, error: { code: "sitemap_generation_aborted" } };
}

function sitemapRangeGone(): DiscoverySitemapBuildResult {
  return { ok: false, error: { code: "sitemap_range_gone" } };
}

function escapeXmlText(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&apos;";
    }
  });
}

export function renderDiscoverySitemapXml(
  urls: readonly string[],
  maxBytes = SITEMAP_MAX_BYTES,
): DiscoverySitemapBuildResult {
  if (urls.length > SITEMAP_MAX_URLS) return sitemapCapacityExceeded();
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map((url) => `  <url><loc>${escapeXmlText(url)}</loc></url>`),
    "</urlset>",
    "",
  ].join("\n");

  if (new TextEncoder().encode(xml).byteLength > maxBytes) {
    return sitemapCapacityExceeded();
  }
  return {
    ok: true,
    value: { xml, pollUrlCount: 0, pageCount: 0 },
  };
}

export function renderDiscoverySitemapIndexXml(
  urls: readonly string[],
  maxBytes = SITEMAP_MAX_BYTES,
): DiscoverySitemapBuildResult {
  if (urls.length > SITEMAP_MAX_URLS) return sitemapCapacityExceeded();
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map((url) => `  <sitemap><loc>${escapeXmlText(url)}</loc></sitemap>`),
    "</sitemapindex>",
    "",
  ].join("\n");
  if (new TextEncoder().encode(xml).byteLength > maxBytes) {
    return sitemapCapacityExceeded();
  }
  return {
    ok: true,
    value: { xml, pollUrlCount: 0, pageCount: 0 },
  };
}

const SITEMAP_ABORTED = Symbol("sitemap-aborted");

async function waitForSitemapPage<T>(
  pending: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T | typeof SITEMAP_ABORTED> {
  if (!signal) return pending;
  if (signal.aborted) return SITEMAP_ABORTED;
  return new Promise<T | typeof SITEMAP_ABORTED>((resolve, reject) => {
    const abort = () => resolve(SITEMAP_ABORTED);
    signal.addEventListener("abort", abort, { once: true });
    pending.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", abort);
    });
  });
}

export type DiscoverySitemapBuildOptions = {
  request?: DiscoverySitemapRequest;
  signal?: AbortSignal;
  deadlineAtMs?: number;
  clock?: () => number;
};

function sitemapBuildExpired(options: DiscoverySitemapBuildOptions): boolean {
  if (options.signal?.aborted) return true;
  if (options.deadlineAtMs === undefined) return false;
  const clock = options.clock ?? Date.now;
  return clock() >= options.deadlineAtMs;
}

export async function buildDiscoverySitemap(
  persistence: DiscoverySitemapPersistencePort,
  requestUrl: URL,
  nowMs: number,
  options: DiscoverySitemapBuildOptions = {},
): Promise<DiscoverySitemapBuildResult> {
  const origin = requestUrl.origin;
  const request = options.request ?? { kind: "root" };
  const pollUrls: string[] = [];
  const ranges: DiscoverySitemapRange[] = [];
  const initialStart =
    request.kind === "range" ? request.range.startExclusive : null;
  const endInclusive =
    request.kind === "range" ? request.range.endInclusive : null;
  let boundary = initialStart;
  let rangeStart: DiscoveryOrderKey | null = null;
  let rangeCount = 0;
  let totalPolls = 0;
  let lastRecord: DiscoverySitemapRecord | null = null;
  let pageCount = 0;

  while (pageCount < SITEMAP_MAX_PAGES) {
    if (sitemapBuildExpired(options)) return sitemapGenerationAborted();
    let waited: DiscoverySitemapRecord[] | typeof SITEMAP_ABORTED;
    try {
      waited = await waitForSitemapPage(
        persistence.querySitemapPage({
          startExclusive: boundary,
          endInclusive,
          limit: SITEMAP_BATCH_SIZE + 1,
          nowMs,
        }),
        options.signal,
      );
    } catch (cause) {
      if (sitemapBuildExpired(options)) return sitemapGenerationAborted();
      throw cause;
    }
    if (waited === SITEMAP_ABORTED || sitemapBuildExpired(options)) {
      return sitemapGenerationAborted();
    }
    const rows = waited;
    pageCount += 1;
    if (rows.length > SITEMAP_BATCH_SIZE + 1) {
      return sitemapCapacityExceeded();
    }

    const page = rows.slice(0, SITEMAP_BATCH_SIZE);
    for (const record of page) {
      totalPolls += 1;
      lastRecord = record;
      if (request.kind === "range") {
        const maximumPolls =
          request.range.startExclusive === null
            ? SITEMAP_MAX_POLL_URLS
            : SITEMAP_MAX_URLS;
        if (totalPolls > maximumPolls) return sitemapCapacityExceeded();
        pollUrls.push(
          `${origin}/${encodeURIComponent(record.canonicalReference)}`,
        );
      } else {
        if (totalPolls <= SITEMAP_SHARD_POLL_URLS) {
          pollUrls.push(
            `${origin}/${encodeURIComponent(record.canonicalReference)}`,
          );
        } else if (totalPolls === SITEMAP_SHARD_POLL_URLS + 1) {
          pollUrls.length = 0;
        }
        rangeCount += 1;
        if (rangeCount === SITEMAP_SHARD_POLL_URLS) {
          ranges.push({ startExclusive: rangeStart, endInclusive: record });
          rangeStart = record;
          rangeCount = 0;
        }
      }
    }
    if (sitemapBuildExpired(options)) return sitemapGenerationAborted();

    if (rows.length <= SITEMAP_BATCH_SIZE) {
      if (request.kind === "root" && totalPolls > SITEMAP_SHARD_POLL_URLS) {
        if (rangeCount > 0 && lastRecord !== null) {
          ranges.push({ startExclusive: rangeStart, endInclusive: lastRecord });
        }
        const childUrls = ranges.map((range) => {
          const token = encodeDiscoverySitemapRange(range);
          return `${origin}/sitemap.xml?range=${encodeURIComponent(token)}`;
        });
        if (sitemapBuildExpired(options)) return sitemapGenerationAborted();
        const rendered = renderDiscoverySitemapIndexXml(childUrls);
        if (sitemapBuildExpired(options)) return sitemapGenerationAborted();
        return rendered.ok
          ? {
              ok: true,
              value: {
                ...rendered.value,
                pollUrlCount: totalPolls,
                pageCount,
              },
            }
          : rendered;
      }
      if (
        request.kind === "range" &&
        request.range.startExclusive !== null &&
        totalPolls === 0
      ) {
        return sitemapRangeGone();
      }
      const staticUrls =
        request.kind === "root" || request.range.startExclusive === null
          ? [`${origin}/`, `${origin}/discover`]
          : [];
      if (sitemapBuildExpired(options)) return sitemapGenerationAborted();
      const rendered = renderDiscoverySitemapXml([...staticUrls, ...pollUrls]);
      if (sitemapBuildExpired(options)) return sitemapGenerationAborted();
      return rendered.ok
        ? {
            ok: true,
            value: {
              ...rendered.value,
              pollUrlCount: totalPolls,
              pageCount,
            },
          }
        : rendered;
    }
    boundary = page.at(-1) ?? null;
  }

  return sitemapCapacityExceeded();
}
