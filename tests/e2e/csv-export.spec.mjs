import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
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
    "Story 4.3 E2E requires BETTER_AUTH_SECRET in .dev.vars; skipping CSV browser proof is forbidden",
  );
}

const proofDir = "test-results/story-4-3-csv-export-proof";

test.describe.configure({ mode: "serial", timeout: 180_000 });

function sqlText(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function seedPoll(ownerUserId, suffix, { rich = false } = {}) {
  for (const value of [ownerUserId]) assertUuid(value);
  const pollId = randomUUID();
  const optionA = randomUUID();
  const optionB = randomUUID();
  const reference = `csv-${suffix}-${pollId.slice(0, 8)}`;
  for (const value of [pollId, optionA, optionB]) assertUuid(value);
  d1Execute(
    `INSERT INTO poll (id, owner_user_id, poll_type, question, result_visibility, comments_enabled, multi_select_enabled, min_selections, max_selections, representation_version, created_at_ms, updated_at_ms) VALUES ('${pollId}', '${ownerUserId}', 'multiple_choice', ${sqlText(`CSV ${suffix}`)}, 'creator_only', 1, 1, 1, 2, 1, 0, 0);` +
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
      `INSERT INTO vote (id, poll_id, submission_id, payload_hash, created_at_ms) VALUES ('${voteLate}', '${pollId}', '${randomUUID()}', 'e2e-private-late', 1800000000001);` +
        `INSERT INTO vote_selection (vote_id, poll_option_id) VALUES ('${voteLate}', '${optionA}');` +
        `INSERT INTO vote (id, poll_id, submission_id, payload_hash, created_at_ms) VALUES ('${voteEarly}', '${pollId}', '${randomUUID()}', 'e2e-private-early', 1800000000000);` +
        `INSERT INTO vote_selection (vote_id, poll_option_id) VALUES ('${voteEarly}', '${optionB}');` +
        `INSERT INTO vote_selection (vote_id, poll_option_id) VALUES ('${voteEarly}', '${optionA}');` +
        `INSERT INTO vote_comment (id, vote_id, body, display_name, created_at_ms) VALUES ('${commentId}', '${voteEarly}', ${sqlText('=First line, "quoted"\nsecond line')}, ${sqlText("Zoë")}, 1800000000000);`,
    );
  }
  return { pollId, reference };
}

test.describe("creator CSV export", () => {
  const users = [];
  let errors = [];

  test.beforeEach(({ page }) => {
    errors = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
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

  test("downloads rich and empty snapshots directly, by keyboard, with no dialog or navigation", async ({
    page,
    context,
    baseURL,
  }, testInfo) => {
    const committedProofs = [
      `${proofDir}/export-control-1280-light.png`,
      `${proofDir}/export-control-375-dark.png`,
    ];
    const proofBefore = await Promise.all(committedProofs.map((path) => readFile(path)));
    const owner = await signIn(context, baseURL);
    const rich = seedPoll(owner.userId, "rich", { rich: true });
    const empty = seedPoll(owner.userId, "empty");

    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/creator/polls/${rich.pollId}`);
    const exportLink = page.getByRole("link", { name: "EXPORT CSV" });
    await expect(exportLink).toBeVisible();
    await expect(exportLink).toHaveAttribute(
      "href",
      `/creator/polls/${rich.pollId}/export.csv`,
    );
    await page.screenshot({
      path: testInfo.outputPath("export-control-1280-light.png"),
      fullPage: true,
      mask: [page.locator("[data-share-url-text]")],
    });

    const beforeUrl = page.url();
    await exportLink.focus();
    await expect(exportLink).toBeFocused();
    const downloadPromise = page.waitForEvent("download");
    await page.keyboard.press("Enter");
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(`oddspark-${rich.reference}.csv`);
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
    const csv = await readFile(downloadPath, "utf8");
    expect(csv).toContain('"VOTES"\r\n');
    expect(csv).toContain('"2027-01-15T08:00:00.000Z","Zoë","\'=First line, ""quoted""\nsecond line","Alpha, choice","\'=Beta ""formula"""');
    expect(csv.indexOf("2027-01-15T08:00:00.000Z")).toBeLessThan(
      csv.indexOf("2027-01-15T08:00:00.001Z"),
    );
    expect(csv).toContain('"Alpha, choice","2"');
    expect(csv).toContain('"\'=Beta ""formula""","1"');
    expect(csv).toContain('"VOTERS","2"');
    expect(csv).toContain('"SELECTIONS","3"');
    expect(csv).not.toContain("e2e-private-");
    expect(page.url()).toBe(beforeUrl);
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page.emulateMedia({ colorScheme: "dark" });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/creator/polls/${empty.pollId}`);
    await expect(page.getByRole("link", { name: "EXPORT CSV" })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("export-control-375-dark.png"),
      fullPage: true,
      mask: [page.locator("[data-share-url-text]")],
    });
    const emptyDownloadPromise = page.waitForEvent("download");
    await page.getByRole("link", { name: "EXPORT CSV" }).click();
    const emptyDownload = await emptyDownloadPromise;
    const emptyPath = await emptyDownload.path();
    const emptyCsv = await readFile(emptyPath, "utf8");
    expect(emptyCsv).toContain('"VOTES"\r\n"TIMESTAMP"');
    expect(emptyCsv).toContain('"Alpha, choice","0"');
    expect(emptyCsv).toContain('"\'=Beta ""formula""","0"');
    expect(emptyCsv).toContain('"VOTERS","0"');
    expect(emptyCsv).toContain('"SELECTIONS","0"');
    const proofAfter = await Promise.all(committedProofs.map((path) => readFile(path)));
    expect(proofAfter).toEqual(proofBefore);
  });

  test("does not gate owner export on Results visibility or open/closed status", async ({
    page,
    context,
    baseURL,
  }) => {
    const owner = await signIn(context, baseURL);
    const fixture = seedPoll(owner.userId, "visibility", { rich: true });
    for (const visibility of ["live", "after_close", "creator_only"]) {
      for (const closed of [false, true]) {
        d1Execute(
          `UPDATE poll SET result_visibility = '${visibility}', closed_at_ms = ${closed ? "1800000000002" : "NULL"} WHERE id = '${fixture.pollId}';`,
        );
        const response = await page.request.get(
          `/creator/polls/${fixture.pollId}/export.csv`,
        );
        expect(response.status(), `${visibility}/${closed ? "closed" : "open"}`).toBe(200);
        expect(response.headers()["content-disposition"]).toContain(
          `oddspark-${fixture.reference}.csv`,
        );
      }
    }
  });
});
