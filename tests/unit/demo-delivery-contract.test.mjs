import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = readFileSync("src/pages/index.astro", "utf8");
const footer = readFileSync("src/components/landing-footer.astro", "utf8");
const pollPage = readFileSync("src/pages/[reference].astro", "utf8");
const delivery = readFileSync("src/lib/poll-delivery.ts", "utf8");
const surface = readFileSync(
  "src/components/poll-voting-surface.astro",
  "utf8",
);
const resultsBar = readFileSync("src/components/results-bar.astro", "utf8");

describe("shared Demo delivery contract", () => {
  it("uses one delivery helper and one voting surface on both public pages", () => {
    for (const page of [root, pollPage]) {
      expect(page).toContain("deliverPollVotingSurface");
      expect(page).toContain("<PollVotingSurface");
    }
    expect(root).not.toContain("castVote(");
    expect(pollPage).not.toContain("castVote(");
    expect(delivery).toContain("castVote(");
  });

  it("parameterizes the embedded action, redirect, canonical share, and live endpoint", () => {
    expect(root).toContain('formAction="/"');
    expect(root).toContain('successRedirect: "/"');
    expect(root).toContain("state.poll.canonicalReference");
    expect(root).toContain("/results/live");
    expect(root).toContain("embedded");
    expect(pollPage).toContain("successRedirect: `/${reference}`");
  });

  it("allows GET HEAD POST and keeps the Demo operational failure private", () => {
    expect(delivery).toContain('method !== "GET" && method !== "HEAD" && method !== "POST"');
    expect(delivery).toContain('allow: "GET, HEAD, POST"');
    expect(root).toContain('"cache-control", "private, no-store"');
    expect(root).toContain("DEMO_POLL_COPY.unavailableTitle");
    expect(root).toContain("DEMO_POLL_COPY.unavailableHeading");
    expect(root).toContain("DEMO_POLL_COPY.unavailableBody");
  });

  it("renders one persisted-truth badge and entropy leadership while editable", () => {
    expect(surface.match(/<TrustBadge toggles=\{pollToggles\} \/>/g)).toHaveLength(1);
    expect(surface).toContain("toggles={tallyOwnsBadge ? pollToggles : undefined}");
    expect(surface).toContain('leadership={embedded && !readOnly ? "entropy" : "canonical"}');
    expect(resultsBar).toContain('data-leadership="entropy"');
  });

  it("keeps the honest no-JavaScript CAPTCHA floor and VOTE as the sole primary", () => {
    expect(surface).toContain("JavaScript is required for the human check on this Poll.");
    expect(surface).toContain(">VOTE</ButtonPrimary>");
    expect(root).not.toContain("ButtonPrimary");
    expect(root).toContain("<LandingFooter");
    expect(footer).toContain('class="label-caps landing-footer-link" href="/creator/new"');
  });
});
