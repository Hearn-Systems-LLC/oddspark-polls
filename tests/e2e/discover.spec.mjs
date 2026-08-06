import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  assertUuid,
  cleanupCreator,
  cleanupCreators,
  d1Execute,
  requireBaseUrl,
  sql,
} from "./creator-session.mjs";

const owners = [];
const ERROR_COPY =
  "The directory didn't load. Try again — everything that was on screen is still there.";

function seedOwner() {
  const userId = randomUUID();
  assertUuid(userId);
  d1Execute(
    sql`INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (${userId}, 'Discover E2E', ${`${userId}@example.test`}, 1, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z');`,
  );
  owners.push(userId);
  return userId;
}

function seedPoll({
  ownerId,
  index,
  createdAtMs,
  state = "listed",
  deadlineMs = null,
  closedAtMs = null,
  pollId = randomUUID(),
  question = `Discover question ${index}?`,
  votes = index % 4,
  execute = true,
}) {
  assertUuid(ownerId);
  assertUuid(pollId);
  const optionId = randomUUID();
  const reference = `discover-${ownerId.slice(0, 8)}-${index}`;
  const statements = [
    sql`INSERT INTO poll (id, owner_user_id, poll_type, question, result_visibility, discovery_state, session_checks_enabled, representation_version, deadline_ms, closed_at_ms, created_at_ms, updated_at_ms) VALUES (${pollId}, ${ownerId}, 'multiple_choice', ${question}, 'creator_only', ${state}, 0, 1, NULL, NULL, ${createdAtMs}, ${createdAtMs});`,
    sql`INSERT INTO poll_option (id, poll_id, label, position, created_at_ms) VALUES (${optionId}, ${pollId}, 'Yes', 0, ${createdAtMs});`,
    sql`INSERT INTO poll_reference (reference, poll_id, kind, is_canonical, created_at_ms) VALUES (${reference}, ${pollId}, 'generated', 1, ${createdAtMs});`,
  ];
  for (let vote = 0; vote < votes; vote += 1) {
    const voteId = randomUUID();
    statements.push(
      sql`INSERT INTO vote (id, poll_id, submission_id, payload_hash, created_at_ms) VALUES (${voteId}, ${pollId}, ${randomUUID()}, ${`discover-${vote}`}, ${createdAtMs});`,
    );
  }
  if (deadlineMs !== null) {
    statements.push(
      sql`UPDATE poll SET deadline_ms = ${deadlineMs} WHERE id = ${pollId};`,
    );
  }
  if (closedAtMs !== null) {
    statements.push(
      sql`UPDATE poll SET closed_at_ms = ${closedAtMs} WHERE id = ${pollId};`,
    );
  }
  if (execute) d1Execute(sql.join(statements));
  return { pollId, question, reference, statements };
}

function seedCatalog(ownerId, count, startAt = Date.now() - 100_000) {
  const rows = Array.from({ length: count }, (_, offset) =>
    seedPoll({
      ownerId,
      index: offset + 1,
      createdAtMs: startAt + offset + 1,
      execute: false,
    }),
  );
  d1Execute(sql.join(rows.flatMap((row) => row.statements)));
  return rows;
}

function watchPage(
  page,
  allowedFailure = () => false,
  allowedConsole = () => false,
) {
  const consoleErrors = [];
  const failedResponses = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !allowedConsole(message)) {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400 && !allowedFailure(response)) {
      failedResponses.push(`${response.status()} ${response.url()}`);
    }
  });
  return () => {
    expect(consoleErrors).toEqual([]);
    expect(failedResponses).toEqual([]);
  };
}

test.describe.serial("Discover catalog", () => {
  test.afterEach(() => {
    cleanupCreators(owners.splice(0).reverse());
  });

  test("keeps 45 rows traversable in stable order with JavaScript disabled", async ({
    browser,
    baseURL,
  }) => {
    const ownerId = seedOwner();
    const base = Date.now() - 100_000;
    const rows = seedCatalog(ownerId, 43, base);
    const tieLow = seedPoll({
      ownerId,
      index: 44,
      createdAtMs: base + 100,
      pollId: "90000000-0000-4000-8000-000000000001",
    });
    const tieHigh = seedPoll({
      ownerId,
      index: 45,
      createdAtMs: base + 100,
      pollId: "90000000-0000-4000-8000-000000000002",
    });
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    const assertClean = watchPage(page);

    await page.goto(`${requireBaseUrl(baseURL)}/discover`);
    const cards = page.locator("[data-poll-card]");
    await expect(cards).toHaveCount(20);
    await expect(cards.nth(0)).toContainText(tieHigh.question);
    await expect(cards.nth(1)).toContainText(tieLow.question);
    await expect(page.getByText("NEWER", { exact: true })).not.toHaveAttribute(
      "href",
    );
    await expect(page.getByRole("link", { name: "OLDER" })).toHaveAttribute(
      "href",
      /\/discover\?older=/,
    );
    await expect(page.locator(".poll-card-listing")).toHaveCount(0);

    await page.getByRole("link", { name: "OLDER" }).click();
    await expect(page).toHaveURL(/\/discover\?older=/);
    await expect(cards).toHaveCount(20);
    await expect(page.getByRole("link", { name: "NEWER" })).toBeVisible();
    await expect(page.getByRole("link", { name: "OLDER" })).toBeVisible();

    await page.getByRole("link", { name: "OLDER" }).click();
    await expect(cards).toHaveCount(5);
    await expect(page.getByText("OLDER", { exact: true })).not.toHaveAttribute(
      "href",
    );
    await expect(page.getByRole("link", { name: "NEWER" })).toBeVisible();

    await page.getByRole("link", { name: "NEWER" }).click();
    await expect(cards).toHaveCount(20);
    const firstHref = await cards.first().getAttribute("href");
    await cards.first().click();
    await expect(page).toHaveURL(`${requireBaseUrl(baseURL)}${firstHref}`);
    await expect(page.locator("h1.poll-question")).toBeVisible();
    await expect(page.locator("main")).not.toContainText("LISTED");

    expect(rows).toHaveLength(43);
    assertClean();
    await context.close();
  });

  test("omits unlisted, delisted, manually closed, and deadline-expired Polls", async ({
    page,
  }) => {
    const assertClean = watchPage(page);
    const ownerId = seedOwner();
    const now = Date.now();
    const visible = seedPoll({ ownerId, index: 1, createdAtMs: now });
    const hidden = [
      seedPoll({ ownerId, index: 2, createdAtMs: now + 1, state: "unlisted" }),
      seedPoll({ ownerId, index: 3, createdAtMs: now + 2, state: "delisted" }),
      seedPoll({ ownerId, index: 4, createdAtMs: now + 3, closedAtMs: now }),
      seedPoll({ ownerId, index: 5, createdAtMs: now + 4, deadlineMs: now - 1 }),
    ];

    await page.goto("/discover");
    await expect(page.locator("[data-poll-card]")).toHaveCount(1);
    await expect(page.locator("[data-poll-card]")).toContainText(visible.question);
    for (const poll of hidden) {
      await expect(page.locator("main")).not.toContainText(poll.question);
    }
    assertClean();
  });

  test("retains rows through loading and failure, then retries and restores history", async ({
    page,
  }) => {
    let permitFailure = false;
    const assertClean = watchPage(
      page,
      (response) => permitFailure && response.url().includes("/discover?older="),
      (message) => permitFailure && message.text().includes("status of 503"),
    );
    const ownerId = seedOwner();
    seedCatalog(ownerId, 45);
    await page.goto("/discover");
    const originalFirst = await page.locator("[data-poll-card]").first().innerText();
    const older = page.getByRole("link", { name: "OLDER" });

    let releaseLoading;
    const loadingGate = new Promise((resolve) => {
      releaseLoading = resolve;
    });
    let firstRequest = true;
    const loadingHandler = async (route) => {
      if (firstRequest) {
        firstRequest = false;
        await loadingGate;
      }
      await route.continue();
    };
    await page.route("**/discover?older=*", loadingHandler);
    await older.click();
    await expect(page.locator("[data-discover-skeletons] li")).toHaveCount(20);
    await expect(page.locator("[data-discover-loaded]")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    await expect(page.locator("[data-poll-card]")).toHaveCount(20);
    await expect(page.locator("[data-poll-card]").first()).toContainText(
      originalFirst.split("\n")[0],
    );
    const skeletonMotion = await page.locator("[data-discover-skeletons] li").first().evaluate(
      (node) => ({
        animation: getComputedStyle(node).animationName,
        transition: getComputedStyle(node).transitionDuration,
      }),
    );
    expect(skeletonMotion).toEqual({ animation: "none", transition: "0s" });
    releaseLoading();
    await expect(page).toHaveURL(/\/discover\?older=/);
    await expect(page.locator("[data-discover-skeletons]")).toHaveCount(0);
    await expect(page.locator("[data-discover-loaded]")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await page.unroute("**/discover?older=*", loadingHandler);

    await page.evaluate(() => history.back());
    await expect(page).toHaveURL(/\/discover$/);
    await expect(page.locator("[data-poll-card]").first()).toContainText(
      originalFirst.split("\n")[0],
    );

    permitFailure = true;
    const failureHandler = (route) =>
      route.fulfill({ status: 503, contentType: "text/plain", body: "unavailable" });
    await page.route("**/discover?older=*", failureHandler);
    await older.click();
    await expect(page.locator("[data-discover-error]")).toContainText(ERROR_COPY);
    await expect(page.locator("[data-discover-error] a")).toHaveText("TRY AGAIN");
    await expect(page.locator("[data-poll-card]")).toHaveCount(20);
    await expect(page.locator("[data-discover-loaded]")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await expect(page.locator("[data-discover-status]")).toHaveText(ERROR_COPY);
    await page.unroute("**/discover?older=*", failureHandler);
    permitFailure = false;
    await page.locator("[data-discover-error] a").click();
    await expect(page).toHaveURL(/\/discover\?older=/);
    await expect(page.locator("[data-poll-card]")).toHaveCount(20);
    assertClean();
  });

  test("prevents an aborted older response from replacing the newer navigation", async ({
    page,
  }) => {
    const assertClean = watchPage(page);
    const ownerId = seedOwner();
    seedCatalog(ownerId, 45);
    await page.goto("/discover");

    let releaseFirst;
    const firstGate = new Promise((resolve) => {
      releaseFirst = resolve;
    });
    let requestCount = 0;
    const handler = async (route) => {
      requestCount += 1;
      if (requestCount === 1) {
        await firstGate;
        try {
          await route.fulfill({
            status: 200,
            contentType: "text/html",
            body: '<section data-discover-catalog-region><h1>STALE RESPONSE</h1></section>',
          });
        } catch {
          // AbortController may close the first route before fulfillment.
        }
        return;
      }
      await route.continue();
    };
    await page.route("**/discover?older=*", handler);
    const older = page.getByRole("link", { name: "OLDER" });
    await older.click();
    await older.click();
    await expect(page).toHaveURL(/\/discover\?older=/);
    releaseFirst();
    await page.waitForTimeout(50);
    await expect(page.locator("main")).not.toContainText("STALE RESPONSE");
    await expect(page.locator("[data-poll-card]")).toHaveCount(20);
    expect(requestCount).toBe(2);
    assertClean();
  });

  test("proves empty/error states and mobile dark plus desktop light catalog visuals", async ({
    page,
  }) => {
    let permitFailure = false;
    const assertClean = watchPage(
      page,
      (response) => permitFailure && response.url().includes("/discover?older="),
      (message) => permitFailure && message.text().includes("status of 503"),
    );
    const ownerId = seedOwner();
    seedCatalog(ownerId, 21);
    const proofDir = "test-results/story-3-2-discover-proof";

    await page.emulateMedia({ colorScheme: "dark" });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/discover");
    const older = page.getByRole("link", { name: "OLDER" });
    const geometry = await older.evaluate((node) => {
      const box = node.getBoundingClientRect();
      return { height: box.height, minHeight: getComputedStyle(node).minHeight };
    });
    expect(geometry.height).toBeGreaterThanOrEqual(48);
    expect(geometry.minHeight).toBe("48px");
    await older.focus();
    await expect(older).toHaveCSS("outline-width", "2px");
    await expect(older).toHaveCSS("outline-offset", "2px");
    await page.screenshot({
      path: `${proofDir}/catalog-375-dark.png`,
      fullPage: true,
    });

    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({
      path: `${proofDir}/catalog-1280-light.png`,
      fullPage: true,
    });

    permitFailure = true;
    const failureHandler = (route) =>
      route.fulfill({ status: 503, contentType: "text/plain", body: "unavailable" });
    await page.route("**/discover?older=*", failureHandler);
    await older.click();
    await expect(page.locator("[data-discover-error]")).toContainText(ERROR_COPY);
    await page.screenshot({ path: `${proofDir}/error-1280-light.png`, fullPage: true });
    await page.unroute("**/discover?older=*", failureHandler);
    permitFailure = false;

    cleanupCreator(ownerId);
    owners.splice(owners.indexOf(ownerId), 1);
    await page.goto("/discover");
    await expect(page.locator("[data-discover-empty]")).toContainText(
      "Nothing here yet. Polls appear when their Creators opt them in. Yours could be the first.",
    );
    await expect(page.getByRole("link", { name: "CREATE A POLL" })).toHaveAttribute(
      "href",
      "/creator/new",
    );
    await page.screenshot({ path: `${proofDir}/empty-1280-light.png`, fullPage: true });
    assertClean();
  });
});
