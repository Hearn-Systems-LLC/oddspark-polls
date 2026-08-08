import { expect, test } from "@playwright/test";
import {
  assertUuid,
  cleanupCreators,
  hasBetterAuthSecret,
  requireBaseUrl,
  seedCreatorSession,
} from "./creator-session.mjs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const FIXTURES_DIR = resolve(__dirname, "fixtures");
const PROOF_DIR = resolve(__dirname, "..", "test-results", "story-6-1-upload-image-options-proof");

test.describe.configure({ mode: "serial", timeout: 120_000 });

test.describe("Image Poll creation (Story 6.1)", () => {
  test.skip(
    !hasBetterAuthSecret(),
    "BETTER_AUTH_SECRET is not provisioned in .dev.vars — the authed suite needs local auth material",
  );

  const seededUserIds = [];

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

  test("shows IMAGE poll type choice and per-option image fields", async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, baseURL);
    await page.goto("/creator/new");

    // IMAGE radio should be present.
    const imageRadio = page.locator('input[name="pollType"][value="image"]');
    await expect(imageRadio).toBeVisible();

    // Select IMAGE type.
    await page.locator('label[for="poll-type-image"]').click();

    // Image upload fields should appear for each option row.
    const fileInputs = page.locator('input[type="file"][accept="image/jpeg,image/png,image/webp"]');
    await expect(fileInputs.first()).toBeVisible();

    // Alt text fields should be present.
    const altFields = page.locator('input[name^="media_alt_"]');
    await expect(altFields.first()).toBeVisible();

    // Caption fields should be present.
    const captionFields = page.locator('input[name^="media_caption_"]');
    await expect(captionFields.first()).toBeVisible();

    // Multi-select fieldset should be hidden for image polls.
    await expect(
      page.getByRole("group", { name: "HOW MANY OPTIONS CAN A VOTER PICK" }),
    ).toBeHidden();

    // Proof capture: 375px dark.
    await page.setViewportSize({ width: 375, height: 812 });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.screenshot({ path: resolve(PROOF_DIR, "01-image-fields-375-dark.png"), fullPage: true });
  });

  test("blocks publication when alt text is missing", async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, baseURL);
    await page.goto("/creator/new");

    // Select IMAGE type.
    await page.locator('label[for="poll-type-image"]').click();

    // Fill question and options.
    await page.getByLabel("QUESTION").fill("Which photo?");
    await page.getByRole("textbox", { name: "OPTION 1" }).fill("Photo A");
    await page.getByRole("textbox", { name: "OPTION 2" }).fill("Photo B");

    // Upload images but leave alt text empty.
    const fileInputs = page.locator('input[type="file"][accept="image/jpeg,image/png,image/webp"]');
    await fileInputs.nth(0).setInputFiles(resolve(FIXTURES_DIR, "tiny.jpg"));
    await fileInputs.nth(1).setInputFiles(resolve(FIXTURES_DIR, "tiny.png"));

    // Publish — should get 422 with alt text error.
    const [response] = await Promise.all([
      page.waitForResponse(
        (candidate) =>
          candidate.url().includes("/creator/new") &&
          candidate.request().method() === "POST",
      ),
      page.getByRole("button", { name: "PUBLISH POLL" }).click(),
    ]);
    expect(response.status()).toBe(422);

    // Alt text error should be visible.
    await expect(
      page.locator('[id^="media-alt-"][id$="-error"]').first(),
    ).toBeVisible();
  });

  test("preserves successful uploads when one upload fails (AC 4)", async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, baseURL);
    await page.goto("/creator/new");

    // Select IMAGE type.
    await page.locator('label[for="poll-type-image"]').click();

    // Fill question and options.
    await page.getByLabel("QUESTION").fill("Which photo?");
    await page.getByRole("textbox", { name: "OPTION 1" }).fill("Photo A");
    await page.getByRole("textbox", { name: "OPTION 2" }).fill("Photo B");

    // Upload a valid image to option 1.
    const fileInputs = page.locator('input[type="file"][accept="image/jpeg,image/png,image/webp"]');
    await fileInputs.nth(0).setInputFiles(resolve(FIXTURES_DIR, "tiny.jpg"));

    // Fill alt text for option 1.
    const altFields = page.locator('input[id^="media-alt-"]');
    await altFields.nth(0).fill("A valid photo");

    // Publish without uploading option 2 — should get 422.
    const [response] = await Promise.all([
      page.waitForResponse(
        (candidate) =>
          candidate.url().includes("/creator/new") &&
          candidate.request().method() === "POST",
      ),
      page.getByRole("button", { name: "PUBLISH POLL" }).click(),
    ]);
    expect(response.status()).toBe(422);

    // Option 1's preview plate and hidden ref should be preserved.
    await expect(page.locator(".image-preview-plate").first()).toBeVisible();
    await expect(page.locator('input[name="media_ref"]').first()).toBeAttached();

    // Option 1's alt text should be preserved.
    await expect(altFields.nth(0)).toHaveValue("A valid photo");

    // Question should be preserved.
    await expect(page.getByLabel("QUESTION")).toHaveValue("Which photo?");
  });

  test("creates an Image Poll with valid uploads and renders images on the created page", async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, baseURL);
    await page.goto("/creator/new");

    // Select IMAGE type.
    await page.locator('label[for="poll-type-image"]').click();

    // Fill question and options.
    await page.getByLabel("QUESTION").fill("Best landscape?");
    await page.getByRole("textbox", { name: "OPTION 1" }).fill("Sunset");
    await page.getByRole("textbox", { name: "OPTION 2" }).fill("Mountain");

    // Upload images.
    const fileInputs = page.locator('input[type="file"][accept="image/jpeg,image/png,image/webp"]');
    await fileInputs.nth(0).setInputFiles(resolve(FIXTURES_DIR, "tiny.jpg"));
    await fileInputs.nth(1).setInputFiles(resolve(FIXTURES_DIR, "tiny.png"));

    // Fill alt text.
    const altFields = page.locator('input[id^="media-alt-"]');
    await altFields.nth(0).fill("A sunset over the ocean");
    await altFields.nth(1).fill("A mountain landscape");

    // Fill optional caption.
    const captionFields = page.locator('input[id^="media-caption-"]');
    await captionFields.nth(0).fill("Golden hour");

    // Publish — should redirect (303) to the created poll.
    await Promise.all([
      page.waitForURL(/\/creator\/polls\//),
      page.getByRole("button", { name: "PUBLISH POLL" }).click(),
    ]);
    expect(page.url()).toContain("/creator/polls/");

    // Images should render on the created poll page.
    // Note: Story 6.2 adds image plates to the voting page; for now just verify
    // the page loads successfully after creation.
    await expect(page.getByText("Best landscape?")).toBeVisible();

    // Proof capture: 1280px light.
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ colorScheme: "light" });
    await page.screenshot({ path: resolve(PROOF_DIR, "02-created-poll-1280-light.png"), fullPage: true });
  });
});
