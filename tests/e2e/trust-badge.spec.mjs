import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import {
  assertUuid,
  cleanupCreator,
  d1Execute,
  hasBetterAuthSecret,
  requireBaseUrl,
  seedCreatorSession,
} from "./creator-session.mjs";

// Story 2.4 — Trust Badge: enforced-only voter-terms lines above the vote
// button, absent when every Toggle is off, stacking at 375px, persisting on
// both Tally surfaces, computed-style proof in dark and light.

if (!hasBetterAuthSecret()) {
  throw new Error(
    "Story 2.4 E2E requires BETTER_AUTH_SECRET in .dev.vars; skipping trust badge proof is forbidden",
  );
}

const proofDir = "test-results/story-2-4-trust-badge-proof";
mkdirSync(proofDir, { recursive: true });

test.describe.configure({ mode: "serial", timeout: 180_000 });

const ALL_TOGGLES = [
  "sessionChecks",
  "ipChecks",
  "voterCodes",
  "captcha",
  "vpnBlocking",
];

// Resolved token values (src/styles/tokens.css) for computed-style proof.
const DARK = {
  text: "rgb(198, 207, 216)",
  rule: "rgb(29, 36, 44)",
  entropy: "rgb(110, 143, 184)",
};
const LIGHT = {
  text: "rgb(26, 32, 40)",
  rule: "rgb(216, 222, 228)",
  entropy: "rgb(61, 100, 145)",
};

test.describe("Trust Badge", () => {
  const seededUserIds = [];
  let browserErrors = [];

  function observePage(page) {
    page.on("console", (message) => {
      if (message.type() === "error") {
        browserErrors.push(message.text());
      }
    });
    page.on("pageerror", (error) => {
      browserErrors.push(error.message);
    });
    return page;
  }

  test.beforeEach(() => {
    browserErrors = [];
  });

  test.afterEach(() => {
    expect(browserErrors).toEqual([]);
  });

  test.afterAll(() => {
    for (const userId of seededUserIds) {
      cleanupCreator(userId);
    }
  });

  async function seedOwner() {
    const seeded = await seedCreatorSession();
    assertUuid(seeded.userId);
    seededUserIds.push(seeded.userId);
    return seeded;
  }

  // Direct D1 seeding (live-results pattern): full control of all five toggle
  // columns without driving the creator UI for every fixture.
  function seedPoll({ ownerId, reference, toggles = {}, votes = 0 }) {
    assertUuid(ownerId);
    const pollId = randomUUID();
    const optionA = randomUUID();
    const optionB = randomUUID();
    const nowMs = Date.now();
    const flag = (key, fallback) => (toggles[key] ?? fallback ? 1 : 0);
    const statements = [
      `INSERT INTO poll (id, owner_user_id, poll_type, question, result_visibility, session_checks_enabled, ip_checks_enabled, voter_codes_enabled, captcha_enabled, vpn_blocking_enabled, multi_select_enabled, min_selections, max_selections, deadline_ms, closed_at_ms, representation_version, created_at_ms, updated_at_ms) VALUES ('${pollId}', '${ownerId}', 'multiple_choice', 'Trust badge e2e?', 'live', ${flag("sessionChecks", true)}, ${flag("ipChecks", false)}, ${flag("voterCodes", false)}, ${flag("captcha", false)}, ${flag("vpnBlocking", false)}, 0, NULL, NULL, NULL, NULL, ${1 + votes}, ${nowMs}, ${nowMs});`,
      `INSERT INTO poll_option (id, poll_id, label, position, created_at_ms) VALUES ('${optionA}', '${pollId}', 'Alpha', 0, ${nowMs});`,
      `INSERT INTO poll_option (id, poll_id, label, position, created_at_ms) VALUES ('${optionB}', '${pollId}', 'Beta', 1, ${nowMs});`,
      `INSERT INTO poll_reference (reference, poll_id, kind, is_canonical, created_at_ms) VALUES ('${reference}', '${pollId}', 'custom', 1, ${nowMs});`,
    ];
    for (let index = 0; index < votes; index += 1) {
      const voteId = randomUUID();
      statements.push(
        `INSERT INTO vote (id, poll_id, submission_id, payload_hash, created_at_ms) VALUES ('${voteId}', '${pollId}', '${randomUUID()}', 'seed-badge-${index}', ${nowMs});`,
        `INSERT INTO vote_selection (vote_id, poll_option_id) VALUES ('${voteId}', '${optionA}');`,
      );
    }
    d1Execute(statements.join(""));
    return {
      pollId,
      pollPath: `/${reference}`,
      resultsPath: `/${reference}/results`,
    };
  }

  async function castVote(page, poll, optionLabel = "Alpha") {
    await page.goto(poll.pollPath);
    await page.locator("label.poll-option", { hasText: optionLabel }).click();
    await page.getByRole("button", { name: "VOTE" }).click();
    await expect(page).toHaveTitle(/Counted — /u);
  }

  async function expectBadgeStyles(page, theme) {
    const root = page.locator("[data-trust-badge]");
    const item = root.locator(".trust-badge-item").first();
    const glyph = root.locator(".trust-badge-glyph");
    await expect(item).toHaveCSS("font-size", "12px");
    await expect(item).toHaveCSS("color", theme.text);
    await expect(item).toHaveCSS("text-transform", "uppercase");
    await expect(root).toHaveCSS("border-top-width", "1px");
    await expect(root).toHaveCSS("border-top-style", "solid");
    await expect(root).toHaveCSS("border-top-color", theme.rule);
    await expect(glyph).toHaveCSS("color", theme.entropy);
    await expect(glyph).toHaveCSS("font-size", "11px");
  }

  async function expectNoTrustOverclaims(page) {
    const html = await page.content();
    expect(html).not.toMatch(/verified|secure|shield|padlock/iu);
    // No shield or lock iconography anywhere on the surface.
    expect(html).not.toMatch(/[\u{1F6E1}\u{1F512}\u{1F513}\u{1F510}\u{1F5DD}]/u);
  }

  test("sits above the vote button on a session-only Poll, styled in dark and light", async ({
    page,
  }) => {
    observePage(page);
    const owner = await seedOwner();
    const poll = seedPoll({ ownerId: owner.userId, reference: `badge-session-${randomUUID().slice(0, 8)}` });
    await page.goto(poll.pollPath);

    const badge = page.locator("[data-trust-badge]");
    await expect(badge).toHaveCount(1);
    await expect(badge).toContainText("ONE VOTE PER BROWSER");
    await expect(badge).not.toContainText("ONE VOTE PER NETWORK");
    await expect(badge).not.toContainText("INVITE CODE REQUIRED");
    // Document order: badge before the vote-action block (hint/challenge/VOTE).
    const badgeBeforeAction = await page.evaluate(() => {
      const badgeEl = document.querySelector("[data-trust-badge]");
      const action = document.querySelector(".vote-action");
      if (!badgeEl || !action) return false;
      return Boolean(
        badgeEl.compareDocumentPosition(action) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      );
    });
    expect(badgeBeforeAction).toBe(true);

    await page.emulateMedia({ colorScheme: "dark" });
    await expectBadgeStyles(page, DARK);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({
      path: `${proofDir}/voting-375-dark.png`,
      fullPage: true,
    });

    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize({ width: 1280, height: 800 });
    await expectBadgeStyles(page, LIGHT);
    await page.screenshot({
      path: `${proofDir}/voting-1280-light.png`,
      fullPage: true,
    });
    await expectNoTrustOverclaims(page);
  });

  test("is absent entirely — no container, no hairline — when every Toggle is off", async ({
    page,
  }) => {
    observePage(page);
    const owner = await seedOwner();
    const poll = seedPoll({
      ownerId: owner.userId,
      reference: `badge-off-${randomUUID().slice(0, 8)}`,
      toggles: { sessionChecks: false },
    });
    await page.goto(poll.pollPath);

    // Attachment, not visibility: a zero-height empty container would read
    // hidden — the badge must not exist at all (SM-C1).
    await expect(page.locator("[data-trust-badge]")).toHaveCount(0);
    await expect(page.locator(".trust-badge")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "VOTE" })).toBeAttached();
    // Scoped to the shared voting surface: dev-mode Vite inlines the
    // component's stylesheet in <head> on import alone — absence is about
    // rendered markup, not CSS.
    const surfaceHtml = await page
      .locator("[data-poll-voting-surface]")
      .innerHTML();
    expect(surfaceHtml).not.toContain("trust-badge");
  });

  test("stacks one item per line at 375px with aligned left edges and no truncation", async ({
    page,
  }) => {
    observePage(page);
    const owner = await seedOwner();
    const poll = seedPoll({
      ownerId: owner.userId,
      reference: `badge-stack-${randomUUID().slice(0, 8)}`,
      toggles: { ipChecks: true },
    });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(poll.pollPath);

    const items = page.locator("[data-trust-badge] .trust-badge-item");
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toHaveText("ONE VOTE PER BROWSER");
    await expect(items.nth(1)).toHaveText("ONE VOTE PER NETWORK");

    const geometry = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll(".trust-badge-item")];
      return nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          x: rect.x,
          y: rect.y,
          text: node.textContent,
          truncated: node.scrollWidth > node.clientWidth + 1,
        };
      });
    });
    // Two enforced items overflow 375px at this type size: each gets its own
    // line, every line keeps the first line's left edge, nothing truncates.
    expect(geometry[1].y).toBeGreaterThan(geometry[0].y);
    expect(Math.abs(geometry[1].x - geometry[0].x)).toBeLessThanOrEqual(1);
    for (const item of geometry) {
      expect(item.truncated).toBe(false);
    }

    await page.emulateMedia({ colorScheme: "dark" });
    await page.screenshot({
      path: `${proofDir}/voting-375-dark-stacked.png`,
      fullPage: true,
    });
  });

  test("persists on the post-vote Tally and on /results", async ({
    page,
  }) => {
    observePage(page);
    const owner = await seedOwner();
    const poll = seedPoll({
      ownerId: owner.userId,
      reference: `badge-tally-${randomUUID().slice(0, 8)}`,
    });
    await castVote(page, poll);

    // Post-vote Tally: the badge explains the visible numbers (AC #4).
    const postVoteBadge = page.locator("[data-results-tally] [data-trust-badge]");
    await expect(postVoteBadge).toHaveCount(1);
    await expect(postVoteBadge).toContainText("ONE VOTE PER BROWSER");
    // Post-vote instance rises 32px (--space-8) above the bar region.
    await expect(postVoteBadge).toHaveCSS("margin-top", "32px");
    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.screenshot({
      path: `${proofDir}/post-vote-1280-light.png`,
      fullPage: true,
    });
    await expectNoTrustOverclaims(page);

    await page.goto(poll.resultsPath);
    const resultsBadge = page.locator("[data-results-tally] [data-trust-badge]");
    await expect(resultsBadge).toHaveCount(1);
    await expect(resultsBadge).toContainText("ONE VOTE PER BROWSER");
    // Results instance keeps the component default 24px (--space-6).
    await expect(resultsBadge).toHaveCSS("margin-top", "24px");
    await page.emulateMedia({ colorScheme: "dark" });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({
      path: `${proofDir}/results-375-dark.png`,
      fullPage: true,
    });
    await expectNoTrustOverclaims(page);
  });

  test("survives a live update cycle attached to the Tally", async ({
    page,
    browser,
    baseURL,
  }) => {
    observePage(page);
    const owner = await seedOwner();
    const poll = seedPoll({
      ownerId: owner.userId,
      reference: `badge-live-${randomUUID().slice(0, 8)}`,
    });
    await page.goto(poll.resultsPath);
    const badge = page.locator("[data-results-tally] [data-trust-badge]");
    await expect(badge).toHaveCount(1);

    // The enhancer mounts, then a second-context Vote forces a real
    // reconcile; the badge is server-rendered and never live-patched.
    await expect(page.locator("[data-results-tally]")).toHaveAttribute(
      "data-live-enhanced",
      "true",
      { timeout: 15_000 },
    );
    const voter = observePage(
      await (await browser.newContext({ baseURL: requireBaseUrl(baseURL) })).newPage(),
    );
    await castVote(voter, poll);

    await expect
      .poll(
        async () =>
          page.locator("[data-live-total-visual]").textContent(),
        { timeout: 30_000 },
      )
      .toBe("1 VOTE");
    await expect(badge).toHaveCount(1);
    await expect(badge).toContainText("ONE VOTE PER BROWSER");
  });
});
