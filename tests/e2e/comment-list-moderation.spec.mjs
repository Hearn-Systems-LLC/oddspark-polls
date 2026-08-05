import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  assertUuid,
  cleanupCreator,
  d1Execute,
  d1Query,
  hasBetterAuthSecret,
  requireBaseUrl,
  seedCreatorSession,
} from "./creator-session.mjs";

const PROOF_DIR = "test-results/story-4-2-comment-moderation-proof";
mkdirSync(PROOF_DIR, { recursive: true });

if (!hasBetterAuthSecret()) {
  throw new Error(
    "Story 4.2 E2E requires BETTER_AUTH_SECRET in .dev.vars; skipping Comment moderation proof is forbidden",
  );
}

test.describe.configure({ mode: "serial", timeout: 300_000 });

function sqlText(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

test("renders the complete list, preserves no-JS moderation, deletes as Administrator and owner, and refreshes a stale live tab", async ({ browser, baseURL }) => {
  const origin = requireBaseUrl(baseURL);
  const owner = await seedCreatorSession();
  const administrator = await seedCreatorSession("administrator");
  const pollId = randomUUID();
  const optionIds = [randomUUID(), randomUUID()];
  const seededCommentIds = [randomUUID(), randomUUID()];
  const reference = `comments-${randomUUID().slice(0, 8)}`;
  const observed = [];
  const contexts = [];
  const hiddenScenarios = ["after_close", "creator_only"].map((visibility) => ({
    visibility,
    pollId: randomUUID(),
    voteId: randomUUID(),
    commentId: randomUUID(),
    reference: `comments-hidden-${visibility}-${randomUUID().slice(0, 8)}`,
    sentinel: `HIDDEN COMMENT ${visibility}`,
  }));

  const observe = (page, label) => {
    const state = { label, console: [], page: [], requests: [] };
    observed.push(state);
    page.on("console", (message) => {
      if (message.type() === "error") state.console.push(message.text());
    });
    page.on("pageerror", (error) => state.page.push(error.message));
    page.on("requestfailed", (request) => {
      if (request.failure()?.errorText !== "net::ERR_ABORTED") {
        state.requests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText}`);
      }
    });
    return page;
  };

  const sessionContext = async (seeded, javaScriptEnabled = true) => {
    const context = await browser.newContext({ baseURL: origin, javaScriptEnabled });
    contexts.push(context);
    await context.addCookies([{
      name: "better-auth.session_token",
      value: seeded.cookieValue,
      url: origin,
    }]);
    return context;
  };

  const captureMatrix = async (page, label) => {
    for (const width of [375, 1280]) {
      for (const colorScheme of ["light", "dark"]) {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme });
        await page.evaluate(() => document.fonts.ready);
        const overflow = await page.evaluate(() => ({
          body: document.body.scrollWidth - document.body.clientWidth,
          root: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        }));
        expect(overflow.body).toBeLessThanOrEqual(0);
        expect(overflow.root).toBeLessThanOrEqual(0);
        await page.screenshot({
          path: `${PROOF_DIR}/${label}-${width}-${colorScheme}.png`,
          fullPage: true,
        });
      }
    }
  };

  try {
    assertUuid(owner.userId);
    assertUuid(administrator.userId);
    const seededVotes = seededCommentIds.map(() => randomUUID());
    d1Execute([
      `INSERT INTO poll (id, owner_user_id, poll_type, question, result_visibility, comments_enabled, representation_version, created_at_ms, updated_at_ms) VALUES ('${pollId}', '${owner.userId}', 'multiple_choice', 'Which context matters?', 'live', 1, 1, 0, 0);`,
      `INSERT INTO poll_option (id, poll_id, label, position, created_at_ms) VALUES ('${optionIds[0]}', '${pollId}', 'Alpha', 0, 0);`,
      `INSERT INTO poll_option (id, poll_id, label, position, created_at_ms) VALUES ('${optionIds[1]}', '${pollId}', 'Beta', 1, 0);`,
      `INSERT INTO poll_reference (reference, poll_id, kind, is_canonical, created_at_ms) VALUES (${sqlText(reference)}, '${pollId}', 'custom', 1, 0);`,
      `INSERT INTO vote (id, poll_id, submission_id, payload_hash, created_at_ms) VALUES ('${seededVotes[0]}', '${pollId}', '${randomUUID()}', 'hash-old', 100);`,
      `INSERT INTO vote_selection (vote_id, poll_option_id) VALUES ('${seededVotes[0]}', '${optionIds[0]}');`,
      `INSERT INTO vote_comment (id, vote_id, body, display_name, created_at_ms) VALUES ('${seededCommentIds[0]}', '${seededVotes[0]}', ${sqlText("Older <script>alert('comment')</script> & context")}, NULL, 100);`,
      `INSERT INTO vote (id, poll_id, submission_id, payload_hash, created_at_ms) VALUES ('${seededVotes[1]}', '${pollId}', '${randomUUID()}', 'hash-new', 200);`,
      `INSERT INTO vote_selection (vote_id, poll_option_id) VALUES ('${seededVotes[1]}', '${optionIds[1]}');`,
      `INSERT INTO vote_comment (id, vote_id, body, display_name, created_at_ms) VALUES ('${seededCommentIds[1]}', '${seededVotes[1]}', 'Newer context', 'Named Reader', 200);`,
      ...hiddenScenarios.flatMap((scenario) => [
        `INSERT INTO poll (id, owner_user_id, poll_type, question, result_visibility, comments_enabled, representation_version, deadline_ms, created_at_ms, updated_at_ms) VALUES ('${scenario.pollId}', '${owner.userId}', 'multiple_choice', 'Hidden Comments?', '${scenario.visibility}', 1, 1, ${scenario.visibility === "after_close" ? Date.now() + 600_000 : "NULL"}, 0, 0);`,
        `INSERT INTO poll_reference (reference, poll_id, kind, is_canonical, created_at_ms) VALUES (${sqlText(scenario.reference)}, '${scenario.pollId}', 'custom', 1, 0);`,
        `INSERT INTO vote (id, poll_id, submission_id, payload_hash, created_at_ms) VALUES ('${scenario.voteId}', '${scenario.pollId}', '${randomUUID()}', 'hidden-hash-${scenario.visibility}', 300);`,
        `INSERT INTO vote_comment (id, vote_id, body, display_name, created_at_ms) VALUES ('${scenario.commentId}', '${scenario.voteId}', ${sqlText(scenario.sentinel)}, NULL, 300);`,
      ]),
    ].join(""));

    const voterContext = await browser.newContext({ baseURL: origin });
    contexts.push(voterContext);
    for (const scenario of hiddenScenarios) {
      const hiddenPage = observe(
        await voterContext.newPage(),
        `${scenario.visibility} hidden Results`,
      );
      await hiddenPage.goto(`/${scenario.reference}/results`);
      await expect(hiddenPage.locator("[data-comment-item]")).toHaveCount(0);
      expect(await hiddenPage.content()).not.toContain(scenario.sentinel);
      expect(await hiddenPage.content()).not.toContain(scenario.commentId);
      const hiddenLive = await hiddenPage.request.get(
        `/${scenario.reference}/results/live`,
      );
      expect(hiddenLive.status()).toBe(204);
      expect(await hiddenLive.text()).toBe("");
      expect(hiddenLive.headers().etag).toBeUndefined();
      await hiddenPage.close();
    }
    const voterPage = observe(await voterContext.newPage(), "post-vote live tab");
    await voterPage.goto(`/${reference}`);
    await voterPage.locator("label.poll-option", { hasText: "Alpha" }).click();
    await expect(voterPage.getByRole("radio", { name: "Alpha" })).toBeChecked();
    await expect(voterPage.getByRole("button", { name: "VOTE" })).toBeEnabled();
    await voterPage.getByRole("textbox", { name: "COMMENT" }).fill("Newest from the voting surface");
    await voterPage.getByRole("textbox", { name: "DISPLAY NAME (OPTIONAL)" }).fill("Live Voter");
    await voterPage.getByRole("button", { name: "VOTE" }).click();
    await expect(voterPage.locator("[data-post-vote='true'] [data-comment-list]")).toBeVisible();
    const voterItems = voterPage.locator("[data-comment-item]");
    await expect(voterItems).toHaveCount(3);
    await expect(voterItems.first()).toContainText("Newest from the voting surface");
    await expect(voterItems.nth(1)).toContainText("Newer context");
    await expect(voterItems.nth(2)).toContainText("Older <script>alert('comment')</script> & context");
    await expect(voterItems.nth(2)).toContainText("ANONYMOUS");
    await expect(voterPage.getByRole("button", { name: "DELETE COMMENT" })).toHaveCount(0);
    const publicHtml = await voterPage.content();
    for (const id of seededCommentIds) expect(publicHtml).not.toContain(id);
    expect(publicHtml).not.toContain("<script>alert('comment')</script>");

    const ownerContext = await sessionContext(owner);
    const ownerPage = observe(await ownerContext.newPage(), "owner Results");
    await ownerPage.goto(`/${reference}/results`);
    await expect(ownerPage.locator("[data-comment-item]")).toHaveCount(3);
    const ownerDelete = ownerPage.getByRole("link", { name: "DELETE COMMENT 1 OF 3" });
    await ownerDelete.focus();
    await ownerDelete.press("Enter");
    const ownerDialog = ownerPage.getByRole("dialog", { name: "DELETE THIS COMMENT?" });
    await expect(ownerDialog).toBeVisible();
    await expect(ownerDialog.getByRole("link", { name: "CANCEL" })).toBeFocused();
    await ownerPage.keyboard.press("Escape");
    await expect(ownerDialog).toBeHidden();
    await expect(ownerDelete).toBeFocused();
    await captureMatrix(ownerPage, "owner-results");

    const noJsContext = await sessionContext(owner, false);
    const noJsPage = await noJsContext.newPage();
    await noJsPage.goto(`/${reference}/results`);
    await expect(noJsPage.locator("[data-comment-delete-nojs]")).toHaveCount(3);
    await expect(noJsPage.locator(".comment-delete-invoker")).toHaveCount(3);
    await expect(noJsPage.locator(".comment-delete-invoker").first()).toBeHidden();
    await noJsPage.locator("[data-comment-delete-nojs] summary").first().click();
    const noJsDelete = noJsPage.locator("[data-comment-delete-nojs]").first()
      .getByRole("button", { name: "DELETE COMMENT 1 OF 3" });
    await expect(noJsDelete).toBeVisible();
    await noJsDelete.click();
    await expect(noJsPage).toHaveURL(`/${reference}/results`);
    await expect(noJsPage.locator("[data-comment-item]")).toHaveCount(2);
    expect(d1Query(`SELECT representation_version FROM poll WHERE id = '${pollId}'`)).toEqual([{ representation_version: 3 }]);

    const adminContext = await sessionContext(administrator);
    const adminPage = observe(await adminContext.newPage(), "Administrator desk");
    await adminPage.goto(`/creator/moderation?target=${reference}`);
    await expect(adminPage.locator("[data-moderation-target] [data-comment-item]")).toHaveCount(2);
    await expect(adminPage.locator("[data-moderation-target]")).not.toContainText("VOTERS");
    await captureMatrix(adminPage, "administrator-desk");
    await adminPage.getByRole("link", { name: "DELETE COMMENT 1 OF 2" }).click();
    await adminPage.getByRole("dialog", { name: "DELETE THIS COMMENT?" }).getByRole("button", { name: "DELETE COMMENT 1 OF 2" }).click();
    await expect(adminPage).toHaveURL(new RegExp(`/creator/moderation\\?target=${reference}$`, "u"));
    await expect(adminPage.locator("[data-comment-item]")).toHaveCount(1);

    // The already-open voting tab receives the complete public Comment list
    // without IDs; a changed snapshot triggers the bounded whole-page reload.
    await expect(voterPage.locator("[data-comment-item]")).toHaveCount(1, { timeout: 12_000 });

    await ownerPage.reload();
    await ownerPage.getByRole("link", { name: "DELETE COMMENT 1 OF 1" }).click();
    await ownerPage.getByRole("dialog", { name: "DELETE THIS COMMENT?" }).getByRole("button", { name: "DELETE COMMENT 1 OF 1" }).click();
    await expect(ownerPage).toHaveURL(`/${reference}/results`);
    await expect(ownerPage.locator("[data-comment-item]")).toHaveCount(0);

    expect(d1Query(`SELECT representation_version FROM poll WHERE id = '${pollId}'`)).toEqual([{ representation_version: 5 }]);
    expect(d1Query(`SELECT COUNT(*) AS comments FROM vote_comment vc JOIN vote v ON v.id = vc.vote_id WHERE v.poll_id = '${pollId}'`)).toEqual([{ comments: 0 }]);
    expect(d1Query(`SELECT COUNT(*) AS votes FROM vote WHERE poll_id = '${pollId}'`)).toEqual([{ votes: 3 }]);
  } finally {
    for (const context of contexts) {
      if (context.pages().length > 0) await context.close();
    }
    cleanupCreator(owner.userId);
    cleanupCreator(administrator.userId);
    for (const state of observed) {
      expect(state.console, `${state.label} console`).toEqual([]);
      expect(state.page, `${state.label} page errors`).toEqual([]);
      expect(state.requests, `${state.label} request failures`).toEqual([]);
    }
  }
});
