import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
  assertUuid,
  cleanupCreator,
  d1Execute,
  d1Query,
  deletePoll,
  hasBetterAuthSecret,
  requireBaseUrl,
  seedCreatorSession,
  setPollDeadline,
  setResultVisibility,
} from "./creator-session.mjs";

test.describe.configure({ mode: "serial", timeout: 120_000 });

const commentProofDir = "test-results/story-4-1-comment-proof";
mkdirSync(commentProofDir, { recursive: true });

test.describe("public voting flow", () => {
  test.skip(
    !hasBetterAuthSecret(),
    "BETTER_AUTH_SECRET is not provisioned in .dev.vars — Poll setup needs the seeded creator harness",
  );

  const seededUserIds = [];
  const browserErrors = new WeakMap();

  test.beforeEach(({ page }) => {
    const errors = [];
    browserErrors.set(page, errors);
    page.on("console", (message) => {
      const text = message.text();
      // Chromium logs an error for a form POST answered 422/429 — expected,
      // and scoped to the document URL so unrelated failures still block.
      const expectedFormResponse =
        /^Failed to load resource: the server responded with a status of (422|429) \(/u.test(
          text,
        ) && message.location().url === page.url();
      // Tests deliberately abort the favicon connectivity probe to simulate
      // a dead uplink with navigator.onLine still true — Chromium logs that
      // as a resource error scoped to the probe URL only.
      const expectedProbeAbort =
        text.includes("ERR_FAILED") &&
        message.location().url.endsWith("/favicon.svg");
      if (
        message.type() === "error" &&
        !expectedFormResponse &&
        !expectedProbeAbort
      ) {
        errors.push(text);
      }
    });
    page.on("pageerror", (error) => {
      errors.push(error.message);
    });
  });

  test.afterEach(({ page }) => {
    expect(browserErrors.get(page) ?? []).toEqual([]);
  });

  function formHeaders(baseURL, extra = {}) {
    return {
      origin: requireBaseUrl(baseURL),
      "sec-fetch-site": "same-origin",
      ...extra,
    };
  }

  async function formatDeadlineLocally(page, deadlineMs) {
    return page.evaluate((timestampMs) => {
      const timestamp = new Date(timestampMs);
      const now = new Date();
      const options = {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      };
      if (timestamp.getFullYear() !== now.getFullYear()) {
        options.year = "numeric";
      }
      return new Intl.DateTimeFormat(undefined, options).format(timestamp);
    }, deadlineMs);
  }

  async function readOptionPresentation(page) {
    return page.evaluate(() =>
      Array.from(document.querySelectorAll("label.poll-option")).map(
        (option) => {
          const styles = getComputedStyle(option);
          const bounds = option.getBoundingClientRect();
          return {
            color: styles.color,
            display: styles.display,
            opacity: styles.opacity,
            visibility: styles.visibility,
            visible:
              bounds.width > 0 &&
              bounds.height > 0 &&
              styles.display !== "none" &&
              styles.visibility !== "hidden",
          };
        },
      ),
    );
  }

  async function publishPoll(
    page,
    context,
    baseURL,
    question = "Pick one",
    commentsEnabled = false,
  ) {
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

    const reference = `vote-${randomUUID()}`;
    await page.goto("/creator/new");
    await page.getByLabel("QUESTION").fill(question);
    await page.getByRole("textbox", { name: "OPTION 1" }).fill("Alpha");
    await page.getByRole("textbox", { name: "OPTION 2" }).fill("Beta");
    await page.getByLabel("CUSTOM LINK (OPTIONAL)").fill(reference);
    if (commentsEnabled) {
      await page.locator('label[for="comments-enabled"]').click();
    }
    await page.getByRole("button", { name: "PUBLISH POLL" }).click();
    await expect(page).toHaveURL(/\/creator\/polls\/[^?]+\?created/);

    const pollId = /\/creator\/polls\/([^?]+)/.exec(page.url())?.[1] ?? "";
    assertUuid(pollId);
    // The public voter surface must be exercised without the seeded Creator
    // session that was used only to publish the fixture.
    await context.clearCookies();
    return {
      path: `/${reference}`,
      pollId,
      userId: seeded.userId,
    };
  }

  async function publishMultiSelectPoll(
    page,
    context,
    baseURL,
    question = "Pick two",
  ) {
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

    const reference = `multi-vote-${randomUUID()}`;
    await page.goto("/creator/new");
    await page.getByLabel("QUESTION").fill(question);
    await page.getByRole("textbox", { name: "OPTION 1" }).fill("Alpha");
    await page.getByRole("textbox", { name: "OPTION 2" }).fill("Beta");
    await page.getByRole("textbox", { name: "OPTION 3" }).fill("Gamma");
    await page.locator("label.poll-option", { hasText: "SEVERAL" }).click();
    await page.getByLabel("MIN (OPTIONAL)").fill("2");
    await page.getByLabel("MAX (OPTIONAL)").fill("2");
    await page.getByLabel("CUSTOM LINK (OPTIONAL)").fill(reference);
    await page.getByRole("button", { name: "PUBLISH POLL" }).click();
    await expect(page).toHaveURL(/\/creator\/polls\/[^?]+\?created/);

    const pollId = /\/creator\/polls\/([^?]+)/.exec(page.url())?.[1] ?? "";
    assertUuid(pollId);
    await context.clearCookies();
    return {
      path: `/${reference}`,
      pollId,
      userId: seeded.userId,
    };
  }

  // Loads the open form, reads the hidden submission id and an option id,
  // then posts the ballot through the shared cookie jar (voter cookie and
  // the one-shot flash both live there).
  async function castVoteViaRequest(page, baseURL, path, optionLabel = "Beta") {
    await page.goto(path);
    const submissionId =
      (await page
        .locator('input[name="submission_id"]')
        .getAttribute("value")) ?? "";
    const optionId =
      (await page
        .getByRole("radio", { name: optionLabel })
        .getAttribute("value")) ?? "";
    assertUuid(submissionId);
    assertUuid(optionId);
    const response = await page.request.post(path, {
      form: { submission_id: submissionId, option_id: optionId },
      headers: formHeaders(baseURL),
      maxRedirects: 0,
    });
    return { submissionId, optionId, response };
  }

  // Read-only rows never carry cast markers (Story 1.8 two-golds rule): the
  // voter's own choice is the text-only YOUR BALLOT line, and a `.is-cast`
  // marker must not appear anywhere. The Counted composition is compact —
  // no option rows at all — while already-voted/closed keep the full list.
  const yourBallot = (page) => page.locator("[data-your-ballot]");

  async function expectYourBallot(page, labelsText) {
    const ballot = yourBallot(page);
    await expect(
      ballot.locator(".results-tally-ballot-label"),
    ).toHaveText("YOUR BALLOT");
    await expect(
      ballot.locator(".results-tally-ballot-value"),
    ).toHaveText(labelsText);
  }

  async function expectNoPrivateResultShape(page) {
    const main = page.locator("main");
    await expect(
      main.locator(
        [
          "[data-results-tally]",
          "[data-your-ballot]",
          "[data-tally-final]",
          "[data-tally-skeleton]",
          ".results-bar-track",
          ".results-tally-summary",
          ".results-tally-tied",
          ".results-bar-leader-mark",
        ].join(", "),
      ),
    ).toHaveCount(0);
    const text = await main.innerText();
    expect(text).not.toMatch(/\b\d+\s*(?:%|votes?|voters?|selections?)\b/iu);
    expect(text).not.toMatch(/\bTIED\b|◆/u);
  }

  const markerGlyph = (page, optionLabel) =>
    page
      .locator(".poll-option", { hasText: optionLabel })
      .locator(".poll-option-marker")
      .evaluate((marker) => getComputedStyle(marker, "::before").content);

  test.afterAll(() => {
    for (const userId of seededUserIds) {
      cleanupCreator(userId);
    }
  });

  test("server-renders accessible option rows and progressively disables Vote", async ({
    page,
    context,
    baseURL,
  }) => {
    const created = await publishPoll(page, context, baseURL);
    const response = await page.goto(created.path);
    expect(response?.status()).toBe(200);

    await expect(page.locator("label.poll-option")).toHaveCount(2);
    await expect(page.getByRole("radio", { name: "Alpha" })).toBeVisible();
    await expect(page.getByRole("radio", { name: "Beta" })).toBeVisible();
    await expect(page.getByRole("button", { name: "VOTE" })).toBeDisabled();
    await expect(
      page.getByText("SELECT AN OPTION TO UNLOCK VOTE"),
    ).toBeVisible();
    expect(await page.content()).not.toContain("astro-island");
    await expect(page.locator("[data-comment-composer]")).toHaveCount(0);

    const voterCookie = (await context.cookies()).find(
      ({ name }) => name === "oddspark.voter",
    );
    expect(voterCookie).toMatchObject({
      httpOnly: true,
      sameSite: "Lax",
    });
  });

  test("renders the enabled Comment composer in canonical order with accessible final-50 counting", async ({
    page,
    context,
    baseURL,
  }) => {
    const created = await publishPoll(
      page,
      context,
      baseURL,
      "What should ship with context?",
      true,
    );
    await page.goto(created.path);

    const composer = page.getByRole("group", {
      name: "ADD A COMMENT (OPTIONAL)",
    });
    const comment = page.getByRole("textbox", {
      name: "COMMENT",
      exact: true,
    });
    const displayName = page.getByRole("textbox", {
      name: "DISPLAY NAME (OPTIONAL)",
      exact: true,
    });
    const counter = page.locator("[data-comment-counter]");

    await expect(composer).toBeVisible();
    await expect(comment).toHaveAttribute("maxlength", "500");
    await expect(comment).toHaveAttribute("aria-describedby", "comment-counter");
    await expect(displayName).toHaveAttribute("maxlength", "80");
    await expect(counter).toHaveAttribute("aria-live", "polite");
    await expect(counter).toHaveAttribute("aria-atomic", "true");

    expect(
      await page.locator("[data-vote-form]").evaluate((form) => {
        const options = form.querySelector("fieldset.poll-options");
        const commentComposer = form.querySelector("[data-comment-composer]");
        const action = form.querySelector(".vote-action");
        const follows = (earlier, later) =>
          Boolean(
            earlier &&
              later &&
              earlier.compareDocumentPosition(later) &
                Node.DOCUMENT_POSITION_FOLLOWING,
          );
        return {
          optionsBeforeComposer: follows(options, commentComposer),
          composerBeforeAction: follows(commentComposer, action),
        };
      }),
    ).toEqual({ optionsBeforeComposer: true, composerBeforeAction: true });

    await comment.fill("x".repeat(449));
    await expect(counter).toBeHidden();
    await comment.fill("x".repeat(450));
    await expect(counter).toBeVisible();
    await expect(counter).toHaveText("50 characters left");
    await comment.fill("x".repeat(499));
    await expect(counter).toHaveText("1 character left");
    await comment.fill("x".repeat(500));
    await expect(counter).toHaveText("0 characters left");

    await comment.fill("The context behind my choice stays with the ballot.");
    await displayName.fill("E2E Voter");
    await comment.focus();
    await expect(comment).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(displayName).toBeFocused();

    await page.emulateMedia({ colorScheme: "dark" });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({
      path: `${commentProofDir}/composer-375-dark.png`,
      fullPage: true,
      mask: [page.locator("[data-share-url-text]")],
      maskColor: "#4b5563",
    });
    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({
      path: `${commentProofDir}/composer-1280-light.png`,
      fullPage: true,
      mask: [page.locator("[data-share-url-text]")],
      maskColor: "#4b5563",
    });
  });

  test("enforces multi-select bounds without disabling or renaming checkbox rows", async ({
    page,
    context,
    baseURL,
  }) => {
    const created = await publishMultiSelectPoll(page, context, baseURL);
    await page.goto(created.path);

    const alpha = page.getByRole("checkbox", { name: "Alpha", exact: true });
    const beta = page.getByRole("checkbox", { name: "Beta", exact: true });
    const gamma = page.getByRole("checkbox", { name: "Gamma", exact: true });
    const row = (label) => page.locator("label.poll-option", { hasText: label });
    const button = page.getByRole("button", { name: "VOTE" });
    const boundsHint = page.locator("[data-bounds-hint]");

    await expect(page.getByRole("checkbox")).toHaveCount(3);
    await expect(page.getByRole("radio")).toHaveCount(0);
    await expect(boundsHint).toHaveAttribute("aria-live", "polite");
    await expect(page.locator("fieldset.poll-options")).toHaveAttribute(
      "aria-describedby",
      "vote-bounds-hint",
    );
    await expect(boundsHint).toHaveText("Pick at least 2.");
    await expect(button).toBeDisabled();
    expect(await markerGlyph(page, "Alpha")).toBe('"[ ]"');

    await row("Alpha").click();
    await expect(boundsHint).toHaveText("Pick at least 2.");
    await expect(button).toBeDisabled();
    expect(await markerGlyph(page, "Alpha")).toBe('"[×]"');

    await row("Beta").click();
    await expect(button).toBeEnabled();
    await expect(boundsHint).toHaveText("Pick up to 2. 2 chosen.");
    await expect(page.locator("[data-vote-form]")).toHaveAttribute(
      "data-max-reached",
      "true",
    );
    for (const option of [alpha, beta, gamma]) {
      await expect(option).toBeEnabled();
      await expect(option).not.toHaveAttribute("aria-disabled");
    }

    await row("Gamma").click();
    await expect(gamma).not.toBeChecked();
    await expect(alpha).toBeChecked();
    await expect(beta).toBeChecked();
    await expect(boundsHint).toHaveText("Pick up to 2. 2 chosen.");

    await page.evaluate(() => {
      const options = Array.from(
        document.querySelectorAll('input[name="option_id"]'),
      );
      options[2].checked = true;
      options[2].dispatchEvent(new Event("change", { bubbles: true }));
      options[0].checked = false;
      options[0].dispatchEvent(new Event("change", { bubbles: true }));
    });
    await expect(gamma).not.toBeChecked();
    await expect(alpha).not.toBeChecked();
    await expect(beta).toBeChecked();
    await expect(button).toBeDisabled();
    await expect(boundsHint).toHaveText("Pick at least 2.");
  });

  test("keeps the exact multi-select ballot through in-flight and pageshow restoration", async ({
    page,
    context,
    baseURL,
  }) => {
    const created = await publishMultiSelectPoll(
      page,
      context,
      baseURL,
      "Frozen multi ballot?",
    );
    await page.goto(created.path);
    await page.locator("label.poll-option", { hasText: "Alpha" }).click();
    await page.locator("label.poll-option", { hasText: "Beta" }).click();

    let releaseProbe;
    const heldProbe = new Promise((resolve) => {
      releaseProbe = resolve;
    });
    await page.route("**/favicon.svg", async (route) => {
      await heldProbe;
      await route.continue();
    });
    await page.getByRole("button", { name: "VOTE" }).click();
    await expect(page.getByRole("button", { name: "COUNTING…" })).toBeDisabled();
    expect(
      await page.getByRole("checkbox").evaluateAll((options) =>
        options.map((option) => ({
          checked: option.checked,
          disabled: option.disabled,
        })),
      ),
    ).toEqual([
      { checked: true, disabled: false },
      { checked: true, disabled: false },
      { checked: false, disabled: false },
    ]);

    const guardedSelection = await page.evaluate(() => {
      const options = Array.from(
        document.querySelectorAll('input[name="option_id"]'),
      );
      options[2].checked = true;
      options[2].dispatchEvent(new Event("change", { bubbles: true }));
      return options.map((option) => option.checked);
    });
    expect(guardedSelection).toEqual([true, true, false]);

    expect(
      await page.evaluate(() => {
        const checkbox = document.querySelectorAll('input[name="option_id"]')[2];
        if (!(checkbox instanceof HTMLInputElement)) {
          throw new Error("third checkbox did not render");
        }
        checkbox.focus();
        const arrow = new KeyboardEvent("keydown", {
          key: "ArrowDown",
          bubbles: true,
          cancelable: true,
        });
        const space = new KeyboardEvent("keydown", {
          key: " ",
          bubbles: true,
          cancelable: true,
        });
        checkbox.dispatchEvent(arrow);
        checkbox.dispatchEvent(space);
        return {
          arrowPrevented: arrow.defaultPrevented,
          spacePrevented: space.defaultPrevented,
        };
      }),
    ).toEqual({ arrowPrevented: false, spacePrevented: true });

    await page.evaluate(() => {
      window.dispatchEvent(
        new PageTransitionEvent("pageshow", { persisted: true }),
      );
    });
    await expect(page.getByRole("button", { name: "VOTE" })).toBeEnabled();
    await expect(page.getByRole("checkbox", { name: "Alpha" })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: "Beta" })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: "Gamma" })).not.toBeChecked();
    await expect(page.locator("[data-bounds-hint]")).toHaveText(
      "Pick up to 2. 2 chosen.",
    );

    const probeSettled = page.waitForResponse(
      (candidate) =>
        candidate.url().endsWith("/favicon.svg") &&
        candidate.request().method() === "HEAD",
    );
    releaseProbe?.();
    await probeSettled;
    await page.unroute("**/favicon.svg");
  });

  test("preserves out-of-bounds ballots on 422, then counts and replays an exact multi-select vote", async ({
    page,
    context,
    baseURL,
  }) => {
    const question = "Bounded ballot?";
    const created = await publishMultiSelectPoll(
      page,
      context,
      baseURL,
      question,
    );
    await page.goto(created.path);
    const originalSubmissionId =
      (await page
        .locator('input[name="submission_id"]')
        .getAttribute("value")) ?? "";
    const optionIds = await page
      .getByRole("checkbox")
      .evaluateAll((options) => options.map((option) => option.value));
    assertUuid(originalSubmissionId);
    optionIds.forEach(assertUuid);

    const [belowMin] = await Promise.all([
      page.waitForResponse(
        (candidate) =>
          candidate.url().endsWith(created.path) &&
          candidate.request().method() === "POST",
      ),
      page.evaluate(() => {
        const form = document.querySelector("form[data-vote-form]");
        const first = document.querySelector('input[name="option_id"]');
        if (!(form instanceof HTMLFormElement) || !(first instanceof HTMLInputElement)) {
          throw new Error("multi-select form did not render");
        }
        first.checked = true;
        form.submit();
      }),
    ]);
    expect(belowMin.status()).toBe(422);
    await expect(page).toHaveTitle(`Vote not counted — ${question}`);
    await expect(page.locator("[data-vote-outcome]")).toBeFocused();
    await expect(page.locator("[data-vote-outcome]")).toHaveText(
      "Not enough selections. This Poll asks for at least 2, and your ballot is still here.",
    );
    await expect(page.locator("[data-vote-outcome]")).not.toContainText(
      "{min}",
    );
    await expect(page.getByRole("checkbox", { name: "Alpha" })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: "Beta" })).not.toBeChecked();
    await expect(page.getByRole("checkbox", { name: "Gamma" })).not.toBeChecked();
    const afterMinSubmissionId =
      (await page
        .locator('input[name="submission_id"]')
        .getAttribute("value")) ?? "";
    assertUuid(afterMinSubmissionId);
    expect(afterMinSubmissionId).not.toBe(originalSubmissionId);

    const [invalid] = await Promise.all([
      page.waitForResponse(
        (candidate) =>
          candidate.url().endsWith(created.path) &&
          candidate.request().method() === "POST",
      ),
      page.evaluate(() => {
        const form = document.querySelector("form[data-vote-form]");
        const options = Array.from(
          document.querySelectorAll('input[name="option_id"]'),
        );
        if (!(form instanceof HTMLFormElement)) {
          throw new Error("multi-select form did not render");
        }
        for (const option of options) {
          option.checked = true;
        }
        form.submit();
      }),
    ]);
    expect(invalid.status()).toBe(422);
    await expect(page).toHaveTitle(`Vote not counted — ${question}`);
    await expect(page.locator("[data-vote-outcome]")).toBeFocused();
    await expect(page.locator("[data-vote-outcome]")).toHaveText(
      "Too many selections. This Poll takes up to 2, and your ballot is still here.",
    );
    await expect(page.locator("[data-vote-outcome]")).not.toContainText(
      "{max}",
    );
    await expect(page.getByRole("checkbox")).toHaveCount(3);
    for (const option of await page.getByRole("checkbox").all()) {
      await expect(option).toBeChecked();
    }
    const retrySubmissionId =
      (await page
        .locator('input[name="submission_id"]')
        .getAttribute("value")) ?? "";
    assertUuid(retrySubmissionId);
    expect(retrySubmissionId).not.toBe(afterMinSubmissionId);
    expect(
      d1Query(
        `SELECT COUNT(*) AS n FROM vote WHERE poll_id = '${created.pollId}'`,
      ),
    ).toEqual([{ n: 0 }]);

    const acceptedBody = new URLSearchParams();
    acceptedBody.set("submission_id", retrySubmissionId);
    acceptedBody.append("option_id", optionIds[0]);
    acceptedBody.append("option_id", optionIds[1]);
    const accepted = await page.request.post(created.path, {
      data: acceptedBody.toString(),
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...formHeaders(baseURL),
      },
      maxRedirects: 0,
    });
    expect(accepted.status()).toBe(303);
    const replay = await page.request.post(created.path, {
      data: acceptedBody.toString(),
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...formHeaders(baseURL),
      },
      maxRedirects: 0,
    });
    expect(replay.status()).toBe(303);
    expect(
      d1Query(
        `SELECT COUNT(DISTINCT v.id) AS votes, COUNT(vs.poll_option_id) AS selections, p.representation_version FROM poll p LEFT JOIN vote v ON v.poll_id = p.id LEFT JOIN vote_selection vs ON vs.vote_id = v.id WHERE p.id = '${created.pollId}' GROUP BY p.id`,
      ),
    ).toEqual([{ votes: 1, selections: 2, representation_version: 2 }]);

    await page.goto(created.path);
    // Counted composition: compact — no option rows; the multi-select ballot
    // joins the selected labels in stored option order; the summary line
    // explains percentages that total past 100.
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    await expect(page.locator(".poll-option-readonly")).toHaveCount(0);
    await expectYourBallot(page, "Alpha · Beta");
    await expect(page.locator(".results-tally-summary")).toHaveText(
      "1 VOTERS · 2 SELECTIONS",
    );
    await expect(
      page.getByRole("img", { name: "Alpha, 100 percent, 1 vote" }),
    ).toBeVisible();
    // Two options tied at one vote apiece: TIED, no gold, no ◆ anywhere.
    await expect(page.locator(".results-tally-tied")).toHaveText("TIED");
    await expect(
      page.locator(".results-bar-leader-mark:not([hidden])"),
    ).toHaveCount(0);
    await page.reload();
    await expect(page).toHaveTitle(`Already voted — ${question}`);
    await expect(page.locator(".poll-option-readonly")).toHaveCount(3);
    await expect(page.locator(".poll-option-marker.is-cast")).toHaveCount(0);
    expect(await markerGlyph(page, "Alpha")).toBe('"[ ]"');
    expect(await markerGlyph(page, "Beta")).toBe('"[ ]"');
    expect(await markerGlyph(page, "Gamma")).toBe('"[ ]"');
    await expectYourBallot(page, "Alpha · Beta");
    await expect(page.locator(".results-tally-tied")).toHaveText("TIED");
  });

  test("renders deadlines locally and adds a countdown only inside 24 hours", async ({
    browser,
    page,
    context,
    baseURL,
  }) => {
    const created = await publishPoll(page, context, baseURL, "When does this close?");

    await page.goto(created.path);
    await expect(page.locator("time[data-deadline]")).toHaveCount(0);

    const farDeadline = Date.now() + 48 * 60 * 60 * 1000;
    setPollDeadline(created.pollId, farDeadline);

    const noJsContext = await browser.newContext({ javaScriptEnabled: false });
    const noJsPage = await noJsContext.newPage();
    await noJsPage.goto(`${requireBaseUrl(baseURL)}${created.path}`);
    await expect(noJsPage.locator("time[data-deadline]")).toContainText("UTC");
    await expect(noJsPage.locator("[data-deadline-countdown]")).toBeHidden();
    await noJsContext.close();

    await page.goto(created.path);
    const farTime = page.locator("time[data-deadline]");
    const farLocal = await formatDeadlineLocally(page, farDeadline);
    await expect(farTime).toHaveText(farLocal);
    await expect(farTime).toHaveAttribute(
      "datetime",
      new Date(farDeadline).toISOString(),
    );
    await expect(page.locator("[data-deadline-countdown]")).toBeHidden();

    const nearDeadline = Date.now() + 90 * 60 * 1000;
    setPollDeadline(created.pollId, nearDeadline);
    await page.reload();
    const nearTime = page.locator("time[data-deadline]");
    await expect(nearTime).toHaveText(
      await formatDeadlineLocally(page, nearDeadline),
    );
    await expect(nearTime).toHaveAttribute(
      "datetime",
      new Date(nearDeadline).toISOString(),
    );
    await expect(page.locator("[data-deadline-countdown]")).toHaveText(
      "CLOSES IN 1H",
    );
    await expect(page.locator("[data-deadline-countdown]")).toBeVisible();
  });

  test("counts one Vote, focuses confirmation, then renders already-voted read-only state", async ({
    page,
    context,
    baseURL,
  }) => {
    const question = "Which launch window?";
    const created = await publishPoll(page, context, baseURL, question);
    await page.goto(created.path);
    const betaOptionId =
      (await page
        .getByRole("radio", { name: "Beta" })
        .getAttribute("value")) ?? "";
    assertUuid(betaOptionId);
    await page.locator("label.poll-option", { hasText: "Beta" }).click();
    await expect(page.getByRole("button", { name: "VOTE" })).toBeEnabled();

    const [postResponse] = await Promise.all([
      page.waitForResponse(
        (candidate) =>
          candidate.url().endsWith(created.path) &&
          candidate.request().method() === "POST",
      ),
      page.getByRole("button", { name: "VOTE" }).click(),
    ]);
    expect(
      postResponse.status(),
      (await page.locator("[data-vote-outcome]").textContent()) ?? "",
    ).toBe(303);

    await expect(page).toHaveURL(new RegExp(`${created.path}$`));
    await expect(page).toHaveTitle(`Counted — ${question}`);
    await expect(page.locator("[data-vote-outcome]")).toBeFocused();
    await expect(page.locator("[data-vote-outcome]")).toContainText(
      "Counted. Results are live, updating as they arrive.",
    );
    // The Counted composition is compact: no option rows, the voter's own
    // choice as the text-only YOUR BALLOT line, and the authorized Tally
    // with exactly one gold leader — never a second gold on the ballot.
    await expect(page.locator(".poll-option-readonly")).toHaveCount(0);
    await expectYourBallot(page, "Beta");
    await expect(
      page.getByRole("img", { name: "Beta, 100 percent, 1 vote, leading" }),
    ).toBeVisible();
    await expect(
      page.locator(".results-bar-leader-mark:not([hidden])"),
    ).toHaveCount(1);
    await expect(page.locator(".poll-option-marker.is-cast")).toHaveCount(0);

    await page.reload();
    await expect(page).toHaveTitle(`Already voted — ${question}`);
    await expect(page.locator("[data-vote-outcome]")).toBeFocused();
    await expect(page.getByText("You've already voted here.")).toBeVisible();
    await expect(
      page.locator(".poll-option-readonly", { hasText: "Alpha" }),
    ).toBeVisible();
    await expect(
      page.locator(".poll-option-readonly", { hasText: "Beta" }),
    ).toBeVisible();
    // Already-voted keeps the full read-only option list — with every
    // selected/gold marker suppressed — plus the Tally and YOUR BALLOT.
    await expect(page.locator(".poll-option-readonly")).toHaveCount(2);
    await expect(
      page.locator(".poll-option-readonly").getByText("Your vote"),
    ).toHaveCount(0);
    await expect(page.locator(".poll-option-marker.is-cast")).toHaveCount(0);
    await expectYourBallot(page, "Beta");
    await expect(
      page.getByRole("img", { name: "Beta, 100 percent, 1 vote, leading" }),
    ).toBeVisible();
    await expect(
      page.locator(".results-bar-leader-mark:not([hidden])"),
    ).toHaveCount(1);
    await expect(page.getByRole("radio")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "VOTE" })).toHaveCount(0);

    const retryBody = new URLSearchParams();
    retryBody.set("submission_id", randomUUID());
    retryBody.set("option_id", betaOptionId);
    const duplicate = await page.request.post(created.path, {
      data: retryBody.toString(),
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...formHeaders(baseURL),
      },
      maxRedirects: 0,
    });
    expect(duplicate.status()).toBe(422);
    await page.setContent(await duplicate.text());
    await expect(page).toHaveTitle(`Already voted — ${question}`);
    await expect(page.getByText("You've already voted here.")).toBeVisible();
    await expect(page.getByRole("radio")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "VOTE" })).toHaveCount(0);

    expect(
      d1Query(
        `SELECT COUNT(*) AS votes, p.representation_version FROM vote v JOIN poll p ON p.id = v.poll_id WHERE p.id = '${created.pollId}'`,
      ),
    ).toEqual([{ votes: 1, representation_version: 2 }]);
  });

  test("rejects a submission whose first-party token disappeared and preserves the ballot", async ({
    page,
    context,
    baseURL,
  }) => {
    const question = "Token retry?";
    const created = await publishPoll(page, context, baseURL, question);
    await page.goto(created.path);
    const submissionId =
      (await page
        .locator('input[name="submission_id"]')
        .getAttribute("value")) ?? "";
    assertUuid(submissionId);
    await page.locator("label.poll-option", { hasText: "Alpha" }).click();
    await context.clearCookies();

    const [postResponse] = await Promise.all([
      page.waitForResponse(
        (candidate) =>
          candidate.url().endsWith(created.path) &&
          candidate.request().method() === "POST",
      ),
      page.getByRole("button", { name: "VOTE" }).click(),
    ]);
    expect(postResponse.status()).toBe(422);
    await expect(page).toHaveTitle(`Vote not counted — ${question}`);
    await expect(page.locator("[data-vote-outcome]")).toBeFocused();
    // Exact heading/body split: the retry idiom's own " — " must not become
    // a dangling body fragment.
    await expect(page.locator("[data-vote-outcome] strong")).toHaveText(
      "That didn't land.",
    );
    await expect(page.locator("[data-vote-outcome]")).toHaveText(
      "That didn't land. The Vote wasn't recorded and your ballot is still here, exactly as you left it. Try again — and if it keeps failing, the Poll will still be here in a minute.",
    );
    await expect(page.getByRole("radio", { name: "Alpha" })).toBeChecked();
    await expect(page.getByRole("button", { name: "VOTE" })).toBeEnabled();
    // The error re-render re-issues the voter cookie the retry needs and
    // mints a fresh submission id.
    const reissued = (await context.cookies()).find(
      ({ name }) => name === "oddspark.voter",
    );
    expect(reissued?.value ?? "").toMatch(/^[a-f0-9]{32}$/u);
    const retrySubmissionId =
      (await page
        .locator('input[name="submission_id"]')
        .getAttribute("value")) ?? "";
    assertUuid(retrySubmissionId);
    expect(retrySubmissionId).not.toBe(submissionId);
    expect(
      d1Query(
        `SELECT COUNT(*) AS n FROM vote WHERE poll_id = '${created.pollId}'`,
      ),
    ).toEqual([{ n: 0 }]);
  });

  test("rejects zero selections without JavaScript and keeps the form usable", async ({
    browser,
    page,
    context,
    baseURL,
  }) => {
    const question = "No JS ballot?";
    const created = await publishPoll(page, context, baseURL, question);
    const noJsContext = await browser.newContext({ javaScriptEnabled: false });
    const noJsPage = await noJsContext.newPage();
    await noJsPage.goto(`${requireBaseUrl(baseURL)}${created.path}`);
    await expect(noJsPage.getByRole("button", { name: "VOTE" })).toBeEnabled();
    const submissionId =
      (await noJsPage
        .locator('input[name="submission_id"]')
        .getAttribute("value")) ?? "";
    assertUuid(submissionId);

    const [postResponse] = await Promise.all([
      noJsPage.waitForResponse(
        (candidate) =>
          candidate.url().endsWith(created.path) &&
          candidate.request().method() === "POST",
      ),
      noJsPage.getByRole("button", { name: "VOTE" }).click(),
    ]);
    expect(postResponse.status()).toBe(422);
    await expect(noJsPage).toHaveTitle(`Nothing selected — ${question}`);
    await expect(noJsPage.locator("[data-vote-outcome]")).toBeFocused();
    await expect(noJsPage.locator("[data-vote-outcome]")).toContainText(
      "Nothing's selected. Pick an option, then vote.",
    );
    await expect(noJsPage.getByRole("button", { name: "VOTE" })).toBeEnabled();
    const retrySubmissionId =
      (await noJsPage
        .locator('input[name="submission_id"]')
        .getAttribute("value")) ?? "";
    assertUuid(retrySubmissionId);
    expect(retrySubmissionId).not.toBe(submissionId);
    await noJsContext.close();
  });

  test("casts a Vote without JavaScript and never shows the JS-only hint", async ({
    browser,
    page,
    context,
    baseURL,
  }) => {
    const question = "No JS vote?";
    const created = await publishPoll(page, context, baseURL, question);
    const noJsContext = await browser.newContext({ javaScriptEnabled: false });
    const noJsPage = await noJsContext.newPage();
    await noJsPage.goto(`${requireBaseUrl(baseURL)}${created.path}`);

    // UX-DR8 floor: no hint above the enabled button when JS is off.
    await expect(
      noJsPage.getByText("SELECT AN OPTION TO UNLOCK VOTE"),
    ).toBeHidden();
    await expect(noJsPage.getByRole("button", { name: "VOTE" })).toBeEnabled();

    await noJsPage.locator("label.poll-option", { hasText: "Alpha" }).click();
    await noJsPage.getByRole("button", { name: "VOTE" }).click();
    await expect(noJsPage).toHaveTitle(`Counted — ${question}`);
    await expect(noJsPage.locator("[data-vote-outcome]")).toContainText(
      "Counted. Results are live, updating as they arrive.",
    );
    // No-JS floor: the final authorized Tally and YOUR BALLOT render in the
    // server HTML; the skeleton stays hidden without the enhancer.
    await expectYourBallot(noJsPage, "Alpha");
    await expect(noJsPage.locator("[data-tally-final]")).toBeVisible();
    await expect(noJsPage.locator("[data-tally-skeleton]")).toBeHidden();
    await expect(
      noJsPage.getByRole("img", { name: "Alpha, 100 percent, 1 vote, leading" }),
    ).toBeVisible();
    expect(
      d1Query(
        `SELECT COUNT(*) AS n FROM vote WHERE poll_id = '${created.pollId}'`,
      ),
    ).toEqual([{ n: 1 }]);
    await noJsContext.close();
  });

  test("preserves Comment fields through a native no-JavaScript 422 and retry", async ({
    browser,
    page,
    context,
    baseURL,
  }) => {
    const question = "No JS Comment retry?";
    const created = await publishPoll(
      page,
      context,
      baseURL,
      question,
      true,
    );
    const noJsContext = await browser.newContext({ javaScriptEnabled: false });
    const noJsPage = await noJsContext.newPage();
    await noJsPage.goto(`${requireBaseUrl(baseURL)}${created.path}`);

    const comment = noJsPage.getByRole("textbox", {
      name: "COMMENT",
      exact: true,
    });
    const displayName = noJsPage.getByRole("textbox", {
      name: "DISPLAY NAME (OPTIONAL)",
      exact: true,
    });
    const safeComment = "<b>Context & a reason</b>";
    await comment.fill(safeComment);
    await displayName.fill("No-JS Voter");
    const originalSubmissionId =
      (await noJsPage
        .locator('input[name="submission_id"]')
        .getAttribute("value")) ?? "";
    assertUuid(originalSubmissionId);

    const [rejected] = await Promise.all([
      noJsPage.waitForResponse(
        (candidate) =>
          candidate.url().endsWith(created.path) &&
          candidate.request().method() === "POST",
      ),
      noJsPage.getByRole("button", { name: "VOTE" }).click(),
    ]);
    expect(rejected.status()).toBe(422);
    await expect(noJsPage).toHaveTitle(`Nothing selected — ${question}`);
    await expect(noJsPage.locator("[data-vote-outcome]")).toBeFocused();
    await expect(comment).toHaveValue(safeComment);
    await expect(displayName).toHaveValue("No-JS Voter");
    await expect(noJsPage.locator("[data-comment-composer] b")).toHaveCount(0);
    const retrySubmissionId =
      (await noJsPage
        .locator('input[name="submission_id"]')
        .getAttribute("value")) ?? "";
    assertUuid(retrySubmissionId);
    expect(retrySubmissionId).not.toBe(originalSubmissionId);
    expect(
      d1Query(
        `SELECT COUNT(*) AS n FROM vote_comment vc JOIN vote v ON v.id = vc.vote_id WHERE v.poll_id = '${created.pollId}'`,
      ),
    ).toEqual([{ n: 0 }]);

    await noJsPage.locator("label.poll-option", { hasText: "Alpha" }).click();
    await noJsPage.getByRole("button", { name: "VOTE" }).click();
    await expect(noJsPage).toHaveTitle(`Counted — ${question}`);
    expect(
      d1Query(
        `SELECT vc.body, vc.display_name FROM vote_comment vc JOIN vote v ON v.id = vc.vote_id WHERE v.poll_id = '${created.pollId}'`,
      ),
    ).toEqual([{ body: safeComment, display_name: "No-JS Voter" }]);
    await noJsContext.close();
  });

  test("keeps Comment fields read-only in flight and editable after recovery", async ({
    page,
    context,
    baseURL,
  }) => {
    const created = await publishPoll(
      page,
      context,
      baseURL,
      "Recover my Comment?",
      true,
    );
    await page.goto(created.path);
    await page.locator("label.poll-option", { hasText: "Alpha" }).click();
    const comment = page.getByRole("textbox", {
      name: "COMMENT",
      exact: true,
    });
    const displayName = page.getByRole("textbox", {
      name: "DISPLAY NAME (OPTIONAL)",
      exact: true,
    });
    await comment.fill("Keep this exact context.");
    await displayName.fill("Patient Voter");

    let releaseProbe;
    const heldProbe = new Promise((resolve) => {
      releaseProbe = resolve;
    });
    await page.route("**/favicon.svg", async (route) => {
      await heldProbe;
      await route.continue();
    });
    await page.getByRole("button", { name: "VOTE" }).click();

    await expect(page.getByRole("button", { name: "COUNTING…" })).toBeDisabled();
    await expect(comment).toHaveJSProperty("readOnly", true);
    await expect(displayName).toHaveJSProperty("readOnly", true);
    await expect(comment).toHaveValue("Keep this exact context.");
    await expect(displayName).toHaveValue("Patient Voter");
    await expect(page.locator("[data-comment-composer]")).toHaveCSS(
      "pointer-events",
      "none",
    );

    await page.evaluate(() => {
      window.dispatchEvent(
        new PageTransitionEvent("pageshow", { persisted: true }),
      );
    });
    await expect(page.getByRole("button", { name: "VOTE" })).toBeEnabled();
    await expect(comment).toHaveJSProperty("readOnly", false);
    await expect(displayName).toHaveJSProperty("readOnly", false);
    await expect(comment).toHaveValue("Keep this exact context.");
    await expect(displayName).toHaveValue("Patient Voter");

    const probeSettled = page.waitForResponse(
      (candidate) =>
        candidate.url().endsWith("/favicon.svg") &&
        candidate.request().method() === "HEAD",
    );
    releaseProbe?.();
    await probeSettled;
    await page.unroute("**/favicon.svg");
  });

  test("locks one in-flight submission without dimming or disabling its options", async ({
    page,
    context,
    baseURL,
  }) => {
    const created = await publishPoll(page, context, baseURL, "One POST?");
    await page.goto(created.path);
    await page.locator("label.poll-option", { hasText: "Alpha" }).click();
    const beforeSubmitOptions = await readOptionPresentation(page);
    expect(beforeSubmitOptions).toHaveLength(2);
    expect(beforeSubmitOptions.every(({ visible }) => visible)).toBe(true);

    let postCount = 0;
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname === created.path
      ) {
        postCount += 1;
      }
    });

    const voteButton = page.getByRole("button", { name: "VOTE" });
    // The script preventDefaults every JS submit and only calls
    // form.submit() after the connectivity probe resolves — holding the
    // probe keeps the form in flight without any POST leaving.
    let releaseProbe;
    const heldProbe = new Promise((resolve) => {
      releaseProbe = resolve;
    });
    await page.route("**/favicon.svg", async (route) => {
      await heldProbe;
      await route.continue();
    });
    await voteButton.focus();
    await voteButton.press("Enter");

    const inFlight = await page.evaluate(() => {
      const button = document.querySelector('button[type="submit"]');
      const fieldset = document.querySelector("fieldset.poll-options");
      const radios = Array.from(
        document.querySelectorAll('input[name="option_id"]'),
      );
      const buttonStyles = button ? getComputedStyle(button) : null;
      return {
        buttonBusy: button?.getAttribute("aria-busy"),
        buttonDisabled: button?.disabled,
        buttonLabel: button?.textContent?.trim(),
        focusOutline: buttonStyles
          ? `${buttonStyles.outlineStyle} ${buttonStyles.outlineWidth}`
          : null,
        pointerEvents: fieldset
          ? getComputedStyle(fieldset).pointerEvents
          : null,
        radiosDisabled: radios.map((radio) => radio.disabled),
      };
    });
    expect(inFlight).toEqual({
      buttonBusy: "true",
      buttonDisabled: true,
      buttonLabel: "COUNTING…",
      focusOutline: "solid 2px",
      pointerEvents: "none",
      radiosDisabled: [false, false],
    });
    expect(await readOptionPresentation(page)).toEqual(beforeSubmitOptions);

    const heldSelection = await page.evaluate(() => {
      const radios = Array.from(
        document.querySelectorAll('input[name="option_id"]'),
      );
      radios[1].checked = true;
      radios[1].dispatchEvent(new Event("change", { bubbles: true }));
      return radios.map((radio) => radio.checked);
    });
    expect(heldSelection).toEqual([true, false]);

    const secondSubmitPrevented = await page.evaluate(() => {
      const form = document.querySelector("form[data-vote-form]");
      if (!(form instanceof HTMLFormElement)) return false;
      let prevented = false;
      form.addEventListener(
        "submit",
        (event) => {
          prevented = event.defaultPrevented;
        },
        { once: true },
      );
      form.requestSubmit();
      return prevented;
    });
    expect(secondSubmitPrevented).toBe(true);
    expect(postCount).toBe(0);

    await page.evaluate(() => {
      window.dispatchEvent(
        new PageTransitionEvent("pageshow", { persisted: true }),
      );
    });
    await expect(page.getByRole("button", { name: "VOTE" })).toBeEnabled();
    await expect(page.getByRole("radio", { name: "Alpha" })).toBeChecked();
    await expect(page.locator("form[data-vote-form]")).not.toHaveAttribute(
      "data-vote-inflight",
      "true",
    );

    // Releasing the held probe resolves it against a form that is no longer
    // in flight — the probe callback's guard must refuse the late submit.
    const probeSettled = page.waitForResponse(
      (candidate) =>
        candidate.url().endsWith("/favicon.svg") &&
        candidate.request().method() === "HEAD",
    );
    releaseProbe?.();
    await probeSettled;
    await page.unroute("**/favicon.svg");
    expect(postCount).toBe(0);

    let markGuardProbe;
    const guardProbe = new Promise((resolve) => {
      markGuardProbe = resolve;
    });
    await page.exposeFunction("story16GuardProbe", (probe) => {
      markGuardProbe?.(probe);
    });
    await page.evaluate(() => {
      const form = document.querySelector("form[data-vote-form]");
      if (!(form instanceof HTMLFormElement)) return;
      form.addEventListener(
        "submit",
        () => {
          queueMicrotask(() => {
            const button = document.querySelector('button[type="submit"]');
            form.requestSubmit();
            window.story16GuardProbe({
              buttonDisabled: button?.disabled,
              buttonLabel: button?.textContent?.trim(),
            });
          });
        },
        { once: true },
      );
    });
    let releasePost;
    const heldPost = new Promise((resolve) => {
      releasePost = resolve;
    });
    let markPostSeen;
    const postSeen = new Promise((resolve) => {
      markPostSeen = resolve;
    });
    await page.route(`**${created.path}`, async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      markPostSeen?.();
      await heldPost;
      await route.continue();
    });

    const postResponse = page.waitForResponse(
      (candidate) =>
        candidate.url().endsWith(created.path) &&
        candidate.request().method() === "POST",
    );
    await page.getByRole("button", { name: "VOTE" }).click({
      noWaitAfter: true,
    });
    try {
      const [, guardedSecondSubmit] = await Promise.all([
        postSeen,
        guardProbe,
      ]);
      expect(guardedSecondSubmit).toEqual({
        buttonDisabled: true,
        buttonLabel: "COUNTING…",
      });
      expect(postCount).toBe(1);
    } finally {
      releasePost?.();
    }
    expect((await postResponse).status()).toBe(303);
    await expect(page).toHaveTitle("Counted — One POST?");
    expect(postCount).toBe(1);
  });

  test("keeps the ballot safe offline and submits after the connection returns", async ({
    page,
    context,
    baseURL,
  }) => {
    const created = await publishPoll(page, context, baseURL, "Offline ballot?");
    await page.goto(created.path);
    await page.locator("label.poll-option", { hasText: "Alpha" }).click();

    let postCount = 0;
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname === created.path
      ) {
        postCount += 1;
      }
    });

    const offlineOutcome = page.locator("[data-offline-outcome]");
    await context.setOffline(true);
    await expect(offlineOutcome).toHaveText(
      "No connection. Your ballot is safe on this page; nothing has been sent yet.",
    );
    await expect(offlineOutcome).toBeVisible();
    await expect(offlineOutcome).not.toBeFocused();

    await page.getByRole("button", { name: "VOTE" }).click();
    await expect(offlineOutcome).toBeFocused();
    await expect(page.getByRole("radio", { name: "Alpha" })).toBeChecked();
    await expect(page.getByRole("button", { name: "VOTE" })).toBeEnabled();
    expect(postCount).toBe(0);

    await context.setOffline(false);
    await expect(offlineOutcome).toBeHidden();
    await expect(page.getByRole("button", { name: "VOTE" })).toBeFocused();

    await page.getByRole("button", { name: "VOTE" }).click();
    await expect(page).toHaveTitle("Counted — Offline ballot?");
    expect(postCount).toBe(1);
  });

  test("keeps the ballot safe when the probe fails though navigator.onLine is true", async ({
    page,
    context,
    baseURL,
  }) => {
    const created = await publishPoll(page, context, baseURL, "Dead uplink?");
    await page.goto(created.path);
    await page.locator("label.poll-option", { hasText: "Alpha" }).click();

    let postCount = 0;
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname === created.path
      ) {
        postCount += 1;
      }
    });

    // navigator.onLine stays true (the Firefox / captive-portal blind spot);
    // aborting the favicon probe is the dead uplink the submit must survive.
    await page.route("**/favicon.svg", (route) => route.abort());

    const offlineOutcome = page.locator("[data-offline-outcome]");
    await page.getByRole("button", { name: "VOTE" }).click();
    await expect(offlineOutcome).toHaveText(
      "No connection. Your ballot is safe on this page; nothing has been sent yet.",
    );
    await expect(offlineOutcome).toBeFocused();
    await expect(page.getByRole("radio", { name: "Alpha" })).toBeChecked();
    await expect(page.getByRole("button", { name: "VOTE" })).toBeEnabled();
    expect(postCount).toBe(0);

    await page.unroute("**/favicon.svg");
    await page.getByRole("button", { name: "VOTE" }).click();
    await expect(page).toHaveTitle("Counted — Dead uplink?");
    expect(postCount).toBe(1);
  });

  test("mints a fresh submission id when the 10s restore fires on a held POST", async ({
    page,
    context,
    baseURL,
  }) => {
    const created = await publishPoll(page, context, baseURL, "Slow count?");
    await page.goto(created.path);
    const submissionId =
      (await page
        .locator('input[name="submission_id"]')
        .getAttribute("value")) ?? "";
    assertUuid(submissionId);
    await page.locator("label.poll-option", { hasText: "Alpha" }).click();

    let postCount = 0;
    await page.route(`**${created.path}`, async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      postCount += 1;
      // A 204 answers the POST without committing a navigation: the document
      // (and its 10s restore timer) stays alive, as with any lost response.
      await route.fulfill({ status: 204 });
    });

    await page.getByRole("button", { name: "VOTE" }).click();
    await expect(page.getByRole("button", { name: "COUNTING…" })).toBeDisabled();
    await expect
      .poll(() => postCount, "the intercepted POST left the page")
      .toBe(1);

    // The response is lost from the page's perspective, so the 10s restore
    // fires: the form unlocks with a FRESH submission id — an edited
    // resubmit can never dead-end in IDEMPOTENCY_CONFLICT if the original
    // request still committed server-side.
    await page.waitForTimeout(10_500);
    const restored = await page.evaluate(() => {
      const button = document.querySelector('button[type="submit"]');
      const input = document.querySelector('input[name="submission_id"]');
      const form = document.querySelector("form[data-vote-form]");
      return {
        buttonDisabled: button ? button.disabled : null,
        buttonLabel: button?.textContent?.trim() ?? null,
        inFlight: form?.getAttribute("data-vote-inflight") ?? null,
        submissionId: input?.getAttribute("value") ?? "",
      };
    });
    expect(restored).toMatchObject({
      buttonDisabled: false,
      buttonLabel: "VOTE",
    });
    expect(restored.inFlight).not.toBe("true");
    assertUuid(restored.submissionId);
    expect(restored.submissionId).not.toBe(submissionId);

    // And the restored form's retry actually lands.
    await page.unroute(`**${created.path}`);
    await page.getByRole("button", { name: "VOTE" }).click();
    await expect(page).toHaveTitle("Counted — Slow count?");
  });

  test("suppresses the offline line on a rate-limit-locked form and reconciles it on pageshow", async ({
    page,
    context,
    baseURL,
  }) => {
    const created = await publishPoll(page, context, baseURL, "Locked offline?");
    await page.goto(created.path);
    await page.locator("label.poll-option", { hasText: "Alpha" }).click();

    const offlineOutcome = page.locator("[data-offline-outcome]");

    // A locked form (the 429 re-render shape) already shows reload guidance;
    // the offline line must not stack contradictory copy on it.
    await page.evaluate(() => {
      document
        .querySelector("form[data-vote-form]")
        ?.setAttribute("data-vote-locked", "true");
      window.dispatchEvent(new Event("offline"));
    });
    await expect(offlineOutcome).toBeHidden();

    // A bfcache-frozen page misses offline/online events; pageshow must
    // reconcile the banner with the connectivity it wakes up to.
    await page.evaluate(() => {
      document
        .querySelector("form[data-vote-form]")
        ?.setAttribute("data-vote-locked", "false");
      Object.defineProperty(navigator, "onLine", {
        get: () => false,
        configurable: true,
      });
      window.dispatchEvent(new Event("offline"));
    });
    await expect(offlineOutcome).toBeVisible();
    await page.evaluate(() => {
      Object.defineProperty(navigator, "onLine", {
        get: () => true,
        configurable: true,
      });
      window.dispatchEvent(
        new PageTransitionEvent("pageshow", { persisted: true }),
      );
    });
    await expect(offlineOutcome).toBeHidden();
  });

  test("counts a double-clicked submission exactly once", async ({
    page,
    context,
    baseURL,
  }) => {
    const question = "Double click?";
    const created = await publishPoll(page, context, baseURL, question);
    await page.goto(created.path);
    const submissionId =
      (await page
        .locator('input[name="submission_id"]')
        .getAttribute("value")) ?? "";
    const optionId =
      (await page
        .getByRole("radio", { name: "Beta" })
        .getAttribute("value")) ?? "";
    assertUuid(submissionId);
    assertUuid(optionId);

    const [first, second] = await Promise.all([
      page.request.post(created.path, {
        form: { submission_id: submissionId, option_id: optionId },
        headers: formHeaders(baseURL),
        maxRedirects: 0,
      }),
      page.request.post(created.path, {
        form: { submission_id: submissionId, option_id: optionId },
        headers: formHeaders(baseURL),
        maxRedirects: 0,
      }),
    ]);
    expect(first.status()).toBe(303);
    expect(second.status()).toBe(303);
    expect(
      d1Query(
        `SELECT COUNT(*) AS n FROM vote WHERE poll_id = '${created.pollId}'`,
      ),
    ).toEqual([{ n: 1 }]);

    await page.goto(created.path);
    await expect(page).toHaveTitle(`Counted — ${question}`);
    await expect(page.locator("[data-vote-outcome]")).toContainText(
      "Counted.",
    );
  });

  test("back-button resubmit lands on the already-voted/conflict outcomes, never a crash", async ({
    page,
    context,
    baseURL,
  }) => {
    const question = "Back button?";
    const created = await publishPoll(page, context, baseURL, question);
    await page.goto(created.path);
    const submissionId =
      (await page
        .locator('input[name="submission_id"]')
        .getAttribute("value")) ?? "";
    const alphaOptionId =
      (await page
        .getByRole("radio", { name: "Alpha" })
        .getAttribute("value")) ?? "";
    const betaOptionId =
      (await page
        .getByRole("radio", { name: "Beta" })
        .getAttribute("value")) ?? "";
    assertUuid(submissionId);
    assertUuid(alphaOptionId);
    assertUuid(betaOptionId);

    await page.locator("label.poll-option", { hasText: "Beta" }).click();
    await page.getByRole("button", { name: "VOTE" }).click();
    await expect(page).toHaveTitle(`Counted — ${question}`);

    // Back after the 303: the re-fetched form is the already-voted state.
    await page.goBack();
    await expect(page).toHaveTitle(`Already voted — ${question}`);
    await expect(page.locator("[data-vote-outcome]")).toContainText(
      "You've already voted here.",
    );

    // An exact replay of the original submission returns the stored outcome.
    const replay = await page.request.post(created.path, {
      form: { submission_id: submissionId, option_id: betaOptionId },
      headers: formHeaders(baseURL),
      maxRedirects: 0,
    });
    expect(replay.status()).toBe(303);

    // The same id with a changed ballot is a permanent conflict with its own
    // copy — and the re-rendered form mints a fresh submission id.
    const conflict = await page.request.post(created.path, {
      form: { submission_id: submissionId, option_id: alphaOptionId },
      headers: formHeaders(baseURL),
      maxRedirects: 0,
    });
    expect(conflict.status()).toBe(422);
    await page.setContent(await conflict.text());
    // Exact heading/body split: single-sentence copy is ALL heading — the
    // em-dash clause stays in the heading and the body is empty.
    await expect(page.locator("[data-vote-outcome] strong")).toHaveText(
      "Your earlier Vote stands — this change wasn't recorded.",
    );
    await expect(page.locator("[data-vote-outcome]")).toHaveText(
      "Your earlier Vote stands — this change wasn't recorded.",
    );
    await expect(page.getByRole("radio", { name: "Alpha" })).toBeChecked();
    const minted =
      (await page
        .locator('input[name="submission_id"]')
        .getAttribute("value")) ?? "";
    expect(minted).not.toBe(submissionId);
    assertUuid(minted);

    expect(
      d1Query(
        `SELECT COUNT(*) AS n FROM vote WHERE poll_id = '${created.pollId}'`,
      ),
    ).toEqual([{ n: 1 }]);
  });

  test("ignores a stale flash cookie from a different Poll", async ({
    page,
    context,
    baseURL,
  }) => {
    const first = await publishPoll(page, context, baseURL, "First Poll?");
    const second = await publishPoll(page, context, baseURL, "Second Poll?");

    // Voting on the first Poll mints its one-shot flash into the cookie jar.
    const { response } = await castVoteViaRequest(
      page,
      baseURL,
      first.path,
      "Alpha",
    );
    expect(response.status()).toBe(303);

    await page.goto(second.path);
    await expect(page).toHaveTitle("Second Poll? — Oddspark Polls");
    await expect(page.locator("[data-vote-outcome]")).toHaveCount(0);
    await expect(page.getByText("Counted.")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "VOTE" })).toBeVisible();
  });

  test("returns the designed 404 when the Poll is deleted between GET and POST", async ({
    page,
    context,
    baseURL,
  }) => {
    const created = await publishPoll(page, context, baseURL, "Deleted Poll?");
    await page.goto(created.path);
    const submissionId =
      (await page
        .locator('input[name="submission_id"]')
        .getAttribute("value")) ?? "";
    const optionId =
      (await page
        .getByRole("radio", { name: "Beta" })
        .getAttribute("value")) ?? "";
    assertUuid(submissionId);
    assertUuid(optionId);

    deletePoll(created.pollId);

    const response = await page.request.post(created.path, {
      form: { submission_id: submissionId, option_id: optionId },
      headers: formHeaders(baseURL),
      maxRedirects: 0,
    });
    expect(response.status()).toBe(404);
    expect(await response.text()).toContain("This Poll doesn't exist.");
  });

  test("rejects a non-UUID submission_id with the ballot preserved", async ({
    page,
    context,
    baseURL,
  }) => {
    const question = "Forged submission id?";
    const created = await publishPoll(page, context, baseURL, question);
    await page.goto(created.path);
    const optionId =
      (await page
        .getByRole("radio", { name: "Beta" })
        .getAttribute("value")) ?? "";
    assertUuid(optionId);

    const response = await page.request.post(created.path, {
      form: { submission_id: "not-a-uuid", option_id: optionId },
      headers: formHeaders(baseURL),
      maxRedirects: 0,
    });
    expect(response.status()).toBe(422);
    await page.setContent(await response.text());
    await expect(page).toHaveTitle(`Vote not counted — ${question}`);
    await expect(page.locator("[data-vote-outcome]")).toContainText(
      "That didn't land.",
    );
    await expect(page.getByRole("radio", { name: "Beta" })).toBeChecked();
    const minted =
      (await page
        .locator('input[name="submission_id"]')
        .getAttribute("value")) ?? "";
    assertUuid(minted);
    expect(
      d1Query(
        `SELECT COUNT(*) AS n FROM vote WHERE poll_id = '${created.pollId}'`,
      ),
    ).toEqual([{ n: 0 }]);
  });

  test("rejects a Vote cast after the Poll closes with the closed outcome", async ({
    page,
    context,
    baseURL,
  }) => {
    const question = "Closed mid-flight?";
    const created = await publishPoll(page, context, baseURL, question);
    await page.goto(created.path);
    const submissionId =
      (await page
        .locator('input[name="submission_id"]')
        .getAttribute("value")) ?? "";
    const optionId =
      (await page
        .getByRole("radio", { name: "Beta" })
        .getAttribute("value")) ?? "";
    assertUuid(submissionId);
    assertUuid(optionId);

    // The Poll closes between the form GET and the POST.
    setPollDeadline(created.pollId, Date.now() - 1000);

    const response = await page.request.post(created.path, {
      form: { submission_id: submissionId, option_id: optionId },
      headers: formHeaders(baseURL),
      maxRedirects: 0,
    });
    expect(response.status()).toBe(422);
    await page.setContent(await response.text());
    await expect(page).toHaveTitle(`Poll closed — ${question}`);
    // Exact heading/body split: heading runs through the (dynamic) close
    // timestamp; the body is exactly "Your Vote wasn't recorded." — the
    // em-dash before {when} must not split into a dangling body.
    await expect(page.locator("[data-vote-outcome] strong")).toHaveText(
      /^This Poll closed while you were deciding — .+\.$/u,
    );
    await expect(page.locator("[data-vote-outcome]")).toHaveText(
      /^This Poll closed while you were deciding — .+\.\s+Your Vote wasn't recorded\.$/u,
    );
    await expect(page.getByRole("radio")).toHaveCount(0);
    // The submitted ballot was REJECTED — never recorded — so nothing is
    // marked and no YOUR BALLOT line appears: only a vote that actually
    // landed renders one. The empty Tally still shows (Live, closed).
    await expect(page.locator(".poll-option-marker.is-cast")).toHaveCount(0);
    await expect(
      page.locator(".poll-option-readonly").getByText("Your vote"),
    ).toHaveCount(0);
    await expect(yourBallot(page)).toHaveCount(0);
    await expect(page.locator(".results-tally-empty")).toHaveText(
      "No Votes yet. Yours would be the first, which is a kind of power.",
    );
    expect(
      d1Query(
        `SELECT COUNT(*) AS n FROM vote WHERE poll_id = '${created.pollId}'`,
      ),
    ).toEqual([{ n: 0 }]);
  });

  test("renders the visibility-specific Counted confirmation copy", async ({
    page,
    context,
    baseURL,
  }) => {
    const creatorOnly = await publishPoll(
      page,
      context,
      baseURL,
      "Creator only copy?",
    );
    setResultVisibility(creatorOnly.pollId, "creator_only");
    const creatorOnlyVote = await castVoteViaRequest(
      page,
      baseURL,
      creatorOnly.path,
      "Alpha",
    );
    expect(creatorOnlyVote.response.status()).toBe(303);
    await page.goto(creatorOnly.path);
    await expect(page.locator("[data-vote-outcome]")).toContainText(
      "Counted. These results go to the Creator only.",
    );
    // Hidden Creator-Only leaks no aggregate result facts. Option labels stay
    // intentionally public on full read-only outcomes, so the guard targets
    // tally structure/counts rather than banning Creator-authored labels.
    await expectNoPrivateResultShape(page);
    await expect(page.locator(".poll-option-readonly")).toHaveCount(0);
    await page.reload();
    await expect(page).toHaveTitle("Already voted — Creator only copy?");
    await expect(page.locator("[data-results-explanation]")).toHaveText(
      "These results go to the Creator only.",
    );
    await expect(page.locator("[data-results-explanation]")).toHaveAttribute(
      "data-results-state",
      "creator_only_hidden",
    );
    await expect(page.locator(".poll-option-readonly")).toHaveCount(2);
    await expectNoPrivateResultShape(page);

    const afterClose = await publishPoll(
      page,
      context,
      baseURL,
      "After close copy?",
    );
    setResultVisibility(afterClose.pollId, "after_close");
    const afterCloseVote = await castVoteViaRequest(
      page,
      baseURL,
      afterClose.path,
      "Alpha",
    );
    expect(afterCloseVote.response.status()).toBe(303);
    await page.goto(afterClose.path);
    // No deadline uses the exact shared hidden-results sentence.
    await expect(page.locator("[data-vote-outcome]")).toHaveText(
      "Counted. Results open when the Poll closes.",
    );
    await expect(page.locator("[data-vote-outcome]")).not.toContainText("—");
    // Open After Close leaks no aggregate result facts either.
    await expectNoPrivateResultShape(page);
    await page.reload();
    await expect(page).toHaveTitle("Already voted — After close copy?");
    await expect(page.locator("[data-results-explanation]")).toHaveText(
      "Results open when the Poll closes.",
    );
    await expect(page.locator("[data-results-explanation]")).toHaveAttribute(
      "data-results-state",
      "after_close_hidden",
    );
    await expect(page.locator(".poll-option-readonly")).toHaveCount(2);
    await expectNoPrivateResultShape(page);
  });

  test("derives Counted visibility after an After Close deadline passes", async ({
    page,
    context,
    baseURL,
  }) => {
    const question = "Results after the bell?";
    const created = await publishPoll(page, context, baseURL, question);
    setResultVisibility(created.pollId, "after_close");
    setPollDeadline(created.pollId, Date.now() + 48 * 60 * 60 * 1000);

    const { response } = await castVoteViaRequest(
      page,
      baseURL,
      created.path,
      "Beta",
    );
    expect(response.status()).toBe(303);

    // The vote committed while Results were hidden. Before the flash GET, the
    // deadline passes: the Counted body and Tally must both use the fresh,
    // authorized Results decision from that GET.
    setPollDeadline(created.pollId, Date.now() - 1_000);
    await page.goto(created.path);
    await expect(page).toHaveTitle(`Counted — ${question}`);
    await expect(page.locator("[data-vote-outcome]")).toHaveText(
      "Counted. Results are live, updating as they arrive.",
    );
    await expect(page.locator("[data-vote-outcome]")).not.toContainText(
      "Results open when the Poll closes",
    );
    await expect(page.locator(".poll-option-readonly")).toHaveCount(0);
    await expectYourBallot(page, "Beta");
    await expect(
      page.getByRole("img", { name: "Beta, 100 percent, 1 vote, leading" }),
    ).toBeVisible();
  });

  test("preserves Counted and read-only outcomes when Results are unavailable", async ({
    page,
    context,
    baseURL,
  }) => {
    const question = "Still counted?";
    const created = await publishPoll(page, context, baseURL, question);
    const { response } = await castVoteViaRequest(
      page,
      baseURL,
      created.path,
      "Alpha",
    );
    expect(response.status()).toBe(303);

    // Keep the accepted Vote and identity claim, but make its tally projection
    // internally inconsistent. The adapter fails closed on one Voter with zero
    // selections, exercising the additive Results failure path without a test
    // hook or shared-schema mutation.
    d1Execute(
      `DELETE FROM vote_selection WHERE vote_id IN (SELECT id FROM vote WHERE poll_id = '${created.pollId}')`,
    );

    const countedResponse = await page.goto(created.path);
    expect(countedResponse?.status()).toBe(200);
    await expect(page).toHaveTitle(`Counted — ${question}`);
    await expect(page.locator("[data-vote-outcome]")).toHaveText(
      "Counted. Results are unavailable right now.",
    );
    await expect(page.locator("[data-results-tally]")).toHaveCount(0);
    await expect(page.locator(".poll-option-readonly")).toHaveCount(0);

    await page.reload();
    await expect(page).toHaveTitle(`Already voted — ${question}`);
    await expect(page.locator("[data-vote-outcome]")).toContainText(
      "You've already voted here.",
    );
    await expect(page.locator("[data-results-explanation]")).toHaveText(
      "Results are unavailable right now.",
    );
    await expect(page.locator("[data-results-explanation]")).toHaveAttribute(
      "data-results-state",
      "unavailable",
    );
    await expect(page.locator(".poll-option-readonly")).toHaveCount(2);
    await expect(page.locator("[data-results-tally]")).toHaveCount(0);
  });

  test("shows the closed state with the cast selection marked after a voted Poll closes", async ({
    page,
    context,
    baseURL,
  }) => {
    const question = "Voted then closed?";
    const created = await publishPoll(page, context, baseURL, question);
    const { response } = await castVoteViaRequest(
      page,
      baseURL,
      created.path,
      "Beta",
    );
    expect(response.status()).toBe(303);

    // Drop the one-shot flash so the GET exercises the closed-vs-already-
    // voted precedence, not the Counted confirmation.
    await context.clearCookies({ name: "oddspark.vote_flash" });
    setPollDeadline(created.pollId, Date.now() - 1000);

    await page.goto(created.path);
    await expect(page).toHaveTitle(`Poll closed — ${question}`);
    await expect(page.locator("[data-vote-outcome]")).toBeFocused();
    await expect(page.locator("[data-vote-outcome]")).toContainText(
      "This Poll closed",
    );
    await expect(page.getByRole("radio")).toHaveCount(0);
    // Closed + Live: the full read-only option list stays, markers
    // suppressed, and the Tally renders with the voter's text-only ballot.
    await expect(page.locator(".poll-option-readonly")).toHaveCount(2);
    await expect(page.locator(".poll-option-marker.is-cast")).toHaveCount(0);
    await expect(
      page.locator(".poll-option-readonly").getByText("Your vote"),
    ).toHaveCount(0);
    await expectYourBallot(page, "Beta");
    await expect(
      page.getByRole("img", { name: "Beta, 100 percent, 1 vote, leading" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "VOTE" })).toHaveCount(0);
  });

  test("rate-limits an abusive client, sends Retry-After, and keeps the form locked", async ({
    page,
    context,
    baseURL,
  }) => {
    const question = "Rate limit probe?";
    const created = await publishPoll(page, context, baseURL, question);
    // A stable, well-formed voter identity so admitted submissions reach
    // castVote (the first casts; later fresh ids hit already-voted).
    await context.addCookies([
      {
        name: "oddspark.voter",
        value: "a".repeat(32),
        url: requireBaseUrl(baseURL),
      },
    ]);
    await page.goto(created.path);
    const optionId =
      (await page
        .getByRole("radio", { name: "Beta" })
        .getAttribute("value")) ?? "";
    assertUuid(optionId);

    const headers = formHeaders(baseURL, {
      "cf-connecting-ip": "203.0.113.8",
    });

    // Fresh submission ids only — replays deliberately bypass the limiter.
    // Loop until the limiter engages rather than hard-coding an exact
    // boundary count against the local binding's window.
    let limited = null;
    let admitted = 0;
    for (let attempt = 0; attempt < 45 && limited === null; attempt += 1) {
      const response = await page.request.post(created.path, {
        form: { submission_id: randomUUID(), option_id: optionId },
        headers,
        maxRedirects: 0,
      });
      if (response.status() === 429) {
        limited = response;
      } else {
        expect([303, 422]).toContain(response.status());
        admitted += 1;
      }
    }
    expect(
      limited,
      "the limiter never engaged within 45 fresh submissions",
    ).not.toBeNull();
    expect(admitted).toBeGreaterThan(0);
    expect(limited.headers()["retry-after"]).toBe("60");

    await page.setContent(await limited.text());
    await expect(page).toHaveTitle(`Too many Votes — ${question}`);
    await expect(page.locator("[data-vote-outcome]")).toBeFocused();
    await expect(page.locator("[data-vote-outcome]")).toContainText(
      "Too many Votes from here, too quickly. Give it a minute, then reload this page. If you're a person, this shouldn't have happened, and we're sorry it did.",
    );
    await expect(page.getByRole("radio", { name: "Beta" })).toBeChecked();
    await expect(page.getByRole("button", { name: "VOTE" })).toBeDisabled();
    expect(
      d1Query(
        `SELECT COUNT(*) AS votes, p.representation_version FROM vote v JOIN poll p ON p.id = v.poll_id WHERE p.id = '${created.pollId}'`,
      ),
    ).toEqual([{ votes: 1, representation_version: 2 }]);
  });

  test("renders a closed Poll read-only with no markers or Vote action", async ({
    page,
    context,
    baseURL,
  }) => {
    const question = "Closed choice?";
    const created = await publishPoll(page, context, baseURL, question);
    // Task 9 pins closure-by-deadline: the fixture seeds a PAST deadline.
    const closedDeadline = Date.now() - 1000;
    setPollDeadline(created.pollId, closedDeadline);

    await page.goto(created.path);
    await expect(page).toHaveTitle(`Poll closed — ${question}`);
    await expect(page.locator("[data-vote-outcome]")).toBeFocused();
    await expect(page.getByText(/^This Poll closed /)).toBeVisible();
    await expect(page.locator("time[data-deadline]")).toHaveAttribute(
      "datetime",
      new Date(closedDeadline).toISOString(),
    );
    await expect(page.locator("time[data-deadline]")).not.toContainText("UTC");
    await expect(
      page.locator(".poll-option-readonly", { hasText: "Alpha" }),
    ).toBeVisible();
    await expect(
      page.locator(".poll-option-readonly", { hasText: "Beta" }),
    ).toBeVisible();
    await expect(page.getByRole("radio")).toHaveCount(0);
    // Every read-only row renders a marker span (alignment), but nothing was
    // cast — so no ◆ state and no "Your vote" text anywhere.
    await expect(page.locator(".poll-option-marker")).toHaveCount(2);
    await expect(page.locator(".poll-option-marker.is-cast")).toHaveCount(0);
    await expect(
      page.locator(".poll-option-readonly").getByText("Your vote"),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: "VOTE" })).toHaveCount(0);
  });

  test("marks the cast selection, never the rejected ballot, on an already-voted re-render", async ({
    page,
    context,
    baseURL,
  }) => {
    const question = "Two tabs?";
    const created = await publishPoll(page, context, baseURL, question);
    // Two tabs share the cookie jar; both load the open form BEFORE either
    // votes, so tab B still holds a submittable ballot.
    await page.goto(created.path);
    const tabB = await context.newPage();
    await tabB.goto(created.path);
    const submissionIdB =
      (await tabB
        .locator('input[name="submission_id"]')
        .getAttribute("value")) ?? "";
    const betaOptionId =
      (await tabB
        .getByRole("radio", { name: "Beta" })
        .getAttribute("value")) ?? "";
    assertUuid(submissionIdB);
    assertUuid(betaOptionId);

    // Tab A votes option 1 (Alpha).
    await page.locator("label.poll-option", { hasText: "Alpha" }).click();
    await page.getByRole("button", { name: "VOTE" }).click();
    await expect(page).toHaveTitle(`Counted — ${question}`);

    // Tab B submits option 2 (Beta): rejected as already-voted. The
    // read-only re-render must show the CAST selection (Alpha) as the
    // YOUR BALLOT line — never the just-submitted, rejected one (Beta).
    const duplicate = await tabB.request.post(created.path, {
      form: { submission_id: submissionIdB, option_id: betaOptionId },
      headers: formHeaders(baseURL),
      maxRedirects: 0,
    });
    expect(duplicate.status()).toBe(422);
    await tabB.setContent(await duplicate.text());
    await expect(tabB.locator("[data-vote-outcome]")).toContainText(
      "You've already voted here.",
    );
    await expectYourBallot(tabB, "Alpha");
    await expect(tabB.locator(".poll-option-marker.is-cast")).toHaveCount(0);
    await expect(
      tabB.getByRole("img", { name: "Alpha, 100 percent, 1 vote, leading" }),
    ).toBeVisible();

    expect(
      d1Query(
        `SELECT COUNT(*) AS n FROM vote WHERE poll_id = '${created.pollId}'`,
      ),
    ).toEqual([{ n: 1 }]);
    await tabB.close();
  });

  test("treats a malformed voter cookie as absent, re-issues it, and the Vote lands", async ({
    page,
    context,
    baseURL,
  }) => {
    const question = "Malformed cookie?";
    const created = await publishPoll(page, context, baseURL, question);
    await context.addCookies([
      {
        name: "oddspark.voter",
        value: "not-hex!",
        url: requireBaseUrl(baseURL),
      },
    ]);

    // A present-but-malformed cookie is never HMAC'd into a garbage
    // identity: the response re-issues a well-formed one.
    await page.goto(created.path);
    const reissued = (await context.cookies()).find(
      ({ name }) => name === "oddspark.voter",
    );
    expect(reissued?.value ?? "").toMatch(/^[a-f0-9]{32}$/u);

    // And the re-issued identity votes normally.
    const { response } = await castVoteViaRequest(
      page,
      baseURL,
      created.path,
      "Alpha",
    );
    expect(response.status()).toBe(303);
    await page.goto(created.path);
    await expect(page.locator("[data-vote-outcome]")).toContainText(
      "Counted.",
    );
  });

  test("keeps the public repository footer after Share in both supported silhouettes", async ({
    page,
    context,
    baseURL,
  }) => {
    const created = await publishPoll(
      page,
      context,
      baseURL,
      "Which evidence should lead?",
    );
    const failedResponses = [];
    const failedRequests = [];
    page.on("response", (response) => {
      if (response.status() >= 400) {
        failedResponses.push(response.status());
      }
    });
    page.on("requestfailed", (request) => {
      failedRequests.push(request.failure()?.errorText ?? "request failed");
    });

    const proofDir =
      "test-results/story-3-6-presentable-repository-proof";
    const inspectFooter = async () => {
      const repository = page.getByRole("link", {
        name: "View the public repository",
      });
      await expect(repository).toHaveAttribute(
        "href",
        "https://github.com/Hearn-Systems-LLC/oddspark-polls",
      );
      await expect(repository).not.toHaveAttribute("target", /.+/);
      await repository.focus();
      await expect(repository).toBeFocused();
      await expect(repository).toHaveCSS("outline-width", "2px");
      await expect(repository).toHaveCSS("outline-offset", "2px");
      expect((await repository.boundingBox())?.height).toBeGreaterThanOrEqual(44);
      expect(
        await page.evaluate(() => {
          const share = document.querySelector(".share-block");
          const footer = document.querySelector(
            "[data-public-repository-footer]",
          );
          return Boolean(
            share &&
              footer &&
              share.compareDocumentPosition(footer) &
                Node.DOCUMENT_POSITION_FOLLOWING,
          );
        }),
      ).toBe(true);
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0);
    };

    await page.emulateMedia({ colorScheme: "dark" });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(created.path);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Which evidence should lead?",
    );
    await inspectFooter();
    await page.screenshot({
      path: `${proofDir}/voting-375-dark.png`,
      fullPage: true,
      mask: [page.locator("[data-share-url-text]")],
      maskColor: "#4b5563",
    });

    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.reload();
    await inspectFooter();
    await page.screenshot({
      path: `${proofDir}/voting-1280-light.png`,
      fullPage: true,
      mask: [page.locator("[data-share-url-text]")],
      maskColor: "#4b5563",
    });

    expect(failedResponses).toEqual([]);
    expect(failedRequests).toEqual([]);
  });
});
