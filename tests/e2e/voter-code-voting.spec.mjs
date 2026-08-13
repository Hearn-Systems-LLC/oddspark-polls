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

// D7: raw bearer codes never appear in proof artifacts. Blank the code field
// (when rendered) before every capture.
async function captureProof(page, name) {
  const field = page.getByLabel("VOTER CODE");
  if (await field.count()) {
    await field.evaluate((input) => {
      input.value = "";
    });
  }
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: `${proofDir}/${name}-375-dark.png`, fullPage: true });
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: `${proofDir}/${name}-1280-light.png`, fullPage: true });
}

function seedCodeGatedPoll(ownerId, pollType, reference) {
  const pollId = randomUUID();
  const codeId = randomUUID();
  const optionIds = [randomUUID(), randomUUID(), randomUUID()];
  const question = `Code-gated ${pollType}`;
  const now = Date.now();
  const statements = [
    sql`INSERT INTO poll (id, owner_user_id, poll_type, question, result_visibility, discovery_state, session_checks_enabled, ip_checks_enabled, voter_codes_enabled, captcha_enabled, vpn_blocking_enabled, comments_enabled, multi_select_enabled, min_selections, max_selections, deadline_ms, representation_version, created_at_ms, updated_at_ms) VALUES (${pollId}, ${ownerId}, ${pollType}, ${question}, 'live', 'unlisted', 0, 0, 1, 0, 0, 0, 0, NULL, NULL, NULL, 0, ${now}, ${now});`,
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

    await page.goto(`/creator/${reference}/codes`);
    await page.getByRole("button", { name: "GENERATE CODES" }).click();
    await expect(page).toHaveURL(/\?panel=codes/u);
    const code = (await page.locator(".code-text").first().textContent())?.trim() ?? "";
    expect(code).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/u);

    await context.clearCookies();
    await page.goto(`/${reference}`);
    await expect(page.getByLabel("VOTER CODE")).toBeVisible();
    await captureProof(page, "fresh");

    // Offline submit: outcome banner, preserved value, clean restore.
    await page.locator("label.poll-option", { hasText: "Alpha" }).click();
    await page.getByLabel("VOTER CODE").fill(code);
    await context.setOffline(true);
    await page.getByRole("button", { name: "VOTE" }).click();
    await expect(page.locator("[data-offline-outcome]")).toBeVisible();
    await expect(page.getByLabel("VOTER CODE")).toHaveValue(code);
    await context.setOffline(false);
    await expect(page.locator("[data-offline-outcome]")).toBeHidden();

    // In-flight lock + pageshow restore. Abort the held probe so the deferred
    // submission can never complete after the restore.
    let releaseProbe;
    const heldProbe = new Promise((resolve) => {
      releaseProbe = resolve;
    });
    await page.route("**/favicon.svg", async (route) => {
      await heldProbe;
      // The enhancer's own 3s probe timeout may have already canceled the
      // request; a late abort on a settled route is fine either way.
      await route.abort().catch(() => {});
    });
    await page.getByRole("button", { name: "VOTE" }).click();
    await expect(page.getByLabel("VOTER CODE")).toHaveJSProperty("readOnly", true);
    await page.evaluate(() => {
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });
    await expect(page.getByLabel("VOTER CODE")).toHaveJSProperty("readOnly", false);
    releaseProbe?.();
    await page.unroute("**/favicon.svg");

    // Missing code: selection made, blank code — exact catalog copy.
    await page.goto(`/${reference}`);
    await page.locator("label.poll-option", { hasText: "Alpha" }).click();
    await page.locator("[data-vote-form]").evaluate((form) => form.submit());
    await expect(page.locator("[data-vote-outcome]")).toContainText(
      "This Poll needs a Voter Code.",
    );

    // Invalid (nonexistent) code: exact catalog copy, preserved value and
    // ballot, inline field error.
    await page.locator("label.poll-option", { hasText: "Alpha" }).click();
    await page.getByLabel("VOTER CODE").fill("XXXXXXXX");
    await page.locator("[data-vote-form]").evaluate((form) => form.submit());
    await expect(page.locator("[data-vote-outcome]")).toContainText(
      "That code doesn't work on this Poll.",
    );
    await expect(page.getByLabel("VOTER CODE")).toHaveValue("XXXXXXXX");
    await expect(page.getByRole("radio", { name: "Alpha" })).toBeChecked();
    await captureProof(page, "invalid");

    // Successful redemption; lowercase proves client canonicalization while
    // the server stays authoritative.
    await page.locator("label.poll-option", { hasText: "Alpha" }).click();
    await page.getByLabel("VOTER CODE").fill(code.toLowerCase());
    await expect(page.getByLabel("VOTER CODE")).toHaveValue(code);
    await page.locator("[data-vote-form]").evaluate((form) => form.submit());
    await expect(page.getByText("Counted.")).toBeVisible({ timeout: 15_000 });
    await captureProof(page, "redeemed");

    // The used code rejects a second voter with the exact catalog copy.
    const secondContext = await browser.newContext({
      baseURL: requireBaseUrl(baseURL),
    });
    try {
      const secondPage = await secondContext.newPage();
      await secondPage.goto(`/${reference}`);
      await secondPage.locator("label.poll-option", { hasText: "Beta" }).click();
      await secondPage.getByLabel("VOTER CODE").fill(code);
      await secondPage.locator("[data-vote-form]").evaluate((form) => form.submit());
      await expect(secondPage.locator("[data-vote-outcome]")).toContainText(
        "That code has already been used.",
      );
      await expect(secondPage.getByLabel("VOTER CODE")).toHaveValue(code);
      await captureProof(secondPage, "used");
    } finally {
      await secondContext.close();
    }

    // Owner inventory reflects the single redemption.
    await context.addCookies([
      {
        name: "better-auth.session_token",
        value: creator.cookieValue,
        url: requireBaseUrl(baseURL),
      },
    ]);
    await page.goto(`/creator/${reference}/codes?panel=codes`);
    await expect(page.getByText(/1 OF \d+ REDEEMED/u)).toBeVisible();
    await captureProof(page, "owner-inventory");
    await context.clearCookies();
  });

  test("renders VOTER CODE on Ranked, Image, and initial Meeting ballots, including no-JS Ranked draft and submission", async ({
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

    // No-JS: a rank-draft POST preserves the submitted code and the ranking
    // without validating or redeeming it, and the final submission redeems.
    const noJs = await browser.newContext({
      baseURL: requireBaseUrl(baseURL),
      javaScriptEnabled: false,
    });
    try {
      const noJsPage = await noJs.newPage();
      await noJsPage.goto(`/${ranked.reference}`);
      await expect(noJsPage.getByLabel("VOTER CODE")).toBeVisible();
      await noJsPage.getByLabel("VOTER CODE").fill("abcdefgh");
      await noJsPage
        .getByRole("button", { name: "Alpha, unranked, activate to rank next" })
        .click();
      // Draft POST re-render: code preserved verbatim, nothing redeemed.
      await expect(noJsPage.getByLabel("VOTER CODE")).toHaveValue("ABCDEFGH");
      const drafted = d1Query(
        sql`SELECT COUNT(*) AS n FROM voter_code_redemptions r JOIN voter_code c ON c.id = r.code_id WHERE c.poll_id = ${ranked.pollId}`,
      )[0];
      expect(Number(drafted?.n ?? -1)).toBe(0);
      await noJsPage.getByRole("button", { name: "VOTE" }).click();
      await expect(noJsPage.getByText("Counted.")).toBeVisible({ timeout: 15_000 });
      const redeemed = d1Query(
        sql`SELECT COUNT(*) AS n FROM voter_code_redemptions r JOIN voter_code c ON c.id = r.code_id WHERE c.poll_id = ${ranked.pollId}`,
      )[0];
      expect(Number(redeemed?.n ?? -1)).toBe(1);
    } finally {
      await noJs.close();
    }
  });

  test("a recognized Meeting revision saves without a code and creates no second redemption", async ({
    page,
  }) => {
    const owner = await seedCreatorSession();
    assertUuid(owner.userId);
    creatorIds.push(owner.userId);
    const meeting = seedCodeGatedPoll(owner.userId, "meeting", `code-meet2-${randomUUID().slice(0, 8)}`);

    await page.goto(`/${meeting.reference}`);
    await expect(page.getByLabel("VOTER CODE")).toBeVisible();
    await page.locator("[data-vote-form] [data-slot]").first().locator('[data-state="yes"]').click();
    await page.locator("[data-vote-form]").getByLabel("YOUR NAME").fill("Casey");
    await page.getByLabel("VOTER CODE").fill("ABCDEFGH");
    await page.locator("[data-vote-form]").evaluate((form) => form.submit());
    await expect(page.locator("[data-vote-outcome]")).toContainText("Saved.", { timeout: 15_000 });

    // Recognized revision: SAVE renders, no code input, badge suppressed.
    await page.goto(`/${meeting.reference}`);
    await expect(page.getByRole("button", { name: "SAVE" })).toBeVisible();
    await expect(page.getByLabel("VOTER CODE")).toHaveCount(0);
    await expect(page.locator("[data-vote-form] [data-trust-badge]")).toHaveCount(0);
    await page.locator("[data-vote-form] [data-slot]").first().locator('[data-state="no"]').click();
    await page.locator("[data-vote-form]").evaluate((form) => form.submit());
    await expect(page.locator("[data-vote-outcome]")).toContainText("Saved.", { timeout: 15_000 });
    const redemptions = d1Query(
      sql`SELECT COUNT(*) AS n FROM voter_code_redemptions r JOIN voter_code c ON c.id = r.code_id WHERE c.poll_id = ${meeting.pollId}`,
    )[0];
    expect(Number(redemptions?.n ?? -1)).toBe(1);
    await captureProof(page, "meeting-revision");
  });
});
