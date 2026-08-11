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
mkdirSync(PROOF_DIR, { recursive: true });

test("creates heterogeneous Meeting slots with an explicit timezone", async ({
  page,
  context,
  baseURL,
}) => {
  const owner = await seedCreatorSession();
  assertUuid(owner.userId);
  try {
    await context.addCookies([
      {
        name: "better-auth.session_token",
        value: owner.cookieValue,
        url: requireBaseUrl(baseURL),
      },
    ]);
    const browserErrors = [];
    page.on("pageerror", (error) => browserErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(message.text());
    });

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
    expect((await context.cookies()).some((cookie) => cookie.name === "oddspark.voter")).toBe(true);
    await expect(page.locator("[data-slot]")).toHaveCount(3);
    await expect(page.locator("[data-timezone-label]")).toContainText("TIMES SHOWN IN");
    await page.locator('[data-slot]').nth(0).locator('[data-state="yes"]').click();
    await page.locator('[data-slot]').nth(1).locator('[data-state="if_need_be"]').click();
    await page.locator('[data-slot]').nth(2).locator('[data-state="no"]').click();
    await page.getByLabel("YOUR NAME").fill("Alex");
    await expect(page.locator('[data-slot]').nth(0).locator('input[value="yes"]')).toBeChecked();
    await expect(page.locator('[data-slot]').nth(1).locator('input[value="if_need_be"]')).toBeChecked();
    await expect(page.locator('[data-slot]').nth(2).locator('input[value="no"]')).toBeChecked();
    await Promise.all([
      page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === `/${reference}`),
      page.getByRole("button", { name: "VOTE" }).click(),
    ]);
    await expect(page.locator("[data-vote-outcome]")).toContainText("Saved. Change it any time while the Poll is open.");
    const responseRow = d1Query(sql`SELECT mr.display_name, mr.revision_capability_digest FROM meeting_response mr JOIN vote v ON v.id = mr.vote_id WHERE v.poll_id = ${pollId}`)[0];
    expect(responseRow).toMatchObject({ display_name: "Alex" });
    expect(responseRow.revision_capability_digest).toMatch(/^[a-f0-9]{64}$/u);
    await page.reload();
    await expect(page.locator('[data-slot]').nth(0).locator('input[value="yes"]')).toBeChecked();
    await expect(page.getByRole("button", { name: "SAVE" })).toBeVisible();
    await page.locator('[data-slot]').nth(0).locator('[data-state="no"]').click();
    await Promise.all([
      page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === `/${reference}`),
      page.getByRole("button", { name: "SAVE" }).click(),
    ]);
    await expect(page.locator("[data-vote-outcome]")).toContainText("Saved. Change it any time while the Poll is open.");
    expect(d1Query(sql`SELECT COUNT(*) AS count FROM vote WHERE poll_id = ${pollId}`)).toEqual([{ count: 1 }]);
    expect(d1Query(sql`SELECT availability FROM meeting_availability ma JOIN vote v ON v.id=ma.vote_id WHERE v.poll_id=${pollId} ORDER BY ma.meeting_slot_id`)).toEqual(expect.arrayContaining([expect.objectContaining({ availability: "no" })]));
    expect(d1Query(sql`SELECT representation_version FROM poll WHERE id=${pollId}`)).toEqual([{ representation_version: 3 }]);
    d1Execute(sql`UPDATE poll SET closed_at_ms=${Date.now()} WHERE id=${pollId};`);
    await page.reload();
    await expect(page.locator("[data-vote-outcome]")).toContainText("This Poll closed");
    await expect(page.locator("[data-slot]")).toHaveCount(3);
    await expect(page.locator('input[name^="availability_"]')).toHaveCount(0);
    expect(browserErrors).toEqual([]);
  } finally {
    cleanupCreator(owner.userId);
  }
});
