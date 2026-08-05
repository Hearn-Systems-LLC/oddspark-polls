import { describe, expect, it, vi } from "vitest";
import {
  queryLiveResults,
  queryResults,
  type LiveResultsPorts,
  type ResultsAccessEnvelope,
  type ResultsPorts,
  type ResultsProjection,
  type VersionedResultsProjection,
} from "../../src/modules/results/index";
import type {
  CommentId,
  PollId,
  PollOptionId,
  UserId,
} from "../../src/shared/domain/index";

const NOW = 1_800_000_000_000;
const POLL_ID = "comment-results-poll" as PollId;
const OWNER = "comment-results-owner" as UserId;
const OTHER = "comment-results-other" as UserId;
const OPTION = "comment-results-option" as PollOptionId;
const COMMENT = "comment-results-comment" as CommentId;

const envelope = (
  resultVisibility: ResultsAccessEnvelope["resultVisibility"] = "live",
): ResultsAccessEnvelope => ({
  pollId: POLL_ID,
  question: "Comments?",
  resultVisibility,
  ownerUserId: OWNER,
  deadlineMs: resultVisibility === "after_close" ? NOW + 1 : null,
  closedAtMs: null,
  multiSelectEnabled: false,
  securityToggles: {
    sessionChecks: true,
    ipChecks: false,
    voterCodes: false,
    captcha: false,
    vpnBlocking: false,
  },
  canonicalReference: "comments",
});

const projection: ResultsProjection = {
  options: [{ id: OPTION, label: "Yes", position: 0, count: 1 }],
  voterCount: 1,
  selectionCount: 1,
  comments: [{ body: "Public", displayName: null, createdAtMs: NOW }],
  ownerComments: [{
    commentId: COMMENT,
    body: "Public",
    displayName: null,
    createdAtMs: NOW,
  }],
};
const versionedProjection: VersionedResultsProjection = {
  ...projection,
  representationVersion: 2,
};

describe("Results Comment authorization and projection", () => {
  it.each([
    { visibility: "after_close" as const, viewer: { userId: null } },
    { visibility: "creator_only" as const, viewer: { userId: OTHER } },
  ])("does not project Comments when $visibility Results are hidden", async ({ visibility, viewer }) => {
    const projectResults = vi.fn(async () => versionedProjection);
    const ports: ResultsPorts = {
      findAccessEnvelope: async () => envelope(visibility),
      projectResults,
    };
    const view = await queryResults(ports, "comments", viewer, NOW);
    expect(view.kind).not.toBe("visible");
    expect(projectResults).not.toHaveBeenCalled();
    expect(view).not.toHaveProperty("comments");
  });

  it("returns moderation IDs only to the owning Creator", async () => {
    const projectResults = vi.fn(async (_pollId: PollId, owner: boolean) => ({
      ...versionedProjection,
      ownerComments: owner ? projection.ownerComments : null,
    }));
    const ports: ResultsPorts = {
      findAccessEnvelope: async () => envelope(),
      projectResults,
    };

    const publicView = await queryResults(ports, "comments", { userId: null }, NOW);
    expect(publicView).toMatchObject({
      kind: "visible",
      comments: projection.comments,
      ownerComments: null,
    });
    expect(projectResults).toHaveBeenLastCalledWith(POLL_ID, false);

    const ownerView = await queryResults(ports, "comments", { userId: OWNER }, NOW);
    expect(ownerView).toMatchObject({
      kind: "visible",
      comments: projection.comments,
      ownerComments: projection.ownerComments,
    });
    expect(projectResults).toHaveBeenLastCalledWith(POLL_ID, true);
  });

  it("keeps the live payload public-only even for the owner", async () => {
    const projectVersionedResults = vi.fn(async () => ({
      ...versionedProjection,
      ownerComments: null,
      representationVersion: 2,
    }));
    const ports: LiveResultsPorts = {
      findAccessEnvelope: async () => envelope("creator_only"),
      readRepresentationVersion: async () => 2,
      projectVersionedResults,
    };
    const view = await queryLiveResults(
      ports,
      "comments",
      { userId: OWNER },
      NOW,
    );
    expect(view).toMatchObject({
      kind: "visible",
      comments: projection.comments,
    });
    expect(view).not.toHaveProperty("ownerComments");
    expect(projectVersionedResults).toHaveBeenCalledWith(POLL_ID);
  });
});
