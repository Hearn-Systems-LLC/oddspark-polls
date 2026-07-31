import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  assertUuid,
  cleanupCreator,
  d1Query,
  deletePoll,
  hasBetterAuthSecret,
  requireBaseUrl,
  seedCreatorSession,
  setPollDeadline,
  setResultVisibility,
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
      // Chromium logs an error for a form POST answered 422/429 — expected,
      // and scoped to the document URL so unrelated failures still block.
      const expectedFormResponse =
        /^Failed to load resource: the server responded with a status of (422|429) \(/u.test(
          text,
        ) && message.location().url === page.url();
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

  function formHeaders(baseURL, extra = {}) {
    return {
      origin: requireBaseUrl(baseURL),
      "sec-fetch-site": "same-origin",
      ...extra,
    };
  }

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

  const readonlyMarker = (page, optionLabel) =>
    page
      .locator(".poll-option-readonly", { hasText: optionLabel })
      .locator(".poll-option-marker");

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
    // The Counted read-only state marks the voter's own cast selection.
    await expect(readonlyMarker(page, "Beta")).toBeVisible();
    await expect(readonlyMarker(page, "Alpha")).toHaveCount(0);

    await page.reload();
    await expect(page).toHaveTitle(`Already voted — ${question}`);
    await expect(page.locator("[data-vote-outcome]")).toBeFocused();
    await expect(page.getByText("You've already voted here.")).toBeVisible();
    await expect(page.getByText("Alpha")).toBeVisible();
    await expect(page.getByText("Beta")).toBeVisible();
    await expect(readonlyMarker(page, "Beta")).toBeVisible();
    await expect(readonlyMarker(page, "Alpha")).toHaveCount(0);
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
    // The error re-render re-issues the voter cookie the retry needs and
    // mints a fresh submission id.
    const reissued = (await context.cookies()).find(
      ({ name }) => name === "oddspark.voter",
    );
    expect(reissued?.value ?? "").toMatch(/^[a-f0-9]{32}$/u);
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
    await expect(
      noJsPage
        .locator(".poll-option-readonly", { hasText: "Alpha" })
        .locator(".poll-option-marker"),
    ).toBeVisible();
    expect(
      d1Query(
        `SELECT COUNT(*) AS n FROM vote WHERE poll_id = '${created.pollId}'`,
      ),
    ).toEqual([{ n: 1 }]);
    await noJsContext.close();
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
    await expect(page.locator("[data-vote-outcome]")).toContainText(
      "Your earlier Vote stands",
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
    await expect(page.locator("[data-vote-outcome]")).toContainText(
      "This Poll closed while you were deciding",
    );
    await expect(page.locator("[data-vote-outcome]")).toContainText(
      "Your Vote wasn't recorded.",
    );
    await expect(page.getByRole("radio")).toHaveCount(0);
    // The preserved ballot marks the submitted selection in the read-only state.
    await expect(readonlyMarker(page, "Beta")).toBeVisible();
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
    // No deadline: the em-dash deadline clause is dropped entirely.
    await expect(page.locator("[data-vote-outcome]")).toContainText(
      "Counted. Results open when the Poll closes. You'll find out when everyone else does.",
    );
    await expect(page.locator("[data-vote-outcome]")).not.toContainText("—");
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
    await expect(readonlyMarker(page, "Beta")).toBeVisible();
    await expect(readonlyMarker(page, "Alpha")).toHaveCount(0);
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
    setPollDeadline(created.pollId, Date.now() - 1000);

    await page.goto(created.path);
    await expect(page).toHaveTitle(`Poll closed — ${question}`);
    await expect(page.locator("[data-vote-outcome]")).toBeFocused();
    await expect(page.getByText(/^This Poll closed /)).toBeVisible();
    await expect(page.getByText("Alpha")).toBeVisible();
    await expect(page.getByText("Beta")).toBeVisible();
    await expect(page.getByRole("radio")).toHaveCount(0);
    await expect(page.locator(".poll-option-marker")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "VOTE" })).toHaveCount(0);
  });
});
