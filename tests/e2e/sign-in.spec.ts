import { expect, test } from "@playwright/test";

test.describe("creator sign-in", () => {
  test("renders both server-posted provider choices without JavaScript", async ({
    browser,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    let submittedBody = "";
    await page.route("**/api/sign-in", async (route) => {
      submittedBody = route.request().postData() ?? "";
      await route.fulfill({
        status: 303,
        headers: {
          location:
            "/sign-in?outcome=denied&return=%2Fcreator%2Fnew%3Fdraft%3D1",
        },
      });
    });

    await page.goto("/sign-in?return=%2Fcreator%2Fnew%3Fdraft%3D1");

    const google = page.getByRole("button", {
      name: "CONTINUE WITH GOOGLE",
    });
    const github = page.getByRole("button", {
      name: "CONTINUE WITH GITHUB",
    });
    await expect(google).toBeVisible();
    await expect(github).toBeVisible();
    await expect(page.getByText("Voting never needs an account.")).toBeVisible();
    await expect(page.locator("main img, main svg")).toHaveCount(0);

    for (const [button, provider] of [
      [google, "google"],
      [github, "github"],
    ] as const) {
      const form = button.locator("xpath=ancestor::form");
      await expect(form).toHaveAttribute("method", "post");
      await expect(form).toHaveAttribute("action", "/api/sign-in");
      await expect(form.locator("input[name=provider]")).toHaveValue(provider);
      await expect(form.locator("input[name=return]")).toHaveValue(
        "/creator/new?draft=1",
      );

      const formBox = await form.boundingBox();
      const buttonBox = await button.boundingBox();
      expect(formBox).not.toBeNull();
      expect(buttonBox).not.toBeNull();
      expect(Math.abs((formBox?.width ?? 0) - (buttonBox?.width ?? 0))).toBeLessThan(
        1,
      );
    }

    await google.click();
    expect(new URLSearchParams(submittedBody)).toEqual(
      new URLSearchParams({
        provider: "google",
        return: "/creator/new?draft=1",
      }),
    );
    await expect(page).toHaveURL(
      /\/sign-in\?outcome=denied&return=%2Fcreator%2Fnew%3Fdraft%3D1$/u,
    );

    await context.close();
  });

  test("renders the JavaScript-enhanced sign-in page without runtime errors", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto("/sign-in");
    await expect(
      page.getByRole("button", { name: "CONTINUE WITH GOOGLE" }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("carries the guarded creator location into sign-in", async ({ page }) => {
    await page.goto("/creator?draft=1");

    await expect(page).toHaveURL(
      /\/sign-in\?return=%2Fcreator%3Fdraft%3D1$/u,
    );
  });

  test("renders and focuses the exact denial outcome", async ({ page }) => {
    await page.goto(
      "/sign-in?outcome=denied&return=%2Fcreator%2Fnew%3Fdraft%3D1",
    );

    await expect(page).toHaveTitle(
      "That didn't sign you in — Oddspark Polls",
    );
    const outcome = page.getByText(
      "That didn't sign you in. Nothing was created, and nothing was lost — the create form is right where you left it.",
      { exact: true },
    );
    await expect(outcome).toBeFocused();
    await expect(outcome).toHaveAttribute("tabindex", "-1");
    await expect(page.locator("main > :first-child")).toHaveAttribute(
      "data-outcome",
      "denied",
    );
  });

  test("renders and focuses the exact expired-session outcome", async ({
    page,
  }) => {
    await page.goto("/sign-in?reason=expired&return=%2Fcreator");

    await expect(page).toHaveTitle(
      "You've been signed out — Oddspark Polls",
    );
    const outcome = page.getByText(
      "You've been signed out. Sign back in to pick up where you left off.",
      { exact: true },
    );
    await expect(outcome).toBeFocused();
    await expect(outcome).toHaveAttribute("tabindex", "-1");
    await expect(page.locator("main > :first-child")).toHaveAttribute(
      "data-outcome",
      "expired",
    );
  });
});
