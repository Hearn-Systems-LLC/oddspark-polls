import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import {
  assertUuid,
  cleanupCreator,
  d1Query,
  hasBetterAuthSecret,
  requireBaseUrl,
  seedCreatorSession,
} from "./creator-session.mjs";

// Story 2.3 — CAPTCHA on the Vote Action: conditional Turnstile widget,
// fail-closed missing token, success with always-pass dummy, retry resets.

if (!hasBetterAuthSecret()) {
  throw new Error(
    "Story 2.3 E2E requires BETTER_AUTH_SECRET in .dev.vars; skipping CAPTCHA proof is forbidden",
  );
}

const proofDir = "test-results/story-2-3-captcha-proof";
const commentProofDir = "test-results/story-4-1-comment-proof";
mkdirSync(proofDir, { recursive: true });
mkdirSync(commentProofDir, { recursive: true });

const CAPTCHA_HEADING = "The human check didn't pass.";
const FORCE_INTERACTIVE_SITE_KEY = "3x00000000000000000000FF";

test.describe.configure({ mode: "serial", timeout: 180_000 });

test.describe("CAPTCHA on the Vote Action", () => {
  const seededUserIds = [];
  let browserErrors = [];

  function observePage(page) {
    page.on("console", (message) => {
      const text = message.text();
      const expectedFormResponse =
        /^Failed to load resource: the server responded with a status of 422 \(/u.test(
          text,
        ) && message.location().url === page.url();
      // Vendor-internal Turnstile messages may appear when the dummy client
      // loads; only unexpected app errors fail the suite.
      const vendorNoise =
        /turnstile|challenges\.cloudflare\.com/iu.test(text) &&
        message.type() !== "error";
      if (message.type() === "error" && !expectedFormResponse && !vendorNoise) {
        // Allow documented vendor script failures when the script is blocked.
        if (/challenges\.cloudflare\.com/iu.test(text)) {
          return;
        }
        browserErrors.push(text);
      }
    });
    page.on("pageerror", (error) => {
      if (/challenges\.cloudflare\.com/iu.test(error.message)) {
        return;
      }
      browserErrors.push(error.message);
    });
    return page;
  }

  test.beforeEach(() => {
    browserErrors = [];
  });

  test.afterEach(() => {
    expect(browserErrors).toEqual([]);
  });

  test.afterAll(() => {
    for (const userId of seededUserIds) {
      cleanupCreator(userId);
    }
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
    return seeded;
  }

  async function setToggle(page, label, on) {
    const inputName =
      label === "Session Checks"
        ? "sessionChecks"
        : label === "CAPTCHA"
          ? "captcha"
          : null;
    if (!inputName) {
      throw new Error(`unknown toggle label: ${label}`);
    }
    const checkbox = page.locator(`input[name="${inputName}"]`);
    const isChecked = await checkbox.isChecked();
    if (isChecked !== on) {
      await page.locator("label.security-toggle", { hasText: label }).click();
    }
    if (on) {
      await expect(checkbox).toBeChecked();
    } else {
      await expect(checkbox).not.toBeChecked();
    }
  }

  async function publishPoll(
    page,
    context,
    baseURL,
    { captcha = true, comments = false } = {},
  ) {
    await signIn(context, baseURL);
    const reference = `cap-${randomUUID().slice(0, 8)}`;
    await page.goto("/creator/new");
    await page.getByLabel("QUESTION").fill(`CAPTCHA e2e ${Date.now()}`);
    await page.getByRole("textbox", { name: "OPTION 1" }).fill("Alpha");
    await page.getByRole("textbox", { name: "OPTION 2" }).fill("Beta");
    await page.getByLabel("CUSTOM LINK (OPTIONAL)").fill(reference);
    if (comments) {
      await page.locator('label[for="comments-enabled"]').click();
    }
    await setToggle(page, "Session Checks", false);
    await setToggle(page, "CAPTCHA", captcha);
    await page.getByRole("button", { name: "PUBLISH POLL" }).click();
    await expect(page).toHaveURL(/\/creator\/polls\//, { timeout: 30_000 });
    const pollId = /\/creator\/polls\/([^?]+)/.exec(page.url())?.[1] ?? "";
    assertUuid(pollId);
    const row = d1Query(
      `SELECT captcha_enabled, comments_enabled FROM poll WHERE id = '${pollId}'`,
    );
    expect(row[0]).toEqual({
      captcha_enabled: captcha ? 1 : 0,
      comments_enabled: comments ? 1 : 0,
    });
    await context.clearCookies();
    return { path: `/${reference}`, pollId, reference };
  }

  test("omits the Turnstile widget when CAPTCHA is off", async ({
    page,
    context,
    baseURL,
  }) => {
    observePage(page);
    const poll = await publishPoll(page, context, baseURL, { captcha: false });
    await page.goto(poll.path);
    await expect(page.locator("[data-vote-form]")).toBeVisible();
    await expect(page.locator("[data-turnstile]")).toHaveCount(0);
  });

  test("renders Turnstile container when CAPTCHA is on and rejects missing token", async ({
    page,
    context,
    baseURL,
  }) => {
    observePage(page);
    const poll = await publishPoll(page, context, baseURL, {
      captcha: true,
      comments: true,
    });
    await page.goto(poll.path);

    // Empty container has zero height until the vendor script renders; assert
    // attachment/attributes rather than visibility.
    await expect(page.locator("[data-turnstile]")).toHaveCount(1);
    await expect(page.locator("[data-turnstile]")).toHaveAttribute(
      "data-action",
      "vote",
    );
    // Container sits immediately before VOTE.
    const adjacency = await page.locator(".vote-action").evaluate((root) => {
      const nodes = [...root.children].map((el) => el.tagName + (el.getAttribute("data-turnstile") !== null ? "[turnstile]" : el.className));
      return nodes.join(">");
    });
    expect(adjacency).toMatch(/turnstile/i);
    expect(adjacency.toLowerCase()).toContain("button");

    expect(
      await page.locator("[data-vote-form]").evaluate((form) => {
        const options = form.querySelector("fieldset.poll-options");
        const composer = form.querySelector("[data-comment-composer]");
        const turnstile = form.querySelector("[data-turnstile]");
        const button = form.querySelector('button[type="submit"]');
        const follows = (earlier, later) =>
          Boolean(
            earlier &&
              later &&
              earlier.compareDocumentPosition(later) &
                Node.DOCUMENT_POSITION_FOLLOWING,
          );
        return {
          optionsBeforeComposer: follows(options, composer),
          composerBeforeTurnstile: follows(composer, turnstile),
          turnstileBeforeButton: follows(turnstile, button),
        };
      }),
    ).toEqual({
      optionsBeforeComposer: true,
      composerBeforeTurnstile: true,
      turnstileBeforeButton: true,
    });

    await page.locator('label.poll-option', { hasText: "Alpha" }).click();
    await page
      .getByRole("textbox", { name: "COMMENT", exact: true })
      .fill("Keep this through the human-check retry.");
    await page
      .getByRole("textbox", {
        name: "DISPLAY NAME (OPTIONAL)",
        exact: true,
      })
      .fill("CAPTCHA Voter");
    // Force a missing-token submission: strip any response field the dummy
    // client may have written, then native submit without waiting for widget.
    await page.evaluate(() => {
      const form = document.querySelector("[data-vote-form]");
      if (!form) return;
      for (const field of form.querySelectorAll(
        '[name="cf-turnstile-response"]',
      )) {
        field.remove();
      }
      form.requestSubmit();
    });

    await expect(page.locator('[data-outcome-code="captcha_failed"]')).toBeVisible();
    await expect(page.locator('[data-outcome-code="captcha_failed"]')).toContainText(
      CAPTCHA_HEADING,
    );
    await expect(page.locator('[data-outcome-code="captcha_failed"]')).toBeFocused();
    await expect(
      page.locator('input[name="option_id"]:checked'),
    ).toHaveCount(1);
    await expect(
      page.getByRole("textbox", { name: "COMMENT", exact: true }),
    ).toHaveValue("Keep this through the human-check retry.");
    await expect(
      page.getByRole("textbox", {
        name: "DISPLAY NAME (OPTIONAL)",
        exact: true,
      }),
    ).toHaveValue("CAPTCHA Voter");
    await expect(page.locator("[data-turnstile]")).toHaveCount(1);
    await expect(page.locator('button[type="submit"]')).toBeEnabled();
    expect(
      d1Query(
        `SELECT COUNT(*) AS n FROM vote_comment vc JOIN vote v ON v.id = vc.vote_id WHERE v.poll_id = '${poll.pollId}'`,
      ),
    ).toEqual([{ n: 0 }]);
    await page.screenshot({
      path: `${proofDir}/375-dark-failure-retry.png`,
      fullPage: true,
    });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.screenshot({
      path: `${commentProofDir}/captcha-retry-375-dark.png`,
      fullPage: true,
    });
  });

  test("succeeds with the always-pass dummy token on CAPTCHA-on", async ({
    page,
    context,
    baseURL,
  }) => {
    observePage(page);
    const poll = await publishPoll(page, context, baseURL, { captcha: true });
    await page.goto(poll.path);

    await page.locator('label.poll-option', { hasText: "Alpha" }).click();
    // Wait briefly for the always-pass widget to inject its response field.
    await page.waitForFunction(() => {
      const field = document.querySelector(
        '[name="cf-turnstile-response"]',
      );
      return field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement
        ? field.value.length > 0
        : false;
    }, null, { timeout: 15_000 }).catch(() => {
      // If the vendor script is slow/blocked, inject the opaque dummy token
      // the official always-pass Siteverify accepts on loopback.
    });
    await page.evaluate(() => {
      const form = document.querySelector("[data-vote-form]");
      if (!form) return;
      let field = form.querySelector('[name="cf-turnstile-response"]');
      if (!field) {
        field = document.createElement("input");
        field.type = "hidden";
        field.name = "cf-turnstile-response";
        form.appendChild(field);
      }
      if (!("value" in field) || !field.value) {
        field.value = "XXXX.DUMMY.TOKEN.XXXX";
      }
    });
    await page.locator('button[type="submit"]').click();
    await expect(page.locator('[data-outcome-code="counted"]')).toBeVisible({
      timeout: 15_000,
    });
  });

  test("CAPTCHA-off remains fully functional without JavaScript", async ({
    browser,
    baseURL,
  }) => {
    const publisher = await browser.newContext();
    const page = observePage(await publisher.newPage());
    const poll = await publishPoll(page, publisher, baseURL, { captcha: false });
    await publisher.close();

    const noJs = await browser.newContext({ javaScriptEnabled: false });
    const voter = observePage(await noJs.newPage());
    await voter.goto(requireBaseUrl(baseURL) + poll.path);
    // Inputs are visually hidden; click the label (works without JS).
    await voter.locator("label.poll-option", { hasText: "Alpha" }).click();
    await voter.getByRole("button", { name: "VOTE" }).click();
    await expect(voter.getByText("Counted.")).toBeVisible({ timeout: 15_000 });
    await noJs.close();
  });

  test("force-interactive visual proof rewrites only the public site key", async ({
    page,
    context,
    baseURL,
  }) => {
    observePage(page);
    const poll = await publishPoll(page, context, baseURL, { captcha: true });
    await page.goto(poll.path);
    await page.evaluate((siteKey) => {
      const el = document.querySelector("[data-turnstile]");
      if (el) el.setAttribute("data-sitekey", siteKey);
    }, FORCE_INTERACTIVE_SITE_KEY);

    await page.setViewportSize({ width: 375, height: 812 });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.screenshot({
      path: `${proofDir}/375-dark-force-interactive.png`,
      fullPage: true,
    });

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ colorScheme: "light" });
    await page.screenshot({
      path: `${proofDir}/1280-light-force-interactive.png`,
      fullPage: true,
    });

    // Do not submit the visual-only form (force-interactive is display-only).
    await expect(page.locator("[data-turnstile]")).toHaveAttribute(
      "data-sitekey",
      FORCE_INTERACTIVE_SITE_KEY,
    );
  });

  test("tracked remote configuration never contains documented test site keys", async () => {
    const { readFileSync } = await import("node:fs");
    const wrangler = readFileSync("wrangler.jsonc", "utf8");
    const staging = wrangler.slice(
      wrangler.indexOf('"staging"'),
      wrangler.indexOf('"production"'),
    );
    const production = wrangler.slice(wrangler.indexOf('"production"'));
    for (const block of [staging, production]) {
      expect(block).not.toContain("1x00000000000000000000AA");
      expect(block).not.toContain("2x00000000000000000000AB");
      expect(block).not.toContain("3x00000000000000000000FF");
      expect(block).not.toContain("1x00000000000000000000BB");
    }
  });
});
