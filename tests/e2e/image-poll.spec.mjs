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
const PROOF_DIR_6_1 = resolve(__dirname, "..", "test-results", "story-6-1-upload-image-options-proof");
const PROOF_DIR_6_2 = resolve(__dirname, "..", "test-results", "story-6-2-vote-on-an-image-poll-proof");

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
    await page.screenshot({ path: resolve(PROOF_DIR_6_1, "01-image-fields-375-dark.png"), fullPage: true });
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
    await expect(
      page.getByRole("heading", { level: 1, name: "Best landscape?" }),
    ).toBeVisible();

    // Proof capture: 1280px light.
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ colorScheme: "light" });
    await page.screenshot({ path: resolve(PROOF_DIR_6_1, "02-created-poll-1280-light.png"), fullPage: true });
  });
});

test.describe("Image Poll voter surface (Story 6.2)", () => {
  test.skip(
    !hasBetterAuthSecret(),
    "BETTER_AUTH_SECRET is not provisioned in .dev.vars — the authed suite needs local auth material",
  );

  test.describe.configure({ mode: "serial", timeout: 120_000 });

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

  async function createImagePoll(page, { question, link }) {
    await page.goto("/creator/new");
    await page.locator('label[for="poll-type-image"]').click();
    await page.getByLabel("QUESTION").fill(question);
    await page.getByRole("textbox", { name: "OPTION 1" }).fill("Sunset");
    await page.getByRole("textbox", { name: "OPTION 2" }).fill("Mountain");
    await page.getByLabel("CUSTOM LINK (OPTIONAL)").fill(link);

    const fileInputs = page.locator('input[type="file"][accept="image/jpeg,image/png,image/webp"]');
    await fileInputs.nth(0).setInputFiles(resolve(FIXTURES_DIR, "tiny.jpg"));
    await fileInputs.nth(1).setInputFiles(resolve(FIXTURES_DIR, "tiny.png"));

    const altFields = page.locator('input[id^="media-alt-"]');
    await altFields.nth(0).fill("A sunset over the ocean");
    await altFields.nth(1).fill("A mountain landscape");

    await Promise.all([
      page.waitForURL(/\/creator\/polls\//),
      page.getByRole("button", { name: "PUBLISH POLL" }).click(),
    ]);
  }

  async function voteForMountain(page) {
    await page.getByRole("img", { name: "A mountain landscape" }).click();
    const mountainRadio = page.getByRole("radio", {
      name: "A mountain landscape",
    });
    await expect(mountainRadio).toBeChecked();
    const [postResponse] = await Promise.all([
      page.waitForResponse(
        (candidate) =>
          candidate.request().method() === "POST" &&
          !candidate.url().includes("/creator/"),
      ),
      page.getByRole("button", { name: "VOTE" }).click(),
    ]);
    expect(postResponse.status()).toBe(303);
  }

  test.afterAll(() => {
    cleanupCreators(seededUserIds);
  });

  test("plates render on voting page with alt text and captions (AC 1, 2)", async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, baseURL);
    await page.goto("/creator/new");

    // Create an image poll.
    await page.locator('label[for="poll-type-image"]').click();
    await page.getByLabel("QUESTION").fill("Best landscape?");
    await page.getByRole("textbox", { name: "OPTION 1" }).fill("Sunset");
    await page.getByRole("textbox", { name: "OPTION 2" }).fill("Mountain");
    await page.getByLabel("CUSTOM LINK (OPTIONAL)").fill("image-voter-test");

    const fileInputs = page.locator('input[type="file"][accept="image/jpeg,image/png,image/webp"]');
    await fileInputs.nth(0).setInputFiles(resolve(FIXTURES_DIR, "tiny.jpg"));
    await fileInputs.nth(1).setInputFiles(resolve(FIXTURES_DIR, "tiny.png"));

    const altFields = page.locator('input[id^="media-alt-"]');
    await altFields.nth(0).fill("A sunset over the ocean");
    await altFields.nth(1).fill("A mountain landscape");

    const captionFields = page.locator('input[id^="media-caption-"]');
    await captionFields.nth(0).fill("Golden hour");
    // Leave caption null for option 2 to test null-caption rendering.

    await Promise.all([
      page.waitForURL(/\/creator\/polls\//),
      page.getByRole("button", { name: "PUBLISH POLL" }).click(),
    ]);

    // Clear creator session to become anonymous voter.
    await context.clearCookies();

    // Navigate to the public voting page.
    await page.goto("/image-voter-test");

    // Plates should render with alt text.
    const plates = page.locator("img.poll-option-plate");
    await expect(plates).toHaveCount(2);
    await expect(plates.nth(0)).toHaveAttribute("alt", "A sunset over the ocean");
    await expect(plates.nth(1)).toHaveAttribute("alt", "A mountain landscape");

    // Captions should render for option 1 (non-null), absent for option 2 (null).
    const captions = page.locator(".poll-option-caption");
    await expect(captions).toHaveCount(1);
    await expect(captions.nth(0)).toHaveText("Golden hour");

    // Plates should have lazy loading and async decoding.
    await expect(plates.nth(0)).toHaveAttribute("loading", "lazy");
    await expect(plates.nth(0)).toHaveAttribute("decoding", "async");

    // Proof capture: 375px dark.
    await page.setViewportSize({ width: 375, height: 812 });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.screenshot({ path: resolve(PROOF_DIR_6_2, "01-voting-plates-375-dark.png"), fullPage: true });
  });

  test("tap image selects, vote counts, confirmation shows (AC 3)", async ({
    page,
    context,
    baseURL,
  }) => {
    await page.goto("/image-voter-test");

    // Tap the second image plate to select it.
    await page
      .getByRole("img", { name: "A mountain landscape" })
      .click();

    // The radio input should be checked.
    const mountainRadio = page.getByRole("radio", {
      name: "A mountain landscape",
    });
    await expect(mountainRadio).toBeChecked();

    // Vote button should be enabled.
    await expect(page.getByRole("button", { name: "VOTE" })).toBeEnabled();

    // Submit the vote.
    await voteForMountain(page);

    // Confirmation surface.
    await expect(page).toHaveTitle(/Counted/);
    await expect(page.locator("[data-vote-outcome]")).toBeFocused();
    await expect(page.locator("[data-vote-outcome]")).toContainText("Counted");

    // YOUR BALLOT should show the chosen label.
    await expect(page.locator(".results-tally-ballot-value")).toHaveText("Mountain");

    // Proof capture: 1280px light.
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ colorScheme: "light" });
    await page.screenshot({ path: resolve(PROOF_DIR_6_2, "02-confirmation-1280-light.png"), fullPage: true });
  });

  test("already-voted state shows plates with cast selection marked (AC 4)", async ({
    page,
    context,
    baseURL,
  }) => {
    // Self-contained: this test creates its own Poll and casts its own Vote
    // so it passes in isolation, without cookies from an earlier test.
    await signIn(context, baseURL);
    const link = `image-voted-${crypto.randomUUID().slice(0, 8)}`;
    await createImagePoll(page, { question: "Voted plates?", link });

    await context.clearCookies();
    await page.goto(`/${link}`);
    await voteForMountain(page);
    await expect(page).toHaveTitle(/Counted/);

    // Reload the page to see the already-voted state.
    await page.goto(`/${link}`);

    await expect(page).toHaveTitle(/Already voted/);
    await expect(page.getByText("You've already voted here.")).toBeVisible();

    // Read-only option rows should render with plates.
    const readOnlyOptions = page.locator(".poll-option-readonly");
    await expect(readOnlyOptions).toHaveCount(2);

    // Plates should still be visible in read-only state.
    const plates = page.locator("img.poll-option-plate");
    await expect(plates).toHaveCount(2);

    // The cast selection should be marked with ◆ (is-cast class on marker).
    const castMarker = page.locator(".poll-option-marker.is-cast");
    await expect(castMarker).toHaveCount(1);

    // YOUR BALLOT should persist.
    await expect(page.locator(".results-tally-ballot-value")).toHaveText("Mountain");

    // Proof capture: 375px dark (already-voted state).
    await page.setViewportSize({ width: 375, height: 812 });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.screenshot({ path: resolve(PROOF_DIR_6_2, "03-already-voted-375-dark.png"), fullPage: true });
  });

  test("results view shows plates above bars (AC 2, 3)", async ({
    page,
  }) => {
    await page.goto("/image-voter-test/results");

    // Results tally should render plates above each bar.
    const resultPlates = page.locator(".results-tally-plate");
    await expect(resultPlates).toHaveCount(2);

    // Each plate should have an image with alt text.
    const plateImages = page.locator("img.results-tally-plate-image");
    await expect(plateImages).toHaveCount(2);
    await expect(plateImages.nth(0)).toHaveAttribute("alt", "A sunset over the ocean");
    await expect(plateImages.nth(1)).toHaveAttribute("alt", "A mountain landscape");

    // Captions should render below plates (only for option 1).
    const plateCaptions = page.locator(".results-tally-plate-caption");
    await expect(plateCaptions).toHaveCount(1);
    await expect(plateCaptions.nth(0)).toHaveText("Golden hour");

    // Results bars should still be present and byte-identical (no media props).
    const bars = page.locator("[data-tally-final] .results-bar");
    await expect(bars).toHaveCount(2);

    // Proof capture: 1280px light (results view).
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ colorScheme: "light" });
    await page.screenshot({ path: resolve(PROOF_DIR_6_2, "04-results-plates-1280-light.png"), fullPage: true });
  });

  test("escapes adversarial alt text and captions", async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, baseURL);
    await page.goto("/creator/new");

    // Create an image poll with adversarial alt text and captions.
    await page.locator('label[for="poll-type-image"]').click();
    await page.getByLabel("QUESTION").fill("Adversarial images?");
    await page.getByRole("textbox", { name: "OPTION 1" }).fill("Script");
    await page.getByRole("textbox", { name: "OPTION 2" }).fill("Attribute");
    await page.getByLabel("CUSTOM LINK (OPTIONAL)").fill("adversarial-images");

    const fileInputs = page.locator('input[type="file"][accept="image/jpeg,image/png,image/webp"]');
    await fileInputs.nth(0).setInputFiles(resolve(FIXTURES_DIR, "tiny.jpg"));
    await fileInputs.nth(1).setInputFiles(resolve(FIXTURES_DIR, "tiny.png"));

    const altFields = page.locator('input[id^="media-alt-"]');
    await altFields.nth(0).fill('<script>alert("xss")</script>');
    await altFields.nth(1).fill('" autofocus onfocus="alert(1)');

    const captionFields = page.locator('input[id^="media-caption-"]');
    await captionFields.nth(0).fill('<img src="x" onerror="alert(2)">');
    // Leave caption null for option 2.

    await Promise.all([
      page.waitForURL(/\/creator\/polls\//),
      page.getByRole("button", { name: "PUBLISH POLL" }).click(),
    ]);

    // Clear creator session to become anonymous voter.
    await context.clearCookies();

    // Navigate to the public voting page.
    await page.goto("/adversarial-images");

    // Alt text should render as escaped text, not injected elements.
    const plates = page.locator("img.poll-option-plate");
    await expect(plates).toHaveCount(2);
    await expect(plates.nth(0)).toHaveAttribute("alt", '<script>alert("xss")</script>');
    await expect(plates.nth(1)).toHaveAttribute("alt", '" autofocus onfocus="alert(1)');

    // No injected elements or event handlers.
    expect(await page.locator('main script:has-text("alert")').count()).toBe(0);
    expect(await page.locator('main img[src="x"]').count()).toBe(0);
    expect(await page.locator("main [onerror]").count()).toBe(0);
    expect(await page.locator("main [onfocus]").count()).toBe(0);

    // Captions should also be escaped.
    const captions = page.locator(".poll-option-caption");
    await expect(captions).toHaveCount(1);
    await expect(captions.nth(0)).toHaveText('<img src="x" onerror="alert(2)">');

    // Serialized HTML should contain escaped entities, not raw tags.
    const mainHtml = await page.locator("main").innerHTML();
    expect(mainHtml).not.toContain('<script>alert("xss")</script>');
    expect(mainHtml).toContain("&lt;script&gt;");
    expect(mainHtml).not.toContain('<img src="x" onerror="alert(2)">');
    expect(mainHtml).toContain("&lt;img src=");
  });
});
