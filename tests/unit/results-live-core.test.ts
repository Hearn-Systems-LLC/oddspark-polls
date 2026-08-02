import { describe, expect, it } from "vitest";
import {
  createResultsLiveState,
  markResultsLiveFailure,
  markResultsLiveSuccess,
  nextResultsPollDelayMs,
  parseResultsValidator,
  shouldAdoptResultsValidator,
  shouldPollResults,
} from "../../src/scripts/results-live-core";

const INITIAL_RENDER_AT_MS = Date.UTC(2026, 7, 2, 12, 0, 0);
const FIRST_REFRESH_AT_MS = INITIAL_RENDER_AT_MS + 3_000;

describe("results live connection state", () => {
  it("starts live with the initial render time as its last successful snapshot", () => {
    expect(createResultsLiveState(INITIAL_RENDER_AT_MS)).toEqual({
      connection: {
        kind: "live",
        lastSuccessAtMs: INITIAL_RENDER_AT_MS,
      },
      consecutiveFailures: 0,
    });
  });

  it("enters stale on the first failure without inventing a newer success time", () => {
    const state = createResultsLiveState(INITIAL_RENDER_AT_MS);

    expect(markResultsLiveFailure(state)).toEqual({
      connection: {
        kind: "stale",
        lastSuccessAtMs: INITIAL_RENDER_AT_MS,
      },
      consecutiveFailures: 1,
    });
  });

  it("keeps the original last-success time across repeated failures", () => {
    let state = createResultsLiveState(INITIAL_RENDER_AT_MS);
    state = markResultsLiveFailure(state);
    state = markResultsLiveFailure(state);
    state = markResultsLiveFailure(state);

    expect(state).toEqual({
      connection: {
        kind: "stale",
        lastSuccessAtMs: INITIAL_RENDER_AT_MS,
      },
      consecutiveFailures: 3,
    });
  });

  it("returns stale state to live with the successful refresh time", () => {
    const stale = markResultsLiveFailure(
      createResultsLiveState(INITIAL_RENDER_AT_MS),
    );

    expect(markResultsLiveSuccess(stale, FIRST_REFRESH_AT_MS, "open")).toEqual(
      {
        connection: {
          kind: "live",
          lastSuccessAtMs: FIRST_REFRESH_AT_MS,
        },
        consecutiveFailures: 0,
      },
    );
  });

  it("enters closed with the final snapshot time and resets failures", () => {
    const stale = markResultsLiveFailure(
      markResultsLiveFailure(createResultsLiveState(INITIAL_RENDER_AT_MS)),
    );

    expect(markResultsLiveSuccess(stale, FIRST_REFRESH_AT_MS, "closed")).toEqual(
      {
        connection: {
          kind: "closed",
          lastSuccessAtMs: FIRST_REFRESH_AT_MS,
        },
        consecutiveFailures: 0,
      },
    );
  });

  it("keeps closed terminal across later success and failure signals", () => {
    const closed = markResultsLiveSuccess(
      createResultsLiveState(INITIAL_RENDER_AT_MS),
      FIRST_REFRESH_AT_MS,
      "closed",
    );

    expect(markResultsLiveFailure(closed)).toEqual(closed);
    expect(
      markResultsLiveSuccess(closed, FIRST_REFRESH_AT_MS + 3_000, "open"),
    ).toEqual(closed);
  });
});

describe("results live polling schedule", () => {
  it("uses a three-second cadence before any failure", () => {
    expect(
      nextResultsPollDelayMs(createResultsLiveState(INITIAL_RENDER_AT_MS)),
    ).toBe(3_000);
  });

  it("backs off through three, six, twelve, twenty-four, and thirty seconds", () => {
    let state = createResultsLiveState(INITIAL_RENDER_AT_MS);
    const delays: number[] = [];

    for (let failure = 0; failure < 5; failure += 1) {
      state = markResultsLiveFailure(state);
      delays.push(nextResultsPollDelayMs(state));
    }

    expect(delays).toEqual([3_000, 6_000, 12_000, 24_000, 30_000]);
  });

  it("caps every later retry at thirty seconds", () => {
    let state = createResultsLiveState(INITIAL_RENDER_AT_MS);

    for (let failure = 0; failure < 20; failure += 1) {
      state = markResultsLiveFailure(state);
    }

    expect(nextResultsPollDelayMs(state)).toBe(30_000);
  });

  it("resets the retry delay to three seconds after a success", () => {
    let state = createResultsLiveState(INITIAL_RENDER_AT_MS);
    state = markResultsLiveFailure(state);
    state = markResultsLiveFailure(state);
    state = markResultsLiveFailure(state);

    expect(nextResultsPollDelayMs(state)).toBe(12_000);

    state = markResultsLiveSuccess(state, FIRST_REFRESH_AT_MS, "open");
    expect(nextResultsPollDelayMs(state)).toBe(3_000);
  });
});

describe("results live polling gate", () => {
  it("polls an open live connection only while the page is visible and online", () => {
    const state = createResultsLiveState(INITIAL_RENDER_AT_MS);

    expect(shouldPollResults(state, "visible", true)).toBe(true);
    expect(shouldPollResults(state, "hidden", true)).toBe(false);
    expect(shouldPollResults(state, "visible", false)).toBe(false);
  });

  it("allows a visible online stale connection to recover", () => {
    const stale = markResultsLiveFailure(
      createResultsLiveState(INITIAL_RENDER_AT_MS),
    );

    expect(shouldPollResults(stale, "visible", true)).toBe(true);
  });

  it("never polls after the connection reaches closed", () => {
    const closed = markResultsLiveSuccess(
      createResultsLiveState(INITIAL_RENDER_AT_MS),
      FIRST_REFRESH_AT_MS,
      "closed",
    );

    expect(shouldPollResults(closed, "visible", true)).toBe(false);
  });
});

describe("results validator coalescing", () => {
  it("parses the composite representation version and effective status", () => {
    expect(parseResultsValidator('"17:open"')).toEqual({
      representationVersion: 17,
      status: "open",
    });
    expect(parseResultsValidator('"17:closed"')).toEqual({
      representationVersion: 17,
      status: "closed",
    });
  });

  it.each([
    null,
    "",
    "17:open",
    'W/"17:open"',
    '"0:open"',
    '"-1:closed"',
    '"1.5:open"',
    '"17:OPEN"',
    '"17:stale"',
    '"9007199254740992:open"',
  ])("rejects malformed validator %j", (validator) => {
    expect(parseResultsValidator(validator)).toBeNull();
  });

  it("adopts the first valid validator and every higher representation version", () => {
    expect(shouldAdoptResultsValidator(null, '"17:open"')).toBe(true);
    expect(shouldAdoptResultsValidator('"17:open"', '"18:open"')).toBe(true);
  });

  it("rejects a lower representation version instead of replaying stale results", () => {
    expect(shouldAdoptResultsValidator('"18:open"', '"17:open"')).toBe(
      false,
    );
  });

  it("accepts an open-to-closed transition at the same representation version", () => {
    expect(shouldAdoptResultsValidator('"18:open"', '"18:closed"')).toBe(
      true,
    );
  });

  it("allows an idempotent latest snapshot but rejects a same-version closed-to-open replay", () => {
    expect(shouldAdoptResultsValidator('"18:open"', '"18:open"')).toBe(true);
    expect(shouldAdoptResultsValidator('"18:closed"', '"18:open"')).toBe(
      false,
    );
  });

  it("uses a valid incoming validator when no valid current baseline exists", () => {
    expect(shouldAdoptResultsValidator("malformed", '"18:open"')).toBe(true);
  });

  it("rejects malformed incoming validators", () => {
    expect(shouldAdoptResultsValidator('"18:open"', "malformed")).toBe(false);
    expect(shouldAdoptResultsValidator(null, "malformed")).toBe(false);
  });
});
