import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import {
  assertUuid,
  cleanupCreators,
  d1Query,
  hasBetterAuthSecret,
  requireBaseUrl,
  seedCreatorSession,
  sql,
} from "./creator-session.mjs";

if (!hasBetterAuthSecret()) {
  throw new Error(
    "Story 3.1 E2E requires BETTER_AUTH_SECRET in .dev.vars; skipping listing-control proof is forbidden",
  );
}

const proofDir = "test-results/story-3-1-listing-control-proof";

test.describe.configure({ mode: "serial", timeout: 180_000 });

test.describe("listing control", () => {
  const seededUserIds = [];
  const browserErrors = new WeakMap();

  test.beforeEach(({ page }) => {
    const errors = [];
    browserErrors.set(page, errors);
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
  });

  test.afterEach(({ page }) => {
    expect(browserErrors.get(page) ?? []).toEqual([]);
  });

  test.afterAll(() => {
    cleanupCreators(seededUserIds);
  });

  async function signIn(context, baseURL) {
    const seeded = await seedCreatorSession();
    assertUuid(seeded.userId);
    seededUserIds.push(seeded.userId);
    await context.addCookies([
      {
        name: "better-auth.session_token",
        value: seeded.cookieValue,
        url: requireBaseUrl(baseURL),
      },
    ]);
  }

  async function captureBothModes(page, label) {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.setViewportSize({ width: 375, height: 900 });
    await page.screenshot({
      path: `${proofDir}/${label}-375-dark.png`,
      fullPage: true,
    });
    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({
      path: `${proofDir}/${label}-1280-light.png`,
      fullPage: true,
    });
  }

  async function expectBadgeStyle(page, state, token) {
    const badge = page.locator(`[data-listing-badge][data-state="${state}"]`).first();
    await expect(badge).toBeVisible();
    const styles = await badge.evaluate((element, expectedToken) => {
      const probe = document.createElement("span");
      probe.style.position = "absolute";
      probe.style.visibility = "hidden";
      probe.style.color = `var(${expectedToken})`;
      document.body.append(probe);
      const expectedColor = getComputedStyle(probe).color;
      probe.remove();
      const actual = getComputedStyle(element);
      return { color: actual.color, fontSize: actual.fontSize, expectedColor };
    }, token);
    expect(styles).toEqual({
      color: styles.expectedColor,
      fontSize: "12px",
      expectedColor: styles.expectedColor,
    });
  }

  async function fillCreate(page, question, reference) {
    await page.getByLabel("QUESTION").fill(question);
    await page.getByRole("textbox", { name: "OPTION 1" }).fill("Alpha");
    await page.getByRole("textbox", { name: "OPTION 2" }).fill("Beta");
    await page.getByLabel("CUSTOM LINK (OPTIONAL)").fill(reference);
  }

  test("defaults Unlisted, opts into Listed, flips both ways, and keeps voter pages private", async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, baseURL);

    await page.goto("/creator/new");
    const createListing = page.getByRole("group", { name: "WHO CAN FIND IT" });
    await expect(createListing).toBeVisible();
    await expect(page.locator("#listing-unlisted")).toBeChecked();
    await expect(page.locator("#listing-listed")).not.toBeChecked();
    await captureBothModes(page, "create-form-chooser");

    const defaultReference = `listing-default-${randomUUID().slice(0, 8)}`;
    await fillCreate(page, "Default listing state?", defaultReference);
    await page.getByRole("button", { name: "PUBLISH POLL" }).click();
    await expect(page).toHaveURL(/\/creator\/polls\/[^?]+\?created/);
    const defaultDetailUrl = page.url().split("?")[0];
    const defaultPollId = /\/creator\/polls\/([^?]+)/.exec(page.url())?.[1];
    assertUuid(defaultPollId);
    await expect(page.locator("[data-detail-status]")).toContainText("UNLISTED");
    await expect(page.locator("#detail-listing-unlisted")).toBeChecked();
    await expectBadgeStyle(page, "unlisted", "--color-dim");
    await page.emulateMedia({ colorScheme: "dark" });
    await expectBadgeStyle(page, "unlisted", "--color-dim");
    await captureBothModes(page, "detail-unlisted");

    expect(
      d1Query(
        sql`SELECT discovery_state, representation_version FROM poll WHERE id = ${defaultPollId}`,
      ),
    ).toEqual([{ discovery_state: "unlisted", representation_version: 1 }]);

    await page.goto("/creator");
    const defaultCard = page.locator("[data-poll-card]", {
      hasText: "Default listing state?",
    });
    await expect(defaultCard).toContainText("UNLISTED");
    await captureBothModes(page, "dashboard-card");

    await page.goto(defaultDetailUrl);
    await page.locator('label.poll-option[for="detail-listing-listed"]').click();
    await page.getByRole("button", { name: "SAVE LISTING" }).click();
    await expect(page.getByText("Listing updated.")).toBeVisible();
    await expect(page.locator("#detail-listing-listed")).toBeChecked();
    await expectBadgeStyle(page, "listed", "--color-entropy");
    await page.emulateMedia({ colorScheme: "dark" });
    await expectBadgeStyle(page, "listed", "--color-entropy");

    await page.locator('label.poll-option[for="detail-listing-unlisted"]').click();
    await page.getByRole("button", { name: "SAVE LISTING" }).click();
    await expect(page.locator("#detail-listing-unlisted")).toBeChecked();
    await expect(page.locator("[data-detail-status]")).toContainText("UNLISTED");

    await page.locator('label.poll-option[for="detail-listing-listed"]').click();
    await page.getByRole("button", { name: "SAVE LISTING" }).click();
    await expect(page.locator("#detail-listing-listed")).toBeChecked();
    await expect(page.locator("[data-detail-status]")).toContainText("LISTED");
    expect(
      d1Query(
        sql`SELECT discovery_state, representation_version FROM poll WHERE id = ${defaultPollId}`,
      ),
    ).toEqual([{ discovery_state: "listed", representation_version: 1 }]);

    await page.goto("/creator/new");
    const listedReference = `listing-optin-${randomUUID().slice(0, 8)}`;
    await fillCreate(page, "Listed from creation?", listedReference);
    await page.locator('label.poll-option[for="listing-listed"]').click();
    await page.getByRole("button", { name: "PUBLISH POLL" }).click();
    await expect(page.locator("[data-detail-status]")).toContainText("LISTED");
    const listedRows = d1Query(
      sql`SELECT p.discovery_state FROM poll p JOIN poll_reference r ON r.poll_id = p.id AND r.is_canonical = 1 WHERE r.reference = ${listedReference}`,
    );
    expect(listedRows).toEqual([{ discovery_state: "listed" }]);

    await page.goto(`/${listedReference}`);
    const voterMain = page.locator("main");
    await expect(voterMain.locator("[data-listing-badge]")).toHaveCount(0);
    await expect(voterMain.getByText(/UNLISTED|LISTED|DELISTED/)).toHaveCount(0);
  });
});
