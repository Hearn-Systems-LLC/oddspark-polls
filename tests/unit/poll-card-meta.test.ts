import { describe, expect, it } from "vitest";
import {
  POLL_TYPE_LABELS,
  buildPollCardViewModel,
  type PollCardViewModelInput,
} from "../../src/components/poll-card";
import { POLL_TYPES } from "../../src/shared/domain/index";

const NOW = 1_784_000_000_000;
const HOUR = 3_600_000;
const MINUTE = 60_000;

const input = (
  overrides: Partial<PollCardViewModelInput> = {},
): PollCardViewModelInput => ({
  title: "Where should we go?",
  pollType: "multiple_choice",
  voterCount: 122,
  status: "open",
  deadlineMs: null,
  nowMs: NOW,
  href: "/creator/polls/poll-1",
  ...overrides,
});

describe("POLL_TYPE_LABELS", () => {
  it("covers every PollType member", () => {
    for (const type of POLL_TYPES) {
      expect(POLL_TYPE_LABELS[type]).toBeTypeOf("string");
      expect(POLL_TYPE_LABELS[type].length).toBeGreaterThan(0);
    }
    expect(Object.keys(POLL_TYPE_LABELS).sort()).toEqual(
      [...POLL_TYPES].sort(),
    );
  });

  it("keeps the four Poll Type presentation labels", () => {
    expect(POLL_TYPE_LABELS).toEqual({
      multiple_choice: "MULTIPLE CHOICE",
      ranked_choice: "RANKED CHOICE",
      image: "IMAGE",
      meeting: "MEETING",
    });
  });
});

describe("buildPollCardViewModel", () => {
  it("returns one complete structured row model", () => {
    expect(buildPollCardViewModel(input())).toEqual({
      title: "Where should we go?",
      metadata: {
        typeLabel: "MULTIPLE CHOICE",
        voteTotal: "122 VOTES",
        closing: { kind: "none" },
      },
      status: "open",
      href: "/creator/polls/poll-1",
      current: false,
    });
  });

  it("uses singular VOTE for one voter and preserves row navigation state", () => {
    const viewModel = buildPollCardViewModel(
      input({ voterCount: 1, current: true }),
    );

    expect(viewModel.metadata.voteTotal).toBe("1 VOTE");
    expect(viewModel.href).toBe("/creator/polls/poll-1");
    expect(viewModel.status).toBe("open");
    expect(viewModel.current).toBe(true);
  });

  it("adds a countdown under 24 hours", () => {
    expect(
      buildPollCardViewModel(
        input({
          voterCount: 0,
          deadlineMs: NOW + 3 * HOUR,
        }),
      ).metadata.closing,
    ).toEqual({ kind: "countdown", text: "CLOSES IN 3H" });

    expect(
      buildPollCardViewModel(
        input({ deadlineMs: NOW + 45 * MINUTE }),
      ).metadata.closing,
    ).toEqual({ kind: "countdown", text: "CLOSES IN 45M" });
  });

  it("omits closing metadata for open polls without a deadline", () => {
    expect(buildPollCardViewModel(input()).metadata.closing).toEqual({
      kind: "none",
    });
  });

  it("omits closing metadata when the Poll is closed", () => {
    const viewModel = buildPollCardViewModel(
      input({
        pollType: "ranked_choice",
        voterCount: 5,
        status: "closed",
        deadlineMs: NOW - HOUR,
      }),
    );

    expect(viewModel.metadata).toEqual({
      typeLabel: "RANKED CHOICE",
      voteTotal: "5 VOTES",
      closing: { kind: "none" },
    });
    expect(viewModel.status).toBe("closed");
  });

  it("returns a complete UTC floor for an open Poll beyond 24 hours", () => {
    const deadlineMs = NOW + 48 * HOUR;
    const closing = buildPollCardViewModel(
      input({ pollType: "image", voterCount: 2, deadlineMs }),
    ).metadata.closing;

    expect(closing.kind).toBe("absolute");
    if (closing.kind === "absolute") {
      expect(closing.deadlineMs).toBe(deadlineMs);
      expect(closing.utcFloor).toContain("UTC");
      expect(closing.utcFloor.length).toBeGreaterThan("UTC".length);
    }
  });
});
