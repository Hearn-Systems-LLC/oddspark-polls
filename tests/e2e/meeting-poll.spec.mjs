import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
  assertUuid,
  cleanupCreator,
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
    ]);
    expect(browserErrors).toEqual([]);
  } finally {
    cleanupCreator(owner.userId);
  }
});
