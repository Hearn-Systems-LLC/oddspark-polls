import { describe, expect, it, vi } from "vitest";
import {
  DISCOVERY_COPY,
  LISTING_CHOICES,
  parseListingDraft,
  setPollListing,
} from "../../src/modules/discovery/index";
import type { PollId, UserId } from "../../src/shared/domain/index";

const POLL_ID = "poll-1" as PollId;
const OWNER = "owner-1" as UserId;
const NOW = 1_800_000_000_000;

describe("parseListingDraft", () => {
  it.each([
    ["unlisted", "unlisted"],
    ["listed", "listed"],
  ] as const)("accepts the creator-settable %s state", (value, expected) => {
    expect(parseListingDraft(value)).toBe(expected);
  });

  it.each(["delisted", "junk", ""])(
    "rejects the non-settable %s value",
    (value) => {
      expect(parseListingDraft(value)).toBeNull();
    },
  );
});

describe("setPollListing", () => {
  it("returns an idempotent success without writing when the state is unchanged", async () => {
    const updateListing = vi.fn();
    const result = await setPollListing(
      {
        loadOwnedPoll: async () => ({ discoveryState: "unlisted" }),
        updateListing,
        nowMs: () => NOW,
      },
      POLL_ID,
      OWNER,
      "unlisted",
    );

    expect(result).toEqual({
      ok: true,
      value: { kind: "unchanged", state: "unlisted" },
    });
    expect(updateListing).not.toHaveBeenCalled();
  });

  it.each(["unlisted", "listed"] as const)(
    "refuses a creator request for %s when the poll is delisted",
    async (requested) => {
      const updateListing = vi.fn();
      const result = await setPollListing(
        {
          loadOwnedPoll: async () => ({ discoveryState: "delisted" }),
          updateListing,
          nowMs: () => NOW,
        },
        POLL_ID,
        OWNER,
        requested,
      );

      expect(result).toEqual({
        ok: false,
        error: { code: "poll_delisted", message: DISCOVERY_COPY.delisted },
      });
      expect(updateListing).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["updated", { ok: true, value: { kind: "updated", state: "listed" } }],
    [
      "unchanged",
      { ok: true, value: { kind: "unchanged", state: "listed" } },
    ],
    [
      "delisted",
      {
        ok: false,
        error: { code: "poll_delisted", message: DISCOVERY_COPY.delisted },
      },
    ],
    [
      "not_found",
      {
        ok: false,
        error: { code: "poll_not_found", message: DISCOVERY_COPY.notFound },
      },
    ],
  ] as const)("maps the adapter %s outcome", async (outcome, expected) => {
    const updateListing = vi.fn(async () => outcome);
    const result = await setPollListing(
      {
        loadOwnedPoll: async () => ({ discoveryState: "unlisted" }),
        updateListing,
        nowMs: () => NOW,
      },
      POLL_ID,
      OWNER,
      "listed",
    );

    expect(result).toEqual(expected);
    expect(updateListing).toHaveBeenCalledWith({
      pollId: POLL_ID,
      ownerUserId: OWNER,
      state: "listed",
      updatedAtMs: NOW,
    });
  });

  it("maps a missing owned snapshot to poll_not_found", async () => {
    const result = await setPollListing(
      {
        loadOwnedPoll: async () => null,
        updateListing: async () => "updated",
        nowMs: () => NOW,
      },
      POLL_ID,
      OWNER,
      "listed",
    );

    expect(result).toEqual({
      ok: false,
      error: { code: "poll_not_found", message: DISCOVERY_COPY.notFound },
    });
  });

  it("maps persistence failures to a stable safe error", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await setPollListing(
      {
        loadOwnedPoll: async () => ({ discoveryState: "unlisted" }),
        updateListing: async () => {
          throw new Error("provider detail");
        },
        nowMs: () => NOW,
      },
      POLL_ID,
      OWNER,
      "listed",
    );

    expect(result).toEqual({
      ok: false,
      error: { code: "poll_edit_failed", message: DISCOVERY_COPY.editFailed },
    });
    expect(log).toHaveBeenCalledWith("poll_edit_failed", {
      pollId: POLL_ID,
      cause: "provider detail",
    });
    log.mockRestore();
  });
});

describe("discovery copy", () => {
  it("keeps the exact chooser and refusal language in one catalog", () => {
    expect(DISCOVERY_COPY).toMatchObject({
      unlistedDescription:
        "reachable only by link; absent from Discover and sitemaps",
      listedDescription:
        "appears on Discover and in sitemaps while the Poll is open",
      listingInvalid: "Pick a Discovery Setting.",
      delisted: "Delisted by the Administrator.",
    });
    expect(LISTING_CHOICES).toEqual([
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
    ]);
  });
});
