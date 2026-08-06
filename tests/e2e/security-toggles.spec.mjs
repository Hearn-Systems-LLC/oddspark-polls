import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import {
  assertUuid,
  cleanupCreators,
  d1Query,
  hasBetterAuthSecret,
  requireBaseUrl,
  seedCreatorSession,
  sql,
} from "./creator-session.mjs";

// Story 2.1 — per-poll Security Toggles on create + detail, tighten-only after Vote.

if (!hasBetterAuthSecret()) {
  throw new Error(
    "Story 2.1 E2E requires BETTER_AUTH_SECRET in .dev.vars; skipping Security Toggle proof is forbidden",
  );
}

const proofUnlocked = "test-results/story-2-1-unlocked-proof";
const proofLocked = "test-results/story-2-1-locked-proof";
const proofCreate = "test-results/story-2-1-create-proof";

test.describe.configure({ mode: "serial", timeout: 180_000 });

test.describe("per-poll Security Toggles", () => {
  const seededUserIds = [];
  const browserErrors = new WeakMap();

  test.beforeEach(({ page }) => {
    const errors = [];
    browserErrors.set(page, errors);
    page.on("console", (message) => {
      if (message.type() === "error") {
        errors.push(message.text());
      }
    });
    page.on("pageerror", (error) => {
      errors.push(error.message);
    });
  });

  test.afterEach(({ page }) => {
    expect(browserErrors.get(page) ?? []).toEqual([]);
  });

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

  test.afterAll(() => {
    cleanupCreators(seededUserIds);
  });

  async function screenshotProof(page, dir, label) {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.setViewportSize({ width: 375, height: 900 });
    await page.screenshot({
      path: `${dir}/${label}-375-dark.png`,
      fullPage: true,
    });
    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({
      path: `${dir}/${label}-1280-light.png`,
      fullPage: true,
    });
  }

  test("create form defaults Session Checks on and persists UJ-1 combination", async ({
    page,
    context,
    baseURL,
  }) => {
    const seeded = await signIn(context, baseURL);
    await page.goto("/creator/new");

    await expect(
      page.getByRole("group", { name: "SECURITY TOGGLES" }),
    ).toBeVisible();
    await expect(page.locator('input[name="sessionChecks"]')).toBeChecked();
    await expect(page.locator('input[name="ipChecks"]')).not.toBeChecked();
    await expect(page.locator('input[name="captcha"]')).not.toBeChecked();

    await screenshotProof(page, proofCreate, "create-defaults");

    const reference = `sec-uj1-${randomUUID().slice(0, 8)}`;
    await page.getByLabel("QUESTION").fill("Security toggles?");
    await page.getByRole("textbox", { name: "OPTION 1" }).fill("Yes");
    await page.getByRole("textbox", { name: "OPTION 2" }).fill("No");
    await page.getByLabel("CUSTOM LINK (OPTIONAL)").fill(reference);
    // UJ-1: Session Checks + IP Checks + CAPTCHA on
    await page.locator("label.security-toggle", { hasText: "IP Checks" }).click();
    await page.locator("label.security-toggle", { hasText: "CAPTCHA" }).click();
    await expect(page.locator('input[name="ipChecks"]')).toBeChecked();
    await expect(page.locator('input[name="captcha"]')).toBeChecked();

    await page.getByRole("button", { name: "PUBLISH POLL" }).click();
    await expect(page).toHaveURL(/\/creator\/polls\//);
    await expect(page.getByText("Your Poll is live.")).toBeVisible();

    const rows = d1Query(
      sql`SELECT session_checks_enabled, ip_checks_enabled, voter_codes_enabled, captcha_enabled, vpn_blocking_enabled FROM poll p JOIN poll_reference r ON r.poll_id = p.id AND r.is_canonical = 1 WHERE r.reference = ${reference}`,
    );
    expect(rows).toEqual([
      {
        session_checks_enabled: 1,
        ip_checks_enabled: 1,
        voter_codes_enabled: 0,
        captcha_enabled: 1,
        vpn_blocking_enabled: 0,
      },
    ]);

    await expect(page.locator('input[name="sessionChecks"]')).toBeChecked();
    await expect(page.locator('input[name="ipChecks"]')).toBeChecked();
    await expect(page.locator('input[name="captcha"]')).toBeChecked();
    await expect(page.getByText("LOCKED")).toHaveCount(0);

    await screenshotProof(page, proofUnlocked, "detail-unlocked");
  });

  test("all-off create allows a vote with no claim row", async ({
    page,
    context,
    baseURL,
  }) => {
    const seeded = await signIn(context, baseURL);
    const reference = `sec-off-${randomUUID().slice(0, 8)}`;
    await page.goto("/creator/new");
    await page.getByLabel("QUESTION").fill("All off?");
    await page.getByRole("textbox", { name: "OPTION 1" }).fill("Alpha");
    await page.getByRole("textbox", { name: "OPTION 2" }).fill("Beta");
    await page.getByLabel("CUSTOM LINK (OPTIONAL)").fill(reference);
    // Session Checks is on by default — turn it off for all-off.
    await page
      .locator("label.security-toggle", { hasText: "Session Checks" })
      .click();
    await expect(page.locator('input[name="sessionChecks"]')).not.toBeChecked();
    await page.getByRole("button", { name: "PUBLISH POLL" }).click();
    await expect(page).toHaveURL(/\/creator\/polls\//);

    const toggleRow = d1Query(
      sql`SELECT p.id AS id, p.session_checks_enabled AS session_checks_enabled FROM poll p JOIN poll_reference r ON r.poll_id = p.id AND r.is_canonical = 1 WHERE r.reference = ${reference}`,
    );
    expect(toggleRow[0]?.session_checks_enabled).toBe(0);
    assertUuid(toggleRow[0].id);

    // Vote without the creator session so we exercise the public path.
    await context.clearCookies();
    await page.goto(`/${reference}`);
    await page.locator("label.poll-option", { hasText: "Alpha" }).click();
    await page.getByRole("button", { name: "VOTE" }).click();
    await expect(page.getByText("Counted.")).toBeVisible({
      timeout: 15_000,
    });

    const claims = d1Query(
      sql`SELECT COUNT(*) AS n FROM voter_claim WHERE poll_id = ${toggleRow[0].id}`,
    );
    expect(Number(claims[0]?.n ?? 0)).toBe(0);
  });

  test("after a Vote, on-Toggles lock and disable is rejected", async ({
    page,
    context,
    baseURL,
  }) => {
    const seeded = await signIn(context, baseURL);
    const reference = `sec-lock-${randomUUID().slice(0, 8)}`;
    await page.goto("/creator/new");
    await page.getByLabel("QUESTION").fill("Lock after vote?");
    await page.getByRole("textbox", { name: "OPTION 1" }).fill("Alpha");
    await page.getByRole("textbox", { name: "OPTION 2" }).fill("Beta");
    await page.getByLabel("CUSTOM LINK (OPTIONAL)").fill(reference);
    await page.getByRole("button", { name: "PUBLISH POLL" }).click();
    await expect(page).toHaveURL(/\/creator\/polls\//);
    const detailUrl = page.url().split("?")[0];

    const pollRows = d1Query(
      sql`SELECT p.id AS id FROM poll p JOIN poll_reference r ON r.poll_id = p.id AND r.is_canonical = 1 WHERE r.reference = ${reference}`,
    );
    assertUuid(pollRows[0].id);

    await context.clearCookies();
    await page.goto(`/${reference}`);
    await page.locator("label.poll-option", { hasText: "Alpha" }).click();
    await page.getByRole("button", { name: "VOTE" }).click();
    await expect(page.getByText("Counted.")).toBeVisible({
      timeout: 15_000,
    });

    // Re-authenticate as the creator for the detail surface.
    await context.addCookies([
      {
        name: "better-auth.session_token",
        value: seeded.cookieValue,
        url: requireBaseUrl(baseURL),
      },
    ]);
    await page.goto(detailUrl);
    await expect(
      page.getByText(
        "Votes are in. Protections can tighten from here, not loosen.",
      ),
    ).toBeVisible();
    await expect(page.getByText("LOCKED").first()).toBeVisible();
    await expect(
      page.locator('input[name="sessionChecks"][type="hidden"]'),
    ).toHaveCount(1);
    await expect(
      page.locator("#detail-security-sessionChecks[disabled]"),
    ).toBeChecked();

    // Forge the state the disabled UI cannot submit: omit the locked-on
    // Session Checks field in a direct authenticated POST. This exercises the
    // real middleware and page without turning an expected 422 navigation into
    // browser-console noise.
    const csrfToken = await page
      .locator('form[data-security-toggles] input[name="csrf_token"]')
      .getAttribute("value");
    expect(csrfToken).toBeTruthy();
    const persistedBeforeReject = d1Query(
      sql`SELECT session_checks_enabled, ip_checks_enabled, voter_codes_enabled, captcha_enabled, vpn_blocking_enabled, representation_version FROM poll WHERE id = ${pollRows[0].id}`,
    );
    const rejectedBody = new URLSearchParams({
      csrf_token: csrfToken ?? "",
      intent: "update-security",
    });
    const rejectedResponse = await page.request.post(detailUrl, {
      data: rejectedBody.toString(),
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: requireBaseUrl(baseURL),
        "sec-fetch-site": "same-origin",
      },
      maxRedirects: 0,
    });
    expect(rejectedResponse.status()).toBe(422);
    expect(rejectedResponse.headers()["cache-control"]).toBe(
      "private, no-store",
    );
    const rejectedHtml = await rejectedResponse.text();
    expect(rejectedHtml).toContain(
      "Votes are in. Protections can tighten from here, not loosen.",
    );
    expect(rejectedHtml).toContain('name="sessionChecks" value="true"');
    expect(
      d1Query(
        sql`SELECT session_checks_enabled, ip_checks_enabled, voter_codes_enabled, captcha_enabled, vpn_blocking_enabled, representation_version FROM poll WHERE id = ${pollRows[0].id}`,
      ),
    ).toEqual(persistedBeforeReject);

    // Enable CAPTCHA (allowed), keep Session Checks on via hidden.
    await page.locator("label.security-toggle", { hasText: "CAPTCHA" }).click();
    await page.getByRole("button", { name: "SAVE SECURITY" }).click();
    await expect(page.getByText("Security updated.")).toBeVisible();

    const after = d1Query(
      sql`SELECT session_checks_enabled, captcha_enabled FROM poll WHERE id = ${pollRows[0].id}`,
    );
    expect(after[0]).toMatchObject({
      session_checks_enabled: 1,
      captcha_enabled: 1,
    });

    const lockedStyles = await page
      .locator("label.security-toggle.is-locked", {
        has: page.locator("#detail-security-sessionChecks"),
      })
      .evaluate((row) => {
        const knob = row.querySelector(".security-toggle-knob");
        if (!(knob instanceof HTMLElement)) {
          throw new Error("Locked Security Toggle knob is missing");
        }
        const style = getComputedStyle(knob);
        const normalizeTokenColor = (token) => {
          const probe = document.createElement("span");
          probe.style.position = "absolute";
          probe.style.visibility = "hidden";
          probe.style.backgroundColor = `var(${token})`;
          row.append(probe);
          const color = getComputedStyle(probe).backgroundColor;
          probe.remove();
          return color;
        };
        return {
          actual: style.backgroundColor,
          locked: normalizeTokenColor("--security-toggle-knob-locked"),
          ordinaryOn: normalizeTokenColor("--security-toggle-knob-on"),
          rowOpacity: getComputedStyle(row).opacity,
        };
      });
    expect(lockedStyles.actual).toBe(lockedStyles.locked);
    expect(lockedStyles.actual).not.toBe(lockedStyles.ordinaryOn);
    expect(lockedStyles.rowOpacity).toBe("1");

    await screenshotProof(page, proofLocked, "detail-locked");
  });
});
