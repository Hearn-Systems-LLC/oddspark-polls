import { expect, test } from "@playwright/test";
import {
  agePoll,
  assertUuid,
  cleanupCreator,
  closePoll,
  d1Execute,
  d1Query,
  hasBetterAuthSecret,
  requireBaseUrl,
  seedCreatorSession,
  setPollDeadline,
} from "./creator-session.mjs";

// Story 1.11 — creator dashboard: list, empty state, ownership, two-column
// detail, signed-in flash, no-JS floor.

test.describe.configure({ mode: "serial", timeout: 120_000 });

test.describe("creator dashboard", () => {
  test.skip(
    !hasBetterAuthSecret(),
    "BETTER_AUTH_SECRET is not provisioned in .dev.vars — the authed suite needs local auth material",
  );

  const seededUserIds = [];
  let pagesUnderTest = [];

  function watchConsole(page) {
    if (pagesUnderTest.some(({ observedPage }) => observedPage === page)) {
      return page;
    }
    const errors = [];
    const expectedDocument404Urls = new Set();
    pagesUnderTest.push({
      observedPage: page,
      errors,
      expectedDocument404Urls,
    });
    page.on("console", (message) => {
      if (message.type() === "error") {
        const text = message.text();
        // Chromium reports the intentional foreign-detail document 404 as a
        // console error. Consume only the exact navigation registered by that
        // ownership test so unrelated missing resources still fail the suite.
        const expectedDocument404 =
          /^Failed to load resource: the server responded with a status of 404 \(/u.test(
            text,
          ) && expectedDocument404Urls.delete(message.location().url);
        if (expectedDocument404) {
          return;
        }
        errors.push(text);
      }
    });
    page.on("pageerror", (error) => {
      errors.push(error.message);
    });
    return page;
  }

  function allowExpectedDocument404(page, expectedUrl) {
    const watchedPage = pagesUnderTest.find(
      ({ observedPage }) => observedPage === page,
    );
    if (!watchedPage) {
      throw new Error(
        "Expected the page console to be watched before navigation",
      );
    }
    watchedPage.expectedDocument404Urls.add(expectedUrl);
  }

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
    return seeded;
  }

  async function publishPoll(page, question, optionA = "A", optionB = "B") {
    await page.goto("/creator/new");
    await page.getByLabel("QUESTION").fill(question);
    await page.getByRole("textbox", { name: "OPTION 1" }).fill(optionA);
    await page.getByRole("textbox", { name: "OPTION 2" }).fill(optionB);
    await page.getByRole("button", { name: "PUBLISH POLL" }).click();
    await expect(page).toHaveURL(/\/creator\/polls\/[^?]+\?created/);
    const match = /\/creator\/polls\/([^?]+)/.exec(page.url());
    const pollId = match?.[1];
    assertUuid(pollId);
    return pollId;
  }

  test.beforeEach(({ page }) => {
    pagesUnderTest = [];
    watchConsole(page);
  });

  test.afterEach(() => {
    for (const { errors } of pagesUnderTest) {
      expect(errors).toEqual([]);
    }
  });

  test.afterAll(() => {
    for (const userId of seededUserIds) {
      cleanupCreator(userId);
    }
  });

  test("empty state shows verbatim copy and create action", async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, baseURL);
    await page.goto("/creator");
    await expect(
      page.getByText("No Polls yet. The empty state, working as intended."),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "CREATE A POLL" }),
    ).toHaveAttribute("href", "/creator/new");
  });

  test("signed-out /creator redirects to sign-in with return address", async ({
    page,
  }) => {
    const original = await page.request.get("/creator", { maxRedirects: 0 });
    expect(original.status()).toBe(303);
    expect(original.headers()["location"]).toBe(
      "/sign-in?return=%2Fcreator",
    );

    await page.goto("/creator");
    await expect(page).toHaveURL(/\/sign-in\?return=/);
    const url = new URL(page.url());
    expect(url.searchParams.get("return")).toBe("/creator");
  });

  test("signed-in flash focuses the outcome and leads the title", async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, baseURL);
    await page.goto("/creator?outcome=signed-in");
    await expect(page).toHaveTitle(/^Signed in/);
    const outcome = page.locator("[data-outcome='signed-in']");
    await expect(outcome).toBeVisible();
    await expect(outcome).toBeFocused();
  });

  test("lists only owned polls with caption shape, ordering, and CLOSED", async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, baseURL);
    const olderLive = await publishPoll(page, "Older live poll");
    const newerLive = await publishPoll(page, "Newer live poll");
    const closedPoll = await publishPoll(page, "Closed poll");
    const deadlineClosed = await publishPoll(page, "Deadline passed poll");

    // Newest-first within live: age olderLive so newerLive is newer.
    agePoll(olderLive, Date.now() - 60_000);
    agePoll(newerLive, Date.now() - 10_000);
    agePoll(closedPoll, Date.now() - 5_000);
    closePoll(closedPoll, Date.now() - 1_000);
    // Deadline-passed unmaterialized: closed_at NULL, deadline in past.
    setPollDeadline(deadlineClosed, Date.now() - 1_000);
    agePoll(deadlineClosed, Date.now() - 20_000);

    await page.goto("/creator");
    const cards = page.locator("[data-poll-card]");
    await expect(cards).toHaveCount(4);

    // Live above closed; newest live first.
    await expect(cards.nth(0)).toContainText("Newer live poll");
    await expect(cards.nth(1)).toContainText("Older live poll");
    // Closed group (order among closed is newest-first by created_at).
    const closedTexts = await cards.evaluateAll((nodes) =>
      nodes.map((node) => node.textContent ?? ""),
    );
    const closedIdx = closedTexts.findIndex((t) => t.includes("Closed poll"));
    const deadlineIdx = closedTexts.findIndex((t) =>
      t.includes("Deadline passed poll"),
    );
    expect(closedIdx).toBeGreaterThanOrEqual(2);
    expect(deadlineIdx).toBeGreaterThanOrEqual(2);
    expect(closedIdx).toBeLessThan(deadlineIdx);
    await expect(cards.nth(closedIdx)).toContainText("CLOSED");
    await expect(cards.nth(deadlineIdx)).toContainText("CLOSED");

    // Caption: type · votes (zero votes, no deadline on these live polls).
    await expect(cards.nth(0).locator(".poll-card-meta")).toHaveText(
      "MULTIPLE CHOICE · 0 VOTES",
    );
  });

  test("singular VOTE caption when one voter has accepted", async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, baseURL);
    const pollId = await publishPoll(page, "One vote poll");
    const options = d1Query(
      `SELECT id FROM poll_option WHERE poll_id = '${pollId}' ORDER BY position`,
    );
    const optionId = options[0]?.id;
    expect(optionId).toBeTruthy();
    assertUuid(optionId);
    const voteId = crypto.randomUUID();
    assertUuid(voteId);
    d1Execute(
      `INSERT INTO vote (id, poll_id, submission_id, payload_hash, created_at_ms) VALUES ('${voteId}', '${pollId}', 'sub-${voteId}', 'hash', ${Date.now()});` +
        `INSERT INTO vote_selection (vote_id, poll_option_id) VALUES ('${voteId}', '${optionId}');`,
    );

    await page.goto("/creator");
    const card = page.locator("[data-poll-card]").filter({
      hasText: "One vote poll",
    });
    await expect(card.locator(".poll-card-meta")).toHaveText(
      "MULTIPLE CHOICE · 1 VOTE",
    );
  });

  test("ownership: other creator never sees foreign polls; foreign detail is 404", async ({
    browser,
    baseURL,
  }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = watchConsole(await contextA.newPage());
    const pageB = watchConsole(await contextB.newPage());

    await signIn(contextA, baseURL);
    const pollA = await publishPoll(pageA, "Only A owns this");
    await signIn(contextB, baseURL);

    await pageB.goto("/creator");
    await expect(pageB.locator("[data-poll-card]")).toHaveCount(0);
    await expect(
      pageB.getByText("No Polls yet. The empty state, working as intended."),
    ).toBeVisible();

    const foreignDetailUrl = new URL(
      `/creator/polls/${pollA}`,
      requireBaseUrl(baseURL),
    ).href;
    allowExpectedDocument404(pageB, foreignDetailUrl);
    const response = await pageB.goto(foreignDetailUrl);
    expect(response?.status()).toBe(404);
    await expect(pageB.getByText("This Poll doesn't exist.")).toBeVisible();
    // Creator A still sees their poll.
    await pageA.goto("/creator");
    await expect(pageA.getByText("Only A owns this")).toBeVisible();

    await contextA.close();
    await contextB.close();
  });

  test("detail surface: two-column at lg, stacked below, aria-current, row nav", async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, baseURL);
    const pollId = await publishPoll(page, "Detail layout poll");
    await publishPoll(page, "Sibling poll");

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/creator/polls/${pollId}`);
    const surface = page.locator("[data-creator-surface]");
    const list = page.locator("[data-creator-list]");
    const detail = page.locator("[data-creator-detail]");
    await expect(surface).toBeVisible();
    await expect(list).toBeVisible();
    await expect(detail).toBeVisible();

    const display = await surface.evaluate((el) =>
      getComputedStyle(el).display,
    );
    expect(display).toBe("grid");
    const columns = await surface.evaluate((el) =>
      getComputedStyle(el).gridTemplateColumns,
    );
    // 320px + 1fr → two non-zero tracks
    expect(columns.split(" ").length).toBe(2);
    const [listPlacement, detailPlacement, listBox, detailBox] =
      await Promise.all([
        list.evaluate((el) => getComputedStyle(el).gridColumnStart),
        detail.evaluate((el) => getComputedStyle(el).gridColumnStart),
        list.boundingBox(),
        detail.boundingBox(),
      ]);
    expect(listPlacement).toBe("1");
    expect(detailPlacement).toBe("2");
    expect(listBox).not.toBeNull();
    expect(detailBox).not.toBeNull();
    expect(listBox.x + listBox.width).toBeLessThan(detailBox.x);
    expect(Math.abs(listBox.y - detailBox.y)).toBeLessThan(1);

    const selected = page.locator(
      `[data-poll-card][href="/creator/polls/${pollId}"]`,
    );
    await expect(selected).toHaveAttribute("aria-current", "page");
    await expect(
      page.getByRole("link", { name: "VIEW LIVE RESULTS" }),
    ).toBeVisible();
    await expect(
      page.getByText("Detail layout poll").first(),
    ).toBeVisible();

    // Whole-row navigation from the list.
    await page
      .locator("[data-poll-card]", { hasText: "Sibling poll" })
      .click();
    await expect(page).toHaveURL(/\/creator\/polls\/[^/]+$/);
    await expect(
      page.getByRole("heading", { name: "Sibling poll" }),
    ).toBeVisible();

    // Focus lands on rows (global 2px focus ring).
    const row = page.locator("[data-poll-card]").first();
    await page.keyboard.press("Tab");
    await row.focus();
    await expect(row).toBeFocused();
    const focusRing = await row.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        focusVisible: el.matches(":focus-visible"),
        outlineWidth: style.outlineWidth,
        outlineStyle: style.outlineStyle,
        outlineOffset: style.outlineOffset,
      };
    });
    expect(focusRing).toEqual({
      focusVisible: true,
      outlineWidth: "2px",
      outlineStyle: "solid",
      outlineOffset: "2px",
    });

    // Mobile: both regions present, single column.
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/creator/polls/${pollId}`);
    const mobileDisplay = await page
      .locator("[data-creator-surface]")
      .evaluate((el) => getComputedStyle(el).display);
    // Below lg the surface is not a two-column grid (block/flow).
    expect(mobileDisplay).not.toBe("grid");
    await expect(page.locator("[data-creator-list]")).toBeVisible();
    await expect(page.locator("[data-creator-detail]")).toBeVisible();
    const order = await page.evaluate(() => {
      const list = document.querySelector("[data-creator-list]");
      const detail = document.querySelector("[data-creator-detail]");
      if (!list || !detail) return null;
      return list.compareDocumentPosition(detail) &
        Node.DOCUMENT_POSITION_FOLLOWING
        ? "list-then-detail"
        : "other";
    });
    expect(order).toBe("list-then-detail");
  });

  test("proves key surfaces in a real browser — 375 dark and desktop light", async ({
    page,
    context,
    baseURL,
  }) => {
    const proofDir = "test-results/creator-dashboard-proof";
    await signIn(context, baseURL);

    // Empty state — 375px dark
    await page.emulateMedia({ colorScheme: "dark" });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/creator");
    await expect(
      page.getByText("No Polls yet. The empty state, working as intended."),
    ).toBeVisible();
    await page.screenshot({
      path: `${proofDir}/empty-375-dark.png`,
      fullPage: true,
    });

    // Empty state — desktop light
    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/creator");
    await expect(
      page.getByText("No Polls yet. The empty state, working as intended."),
    ).toBeVisible();
    await page.screenshot({
      path: `${proofDir}/empty-1280-light.png`,
      fullPage: true,
    });

    const pollId = await publishPoll(page, "Proof dashboard poll");
    await publishPoll(page, "Proof sibling poll");
    closePoll(pollId, Date.now() - 500);

    // Populated dashboard — 375 dark
    await page.emulateMedia({ colorScheme: "dark" });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/creator");
    await expect(page.locator("[data-poll-card]")).toHaveCount(2);
    await page.screenshot({
      path: `${proofDir}/list-375-dark.png`,
      fullPage: true,
    });

    // Populated dashboard — desktop light
    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/creator");
    await expect(page.locator("[data-poll-card]")).toHaveCount(2);
    await page.screenshot({
      path: `${proofDir}/list-1280-light.png`,
      fullPage: true,
    });

    // Two-column detail — desktop light
    const sibling = page.locator("[data-poll-card]", {
      hasText: "Proof sibling poll",
    });
    const siblingHref = await sibling.getAttribute("href");
    expect(siblingHref).toBeTruthy();
    await page.goto(siblingHref);
    await expect(page.locator("[data-creator-surface]")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "VIEW LIVE RESULTS" }),
    ).toBeVisible();
    await page.screenshot({
      path: `${proofDir}/detail-1280-light.png`,
      fullPage: true,
    });

    // Detail stacked — 375 dark
    await page.emulateMedia({ colorScheme: "dark" });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(siblingHref);
    await expect(page.locator("[data-creator-list]")).toBeVisible();
    await expect(page.locator("[data-creator-detail]")).toBeVisible();
    await page.screenshot({
      path: `${proofDir}/detail-375-dark.png`,
      fullPage: true,
    });
  });

  test("no-JS floor: dashboard rows, captions, statuses, and links work", async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
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
    const page = await context.newPage();
    await page.goto("/creator/new");
    await page.getByLabel("QUESTION").fill("No JS poll");
    await page.getByRole("textbox", { name: "OPTION 1" }).fill("One");
    await page.getByRole("textbox", { name: "OPTION 2" }).fill("Two");
    await page.getByRole("button", { name: "PUBLISH POLL" }).click();
    await expect(page).toHaveURL(/\/creator\/polls\/[^?]+\?created/);
    const match = /\/creator\/polls\/([^?]+)/.exec(page.url());
    const pollId = match?.[1];
    assertUuid(pollId);
    const futureYear = new Date().getUTCFullYear() + 1;
    const futureDeadlineMs = Date.UTC(futureYear, 0, 2, 15, 4);
    expect(futureDeadlineMs - Date.now()).toBeGreaterThanOrEqual(
      24 * 60 * 60 * 1_000,
    );
    setPollDeadline(pollId, futureDeadlineMs);
    const expectedUtcFloor = new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "UTC",
      timeZoneName: "short",
    }).format(futureDeadlineMs);

    await page.goto("/creator");
    await expect(page.locator("[data-poll-card]")).toHaveCount(1);
    await expect(page.locator(".poll-card-meta")).toContainText(
      "MULTIPLE CHOICE",
    );
    await expect(page.locator("[data-poll-card]")).toContainText("LIVE");
    const deadline = page.locator(
      "[data-poll-card] time[data-deadline]",
    );
    await expect(deadline).toHaveAttribute(
      "data-deadline",
      String(futureDeadlineMs),
    );
    await expect(deadline).toHaveAttribute(
      "datetime",
      new Date(futureDeadlineMs).toISOString(),
    );
    await expect(deadline).toHaveText(expectedUtcFloor);
    await expect(page.locator(".poll-card-meta")).toHaveText(
      `MULTIPLE CHOICE · 0 VOTES · CLOSES ${expectedUtcFloor}`,
    );
    const href = await page.locator("[data-poll-card]").getAttribute("href");
    expect(href).toMatch(/^\/creator\/polls\//);
    await page.locator("[data-poll-card]").click();
    await expect(page).toHaveURL(/\/creator\/polls\//);
    await expect(
      page.getByRole("heading", { name: "No JS poll" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "VIEW LIVE RESULTS" }),
    ).toBeVisible();
    await context.close();
  });
});
