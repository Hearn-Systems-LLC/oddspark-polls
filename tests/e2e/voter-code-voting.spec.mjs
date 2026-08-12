import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import {
  assertUuid,
  cleanupCreators,
  d1Execute,
  d1Query,
  hasBetterAuthSecret,
  requireBaseUrl,
  seedCreatorSession,
  sql,
} from "./creator-session.mjs";

test.describe.configure({ mode: "serial", timeout: 180_000 });
test.skip(
  !hasBetterAuthSecret(),
  "BETTER_AUTH_SECRET is required for voter-code browser coverage",
);

const proofDir = "test-results/story-8-2-voter-code-proof";
mkdirSync(proofDir, { recursive: true });

function seedCodeGatedPoll(ownerId, pollType, reference) {
  const pollId = randomUUID();
  const codeId = randomUUID();
  const optionIds = [randomUUID(), randomUUID(), randomUUID()];
  const now = Date.now();
  const statements = [
    sql`INSERT INTO poll (id, owner_user_id, poll_type, question, result_visibility, discovery_state, session_checks_enabled, ip_checks_enabled, voter_codes_enabled, captcha_enabled, vpn_blocking_enabled, comments_enabled, multi_select_enabled, min_selections, max_selections, deadline_ms, representation_version, created_at_ms, updated_at_ms) VALUES (${pollId}, ${ownerId}, ${pollType}, 'Code-gated ${pollType}', 'live', 'unlisted', 0, 0, 1, 0, 0, 0, 0, NULL, NULL, NULL, 0, ${now}, ${now});`,
    sql`INSERT INTO poll_reference (reference, poll_id, kind, is_canonical, created_at_ms) VALUES (${reference}, ${pollId}, 'custom', 1, ${now});`,
    sql`INSERT INTO voter_code (id, poll_id, batch_id, position, code, created_at_ms) VALUES (${codeId}, ${pollId}, ${randomUUID()}, 0, 'ABCDEFGH', ${now});`,
  ];
  if (pollType === "meeting") {
    statements.push(
      sql`INSERT INTO meeting_slot (id, poll_id, position, starts_at_ms, ends_at_ms, time_zone, created_at_ms) VALUES (${randomUUID()}, ${pollId}, 0, ${now + 86_400_000}, ${now + 90_000_000}, 'UTC', ${now});`,
    );
  } else {
    statements.push(
      sql`INSERT INTO poll_option (id, poll_id, label, position, created_at_ms) VALUES (${optionIds[0]}, ${pollId}, 'Alpha', 0, ${now}), (${optionIds[1]}, ${pollId}, 'Beta', 1, ${now}), (${optionIds[2]}, ${pollId}, 'Gamma', 2, ${now});`,
    );
  }
  d1Execute(sql.join(statements));
  return { pollId, reference };
}

test.describe("voter-code voting", () => {
  const creatorIds = [];

  test.afterAll(() => {
    cleanupCreators(creatorIds);
  });

  test("an owner-generated code admits exactly one browser vote", async ({
    page,
    context,
    browser,
    baseURL,
  }) => {
    const creator = await seedCreatorSession();
    assertUuid(creator.userId);
    creatorIds.push(creator.userId);
    await context.addCookies([
      {
        name: "better-auth.session_token",
        value: creator.cookieValue,
        url: requireBaseUrl(baseURL),
      },
    ]);

    const reference = `invite-${randomUUID().slice(0, 8)}`;
    await page.goto("/creator/new");
    await page.getByLabel("QUESTION").fill("Invite-only vote");
    await page.getByRole("textbox", { name: "OPTION 1" }).fill("Alpha");
    await page.getByRole("textbox", { name: "OPTION 2" }).fill("Beta");
    await page.getByLabel("CUSTOM LINK (OPTIONAL)").fill(reference);
    await page.locator("label.security-toggle", { hasText: "Voter Codes" }).click();
    await page.getByRole("button", { name: "PUBLISH POLL" }).click();
    await expect(page).toHaveURL(/\/creator\/polls\//u);

    const poll = d1Query(
      sql`SELECT id FROM poll p JOIN poll_reference r ON r.poll_id = p.id AND r.is_canonical = 1 WHERE r.reference = ${reference}`,
    )[0];
    assertUuid(poll?.id);

    await page.goto(`/creator/${reference}/codes`);
    await page.getByRole("button", { name: "GENERATE CODES" }).click();
    await expect(page).toHaveURL(/\?panel=codes/u);
    const code = (await page.locator(".code-text").first().textContent())?.trim() ?? "";
    expect(code).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/u);

    await context.clearCookies();
    await page.goto(`/${reference}`);
    await expect(page.getByLabel("VOTER CODE")).toBeVisible();
    await page.emulateMedia({ colorScheme: "dark" });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({
      path: `${proofDir}/fresh-375-dark.png`,
      fullPage: true,
    });
    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({
      path: `${proofDir}/fresh-1280-light.png`,
      fullPage: true,
    });

    await page.getByRole("radio", { name: "Alpha" }).check();
    await page.getByLabel("VOTER CODE").fill(code);
    await context.setOffline(true);
    await page.getByRole("button", { name: "VOTE" }).click();
    await expect(page.locator("[data-offline-outcome]")).toBeVisible();
    await expect(page.getByLabel("VOTER CODE")).toHaveValue(code);
    await context.setOffline(false);
    await expect(page.locator("[data-offline-outcome]")).toBeHidden();

    let releaseProbe;
    const heldProbe = new Promise((resolve) => {
      releaseProbe = resolve;
    });
    await page.route("**/favicon.svg", async (route) => {
      await heldProbe;
      await route.continue();
    });
    await page.getByRole("button", { name: "VOTE" }).click();
    await expect(page.getByLabel("VOTER CODE")).toHaveJSProperty("readOnly", true);
    await page.evaluate(() => {
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });
    await expect(page.getByLabel("VOTER CODE")).toHaveJSProperty("readOnly", false);
    releaseProbe?.();
    await page.unroute("**/favicon.svg");

    await page.goto(`/${reference}`);
    await page.getByLabel("VOTER CODE").fill(code);
    await page.locator("[data-vote-form]").evaluate((form) => form.submit());
    await expect(page.locator("[data-vote-outcome]")).toBeVisible();
    await expect(page.getByLabel("VOTER CODE")).toHaveValue(code);
    await page.emulateMedia({ colorScheme: "dark" });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({
      path: `${proofDir}/invalid-375-dark.png`,
      fullPage: true,
    });
    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({
      path: `${proofDir}/invalid-1280-light.png`,
      fullPage: true,
    });

    await page.getByRole("radio", { name: "Alpha" }).check();
    await page.getByLabel("VOTER CODE").fill(code.toLowerCase());
    await page.getByRole("button", { name: "VOTE" }).click();
    await expect(page.getByText("Counted.")).toBeVisible();
    await page.emulateMedia({ colorScheme: "dark" });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({
      path: `${proofDir}/redeemed-375-dark.png`,
      fullPage: true,
    });
    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({
      path: `${proofDir}/redeemed-1280-light.png`,
      fullPage: true,
    });

    const secondContext = await browser.newContext({
      baseURL: requireBaseUrl(baseURL),
    });
    try {
      const secondPage = await secondContext.newPage();
      await secondPage.goto(`/${reference}`);
      await secondPage.getByRole("radio", { name: "Beta" }).check();
      await secondPage.getByLabel("VOTER CODE").fill(code);
      await secondPage.getByRole("button", { name: "VOTE" }).click();
      await expect(secondPage.locator("[data-vote-outcome]")).toContainText(
        "That code has already been used.",
      );
      await expect(secondPage.getByLabel("VOTER CODE")).toHaveValue(code);
      await secondPage.emulateMedia({ colorScheme: "dark" });
      await secondPage.setViewportSize({ width: 375, height: 812 });
      await secondPage.screenshot({
        path: `${proofDir}/used-375-dark.png`,
        fullPage: true,
      });
      await secondPage.emulateMedia({ colorScheme: "light" });
      await secondPage.setViewportSize({ width: 1280, height: 900 });
      await secondPage.screenshot({
        path: `${proofDir}/used-1280-light.png`,
        fullPage: true,
      });
    } finally {
      await secondContext.close();
    }
  });

  test("renders VOTER CODE on Ranked, Image, and initial Meeting ballots, including no-JS Ranked", async ({
    page,
    browser,
    baseURL,
  }) => {
    const owner = await seedCreatorSession();
    assertUuid(owner.userId);
    creatorIds.push(owner.userId);
    const ranked = seedCodeGatedPoll(owner.userId, "ranked_choice", `code-ranked-${randomUUID().slice(0, 8)}`);
    const image = seedCodeGatedPoll(owner.userId, "image", `code-image-${randomUUID().slice(0, 8)}`);
    const meeting = seedCodeGatedPoll(owner.userId, "meeting", `code-meeting-${randomUUID().slice(0, 8)}`);

    for (const fixture of [ranked, image, meeting]) {
      await page.goto(`/${fixture.reference}`);
      await expect(page.getByLabel("VOTER CODE")).toBeVisible();
      await expect(page.locator("[data-trust-badge]")).toContainText("INVITE CODE REQUIRED");
    }

    const noJs = await browser.newContext({
      baseURL: requireBaseUrl(baseURL),
      javaScriptEnabled: false,
    });
    try {
      const noJsPage = await noJs.newPage();
      await noJsPage.goto(`/${ranked.reference}`);
      await expect(noJsPage.getByLabel("VOTER CODE")).toBeVisible();
      await noJsPage.getByLabel("VOTER CODE").fill("abcdefgh");
      await expect(noJsPage.getByLabel("VOTER CODE")).toHaveValue("abcdefgh");
    } finally {
      await noJs.close();
    }
  });
});
