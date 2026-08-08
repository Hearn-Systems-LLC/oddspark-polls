import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const deliverySource = readFileSync("src/lib/poll-delivery.ts", "utf8");
const pollOptionSource = readFileSync("src/components/poll-option.astro", "utf8");
const votingSurfaceSource = readFileSync(
  "src/components/poll-voting-surface.astro",
  "utf8",
);
const resultsTallySource = readFileSync(
  "src/components/results-tally.astro",
  "utf8",
);
const resultsBarSource = readFileSync("src/components/results-bar.astro", "utf8");
const liveCoreSource = readFileSync(
  "src/scripts/results-live-core.ts",
  "utf8",
);

describe("Story 6.2 image-poll voter surface contract", () => {
  describe("showReadOnlyOptions defect fix (AC 4)", () => {
    it("includes image polls in the read-only option list condition", () => {
      // The original defect was `poll.pollType === "multiple_choice"` only.
      // Image polls share MC single-select semantics and need the same
      // already-voted / closed read-only surface with cast selection ◆.
      expect(deliverySource).toMatch(
        /poll\.pollType === "multiple_choice" \|\| poll\.pollType === "image"/,
      );
    });

    it("keeps multi-select gated to multiple_choice only", () => {
      // Image polls are always single-select per migration 0014 + definition.
      // Multi-select CSS hooks and bounds logic must stay MC-only.
      expect(deliverySource).toMatch(
        /const multiSelect = poll\.pollType === "multiple_choice" && poll\.multiSelectEnabled/,
      );
    });
  });

  describe("poll-option media plate markup (AC 1, 2)", () => {
    it("accepts an optional media prop with mediaId, altText, caption", () => {
      expect(pollOptionSource).toContain(
        'media?: { mediaId: string; altText: string; caption: string | null }',
      );
    });

    it("renders a square plate img with lazy loading and async decoding", () => {
      expect(pollOptionSource).toContain('class="poll-option-plate"');
      expect(pollOptionSource).toContain('src={`/media/${media.mediaId}`}');
      expect(pollOptionSource).toContain("alt={media.altText}");
      expect(pollOptionSource).toContain('loading="lazy"');
      expect(pollOptionSource).toContain('decoding="async"');
    });

    it("omits the caption element entirely when caption is null", () => {
      expect(pollOptionSource).toContain("media.caption !== null");
      expect(pollOptionSource).toContain('class="poll-option-caption"');
    });

    it("preserves the native input + marker gutter for image rows", () => {
      // The visually-hidden input and marker ::before must remain exactly
      // as-is — replacing them with ARIA hand-rolling violates the
      // accessibility floor (EXPERIENCE.md L291).
      expect(pollOptionSource).toContain(
        'class="visually-hidden poll-option-input"',
      );
      expect(pollOptionSource).toContain('class="poll-option-marker"');
      expect(pollOptionSource).toContain(".poll-option-marker::before");
    });

    it("uses aspect-ratio for layout stability without stored dimensions", () => {
      expect(pollOptionSource).toContain("aspect-ratio: 1 / 1");
      expect(pollOptionSource).toContain("object-fit: cover");
      expect(pollOptionSource).toContain("border-radius: 0");
    });

    it("aligns the marker to the top of the plate for image rows", () => {
      expect(pollOptionSource).toContain(".poll-option-image");
      expect(pollOptionSource).toContain("align-items: flex-start");
    });

    it("uses color-text for captions, not dim or faint", () => {
      // Caption is option-identifying text; DESIGN.md bans faint on
      // must-read text. Parallel: results-bar count rejected dim.
      expect(pollOptionSource).toMatch(
        /\.poll-option-caption\s*\{[^}]*color:\s*var\(--color-text\)/,
      );
      expect(pollOptionSource).not.toMatch(
        /\.poll-option-caption\s*\{[^}]*--color-dim/,
      );
      expect(pollOptionSource).not.toMatch(
        /\.poll-option-caption\s*\{[^}]*--color-faint/,
      );
    });

    it("never uses set:html or innerHTML", () => {
      expect(pollOptionSource).not.toContain("set:html");
      expect(pollOptionSource).not.toContain("innerHTML");
    });
  });

  describe("voting surface media plumbing (AC 1, 3)", () => {
    it("passes media to PollOption in the vote form branch", () => {
      expect(votingSurfaceSource).toMatch(
        /<PollOption[^>]*media=\{option\.media\}[^>]*\/>/,
      );
    });

    it("passes media to PollOption in the read-only branch", () => {
      // Both branches need media so already-voted / closed states show
      // plates with the cast selection marked ◆ (AC 4).
      const readOnlyMatches = votingSurfaceSource.match(
        /<PollOption[^>]*readOnly[^>]*\/>/g,
      );
      expect(readOnlyMatches).not.toBeNull();
      for (const match of readOnlyMatches ?? []) {
        expect(match).toContain("media={option.media}");
      }
    });

    it("marks the cast selection in the read-only branch via yourBallotOptionIds", () => {
      expect(votingSurfaceSource).toContain(
        'checked={poll.pollType === "image" && yourBallotOptionIds.includes(option.id)}',
      );
    });
  });

  describe("results tally plate rendering (AC 2, 3)", () => {
    it("renders a plate+caption sibling above each ResultsBar", () => {
      expect(resultsTallySource).toContain('class="results-tally-plate"');
      expect(resultsTallySource).toContain(
        'class="results-tally-plate-image"',
      );
      expect(resultsTallySource).toContain(
        'class="results-tally-plate-caption"',
      );
    });

    it("keeps ResultsBar internals byte-identical (no media props)", () => {
      // results-bar.astro must NOT gain media/plate props — the bar track
      // is 34/38px with overflow:hidden and cannot hold a plate. The word
      // "media" appears only in CSS @media queries, never as a prop name.
      expect(resultsBarSource).not.toContain("media?:");
      expect(resultsBarSource).not.toContain("media:");
      expect(resultsBarSource).not.toContain("plate");
    });

    it("omits caption element when caption is null", () => {
      expect(resultsTallySource).toContain("option.media.caption !== null");
    });

    it("uses color-text for plate captions, not dim or faint", () => {
      expect(resultsTallySource).toMatch(
        /\.results-tally-plate-caption\s*\{[^}]*color:\s*var\(--color-text\)/,
      );
    });

    it("uses aspect-ratio for plate layout stability", () => {
      expect(resultsTallySource).toContain("aspect-ratio: 1 / 1");
      expect(resultsTallySource).toContain("object-fit: cover");
    });
  });

  describe("live payload exact-key contract untouched (Trap 2)", () => {
    it("keeps the option key list unchanged (no media keys)", () => {
      // hasExactKeys rejects ANY extra key. Media must never appear here.
      expect(liveCoreSource).toContain('"id"');
      expect(liveCoreSource).toContain('"label"');
      expect(liveCoreSource).toContain('"position"');
      expect(liveCoreSource).toContain('"count"');
      expect(liveCoreSource).toContain('"percent"');
      expect(liveCoreSource).toContain('"pieShare"');
      expect(liveCoreSource).toContain('"leading"');
      // Verify media is NOT in the option key list
      const optionKeysMatch = liveCoreSource.match(
        /hasExactKeys\(option,\s*\[([\s\S]*?)\]\)/,
      );
      expect(optionKeysMatch).not.toBeNull();
      const optionKeysContent = optionKeysMatch ? optionKeysMatch[1] : "";
      expect(optionKeysContent).not.toContain("media");
      expect(optionKeysContent).not.toContain("mediaId");
      expect(optionKeysContent).not.toContain("altText");
    });
  });
});
