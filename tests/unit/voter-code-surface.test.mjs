import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const panel = readFileSync("src/components/voter-code-panel.astro", "utf8");
const surface = readFileSync("src/components/poll-voting-surface.astro", "utf8");
const delivery = readFileSync("src/lib/poll-delivery.ts", "utf8");

describe("voter-code correction surface", () => {
  it("connects COPY ALL CODES to the generated list ID", () => {
    expect(panel).toContain('data-copy-source={`${id}-voter-code-list`}');
  });

  it("keeps the code control present for every editable code-gated retry", () => {
    expect(surface).toContain(
      "{poll.voterCodesEnabled && !meetingRevisionRecognized && !readOnly && (",
    );
    expect(surface).not.toContain("voterCodeRejected");
  });

  it("canonicalizes a submitted code before bounding its retry echo", () => {
    expect(delivery).toContain('singletonText(formData, "voter_code").trim().toUpperCase()');
  });
});
