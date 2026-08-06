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

// Story 1.12 — close, edit, delete lifecycle on the creator detail surface.

if (!hasBetterAuthSecret()) {
  throw new Error(
    "Story 1.12 E2E requires BETTER_AUTH_SECRET in .dev.vars; skipping lifecycle proof is forbidden",
  );
}

const proofDir = "test-results/story-1-12-lifecycle-proof";

test.describe.configure({ mode: "serial", timeout: 180_000 });

test.describe("creator poll lifecycle", () => {
  const seededUserIds = [];
  let pagesUnderTest = [];

  function watchConsole(page) {
    if (pagesUnderTest.some(({ observedPage }) => observedPage === page)) {
      return page;
    }
    const errors = [];
    const expectedDocument404Urls = new Set();
    const expectedResourceStatuses = [];
    pagesUnderTest.push({
      observedPage: page,
      errors,
      expectedDocument404Urls,
      expectedResourceStatuses,
    });
    page.on("console", (message) => {
      if (message.type() === "error") {
        const text = message.text();
        const expectedDocument404 =
          /^Failed to load resource: the server responded with a status of 404 \(/u.test(
            text,
          ) && expectedDocument404Urls.delete(message.location().url);
        if (expectedDocument404) {
          return;
        }
        const expectedStatusIndex = expectedResourceStatuses.findIndex(
          (status) =>
            new RegExp(`status of ${status} \\(`, "u").test(text),
        );
        if (expectedStatusIndex !== -1) {
          expectedResourceStatuses.splice(expectedStatusIndex, 1);
          return;
        }
        errors.push(text);
      }
    });
    page.on("pageerror", (error) => {
      errors.push(error.message);
    });
    return page;
  }

  function allowExpectedResourceStatus(page, status) {
    const watchedPage = pagesUnderTest.find(
      ({ observedPage }) => observedPage === page,
    );
    if (!watchedPage) {
      throw new Error(
        "Expected the page console to be watched before the request",
      );
    }
    watchedPage.expectedResourceStatuses.push(status);
  }

  function allowExpectedDocument404(page, expectedUrl) {
    const watchedPage = pagesUnderTest.find(
      ({ observedPage }) => observedPage === page,
    );
    if (!watchedPage) {
      throw new Error(
        "Expected the page console to be watched before navigation",
      );
    }
    watchedPage.expectedDocument404Urls.add(expectedUrl);
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

  async function publishPoll(
    page,
    question,
    optionA = "A",
    optionB = "B",
    { commentsEnabled = false } = {},
  ) {
    await page.goto("/creator/new");
    await page.getByLabel("QUESTION").fill(question);
    await page.getByRole("textbox", { name: "OPTION 1" }).fill(optionA);
    await page.getByRole("textbox", { name: "OPTION 2" }).fill(optionB);
    if (commentsEnabled) {
      await page.locator('label[for="comments-enabled"]').click();
    }
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

  function voteCount(pollId) {
    assertUuid(pollId);
    return Number(
      d1Query(sql`SELECT COUNT(*) AS n FROM vote WHERE poll_id = ${pollId};`)[0]
        ?.n ?? 0,
    );
  }

  function formHeaders(baseURL) {
    return {
      origin: requireBaseUrl(baseURL),
      "sec-fetch-site": "same-origin",
    };
  }

  function insertAcceptedVote(pollId) {
    assertUuid(pollId);
    const options = d1Query(
      sql`SELECT id FROM poll_option WHERE poll_id = ${pollId} ORDER BY position LIMIT 1;`,
    );
    const optionId = options[0]?.id;
    assertUuid(optionId);
    const voteId = randomUUID();
    const submissionId = randomUUID();
    d1Execute(
      sql.join([
        sql`INSERT INTO vote (id, poll_id, submission_id, payload_hash, created_at_ms) VALUES (${voteId}, ${pollId}, ${submissionId}, 'e2e-hash', ${Date.now()});`,
        sql`INSERT INTO vote_selection (vote_id, poll_option_id) VALUES (${voteId}, ${optionId});`,
      ]),
    );
  }

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

  test("round-trips the creator Comment opt-in through create and definition edits", async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, baseURL);
    await page.goto("/creator/new");
    const newCommentsGroup = page.getByRole("group", {
      name: "COMMENTS WITH VOTES",
    });
    await expect(
      newCommentsGroup.locator('input[name="commentsEnabled"][value="false"]'),
    ).toBeChecked();

    const pollId = await publishPoll(
      page,
      "Comment configuration round trip",
      "Alpha",
      "Beta",
      { commentsEnabled: true },
    );
    const reference = pollReference(pollId);
    expect(reference).toBeTruthy();
    expect(
      d1Query(sql`SELECT comments_enabled FROM poll WHERE id = ${pollId}`),
    ).toEqual([{ comments_enabled: 1 }]);

    const editCommentsGroup = page.getByRole("group", {
      name: "COMMENTS WITH VOTES",
    });
    await expect(
      editCommentsGroup.locator('input[name="commentsEnabled"][value="true"]'),
    ).toBeChecked();
    await page.goto(`/${reference}`);
    await expect(
      page.getByRole("group", { name: "ADD A COMMENT (OPTIONAL)" }),
    ).toBeVisible();

    await page.goto(`/creator/polls/${pollId}`);
    await page.locator('label[for="comments-disabled"]').click();
    await page.getByRole("button", { name: "SAVE CHANGES" }).first().click();
    await expect(page).toHaveURL(
      new RegExp(`/creator/polls/${pollId}\\?outcome=poll-updated`),
    );
    expect(
      d1Query(sql`SELECT comments_enabled FROM poll WHERE id = ${pollId}`),
    ).toEqual([{ comments_enabled: 0 }]);
    await page.goto(`/${reference}`);
    await expect(page.locator("[data-comment-composer]")).toHaveCount(0);
    await expect(page.getByText("ADD A COMMENT (OPTIONAL)")).toHaveCount(0);

    await page.goto(`/creator/polls/${pollId}`);
    await page.locator('label[for="comments-enabled"]').click();
    await page.getByRole("button", { name: "SAVE CHANGES" }).first().click();
    await expect(page).toHaveURL(
      new RegExp(`/creator/polls/${pollId}\\?outcome=poll-updated`),
    );
    expect(
      d1Query(sql`SELECT comments_enabled FROM poll WHERE id = ${pollId}`),
    ).toEqual([{ comments_enabled: 1 }]);
    await page.goto(`/${reference}`);
    await expect(page.locator("[data-comment-composer]")).toBeVisible();
  });

  test("edits definition before Votes and locks after the first Vote", async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, baseURL);
    const pollId = await publishPoll(page, "Lifecycle edit poll", "One", "Two");

    await page.getByLabel("QUESTION").fill("Lifecycle edited question");
    await page.getByRole("textbox", { name: "OPTION 1" }).fill("Alpha");
    await page.getByRole("textbox", { name: "OPTION 2" }).fill("Beta");
    await page.locator("label.poll-option", { hasText: "SEVERAL" }).click();
    await page.getByLabel("MIN (OPTIONAL)").fill("2");
    await page.getByLabel("MAX (OPTIONAL)").fill("2");
    await page.getByLabel("DESCRIPTION (OPTIONAL)").fill("Edited notes");
    await page.getByRole("button", { name: "SAVE CHANGES" }).first().click();

    await expect(page).toHaveURL(
      new RegExp(`/creator/polls/${pollId}\\?outcome=poll-updated`),
    );
    await expect(page.locator("[data-outcome='poll-updated']")).toHaveText(
      "Poll updated.",
    );
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Lifecycle edited question",
    );

    insertAcceptedVote(pollId);
    // Confirm the fixture landed in the same local D1 the dev server reads.
    const voteRows = d1Query(
      sql`SELECT COUNT(*) AS n FROM vote WHERE poll_id = ${pollId};`,
    );
    expect(Number(voteRows[0]?.n ?? 0)).toBeGreaterThanOrEqual(1);

    await page.goto(`/creator/polls/${pollId}`);
    await expect(page.locator("[data-definition-locked]")).toHaveText(
      "Locked — the first Vote has been cast. The description is still yours to edit.",
    );
    await expect(page.locator("#question")).toHaveCount(0);
    await expect(page.locator("[data-locked-question]")).toHaveText(
      "Lifecycle edited question",
    );
    await expect(page.getByText("SEVERAL (min 2, max 2)")).toBeVisible();

    await page.getByLabel("DESCRIPTION (OPTIONAL)").fill("After vote notes");
    await page.getByRole("button", { name: "SAVE DESCRIPTION" }).click();
    await expect(page).toHaveURL(
      new RegExp(`/creator/polls/${pollId}\\?outcome=description-updated`),
    );
    await expect(
      page.locator("[data-outcome='description-updated']"),
    ).toHaveText("Description updated.");
  });

  test("proves both definition-edit and Vote race orderings with stale-ballot recovery", async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, baseURL);

    // Edit wins: the stale public ballot is rejected against replaced option
    // IDs and the current definition is rendered instead of a false 404.
    const editFirstId = await publishPoll(page, "Edit wins?", "Old A", "Old B");
    const editFirstReference = pollReference(editFirstId);
    await page.goto(`/${editFirstReference}`);
    const staleSubmission =
      (await page.locator('input[name="submission_id"]').getAttribute("value")) ??
      "";
    const staleOption =
      (await page.getByRole("radio", { name: "Old B" }).getAttribute("value")) ??
      "";
    assertUuid(staleSubmission);
    assertUuid(staleOption);
    await page.goto(`/creator/polls/${editFirstId}`);
    await page.getByLabel("QUESTION").fill("Edited first");
    await page.getByRole("textbox", { name: "OPTION 1" }).fill("New A");
    await page.getByRole("textbox", { name: "OPTION 2" }).fill("New B");
    await page.getByRole("button", { name: "SAVE CHANGES" }).click();
    allowExpectedResourceStatus(page, 422);
    const stale = await page.request.post(`/${editFirstReference}`, {
      form: { submission_id: staleSubmission, option_id: staleOption },
      headers: formHeaders(baseURL),
      maxRedirects: 0,
    });
    expect(stale.status()).toBe(422);
    const staleHtml = await stale.text();
    // This deterministic edit-before-POST ordering fails validation against
    // the current snapshot. The narrower edit-between-validation-and-batch
    // serialization is proven in workerd/D1 integration tests and maps to
    // poll_definition_changed; both recover with the current option set.
    expect(staleHtml).toContain("That ballot does not match this Poll.");
    expect(staleHtml).toContain("New A");
    expect(staleHtml).not.toContain('value="Old B" checked');
    expect(voteCount(editFirstId)).toBe(0);

    // Vote wins: submit from the already-rendered edit page after arranging
    // the accepted Vote. D1 leaves every rejected definition field unchanged.
    const voteFirstId = await publishPoll(page, "Vote wins?", "Keep A", "Keep B");
    await page.getByLabel("QUESTION").fill("Rejected question");
    await page.getByRole("textbox", { name: "OPTION 1" }).fill("Rejected A");
    insertAcceptedVote(voteFirstId);
    const [lockedResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().includes(`/creator/polls/${voteFirstId}`),
      ),
      page.getByRole("button", { name: "SAVE CHANGES" }).click(),
    ]);
    expect(lockedResponse.status()).toBe(422);
    await expect(page.locator("[data-definition-locked]")).toBeVisible();
    await expect(page.locator("[data-locked-question]")).toHaveText("Vote wins?");
    await expect(page.getByText("Keep A")).toBeVisible();
    await expect(page.getByText("Rejected question")).toHaveCount(0);
    expect(
      d1Query(
        sql`SELECT question, representation_version FROM poll WHERE id = ${voteFirstId};`,
      ),
    ).toEqual([{ question: "Vote wins?", representation_version: 1 }]);
  });

  test("closes an open Poll and rejects a late Vote", async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, baseURL);
    const pollId = await publishPoll(page, "Close me poll");
    const reference = pollReference(pollId);
    expect(reference).toBeTruthy();

    // Capture a stale public ballot before the Creator closes the Poll.
    await page.goto(`/${reference}`);
    const submissionId =
      (await page.locator('input[name="submission_id"]').getAttribute("value")) ??
      "";
    const optionId =
      (await page.getByRole("radio", { name: "B" }).getAttribute("value")) ?? "";
    assertUuid(submissionId);
    assertUuid(optionId);

    await page.goto(`/creator/polls/${pollId}`);
    await page.getByRole("button", { name: "CLOSE POLL" }).click();
    await expect(page).toHaveURL(
      new RegExp(`/creator/polls/${pollId}\\?outcome=poll-closed`),
    );
    await expect(page.locator("[data-outcome='poll-closed']")).toHaveText(
      "Poll closed.",
    );
    await expect(page.getByRole("button", { name: "CLOSE POLL" })).toHaveCount(
      0,
    );

    await page
      .getByLabel("DESCRIPTION (OPTIONAL)")
      .fill("Description remains editable after close");
    await page.getByRole("button", { name: "SAVE CHANGES" }).click();
    await expect(page).toHaveURL(
      new RegExp(`/creator/polls/${pollId}\\?outcome=description-updated`),
    );
    expect(
      d1Query(sql`SELECT description FROM poll WHERE id = ${pollId};`),
    ).toEqual([{ description: "Description remains editable after close" }]);

    // The already-rendered ballot is rejected too; UI affordance removal is
    // not the authority. Accepted rows remain unchanged.
    const before = voteCount(pollId);
    const late = await page.request.post(`/${reference}`, {
      form: { submission_id: submissionId, option_id: optionId },
      headers: formHeaders(baseURL),
      maxRedirects: 0,
    });
    expect(late.status()).toBe(422);
    const lateHtml = await late.text();
    expect(lateHtml).toContain("This Poll closed while you were deciding");
    expect(lateHtml).toContain("Your Vote wasn&#39;t recorded.");
    expect(voteCount(pollId)).toBe(before);

    await page.goto(`/${reference}`);
    await expect(page.getByText(/This Poll closed/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /VOTE|COUNT ME/i })).toHaveCount(0);
  });

  test("derives Deadline closure, preserves visibility privacy, and conceals foreign detail", async ({
    page,
    context,
    browser,
    baseURL,
  }) => {
    await signIn(context, baseURL);
    const pollId = await publishPoll(page, "Deadline visibility poll");
    const reference = pollReference(pollId);
    const future = Date.now() + 60_000;
    d1Execute(
      sql`UPDATE poll SET result_visibility = 'after_close', deadline_ms = ${future} WHERE id = ${pollId};`,
    );

    const anonymous = await browser.newContext();
    const anonymousPage = watchConsole(await anonymous.newPage());
    await anonymousPage.goto(`/${reference}/results`);
    await expect(anonymousPage.locator("[data-results-tally]")).toHaveCount(0);

    d1Execute(
      sql`UPDATE poll SET deadline_ms = ${Date.now() - 1} WHERE id = ${pollId};`,
    );
    await anonymousPage.reload();
    await expect(anonymousPage.locator("[data-results-tally]")).toBeVisible();
    await anonymousPage.goto(`/${reference}`);
    await expect(anonymousPage.getByText(/This Poll closed/i)).toBeVisible();
    await expect(
      anonymousPage.getByRole("button", { name: /VOTE|COUNT ME/i }),
    ).toHaveCount(0);

    d1Execute(
      sql`UPDATE poll SET result_visibility = 'creator_only' WHERE id = ${pollId};`,
    );
    await anonymousPage.goto(`/${reference}/results`);
    await expect(anonymousPage.locator("[data-results-tally]")).toHaveCount(0);
    await page.goto(`/${reference}/results`);
    await expect(page.locator("[data-results-tally]")).toBeVisible();

    const foreign = await seedCreatorSession();
    seededUserIds.push(foreign.userId);
    const foreignContext = await browser.newContext();
    await foreignContext.addCookies([
      {
        name: "better-auth.session_token",
        value: foreign.cookieValue,
        url: requireBaseUrl(baseURL),
      },
    ]);
    const foreignPage = watchConsole(await foreignContext.newPage());
    allowExpectedDocument404(
      foreignPage,
      new URL(`/creator/polls/${pollId}`, requireBaseUrl(baseURL)).href,
    );
    const response = await foreignPage.goto(`/creator/polls/${pollId}`);
    expect(response?.status()).toBe(404);
    await expect(foreignPage.getByText("Deadline visibility poll")).toHaveCount(0);
    await foreignContext.close();
    await anonymous.close();
  });

  test("delete confirmation overlay and hard delete 404 the public link", async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, baseURL);
    const hostileQuestion = '<img src=x onerror="alert(1)"> "hostile" poll';
    const pollId = await publishPoll(page, hostileQuestion);
    const reference = pollReference(pollId);
    expect(reference).toBeTruthy();
    insertAcceptedVote(pollId);
    insertAcceptedVote(pollId);

    // Server-open enhanced path adopts the real invoker. Every dismissal
    // restores focus, scrolling, and the canonical URL.
    await page.goto(`/creator/polls/${pollId}?confirm=delete`);
    const overlay = page.locator("#delete-poll-overlay");
    await expect(overlay).toBeVisible();
    await expect(overlay.locator("[data-overlay-cancel]")).toBeFocused();
    await expect(overlay).toContainText(`Delete "${hostileQuestion}"?`);
    await expect(overlay.locator("img")).toHaveCount(0);
    await expect(overlay).toContainText(
      "This removes the Poll and all 2 Votes in it. The link stops resolving. There is no undo.",
    );
    expect(await page.locator("body").evaluate((body) => body.style.overflow)).toBe(
      "hidden",
    );
    await page.keyboard.press("Escape");
    await expect(overlay).toBeHidden();
    await expect(page.locator("#delete-poll-invoker")).toBeFocused();
    await expect(page).toHaveURL(new RegExp(`/creator/polls/${pollId}$`));
    expect(await page.locator("body").evaluate((body) => body.style.overflow)).toBe(
      "",
    );

    // Hidden/inert means absent from the accessibility tree before open.
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Keyboard open, initial safe focus, and bidirectional containment.
    const invoker = page.getByRole("link", { name: "DELETE POLL" });
    await invoker.focus();
    await page.keyboard.press("Enter");
    await expect(overlay).toBeVisible();
    await expect(overlay.locator("[data-overlay-cancel]")).toBeFocused();
    await expect(invoker).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Shift+Tab");
    await expect(
      overlay.getByRole("button", { name: "DELETE POLL" }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(overlay.locator("[data-overlay-cancel]")).toBeFocused();

    // A panel click is inert; a scrim click dismisses and restores focus.
    await overlay.locator("[data-overlay-panel]").click({ position: { x: 5, y: 5 } });
    await expect(overlay).toBeVisible();
    await page.mouse.click(5, 5);
    await expect(overlay).toBeHidden();
    await expect(invoker).toBeFocused();
    await expect(invoker).toHaveAttribute("aria-expanded", "false");

    // Enhanced Cancel is another close path with focus return.
    await invoker.press("Enter");
    await page.getByRole("link", { name: "CANCEL" }).click();
    await expect(overlay).toBeHidden();
    await expect(invoker).toBeFocused();

    // Confirm delete via the destructive action inside the overlay.
    await invoker.press("Enter");
    await expect(overlay).toBeVisible();
    await overlay.getByRole("button", { name: "DELETE POLL" }).click();
    await expect(page).toHaveURL(/\/creator\?outcome=poll-deleted/);
    const outcome = page.locator("[data-outcome='poll-deleted']");
    await expect(outcome).toHaveText("Poll deleted.");
    await expect(outcome).toBeFocused();
    await expect(page).toHaveTitle("Poll deleted — Oddspark Polls");
    await expect(page.getByText(hostileQuestion)).toHaveCount(0);
    expect(voteCount(pollId)).toBe(0);

    for (const suffix of ["", "/results", "/results/live", "/manifest"]) {
      const response = await page.request.get(`/${reference}${suffix}`, {
        maxRedirects: 0,
      });
      expect(response.status()).toBe(404);
      expect(response.headers()["etag"]).toBeUndefined();
      expect(response.headers()["last-modified"]).toBeUndefined();
      const missingBody = await response.text();
      // Astro's dev 404 document includes component CSS class names such as
      // `results-tally`; assert against serialized data signals and the Poll's
      // actual content instead of stylesheet vocabulary.
      expect(missingBody).not.toContain(hostileQuestion);
      expect(missingBody).not.toMatch(
        /"(?:tally|representation_version|representationVersion)"\s*:/u,
      );
    }
  });

  test("reclaims a custom link after delete", async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, baseURL);
    const slug = `life-${randomUUID().slice(0, 8)}`;
    await page.goto("/creator/new");
    await page.getByLabel("QUESTION").fill("Custom reclaim poll");
    await page.getByRole("textbox", { name: "OPTION 1" }).fill("A");
    await page.getByRole("textbox", { name: "OPTION 2" }).fill("B");
    await page.getByLabel("CUSTOM LINK (OPTIONAL)").fill(slug);
    await page.getByRole("button", { name: "PUBLISH POLL" }).click();
    await expect(page).toHaveURL(/\/creator\/polls\//);
    const match = /\/creator\/polls\/([^?]+)/.exec(page.url());
    const pollId = match?.[1];
    assertUuid(pollId);

    await page
      .getByRole("link", { name: "DELETE POLL", exact: true })
      .click();
    await page
      .locator("#delete-poll-overlay")
      .getByRole("button", { name: "DELETE POLL" })
      .click();
    await expect(page).toHaveURL(/outcome=poll-deleted/);

    await page.goto("/creator/new");
    await page.getByLabel("QUESTION").fill("Replacement poll");
    await page.getByRole("textbox", { name: "OPTION 1" }).fill("A");
    await page.getByRole("textbox", { name: "OPTION 2" }).fill("B");
    await page.getByLabel("CUSTOM LINK (OPTIONAL)").fill(slug);
    await page.getByRole("button", { name: "PUBLISH POLL" }).click();
    await expect(page).toHaveURL(/\/creator\/polls\//);

    await page.goto(`/${slug}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Replacement poll",
    );
  });

  test("captures the required lifecycle proof at 375px dark and 1280px light", async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, baseURL);
    const pollId = await publishPoll(page, "Lifecycle visual proof", "Alpha", "Beta");
    insertAcceptedVote(pollId);
    await page.goto(`/creator/polls/${pollId}`);

    const capture = async (name) => {
      await page.emulateMedia({ colorScheme: "dark" });
      await page.setViewportSize({ width: 375, height: 812 });
      await page.screenshot({
        path: `${proofDir}/${name}-375-dark.png`,
        fullPage: true,
      });
      await page.emulateMedia({ colorScheme: "light" });
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.screenshot({
        path: `${proofDir}/${name}-1280-light.png`,
        fullPage: true,
      });
    };

    await expect(page.locator("[data-definition-locked]")).toBeVisible();
    await capture("locked-edit");

    await page
      .getByRole("link", { name: "DELETE POLL", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await capture("delete-overlay");
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "CLOSE POLL" }).click();
    await expect(page.locator("[data-detail-status]")).toContainText("CLOSED");
    await capture("closed-detail");

    await page.getByRole("link", { name: "DELETE POLL" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "DELETE POLL" })
      .click();
    await expect(page.locator("[data-outcome='poll-deleted']")).toBeFocused();
    await capture("post-delete-dashboard");
  });

  test("no-JS delete confirmation floor works without the enhancer", async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    // Console watch not required without JS; still seed auth.
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
    await page.getByLabel("QUESTION").fill("No-JS delete poll");
    await page.getByRole("textbox", { name: "OPTION 1" }).fill("A");
    await page.getByRole("textbox", { name: "OPTION 2" }).fill("B");
    await page.getByRole("button", { name: "PUBLISH POLL" }).click();
    await expect(page).toHaveURL(/\/creator\/polls\//);
    const match = /\/creator\/polls\/([^?]+)/.exec(page.url());
    const pollId = match?.[1];
    assertUuid(pollId);

    await expect(page.locator("[data-option-row]")).toHaveCount(2);
    await page.getByRole("button", { name: "ADD OPTION" }).click();
    await expect(page).toHaveURL(new RegExp(`/creator/polls/${pollId}$`));
    await expect(page.locator("[data-option-row]")).toHaveCount(3);
    await expect(page.getByLabel("QUESTION")).toHaveValue("No-JS delete poll");

    await page
      .getByRole("link", { name: "DELETE POLL", exact: true })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/creator/polls/${pollId}\\?confirm=delete$`),
    );
    await expect(page.locator("#delete-poll-overlay")).toBeVisible();
    await page.getByRole("link", { name: "CANCEL" }).click();
    await expect(page).toHaveURL(new RegExp(`/creator/polls/${pollId}$`));
    await expect(page.locator("#delete-poll-overlay")).toBeHidden();

    await page
      .getByRole("link", { name: "DELETE POLL", exact: true })
      .click();
    await page
      .locator("#delete-poll-overlay")
      .getByRole("button", { name: "DELETE POLL" })
      .click();
    await expect(page).toHaveURL(/\/creator\?outcome=poll-deleted/);
    await context.close();
  });
});
