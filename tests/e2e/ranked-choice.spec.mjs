import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
  assertUuid,
  cleanupCreator,
  d1Execute,
  d1Query,
  hasBetterAuthSecret,
  requireBaseUrl,
  seedCreatorSession,
  sql,
} from "./creator-session.mjs";

test.describe.configure({ mode: "serial", timeout: 240_000 });
test.skip(
  !hasBetterAuthSecret(),
  "BETTER_AUTH_SECRET is required for the authenticated Ranked-Choice creation proof",
);

const PROOF_DIR = "test-results/story-5-1-ranked-choice-proof";
mkdirSync(PROOF_DIR, { recursive: true });

const browserErrors = new WeakMap();
let owner;

async function setMode(page, mode) {
  await page.emulateMedia({ colorScheme: mode, reducedMotion: "reduce" });
  await page.evaluate((resolved) => {
    localStorage.setItem("oddspark-mode", resolved);
    document.documentElement.setAttribute("data-mode", resolved);
  }, mode);
}

async function captureBoth(page, name) {
  await page.setViewportSize({ width: 375, height: 812 });
  await setMode(page, "dark");
  await page.screenshot({
    path: `${PROOF_DIR}/${name}-375-dark.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await setMode(page, "light");
  await page.screenshot({
    path: `${PROOF_DIR}/${name}-1280-light.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
}

function seedRankedPoll(ownerUserId, reference) {
  const pollId = randomUUID();
  const optionIds = [randomUUID(), randomUUID(), randomUUID()];
  const now = Date.now();
  d1Execute(
    sql.join([
      sql`INSERT INTO poll (id, owner_user_id, poll_type, question, result_visibility, discovery_state, session_checks_enabled, comments_enabled, multi_select_enabled, min_selections, max_selections, representation_version, created_at_ms, updated_at_ms) VALUES (${pollId}, ${ownerUserId}, 'ranked_choice', 'Rank without JavaScript?', 'live', 'unlisted', 0, 0, 0, NULL, NULL, 1, ${now}, ${now});`,
      sql`INSERT INTO poll_option (id, poll_id, label, position, created_at_ms) VALUES (${optionIds[0]}, ${pollId}, 'Pizza', 0, ${now}), (${optionIds[1]}, ${pollId}, 'Tacos', 1, ${now}), (${optionIds[2]}, ${pollId}, 'Ramen', 2, ${now});`,
      sql`INSERT INTO poll_reference (reference, poll_id, kind, is_canonical, created_at_ms) VALUES (${reference}, ${pollId}, 'custom', 1, ${now});`,
    ]),
  );
  return { pollId, optionIds, reference };
}

test.describe("Story 5.1 Ranked-Choice creation and Ballot", () => {
  test.beforeEach(({ page }) => {
    const errors = [];
    browserErrors.set(page, errors);
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      const expected422 =
        message.type() === "error" &&
        /status of 422/iu.test(message.text()) &&
        message.location().url === page.url();
      if (message.type() === "error" && !expected422) errors.push(message.text());
    });
  });

  test.afterEach(({ page }) => {
    expect(browserErrors.get(page) ?? []).toEqual([]);
  });

  test.afterAll(() => {
    if (owner?.userId) cleanupCreator(owner.userId);
  });

  test("creates, ranks by tap and keyboard, compacts, casts, and fails closed before IRV", async ({
    page,
    context,
    baseURL,
  }) => {
    owner = await seedCreatorSession();
    assertUuid(owner.userId);
    await context.addCookies([
      {
        name: "better-auth.session_token",
        value: owner.cookieValue,
        url: requireBaseUrl(baseURL),
      },
    ]);

    const reference = `ranked-${randomUUID().slice(0, 8)}`;
    await page.goto("/creator/new");
    await page.locator('label[for="poll-type-ranked_choice"]').click();
    await expect(
      page.getByRole("group", { name: "HOW MANY OPTIONS CAN A VOTER PICK" }),
    ).toBeHidden();
    await page.getByLabel("QUESTION").fill("Where should we eat in order?");
    await page.getByRole("textbox", { name: "OPTION 1" }).fill("Pizza");
    await page.getByRole("textbox", { name: "OPTION 2" }).fill("Tacos");
    await page.getByRole("textbox", { name: "OPTION 3" }).fill("Ramen");
    await page.getByLabel("CUSTOM LINK (OPTIONAL)").fill(reference);
    await page.getByRole("button", { name: "PUBLISH POLL" }).click();
    await expect(page).toHaveURL(/\/creator\/polls\/[^?]+\?created/u);
    const pollId = /\/creator\/polls\/([^?]+)/u.exec(page.url())?.[1] ?? "";
    assertUuid(pollId);
    expect(
      d1Query(
        sql`SELECT poll_type, multi_select_enabled, min_selections, max_selections FROM poll WHERE id = ${pollId}`,
      ),
    ).toEqual([
      {
        poll_type: "ranked_choice",
        multi_select_enabled: 0,
        min_selections: null,
        max_selections: null,
      },
    ]);
    await expect(page.locator("[data-export-csv], [data-export-xlsx]")).toHaveCount(0);

    await context.clearCookies();
    await page.goto(`/${reference}`);
    await expect(page.locator("astro-island")).toHaveCount(0);
    const summary = page.locator("[data-rank-summary]");
    await expect(summary).toHaveText(
      "RANKED 0 OF 3 · UNRANKED OPTIONS COUNT AS NO PREFERENCE",
    );
    await expect(page.getByRole("button", { name: "VOTE" })).toBeDisabled();
    await captureBoth(page, "fresh");

    let summaryMutations = 0;
    await summary.evaluate((node) => {
      window.__rankSummaryMutations = 0;
      new MutationObserver(() => {
        window.__rankSummaryMutations += 1;
      }).observe(node, { childList: true, characterData: true, subtree: true });
    });
    await page.getByRole("button", { name: "Pizza, unranked, activate to rank next" }).click();
    await expect(summary).toHaveText(
      "RANKED 1 OF 3 · UNRANKED OPTIONS COUNT AS NO PREFERENCE",
    );
    summaryMutations = await page.evaluate(() => window.__rankSummaryMutations);
    expect(summaryMutations).toBe(1);

    await page.getByRole("button", { name: "Tacos, unranked, activate to rank next" }).click();
    const ramen = page.getByRole("button", {
      name: "Ramen, unranked, activate to rank next",
    });
    await ramen.focus();
    await ramen.press("Space");
    await expect(page.getByRole("button", { name: "Ramen, rank 3 of 3, activate to unrank" })).toBeFocused();
    await captureBoth(page, "full-ranking");

    await page.getByRole("button", { name: "Tacos, rank 2 of 3, activate to unrank" }).click();
    await expect(page.getByRole("button", { name: "Ramen, rank 2 of 3, activate to unrank" })).toBeVisible();
    await expect(summary).toHaveText(
      "RANKED 2 OF 3 · UNRANKED OPTIONS COUNT AS NO PREFERENCE",
    );
    await captureBoth(page, "compacted-partial");

    await page.getByRole("button", { name: "VOTE" }).click();
    await expect(page).toHaveURL(`/${reference}`);
    await expect(page.locator("[data-vote-outcome]")).toContainText("Counted.");
    await expect(page.locator("[data-vote-outcome]")).toContainText(
      "Ranked-choice results aren't available yet.",
    );
    await captureBoth(page, "counted-unavailable");
    expect(
      d1Query(
        sql`SELECT rvp.poll_option_id, rvp.preference_rank FROM ranked_vote_preference rvp JOIN vote v ON v.id = rvp.vote_id WHERE v.poll_id = ${pollId} ORDER BY rvp.preference_rank`,
      ),
    ).toEqual([
      { poll_option_id: expect.any(String), preference_rank: 1 },
      { poll_option_id: expect.any(String), preference_rank: 2 },
    ]);

    const directResults = await page.request.get(`/${reference}/results`);
    expect(directResults.status()).toBe(200);
    expect(await directResults.text()).toContain(
      "Ranked-choice results aren&#39;t available yet.",
    );
    const live = await page.request.get(`/${reference}/results/live`);
    expect(live.status()).toBe(204);
    expect(live.headers()["cache-control"]).toBe("private, no-store");
  });

  test("keeps the complete rank and compact flow functional without JavaScript", async ({
    browser,
    baseURL,
  }) => {
    if (!owner) owner = await seedCreatorSession();
    const fixture = seedRankedPoll(
      owner.userId,
      `ranked-nojs-${randomUUID().slice(0, 8)}`,
    );
    const noJsContext = await browser.newContext({ javaScriptEnabled: false });
    const noJsPage = await noJsContext.newPage();
    await noJsPage.goto(`${requireBaseUrl(baseURL)}/${fixture.reference}`);
    await noJsPage.getByRole("button", { name: "Pizza, unranked, activate to rank next" }).click();
    await expect(noJsPage.locator("[data-rank-summary]")).toHaveText(
      "RANKED 1 OF 3 · UNRANKED OPTIONS COUNT AS NO PREFERENCE",
    );
    await noJsPage.getByRole("button", { name: "Tacos, unranked, activate to rank next" }).click();
    await noJsPage.getByRole("button", { name: "Pizza, rank 1 of 3, activate to unrank" }).click();
    await expect(noJsPage.getByRole("button", { name: "Tacos, rank 1 of 3, activate to unrank" })).toBeVisible();
    await noJsPage.getByRole("button", { name: "VOTE" }).click();
    await expect(noJsPage.locator("[data-vote-outcome]")).toContainText("Counted.");
    expect(
      d1Query(
        sql`SELECT rvp.poll_option_id, rvp.preference_rank FROM ranked_vote_preference rvp JOIN vote v ON v.id = rvp.vote_id WHERE v.poll_id = ${fixture.pollId}`,
      ),
    ).toEqual([
      { poll_option_id: fixture.optionIds[1], preference_rank: 1 },
    ]);
    await noJsContext.close();
  });
});
