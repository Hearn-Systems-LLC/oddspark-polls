import { describe, expect, it } from "vitest";
import {
  DISCOVERY_STATES,
  POLL_TYPES,
  RESULT_VISIBILITIES,
  SECURITY_TOGGLES,
  effectivePollStatus,
} from "../../src/shared/domain/index";
import {
  POLL_TYPE_CONTRACT_VERSION,
  type PollTypeStrategy,
} from "../../src/shared/application/index";

describe("shared kernel enums", () => {
  it("declares the four known Poll Types with multiple_choice first", () => {
    expect(POLL_TYPES).toEqual([
      "multiple_choice",
      "ranked_choice",
      "image",
      "meeting",
    ]);
  });

  it("declares the three Visibility Settings", () => {
    expect(RESULT_VISIBILITIES).toEqual(["live", "after_close", "creator_only"]);
  });

  it("declares the five Security Toggles in trust-badge vocabulary order", () => {
    expect(SECURITY_TOGGLES).toEqual([
      "sessionChecks",
      "ipChecks",
      "voterCodes",
      "captcha",
      "vpnBlocking",
    ]);
  });

  it("declares the three Discovery states", () => {
    expect(DISCOVERY_STATES).toEqual(["unlisted", "listed", "delisted"]);
  });

  it("versions the Poll Type contribution contract", () => {
    expect(POLL_TYPE_CONTRACT_VERSION).toBe(5);
  });

  it("requires every real strategy to expose the versioned export port", () => {
    const minimal: PollTypeStrategy<{ labels: string[] }, { labels: string[] }> =
      {
        type: "multiple_choice",
        contractVersion: POLL_TYPE_CONTRACT_VERSION,
        create: (input) => ({ ok: true, value: { labels: input.labels } }),
        projectExport: () => ({
          ok: true,
          value: {
            votes: { columns: ["VALUE"], rows: [] },
            tally: { columns: ["VALUE"], rows: [["zero"]] },
            voterCount: 0,
            selectionCount: 0,
          },
        }),
      };
    const created = minimal.create({ labels: ["a", "b"] }, { nowMs: 0 });
    expect(created).toEqual({ ok: true, value: { labels: ["a", "b"] } });
  });

  it("constrains custom export projection generics to the shared shape", () => {
    // If the `extends PollTypeExportProjection` constraint is removed, this
    // directive becomes unused and the repository type gate fails.
    type InvalidExportStrategy = PollTypeStrategy<
      { labels: string[] },
      { labels: string[] },
      unknown,
      unknown,
      unknown,
      unknown,
      unknown,
      // @ts-expect-error unrelated export shapes are outside the frozen contract
      { unrelated: true }
    >;
    expect(true).toBe(true);
  });

  it("types the facts seam across all five ports (AD-23 compile-time consumer)", () => {
    // A fully-implemented strategy: `create`'s facts feed validateSubmission,
    // persistFacts' vote facts feed projectResults, and export facts feed
    // projectExport — typed end to end, never `unknown` (D5, 2026-07-29).
    type CreationFacts = { options: string[] };
    type Submission = { selectedOptionIds: string[] };
    type ValidatedSubmission = { selectedOptionIds: [string] };
    type VoteFacts = { selections: { pollOptionId: string }[] };
    const full: PollTypeStrategy<
      { labels: string[] },
      CreationFacts,
      Submission,
      ValidatedSubmission,
      VoteFacts,
      { tally: number },
      VoteFacts
    > = {
      type: "multiple_choice",
      contractVersion: POLL_TYPE_CONTRACT_VERSION,
      create: (input) => ({ ok: true, value: { options: input.labels } }),
      validateSubmission: (submission, facts) =>
        submission.selectedOptionIds.length === 1 &&
        facts.options.includes(submission.selectedOptionIds[0] ?? "")
          ? {
              ok: true,
              value: {
                selectedOptionIds: [
                  submission.selectedOptionIds[0] ?? "",
                ],
              },
            }
          : { ok: false, error: { code: "unknown_option", message: "No." } },
      persistFacts: (validated) => ({
        selections: validated.selectedOptionIds.map((pollOptionId) => ({
          pollOptionId,
        })),
      }),
      projectResults: (facts) => ({ tally: facts.selections.length }),
      projectExport: (facts) => ({
        ok: true,
        value: {
          votes: {
            columns: ["SELECTION 1"],
            rows: [{ alignmentKey: 0, cells: ["a"] }],
          },
          tally: {
            columns: ["OPTION", "COUNT"],
            rows: [["a", facts.selections.length]],
          },
          voterCount: 1,
          selectionCount: facts.selections.length,
        },
      }),
    };

    const created = full.create({ labels: ["a", "b"] }, { nowMs: 0 });
    expect(created).toEqual({ ok: true, value: { options: ["a", "b"] } });
    if (!created.ok) return;

    const validated = full.validateSubmission?.(
      { selectedOptionIds: ["a"] },
      created.value,
    );
    expect(validated).toEqual({
      ok: true,
      value: { selectedOptionIds: ["a"] },
    });
    const rejected = full.validateSubmission?.(
      { selectedOptionIds: ["z"] },
      created.value,
    );
    expect(rejected?.ok).toBe(false);
    if (!validated?.ok) return;

    const persisted = full.persistFacts?.(validated.value);
    expect(persisted).toEqual({
      selections: [{ pollOptionId: "a" }],
    });
    expect(full.projectResults?.(persisted ?? { selections: [] })).toEqual({
      tally: 1,
    });
    expect(full.projectExport(persisted ?? { selections: [] })).toMatchObject({
      ok: true,
      value: { votes: { columns: ["SELECTION 1"] } },
    });
  });
});

describe("effectivePollStatus (AD-11)", () => {
  const now = 1_800_000_000_000;

  it("is open with no deadline and no close", () => {
    expect(
      effectivePollStatus({ closedAtMs: null, deadlineMs: null }, now),
    ).toBe("open");
  });

  it("is open while the deadline is still in the future", () => {
    expect(
      effectivePollStatus({ closedAtMs: null, deadlineMs: now + 1 }, now),
    ).toBe("open");
  });

  it("is closed exactly at the deadline (deadline not later than now)", () => {
    expect(
      effectivePollStatus({ closedAtMs: null, deadlineMs: now }, now),
    ).toBe("closed");
  });

  it("is closed after the deadline", () => {
    expect(
      effectivePollStatus({ closedAtMs: null, deadlineMs: now - 1 }, now),
    ).toBe("closed");
  });

  it("is closed whenever closed_at is set, even with a future deadline", () => {
    expect(
      effectivePollStatus({ closedAtMs: now - 5, deadlineMs: now + 1000 }, now),
    ).toBe("closed");
  });
});
