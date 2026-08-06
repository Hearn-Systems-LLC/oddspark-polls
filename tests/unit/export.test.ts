import { describe, expect, it, vi } from "vitest";
import {
  multipleChoiceStrategy,
  type MultipleChoiceExportFacts,
} from "../../src/modules/polls/types/multiple-choice";
import {
  bindBoundedExportDriver,
  bindExportDriver,
  queryBoundedOwnerExport,
  queryOwnerExport,
  type BoundedExportFactDriver,
  type ExportFactDriver,
  type ExportPorts,
  type SharedExportVoteFacts,
} from "../../src/modules/results/export";
import type { PollId, UserId } from "../../src/shared/domain/index";

const POLL = "poll-1" as PollId;
const OWNER = "owner-1" as UserId;

function facts(): {
  sharedVotes: SharedExportVoteFacts[];
  typeFacts: MultipleChoiceExportFacts;
} {
  const sharedVotes: SharedExportVoteFacts[] = [
    {
      alignmentKey: 0,
      createdAtMs: 1_800_000_000_000,
      comment: {
        body: "Unicode café, quote \" and\nline two",
        displayName: "Zoë",
        createdAtMs: 1_800_000_000_000,
      },
    },
    { alignmentKey: 1, createdAtMs: 1_800_000_000_001, comment: null },
  ];
  return {
    sharedVotes,
    typeFacts: {
      multiSelectEnabled: true,
      minSelections: 1,
      maxSelections: 2,
      options: [
        { label: "Alpha", position: 0, count: 2 },
        { label: "Beta", position: 1, count: 1 },
      ],
      votes: [
        {
          alignmentKey: 0,
          createdAtMs: 1_800_000_000_000,
          selections: [{ optionPosition: 1 }, { optionPosition: 0 }],
        },
        {
          alignmentKey: 1,
          createdAtMs: 1_800_000_000_001,
          selections: [{ optionPosition: 0 }],
        },
      ],
      voterCount: 2,
      selectionCount: 3,
    },
  };
}

function deps(raw = facts()) {
  const ports: ExportPorts = {
    findOwnerEnvelope: vi.fn(async () => ({
      pollId: POLL,
      canonicalReference: "team-lunch",
      pollType: "multiple_choice" as const,
    })),
  };
  const factDriver: ExportFactDriver<MultipleChoiceExportFacts> = {
    type: "multiple_choice",
    projectFacts: vi.fn(async () => raw),
  };
  return {
    ports,
    factDriver,
    driver: bindExportDriver(factDriver, multipleChoiceStrategy),
  };
}

describe("owner export query", () => {
  it("authorizes with ViewerContext before the generic ID-free driver", async () => {
    const calls: string[] = [];
    const value = deps();
    vi.mocked(value.ports.findOwnerEnvelope).mockImplementation(async () => {
      calls.push("owner");
      return {
        pollId: POLL,
        canonicalReference: "team-lunch",
        pollType: "multiple_choice",
      };
    });
    vi.mocked(value.factDriver.projectFacts).mockImplementation(async () => {
      calls.push("facts");
      return facts();
    });

    const result = await queryOwnerExport(
      value.ports,
      POLL,
      { userId: OWNER },
      [value.driver],
    );
    expect(calls).toEqual(["owner", "facts"]);
    expect(result).toEqual({
      canonicalReference: "team-lunch",
      dataset: {
        votes: {
          columns: [
            "TIMESTAMP",
            "DISPLAY NAME",
            "COMMENT",
            "SELECTION 1",
            "SELECTION 2",
          ],
          rows: [
            [
              "2027-01-15T08:00:00.000Z",
              "Zoë",
              "Unicode café, quote \" and\nline two",
              "Alpha",
              "Beta",
            ],
            ["2027-01-15T08:00:00.001Z", "", "", "Alpha", ""],
          ],
        },
        tally: {
          columns: ["OPTION", "COUNT"],
          rows: [
            ["Alpha", 2],
            ["Beta", 1],
          ],
        },
        summary: {
          columns: ["METRIC", "VALUE"],
          rows: [
            ["VOTERS", 2],
            ["SELECTIONS", 3],
          ],
        },
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/poll-1|owner-1|option-|vote-/u);
  });

  it("does not read even the owner envelope for an anonymous ViewerContext", async () => {
    const value = deps();
    await expect(
      queryOwnerExport(value.ports, POLL, { userId: null }, [value.driver]),
    ).resolves.toBeNull();
    expect(value.ports.findOwnerEnvelope).not.toHaveBeenCalled();
    expect(value.factDriver.projectFacts).not.toHaveBeenCalled();
  });

  it("returns complete zero Tally and separate Summary rows for an empty Poll", async () => {
    const raw = facts();
    raw.sharedVotes = [];
    raw.typeFacts.votes = [];
    raw.typeFacts.voterCount = 0;
    raw.typeFacts.selectionCount = 0;
    raw.typeFacts.options.forEach((option) => (option.count = 0));
    const value = deps(raw);
    const result = await queryOwnerExport(
      value.ports,
      POLL,
      { userId: OWNER },
      [value.driver],
    );
    expect(result?.dataset.votes.rows).toEqual([]);
    expect(result?.dataset.tally.rows).toEqual([
      ["Alpha", 0],
      ["Beta", 0],
    ]);
    expect(result?.dataset.summary.rows).toEqual([
      ["VOTERS", 0],
      ["SELECTIONS", 0],
    ]);
  });

  it("conceals missing and foreign Polls before private projection", async () => {
    const value = deps();
    vi.mocked(value.ports.findOwnerEnvelope).mockResolvedValue(null);
    await expect(
      queryOwnerExport(value.ports, POLL, { userId: OWNER }, [value.driver]),
    ).resolves.toBeNull();
    expect(value.factDriver.projectFacts).not.toHaveBeenCalled();
  });

  it("rejects an owner envelope that resolves a different Poll", async () => {
    const value = deps();
    vi.mocked(value.ports.findOwnerEnvelope).mockResolvedValue({
      pollId: "different-poll" as PollId,
      canonicalReference: "different-poll",
      pollType: "multiple_choice",
    });
    await expect(
      queryOwnerExport(value.ports, POLL, { userId: OWNER }, [value.driver]),
    ).rejects.toThrow("Mismatched export owner envelope");
    expect(value.factDriver.projectFacts).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid timestamp", (raw: ReturnType<typeof facts>) => (raw.sharedVotes[0]!.createdAtMs = -1)],
    [
      "timestamp outside the Date.toISOString range",
      (raw: ReturnType<typeof facts>) =>
        (raw.sharedVotes[0]!.createdAtMs = 8_640_000_000_000_001),
    ],
    [
      "timestamp outside the RFC 3339 four-digit-year range",
      (raw: ReturnType<typeof facts>) =>
        (raw.sharedVotes[0]!.createdAtMs = 253_402_300_800_000),
    ],
    ["out-of-order shared rows", (raw: ReturnType<typeof facts>) => (raw.sharedVotes[1]!.createdAtMs = 0)],
    [
      "misaligned Poll Type response row",
      (raw: ReturnType<typeof facts>) =>
        (raw.typeFacts.votes[1]!.alignmentKey = 0),
    ],
    [
      "equal-timestamp response rows reordered across shared Vote facts",
      (raw: ReturnType<typeof facts>) => {
        raw.sharedVotes[1]!.createdAtMs = raw.sharedVotes[0]!.createdAtMs;
        raw.typeFacts.votes[1]!.createdAtMs =
          raw.typeFacts.votes[0]!.createdAtMs;
        raw.typeFacts.votes.reverse();
      },
    ],
    ["mismatched Comment timestamp", (raw: ReturnType<typeof facts>) => (raw.sharedVotes[0]!.comment!.createdAtMs += 1)],
    ["unknown option position", (raw: ReturnType<typeof facts>) => (raw.typeFacts.votes[0]!.selections[0]!.optionPosition = 7)],
    ["duplicate selection", (raw: ReturnType<typeof facts>) => raw.typeFacts.votes[1]!.selections.push({ optionPosition: 0 })],
    ["inconsistent Tally", (raw: ReturnType<typeof facts>) => (raw.typeFacts.options[0]!.count = 1)],
    ["NUL-bearing option cell", (raw: ReturnType<typeof facts>) => (raw.typeFacts.options[0]!.label = "\0=CMD()")],
  ])("fails closed for %s", async (_label, corrupt) => {
    const raw = facts();
    corrupt(raw);
    const value = deps(raw);
    await expect(
      queryOwnerExport(value.ports, POLL, { userId: OWNER }, [value.driver]),
    ).rejects.toThrow();
  });

  it("fails closed when no generic driver is registered for the Poll Type", async () => {
    const value = deps();
    vi.mocked(value.ports.findOwnerEnvelope).mockResolvedValue({
      pollId: POLL,
      canonicalReference: "later",
      pollType: "meeting",
    });
    await expect(
      queryOwnerExport(value.ports, POLL, { userId: OWNER }, [value.driver]),
    ).rejects.toThrow("Unsupported Poll Type export projection");
    expect(value.factDriver.projectFacts).not.toHaveBeenCalled();
  });

  it("rejects duplicate or mismatched Poll Type driver registration", async () => {
    const value = deps();
    await expect(
      queryOwnerExport(value.ports, POLL, { userId: OWNER }, [
        value.driver,
        value.driver,
      ]),
    ).rejects.toThrow("Duplicate Poll Type export projection");
    expect(() =>
      bindExportDriver(value.factDriver, {
        type: "meeting",
        projectExport: multipleChoiceStrategy.projectExport,
      }),
    ).toThrow("Mismatched Poll Type export driver");
  });

  it("rejects Poll Type columns that collide with shared Vote columns", async () => {
    const raw = facts();
    const factDriver: ExportFactDriver<MultipleChoiceExportFacts> = {
      type: "multiple_choice",
      projectFacts: vi.fn(async () => raw),
    };
    const driver = bindExportDriver(factDriver, {
      type: "multiple_choice",
      projectExport: (value) => {
        const projected = multipleChoiceStrategy.projectExport(value);
        if (!projected.ok) return projected;
        return {
          ok: true,
          value: {
            ...projected.value,
            votes: {
              ...projected.value.votes,
              columns: ["TIMESTAMP", "SELECTION 2"],
            },
          },
        };
      },
    });
    await expect(
      queryOwnerExport(deps().ports, POLL, { userId: OWNER }, [driver]),
    ).rejects.toThrow("Conflicting Poll Type export columns");
  });

  it("rejects response rows reordered after their alignment keys are bound", async () => {
    const raw = facts();
    raw.sharedVotes[1]!.createdAtMs = raw.sharedVotes[0]!.createdAtMs;
    raw.typeFacts.votes[1]!.createdAtMs = raw.typeFacts.votes[0]!.createdAtMs;
    const factDriver: ExportFactDriver<MultipleChoiceExportFacts> = {
      type: "multiple_choice",
      projectFacts: vi.fn(async () => raw),
    };
    const driver = bindExportDriver(factDriver, {
      type: "multiple_choice",
      projectExport: (value) => {
        const projected = multipleChoiceStrategy.projectExport(value);
        if (!projected.ok) return projected;
        return {
          ok: true,
          value: {
            ...projected.value,
            votes: {
              ...projected.value.votes,
              rows: [...projected.value.votes.rows].reverse(),
            },
          },
        };
      },
    });
    await expect(
      queryOwnerExport(deps().ports, POLL, { userId: OWNER }, [driver]),
    ).rejects.toThrow("Malformed Poll Type export totals");
  });
});

describe("bounded owner export query", () => {
  it("returns oversize before invoking the Poll Type strategy", async () => {
    const value = deps();
    const projectExport = vi.fn(multipleChoiceStrategy.projectExport);
    const factDriver: BoundedExportFactDriver<MultipleChoiceExportFacts> = {
      type: "multiple_choice",
      projectFacts: vi.fn(async () => ({ status: "oversize" as const })),
    };

    await expect(
      queryBoundedOwnerExport(value.ports, POLL, { userId: OWNER }, [
        bindBoundedExportDriver(factDriver, {
          type: "multiple_choice",
          projectExport,
        }),
      ]),
    ).resolves.toEqual({ status: "oversize" });
    expect(projectExport).not.toHaveBeenCalled();
  });

  it("reuses the canonical validator and materializer for ready facts", async () => {
    const value = deps();
    const factDriver: BoundedExportFactDriver<MultipleChoiceExportFacts> = {
      type: "multiple_choice",
      projectFacts: vi.fn(async () => ({
        status: "ready" as const,
        facts: facts(),
      })),
    };
    const bounded = await queryBoundedOwnerExport(
      value.ports,
      POLL,
      { userId: OWNER },
      [bindBoundedExportDriver(factDriver, multipleChoiceStrategy)],
    );
    const unbounded = await queryOwnerExport(
      value.ports,
      POLL,
      { userId: OWNER },
      [value.driver],
    );
    expect(bounded).toEqual({ status: "ready", export: unbounded });
  });

  it("conceals missing ownership before the bounded fact reader", async () => {
    const value = deps();
    vi.mocked(value.ports.findOwnerEnvelope).mockResolvedValue(null);
    const factDriver: BoundedExportFactDriver<MultipleChoiceExportFacts> = {
      type: "multiple_choice",
      projectFacts: vi.fn(async () => ({ status: "oversize" as const })),
    };
    await expect(
      queryBoundedOwnerExport(value.ports, POLL, { userId: OWNER }, [
        bindBoundedExportDriver(factDriver, multipleChoiceStrategy),
      ]),
    ).resolves.toBeNull();
    expect(factDriver.projectFacts).not.toHaveBeenCalled();
  });
});
