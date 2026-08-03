import { describe, expect, it, vi } from "vitest";
import {
  LIFECYCLE_COPY,
  closePoll,
  deletePoll,
  updatePollDefinition,
  updatePollDescription,
  validatePollDefinition,
  type PollLifecycleSnapshot,
} from "../../src/modules/polls/index";
import type {
  PollId,
  PollOptionId,
  UserId,
} from "../../src/shared/domain/index";
import { POLL_CAPS } from "../../src/modules/polls/caps";

const NOW = 1_800_000_000_000;
const POLL_ID = "poll-1" as PollId;
const OWNER = "owner-1" as UserId;
const OPTION_A = "opt-a" as PollOptionId;
const OPTION_B = "opt-b" as PollOptionId;

function snapshot(
  overrides: Partial<PollLifecycleSnapshot> = {},
): PollLifecycleSnapshot {
  return {
    pollId: POLL_ID,
    ownerUserId: OWNER,
    pollType: "multiple_choice",
    question: "Where should we eat?",
    description: null,
    multiSelectEnabled: false,
    minSelections: null,
    maxSelections: null,
    sessionChecksEnabled: true,
    ipChecksEnabled: false,
    voterCodesEnabled: false,
    captchaEnabled: false,
    vpnBlockingEnabled: false,
    options: [
      { id: OPTION_A, label: "Pizza", position: 0 },
      { id: OPTION_B, label: "Tacos", position: 1 },
    ],
    deadlineMs: null,
    closedAtMs: null,
    representationVersion: 1,
    voterCount: 0,
    ...overrides,
  };
}

describe("validatePollDefinition (shared create/edit)", () => {
  it("accepts a minimal definition", () => {
    const result = validatePollDefinition({
      question: "Where?",
      description: "",
      options: ["A", "B"],
      multiSelect: "false",
      minSelections: "",
      maxSelections: "",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.description).toBeNull();
      expect(result.value.options).toHaveLength(2);
    }
  });

  it("rejects blank question and insufficient options with create copy", () => {
    const result = validatePollDefinition({
      question: "  ",
      description: "",
      options: ["Only"],
      multiSelect: "false",
      minSelections: "",
      maxSelections: "",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.fieldErrors?.question).toBeDefined();
      expect(result.error.fieldErrors?.options).toBeDefined();
    }
  });

  it("counts description by Unicode code points", () => {
    const tooLong = "🙂".repeat(POLL_CAPS.maxDescriptionLength + 1);
    const result = validatePollDefinition({
      question: "Q",
      description: tooLong,
      options: ["A", "B"],
      multiSelect: "false",
      minSelections: "",
      maxSelections: "",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reasonCodes?.description).toBe(
        "description_too_long",
      );
    }
  });
});

describe("closePoll", () => {
  it("closes an open Poll once", async () => {
    const close = vi.fn(async () => "closed" as const);
    const result = await closePoll(
      {
        loadOwnedPoll: async () => snapshot(),
        closePoll: close,
        nowMs: () => NOW,
      },
      POLL_ID,
      OWNER,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe("closed");
      expect(result.value.closedAtMs).toBe(NOW);
    }
    expect(close).toHaveBeenCalledOnce();
  });

  it("is idempotent when already manually closed", async () => {
    const close = vi.fn(async () => "closed" as const);
    const result = await closePoll(
      {
        loadOwnedPoll: async () =>
          snapshot({ closedAtMs: NOW - 1000 }),
        closePoll: close,
        nowMs: () => NOW,
      },
      POLL_ID,
      OWNER,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe("already_closed");
      expect(result.value.closedAtMs).toBe(NOW - 1000);
    }
    expect(close).not.toHaveBeenCalled();
  });

  it("treats a deadline at now as closed without writing", async () => {
    const close = vi.fn(async () => "closed" as const);
    const result = await closePoll(
      {
        loadOwnedPoll: async () => snapshot({ deadlineMs: NOW }),
        closePoll: close,
        nowMs: () => NOW,
      },
      POLL_ID,
      OWNER,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe("already_closed");
    }
    expect(close).not.toHaveBeenCalled();
  });

  it("returns poll_not_found for missing or non-owned Polls", async () => {
    const result = await closePoll(
      {
        loadOwnedPoll: async () => null,
        closePoll: async () => "closed",
        nowMs: () => NOW,
      },
      POLL_ID,
      OWNER,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("poll_not_found");
      expect(result.error.message).toBe(LIFECYCLE_COPY.notFound);
    }
  });
});

describe("updatePollDescription", () => {
  it("no-ops identical descriptions without a write", async () => {
    const update = vi.fn(async () => "updated" as const);
    const result = await updatePollDescription(
      {
        loadOwnedPoll: async () =>
          snapshot({ description: "Hello" }),
        updateDescription: update,
        nowMs: () => NOW,
      },
      POLL_ID,
      OWNER,
      "  Hello  ",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe("unchanged");
    }
    expect(update).not.toHaveBeenCalled();
  });

  it("updates after a Vote has been cast", async () => {
    const update = vi.fn(async () => "updated" as const);
    const result = await updatePollDescription(
      {
        loadOwnedPoll: async () =>
          snapshot({ voterCount: 3, description: null }),
        updateDescription: update,
        nowMs: () => NOW,
      },
      POLL_ID,
      OWNER,
      "New notes",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe("updated");
      expect(result.value.description).toBe("New notes");
    }
    expect(update).toHaveBeenCalledOnce();
  });

  it("treats a same-value persistence race as unchanged", async () => {
    const result = await updatePollDescription(
      {
        loadOwnedPoll: async () => snapshot({ description: "Old" }),
        updateDescription: async () => "unchanged",
        nowMs: () => NOW,
      },
      POLL_ID,
      OWNER,
      "New",
    );
    expect(result).toEqual({
      ok: true,
      value: { kind: "unchanged", description: "New" },
    });
  });
});

describe("updatePollDefinition", () => {
  it("returns unchanged when nothing material changes", async () => {
    const updateDef = vi.fn(async () => "updated" as const);
    const result = await updatePollDefinition(
      {
        loadOwnedPoll: async () => snapshot(),
        updateDefinition: updateDef,
        updateDescription: async () => "updated",
        generateId: () => "new-id",
        nowMs: () => NOW,
      },
      POLL_ID,
      OWNER,
      {
        question: "Where should we eat?",
        description: "",
        options: ["Pizza", "Tacos"],
        multiSelect: "false",
        minSelections: "",
        maxSelections: "",
      },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe("unchanged");
    }
    expect(updateDef).not.toHaveBeenCalled();
  });

  it("routes description-only deltas without churning options", async () => {
    const updateDesc = vi.fn(async () => "updated" as const);
    const updateDef = vi.fn(async () => "updated" as const);
    const result = await updatePollDefinition(
      {
        loadOwnedPoll: async () => snapshot(),
        updateDefinition: updateDef,
        updateDescription: updateDesc,
        generateId: () => "new-id",
        nowMs: () => NOW,
      },
      POLL_ID,
      OWNER,
      {
        question: "Where should we eat?",
        description: "Notes",
        options: ["Pizza", "Tacos"],
        multiSelect: "false",
        minSelections: "",
        maxSelections: "",
      },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe("description_only");
    }
    expect(updateDesc).toHaveBeenCalledOnce();
    expect(updateDef).not.toHaveBeenCalled();
  });

  it("locks definition once any Vote exists", async () => {
    const updateDef = vi.fn(async () => "updated" as const);
    const result = await updatePollDefinition(
      {
        loadOwnedPoll: async () => snapshot({ voterCount: 1 }),
        updateDefinition: updateDef,
        updateDescription: async () => "updated",
        generateId: () => "new-id",
        nowMs: () => NOW,
      },
      POLL_ID,
      OWNER,
      {
        question: "Changed?",
        description: "",
        options: ["X", "Y"],
        multiSelect: "false",
        minSelections: "",
        maxSelections: "",
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("poll_definition_locked");
      expect(result.error.message).toBe(LIFECYCLE_COPY.definitionLocked);
    }
    expect(updateDef).not.toHaveBeenCalled();
  });

  it("maps a D1 locked race to poll_definition_locked", async () => {
    const result = await updatePollDefinition(
      {
        loadOwnedPoll: async () => snapshot(),
        updateDefinition: async () => "locked",
        updateDescription: async () => "updated",
        generateId: () => "new-id",
        nowMs: () => NOW,
      },
      POLL_ID,
      OWNER,
      {
        question: "Changed?",
        description: "",
        options: ["X", "Y"],
        multiSelect: "false",
        minSelections: "",
        maxSelections: "",
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("poll_definition_locked");
    }
  });

  it("rejects definition edits for unsupported stored Poll types", async () => {
    const updateDef = vi.fn(async () => "updated" as const);
    const result = await updatePollDefinition(
      {
        loadOwnedPoll: async () => snapshot({ pollType: "ranked_choice" }),
        updateDefinition: updateDef,
        updateDescription: async () => "updated",
        generateId: () => "new-id",
        nowMs: () => NOW,
      },
      POLL_ID,
      OWNER,
      {
        question: "Changed?",
        description: "",
        options: ["X", "Y"],
        multiSelect: "false",
        minSelections: "",
        maxSelections: "",
      },
    );
    expect(result).toEqual({
      ok: false,
      error: {
        code: "poll_type_unsupported",
        message: LIFECYCLE_COPY.unsupportedPollType,
      },
    });
    expect(updateDef).not.toHaveBeenCalled();
  });

  it("maps a stale definition version to an explicit conflict", async () => {
    const result = await updatePollDefinition(
      {
        loadOwnedPoll: async () => snapshot({ representationVersion: 7 }),
        updateDefinition: async (input) => {
          expect(input.expectedRepresentationVersion).toBe(7);
          return "conflict";
        },
        updateDescription: async () => "updated",
        generateId: () => "new-id",
        nowMs: () => NOW,
      },
      POLL_ID,
      OWNER,
      {
        question: "Changed?",
        description: "",
        options: ["X", "Y"],
        multiSelect: "false",
        minSelections: "",
        maxSelections: "",
      },
    );
    expect(result).toEqual({
      ok: false,
      error: {
        code: "poll_definition_conflict",
        message: LIFECYCLE_COPY.definitionConflict,
      },
    });
  });
});

describe("deletePoll", () => {
  it("deletes an owned Poll", async () => {
    const del = vi.fn(async () => "deleted" as const);
    const result = await deletePoll(
      {
        loadOwnedPoll: async () => snapshot({ voterCount: 4 }),
        deletePoll: del,
      },
      POLL_ID,
      OWNER,
    );
    expect(result.ok).toBe(true);
    expect(del).toHaveBeenCalledOnce();
  });

  it("returns poll_not_found without deleting a foreign Poll", async () => {
    const del = vi.fn(async () => "deleted" as const);
    const result = await deletePoll(
      {
        loadOwnedPoll: async () => null,
        deletePoll: del,
      },
      POLL_ID,
      OWNER,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("poll_not_found");
    }
    expect(del).not.toHaveBeenCalled();
  });
});
