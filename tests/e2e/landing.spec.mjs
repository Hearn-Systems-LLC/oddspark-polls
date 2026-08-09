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
  "Runs on Cloudflare Workers, server-rendered by Astro. Polls and votes live in D1; images live in R2. Sign-in is Better Auth with Google or GitHub. Turnstile checks the vote; rate limiting checks the rush. The code is public.";

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

async function expectLandingGeometry(page, { twoColumn = false } = {}) {
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
    const demo = element("[data-demo-region]");
    const footer = element(".site-shell > footer");
    const byline = element('footer a[href="https://hearn.systems"]');
    const nav = element('footer nav[aria-label="Landing"]');
    const navLinks = [...nav.querySelectorAll("a")];
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
    const rectOf = (node) => {
      const rect = node.getBoundingClientRect();
      return {
        top: rect.top,
        left: rect.left,
        right: rect.right,
        width: rect.width,
        height: rect.height,
      };
    };

    return {
      blocks,
      bylineHeight: byline.getBoundingClientRect().height,
      bylineRect: rectOf(byline),
      footerBorderTop: getComputedStyle(footer).borderTopWidth,
      footerRect: rectOf(footer),
      horizontalOverflow:
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
      introBottom: Math.max(
        statement.getBoundingClientRect().bottom,
        build.getBoundingClientRect().bottom,
        demo.getBoundingClientRect().bottom,
      ),
      navLinkHeights: navLinks.map(
        (node) => node.getBoundingClientRect().height,
      ),
      navLinkRects: navLinks.map(rectOf),
      navRect: rectOf(nav),
      order: [statement, build, demo].map(
        (node) => node.getBoundingClientRect().top,
      ),
      statementRect: rectOf(statement),
      buildRect: rectOf(build),
      demoRect: rectOf(demo),
      primaryHeight: primary.getBoundingClientRect().height,
      shellContentRight:
        shell.getBoundingClientRect().right -
        Number.parseFloat(shellStyle.paddingRight),
      shellContentWidth:
        shell.getBoundingClientRect().width -
        Number.parseFloat(shellStyle.paddingLeft) -
        Number.parseFloat(shellStyle.paddingRight),
      shellMaxWidth: Number.parseFloat(shellStyle.maxWidth),
      shellWidth: shell.getBoundingClientRect().width,
    };
  });

  expect(geometry.horizontalOverflow).toBeLessThanOrEqual(0);
  expect(geometry.shellWidth).toBeLessThanOrEqual(geometry.shellMaxWidth + 1);
  expect(geometry.primaryHeight).toBeGreaterThanOrEqual(48);

  // The landing-footer spans the full shell content width below everything
  // in the grid, separated by a single 1px top hairline (DESIGN.md
  // §landing-footer).
  expect(geometry.footerRect.width).toBeGreaterThanOrEqual(
    geometry.shellContentWidth - 1,
  );
  expect(geometry.footerBorderTop).toBe("1px");
  expect(geometry.footerRect.top).toBeGreaterThanOrEqual(
    geometry.introBottom - 1,
  );
  expect(geometry.bylineHeight).toBeGreaterThanOrEqual(44);
  for (const height of geometry.navLinkHeights) {
    expect(height).toBeGreaterThanOrEqual(48);
  }

  if (twoColumn) {
    // lg silhouette (DESIGN.md §Layout): intro column left, Demo Poll right,
    // footer as one row — byline at the left edge, nav links at the right.
    expect(geometry.demoRect.left).toBeGreaterThan(
      geometry.statementRect.left,
    );
    expect(
      Math.abs(geometry.demoRect.top - geometry.statementRect.top),
    ).toBeLessThanOrEqual(2);
    expect(geometry.bylineRect.left).toBeLessThanOrEqual(
      geometry.statementRect.left + 1,
    );
    expect(geometry.navRect.left).toBeGreaterThan(geometry.bylineRect.right);
    // "Links at the right" (AC #1): the nav's right edge is the shell
    // content box's right edge, not just somewhere right of the byline.
    expect(
      Math.abs(geometry.navRect.right - geometry.shellContentRight),
    ).toBeLessThanOrEqual(1);
    const navTops = geometry.navLinkRects.map((rect) => rect.top);
    expect(navTops.every((top) => Math.abs(top - navTops[0]) <= 2)).toBe(true);
    const navLefts = geometry.navLinkRects.map((rect) => rect.left);
    expect(
      navLefts.every(
        (left, index) => index === 0 || left > navLefts[index - 1],
      ),
    ).toBe(true);
  } else {
    expect(
      geometry.order.every(
        (top, index, values) => index === 0 || top > values[index - 1],
      ),
    ).toBe(true);
    // Below sm the footer row wraps: the byline holds the first line and the
    // three links stack beneath it, left-aligned, in source order.
    expect(geometry.bylineRect.top).toBeLessThan(geometry.navLinkRects[0].top);
    expect(
      geometry.navLinkRects.every(
        (rect, index) =>
          index === 0 || rect.top > geometry.navLinkRects[index - 1].top,
      ),
    ).toBe(true);
    expect(
      geometry.navLinkRects.every(
        (rect) => Math.abs(rect.left - geometry.bylineRect.left) <= 1,
      ),
    ).toBe(true);
  }
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
    const byline = page.getByRole("link", { name: "built by Hearn." });
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
    await expect(page.getByRole("radio", { name: "Friday" })).toBeFocused();
    // The embedded Tally's BARS/PIE and enhanced SHARE controls belong in
    // the Demo reading order; the footer entries — byline first, then the
    // three Landing nav links — follow all main content.
    for (let i = 0; i < 40 && !(await byline.evaluate((node) => node === document.activeElement)); i += 1) {
      await page.keyboard.press("Tab");
    }
    await expect(byline).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(create).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(discover).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(repository).toBeFocused();

    const outline = await repository.evaluate((node) => {
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

  test("proves the one-column mobile silhouette and the two-column desktop silhouette", async ({
    page,
  }) => {
    const assertClean = watchPage(page);
    const proofDir = "test-results/story-3-7-landing-footer-proof";
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
    await expectLandingGeometry(page, { twoColumn: true });
    await page.screenshot({
      path: `${proofDir}/landing-1280-light.png`,
      fullPage: true,
    });
    assertClean();
  });

  test("keeps the footer overflow-free through the 640–1023px mid band", async ({
    page,
  }) => {
    const assertClean = watchPage(page);
    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize({ width: 800, height: 900 });
    await page.goto("/");

    const mid = await page.evaluate(() => {
      const element = (selector) => {
        const match = document.querySelector(selector);
        if (!(match instanceof HTMLElement)) {
          throw new Error(`Missing landing element: ${selector}`);
        }
        return match;
      };
      const byline = element('footer a[href="https://hearn.systems"]')
        .getBoundingClientRect();
      const nav = element('footer nav[aria-label="Landing"]')
        .getBoundingClientRect();
      const linkRects = [
        ...document.querySelectorAll('footer nav[aria-label="Landing"] a'),
      ].map((node) => node.getBoundingClientRect());
      return {
        byline: { top: byline.top, left: byline.left, right: byline.right },
        horizontalOverflow:
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
        linkLefts: linkRects.map((rect) => rect.left),
        linkTops: linkRects.map((rect) => rect.top),
        nav: { top: nav.top, left: nav.left, right: nav.right },
      };
    });

    // Mid-band defined behavior (verified by rendering): the nav wraps as
    // one unit to a second line, left-aligned beneath the byline, its three
    // links still on a single row — nothing overlaps, nothing overflows.
    expect(mid.horizontalOverflow).toBeLessThanOrEqual(0);
    expect(mid.linkTops).toHaveLength(3);
    expect(mid.byline.top).toBeLessThan(mid.nav.top);
    expect(Math.abs(mid.nav.left - mid.byline.left)).toBeLessThanOrEqual(1);
    expect(
      mid.linkTops.every((top) => Math.abs(top - mid.linkTops[0]) <= 2),
    ).toBe(true);
    expect(
      mid.linkLefts.every(
        (left, index) => index === 0 || left > mid.linkLefts[index - 1],
      ),
    ).toBe(true);
    assertClean();
  });

  test("renders the footer below the 503 demo-unavailable state", async ({
    page,
  }) => {
    const consoleErrors = [];
    const failedRequests = [];
    page.on("console", (message) => {
      // The document itself answering 503 is the variant under test, not an
      // error — only other console errors count.
      if (
        message.type() === "error" &&
        !/status of 503/u.test(message.text())
      ) {
        consoleErrors.push(message.text());
      }
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));
    page.on("requestfailed", (request) => {
      failedRequests.push(
        `${request.failure()?.errorText ?? "request failed"} ${request.url()}`,
      );
    });

    // Force the demo-unavailable variant: no poll behind the demo reference,
    // so the landing answers 503 and renders the unavailable state.
    const demoPollId = d1Query(
      sql`SELECT poll_id FROM poll_reference WHERE reference = 'demo' LIMIT 1`,
    )[0]?.poll_id;
    assertUuid(demoPollId);
    deletePoll(demoPollId);

    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize({ width: 1280, height: 900 });
    const response = await page.goto("/");
    expect(response?.status()).toBe(503);
    await expect(
      page.getByRole("heading", { name: "DEMO UNAVAILABLE" }),
    ).toBeVisible();

    const byline = page.getByRole("link", { name: "built by Hearn." });
    const nav = page.getByRole("navigation", { name: "Landing" });
    const navLinks = nav.getByRole("link");
    await expect(byline).toHaveAttribute("href", "https://hearn.systems");
    await expect(byline).toHaveAttribute("rel", "noopener");
    await expect(navLinks).toHaveCount(3);
    await expect(navLinks.nth(0)).toHaveAttribute("href", "/creator/new");
    await expect(navLinks.nth(1)).toHaveAttribute("href", "/discover");
    await expect(navLinks.nth(2)).toHaveAttribute("href", REPOSITORY_URL);

    const geometry = await page.evaluate(() => {
      const element = (selector) => {
        const match = document.querySelector(selector);
        if (!(match instanceof HTMLElement)) {
          throw new Error(`Missing landing element: ${selector}`);
        }
        return match;
      };
      const shell = element(".site-shell");
      const shellStyle = getComputedStyle(shell);
      const footer = element(".site-shell > footer");
      const unavailable = element(".demo-unavailable");
      const bylineNode = element('footer a[href="https://hearn.systems"]');
      const navNode = element('footer nav[aria-label="Landing"]');
      const linkTops = [...navNode.querySelectorAll("a")].map(
        (node) => node.getBoundingClientRect().top,
      );
      return {
        bylineRight: bylineNode.getBoundingClientRect().right,
        footerBorderTop: getComputedStyle(footer).borderTopWidth,
        footerTop: footer.getBoundingClientRect().top,
        footerWidth: footer.getBoundingClientRect().width,
        horizontalOverflow:
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
        linkTops,
        navLeft: navNode.getBoundingClientRect().left,
        shellContentRight:
          shell.getBoundingClientRect().right -
          Number.parseFloat(shellStyle.paddingRight),
        shellContentWidth:
          shell.getBoundingClientRect().width -
          Number.parseFloat(shellStyle.paddingLeft) -
          Number.parseFloat(shellStyle.paddingRight),
        unavailableBottom: unavailable.getBoundingClientRect().bottom,
      };
    });
    // The footer is page chrome below the 503 state: full shell content
    // width, one top hairline, byline and links on one row (AC #1, D5).
    expect(geometry.horizontalOverflow).toBeLessThanOrEqual(0);
    expect(geometry.footerWidth).toBeGreaterThanOrEqual(
      geometry.shellContentWidth - 1,
    );
    expect(geometry.footerBorderTop).toBe("1px");
    expect(geometry.footerTop).toBeGreaterThanOrEqual(
      geometry.unavailableBottom - 1,
    );
    expect(geometry.navLeft).toBeGreaterThan(geometry.bylineRight);
    expect(geometry.linkTops).toHaveLength(3);
    expect(
      geometry.linkTops.every(
        (top) => Math.abs(top - geometry.linkTops[0]) <= 2,
      ),
    ).toBe(true);

    await page.screenshot({
      path: "test-results/story-3-7-landing-footer-proof/demo-unavailable-1280-light.png",
      fullPage: true,
    });
    expect(consoleErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
  });
});
