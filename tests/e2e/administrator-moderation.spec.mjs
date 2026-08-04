import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  assertUuid,
  cleanupCreator,
  d1Query,
  hasBetterAuthSecret,
  requireBaseUrl,
  seedCreatorSession,
} from "./creator-session.mjs";

const CREATOR_DELISTED_COPY =
  "Delisted by the Administrator. The link still works and Votes still count; the Poll no longer appears on Discover. Only the Administrator can reverse this.";
const PROOF_DIR = "test-results/story-3-3-administrator-delisting-proof";
const MODERATION_BLIND_COPY =
  /\b(?:delisted|administrator|moderation|reason|appeal)\b|clear delisted|admin control/iu;

if (!hasBetterAuthSecret()) {
  throw new Error(
    "Story 3.3 E2E requires BETTER_AUTH_SECRET in .dev.vars; skipping Administrator proof is forbidden",
  );
}

test.describe.configure({ mode: "serial", timeout: 300_000 });

test.describe("Administrator delisting journey", () => {
  const seededUserIds = [];
  let observedPages = [];

  test.beforeEach(() => {
    observedPages = [];
  });

  test.afterEach(() => {
    for (const observed of observedPages) {
      expect(observed.consoleErrors, `${observed.label} console`).toEqual([]);
      expect(observed.pageErrors, `${observed.label} page errors`).toEqual([]);
      expect(observed.failedRequests, `${observed.label} failed requests`).toEqual(
        [],
      );
      expect(observed.failedResponses, `${observed.label} HTTP failures`).toEqual(
        [],
      );
    }
  });

  test.afterAll(() => {
    const cleanupErrors = [];
    // Owners go first so deleting their Polls removes Poll-scoped moderation
    // facts before the Administrator's restrictive actor FK is released.
    for (const userId of seededUserIds) {
      try {
        cleanupCreator(userId);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        cleanupErrors,
        `Failed to clean ${cleanupErrors.length} Story 3.3 E2E fixture(s)`,
      );
    }
  });

  function observePage(page, label) {
    const observed = {
      label,
      consoleErrors: [],
      pageErrors: [],
      failedRequests: [],
      failedResponses: [],
    };
    observedPages.push(observed);
    page.on("console", (message) => {
      if (message.type() === "error") observed.consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => observed.pageErrors.push(error.message));
    page.on("requestfailed", (request) => {
      observed.failedRequests.push(
        `${request.method()} ${request.url()} ${request.failure()?.errorText ?? "failed"}`,
      );
    });
    page.on("response", (response) => {
      if (response.status() >= 400) {
        observed.failedResponses.push(`${response.status()} ${response.url()}`);
      }
    });
    return page;
  }

  async function addSessionCookie(context, baseURL, seeded) {
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

  async function publishPoll(page, { question, reference, listing }) {
    await page.goto("/creator/new");
    await page.getByLabel("QUESTION").fill(question);
    await page.getByRole("textbox", { name: "OPTION 1" }).fill("Alpha");
    await page.getByRole("textbox", { name: "OPTION 2" }).fill("Beta");
    await page.getByLabel("CUSTOM LINK (OPTIONAL)").fill(reference);
    if (listing === "listed") {
      await page.locator('label[for="listing-listed"]').click();
    }
    await page.getByRole("button", { name: "PUBLISH POLL" }).click();
    await expect(page).toHaveURL(/\/creator\/polls\/[^?]+\?created/u);
    const pollId = /\/creator\/polls\/([^?]+)/u.exec(page.url())?.[1] ?? "";
    assertUuid(pollId);
    return {
      pollId,
      question,
      reference,
      publicPath: `/${reference}`,
      resultsPath: `/${reference}/results`,
      detailPath: `/creator/polls/${pollId}`,
    };
  }

  function expectDiscoveryState(pollId, expected) {
    assertUuid(pollId);
    expect(
      d1Query(
        `SELECT discovery_state FROM poll WHERE id = '${pollId}'`,
      ),
    ).toEqual([{ discovery_state: expected }]);
  }

  async function expectDiscoverVisibility(page, poll, visible) {
    await page.goto("/discover");
    const card = page.locator("[data-poll-card]", { hasText: poll.question });
    if (visible) {
      await expect(card).toHaveCount(1);
      await expect(card).toHaveAttribute("href", poll.publicPath);
    } else {
      await expect(card).toHaveCount(0);
    }
  }

  async function expectSitemapVisibility(page, baseURL, poll, visible) {
    const response = await page.request.get("/sitemap.xml");
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toContain("no-store");
    const xml = await response.text();
    const canonicalUrl = `${requireBaseUrl(baseURL)}${poll.publicPath}`;
    expect(xml.includes(canonicalUrl)).toBe(visible);
  }

  async function expectModerationBlind(page) {
    const main = page.locator("main");
    await expect(main).toBeVisible();
    expect(await main.innerText()).not.toMatch(MODERATION_BLIND_COPY);
    await expect(
      main.locator(
        "[data-moderation-surface], [data-listing-badge], [data-listing-readonly]",
      ),
    ).toHaveCount(0);
  }

  async function expectNoHorizontalOverflow(page) {
    const dimensions = await page.evaluate(() => ({
      body: document.body.scrollWidth,
      bodyClient: document.body.clientWidth,
      root: document.documentElement.scrollWidth,
      rootClient: document.documentElement.clientWidth,
    }));
    expect(dimensions.body).toBeLessThanOrEqual(dimensions.bodyClient);
    expect(dimensions.root).toBeLessThanOrEqual(dimensions.rootClient);
  }

  async function expectAtLeast44Px(locator) {
    const box = await locator.boundingBox();
    expect(box).not.toBeNull();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }

  async function tabTo(page, locator, maximumTabs = 24) {
    for (let index = 0; index < maximumTabs; index += 1) {
      await page.keyboard.press("Tab");
      if (await locator.evaluate((node) => node === document.activeElement)) {
        return;
      }
    }
    throw new Error(`Keyboard focus did not reach ${await locator.evaluate((node) => node.outerHTML)}`);
  }

  async function expectVisibleFocus(locator) {
    const focusStyle = await locator.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
      };
    });
    expect(focusStyle.outlineStyle).not.toBe("none");
    expect(Number.parseFloat(focusStyle.outlineWidth)).toBeGreaterThanOrEqual(2);
  }

  async function expectPrimaryButtonContrast(locator) {
    const presentation = await locator.evaluate((node) => {
      const style = getComputedStyle(node);
      const parseRgb = (value) =>
        (value.match(/[\d.]+/gu) ?? []).slice(0, 3).map(Number);
      const luminance = (channels) => {
        const [red, green, blue] = channels.map((channel) => {
          const normalized = channel / 255;
          return normalized <= 0.04045
            ? normalized / 12.92
            : ((normalized + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      };
      const foreground = luminance(parseRgb(style.color));
      const background = luminance(parseRgb(style.backgroundColor));
      return {
        color: style.color,
        backgroundColor: style.backgroundColor,
        contrast:
          (Math.max(foreground, background) + 0.05) /
          (Math.min(foreground, background) + 0.05),
      };
    });
    expect(presentation.color).toBe("rgb(11, 13, 16)");
    expect(presentation.backgroundColor).toBe("rgb(201, 162, 39)");
    expect(presentation.contrast).toBeGreaterThanOrEqual(4.5);
    return presentation;
  }

  async function captureSurface(page, surface, primaryButton = null) {
    for (const width of [375, 1280]) {
      for (const colorScheme of ["light", "dark"]) {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme });
        await page.evaluate(() => document.fonts.ready);
        await expectNoHorizontalOverflow(page);
        if (primaryButton) {
          await expect(primaryButton).toHaveText("FIND POLL");
          await expectPrimaryButtonContrast(primaryButton);
        }
        await page.screenshot({
          path: `${PROOF_DIR}/${surface}-${width}-${colorScheme}.png`,
          fullPage: true,
        });
      }
    }
  }

  async function forgeModeration(page, baseURL, target, intent) {
    const csrfToken =
      (await page
        .locator('input[name="csrf_token"]')
        .first()
        .getAttribute("value")) ?? "";
    expect(csrfToken).not.toBe("");
    const response = await page.request.post("/creator/moderation", {
      form: { csrf_token: csrfToken, target, intent },
      headers: {
        origin: requireBaseUrl(baseURL),
        "sec-fetch-site": "same-origin",
      },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(403);
    expect(response.headers()["cache-control"]).toBe("private, no-store");
    expect(await response.text()).toBe("Administrator access required.");
  }

  async function findTarget(page, lookupValue, question) {
    await page.getByLabel("POLL LINK OR REFERENCE").fill(lookupValue);
    await page.getByRole("button", { name: "FIND POLL" }).click();
    await expect(page.locator("[data-moderation-target]")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: question, level: 2 }),
    ).toBeVisible();
  }

  test("delists without touching the Poll, denies Creator forgery, restores both listing choices, and captures the 12-view proof", async ({
    browser,
    baseURL,
  }) => {
    const origin = requireBaseUrl(baseURL);
    const runId = randomUUID().slice(0, 8);
    const contexts = [];

    const owner = await seedCreatorSession();
    const administrator = await seedCreatorSession("administrator");

    const ownerContext = await browser.newContext({ baseURL: origin });
    contexts.push(ownerContext);
    await addSessionCookie(ownerContext, baseURL, owner);
    const ownerPage = observePage(await ownerContext.newPage(), "Creator");

    const adminContext = await browser.newContext({ baseURL: origin });
    contexts.push(adminContext);
    await addSessionCookie(adminContext, baseURL, administrator);
    const adminPage = observePage(await adminContext.newPage(), "Administrator");

    const voterContext = await browser.newContext({ baseURL: origin });
    contexts.push(voterContext);
    const voterPage = observePage(await voterContext.newPage(), "Voter");

    try {
      const listed = await publishPoll(ownerPage, {
        question: "Which launch ritual stays public?",
        reference: `ritual-public-${runId}`,
        listing: "listed",
      });
      const unlisted = await publishPoll(ownerPage, {
        question: "Which private ritual stays private?",
        reference: `ritual-private-${runId}`,
        listing: "unlisted",
      });
      expectDiscoveryState(listed.pollId, "listed");
      expectDiscoveryState(unlisted.pollId, "unlisted");

      await expectDiscoverVisibility(voterPage, listed, true);
      await expectDiscoverVisibility(voterPage, unlisted, false);
      await expectSitemapVisibility(voterPage, baseURL, listed, true);
      await expectSitemapVisibility(voterPage, baseURL, unlisted, false);

      await ownerPage.goto(listed.detailPath);
      await forgeModeration(ownerPage, baseURL, listed.reference, "delist");
      expectDiscoveryState(listed.pollId, "listed");

      await adminPage.goto("/creator/moderation");
      expect((await adminPage.request.get("/creator/moderation")).headers()["cache-control"]).toBe(
        "private, no-store",
      );
      const lookup = adminPage.getByLabel("POLL LINK OR REFERENCE");
      const findButton = adminPage.getByRole("button", { name: "FIND POLL" });
      await tabTo(adminPage, lookup);
      await adminPage.keyboard.press("Tab");
      await expect(findButton).toBeFocused();
      await expectVisibleFocus(findButton);
      await expectAtLeast44Px(lookup);
      await expectAtLeast44Px(findButton);

      await findTarget(adminPage, `${origin}${listed.publicPath}`, listed.question);
      await expect(adminPage.locator(".canonical-link")).toHaveText(
        listed.publicPath,
      );
      await expect(adminPage.locator(".target-facts")).toContainText("OPEN");
      await expect(adminPage.locator(".target-facts")).toContainText("LISTED");
      const delistButton = adminPage.getByRole("button", { name: "DELIST" });
      await expectAtLeast44Px(delistButton);
      await tabTo(adminPage, delistButton, 4);
      await expectVisibleFocus(delistButton);
      await delistButton.click();

      await expect(adminPage).toHaveURL(
        `${origin}/creator/moderation?target=${listed.reference}&outcome=delisted`,
      );
      await expect(adminPage.locator('[data-moderation-outcome="delisted"]')).toHaveText(
        "Poll delisted.",
      );
      await expect(adminPage.locator(".target-facts")).toContainText("DELISTED");
      expectDiscoveryState(listed.pollId, "delisted");

      const clearButton = adminPage.getByRole("button", {
        name: "CLEAR DELISTED",
      });
      await expectAtLeast44Px(clearButton);
      await tabTo(adminPage, clearButton, 4);
      await expectVisibleFocus(clearButton);
      await captureSurface(adminPage, "operator-delisted", findButton);

      await expectDiscoverVisibility(voterPage, listed, false);
      await expectSitemapVisibility(voterPage, baseURL, listed, false);

      await ownerPage.goto(listed.detailPath);
      await expect(
        ownerPage.locator(
          '[data-creator-detail] [data-listing-badge][data-state="delisted"]',
        ),
      ).toHaveCount(1);
      await expect(ownerPage.getByText(CREATOR_DELISTED_COPY, { exact: true })).toHaveCount(
        1,
      );
      const readonlyListing = ownerPage.locator("[data-listing-readonly]");
      await expect(readonlyListing).toBeVisible();
      await expect(readonlyListing.getByText("DELISTED", { exact: true })).toBeVisible();
      await expect(readonlyListing.locator("form, input, button")).toHaveCount(0);
      await expect(ownerPage.getByRole("button", { name: "SAVE LISTING" })).toHaveCount(
        0,
      );
      await expectAtLeast44Px(readonlyListing.locator(".listing-readonly-row"));
      expect(
        await readonlyListing.locator(".listing-readonly-row").evaluate((node) =>
          getComputedStyle(node).opacity,
        ),
      ).toBe("1");

      await forgeModeration(
        ownerPage,
        baseURL,
        listed.reference,
        "clear_delisted",
      );
      expectDiscoveryState(listed.pollId, "delisted");
      await captureSurface(ownerPage, "creator-delisted");

      await voterPage.goto(listed.publicPath);
      await expect(
        voterPage.getByRole("heading", { name: listed.question }),
      ).toBeVisible();
      await expectModerationBlind(voterPage);
      await expect(voterPage.locator('meta[name="robots"]')).toHaveAttribute(
        "content",
        /noindex/u,
      );
      const alpha = voterPage.getByRole("radio", { name: "Alpha" });
      await tabTo(voterPage, alpha);
      const alphaRow = voterPage.locator("label.poll-option", { hasText: "Alpha" });
      await expectVisibleFocus(alphaRow);
      await expectAtLeast44Px(alphaRow);
      await captureSurface(voterPage, "voter-linked-poll");

      // Cast through the native no-JavaScript floor. This proves the linked
      // Delisted Poll still accepts a Vote without involving the JS-only
      // connectivity probe or weakening the clean-network assertion.
      const noJsVoterContext = await browser.newContext({
        baseURL: origin,
        javaScriptEnabled: false,
      });
      contexts.push(noJsVoterContext);
      const noJsVoterPage = observePage(
        await noJsVoterContext.newPage(),
        "Voter no-JavaScript",
      );
      await noJsVoterPage.goto(listed.publicPath);
      await expectModerationBlind(noJsVoterPage);
      await noJsVoterPage.locator("label.poll-option", { hasText: "Alpha" }).click();
      await noJsVoterPage.getByRole("button", { name: "VOTE" }).click();
      await expect(noJsVoterPage.locator("[data-vote-outcome]")).toContainText(
        "Counted.",
      );
      expect(
        d1Query(`SELECT COUNT(*) AS votes FROM vote WHERE poll_id = '${listed.pollId}'`),
      ).toEqual([{ votes: 1 }]);
      await expectModerationBlind(noJsVoterPage);

      await voterPage.goto(listed.resultsPath);
      await expectModerationBlind(voterPage);
      await expect(
        voterPage.getByRole("img", {
          name: "Alpha, 100 percent, 1 vote, leading",
        }),
      ).toBeVisible();

      await adminPage.goto(
        `/creator/moderation?target=${listed.reference}&outcome=delisted`,
      );
      await adminPage.getByRole("button", { name: "CLEAR DELISTED" }).click();
      await expect(adminPage).toHaveURL(
        `${origin}/creator/moderation?target=${listed.reference}&outcome=cleared`,
      );
      await expect(adminPage.locator('[data-moderation-outcome="cleared"]')).toHaveText(
        "Delisting cleared.",
      );
      expectDiscoveryState(listed.pollId, "listed");

      await expectDiscoverVisibility(voterPage, listed, true);
      await expectSitemapVisibility(voterPage, baseURL, listed, true);
      await ownerPage.reload();
      await ownerPage.goto(listed.detailPath);
      await expect(ownerPage.locator("#detail-listing-listed")).toBeChecked();
      await expect(ownerPage.getByRole("button", { name: "SAVE LISTING" })).toBeVisible();
      await expect(ownerPage.locator("[data-listing-readonly]")).toHaveCount(0);

      const noJsAdminContext = await browser.newContext({
        baseURL: origin,
        javaScriptEnabled: false,
      });
      contexts.push(noJsAdminContext);
      await noJsAdminContext.addCookies([
        {
          name: "better-auth.session_token",
          value: administrator.cookieValue,
          url: origin,
        },
      ]);
      const noJsAdminPage = observePage(
        await noJsAdminContext.newPage(),
        "Administrator no-JavaScript",
      );
      await noJsAdminPage.goto("/creator/moderation");
      await findTarget(noJsAdminPage, unlisted.reference, unlisted.question);
      await expect(noJsAdminPage.locator(".target-facts")).toContainText("UNLISTED");
      await noJsAdminPage.getByRole("button", { name: "DELIST" }).click();
      const noJsDelistedOutcome = noJsAdminPage.locator(
        '[data-moderation-outcome="delisted"]',
      );
      await expect(noJsDelistedOutcome).toHaveText(
        "Poll delisted.",
      );
      await expect(noJsDelistedOutcome).toBeFocused();
      expectDiscoveryState(unlisted.pollId, "delisted");
      await noJsAdminPage.getByRole("button", { name: "CLEAR DELISTED" }).click();
      const noJsClearedOutcome = noJsAdminPage.locator(
        '[data-moderation-outcome="cleared"]',
      );
      await expect(noJsClearedOutcome).toHaveText(
        "Delisting cleared.",
      );
      await expect(noJsClearedOutcome).toBeFocused();
      expectDiscoveryState(unlisted.pollId, "unlisted");
      await expectDiscoverVisibility(voterPage, unlisted, false);
      await expectSitemapVisibility(voterPage, baseURL, unlisted, false);
    } finally {
      for (const context of contexts.reverse()) {
        await context.close();
      }
    }
  });
});
