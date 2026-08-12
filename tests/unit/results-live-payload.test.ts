import { describe, expect, it } from "vitest";
import {
  isLiveResultsPayload,
  reserveResultsReload,
  shouldReloadOwnerCommentControls,
  sameCommentSnapshot,
} from "../../src/scripts/results-live-core";

const payload = {
  status: "open",
  multiSelectEnabled: false,
  voterCount: 1,
  selectionCount: 1,
  tied: false,
  empty: false,
  options: [{
    id: "option-1",
    label: "Alpha",
    position: 0,
    count: 1,
    percent: 100,
    pieShare: 1,
    leading: true,
  }],
  comments: [
    { body: "Newest", displayName: null, createdAtMs: 20 },
    { body: "Older", displayName: "Reader", createdAtMs: 10 },
  ],
};

describe("live Results Comment payload validation", () => {
  it("accepts the purpose-shaped complete ordered Comment list", () => {
    expect(isLiveResultsPayload(payload)).toBe(true);
  });

  it("rejects malformed order, hostile fields, moderation IDs, and unknown fields", () => {
    expect(
      isLiveResultsPayload({
        ...payload,
        comments: [...payload.comments].reverse(),
      }),
    ).toBe(false);
    expect(
      isLiveResultsPayload({
        ...payload,
        comments: [{ ...payload.comments[0], commentId: "private-id" }],
      }),
    ).toBe(false);
    expect(
      isLiveResultsPayload({
        ...payload,
        comments: [{ body: "Good", displayName: "bad\nname", createdAtMs: 1 }],
      }),
    ).toBe(false);
    expect(isLiveResultsPayload({ ...payload, ownerComments: [] })).toBe(false);
    expect(isLiveResultsPayload({ ...payload, unknown: true })).toBe(false);
    expect(
      isLiveResultsPayload({
        ...payload,
        comments: [{
          body: "Outside Date range",
          displayName: null,
          createdAtMs: 8_640_000_000_000_001,
        }],
      }),
    ).toBe(false);
  });

  it("detects any ordered Comment snapshot change for bounded reload", () => {
    expect(sameCommentSnapshot(payload.comments, payload.comments)).toBe(true);
    expect(sameCommentSnapshot(payload.comments, payload.comments.slice(1))).toBe(false);
    expect(
      sameCommentSnapshot(payload.comments, [
        { ...payload.comments[0], body: "Changed" },
        payload.comments[1],
      ]),
    ).toBe(false);
  });

  it("caps one persistent reload cause but gives a distinct validator a fresh budget", () => {
    const first = reserveResultsReload({ token: "", count: 0 }, '"2:open"');
    expect(first).toEqual({
      allowed: true,
      recovery: { token: '"2:open"', count: 1 },
    });
    const second = reserveResultsReload(first.recovery, '"2:open"');
    expect(second.allowed).toBe(true);
    expect(reserveResultsReload(second.recovery, '"2:open"').allowed).toBe(false);
    expect(reserveResultsReload(second.recovery, '"3:open"')).toEqual({
      allowed: true,
      recovery: { token: '"3:open"', count: 1 },
    });
  });

  it("reloads owner controls after an otherwise indistinguishable replacement", () => {
    expect(
      shouldReloadOwnerCommentControls({
        hasOwnerModeration: true,
        previousValidator: '"7:open"',
        incomingValidator: '"9:open"',
        commentsMatch: true,
      }),
    ).toBe(true);
    expect(
      shouldReloadOwnerCommentControls({
        hasOwnerModeration: false,
        previousValidator: '"7:open"',
        incomingValidator: '"9:open"',
        commentsMatch: true,
      }),
    ).toBe(false);
    expect(
      shouldReloadOwnerCommentControls({
        hasOwnerModeration: true,
        previousValidator: '"7:open"',
        incomingValidator: '"8:open"',
        commentsMatch: true,
      }),
    ).toBe(false);
  });
});

describe("live Results payload rejects media keys on options (Story 6.2)", () => {
  it("rejects options carrying media fields", () => {
    expect(
      isLiveResultsPayload({
        ...payload,
        options: [{
          ...payload.options[0],
          media: { mediaId: "m-1", altText: "A photo", caption: null },
        }],
      }),
    ).toBe(false);
  });

  it("rejects options carrying a mediaId field directly", () => {
    expect(
      isLiveResultsPayload({
        ...payload,
        options: [{ ...payload.options[0], mediaId: "m-1" }],
      }),
    ).toBe(false);
  });
});

describe("Multiple-Choice live payload remains isolated from Meeting", () => {
  it("rejects the Meeting discriminant and grid keys", () => {
    expect(
      isLiveResultsPayload({
        pollType: "meeting",
        status: "open",
        empty: false,
        voterCount: 1,
        slots: [],
        voters: [],
        comments: [],
      }),
    ).toBe(false);
  });
});
