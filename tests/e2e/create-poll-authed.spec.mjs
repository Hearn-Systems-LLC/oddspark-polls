import { expect, test } from "@playwright/test";
import {
  agePoll,
  assertUuid,
  requireBaseUrl,
  cleanupCreator,
  d1Query,
  hasBetterAuthSecret,
  seedCreatorSession,
} from "./creator-session.mjs";

// Route-level coverage of the real /creator/new page (Task 7): a Better Auth
// session is seeded straight into local D1 and the session cookie signed with
// the local BETTER_AUTH_SECRET, so the browser drives the real middleware and
// page frontmatter end to end. (.mjs like no-raw-html.test.mjs: node APIs
// without node types.)

// Serial: each test shells out to wrangler against the same local D1 file,
// and a cold wrangler start is slow.
test.describe.configure({ mode: "serial", timeout: 120_000 });

test.describe("authenticated create flow (seeded session)", () => {
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
    for (const userId of seededUserIds) {
      cleanupCreator(userId);
    }
  });

  test("renders the create form for a signed-in creator — the static route, not the catch-all", async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, baseURL);
    await page.goto("/creator/new");
    // The catch-all creator/[...path].astro would render the placeholder
    // ("Your creator space is ready.") instead of the form.
    await expect(
      page.getByRole("heading", { name: "Create a Poll" }),
    ).toBeVisible();
    await expect(page.locator("[data-option-row]")).toHaveCount(4);
    const customLink = page.getByLabel("CUSTOM LINK (OPTIONAL)");
    await expect(customLink).toBeVisible();
    await expect(customLink).toHaveValue("");
    await expect(
      page.getByText(
        "Lowercase letters, digits, and hyphens. Leave blank for a random link.",
      ),
    ).toBeVisible();
    expect(
      await page
        .locator("#deadline, #custom-link, #description")
        .evaluateAll((fields) => fields.map((field) => field.id)),
    ).toEqual(["deadline", "custom-link", "description"]);
    expect(await page.evaluate(() => document.activeElement?.id)).not.toBe(
      "custom-link",
    );
    await expect(
      page.getByRole("button", { name: "PUBLISH POLL" }),
    ).toBeVisible();

    const one = page.locator('input[name="multiSelect"][value="false"]');
    const several = page.locator('input[name="multiSelect"][value="true"]');
    await expect(
      page.getByRole("group", { name: "HOW MANY OPTIONS CAN A VOTER PICK" }),
    ).toBeVisible();
    await expect(one).toBeChecked();
    await expect(several).not.toBeChecked();
    await expect(page.getByLabel("MIN (OPTIONAL)")).toBeHidden();
    await expect(page.getByLabel("MAX (OPTIONAL)")).toBeHidden();

    await page.locator("label.poll-option", { hasText: "SEVERAL" }).click();
    await expect(page.getByLabel("MIN (OPTIONAL)")).toBeVisible();
    await expect(page.getByLabel("MAX (OPTIONAL)")).toBeVisible();

    const min = page.getByLabel("MIN (OPTIONAL)");
    await min.fill("1");
    await page.locator('label[for="multi-select-false"]').click();
    await expect(min).toBeVisible();
    await min.fill("");
    await expect(min).toBeHidden();
    await expect(one).toBeFocused();
  });

  test("creates a bounded multi-select poll and preserves invalid bounds on 422", async ({
    page,
    context,
    baseURL,
  }) => {
    const seeded = await signIn(context, baseURL);
    await page.goto("/creator/new");
    await page.getByLabel("QUESTION").fill("Pick two?");
    await page.getByRole("textbox", { name: "OPTION 1" }).fill("A");
    await page.getByRole("textbox", { name: "OPTION 2" }).fill("B");
    await page.locator("label.poll-option", { hasText: "SEVERAL" }).click();
    const min = page.getByLabel("MIN (OPTIONAL)");
    const max = page.getByLabel("MAX (OPTIONAL)");
    await min.fill("2");
    await max.fill("3");
    await expect(max).not.toHaveAttribute("aria-invalid");

    const [invalidResponse] = await Promise.all([
      page.waitForResponse(
        (candidate) =>
          candidate.url().includes("/creator/new") &&
          candidate.request().method() === "POST",
      ),
      page.getByRole("button", { name: "PUBLISH POLL" }).click(),
    ]);
    expect(invalidResponse.status()).toBe(422);
    await expect(min).toHaveValue("2");
    await expect(max).toHaveValue("3");
    await expect(max).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#max-selections-error")).toHaveText(
      "Max can't be more than the option count (2).",
    );

    await max.fill("2");
    await page.getByRole("button", { name: "PUBLISH POLL" }).click();
    await expect(page).toHaveURL(/\/creator\/polls\/[^?]+\?created/);
    expect(
      d1Query(
        `SELECT multi_select_enabled, min_selections, max_selections FROM poll WHERE owner_user_id = '${seeded.userId}'`,
      ),
    ).toEqual([
      {
        multi_select_enabled: 1,
        min_selections: 2,
        max_selections: 2,
      },
    ]);
  });

  test("publishes a poll and persists the submitted shape", async ({
    page,
    context,
    baseURL,
  }) => {
    const seeded = await signIn(context, baseURL);
    await page.goto("/creator/new");
    await page.getByLabel("QUESTION").fill("Where should we eat?");
    await page.getByRole("textbox", { name: "OPTION 1" }).fill("Pizza");
    await page.getByRole("textbox", { name: "OPTION 2" }).fill("Tacos");
    await page.locator("label.poll-option", { hasText: "AFTER CLOSE" }).click();

    const [response] = await Promise.all([
      page.waitForResponse(
        (candidate) =>
          candidate.url().includes("/creator/new") &&
          candidate.request().method() === "POST",
      ),
      page.getByRole("button", { name: "PUBLISH POLL" }).click(),
    ]);
    expect(response.status()).toBe(303);

    await expect(page).toHaveURL(/\/creator\/polls\/[^?]+\?created/);
    await expect(page.getByText("Your Poll is live.")).toBeVisible();
    await expect(page.locator(".canonical-url")).toContainText(
      `${requireBaseUrl(baseURL)}/`,
    );

    const rows = d1Query(
      `SELECT result_visibility, discovery_state, session_checks_enabled, representation_version FROM poll WHERE owner_user_id = '${seeded.userId}'`,
    );
    expect(rows).toEqual([
      {
        result_visibility: "after_close",
        discovery_state: "unlisted",
        session_checks_enabled: 1,
        representation_version: 1,
      },
    ]);

    // The just-created outcome belongs to the publish redirect, not to a
    // revisited or bookmarked confirmation URL.
    await page.goto(page.url().replace("?created", ""));
    await expect(page.getByText("Your Poll is live.")).toHaveCount(0);
    await expect(page).toHaveTitle("Where should we eat? — Oddspark Polls");

    // Generated references are case-sensitive base64url — a case-mangled
    // variant must NOT resolve or redirect (only custom links fold case).
    const canonical =
      (await page.locator(".canonical-url").textContent())?.trim() ?? "";
    const generatedPath = new URL(canonical).pathname;
    // Anchored to the final path segment: a lettered prefix (base, marker)
    // must never be what gets mangled.
    const mangledPath = generatedPath.replace(/[a-zA-Z](?=[^/]*$)/, (char) =>
      char === char.toUpperCase()
        ? char.toLowerCase()
        : char.toUpperCase(),
    );
    expect(mangledPath).not.toBe(generatedPath);
    const mangledResponse = await page.request.get(mangledPath, {
      maxRedirects: 0,
    });
    expect(mangledResponse.status()).toBe(404);
  });

  test("publishes a mixed-case Custom Link as the only canonical reference and resolves it", async ({
    page,
    context,
    baseURL,
  }) => {
    const seeded = await signIn(context, baseURL);
    await page.goto("/creator/new");
    await page.getByLabel("QUESTION").fill("Team lunch?");
    await page.getByRole("textbox", { name: "OPTION 1" }).fill("Pizza");
    await page.getByRole("textbox", { name: "OPTION 2" }).fill("Tacos");
    await page.getByLabel("CUSTOM LINK (OPTIONAL)").fill("  Team-Lunch  ");

    const [publishResponse] = await Promise.all([
      page.waitForResponse(
        (candidate) =>
          candidate.url().includes("/creator/new") &&
          candidate.request().method() === "POST",
      ),
      page.getByRole("button", { name: "PUBLISH POLL" }).click(),
    ]);
    expect(publishResponse.status()).toBe(303);

    const canonicalUrl = `${requireBaseUrl(baseURL)}/team-lunch`;
    await expect(page.locator(".canonical-url")).toHaveText(canonicalUrl);
    await expect(page.getByText("Its reference never changes.")).toBeVisible();
    expect(
      d1Query(
        `SELECT r.reference, r.kind, r.is_canonical FROM poll_reference r JOIN poll p ON p.id = r.poll_id WHERE p.owner_user_id = '${seeded.userId}'`,
      ),
    ).toEqual([
      { reference: "team-lunch", kind: "custom", is_canonical: 1 },
    ]);

    const publicResponse = await page.goto("/team-lunch");
    expect(publicResponse?.status()).toBe(200);
    await expect(
      page.getByRole("heading", { name: "Team lunch?" }),
    ).toBeVisible();
    await expect(page.getByText("Pizza")).toBeVisible();
    await expect(page.getByText("Tacos")).toBeVisible();

    // A case variant of the custom link redirects to the canonical form
    // instead of 404ing (Story 1.4 review decision) — query string kept,
    // caching suppressed so a wrong redirect is never permanent.
    const variantResponse = await page.request.get(
      "/TEAM-Lunch?ref=newsletter",
      { maxRedirects: 0 },
    );
    expect(variantResponse.status()).toBe(301);
    expect(variantResponse.headers()["location"]).toBe(
      "/team-lunch?ref=newsletter",
    );
    expect(variantResponse.headers()["cache-control"]).toContain("no-store");
  });

  test("re-renders an invalid submission as 422 with the Voice copy and values preserved", async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, baseURL);
    await page.goto("/creator/new");
    await page.getByRole("textbox", { name: "OPTION 1" }).fill("Pizza");
    await page.getByRole("textbox", { name: "OPTION 2" }).fill("Tacos");
    await page.getByLabel("CUSTOM LINK (OPTIONAL)").fill("team-lunch");

    const [response] = await Promise.all([
      page.waitForResponse(
        (candidate) =>
          candidate.url().includes("/creator/new") &&
          candidate.request().method() === "POST",
      ),
      page.getByRole("button", { name: "PUBLISH POLL" }).click(),
    ]);
    expect(response.status()).toBe(422);

    await expect(page).toHaveURL(/\/creator\/new$/);
    await expect(
      page.getByText("A Poll needs a question. Ask something."),
    ).toBeVisible();
    await expect(page.getByRole("textbox", { name: "OPTION 1" })).toHaveValue("Pizza");
    await expect(page.getByRole("textbox", { name: "OPTION 2" })).toHaveValue("Tacos");
    await expect(page.getByLabel("CUSTOM LINK (OPTIONAL)")).toHaveValue(
      "team-lunch",
    );
  });

  test("validates a reserved Custom Link on submit with accessible inline copy and all values preserved", async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, baseURL);
    await page.goto("/creator/new");
    await page.getByLabel("QUESTION").fill("Where should the team eat?");
    await page.getByRole("textbox", { name: "OPTION 1" }).fill("Pizza");
    await page.getByRole("textbox", { name: "OPTION 2" }).fill("Tacos");
    await page.locator("label.poll-option", { hasText: "AFTER CLOSE" }).click();
    await page.getByLabel("DESCRIPTION (OPTIONAL)").fill("Friday lunch.");
    const customLink = page.getByLabel("CUSTOM LINK (OPTIONAL)");
    await customLink.fill("  Creator  ");
    await customLink.blur();

    // Submit-only validation: no blur check, availability state, or preview.
    await expect(customLink).not.toHaveAttribute("aria-invalid");
    await expect(page.locator("#custom-link-error")).toHaveCount(0);

    const [response] = await Promise.all([
      page.waitForResponse(
        (candidate) =>
          candidate.url().includes("/creator/new") &&
          candidate.request().method() === "POST",
      ),
      page.getByRole("button", { name: "PUBLISH POLL" }).click(),
    ]);
    expect(response.status()).toBe(422);

    await expect(customLink).toHaveValue("  Creator  ");
    await expect(customLink).toHaveAttribute("aria-invalid", "true");
    // Error-first reading order: the failure announces before the hint.
    await expect(customLink).toHaveAttribute(
      "aria-describedby",
      "custom-link-error custom-link-help",
    );
    // Lowercase-only field: no mobile autocapitalize/spellcheck interference.
    await expect(customLink).toHaveAttribute("autocapitalize", "none");
    await expect(customLink).toHaveAttribute("spellcheck", "false");
    await expect(customLink).toHaveAttribute("autocomplete", "off");
    await expect(page.locator("#custom-link-error")).toHaveText(
      "`creator` is reserved by the application itself. Pick something less structural.",
    );
    await expect(page.getByLabel("QUESTION")).toHaveValue(
      "Where should the team eat?",
    );
    await expect(page.getByRole("textbox", { name: "OPTION 1" })).toHaveValue(
      "Pizza",
    );
    await expect(page.getByRole("textbox", { name: "OPTION 2" })).toHaveValue(
      "Tacos",
    );
    await expect(
      page.locator('input[name="visibility"][value="after_close"]'),
    ).toBeChecked();
    await expect(page.getByLabel("DESCRIPTION (OPTIONAL)")).toHaveValue(
      "Friday lunch.",
    );

    await customLink.fill("results");
    const [resultsResponse] = await Promise.all([
      page.waitForResponse(
        (candidate) =>
          candidate.url().includes("/creator/new") &&
          candidate.request().method() === "POST",
      ),
      page.getByRole("button", { name: "PUBLISH POLL" }).click(),
    ]);
    expect(resultsResponse.status()).toBe(422);
    await expect(page.locator("#custom-link-error")).toHaveText(
      "`results` is reserved by the application itself. Pick something less structural.",
    );
  });

  test("maps a duplicate Custom Link to a preserved 422 and rolls the failed batch back", async ({
    page,
    context,
    baseURL,
  }) => {
    const seeded = await signIn(context, baseURL);
    await page.goto("/creator/new");
    await page.getByLabel("QUESTION").fill("Original lunch?");
    await page.getByRole("textbox", { name: "OPTION 1" }).fill("Pizza");
    await page.getByRole("textbox", { name: "OPTION 2" }).fill("Tacos");
    await page.getByLabel("CUSTOM LINK (OPTIONAL)").fill("duplicate-lunch");
    await page.getByRole("button", { name: "PUBLISH POLL" }).click();
    await expect(page).toHaveURL(/\/creator\/polls\/[^?]+\?created/);

    await page.goto("/creator/new");
    await page.getByLabel("QUESTION").fill("Second lunch?");
    await page.getByRole("textbox", { name: "OPTION 1" }).fill("Soup");
    await page.getByRole("textbox", { name: "OPTION 2" }).fill("Salad");
    await page.locator("label.poll-option", { hasText: "AFTER CLOSE" }).click();
    await page.getByLabel("DEADLINE (OPTIONAL)").fill("2030-01-15T10:30");
    await page.getByLabel("CUSTOM LINK (OPTIONAL)").fill("  Duplicate-Lunch  ");
    await page.getByLabel("DESCRIPTION (OPTIONAL)").fill("Keep this ballast.");

    const [duplicateResponse] = await Promise.all([
      page.waitForResponse(
        (candidate) =>
          candidate.url().includes("/creator/new") &&
          candidate.request().method() === "POST",
      ),
      page.getByRole("button", { name: "PUBLISH POLL" }).click(),
    ]);
    expect(duplicateResponse.status()).toBe(422);

    const customLink = page.getByLabel("CUSTOM LINK (OPTIONAL)");
    await expect(customLink).toHaveValue("  Duplicate-Lunch  ");
    await expect(customLink).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#custom-link-error")).toHaveText(
      "`duplicate-lunch` is taken. Pick another.",
    );
    await expect(page.getByLabel("QUESTION")).toHaveValue("Second lunch?");
    await expect(page.getByRole("textbox", { name: "OPTION 1" })).toHaveValue(
      "Soup",
    );
    await expect(page.getByRole("textbox", { name: "OPTION 2" })).toHaveValue(
      "Salad",
    );
    await expect(
      page.locator('input[name="visibility"][value="after_close"]'),
    ).toBeChecked();
    await expect(page.getByLabel("DEADLINE (OPTIONAL)")).toHaveValue(
      "2030-01-15T10:30",
    );
    await expect(page.getByLabel("DESCRIPTION (OPTIONAL)")).toHaveValue(
      "Keep this ballast.",
    );

    expect(
      d1Query(
        `SELECT COUNT(*) AS n FROM poll WHERE owner_user_id = '${seeded.userId}'`,
      ),
    ).toEqual([{ n: 1 }]);
    expect(
      d1Query(
        `SELECT COUNT(*) AS n FROM poll_option o JOIN poll p ON p.id = o.poll_id WHERE p.owner_user_id = '${seeded.userId}'`,
      ),
    ).toEqual([{ n: 2 }]);
    expect(
      d1Query(
        `SELECT r.reference, r.kind, r.is_canonical FROM poll_reference r JOIN poll p ON p.id = r.poll_id WHERE p.owner_user_id = '${seeded.userId}'`,
      ),
    ).toEqual([
      { reference: "duplicate-lunch", kind: "custom", is_canonical: 1 },
    ]);
  });

  test("echoes an unparseable deadline the datetime input would blank out", async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, baseURL);
    await page.goto("/creator/new");
    const csrfToken = await page
      .locator('input[name="csrf_token"]')
      .getAttribute("value");

    const body = new URLSearchParams();
    body.set("csrf_token", csrfToken ?? "");
    body.set("question", "Echo probe?");
    body.append("option", "A");
    body.append("option", "B");
    body.set("visibility", "live");
    body.set("deadline", "not-a-date");
    body.set("intent", "publish");
    const response = await page.request.post("/creator/new", {
      data: body.toString(),
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: requireBaseUrl(baseURL),
        "sec-fetch-site": "same-origin",
      },
      maxRedirects: 0,
    });

    // The 422 re-render's datetime-local input can't hold the invalid value —
    // the error line carries it instead.
    expect(response.status()).toBe(422);
    const html = await response.text();
    expect(html).toContain("Check the date and time.");
    expect(html).toContain("(You entered: not-a-date)");
  });

  test("escapes creator text on the confirmation and root-path pages", async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, baseURL);
    await page.goto("/creator/new");
    await page.getByLabel("QUESTION").fill("<script>alert(1)</script>");
    await page.getByRole("textbox", { name: "OPTION 1" }).fill("Pizza<script>alert(1)</script>");
    await page.getByRole("textbox", { name: "OPTION 2" }).fill("Tacos");
    await page.getByRole("button", { name: "PUBLISH POLL" }).click();

    await expect(page).toHaveURL(/\/creator\/polls\/[^?]+\?created/);
    expect(await page.content()).not.toContain("<script>alert(1)</script>");
    await expect(
      page.getByRole("heading", { name: "<script>alert(1)</script>" }),
    ).toBeVisible();

    const canonical = await page.locator(".canonical-url").textContent();
    expect(canonical).toBeTruthy();
    await page.goto(canonical ?? "");
    expect(await page.content()).not.toContain("<script>alert(1)</script>");
    await expect(
      page.getByText("Pizza<script>alert(1)</script>"),
    ).toBeVisible();
  });

  test("publishes when Enter is pressed in a text field", async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, baseURL);
    await page.goto("/creator/new");
    await page.getByLabel("QUESTION").fill("Enter-key poll?");
    await page.getByRole("textbox", { name: "OPTION 1" }).fill("Yes");
    await page.getByRole("textbox", { name: "OPTION 2" }).fill("No");
    await page.getByRole("textbox", { name: "OPTION 2" }).press("Enter");

    // Implicit submission must default to publish, not to ADD OPTION.
    await expect(page).toHaveURL(/\/creator\/polls\/[^?]+\?created/);
    await expect(page.getByText("Your Poll is live.")).toBeVisible();
  });

  test("adds an option row client-side when ADD OPTION is clicked", async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, baseURL);
    await page.goto("/creator/new");
    const rows = page.locator("[data-option-row]");
    await expect(rows).toHaveCount(4);
    // Every remove control names its own row.
    await expect(
      rows.nth(0).getByRole("button", { name: "Remove option 1" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "ADD OPTION" }).click();
    await expect(rows).toHaveCount(5);
    await expect(page.getByRole("textbox", { name: "OPTION 5" })).toBeFocused();
    await expect(
      rows.nth(4).getByRole("button", { name: "Remove option 5" }),
    ).toBeVisible();
  });

  test("keeps focus in the form when a focused REMOVE deletes its row", async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, baseURL);
    await page.goto("/creator/new");
    const rows = page.locator("[data-option-row]");

    // Removing a middle row moves focus to the previous row's input.
    await rows.nth(2).getByRole("button", { name: "Remove option 3" }).click();
    await expect(rows).toHaveCount(3);
    expect(await page.evaluate(() => document.activeElement?.id)).toBe(
      "option-2",
    );

    // Removing the first row falls forward to the new first row.
    await rows.nth(0).getByRole("button", { name: "Remove option 1" }).click();
    await expect(rows).toHaveCount(2);
    expect(await page.evaluate(() => document.activeElement?.id)).toBe(
      "option-1",
    );

    // At the 2-row floor REMOVE clears instead of deleting — focus stays.
    await page
      .getByRole("textbox", { name: "OPTION 1" })
      .fill("Something");
    await rows.nth(0).getByRole("button", { name: "Remove option 1" }).click();
    await expect(rows).toHaveCount(2);
    expect(await page.evaluate(() => document.activeElement?.id)).toBe(
      "option-1",
    );
    await expect(page.getByRole("textbox", { name: "OPTION 1" })).toHaveValue(
      "",
    );
  });

  test("adds an option row server-side without JavaScript instead of publishing", async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const seeded = await signIn(context, baseURL);
    const page = await context.newPage();
    await page.goto("/creator/new");
    await page.getByLabel("QUESTION").fill("No-JS round-trip?");
    await page.getByRole("textbox", { name: "OPTION 1" }).fill("Alpha");
    await page.getByRole("textbox", { name: "OPTION 2" }).fill("Beta");
    await page.getByLabel("CUSTOM LINK (OPTIONAL)").fill("Team-Lunch");
    await page.locator("label.poll-option", { hasText: "SEVERAL" }).click();
    await page.getByLabel("MIN (OPTIONAL)").fill("2");
    await page.getByLabel("MAX (OPTIONAL)").fill("3");

    await page.getByRole("button", { name: "ADD OPTION" }).click();
    await expect(page).toHaveURL(/\/creator\/new$/);
    await expect(page.locator("[data-option-row]")).toHaveCount(5);
    await expect(page.getByLabel("QUESTION")).toHaveValue("No-JS round-trip?");
    await expect(page.getByRole("textbox", { name: "OPTION 1" })).toHaveValue("Alpha");
    await expect(page.getByRole("textbox", { name: "OPTION 2" })).toHaveValue("Beta");
    await expect(page.getByLabel("CUSTOM LINK (OPTIONAL)")).toHaveValue(
      "Team-Lunch",
    );
    await expect(
      page.locator('input[name="multiSelect"][value="true"]'),
    ).toBeChecked();
    await expect(page.getByLabel("MIN (OPTIONAL)")).toHaveValue("2");
    await expect(page.getByLabel("MAX (OPTIONAL)")).toHaveValue("3");

    // The regression being pinned: ADD OPTION must never create a poll.
    const polls = d1Query(
      `SELECT COUNT(*) AS n FROM poll WHERE owner_user_id = '${seeded.userId}'`,
    );
    expect(polls[0]?.n).toBe(0);

    await context.close();
  });

  test("declines a no-JS ADD OPTION at the cap with 200 guidance, values intact", async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, baseURL);
    await page.goto("/creator/new");
    const csrfToken = await page
      .locator('input[name="csrf_token"]')
      .getAttribute("value");

    const body = new URLSearchParams();
    body.set("csrf_token", csrfToken ?? "");
    body.set("question", "Full house?");
    body.set("visibility", "live");
    body.set("intent", "add-option");
    for (let index = 1; index <= 30; index += 1) {
      body.append("option", `Option ${index}`);
    }
    const response = await page.request.post("/creator/new", {
      data: body.toString(),
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: requireBaseUrl(baseURL),
        "sec-fetch-site": "same-origin",
      },
      maxRedirects: 0,
    });

    // Nothing was validated — the decline is guidance on a 200, not a 422.
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).toContain("too many options. Keep it to 30.");
    expect(html.match(/data-option-row/g)).toHaveLength(30);
    expect(html).toContain('value="Option 30"');
    expect(html).toContain('value="Full house?"');
  });

  test("bounds re-rendered option rows at the render ceiling", async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, baseURL);
    await page.goto("/creator/new");
    const csrfToken = await page
      .locator('input[name="csrf_token"]')
      .getAttribute("value");

    const post = (intent, filler) => {
      const body = new URLSearchParams();
      body.set("csrf_token", csrfToken ?? "");
      body.set("question", "Ceiling probe?");
      body.set("visibility", "live");
      body.set("intent", intent);
      body.append("option", "A");
      body.append("option", "B");
      for (const value of filler) {
        body.append("option", value);
      }
      return page.request.post("/creator/new", {
        data: body.toString(),
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: requireBaseUrl(baseURL),
          "sec-fetch-site": "same-origin",
        },
        maxRedirects: 0,
      });
    };

    // 150 non-blank options: validation rejects (>30) and the 422 re-render
    // is bounded at 100 rows rather than echoing all 150.
    const overCap = await post(
      "publish",
      Array.from({ length: 148 }, (_, index) => `Filler ${index}`),
    );
    expect(overCap.status()).toBe(422);
    const overCapHtml = await overCap.text();
    expect(overCapHtml).toContain("too many options. Keep it to 30.");
    expect(overCapHtml.match(/data-option-row/g)).toHaveLength(100);

    // 100 raw rows, only 2 non-blank: ADD OPTION declines against the
    // ceiling with its own line — the 30-option copy would name the wrong
    // limit.
    const atCeiling = await post(
      "add-option",
      Array.from({ length: 98 }, () => ""),
    );
    expect(atCeiling.status()).toBe(200);
    const atCeilingHtml = await atCeiling.text();
    expect(atCeilingHtml).toContain("too many rows. Clear the blank ones first.");
    expect(atCeilingHtml.match(/data-option-row/g)).toHaveLength(100);
  });

  test("disables ADD OPTION at 30 non-blank options and re-enables after a remove", async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, baseURL);
    await page.goto("/creator/new");
    const rows = page.locator("[data-option-row]");
    const addButton = page.getByRole("button", { name: "ADD OPTION" });
    await expect(rows).toHaveCount(4);

    // Blank rows don't count toward the cap — 30 blank rows stay addable.
    for (let count = 4; count < 30; count += 1) {
      await addButton.click();
    }
    await expect(rows).toHaveCount(30);
    await expect(addButton).toBeEnabled();

    // Filling all 30 hits the non-blank cap — the server enforces the same
    // rule on the no-JS round-trip.
    for (let index = 0; index < 30; index += 1) {
      await rows.nth(index).locator("input").fill(`Option ${index + 1}`);
    }
    await expect(addButton).toBeDisabled();

    await rows.nth(29).getByRole("button", { name: "Remove option 30" }).click();
    await expect(rows).toHaveCount(29);
    await expect(addButton).toBeEnabled();
  });

  test("echoes the resolved deadline in plain UTC on the confirmation page", async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, baseURL);
    await page.goto("/creator/new");
    await page.getByLabel("QUESTION").fill("Deadline poll?");
    await page.getByRole("textbox", { name: "OPTION 1" }).fill("Yes");
    await page.getByRole("textbox", { name: "OPTION 2" }).fill("No");
    await page.getByLabel("DEADLINE (OPTIONAL)").fill("2030-01-15T10:30");
    await page.getByRole("button", { name: "PUBLISH POLL" }).click();

    await expect(page).toHaveURL(/\/creator\/polls\/[^?]+\?created/);
    await expect(
      page.getByText(/Voting closes \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC\./),
    ).toBeVisible();
  });

  test("mints exactly one poll when the same form is POSTed twice", async ({
    page,
    context,
    baseURL,
  }) => {
    const seeded = await signIn(context, baseURL);
    await page.goto("/creator/new");
    const csrfToken = await page
      .locator('input[name="csrf_token"]')
      .getAttribute("value");
    const pollId = await page
      .locator('input[name="poll_id"]')
      .getAttribute("value");
    expect(csrfToken).toBeTruthy();
    expect(pollId).toBeTruthy();

    // The no-JS double-click / retried-POST case (D4): same nonce twice.
    // (Serialized by hand — Playwright's `form` option can't repeat fields.)
    const body = new URLSearchParams();
    body.set("csrf_token", csrfToken ?? "");
    body.set("poll_id", pollId ?? "");
    body.set("timezone", "");
    body.set("question", "Double POST poll?");
    body.append("option", "A");
    body.append("option", "B");
    body.set("visibility", "live");
    body.set("deadline", "");
    body.set("intent", "publish");
    const headers = {
      "content-type": "application/x-www-form-urlencoded",
      origin: requireBaseUrl(baseURL),
      "sec-fetch-site": "same-origin",
    };
    const first = await page.request.post("/creator/new", {
      data: body.toString(),
      headers,
      maxRedirects: 0,
    });
    const second = await page.request.post("/creator/new", {
      data: body.toString(),
      headers,
      maxRedirects: 0,
    });

    expect(first.status()).toBe(303);
    expect(second.status()).toBe(303);
    const location = first.headers()["location"] ?? "";
    expect(location).toContain(`/creator/polls/${pollId}?created`);
    expect(second.headers()["location"]).toBe(location);

    const polls = d1Query(
      `SELECT COUNT(*) AS n FROM poll WHERE owner_user_id = '${seeded.userId}'`,
    );
    expect(polls[0]?.n).toBe(1);
  });

  test("rejects a divergent resubmission of the same nonce and recovers with a fresh one", async ({
    page,
    context,
    baseURL,
  }) => {
    const seeded = await signIn(context, baseURL);
    await page.goto("/creator/new");
    const csrfToken = await page
      .locator('input[name="csrf_token"]')
      .getAttribute("value");
    const pollId = await page
      .locator('input[name="poll_id"]')
      .getAttribute("value");

    // Back-button → edit → publish: same nonce, different content.
    const post = (nonce, question) => {
      const body = new URLSearchParams();
      body.set("csrf_token", csrfToken ?? "");
      body.set("poll_id", nonce);
      body.set("question", question);
      body.append("option", "A");
      body.append("option", "B");
      body.set("visibility", "live");
      body.set("intent", "publish");
      return page.request.post("/creator/new", {
        data: body.toString(),
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: requireBaseUrl(baseURL),
          "sec-fetch-site": "same-origin",
        },
        maxRedirects: 0,
      });
    };

    const first = await post(pollId ?? "", "Original question?");
    expect(first.status()).toBe(303);

    const divergent = await post(pollId ?? "", "Edited after the fact?");
    expect(divergent.status()).toBe(422);
    const html = await divergent.text();
    expect(html).toContain("That Poll already published. Start a new one.");

    // Only the first publish exists — the divergent edit minted nothing.
    let polls = d1Query(
      `SELECT COUNT(*) AS n FROM poll WHERE owner_user_id = '${seeded.userId}'`,
    );
    expect(polls[0]?.n).toBe(1);

    // The 422 re-render carries a fresh nonce; publishing with it succeeds.
    const freshNonce = /name="poll_id" value="([^"]+)"/.exec(html)?.[1];
    expect(freshNonce).toBeTruthy();
    expect(freshNonce).not.toBe(pollId);
    const recovered = await post(freshNonce ?? "", "Edited after the fact?");
    expect(recovered.status()).toBe(303);
    polls = d1Query(
      `SELECT COUNT(*) AS n FROM poll WHERE owner_user_id = '${seeded.userId}'`,
    );
    expect(polls[0]?.n).toBe(2);
  });

  test("answers a forged idempotency ID with a server-error re-render, not a redirect", async ({
    page,
    context,
    baseURL,
  }) => {
    // A nonce colliding with SOMEONE ELSE'S poll must never redirect to it.
    const victim = await signIn(context, baseURL);
    await page.goto("/creator/new");
    await page.getByLabel("QUESTION").fill("Victim's poll?");
    await page.getByRole("textbox", { name: "OPTION 1" }).fill("A");
    await page.getByRole("textbox", { name: "OPTION 2" }).fill("B");
    await page.getByRole("button", { name: "PUBLISH POLL" }).click();
    await expect(page).toHaveURL(/\/creator\/polls\/[^?]+\?created/);
    const victimPollId = page
      .url()
      .match(/\/creator\/polls\/([^?]+)\?created/)?.[1];
    expect(victimPollId).toBeTruthy();

    const attacker = await signIn(context, baseURL);
    await page.goto("/creator/new");
    const csrfToken = await page
      .locator('input[name="csrf_token"]')
      .getAttribute("value");
    const body = new URLSearchParams();
    body.set("csrf_token", csrfToken ?? "");
    body.set("poll_id", victimPollId ?? "");
    body.set("question", "Forged collision?");
    body.append("option", "A");
    body.append("option", "B");
    body.set("visibility", "live");
    body.set("intent", "publish");
    const forged = await page.request.post("/creator/new", {
      data: body.toString(),
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: requireBaseUrl(baseURL),
        "sec-fetch-site": "same-origin",
      },
      maxRedirects: 0,
    });

    // Server-side failure registers as 500 (telemetry "error"), not 422.
    expect(forged.status()).toBe(500);
    // The nonce may already be a live Poll — "nothing was created" would be
    // a lie, so the unconfirmable-retry copy shows instead.
    expect(await forged.text()).toContain("may have published. Try again");
    expect(
      d1Query(
        `SELECT COUNT(*) AS n FROM poll WHERE owner_user_id = '${attacker.userId}'`,
      )[0]?.n,
    ).toBe(0);
    expect(
      d1Query(
        `SELECT COUNT(*) AS n FROM poll WHERE owner_user_id = '${victim.userId}'`,
      )[0]?.n,
    ).toBe(1);
  });

  test("shows no just-created outcome for a valued ?created param", async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, baseURL);
    await page.goto("/creator/new");
    await page.getByLabel("QUESTION").fill("Valued created param?");
    await page.getByRole("textbox", { name: "OPTION 1" }).fill("A");
    await page.getByRole("textbox", { name: "OPTION 2" }).fill("B");
    await page.getByRole("button", { name: "PUBLISH POLL" }).click();
    await expect(page).toHaveURL(/\/creator\/polls\/[^?]+\?created/);

    await page.goto(page.url().replace("?created", "?created=lol"));
    await expect(page.getByText("Your Poll is live.")).toHaveCount(0);
    await expect(page).toHaveTitle("Valued created param? — Oddspark Polls");
  });

  test("ages out of the just-created window and dedupes a late retry without ?created", async ({
    page,
    context,
    baseURL,
  }) => {
    const seeded = await signIn(context, baseURL);
    await page.goto("/creator/new");
    const csrfToken = await page
      .locator('input[name="csrf_token"]')
      .getAttribute("value");
    const pollId = await page
      .locator('input[name="poll_id"]')
      .getAttribute("value");
    expect(pollId).toBeTruthy();

    const post = () => {
      const body = new URLSearchParams();
      body.set("csrf_token", csrfToken ?? "");
      body.set("poll_id", pollId ?? "");
      body.set("question", "Aged poll?");
      body.append("option", "A");
      body.append("option", "B");
      body.set("visibility", "live");
      body.set("intent", "publish");
      return page.request.post("/creator/new", {
        data: body.toString(),
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: requireBaseUrl(baseURL),
          "sec-fetch-site": "same-origin",
        },
        maxRedirects: 0,
      });
    };

    const first = await post();
    expect(first.status()).toBe(303);
    expect(first.headers()["location"]).toBe(
      `/creator/polls/${pollId}?created`,
    );

    // Backdate the poll beyond the 10-minute freshness window.
    agePoll(pollId ?? "", Date.now() - 11 * 60 * 1000);

    // Bare ?created on an aged poll shows no outcome line.
    await page.goto(`/creator/polls/${pollId}?created`);
    await expect(page.getByText("Your Poll is live.")).toHaveCount(0);
    await expect(page).toHaveTitle("Aged poll? — Oddspark Polls");

    // A late identical retry still dedupes — onto the plain confirmation.
    const retry = await post();
    expect(retry.status()).toBe(303);
    expect(retry.headers()["location"]).toBe(`/creator/polls/${pollId}`);
    const polls = d1Query(
      `SELECT COUNT(*) AS n FROM poll WHERE owner_user_id = '${seeded.userId}'`,
    );
    expect(polls[0]?.n).toBe(1);
  });
});
