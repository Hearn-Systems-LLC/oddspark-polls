import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  assertUuid,
  cleanupCreator,
  d1Execute,
  d1Query,
  deletePoll,
  hasBetterAuthSecret,
  seedCreatorSession,
  sql,
} from "./creator-session.mjs";

if (!hasBetterAuthSecret()) {
  throw new Error(
    "Landing E2E requires BETTER_AUTH_SECRET in .dev.vars; deterministic Demo setup is mandatory",
  );
}

test.describe.configure({ mode: "serial", timeout: 120_000 });
let demoOwner;

function seedLandingDemo(ownerUserId) {
  const existing = d1Query(
    sql`SELECT poll_id FROM poll_reference WHERE reference = 'demo' LIMIT 1`,
  )[0]?.poll_id;
  if (existing) {
    assertUuid(existing);
    deletePoll(existing);
  }
  const pollId = randomUUID();
  const now = Date.now();
  const options = ["Friday", "Monday", "Either works"];
  const statements = [
    sql`INSERT INTO poll (id, owner_user_id, poll_type, question, result_visibility, discovery_state, session_checks_enabled, deadline_ms, closed_at_ms, representation_version, created_at_ms, updated_at_ms, multi_select_enabled, min_selections, max_selections, ip_checks_enabled, voter_codes_enabled, captcha_enabled, vpn_blocking_enabled) VALUES (${pollId}, ${ownerUserId}, 'multiple_choice', 'Best day for a long weekend?', 'live', 'unlisted', 1, NULL, NULL, 1, ${now}, ${now}, 0, NULL, NULL, 0, 0, 1, 0);`,
    ...options.map((label, position) => {
      const optionId = randomUUID();
      return sql`INSERT INTO poll_option (id, poll_id, label, position, created_at_ms) VALUES (${optionId}, ${pollId}, ${label}, ${position}, ${now});`;
    }),
    sql`INSERT INTO poll_reference (reference, poll_id, kind, is_canonical, created_at_ms) VALUES ('demo', ${pollId}, 'custom', 1, ${now});`,
  ];
  d1Execute(
    sql.join(statements),
  );
}

const REPOSITORY_URL =
  "https://github.com/Hearn-Systems-LLC/oddspark-polls";
const OPENING_COPY =
  "Oddspark Polls is where a casual question gets an honest answer — multiple-choice, ranked, image, and meeting polls, with vote security and no subscription wall.";
const BUILD_ACCOUNT_COPY =
  "Runs on Cloudflare Workers, server-rendered by Astro. Polls and votes live in D1; images live in R2. Sign-in is Better Auth with Google or GitHub. Turnstile checks the vote; rate limiting checks the rush. The code is public — see the repository.";

function watchPage(page) {
  const consoleErrors = [];
  const failedResponses = [];
  const failedRequests = [];

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) {
      failedResponses.push(`${response.status()} ${response.url()}`);
    }
  });
  page.on("requestfailed", (request) => {
    failedRequests.push(
      `${request.failure()?.errorText ?? "request failed"} ${request.url()}`,
    );
  });

  return () => {
    expect(consoleErrors).toEqual([]);
    expect(failedResponses).toEqual([]);
    expect(failedRequests).toEqual([]);
  };
}

async function expectLandingGeometry(page) {
  const geometry = await page.evaluate(() => {
    const element = (selector) => {
      const match = document.querySelector(selector);
      if (!(match instanceof HTMLElement)) {
        throw new Error(`Missing landing element: ${selector}`);
      }
      return match;
    };
    const shell = element(".site-shell");
    const statement = element("[data-landing-statement]");
    const build = element("[data-landing-build-account]");
    const create = element('[aria-labelledby="landing-create-label"]');
    const discover = element('[aria-labelledby="landing-discover-label"]');
    const demo = element("[data-demo-region]");
    const primary = element("button.btn-primary");
    const shellStyle = getComputedStyle(shell);
    const blocks = [...document.querySelectorAll(".landing-block")].map(
      (node) => {
        const style = getComputedStyle(node);
        return {
          background: style.backgroundColor,
          borderTop: style.borderTopWidth,
          shadow: style.boxShadow,
        };
      },
    );

    return {
      blocks,
      horizontalOverflow:
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
      order: [statement, build, demo, create, discover].map(
        (node) => node.getBoundingClientRect().top,
      ),
      primaryHeight: primary.getBoundingClientRect().height,
      shellMaxWidth: Number.parseFloat(shellStyle.maxWidth),
      shellWidth: shell.getBoundingClientRect().width,
    };
  });

  expect(geometry.horizontalOverflow).toBeLessThanOrEqual(0);
  expect(geometry.shellWidth).toBeLessThanOrEqual(geometry.shellMaxWidth + 1);
  expect(geometry.primaryHeight).toBeGreaterThanOrEqual(48);
  expect(geometry.order.every((top, index, values) => index === 0 || top > values[index - 1])).toBe(true);
  for (const block of geometry.blocks) {
    expect(block).toEqual({
      background: "rgba(0, 0, 0, 0)",
      borderTop: "0px",
      shadow: "none",
    });
  }
}

test.describe("Landing page", () => {
  test.beforeAll(async ({ request }) => {
    const health = await request.get("/api/health");
    expect(health.status()).toBe(200);
    demoOwner = await seedCreatorSession();
    seedLandingDemo(demoOwner.userId);
  });

  test.afterAll(() => {
    if (demoOwner?.userId) cleanupCreator(demoOwner.userId);
  });

  test("renders the complete product account and all three working entries", async ({
    page,
    baseURL,
  }) => {
    const assertClean = watchPage(page);
    await page.goto("/");

    await expect(page.getByText(OPENING_COPY, { exact: true })).toBeVisible();
    await expect(page.getByText(BUILD_ACCOUNT_COPY, { exact: true })).toBeVisible();
    await expect(
      page.locator('[data-smoke-marker="oddspark-token-solar"]'),
    ).toBeVisible();

    const repository = page.getByRole("link", { name: "View repository" });
    const create = page.getByRole("link", { name: "Create a Poll" });
    const discover = page.getByRole("link", { name: "Discover Polls" });
    await expect(repository).toHaveAttribute("href", REPOSITORY_URL);
    await expect(repository).not.toHaveAttribute("target", /.+/);
    await expect(page.locator("[data-public-repository-link]")).toHaveCount(1);
    await expect(
      page.locator("[data-demo-region] [data-public-repository-footer]"),
    ).toHaveCount(0);
    await expect(create).toHaveAttribute("href", "/creator/new");
    await expect(discover).toHaveAttribute("href", "/discover");

    await discover.click();
    await expect(page).toHaveURL(`${baseURL}/discover`);
    await page.goBack();

    await create.click();
    await expect(page).toHaveURL(
      `${baseURL}/sign-in?return=%2Fcreator%2Fnew`,
    );
    await page.goBack();

    await page.route(REPOSITORY_URL, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><title>Oddspark Polls repository</title>",
      }),
    );
    await repository.click();
    await expect(page).toHaveURL(REPOSITORY_URL);
    assertClean();
  });

  test("keeps the Poll repository footer off auth and operator surfaces", async ({
    page,
  }) => {
    for (const path of [
      "/sign-in",
      "/creator",
      "/creator/new",
      "/creator/moderation",
    ]) {
      await page.goto(path);
      await expect(page.locator("[data-public-repository-footer]")).toHaveCount(0);
    }
  });

  test("persists the mode override and keeps focus in reading order", async ({
    page,
  }) => {
    const assertClean = watchPage(page);
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.setItem("oddspark-mode", "dark");
      document.documentElement.setAttribute("data-mode", "dark");
    });
    await page.reload();

    const toggle = page.locator("[data-mode-toggle]");
    const repository = page.getByRole("link", { name: "View repository" });
    const create = page.getByRole("link", { name: "Create a Poll" });
    const discover = page.getByRole("link", { name: "Discover Polls" });
    await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");
    await toggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-mode", "light");
    expect(await page.evaluate(() => localStorage.getItem("oddspark-mode"))).toBe(
      "light",
    );

    await page.reload();
    await page.keyboard.press("Tab");
    await expect(toggle).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(repository).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("radio", { name: "Friday" })).toBeFocused();
    // The embedded Tally's BARS/PIE and enhanced SHARE controls belong in
    // the Demo reading order before the following landing entries.
    for (let i = 0; i < 30 && !(await create.evaluate((node) => node === document.activeElement)); i += 1) {
      await page.keyboard.press("Tab");
    }
    await expect(create).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(discover).toBeFocused();

    const outline = await discover.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        offset: style.outlineOffset,
        style: style.outlineStyle,
        width: style.outlineWidth,
      };
    });
    expect(outline).toEqual({ offset: "2px", style: "solid", width: "2px" });
    assertClean();
  });

  test("binds the plain statement to Newsreader and the build account to Courier Prime", async ({
    page,
  }) => {
    const assertClean = watchPage(page);
    await page.goto("/");
    await page.evaluate(async () => {
      await document.fonts.ready;
    });

    const statement = await page.locator("[data-landing-statement]").evaluate(
      (node) => {
        const style = getComputedStyle(node);
        return { family: style.fontFamily, weight: style.fontWeight };
      },
    );
    const buildAccount = await page
      .locator("[data-landing-build-copy]")
      .evaluate((node) => {
        const style = getComputedStyle(node);
        return { family: style.fontFamily, size: style.fontSize };
      });

    expect(statement.family).toContain("Newsreader");
    expect(statement.weight).toBe("400");
    expect(buildAccount.family).toContain("Courier Prime");
    expect(buildAccount.size).toBe("16px");
    assertClean();
  });

  test("proves the one-column landing silhouette in mobile dark and desktop light", async ({
    page,
  }) => {
    const assertClean = watchPage(page);
    const proofDir = "test-results/story-3-4-landing-proof";
    await page.addInitScript(() => localStorage.removeItem("oddspark-mode"));

    await page.emulateMedia({ colorScheme: "dark" });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    await expectLandingGeometry(page);
    const create = page.getByRole("link", { name: "Create a Poll" });
    await create.focus();
    await expect(create).toBeFocused();
    await expect(create).toHaveCSS("outline-width", "2px");
    await expect(create).toHaveCSS("outline-offset", "2px");
    await page.screenshot({
      path: `${proofDir}/landing-375-dark.png`,
      fullPage: true,
    });

    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await expectLandingGeometry(page);
    await page.screenshot({
      path: `${proofDir}/landing-1280-light.png`,
      fullPage: true,
    });
    assertClean();
  });
});
