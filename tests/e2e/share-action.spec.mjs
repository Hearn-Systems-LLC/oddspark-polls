import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
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

// Story 1.13 — Share action on create-confirmation, voting, and results.

test.describe.configure({ mode: "serial", timeout: 180_000 });

test.describe("share action", () => {
  const seededUserIds = [];
  let pagesUnderTest = [];

  function watchConsole(page) {
    if (pagesUnderTest.some(({ observedPage }) => observedPage === page)) {
      return page;
    }
    const errors = [];
    pagesUnderTest.push({ observedPage: page, errors });
    page.on("console", (message) => {
      if (message.type() === "error") {
        errors.push(message.text());
      }
    });
    page.on("pageerror", (error) => {
      errors.push(error.message);
    });
    return page;
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

  async function publishPoll(page, question = "Share me poll") {
    await page.goto("/creator/new");
    await page.getByLabel("QUESTION").fill(question);
    await page.getByRole("textbox", { name: "OPTION 1" }).fill("A");
    await page.getByRole("textbox", { name: "OPTION 2" }).fill("B");
    await page.getByRole("button", { name: "PUBLISH POLL" }).click();
    await expect(page).toHaveURL(/\/creator\/polls\/[^?]+\?created/);
    const match = /\/creator\/polls\/([^?]+)/.exec(page.url());
    const pollId = match?.[1];
    assertUuid(pollId);
    return pollId;
  }

  function pollReference(pollId) {
    assertUuid(pollId);
    const rows = d1Query(
      sql`SELECT reference FROM poll_reference WHERE poll_id = ${pollId} AND is_canonical = 1;`,
    );
    return rows[0]?.reference;
  }

  async function expectUrlAndShareBeside(page) {
    const url = page.locator("[data-share-url-text]");
    const trigger = page.getByRole("button", { name: "SHARE" });
    await expect(url).toBeVisible();
    await expect(trigger).toBeVisible();

    const [urlBox, triggerBox] = await Promise.all([
      url.boundingBox(),
      trigger.boundingBox(),
    ]);
    if (!urlBox || !triggerBox) {
      throw new Error("Share URL and trigger must have measurable geometry");
    }

    const verticalOverlap =
      Math.min(urlBox.y + urlBox.height, triggerBox.y + triggerBox.height) -
      Math.max(urlBox.y, triggerBox.y);
    expect(triggerBox.x).toBeGreaterThan(urlBox.x);
    expect(verticalOverlap).toBeGreaterThan(0);
  }

  async function captureShareProof(page, path, { beside = false } = {}) {
    await expect(page.locator("[data-share-action]")).toBeVisible();
    await expect(page.locator("[data-share-url-text]")).toBeVisible();
    await expect(page.getByRole("button", { name: "SHARE" })).toBeVisible();
    if (beside) {
      await expectUrlAndShareBeside(page);
    }
    await page.screenshot({ path, fullPage: true });
  }

  test.beforeAll(() => {
    expect(
      hasBetterAuthSecret(),
      "BETTER_AUTH_SECRET must be provisioned in .dev.vars for Story 1.13 E2E",
    ).toBe(true);
  });

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
    cleanupCreators(seededUserIds);
  });

  test("no-JS floor: URL visible and SHARE hidden on all three surfaces", async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
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

    await page.goto("/creator/new");
    await page.getByLabel("QUESTION").fill("No-JS share poll");
    await page.getByRole("textbox", { name: "OPTION 1" }).fill("A");
    await page.getByRole("textbox", { name: "OPTION 2" }).fill("B");
    await page.getByRole("button", { name: "PUBLISH POLL" }).click();
    await expect(page).toHaveURL(/\/creator\/polls\//);
    const match = /\/creator\/polls\/([^?]+)/.exec(page.url());
    const pollId = match?.[1];
    assertUuid(pollId);
    const reference = pollReference(pollId);
    expect(reference).toBeTruthy();
    const votingUrl = `${requireBaseUrl(baseURL)}/${reference}`;

    // Create-confirmation (detail)
    await expect(page.locator("[data-share-url-text]")).toContainText(
      `/${reference}`,
    );
    await expect(page.locator(".share-trigger")).toBeHidden();

    // Voting surface
    await page.goto(`/${reference}`);
    await expect(page.locator("[data-share-url-text]")).toHaveText(votingUrl);
    await expect(page.locator(".share-trigger")).toBeHidden();

    // Results surface
    await page.goto(`/${reference}/results`);
    await expect(page.locator("[data-share-url-text]")).toHaveText(votingUrl);
    await expect(page.locator(".share-trigger")).toBeHidden();
    // Shares voting URL, not /results
    await expect(page.locator("[data-share-url-text]")).not.toContainText(
      "/results",
    );

    await context.close();
  });

  test("Web Share API receives only the canonical voting URL on all three surfaces", async ({
    page,
    context,
    baseURL,
  }) => {
    await page.addInitScript(() => {
      window.__shareCalls = [];
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: async (payload) => {
          window.__shareCalls.push(payload);
        },
      });
    });

    await signIn(context, baseURL);
    const pollId = await publishPoll(page, "Web Share poll");
    const reference = pollReference(pollId);
    const votingUrl = `${requireBaseUrl(baseURL)}/${reference}`;

    // Create-confirmation
    await page.getByRole("button", { name: "SHARE" }).click();
    let calls = await page.evaluate(() => window.__shareCalls);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ url: votingUrl });

    // Voting
    await page.goto(`/${reference}`);
    await page.getByRole("button", { name: "SHARE" }).click();
    calls = await page.evaluate(() => window.__shareCalls);
    expect(calls.at(-1)).toEqual({ url: votingUrl });

    // Results — still the voting URL
    await page.goto(`/${reference}/results`);
    await page.getByRole("button", { name: "SHARE" }).click();
    calls = await page.evaluate(() => window.__shareCalls);
    expect(calls.at(-1)).toEqual({ url: votingUrl });
    expect(calls.at(-1).url).not.toContain("/results");
  });

  test("a non-canonical alias shares the canonical voting URL", async ({
    page,
    context,
    baseURL,
  }) => {
    await page.addInitScript(() => {
      window.__shareCalls = [];
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: async (payload) => {
          window.__shareCalls.push(payload);
        },
      });
    });

    await signIn(context, baseURL);
    const question = "Canonical alias share poll";
    const pollId = await publishPoll(page, question);
    const reference = pollReference(pollId);
    expect(reference).toBeTruthy();
    const alias = `share-alias-${randomUUID().slice(0, 8)}`;
    d1Execute(
      sql`INSERT INTO poll_reference (reference, poll_id, kind, is_canonical, created_at_ms) VALUES (${alias}, ${pollId}, 'custom', 0, ${Date.now()});`,
    );

    await page.goto(`/${alias}`);
    await expect(page).toHaveURL(`${requireBaseUrl(baseURL)}/${alias}`);
    await expect(
      page.getByRole("heading", { level: 1, name: question }),
    ).toBeVisible();

    const votingUrl = `${requireBaseUrl(baseURL)}/${reference}`;
    await expect(page.locator("[data-share-url-text]")).toHaveText(votingUrl);
    await page.getByRole("button", { name: "SHARE" }).click();
    await expect.poll(() =>
      page.evaluate(() => window.__shareCalls),
    ).toEqual([{ url: votingUrl }]);
  });

  test("non-Abort Web Share rejection copies the exact canonical URL", async ({
    page,
    context,
    baseURL,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: async () => {
          throw new DOMException("Share unavailable", "NotAllowedError");
        },
      });
    });

    await signIn(context, baseURL);
    const pollId = await publishPoll(page, "Rejected Web Share poll");
    const reference = pollReference(pollId);
    const votingUrl = `${requireBaseUrl(baseURL)}/${reference}`;

    await page.getByRole("button", { name: "SHARE" }).click();
    await expect(page.locator("[data-share-confirmation]")).toBeVisible();
    await expect(page.locator("[data-share-confirmation]")).toHaveText(
      "LINK COPIED",
    );
    await expect.poll(() =>
      page.evaluate(() => navigator.clipboard.readText()),
    ).toBe(votingUrl);
  });

  test("clipboard rejection keeps the URL visible and confirmation hidden", async ({
    page,
    context,
    baseURL,
  }) => {
    await page.addInitScript(() => {
      window.__clipboardAttempts = [];
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: undefined,
      });
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (value) => {
            window.__clipboardAttempts.push(value);
            throw new DOMException("Clipboard denied", "NotAllowedError");
          },
        },
      });
    });

    await signIn(context, baseURL);
    const pollId = await publishPoll(page, "Rejected clipboard poll");
    const reference = pollReference(pollId);
    const votingUrl = `${requireBaseUrl(baseURL)}/${reference}`;

    await page.getByRole("button", { name: "SHARE" }).click();
    await expect.poll(() =>
      page.evaluate(() => window.__clipboardAttempts),
    ).toEqual([votingUrl]);
    await expect(page.locator("[data-share-url-text]")).toBeVisible();
    await expect(page.locator("[data-share-url-text]")).toHaveText(votingUrl);
    await expect(page.locator("[data-share-confirmation]")).toBeHidden();
  });

  test("repeated activation clears stale confirmation and announces one new success", async ({
    page,
    context,
    baseURL,
  }) => {
    await page.addInitScript(() => {
      window.__clipboardWrites = [];
      window.__resolveClipboardWrite = undefined;
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: undefined,
      });
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (value) => {
            window.__clipboardWrites.push(value);
            if (window.__clipboardWrites.length === 1) {
              return;
            }
            await new Promise((resolve) => {
              window.__resolveClipboardWrite = resolve;
            });
          },
        },
      });
    });

    await signIn(context, baseURL);
    const pollId = await publishPoll(page, "Repeated clipboard poll");
    const reference = pollReference(pollId);
    const votingUrl = `${requireBaseUrl(baseURL)}/${reference}`;
    const trigger = page.getByRole("button", { name: "SHARE" });
    const confirmation = page.locator("[data-share-confirmation]");

    await trigger.click();
    await expect(confirmation).toBeVisible();
    await expect(confirmation).toHaveText("LINK COPIED");

    await page.evaluate(() => {
      const status = document.querySelector("[data-share-confirmation]");
      if (!(status instanceof HTMLElement)) {
        throw new Error("Share confirmation status is missing");
      }
      window.__confirmationSuccessStates = 0;
      new MutationObserver(() => {
        if (!status.hidden && status.textContent?.trim() === "LINK COPIED") {
          window.__confirmationSuccessStates += 1;
        }
      }).observe(status, {
        attributes: true,
        attributeFilter: ["hidden"],
        childList: true,
        characterData: true,
        subtree: true,
      });
    });

    await trigger.click();
    await expect.poll(() =>
      page.evaluate(() => window.__clipboardWrites.length),
    ).toBe(2);
    await expect(confirmation).toBeHidden();
    await expect(confirmation).toHaveText("");

    await page.evaluate(() => {
      if (typeof window.__resolveClipboardWrite !== "function") {
        throw new Error("Deferred clipboard write was not installed");
      }
      window.__resolveClipboardWrite();
    });

    await expect(confirmation).toBeVisible();
    await expect(confirmation).toHaveText("LINK COPIED");
    await expect.poll(() =>
      page.evaluate(() => window.__confirmationSuccessStates),
    ).toBe(1);
    expect(await page.evaluate(() => window.__clipboardWrites)).toEqual([
      votingUrl,
      votingUrl,
    ]);
  });

  test("clicking the URL text copies once, announces LINK COPIED, and keeps the selection", async ({
    page,
    context,
    baseURL,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: undefined,
      });
    });

    await signIn(context, baseURL);
    const pollId = await publishPoll(page, "URL text copy poll");
    const reference = pollReference(pollId);
    const votingUrl = `${requireBaseUrl(baseURL)}/${reference}`;

    await page.goto(`/${reference}/results`);
    const urlText = page.locator("[data-share-url-text]");
    await expect(urlText).toHaveText(votingUrl);

    await urlText.click();
    await expect(page.locator("[data-share-confirmation]")).toBeVisible();
    await expect(page.locator("[data-share-confirmation]")).toHaveText(
      "LINK COPIED",
    );
    await expect.poll(() =>
      page.evaluate(() => navigator.clipboard.readText()),
    ).toBe(votingUrl);
    // The click still selects the URL text; copy is additive.
    await expect
      .poll(() => page.evaluate(() => window.getSelection().toString()))
      .toContain(votingUrl);

    // A second click after completion re-copies and re-reveals the one
    // confirmation line (fresh live-region announcement by design).
    await urlText.click();
    await expect(page.locator("[data-share-confirmation]")).toHaveText(
      "LINK COPIED",
    );
    await expect.poll(() =>
      page.evaluate(() => navigator.clipboard.readText()),
    ).toBe(votingUrl);
  });

  test("with both clipboard and Web Share present, the URL text copies and never opens the share sheet", async ({
    page,
    context,
    baseURL,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.addInitScript(() => {
      window.__shareCalls = [];
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: async (payload) => {
          window.__shareCalls.push(payload);
        },
      });
    });

    await signIn(context, baseURL);
    const pollId = await publishPoll(page, "Both APIs URL text poll");
    const reference = pollReference(pollId);
    const votingUrl = `${requireBaseUrl(baseURL)}/${reference}`;

    await page.goto(`/${reference}/results`);
    const urlText = page.locator("[data-share-url-text]");
    await expect(urlText).toHaveText(votingUrl);

    await urlText.click();
    await expect(page.locator("[data-share-confirmation]")).toBeVisible();
    await expect(page.locator("[data-share-confirmation]")).toHaveText(
      "LINK COPIED",
    );
    await expect.poll(() =>
      page.evaluate(() => navigator.clipboard.readText()),
    ).toBe(votingUrl);
    expect(await page.evaluate(() => window.__shareCalls)).toEqual([]);
  });

  test("share-only capability leaves the URL text unbound (selection only, no sheet)", async ({
    page,
    context,
    baseURL,
  }) => {
    await page.addInitScript(() => {
      window.__shareCalls = [];
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: async (payload) => {
          window.__shareCalls.push(payload);
        },
      });
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: undefined,
      });
    });

    await signIn(context, baseURL);
    const pollId = await publishPoll(page, "Share-only URL text poll");
    const reference = pollReference(pollId);
    const votingUrl = `${requireBaseUrl(baseURL)}/${reference}`;

    await page.goto(`/${reference}/results`);
    const urlText = page.locator("[data-share-url-text]");
    await expect(urlText).toHaveText(votingUrl);

    await urlText.click();
    // Selection happens, but no share sheet and no copy confirmation.
    await expect
      .poll(() => page.evaluate(() => window.getSelection().toString()))
      .toContain(votingUrl);
    expect(await page.evaluate(() => window.__shareCalls)).toEqual([]);
    await expect(page.locator("[data-share-confirmation]")).toBeHidden();
  });

  test("clipboard fallback shows LINK COPIED with the canonical URL", async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({
      permissions: ["clipboard-read", "clipboard-write"],
    });
    const page = await context.newPage();
    watchConsole(page);

    // Force clipboard path (no share).
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: undefined,
      });
    });

    await signIn(context, baseURL);
    const pollId = await publishPoll(page, "Clipboard share poll");
    const reference = pollReference(pollId);
    const votingUrl = `${requireBaseUrl(baseURL)}/${reference}`;

    await page.getByRole("button", { name: "SHARE" }).click();
    await expect(page.locator("[data-share-confirmation]")).toBeVisible();
    await expect(page.locator("[data-share-confirmation]")).toHaveText(
      "LINK COPIED",
    );

    const clipboardText = await page.evaluate(() =>
      navigator.clipboard.readText(),
    );
    expect(clipboardText).toBe(votingUrl);

    await context.close();
  });

  test("AbortError from share produces no confirmation and no console error", async ({
    page,
    context,
    baseURL,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: async () => {
          throw new DOMException("Share canceled", "AbortError");
        },
      });
    });

    await signIn(context, baseURL);
    await publishPoll(page, "Abort share poll");
    await page.getByRole("button", { name: "SHARE" }).click();
    await expect(page.locator("[data-share-confirmation]")).toBeHidden();
  });

  test("browser proof: SHARE beside URL at 375 dark and 1280 light", async ({
    page,
    context,
    baseURL,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: undefined,
      });
    });
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);

    await page.setViewportSize({ width: 375, height: 812 });
    await page.emulateMedia({ colorScheme: "dark" });
    await signIn(context, baseURL);
    const pollId = await publishPoll(page, "Proof share poll");
    const reference = pollReference(pollId);

    // 375 dark — all three surfaces may wrap responsively.
    await expect(page).toHaveURL(
      new RegExp(`/creator/polls/${pollId}\\?created$`),
    );
    await captureShareProof(
      page,
      "test-results/story-1-13-share-create-confirmation-375-dark.png",
    );

    // Clipboard confirmation state
    await page.getByRole("button", { name: "SHARE" }).click();
    await expect(page.locator("[data-share-confirmation]")).toBeVisible();
    await captureShareProof(
      page,
      "test-results/story-1-13-share-create-confirmation-link-copied-375-dark.png",
    );

    await page.goto(`/${reference}`);
    await captureShareProof(
      page,
      "test-results/story-1-13-share-voting-375-dark.png",
    );

    await page.goto(`/${reference}/results`);
    await captureShareProof(
      page,
      "test-results/story-1-13-share-results-375-dark.png",
    );

    // 1280 light — all three surfaces keep URL and action beside each other.
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto(`/creator/polls/${pollId}?created`);
    await expect(page).toHaveURL(
      new RegExp(`/creator/polls/${pollId}\\?created$`),
    );
    await captureShareProof(
      page,
      "test-results/story-1-13-share-create-confirmation-1280-light.png",
      { beside: true },
    );

    await page.goto(`/${reference}`);
    await captureShareProof(
      page,
      "test-results/story-1-13-share-voting-1280-light.png",
      { beside: true },
    );

    await page.goto(`/${reference}/results`);
    await captureShareProof(
      page,
      "test-results/story-1-13-share-results-1280-light.png",
      { beside: true },
    );
  });
});
