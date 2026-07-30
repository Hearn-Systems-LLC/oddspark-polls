import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  assertUuid,
  cleanupCreator,
  closePoll,
  d1Query,
  hasBetterAuthSecret,
  requireBaseUrl,
  seedCreatorSession,
} from "./creator-session.mjs";

test.describe.configure({ mode: "serial", timeout: 120_000 });

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
      const expectedFormResponse =
        /^Failed to load resource: the server responded with a status of (422|429) \(/u.test(
          text,
        );
      if (message.type() === "error" && !expectedFormResponse) {
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

  async function publishPoll(page, context, baseURL, question = "Pick one") {
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

    const voterCookie = (await context.cookies()).find(
      ({ name }) => name === "oddspark.voter",
    );
    expect(voterCookie).toMatchObject({
      httpOnly: true,
      sameSite: "Lax",
    });
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

    await page.reload();
    await expect(page).toHaveTitle(`Already voted — ${question}`);
    await expect(page.locator("[data-vote-outcome]")).toBeFocused();
    await expect(page.getByText("You've already voted here.")).toBeVisible();
    await expect(page.getByText("Alpha")).toBeVisible();
    await expect(page.getByText("Beta")).toBeVisible();
    await expect(page.getByRole("radio")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "VOTE" })).toHaveCount(0);

    const retryBody = new URLSearchParams();
    retryBody.set("submission_id", randomUUID());
    retryBody.set("option_id", betaOptionId);
    const duplicate = await page.request.post(created.path, {
      data: retryBody.toString(),
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: requireBaseUrl(baseURL),
        "sec-fetch-site": "same-origin",
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
    await expect(page.locator("[data-vote-outcome]")).toContainText(
      "That didn't land.",
    );
    await expect(page.getByRole("radio", { name: "Alpha" })).toBeChecked();
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
    await noJsContext.close();
  });

  test("rate-limits an abusive client before a second mutation and preserves its ballot", async ({
    page,
    context,
    baseURL,
  }) => {
    const question = "Rate limit probe?";
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

    const body = new URLSearchParams();
    body.set("submission_id", submissionId);
    body.set("option_id", optionId);
    const headers = {
      "content-type": "application/x-www-form-urlencoded",
      "cf-connecting-ip": "203.0.113.8",
      origin: requireBaseUrl(baseURL),
      "sec-fetch-site": "same-origin",
    };

    for (let attempt = 0; attempt < 30; attempt += 1) {
      const admitted = await page.request.post(created.path, {
        data: body.toString(),
        headers,
        maxRedirects: 0,
      });
      expect(admitted.status()).toBe(303);
    }

    const limited = await page.request.post(created.path, {
      data: body.toString(),
      headers,
      maxRedirects: 0,
    });
    expect(limited.status()).toBe(429);
    await page.setContent(await limited.text());
    await expect(page).toHaveTitle(`Too many Votes — ${question}`);
    await expect(page.locator("[data-vote-outcome]")).toContainText(
      "Too many Votes from here, too quickly. Give it a minute. If you're a person, this shouldn't have happened, and we're sorry it did.",
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
    closePoll(created.pollId, Date.now() - 1);

    await page.goto(created.path);
    await expect(page).toHaveTitle(`Poll closed — ${question}`);
    await expect(page.getByText(/^This Poll closed /)).toBeVisible();
    await expect(page.getByText("Alpha")).toBeVisible();
    await expect(page.getByText("Beta")).toBeVisible();
    await expect(page.getByRole("radio")).toHaveCount(0);
    await expect(page.locator(".poll-option-marker")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "VOTE" })).toHaveCount(0);
  });
});
