import { describe, expect, it, vi } from "vitest";
import {
  drainCleanupOutbox,
  replaceOptionImage,
  sweepTempKeys,
  type CleanupOutboxRow,
  type TempObject,
} from "../../src/modules/media/index";
import type {
  PollId,
  PollOptionId,
  UserId,
} from "../../src/shared/domain/index";

const NOW = 1_784_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;

function cleanupRow(id: number): CleanupOutboxRow {
  return {
    id: `cleanup-${id}`,
    r2Key: `tmp/poll/media-${id}`,
    enqueuedAtMs: NOW - id,
    attempts: 0,
  };
}

describe("drainCleanupOutbox", () => {
  it("bounds work, clears successful rows, and increments failures", async () => {
    const rows = Array.from({ length: 100 }, (_, index) => cleanupRow(index));
    const deleteObject = vi.fn(async (key: string) => {
      if (key.endsWith("media-3")) throw new Error("R2 unavailable");
    });
    const deleteRow = vi.fn(async () => undefined);
    const incrementAttempts = vi.fn(async () => undefined);
    const listDue = vi.fn(async () => rows);

    const result = await drainCleanupOutbox({
      outbox: { listDue, deleteRow, incrementAttempts },
      objects: { deleteObject },
    });

    expect(listDue).toHaveBeenCalledWith(100);
    expect(deleteObject).toHaveBeenCalledTimes(100);
    expect(deleteRow).toHaveBeenCalledTimes(99);
    expect(deleteRow).not.toHaveBeenCalledWith("cleanup-3");
    expect(incrementAttempts).toHaveBeenCalledWith("cleanup-3");
    expect(result).toEqual({ selected: 100, deleted: 99, failed: 1 });
  });
});

describe("sweepTempKeys", () => {
  it("deletes only old unadopted temp keys", async () => {
    const objects: TempObject[] = [
      { key: "tmp/poll/adopted", uploadedAtMs: NOW - DAY_MS - 1 },
      { key: "tmp/poll/orphan", uploadedAtMs: NOW - DAY_MS - 1 },
      { key: "tmp/poll/young", uploadedAtMs: NOW - DAY_MS + 1 },
    ];
    const deleteObject = vi.fn(async () => undefined);

    const result = await sweepTempKeys({
      objects: {
        listTempKeys: async () => ({ objects, truncated: false }),
        deleteObject,
      },
      ownership: {
        findAdoptedKeys: async () => new Set(["tmp/poll/adopted"]),
      },
      nowMs: () => NOW,
    });

    expect(deleteObject).toHaveBeenCalledOnce();
    expect(deleteObject).toHaveBeenCalledWith("tmp/poll/orphan");
    expect(result).toEqual({ listed: 3, eligible: 2, adopted: 1, deleted: 1 });
  });

  it("fails closed when the D1 adoption check fails", async () => {
    const deleteObject = vi.fn(async () => undefined);

    await expect(
      sweepTempKeys({
        objects: {
          listTempKeys: async () => ({
            objects: [{ key: "tmp/poll/orphan", uploadedAtMs: 0 }],
            truncated: false,
          }),
          deleteObject,
        },
        ownership: {
          findAdoptedKeys: async () => {
            throw new Error("D1 unavailable");
          },
        },
        nowMs: () => NOW,
      }),
    ).rejects.toThrow("D1 unavailable");
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it("chunks D1 adoption checks to at most 100 keys", async () => {
    const objects = Array.from({ length: 205 }, (_, index) => ({
      key: `tmp/poll/orphan-${index}`,
      uploadedAtMs: 0,
    }));
    const chunkSizes: number[] = [];

    await sweepTempKeys({
      objects: {
        listTempKeys: async () => ({ objects, truncated: false }),
        deleteObject: async () => undefined,
      },
      ownership: {
        findAdoptedKeys: async (keys) => {
          chunkSizes.push(keys.length);
          return new Set();
        },
      },
      nowMs: () => NOW,
    });

    expect(chunkSizes).toEqual([100, 100, 5]);
  });
});

describe("replaceOptionImage", () => {
  it("injects the command clock into the Media persistence operation", async () => {
    const persist = vi.fn(async () => "replaced" as const);
    const result = await replaceOptionImage(
      { replaceOptionImage: persist, nowMs: () => NOW },
      {
        pollId: "poll-1" as PollId,
        ownerUserId: "owner-1" as UserId,
        optionId: "option-1" as PollOptionId,
        r2Key: "tmp/poll-1/new-media",
        contentType: "image/webp",
        sizeBytes: 42,
        altText: "New image",
        caption: null,
      },
    );

    expect(result).toEqual({ ok: true, value: { kind: "replaced" } });
    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({ enqueuedAtMs: NOW }),
    );
  });
});
