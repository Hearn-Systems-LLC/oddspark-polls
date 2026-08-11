import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
  assertUuid,
  cleanupCreator,
  d1Execute,
  d1Query,
  hasBetterAuthSecret,
  requireBaseUrl,
  seedCreatorSession,
  sql,
} from "./creator-session.mjs";

test.describe.configure({ mode: "serial", timeout: 120_000 });
test.skip(
  !hasBetterAuthSecret(),
  "BETTER_AUTH_SECRET is required for authenticated Meeting Poll proof",
);

const PROOF_DIR = "test-results/story-7-1-meeting-poll-proof";
const TALLY_PROOF_DIR = "test-results/story-7-4-availability-tally-proof";
mkdirSync(PROOF_DIR, { recursive: true });
mkdirSync(TALLY_PROOF_DIR, { recursive: true });

const observeBrowserErrors = (page, browserErrors) => {
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  return page;
};

const meetingFormSlot = (page, position) =>
  page.locator("[data-vote-form] [data-slot]").nth(position);

const mobileTallySlot = (results, position) =>
  results.locator(
    `[data-meeting-tally-mobile] [data-slot-position="${position}"]`,
  );

const expectSlotTotals = async (results, position, yes, ifNeedBe, options) => {
  const totals = mobileTallySlot(results, position).locator(".slot-totals");
  await expect(totals).toContainText(`YES ${yes}`, options);
  await expect(totals).toContainText(`IF NEED BE ${ifNeedBe}`, options);
};

const expectOnlyBestSlot = async (results, position, options) => {
  const mobileBest = results.locator(
    "[data-meeting-tally-mobile] [data-slot].is-best",
  );
  await expect(mobileBest).toHaveCount(1, options);
  await expect(mobileBest).toHaveAttribute(
    "data-slot-position",
    String(position),
    options,
  );
  const gold = await results.evaluate((root) => {
    const probe = document.createElement("span");
    probe.style.color = "var(--color-solar-ink)";
    root.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
  await expect(mobileBest).toHaveCSS("border-top-width", "2px", options);
  await expect(mobileBest).toHaveCSS("border-top-color", gold, options);

  const desktopBest = results.locator(
    "[data-meeting-tally-matrix] .slot-column-heading.is-best",
  );
  await expect(desktopBest).toHaveCount(1, options);
  await expect(desktopBest).toHaveAttribute(
    "data-slot-position",
    String(position),
    options,
  );
};

test("creates heterogeneous Meeting slots and reprojects a two-voter tally", async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  const owner = await seedCreatorSession();
  assertUuid(owner.userId);
  let secondVoterContext;
  try {
    await context.addCookies([
      {
        name: "better-auth.session_token",
        value: owner.cookieValue,
        url: requireBaseUrl(baseURL),
      },
    ]);
    const browserErrors = [];
    observeBrowserErrors(page, browserErrors);

    await page.goto("/creator/new");
    await page.locator('label[for="poll-type-meeting"]').click();
    await expect(page.locator("[data-options-fields]")).toBeHidden();
    await expect(page.locator("[data-meeting-slot-fields]")).toBeVisible();
    const timezone = await page.locator('input[name="timezone"]').inputValue();
    await expect(page.locator("[data-timezone-line]")).toHaveText(
      `TIMES IN ${timezone || "UTC"}`,
    );

    await page.getByLabel("QUESTION").fill("When should we meet?");
    await page.getByLabel("SLOT 1 DATE").fill("2027-01-15");
    await page.getByLabel("START").nth(0).fill("09:00");
    await page.getByLabel("END").nth(0).fill("09:30");
    await page.getByLabel("SLOT 2 DATE").fill("2027-01-16");
    await page.getByLabel("START").nth(1).fill("14:00");
    await page.getByLabel("END").nth(1).fill("15:30");

    await page.getByRole("button", { name: "ADD SLOT" }).click();
    await expect(page.locator("[data-slot-row]")).toHaveCount(3);
    await expect(page.getByLabel("SLOT 1 DATE")).toHaveValue("2027-01-15");
    await page.getByLabel("SLOT 3 DATE").fill("2027-01-17");
    await page.getByLabel("START").nth(2).fill("10:00");
    await page.getByLabel("END").nth(2).fill("11:00");
    await page.setViewportSize({ width: 375, height: 812 });
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await page.screenshot({
      path: `${PROOF_DIR}/slot-builder-375-dark.png`,
      fullPage: true,
    });

    const reference = `meeting-${randomUUID().slice(0, 8)}`;
    await page.getByLabel("CUSTOM LINK (OPTIONAL)").fill(reference);
    await Promise.all([
      page.waitForURL(/\/creator\/polls\/[^?]+\?created/u),
      page.getByRole("button", { name: "PUBLISH POLL" }).click(),
    ]);
    const pollId = /\/creator\/polls\/([^?]+)/u.exec(page.url())?.[1] ?? "";
    assertUuid(pollId);
    expect(
      d1Query(
        sql`SELECT position, starts_at_ms, ends_at_ms, time_zone FROM meeting_slot WHERE poll_id = ${pollId} ORDER BY position`,
      ),
    ).toEqual([
      expect.objectContaining({ position: 0, time_zone: timezone || "UTC" }),
      expect.objectContaining({ position: 1, time_zone: timezone || "UTC" }),
      expect.objectContaining({ position: 2, time_zone: timezone || "UTC" }),
    ]);
    await page.goto(`/${reference}`);
    const alexVoterCookie = (await context.cookies()).find(
      (cookie) => cookie.name === "oddspark.voter",
    );
    expect(alexVoterCookie?.value ?? "").toMatch(/^[a-f0-9]{32}$/u);
    await expect(page.locator("[data-vote-form] [data-slot]")).toHaveCount(3);
    await expect(
      page.locator("[data-vote-form] [data-timezone-label]"),
    ).toContainText("TIMES SHOWN IN");
    await meetingFormSlot(page, 0).locator('[data-state="yes"]').click();
    await meetingFormSlot(page, 1)
      .locator('[data-state="if_need_be"]')
      .click();
    await meetingFormSlot(page, 2).locator('[data-state="no"]').click();
    await page.locator("[data-vote-form]").getByLabel("YOUR NAME").fill("Alex");
    await expect(
      meetingFormSlot(page, 0).locator('input[value="yes"]'),
    ).toBeChecked();
    await expect(
      meetingFormSlot(page, 1).locator('input[value="if_need_be"]'),
    ).toBeChecked();
    await expect(
      meetingFormSlot(page, 2).locator('input[value="no"]'),
    ).toBeChecked();
    await Promise.all([
      page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === `/${reference}`),
      page.getByRole("button", { name: "VOTE" }).click(),
    ]);
    await expect(page.locator("[data-vote-outcome]")).toContainText(
      "Saved. Results are live, updating as they arrive.",
    );
    const responseRow = d1Query(sql`SELECT mr.display_name, mr.revision_capability_digest FROM meeting_response mr JOIN vote v ON v.id = mr.vote_id WHERE v.poll_id = ${pollId}`)[0];
    expect(responseRow).toMatchObject({ display_name: "Alex" });
    expect(responseRow.revision_capability_digest).toMatch(/^[a-f0-9]{64}$/u);

    secondVoterContext = await browser.newContext({
      baseURL: requireBaseUrl(baseURL),
    });
    const secondVoterPage = observeBrowserErrors(
      await secondVoterContext.newPage(),
      browserErrors,
    );
    await secondVoterPage.setViewportSize({ width: 375, height: 812 });
    await secondVoterPage.emulateMedia({
      colorScheme: "dark",
      reducedMotion: "reduce",
    });
    await secondVoterPage.goto(`/${reference}`);
    const samVoterCookie = (await secondVoterContext.cookies()).find(
      (cookie) => cookie.name === "oddspark.voter",
    );
    expect(samVoterCookie?.value ?? "").toMatch(/^[a-f0-9]{32}$/u);
    expect(samVoterCookie?.value).not.toBe(alexVoterCookie?.value);

    await meetingFormSlot(secondVoterPage, 0)
      .locator('[data-state="yes"]')
      .click();
    await meetingFormSlot(secondVoterPage, 1)
      .locator('[data-state="yes"]')
      .click();
    await meetingFormSlot(secondVoterPage, 2)
      .locator('[data-state="if_need_be"]')
      .click();
    await secondVoterPage
      .locator("[data-vote-form]")
      .getByLabel("YOUR NAME")
      .fill("Sam");
    await Promise.all([
      secondVoterPage.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === `/${reference}`,
      ),
      secondVoterPage.getByRole("button", { name: "VOTE" }).click(),
    ]);
    await expect(secondVoterPage.locator("[data-vote-outcome]")).toContainText(
      "Saved. Results are live, updating as they arrive.",
    );

    const samResults = secondVoterPage.locator("[data-meeting-results]");
    await expect(samResults).toHaveCount(1);
    const voterNames = samResults.locator(
      "[data-meeting-tally-matrix] tbody .voter-name",
    );
    await expect(voterNames).toHaveCount(2);
    expect((await voterNames.allTextContents()).sort()).toEqual(["Alex", "Sam"]);
    await expectSlotTotals(samResults, 0, 2, 0);
    await expectSlotTotals(samResults, 1, 1, 1);
    await expectSlotTotals(samResults, 2, 0, 1);
    await expectOnlyBestSlot(samResults, 0);
    await secondVoterPage.evaluate(() => document.fonts.ready);
    await samResults.screenshot({
      path: `${TALLY_PROOF_DIR}/availability-tally-375-dark.png`,
    });

    expect(
      d1Query(sql`SELECT COUNT(*) AS count FROM vote WHERE poll_id = ${pollId}`),
    ).toEqual([{ count: 2 }]);
    expect(
      d1Query(
        sql`SELECT COUNT(*) AS count FROM meeting_response mr JOIN vote v ON v.id = mr.vote_id WHERE v.poll_id = ${pollId}`,
      ),
    ).toEqual([{ count: 2 }]);
    expect(
      d1Query(
        sql`SELECT COUNT(*) AS count FROM meeting_availability ma JOIN vote v ON v.id = ma.vote_id WHERE v.poll_id = ${pollId}`,
      ),
    ).toEqual([{ count: 6 }]);
    expect(
      d1Query(sql`SELECT representation_version FROM poll WHERE id=${pollId}`),
    ).toEqual([{ representation_version: 3 }]);

    await page.reload();
    await expect(
      meetingFormSlot(page, 0).locator('input[value="yes"]'),
    ).toBeChecked();
    await expect(page.getByRole("button", { name: "SAVE" })).toBeVisible();
    await meetingFormSlot(page, 0).locator('[data-state="no"]').click();
    await Promise.all([
      page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === `/${reference}`),
      page.getByRole("button", { name: "SAVE" }).click(),
    ]);
    await expect(page.locator("[data-vote-outcome]")).toContainText(
      "Saved. Results are live, updating as they arrive.",
    );

    const alexResults = page.locator("[data-meeting-results]");
    await expectSlotTotals(alexResults, 0, 1, 0);
    await expectSlotTotals(alexResults, 1, 1, 1);
    await expectSlotTotals(alexResults, 2, 0, 1);
    await expectOnlyBestSlot(alexResults, 1);

    // Sam's still-open page adopts the revised projection through the live
    // Results endpoint; no stored aggregate or page reload participates.
    const liveUpdate = { timeout: 15_000 };
    await expectSlotTotals(samResults, 0, 1, 0, liveUpdate);
    await expectSlotTotals(samResults, 1, 1, 1, liveUpdate);
    await expectSlotTotals(samResults, 2, 0, 1, liveUpdate);
    await expectOnlyBestSlot(samResults, 1, liveUpdate);

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({
      colorScheme: "light",
      reducedMotion: "reduce",
    });
    await page.evaluate(() => document.fonts.ready);
    const desktopSlotHeaders = await alexResults
      .locator("[data-meeting-tally-matrix] .slot-column-heading")
      .evaluateAll((headers) =>
        headers.map((header) => {
          const bounds = header.getBoundingClientRect();
          return { x: bounds.x, y: bounds.y };
        }),
      );
    expect(desktopSlotHeaders).toHaveLength(3);
    expect(
      Math.max(...desktopSlotHeaders.map(({ y }) => y)) -
        Math.min(...desktopSlotHeaders.map(({ y }) => y)),
    ).toBeLessThan(2);
    expect(desktopSlotHeaders[0].x).toBeLessThan(desktopSlotHeaders[1].x);
    expect(desktopSlotHeaders[1].x).toBeLessThan(desktopSlotHeaders[2].x);
    const desktopSlotTotals = await alexResults
      .locator("[data-meeting-tally-matrix] tfoot td.slot-totals")
      .evaluateAll((totals) =>
        totals.map((total) => {
          const bounds = total.getBoundingClientRect();
          return { x: bounds.x, y: bounds.y };
        }),
      );
    expect(desktopSlotTotals).toHaveLength(3);
    expect(
      Math.max(...desktopSlotTotals.map(({ y }) => y)) -
        Math.min(...desktopSlotTotals.map(({ y }) => y)),
    ).toBeLessThan(2);
    expect(desktopSlotTotals[0].x).toBeLessThan(desktopSlotTotals[1].x);
    expect(desktopSlotTotals[1].x).toBeLessThan(desktopSlotTotals[2].x);
    await alexResults.screenshot({
      path: `${TALLY_PROOF_DIR}/availability-tally-revised-1280-light.png`,
    });

    expect(
      d1Query(sql`SELECT COUNT(*) AS count FROM vote WHERE poll_id = ${pollId}`),
    ).toEqual([{ count: 2 }]);
    expect(
      d1Query(
        sql`SELECT ms.position, ma.availability FROM meeting_availability ma JOIN vote v ON v.id = ma.vote_id JOIN meeting_response mr ON mr.vote_id = v.id JOIN meeting_slot ms ON ms.id = ma.meeting_slot_id WHERE v.poll_id = ${pollId} AND mr.display_name = 'Alex' ORDER BY ms.position`,
      ),
    ).toEqual([
      { position: 0, availability: "no" },
      { position: 1, availability: "if_need_be" },
      { position: 2, availability: "no" },
    ]);
    expect(
      d1Query(sql`SELECT representation_version FROM poll WHERE id=${pollId}`),
    ).toEqual([{ representation_version: 4 }]);

    d1Execute(sql`UPDATE poll SET closed_at_ms=${Date.now()} WHERE id=${pollId};`);
    await page.reload();
    await expect(page.locator("[data-vote-outcome]")).toContainText("This Poll closed");
    await expect(page.locator(".availability [data-slot]")).toHaveCount(3);
    await expect(page.locator('input[name^="availability_"]')).toHaveCount(0);
    expect(browserErrors).toEqual([]);
  } finally {
    await secondVoterContext?.close();
    cleanupCreator(owner.userId);
  }
});
