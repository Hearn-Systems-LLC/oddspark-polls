import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
  assertUuid,
  cleanupCreator,
  d1Execute,
  d1Query,
  deletePoll,
  hasBetterAuthSecret,
  requireBaseUrl,
  seedCreatorSession,
  sql,
} from "./creator-session.mjs";

if (!hasBetterAuthSecret()) {
  throw new Error(
    "Story 3.5 E2E requires BETTER_AUTH_SECRET in .dev.vars; skipping Demo proof is forbidden",
  );
}

const PROOF_DIR = "test-results/story-3-5-demo-poll-proof";
mkdirSync(PROOF_DIR, { recursive: true });
test.describe.configure({ mode: "serial", timeout: 240_000 });

let owner;
let demo;

function seedExactDemo(ownerUserId) {
  const existing = d1Query(
    sql`SELECT poll_id FROM poll_reference WHERE reference = 'demo' LIMIT 1`,
  )[0]?.poll_id;
  if (existing) {
    assertUuid(existing);
    deletePoll(existing);
  }

  const pollId = randomUUID();
  const optionIds = [randomUUID(), randomUUID(), randomUUID()];
  const now = Date.now();
  d1Execute(
    sql.join([
      sql`INSERT INTO poll (id, owner_user_id, poll_type, question, description, result_visibility, discovery_state, session_checks_enabled, deadline_ms, closed_at_ms, representation_version, created_at_ms, updated_at_ms, multi_select_enabled, min_selections, max_selections, ip_checks_enabled, voter_codes_enabled, captcha_enabled, vpn_blocking_enabled) VALUES (${pollId}, ${ownerUserId}, 'multiple_choice', 'Best day for a long weekend?', NULL, 'live', 'unlisted', 1, NULL, NULL, 1, ${now}, ${now}, 0, NULL, NULL, 0, 0, 1, 0);`,
      sql`INSERT INTO poll_option (id, poll_id, label, position, created_at_ms) VALUES (${optionIds[0]}, ${pollId}, 'Friday', 0, ${now}), (${optionIds[1]}, ${pollId}, 'Monday', 1, ${now}), (${optionIds[2]}, ${pollId}, 'Either works', 2, ${now});`,
      sql`INSERT INTO poll_reference (reference, poll_id, kind, is_canonical, created_at_ms) VALUES ('demo', ${pollId}, 'custom', 1, ${now});`,
    ]),
  );
  return { pollId, optionIds };
}

async function setDemoMode(page, mode) {
  await page.emulateMedia({ colorScheme: mode, reducedMotion: "reduce" });
  await page.evaluate((resolved) => {
    localStorage.setItem("oddspark-mode", resolved);
    document.documentElement.setAttribute("data-mode", resolved);
  }, mode);
}

async function captureBoth(page, name) {
  await page.setViewportSize({ width: 375, height: 812 });
  await setDemoMode(page, "dark");
  await page.screenshot({ path: `${PROOF_DIR}/${name}-375-dark.png`, fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await setDemoMode(page, "light");
  await page.screenshot({ path: `${PROOF_DIR}/${name}-1280-light.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}

async function provideDummyTurnstileToken(page) {
  await page.evaluate(() => {
    const form = document.querySelector("[data-vote-form]");
    if (!(form instanceof HTMLFormElement)) throw new Error("Demo vote form missing");
    let field = form.querySelector('[name="cf-turnstile-response"]');
    if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) {
      field = document.createElement("input");
      field.type = "hidden";
      field.name = "cf-turnstile-response";
      form.appendChild(field);
    }
    field.value = "XXXX.DUMMY.TOKEN.XXXX";
  });
}

function observeApp(page, baseURL) {
  const errors = [];
  page.on("pageerror", (error) => {
    if (!/challenges\.cloudflare\.com/iu.test(error.message)) errors.push(error.message);
  });
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !/challenges\.cloudflare\.com|turnstile/iu.test(message.text())
    ) errors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.url().startsWith(baseURL) && response.status() >= 400) {
      errors.push(`${response.status()} ${response.url()}`);
    }
  });
  return () => expect(errors).toEqual([]);
}

test.describe("Story 3.5 landing Demo and owner reset", () => {
  test.beforeAll(async ({ request }) => {
    const health = await request.get("/api/health");
    expect(health.status()).toBe(200);
    expect(await health.json()).toEqual({ ok: true });
    owner = await seedCreatorSession();
    demo = seedExactDemo(owner.userId);
  });

  test.afterAll(() => {
    if (owner?.userId) cleanupCreator(owner.userId);
  });

  test("votes, resets atomically, preserves an unsent selection, and admits two browsers on the same loopback source", async ({
    browser,
    baseURL,
  }) => {
    const origin = requireBaseUrl(baseURL);
    const voterContext = await browser.newContext();
    const voter = await voterContext.newPage();
    const assertVoterClean = observeApp(voter, origin);
    await voter.goto("/");

    await expect(voter.locator("astro-dev-toolbar")).toHaveCount(0);
    await expect(voter.getByRole("heading", { name: "Best day for a long weekend?" })).toBeVisible();
    await expect(voter.getByRole("region", { name: "Current Demo Poll results" })).toContainText("No Votes yet.");
    await expect(voter.locator("button.btn-primary:visible")).toHaveCount(1);
    await expect(voter.getByRole("button", { name: "VOTE" })).toBeDisabled();
    const targetHeights = await voter.locator("[data-demo-region] label.poll-option, [data-demo-region] button:visible, [data-demo-region] a.btn-secondary:visible").evaluateAll(
      (nodes) => nodes.map((node) => node.getBoundingClientRect().height),
    );
    expect(Math.min(...targetHeights)).toBeGreaterThanOrEqual(48);
    await captureBoth(voter, "fresh");
    await expect(voter.locator(".results-bar-fill").first()).toHaveCSS(
      "transition-duration",
      "0s",
    );

    await voter.locator("label.poll-option", { hasText: "Friday" }).click();
    await provideDummyTurnstileToken(voter);
    await voter.getByRole("button", { name: "VOTE" }).click();
    await expect(voter.locator('[data-outcome-code="counted"]')).toContainText("Counted.", { timeout: 20_000 });
    await expect(voter.locator('[data-option-id]').filter({ hasText: "Friday" })).toContainText("1");
    await captureBoth(voter, "counted-live");

    await voter.reload();
    await expect(voter.locator('[data-outcome-code="already_voted"]')).toContainText("You've already voted here.");
    await captureBoth(voter, "already-voted");

    const pendingContext = await browser.newContext();
    const pending = await pendingContext.newPage();
    const assertPendingClean = observeApp(pending, origin);
    await pending.goto("/");
    await pending.locator("label.poll-option", { hasText: "Monday" }).click();
    await expect(pending.getByRole("radio", { name: "Monday" })).toBeChecked();

    const ownerContext = await browser.newContext();
    await ownerContext.addCookies([{
      name: "better-auth.session_token",
      value: owner.cookieValue,
      url: origin,
    }]);
    const creator = await ownerContext.newPage();
    const assertCreatorClean = observeApp(creator, origin);
    await creator.goto(`/creator/polls/${demo.pollId}`);
    const resetTrigger = creator.getByRole("link", { name: "RESET DEMO POLL" });
    await expect(resetTrigger).toBeVisible();
    await resetTrigger.click();
    const dialog = creator.getByRole("dialog", { name: "RESET DEMO POLL?" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("This permanently clears every Vote from the landing-page Demo Poll. The public link stays the same.");
    await expect(creator.getByRole("link", { name: "KEEP VOTES" })).toBeFocused();
    await expect(creator.locator("body")).toHaveCSS("overflow", "hidden");
    await creator.keyboard.press("Shift+Tab");
    await expect(creator.getByRole("button", { name: "RESET VOTES" })).toBeFocused();
    await creator.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(resetTrigger).toBeFocused();

    await resetTrigger.click();
    await captureBoth(creator, "reset-confirmation");
    await creator.evaluate(() => {
      const form = document.querySelector("[data-reset-demo-form]");
      form?.addEventListener("submit", (event) => event.preventDefault(), { once: true, capture: true });
    });
    await creator.getByRole("button", { name: "RESET VOTES" }).click();
    await expect(creator.getByRole("button", { name: "RESETTING…" })).toHaveAttribute("aria-disabled", "true");

    await creator.goto(`/creator/polls/${demo.pollId}?confirm=reset-demo`);
    await expect(dialog).toBeVisible();
    await creator.getByRole("button", { name: "RESET VOTES" }).click();
    await expect(creator).toHaveURL(/\/creator\/polls\/[0-9a-f-]+$/u, { timeout: 20_000 });
    await expect(creator.getByRole("heading", { name: "DEMO POLL RESET" })).toBeFocused();
    await expect(creator.getByText("The landing-page Demo Poll is empty and ready for new Votes.", { exact: true })).toBeVisible();
    await expect(creator.getByRole("button", { name: "NO VOTES TO RESET" })).toBeDisabled();
    await captureBoth(creator, "empty-post-reset");

    const successorId = /\/creator\/polls\/([^/?]+)/u.exec(creator.url())?.[1] ?? "";
    assertUuid(successorId);
    expect(successorId).not.toBe(demo.pollId);
    const storedOptionIds = d1Query(
      sql`SELECT id FROM poll_option WHERE poll_id = ${successorId} ORDER BY position`,
    ).map((row) => row.id);
    expect(storedOptionIds).toEqual(demo.optionIds);

    await expect.poll(() => pending.locator("[data-live-total]").textContent()).toContain("0 VOTES");
    await expect(pending.getByRole("radio", { name: "Monday" })).toBeChecked();
    await provideDummyTurnstileToken(pending);
    await pending.getByRole("button", { name: "VOTE" }).click();
    await expect(pending.locator('[data-outcome-code="counted"]')).toBeVisible({ timeout: 20_000 });

    await voter.reload();
    await expect(voter.getByRole("button", { name: "VOTE" })).toBeVisible();
    await voter.locator("label.poll-option", { hasText: "Either works" }).click();
    await provideDummyTurnstileToken(voter);
    await voter.getByRole("button", { name: "VOTE" }).click();
    await expect(voter.locator('[data-outcome-code="counted"]')).toBeVisible({ timeout: 20_000 });
    const successorVotes = d1Query(
      sql`SELECT COUNT(*) AS count FROM vote WHERE poll_id = ${successorId}`,
    );
    // Both independent browser contexts reach the dev Worker through the
    // same loopback source. IP Checks are off, so both Session-distinct Votes
    // are authoritative while the admission rate limiter remains active.
    expect(successorVotes[0]?.count).toBe(2);

    assertVoterClean();
    assertPendingClean();
    assertCreatorClean();
    await voterContext.close();
    await pendingContext.close();
    await ownerContext.close();
  });

  test("lays out the rejected-vote (demo-first) landing in two columns at desktop width", async ({
    page,
  }) => {
    // A vote POST without a Turnstile token re-renders with the
    // captcha_failed outcome, flipping the landing to demo-first order — the
    // state where the Demo Poll must keep the wide track so its internal
    // vote-form/Tally split does not crush the Tally column.
    await page.goto("/");
    await page.locator("label.poll-option", { hasText: "Friday" }).click();
    await page.getByRole("button", { name: "VOTE" }).click();
    await expect(
      page.locator('[data-outcome-code="captcha_failed"]'),
    ).toBeVisible({ timeout: 20_000 });

    await page.setViewportSize({ width: 1280, height: 900 });
    await setDemoMode(page, "light");
    const geometry = await page.evaluate(() => {
      const rectOf = (selector) => {
        const node = document.querySelector(selector);
        if (!(node instanceof HTMLElement)) {
          throw new Error(`Missing element: ${selector}`);
        }
        return node.getBoundingClientRect();
      };
      return {
        demo: rectOf("[data-demo-region]"),
        intro: rectOf(".landing-intro-region"),
        tally: rectOf("[data-demo-region] .tally-region"),
        horizontalOverflow:
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      };
    });
    expect(geometry.horizontalOverflow).toBeLessThanOrEqual(0);
    expect(geometry.demo.left).toBeLessThan(geometry.intro.left);
    expect(geometry.demo.width).toBeGreaterThan(geometry.intro.width);
    expect(geometry.tally.width).toBeGreaterThanOrEqual(300);
    await page.screenshot({
      path: `${PROOF_DIR}/vote-rejected-1280-light.png`,
      fullPage: true,
    });

    await page.setViewportSize({ width: 375, height: 812 });
    await setDemoMode(page, "dark");
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
    await page.screenshot({
      path: `${PROOF_DIR}/vote-rejected-375-dark.png`,
      fullPage: true,
    });
  });
});
