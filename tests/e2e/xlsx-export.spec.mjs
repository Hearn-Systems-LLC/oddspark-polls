import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { read, utils } from "xlsx";
import {
  assertUuid,
  cleanupCreator,
  d1Execute,
  hasBetterAuthSecret,
  requireBaseUrl,
  seedCreatorSession,
} from "./creator-session.mjs";

if (!hasBetterAuthSecret()) {
  throw new Error(
    "Story 4.4 E2E requires BETTER_AUTH_SECRET in .dev.vars; skipping XLSX browser proof is forbidden",
  );
}

test.describe.configure({ mode: "serial", timeout: 180_000 });

const OVERSIZE_MESSAGE =
  "XLSX export supports up to 1,000 accepted votes. Download CSV for larger Polls.";

function sqlText(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function seedPoll(ownerUserId, suffix, { rich = false } = {}) {
  assertUuid(ownerUserId);
  const pollId = randomUUID();
  const optionA = randomUUID();
  const optionB = randomUUID();
  const reference = `xlsx-${suffix}-${pollId.slice(0, 8)}`;
  for (const value of [pollId, optionA, optionB]) assertUuid(value);
  d1Execute(
    `INSERT INTO poll (id, owner_user_id, poll_type, question, result_visibility, comments_enabled, multi_select_enabled, min_selections, max_selections, representation_version, created_at_ms, updated_at_ms) VALUES ('${pollId}', '${ownerUserId}', 'multiple_choice', ${sqlText(`XLSX ${suffix}`)}, 'creator_only', 1, 1, 1, 2, 1, 0, 0);` +
      `INSERT INTO poll_option (id, poll_id, label, position, created_at_ms) VALUES ('${optionA}', '${pollId}', ${sqlText("Alpha, choice")}, 0, 0);` +
      `INSERT INTO poll_option (id, poll_id, label, position, created_at_ms) VALUES ('${optionB}', '${pollId}', ${sqlText('=Beta "formula"')}, 1, 0);` +
      `INSERT INTO poll_reference (reference, poll_id, kind, is_canonical, created_at_ms) VALUES (${sqlText(reference)}, '${pollId}', 'custom', 1, 0);`,
  );
  if (rich) {
    const voteLate = randomUUID();
    const voteEarly = randomUUID();
    const commentId = randomUUID();
    for (const value of [voteLate, voteEarly, commentId]) assertUuid(value);
    d1Execute(
      `INSERT INTO vote (id, poll_id, submission_id, payload_hash, created_at_ms) VALUES ('${voteLate}', '${pollId}', '${randomUUID()}', 'xlsx-private-late', 1800000000001);` +
        `INSERT INTO vote_selection (vote_id, poll_option_id) VALUES ('${voteLate}', '${optionA}');` +
        `INSERT INTO vote (id, poll_id, submission_id, payload_hash, created_at_ms) VALUES ('${voteEarly}', '${pollId}', '${randomUUID()}', 'xlsx-private-early', 1800000000000);` +
        `INSERT INTO vote_selection (vote_id, poll_option_id) VALUES ('${voteEarly}', '${optionB}');` +
        `INSERT INTO vote_selection (vote_id, poll_option_id) VALUES ('${voteEarly}', '${optionA}');` +
        `INSERT INTO vote_comment (id, vote_id, body, display_name, created_at_ms) VALUES ('${commentId}', '${voteEarly}', ${sqlText('=First line, "quoted" _x000A_\nsecond line')}, ${sqlText("Zoë")}, 1800000000000);`,
    );
  }
  return { pollId, reference };
}

function seedOversize(pollId) {
  assertUuid(pollId);
  d1Execute(
    `WITH RECURSIVE indexes(value) AS (` +
      `SELECT 1 UNION ALL SELECT value + 1 FROM indexes WHERE value < 1001` +
      `) INSERT INTO vote (id, poll_id, submission_id, payload_hash, created_at_ms) ` +
      `SELECT printf('e2e-xlsx-vote-%04d', value), '${pollId}', ` +
      `printf('e2e-xlsx-submission-%04d', value), ` +
      `printf('e2e-xlsx-private-%04d', value), 1800000000000 + value FROM indexes;` +
      `INSERT INTO vote_selection (vote_id, poll_option_id) ` +
      `SELECT v.id, o.id FROM vote v JOIN poll_option o ON o.poll_id = v.poll_id ` +
      `WHERE v.poll_id = '${pollId}' AND o.position = 0;`,
  );
}

function sheetRows(workbook, name) {
  return utils.sheet_to_json(workbook.Sheets[name], {
    header: 1,
    raw: true,
    defval: "",
  });
}

async function expectExportControlLayout(page) {
  const csvLink = page.getByRole("link", { name: "EXPORT CSV" });
  const xlsxLink = page.getByRole("link", { name: "EXPORT XLSX" });
  await expect(csvLink).toBeVisible();
  await expect(xlsxLink).toBeVisible();
  const [csvBox, xlsxBox] = await Promise.all([
    csvLink.boundingBox(),
    xlsxLink.boundingBox(),
  ]);
  expect(csvBox?.height).toBeGreaterThanOrEqual(48);
  expect(xlsxBox?.height).toBeGreaterThanOrEqual(48);
  expect(Math.abs((csvBox?.y ?? 0) - (xlsxBox?.y ?? 1))).toBeLessThan(2);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}

test.describe("creator XLSX export", () => {
  const users = [];
  let errors = [];
  let expectedConflicts = [];
  let allowExpectedConflict = false;

  test.beforeEach(({ page }) => {
    errors = [];
    expectedConflicts = [];
    allowExpectedConflict = false;
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      if (
        allowExpectedConflict &&
        message.text() ===
          "Failed to load resource: the server responded with a status of 409 (Conflict)"
      ) {
        expectedConflicts.push(message.text());
        return;
      }
      errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
  });

  test.afterEach(() => {
    expect(errors).toEqual([]);
  });

  test.afterAll(() => {
    for (const userId of users) cleanupCreator(userId);
  });

  async function signIn(context, baseURL) {
    const seeded = await seedCreatorSession();
    users.push(seeded.userId);
    await context.addCookies([
      {
        name: "better-auth.session_token",
        value: seeded.cookieValue,
        url: requireBaseUrl(baseURL),
      },
    ]);
    return seeded;
  }

  test("downloads rich and empty workbooks directly in adjacent keyboard order", async ({
    page,
    context,
    baseURL,
  }, testInfo) => {
    const owner = await signIn(context, baseURL);
    const rich = seedPoll(owner.userId, "rich", { rich: true });
    const empty = seedPoll(owner.userId, "empty");

    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/creator/polls/${rich.pollId}`);
    const csvLink = page.getByRole("link", { name: "EXPORT CSV" });
    const xlsxLink = page.getByRole("link", { name: "EXPORT XLSX" });
    await expectExportControlLayout(page);
    await expect(xlsxLink).toHaveAttribute(
      "href",
      `/creator/polls/${rich.pollId}/export.xlsx`,
    );
    expect(
      await page
        .locator(".export-link-row a")
        .evaluateAll((elements) =>
          elements.map((element) => element.textContent?.trim()),
        ),
    ).toEqual(["EXPORT CSV", "EXPORT XLSX"]);
    await csvLink.focus();
    await page.keyboard.press("Tab");
    await expect(xlsxLink).toBeFocused();
    await page.screenshot({
      path: testInfo.outputPath("export-controls-1280-light.png"),
      fullPage: true,
      mask: [page.locator("[data-share-url-text]")],
    });
    await page.emulateMedia({ colorScheme: "dark" });
    await expectExportControlLayout(page);

    const beforeUrl = page.url();
    const downloadPromise = page.waitForEvent("download");
    await page.keyboard.press("Enter");
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(`oddspark-${rich.reference}.xlsx`);
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
    const workbook = read(await readFile(downloadPath), {
      type: "buffer",
      cellFormula: true,
    });
    expect(workbook.SheetNames).toEqual(["VOTES", "TALLY", "SUMMARY"]);
    expect(sheetRows(workbook, "VOTES")).toEqual([
      ["TIMESTAMP", "DISPLAY NAME", "COMMENT", "SELECTION 1", "SELECTION 2"],
      [
        "2027-01-15T08:00:00.000Z",
        "Zoë",
        '=First line, "quoted" _x000A_\nsecond line',
        "Alpha, choice",
        '=Beta "formula"',
      ],
      ["2027-01-15T08:00:00.001Z", "", "", "Alpha, choice", ""],
    ]);
    expect(sheetRows(workbook, "TALLY")).toEqual([
      ["OPTION", "COUNT"],
      ["Alpha, choice", 2],
      ['=Beta "formula"', 1],
    ]);
    expect(sheetRows(workbook, "SUMMARY")).toEqual([
      ["METRIC", "VALUE"],
      ["VOTERS", 2],
      ["SELECTIONS", 3],
    ]);
    expect(workbook.Sheets.VOTES.C2).not.toHaveProperty("f");
    expect(JSON.stringify(workbook)).not.toContain("xlsx-private-");
    expect(page.url()).toBe(beforeUrl);
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page.emulateMedia({ colorScheme: "dark" });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/creator/polls/${empty.pollId}`);
    await expectExportControlLayout(page);
    await page.screenshot({
      path: testInfo.outputPath("export-controls-375-dark.png"),
      fullPage: true,
      mask: [page.locator("[data-share-url-text]")],
    });
    await page.emulateMedia({ colorScheme: "light" });
    await expectExportControlLayout(page);
    const emptyDownloadPromise = page.waitForEvent("download");
    await page.getByRole("link", { name: "EXPORT XLSX" }).click();
    const emptyDownload = await emptyDownloadPromise;
    const emptyPath = await emptyDownload.path();
    const emptyWorkbook = read(await readFile(emptyPath), { type: "buffer" });
    expect(sheetRows(emptyWorkbook, "VOTES")).toEqual([
      ["TIMESTAMP", "DISPLAY NAME", "COMMENT", "SELECTION 1", "SELECTION 2"],
    ]);
    expect(sheetRows(emptyWorkbook, "SUMMARY")).toEqual([
      ["METRIC", "VALUE"],
      ["VOTERS", 0],
      ["SELECTIONS", 0],
    ]);
  });

  test("returns the stable 409 while CSV remains available for 1,001 Votes", async ({
    page,
    context,
    baseURL,
  }) => {
    const owner = await signIn(context, baseURL);
    const oversized = seedPoll(owner.userId, "oversized");
    seedOversize(oversized.pollId);
    await page.goto(`/creator/polls/${oversized.pollId}`);
    const xlsxLink = page.getByRole("link", { name: "EXPORT XLSX" });
    await expect(xlsxLink).toHaveAttribute(
      "href",
      `/creator/polls/${oversized.pollId}/export.xlsx`,
    );

    allowExpectedConflict = true;
    const [xlsxResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().endsWith(`/creator/polls/${oversized.pollId}/export.xlsx`) &&
          response.request().isNavigationRequest(),
      ),
      xlsxLink.click(),
    ]);
    expect(xlsxResponse.status()).toBe(409);
    expect(xlsxResponse.headers()["content-disposition"]).toBeUndefined();
    expect(xlsxResponse.headers()["cache-control"]).toBe("private, no-store");
    await expect(page.locator("body")).toHaveText(OVERSIZE_MESSAGE);
    expect(page.url()).toContain(
      `/creator/polls/${oversized.pollId}/export.xlsx`,
    );
    expect(expectedConflicts).toEqual([
      "Failed to load resource: the server responded with a status of 409 (Conflict)",
    ]);

    const csvResponse = await page.request.get(
      `/creator/polls/${oversized.pollId}/export.csv`,
    );
    expect(csvResponse.status()).toBe(200);
    expect(csvResponse.headers()["content-disposition"]).toContain(".csv");
  });
});
