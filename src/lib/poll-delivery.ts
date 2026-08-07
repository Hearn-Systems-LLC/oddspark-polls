import { z } from "zod";
import {
  createPollPersistence,
  createResultsPersistence,
  createVotePersistence,
  type PollPage,
} from "../adapters/d1/index";
import {
  VOTER_COOKIE_MAX_AGE_SECONDS,
  VOTER_COOKIE_NAME,
  createVoteDigest,
  createVoterToken,
  sha256Hex,
} from "../adapters/digest/index";
import { allowVoteSubmission } from "../adapters/rate-limit/index";
import {
  verifyTurnstileToken,
  type HumanChallengeProof,
} from "../adapters/turnstile/index";
import { selectCloudflareClientAddress } from "./cloudflare-client-address";
import { isReservedSlug } from "../modules/polls/reserved-slugs";
import {
  isCustomSlugCaseVariant,
  isUuidShape,
  POLL_CAPS,
} from "../modules/polls/index";
import { votingStrategyFor } from "../modules/polls/types/registry";
import type { RankedPreferenceInput } from "../modules/polls/types/ranked-choice";
import { toggleRankedPreference } from "../modules/voting/rank-draft";
import { COMMENT_CAPS } from "../modules/comments/index";
import {
  queryResults,
  RESULTS_COPY,
  type RankedTallyView,
  type ResultsTallyView,
  type ResultsView,
} from "../modules/results/index";
import type {
  CommentView,
  OwnerCommentView,
} from "../modules/comments/index";
import { resolveAuthorizedBallotLabels } from "../modules/results/post-vote";
import {
  VOTE_COPY,
  asVoteRateLimitDigest,
  asVoterClaimDigest,
  castVote,
  type CastVoteInput,
  type VoteApplicationError,
  type VoteRateLimitDigest,
  type VoterClaimDigest,
} from "../modules/voting/index";
import {
  effectivePollStatus,
  makeSecurityToggles,
  type PollOptionId,
  type PollSecurityToggles,
  type PollStatus,
  type PollType,
  type UserId,
} from "../shared/domain/index";
import type { RequestContext } from "./request-context";

export const VOTE_FLASH_COOKIE_NAME = "oddspark.vote_flash";

class UnreadableVoteFormError extends Error {}

function singletonText(formData: FormData, name: string): string {
  const values = formData.getAll(name);
  if (
    values.length > 1 ||
    values.some((value) => typeof value !== "string")
  ) {
    throw new UnreadableVoteFormError();
  }
  return typeof values[0] === "string" ? values[0] : "";
}

function boundedInvalidEcho(value: string, limit: number): string {
  // Preserve ordinary invalid input for correction, but never reflect an
  // attacker-sized multipart value into a correspondingly large HTML page.
  return value.length <= limit * 2 + 2 ? value : "x".repeat(limit + 1);
}

export type DeliveryCookieEffect =
  | {
      kind: "set";
      name: string;
      value: string;
      options: {
        httpOnly: true;
        maxAge: number;
        path: "/";
        sameSite: "lax";
        secure: boolean;
      };
    }
  | { kind: "delete"; name: string; options: { path: "/" } };

export function serializeDeliveryCookieEffect(
  effect: DeliveryCookieEffect,
): string {
  if (effect.kind === "delete") {
    return `${effect.name}=; Path=${effect.options.path}; Max-Age=0; HttpOnly; SameSite=Lax`;
  }
  return `${effect.name}=${effect.value}; Path=${effect.options.path}; Max-Age=${effect.options.maxAge}; HttpOnly; SameSite=Lax${effect.options.secure ? "; Secure" : ""}`;
}

export type DeliveryResponse = {
  body: string | null;
  status: number;
  headers: Record<string, string>;
};

export type VoteOutcomeView = {
  body: string;
  code: string;
  heading: string;
  time: { placeholder: "{deadline}" | "{when}"; timestampMs: number } | null;
  titlePrefix: string;
  tone: "confirmation" | "rejection";
};

export type ResultsExplanationView = {
  body: string;
  time: VoteOutcomeView["time"];
};

export type PostVoteResultsView =
  | {
      kind: "visible";
      status: PollStatus;
      tally: ResultsTallyView;
      comments: CommentView[];
      ownerComments: OwnerCommentView[] | null;
      validator: string;
    }
  | {
      kind: "ranked_visible";
      status: PollStatus;
      ranked: RankedTallyView;
      validator: string;
    }
  | ({
      kind: "after_close_hidden" | "creator_only_hidden" | "unavailable";
    } & ResultsExplanationView);

export type PollDeliveryState = {
  poll: PollPage;
  submissionId: string;
  selectedOptionIds: string[];
  rankedPreferences: RankedPreferenceInput[];
  outcome: VoteOutcomeView | null;
  readOnly: boolean;
  actionDisabled: boolean;
  postVoteResults: PostVoteResultsView | null;
  yourBallotLabels: string[];
  yourBallotOptionIds: PollOptionId[];
  resultsRenderedAtMs: number;
  pollToggles: PollSecurityToggles;
  compactCounted: boolean;
  showReadOnlyOptions: boolean;
  showTally: boolean;
  resultsExplanation: Exclude<
    PostVoteResultsView,
    { kind: "visible" } | { kind: "ranked_visible" }
  > | null;
  postVoteComposition: boolean;
  selected: Set<string>;
  multiSelect: boolean;
  effectiveMinSelections: number;
  effectiveMaxSelections: number;
  boundsHint: string;
  commentBody: string;
  commentDisplayName: string;
  commentFieldErrors: Record<string, string>;
  commentModerationCsrfToken: string;
};

export type PollDeliveryResult = {
  state: PollDeliveryState | null;
  status: number;
  headers: Record<string, string>;
  cookies: DeliveryCookieEffect[];
  response: DeliveryResponse | null;
  unavailable: boolean;
};

export type PollDeliveryInput = {
  reference: string;
  request: Request;
  env: Env;
  principalUserId: string | null;
  requestContext: RequestContext | null;
  voterCookie: string | null;
  flashCookie: string | null;
  formAction: string;
  successRedirect: string;
  includeEditableTally: boolean;
  allowCanonicalCaseRedirect: boolean;
  operationalUnavailable: boolean;
  isCompatible?: (poll: PollPage) => boolean;
  remapReplacementRace?: boolean;
};

const formSchema = z.object({
  submissionId: z.string().refine(isUuidShape),
  selectedOptionIds: z.array(z.string()).max(POLL_CAPS.maxOptions),
  rankedPreferences: z
    .array(z.object({ optionId: z.string(), rank: z.number() }))
    .max(POLL_CAPS.maxOptions),
});

export const splitVoteCopy = (copy: string): { heading: string; body: string } => {
  const dotIndex = copy.indexOf(". ");
  return dotIndex < 0
    ? { heading: copy, body: "" }
    : { heading: copy.slice(0, dotIndex + 1), body: copy.slice(dotIndex + 2) };
};

export const outcomeFromVoteError = (
  error: VoteApplicationError,
): VoteOutcomeView => {
  switch (error.code) {
    case "already_voted":
      return { code: error.code, ...splitVoteCopy(VOTE_COPY.alreadyVoted), time: null, titlePrefix: "Already voted", tone: "rejection" };
    case "already_voted_ip":
      return { code: error.code, ...splitVoteCopy(VOTE_COPY.alreadyVotedIp), time: null, titlePrefix: "Already voted", tone: "rejection" };
    case "poll_closed":
      return { code: error.code, ...splitVoteCopy(VOTE_COPY.pollClosed), time: { placeholder: "{when}", timestampMs: error.closedAtMs ?? Date.now() }, titlePrefix: "Poll closed", tone: "rejection" };
    case "selection_required":
      return { code: error.code, ...splitVoteCopy(VOTE_COPY.selectionRequired), time: null, titlePrefix: "Nothing selected", tone: "rejection" };
    case "ranking_required":
      return { code: error.code, ...splitVoteCopy(error.message), time: null, titlePrefix: "Nothing ranked", tone: "rejection" };
    case "idempotency_conflict":
      return { code: error.code, ...splitVoteCopy(VOTE_COPY.idempotencyConflict), time: null, titlePrefix: "Vote already counted", tone: "rejection" };
    case "invalid_selection":
    case "invalid_ranking":
    case "too_few_selections":
    case "too_many_selections":
      return { code: error.code, ...splitVoteCopy(error.message), time: null, titlePrefix: "Vote not counted", tone: "rejection" };
    case "poll_definition_changed":
      return { code: error.code, ...splitVoteCopy(VOTE_COPY.pollDefinitionChanged), time: null, titlePrefix: "Poll changed", tone: "rejection" };
    case "captcha_failed":
      return { code: error.code, ...splitVoteCopy(VOTE_COPY.captchaFailed), time: null, titlePrefix: "Human check failed", tone: "rejection" };
    default:
      return { code: error.code, ...splitVoteCopy(VOTE_COPY.retry), time: null, titlePrefix: "Vote not counted", tone: "rejection" };
  }
};

const rateLimitedOutcome = (): VoteOutcomeView => {
  const copy = splitVoteCopy(VOTE_COPY.rateLimited);
  return {
    code: "rate_limited",
    heading: copy.heading,
    body: copy.body.replace("Give it a minute.", "Give it a minute, then reload this page."),
    time: null,
    titlePrefix: "Too many Votes",
    tone: "rejection",
  };
};

const postVoteResultsFrom = (view: ResultsView): PostVoteResultsView => {
  switch (view.kind) {
    case "visible":
      return {
        kind: view.kind,
        status: view.status,
        tally: view.tally,
        comments: view.comments,
        ownerComments: view.ownerComments,
        validator: view.validator,
      };
    case "ranked_visible":
      return {
        kind: "ranked_visible",
        status: view.status,
        ranked: view.ranked,
        validator: view.validator,
      };
    case "after_close_hidden":
      return view.deadlineMs === null
        ? { kind: view.kind, body: RESULTS_COPY.afterCloseHiddenNoDeadline, time: null }
        : { kind: view.kind, body: RESULTS_COPY.afterCloseHidden, time: { placeholder: "{deadline}", timestampMs: view.deadlineMs } };
    case "creator_only_hidden":
      return { kind: view.kind, body: RESULTS_COPY.creatorOnlyHidden, time: null };
    case "ranked_unavailable":
      return { kind: "unavailable", body: RESULTS_COPY.rankedUnavailable, time: null };
    case "not_found":
      return { kind: "unavailable", body: RESULTS_COPY.unavailable, time: null };
  }
};

const immediate = (
  body: string | null,
  status: number,
  headers: Record<string, string> = {},
): DeliveryResponse => ({
  body,
  status,
  headers: { "cache-control": "private, no-store", ...headers },
});

export async function deliverPollVotingSurface(
  input: PollDeliveryInput,
): Promise<PollDeliveryResult> {
  const method = input.request.method;
  const headers: Record<string, string> = { "cache-control": "private, no-store" };
  const cookies: DeliveryCookieEffect[] = [];
  let status = 200;
  let response: DeliveryResponse | null = null;
  let unavailable = false;
  const markDemoUnavailable = (): void => {
    if (input.operationalUnavailable && input.requestContext) {
      input.requestContext.demoUnavailable = true;
    }
  };

  if (method !== "GET" && method !== "HEAD" && method !== "POST") {
    response = immediate("Method not allowed.", 405, { allow: "GET, HEAD, POST" });
    return { state: null, status: 405, headers, cookies, response, unavailable };
  }

  const pollPersistence = createPollPersistence(input.env.DB);
  const votePersistence = createVotePersistence(input.env.DB);
  const reserved = isReservedSlug(input.reference);
  let poll = reserved ? null : await pollPersistence.findPollByReference(input.reference);

  if (!poll && !reserved && input.allowCanonicalCaseRedirect && isCustomSlugCaseVariant(input.reference)) {
    const canonical = await pollPersistence.findCanonicalCustomReference(input.reference);
    if (canonical && canonical.length <= POLL_CAPS.maxCustomLinkLength && /^[a-z0-9-]+$/.test(canonical)) {
      response = immediate(null, 301, { location: `/${canonical}${new URL(input.request.url).search}` });
      return { state: null, status: 301, headers, cookies, response, unavailable };
    }
  }

  if (poll && input.isCompatible && !input.isCompatible(poll)) poll = null;
  if (!poll) {
    unavailable = input.operationalUnavailable;
    if (unavailable) markDemoUnavailable();
    status = unavailable ? 503 : 404;
    return { state: null, status, headers, cookies, response, unavailable };
  }
  if (input.requestContext) input.requestContext.pollId = poll.pollId;

  const secure = new URL(input.request.url).protocol === "https:";
  const VOTER_TOKEN_SHAPE = /^[a-f0-9]{32}$/;
  let voterToken = input.voterCookie && VOTER_TOKEN_SHAPE.test(input.voterCookie)
    ? input.voterCookie
    : null;
  let submissionId: string = crypto.randomUUID();
  let selectedOptionIds: string[] = [];
  let rankedPreferences: RankedPreferenceInput[] = [];
  let outcome: VoteOutcomeView | null = null;
  let readOnly = false;
  let actionDisabled = false;
  let commentBody = "";
  let commentDisplayName = "";
  let commentFieldErrors: Record<string, string> = {};

  const issueVoterCookie = (): void => {
    voterToken = createVoterToken();
    cookies.push({
      kind: "set",
      name: VOTER_COOKIE_NAME,
      value: voterToken,
      options: { httpOnly: true, maxAge: VOTER_COOKIE_MAX_AGE_SECONDS, path: "/", sameSite: "lax", secure },
    });
  };
  const flashDigestFor = (pollId: PollPage["pollId"]): Promise<string> =>
    createVoteDigest(input.env.VOTE_DIGEST_SECRET, { pollId, checkKind: "session", token: pollId });
  const markVoteRejection = (): void => {
    if (input.requestContext) input.requestContext.voteRejection = true;
  };

  if (method === "POST") {
    try {
      const formData = await input.request.formData();
      const text = (entry: FormDataEntryValue | null): string => typeof entry === "string" ? entry : "";
      selectedOptionIds = formData.getAll("option_id").map(text);
      const rankedOptionIds = formData.getAll("ranked_option_id");
      const rankPositions = formData.getAll("rank_position");
      if (
        rankedOptionIds.length !== rankPositions.length ||
        rankedOptionIds.length > POLL_CAPS.maxOptions ||
        rankedOptionIds.some((entry) => typeof entry !== "string") ||
        rankPositions.some((entry) => typeof entry !== "string")
      ) {
        throw new UnreadableVoteFormError();
      }
      rankedPreferences = rankedOptionIds.map((entry, index) => ({
        optionId: entry as string,
        rank: Number(rankPositions[index]),
      }));
      commentBody = boundedInvalidEcho(
        singletonText(formData, "comment"),
        COMMENT_CAPS.body,
      );
      commentDisplayName = boundedInvalidEcho(
        singletonText(formData, "display_name"),
        COMMENT_CAPS.displayName,
      );
      const parsed = formSchema.safeParse({
        submissionId: text(formData.get("submission_id")),
        selectedOptionIds,
        rankedPreferences,
      });
      if (!parsed.success) {
        outcome = outcomeFromVoteError({ code: "vote_failed", message: VOTE_COPY.retry });
        status = 422;
        markVoteRejection();
      } else {
        const submittedId = parsed.data.submissionId;
        const rankAction = singletonText(formData, "rank_action");
        if (rankAction.length > 0) {
          // Rank actions mutate only the server-side draft — they never
          // consume vote admission — but they must not keep an interactive
          // builder alive against a closed Poll or a counted Ballot.
          const rankActionClosedMs = Date.now();
          if (effectivePollStatus(poll, rankActionClosedMs) === "closed") {
            outcome = { code: "poll_closed_get", heading: VOTE_COPY.closedOnGet, body: "", time: { placeholder: "{when}", timestampMs: poll.closedAtMs ?? poll.deadlineMs ?? rankActionClosedMs }, titlePrefix: "Poll closed", tone: "rejection" };
            readOnly = true;
          } else {
            let rankActionCounted = false;
            if (voterToken !== null && input.env.VOTE_DIGEST_SECRET) {
              try {
                const rankDigest = asVoterClaimDigest(await createVoteDigest(input.env.VOTE_DIGEST_SECRET, { pollId: poll.pollId, checkKind: "session", token: voterToken }));
                if (rankDigest !== null && await votePersistence.findClaim(poll.pollId, "session", rankDigest)) {
                  rankActionCounted = true;
                }
              } catch { /* preflight failure degrades to the interactive builder */ }
            }
            if (!rankActionCounted) {
              try {
                rankActionCounted = await votePersistence.findVoteBySubmission(poll.pollId, submittedId) !== null;
              } catch { /* submission lookup failure degrades to the interactive builder */ }
            }
            if (rankActionCounted) {
              outcome = outcomeFromVoteError({ code: "already_voted", message: VOTE_COPY.alreadyVoted });
              readOnly = true;
            }
          }
        }
        if (rankAction.length > 0 && !readOnly) {
          submissionId = submittedId;
          const knownOptionIds = new Set(poll.options.map((option) => option.id));
          const rankedDraftValid =
            poll.pollType === "ranked_choice" &&
            selectedOptionIds.length === 0 &&
            knownOptionIds.has(rankAction as PollOptionId) &&
            rankedPreferences.every(
              (preference, index, all) =>
                knownOptionIds.has(preference.optionId as PollOptionId) &&
                Number.isSafeInteger(preference.rank) &&
                preference.rank >= 1 &&
                preference.rank <= all.length &&
                all.findIndex((entry) => entry.optionId === preference.optionId) === index &&
                all.findIndex((entry) => entry.rank === preference.rank) === index,
            ) &&
            rankedPreferences.every((_, index, all) =>
              all.some((entry) => entry.rank === index + 1),
            );
          if (!rankedDraftValid) {
            // The Poll definition moved under the draft. Drop the stale
            // preferences entirely rather than echo gap-bearing ranks into
            // the re-rendered form.
            rankedPreferences = [];
            outcome = outcomeFromVoteError({
              code: "poll_definition_changed",
              message: VOTE_COPY.pollDefinitionChanged,
            });
            status = 422;
            markVoteRejection();
          } else {
            rankedPreferences = toggleRankedPreference(
              rankedPreferences.map((preference) => ({
                optionId: preference.optionId as PollOptionId,
                rank: preference.rank,
              })),
              rankAction as PollOptionId,
            );
          }
        } else if (rankAction.length === 0) {
        if (typeof input.env.VOTE_DIGEST_SECRET !== "string" || input.env.VOTE_DIGEST_SECRET.trim().length === 0) {
          response = immediate("Voting is unavailable.", 500);
          return { state: null, status: 500, headers, cookies, response, unavailable };
        }
        const existing = await votePersistence.findVoteBySubmission(poll.pollId, submittedId);
        let ipClaimDigest: VoterClaimDigest | null = null;
        let rateLimitDigest: VoteRateLimitDigest | null = null;
        if (existing === null) {
          const identity = selectCloudflareClientAddress(input.request.headers);
          if (identity.ok) {
            try {
              ipClaimDigest = asVoterClaimDigest(await createVoteDigest(input.env.VOTE_DIGEST_SECRET, { pollId: poll.pollId, checkKind: "ip", token: identity.value.claimToken }));
            } catch { ipClaimDigest = null; }
            try {
              rateLimitDigest = asVoteRateLimitDigest(await createVoteDigest(input.env.VOTE_DIGEST_SECRET, { pollId: poll.pollId, checkKind: "rate_limit", token: identity.value.rateLimitToken }));
            } catch { rateLimitDigest = null; }
          }
        }
        const admitted = existing !== null || await allowVoteSubmission(input.env.VOTE_RATE_LIMITER, rateLimitDigest, poll.pollId);
        if (!admitted) {
          outcome = rateLimitedOutcome();
          actionDisabled = true;
          status = 429;
          headers["retry-after"] = "60";
          markVoteRejection();
        } else {
          let humanChallenge: HumanChallengeProof = "not_attempted";
          if (existing === null && poll.captchaEnabled) {
            const turnstile = await verifyTurnstileToken({
              responseFields: formData.getAll("cf-turnstile-response"),
              secret: input.env.TURNSTILE_SECRET_KEY,
              siteKey: input.env.TURNSTILE_SITE_KEY,
              hostname: new URL(input.request.url).hostname,
              submissionId: submittedId,
            });
            humanChallenge = turnstile.proof;
            if (input.requestContext) input.requestContext.providerOutcome = turnstile.providerOutcome;
          }
          // Pre-compute the deterministic flash digest BEFORE the commit so
          // no fallible call sits between castVote and the 303: a signing
          // throw here escapes into the broad catch with nothing stored, and
          // that retry render's fresh submission ID is truthful and safe.
          // Placement is deliberate: validation, admission, and challenge
          // outcomes above stay truthful under a signing outage, while
          // castVote-level rejections (closed, invalid, already voted)
          // surface as vote_failed instead — accepted trade-off, since a
          // signing failure still commits nothing.
          const flashDigest = await flashDigestFor(poll.pollId);
          const sharedVoteInput = {
            pollId: poll.pollId,
            submissionId: submittedId,
            comment: { body: commentBody, displayName: commentDisplayName },
            browserToken: voterToken,
            ipDigest: ipClaimDigest,
            humanChallenge,
          };
          const voteInput: CastVoteInput =
            poll.pollType === "ranked_choice"
              ? {
                  ...sharedVoteInput,
                  pollType: "ranked_choice",
                  selectedOptionIds: [],
                  rankedPreferences,
                }
              : {
                  ...sharedVoteInput,
                  pollType: "multiple_choice",
                  selectedOptionIds,
                };
          const result = await castVote(
            {
              findPoll: votePersistence.findPoll,
              findVoteBySubmission: votePersistence.findVoteBySubmission,
              optionsStillReachable: votePersistence.optionsStillReachable,
              strategyFor: votingStrategyFor,
              createDigest: (digestInput) => createVoteDigest(input.env.VOTE_DIGEST_SECRET, digestInput),
              hashPayload: sha256Hex,
              persistVote: votePersistence.insertVote,
              generateId: () => crypto.randomUUID(),
              nowMs: () => Date.now(),
            },
            voteInput,
          );
          if (result.ok) {
            cookies.push({
              kind: "set",
              name: VOTE_FLASH_COOKIE_NAME,
              value: flashDigest,
              options: { httpOnly: true, maxAge: 60, path: "/", sameSite: "lax", secure },
            });
            response = immediate(null, 303, { location: input.successRedirect });
            return { state: null, status: 303, headers, cookies, response, unavailable };
          }
          if (result.error.code === "poll_deleted") {
            const refreshed = input.remapReplacementRace
              ? await pollPersistence.findPollByReference(input.reference)
              : null;
          if (refreshed && (!input.isCompatible || input.isCompatible(refreshed)) && refreshed.pollId !== poll.pollId) {
            poll = refreshed;
            outcome = outcomeFromVoteError({ code: "poll_definition_changed", message: VOTE_COPY.pollDefinitionChanged });
            const reachable = new Set(poll.options.map((option) => option.id));
            selectedOptionIds = selectedOptionIds.filter((id) => reachable.has(id as PollOptionId));
          } else {
            if (input.operationalUnavailable) markDemoUnavailable();
            status = input.operationalUnavailable ? 503 : 404;
            return { state: null, status, headers, cookies, response, unavailable: input.operationalUnavailable ? true : false };
          }
          } else {
            outcome = outcomeFromVoteError(result.error);
            commentFieldErrors = result.error.fieldErrors ?? {};
            if (result.error.code === "comments_disabled") {
              // The D1 trigger is authoritative. Hide stale/forged Comment
              // values before the refresh so a failed re-read cannot echo
              // fields which the Creator has already disabled.
              commentBody = "";
              commentDisplayName = "";
              commentFieldErrors = {};
              poll = { ...poll, commentsEnabled: false };
            }
            if (
              result.error.code === "poll_definition_changed" ||
              result.error.code === "captcha_failed" ||
              result.error.code === "comments_disabled"
            ) {
              const refreshed = await pollPersistence.findPollByReference(input.reference);
              if (refreshed === null || (input.isCompatible && !input.isCompatible(refreshed))) {
                status = input.operationalUnavailable ? 503 : 404;
                if (input.operationalUnavailable) markDemoUnavailable();
                return { state: null, status, headers, cookies, response, unavailable: input.operationalUnavailable };
              }
              poll = refreshed;
              const reachable = new Set(poll.options.map((option) => option.id));
              selectedOptionIds = selectedOptionIds.filter((id) => reachable.has(id as PollOptionId));
              rankedPreferences = rankedPreferences.filter((preference) =>
                reachable.has(preference.optionId as PollOptionId),
              );
            }
          }
          if (outcome) {
            readOnly = result.error.code === "already_voted" || result.error.code === "already_voted_ip" || result.error.code === "poll_closed";
            status = result.error.code === "ip_check_unavailable" || result.error.code === "vote_failed" ? 500 : 422;
            markVoteRejection();
          }
        }
        }
      }
    } catch (error) {
      // Once form parsing has started, keep the server-rendered retry surface
      // so safe ballot and Comment values are not lost on operational faults.
      outcome = outcomeFromVoteError({ code: "vote_failed", message: VOTE_COPY.retry });
      status = error instanceof UnreadableVoteFormError ? 422 : 500;
      markVoteRejection();
    }

    if (outcome) {
      submissionId = crypto.randomUUID();
      if (voterToken === null) issueVoterCookie();
    }
    if (readOnly) {
      selectedOptionIds = [];
      rankedPreferences = [];
    }
  } else {
    if (method === "GET" && voterToken === null) issueVoterCookie();
    let voterDigest: VoterClaimDigest | null = null;
    let sessionPreflightUnavailable = false;
    if (voterToken !== null) {
      try {
        voterDigest = asVoterClaimDigest(await createVoteDigest(input.env.VOTE_DIGEST_SECRET, { pollId: poll.pollId, checkKind: "session", token: voterToken }));
        sessionPreflightUnavailable = voterDigest === null;
      } catch { sessionPreflightUnavailable = true; }
    }
    let ipPreflightDigest: VoterClaimDigest | null = null;
    if (poll.ipChecksEnabled) {
      const identity = selectCloudflareClientAddress(input.request.headers);
      if (identity.ok) {
        try {
          ipPreflightDigest = asVoterClaimDigest(await createVoteDigest(input.env.VOTE_DIGEST_SECRET, { pollId: poll.pollId, checkKind: "ip", token: identity.value.claimToken }));
        } catch { ipPreflightDigest = null; }
      }
    }
    if (method === "GET" && input.flashCookie) {
      try {
        if (input.flashCookie === await flashDigestFor(poll.pollId)) {
          cookies.push({ kind: "delete", name: VOTE_FLASH_COOKIE_NAME, options: { path: "/" } });
          outcome = { code: "counted", heading: VOTE_COPY.counted, body: "", time: null, titlePrefix: "Counted", tone: "confirmation" };
          readOnly = true;
        }
      } catch { /* stale or unavailable flash is ignored */ }
    }
    const closedCheckMs = Date.now();
    if (outcome === null && effectivePollStatus(poll, closedCheckMs) === "closed") {
      outcome = { code: "poll_closed_get", heading: VOTE_COPY.closedOnGet, body: "", time: { placeholder: "{when}", timestampMs: poll.closedAtMs ?? poll.deadlineMs ?? closedCheckMs }, titlePrefix: "Poll closed", tone: "rejection" };
      readOnly = true;
    } else if (outcome === null && voterDigest !== null) {
      try {
        if (await votePersistence.findClaim(poll.pollId, "session", voterDigest)) {
          outcome = outcomeFromVoteError({ code: "already_voted", message: VOTE_COPY.alreadyVoted });
          readOnly = true;
        }
      } catch { sessionPreflightUnavailable = true; }
    }
    if (outcome === null && !sessionPreflightUnavailable && ipPreflightDigest !== null) {
      try {
        if (await votePersistence.findClaim(poll.pollId, "ip", ipPreflightDigest)) {
          outcome = outcomeFromVoteError({ code: "already_voted_ip", message: VOTE_COPY.alreadyVotedIp });
          readOnly = true;
        }
      } catch { /* submission remains authoritative */ }
    }
  }

  let postVoteResults: PostVoteResultsView | null = null;
  let yourBallotLabels: string[] = [];
  let yourBallotOptionIds: PollOptionId[] = [];
  const resultsRenderedAtMs = Date.now();
  if (readOnly || input.includeEditableTally) {
    try {
      postVoteResults = postVoteResultsFrom(await queryResults(
        createResultsPersistence(input.env.DB),
        input.reference,
        { userId: input.principalUserId === null ? null : input.principalUserId as UserId },
        resultsRenderedAtMs,
      ));
      if (
        input.includeEditableTally &&
        !readOnly &&
        postVoteResults.kind !== "visible" &&
        postVoteResults.kind !== "ranked_visible"
      ) {
        unavailable = true;
        markDemoUnavailable();
        status = 503;
        return { state: null, status, headers, cookies, response, unavailable };
      }
    } catch {
      if (input.includeEditableTally && !readOnly) {
        if (input.requestContext) input.requestContext.resultsLookupFailed = true;
        unavailable = true;
        markDemoUnavailable();
        status = 503;
        return { state: null, status, headers, cookies, response, unavailable };
      }
      postVoteResults = { kind: "unavailable", body: RESULTS_COPY.unavailable, time: null };
      if (input.requestContext) input.requestContext.resultsLookupFailed = true;
    }
    if (readOnly) {
      yourBallotLabels = await resolveAuthorizedBallotLabels(
        postVoteResults,
        voterToken,
        async (authorizedVoterToken) => {
          const ballotDigest = await createVoteDigest(input.env.VOTE_DIGEST_SECRET, { pollId: poll.pollId, checkKind: "session", token: authorizedVoterToken });
          const selectedIds = new Set(await votePersistence.findVoteSelectionByClaim(poll.pollId, "session", ballotDigest));
          const selections = poll.options.filter((option) => selectedIds.has(option.id));
          yourBallotOptionIds = selections.map((option) => option.id);
          return selections.map((option) => option.label);
        },
      );
    }
    if (outcome?.code === "counted") {
      if (
        postVoteResults.kind === "visible" ||
        postVoteResults.kind === "ranked_visible"
      ) {
        outcome = {
          ...outcome,
          body: VOTE_COPY.countedLive,
          time: null,
        };
      } else {
        outcome = {
          ...outcome,
          body: postVoteResults.body,
          time: postVoteResults.time,
        };
      }
    }
  }

  const compactCounted = readOnly && outcome?.code === "counted";
  const showReadOnlyOptions =
    readOnly && !compactCounted && poll.pollType === "multiple_choice";
  const showTally =
    (postVoteResults?.kind === "visible" ||
      postVoteResults?.kind === "ranked_visible") &&
    (readOnly || input.includeEditableTally);
  const resultsExplanation =
    !compactCounted &&
    postVoteResults?.kind !== "visible" &&
    postVoteResults?.kind !== "ranked_visible"
      ? postVoteResults
      : null;
  const postVoteComposition = compactCounted && showTally;
  const pollToggles = makeSecurityToggles(
    poll.sessionChecksEnabled,
    poll.ipChecksEnabled,
    poll.voterCodesEnabled,
    poll.captchaEnabled,
    poll.vpnBlockingEnabled,
  );
  const selected = new Set(selectedOptionIds);
  const multiSelect = poll.pollType === "multiple_choice" && poll.multiSelectEnabled;
  const effectiveMinSelections = multiSelect ? poll.minSelections ?? 1 : 1;
  const effectiveMaxSelections = multiSelect ? poll.maxSelections ?? poll.options.length : 1;
  const selectedCount = selected.size;
  const boundsHint = !multiSelect ? "" : selectedCount < effectiveMinSelections
    ? `Pick at least ${effectiveMinSelections}.`
    : selectedCount >= effectiveMaxSelections
      ? `Pick up to ${effectiveMaxSelections}. ${selectedCount} chosen.`
      : "";
  if (!poll.commentsEnabled) {
    // Forged disabled fields are neither rendered nor echoed.
    commentBody = "";
    commentDisplayName = "";
    commentFieldErrors = {};
  }

  return {
    state: {
      poll,
      submissionId,
      selectedOptionIds,
      rankedPreferences,
      outcome,
      readOnly,
      actionDisabled,
      postVoteResults,
      yourBallotLabels,
      yourBallotOptionIds,
      resultsRenderedAtMs,
      pollToggles,
      compactCounted,
      showReadOnlyOptions,
      showTally,
      resultsExplanation,
      postVoteComposition,
      selected,
      multiSelect,
      effectiveMinSelections,
      effectiveMaxSelections,
      boundsHint,
      commentBody,
      commentDisplayName,
      commentFieldErrors,
      commentModerationCsrfToken:
        input.requestContext?.csrfToken?.value ?? "",
    },
    status,
    headers,
    cookies,
    response,
    unavailable,
  };
}
