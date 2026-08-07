import { describe, expect, it } from "vitest";
import {
  imageStrategy,
  IMAGE_DEFINITION_COPY,
} from "../../src/modules/polls/types/image";
import { multipleChoiceStrategy } from "../../src/modules/polls/types/multiple-choice";

describe("image strategy", () => {
  it("has type 'image' and contract version matching MC", () => {
    expect(imageStrategy.type).toBe("image");
    expect(imageStrategy.contractVersion).toBe(
      multipleChoiceStrategy.contractVersion,
    );
  });

  describe("create", () => {
    it("produces creation facts with media when all inputs are valid", () => {
      const result = imageStrategy.create(
        {
          optionLabels: ["Cat", "Dog"],
          media: [
            { mediaId: "m-1", altText: "A tabby cat", caption: "My cat" },
            { mediaId: "m-2", altText: "A golden retriever", caption: "" },
          ],
        },
        { nowMs: 0 },
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.options).toEqual([
        { label: "Cat", position: 0 },
        { label: "Dog", position: 1 },
      ]);
      expect(result.value.multiSelect).toBe(false);
      expect(result.value.minSelections).toBeNull();
      expect(result.value.maxSelections).toBeNull();
      expect(result.value.media).toEqual([
        { mediaId: "m-1", altText: "A tabby cat", caption: "My cat" },
        { mediaId: "m-2", altText: "A golden retriever", caption: null },
      ]);
    });

    it("rejects when media count does not match option count", () => {
      const result = imageStrategy.create(
        {
          optionLabels: ["Cat", "Dog"],
          media: [{ mediaId: "m-1", altText: "A tabby cat", caption: "" }],
        },
        { nowMs: 0 },
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.fieldErrors?.media).toBe(
        IMAGE_DEFINITION_COPY.mediaCountMismatch,
      );
      expect(result.error.reasonCodes?.media).toBe("media_count_mismatch");
    });

    it("rejects when alt text is missing for an option", () => {
      const result = imageStrategy.create(
        {
          optionLabels: ["Cat", "Dog"],
          media: [
            { mediaId: "m-1", altText: "A tabby cat", caption: "" },
            { mediaId: "m-2", altText: "   ", caption: "" },
          ],
        },
        { nowMs: 0 },
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.fieldErrors?.["media[1].altText"]).toBe(
        IMAGE_DEFINITION_COPY.altTextMissing,
      );
      expect(result.error.reasonCodes?.["media[1].altText"]).toBe(
        "alt_text_missing",
      );
    });

    it("rejects when media id is missing for an option", () => {
      const result = imageStrategy.create(
        {
          optionLabels: ["Cat", "Dog"],
          media: [
            { mediaId: "m-1", altText: "A tabby cat", caption: "" },
            { mediaId: "", altText: "A dog", caption: "" },
          ],
        },
        { nowMs: 0 },
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.fieldErrors?.["media[1].mediaId"]).toBe(
        IMAGE_DEFINITION_COPY.mediaIdMissing,
      );
    });

    it("trims whitespace from alt text and caption", () => {
      const result = imageStrategy.create(
        {
          optionLabels: ["Cat"],
          media: [
            {
              mediaId: "  m-1  ",
              altText: "  A tabby cat  ",
              caption: "  My cat  ",
            },
          ],
        },
        { nowMs: 0 },
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.media[0]).toEqual({
        mediaId: "m-1",
        altText: "A tabby cat",
        caption: "My cat",
      });
    });

    it("delegates option normalization to MC (labels become positioned options)", () => {
      const result = imageStrategy.create(
        {
          optionLabels: ["Cat", "Dog"],
          media: [
            { mediaId: "m-1", altText: "Alt 1", caption: "" },
            { mediaId: "m-2", altText: "Alt 2", caption: "" },
          ],
        },
        { nowMs: 0 },
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.options.length).toBe(2);
      expect(result.value.multiSelect).toBe(false);
    });
  });

  describe("validateSubmission delegates to MC", () => {
    it("accepts a valid single selection", () => {
      const result = imageStrategy.validateSubmission(
        { selectedOptionIds: ["opt-1"] },
        {
          options: [
            { id: "opt-1" as any, label: "Cat", position: 0 },
            { id: "opt-2" as any, label: "Dog", position: 1 },
          ],
          multiSelectEnabled: false,
          minSelections: null,
          maxSelections: null,
        },
      );
      expect(result.ok).toBe(true);
    });

    it("rejects empty selection", () => {
      const result = imageStrategy.validateSubmission(
        { selectedOptionIds: [] },
        {
          options: [
            { id: "opt-1" as any, label: "Cat", position: 0 },
            { id: "opt-2" as any, label: "Dog", position: 1 },
          ],
          multiSelectEnabled: false,
          minSelections: null,
          maxSelections: null,
        },
      );
      expect(result.ok).toBe(false);
    });
  });

  describe("persistFacts delegates to MC", () => {
    it("returns selections in MC format", () => {
      const result = imageStrategy.persistFacts!({
        selectedOptionIds: ["opt-1" as any],
      });
      expect(result).toEqual({
        selections: [{ pollOptionId: "opt-1" }],
      });
    });
  });

  describe("projectResults delegates to MC", () => {
    it("returns per-option counts", () => {
      const result = imageStrategy.projectResults!({
        votes: [{ selections: [{ pollOptionId: "opt-1" as any }] }],
        options: [{ id: "opt-1" as any }, { id: "opt-2" as any }],
      });
      expect(result.voterCount).toBe(1);
      expect(result.options).toEqual([
        { pollOptionId: "opt-1", count: 1 },
        { pollOptionId: "opt-2", count: 0 },
      ]);
    });
  });

  describe("projectExport delegates to MC", () => {
    it("returns a valid export projection", () => {
      const result = imageStrategy.projectExport({
        multiSelectEnabled: false,
        minSelections: null,
        maxSelections: null,
        options: [
          { label: "Cat", position: 0, count: 1 },
          { label: "Dog", position: 1, count: 0 },
        ],
        votes: [
          {
            alignmentKey: 0,
            createdAtMs: 1000,
            selections: [{ optionPosition: 0 }],
          },
        ],
        voterCount: 1,
        selectionCount: 1,
      });
      expect(result.ok).toBe(true);
    });
  });
});
