import { expect, test } from "@playwright/test";

// Full authenticated create-flow coverage requires a real OAuth session, so
// the signed-in specs seed a session directly (see
// create-poll-authed.spec.mjs). These specs cover the unauthenticated
// boundary and the root-path reference surface.

test.describe("poll creation surface", () => {
  test("redirects a signed-out visit to /creator/new to sign-in with a return address", async ({
    page,
  }) => {
    await page.goto("/creator/new");
    await expect(page).toHaveURL(/\/sign-in\?return=%2Fcreator%2Fnew/);
    await expect(
      page.getByRole("button", { name: "CONTINUE WITH GOOGLE" }),
    ).toBeVisible();
  });

  test("renders a plain 404 for an unknown poll reference", async ({ page }) => {
    const response = await page.goto("/this-poll-does-not-exist-abc123");
    expect(response?.status()).toBe(404);
    await expect(
      page.getByRole("heading", { name: "This Poll doesn't exist." }),
    ).toBeVisible();
  });

  test("keeps reserved application paths out of the reference route", async ({
    page,
  }) => {
    // /sign-in resolving to the sign-in page rather than the poll-reference
    // route is Astro's static-route-over-dynamic precedence — this pins that
    // ordering so a routing change can't silently shadow application paths.
    await page.goto("/sign-in");
    await expect(
      page.getByRole("button", { name: "CONTINUE WITH GITHUB" }),
    ).toBeVisible();
  });
});

