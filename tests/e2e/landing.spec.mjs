import { expect, test } from "@playwright/test";

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
    const primary = element('.btn-primary[href="/creator/new"]');
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
      order: [statement, build, create, discover].map(
        (node) => node.getBoundingClientRect().top,
      ),
      primaryHeight: primary.getBoundingClientRect().height,
      shellMaxWidth: Number.parseFloat(shellStyle.maxWidth),
      shellWidth: shell.getBoundingClientRect().width,
    };
  });

  expect(geometry.horizontalOverflow).toBeLessThanOrEqual(0);
  expect(geometry.shellWidth).toBeLessThanOrEqual(geometry.shellMaxWidth + 1);
  expect(geometry.primaryHeight).toBeGreaterThanOrEqual(44);
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
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    const create = page.getByRole("link", { name: "Create a Poll" });
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
