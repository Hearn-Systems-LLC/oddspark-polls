import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import {
  assertUuid,
  cleanupCreators,
  d1Query,
  hasBetterAuthSecret,
  requireBaseUrl,
  seedCreatorSession,
  sql,
} from "./creator-session.mjs";

// Story 2.2 — IP Checks: same-network different-browser rejection, Session
// composition, IPv6 /64, privacy, and accessible read-only state.

if (!hasBetterAuthSecret()) {
  throw new Error(
    "Story 2.2 E2E requires BETTER_AUTH_SECRET in .dev.vars; skipping IP Checks proof is forbidden",
  );
}

const proofDir = "test-results/story-2-2-ip-checks-proof";
mkdirSync(proofDir, { recursive: true });

const IP_COPY_HEADING = "Someone on this connection already voted.";
const SESSION_COPY_HEADING = "You've already voted here.";

test.describe.configure({ mode: "serial", timeout: 180_000 });

test.describe("IP Checks", () => {
  const seededUserIds = [];
  let browserErrors = [];

  function observePage(page) {
    page.on("console", (message) => {
      const text = message.text();
      // Only the deliberately asserted stale-form rejection may produce an
      // error-status document in this suite. A 429 or 500 is unexpected and
      // must remain visible to the clean-console gate.
      const expectedFormResponse =
        /^Failed to load resource: the server responded with a status of 422 \(/u.test(
          text,
        ) && message.location().url === page.url();
      if (message.type() === "error" && !expectedFormResponse) {
        browserErrors.push(text);
      }
    });
    page.on("pageerror", (error) => {
      browserErrors.push(error.message);
    });
    return page;
  }

  test.beforeEach(() => {
    browserErrors = [];
  });

  test.afterEach(() => {
    expect(browserErrors).toEqual([]);
  });

  test.afterAll(() => {
    cleanupCreators(seededUserIds);
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

  /**
   * Inject a trusted Cloudflare client identity on every request for this
   * browser context. Local wrangler does not set CF-Connecting-IP by default.
   */
  async function pinClientIp(context, ip) {
    await context.route("**/*", async (route) => {
      const headers = {
        ...route.request().headers(),
        "cf-connecting-ip": ip,
      };
      await route.continue({ headers });
    });
  }

  async function setToggle(page, label, on) {
    const inputName =
      label === "Session Checks"
        ? "sessionChecks"
        : label === "IP Checks"
          ? "ipChecks"
          : null;
    if (!inputName) {
      throw new Error(`unknown toggle label: ${label}`);
    }
    const checkbox = page.locator(`input[name="${inputName}"]`);
    const isChecked = await checkbox.isChecked();
    if (isChecked !== on) {
      await page.locator("label.security-toggle", { hasText: label }).click();
    }
    if (on) {
      await expect(checkbox).toBeChecked();
    } else {
      await expect(checkbox).not.toBeChecked();
    }
  }

  async function publishIpPoll(page, context, baseURL, {
    ipChecks = true,
    resultVisibility = "live",
    sessionChecks = false,
    question = "IP check?",
  } = {}) {
    await signIn(context, baseURL);
    const reference = `ip-${randomUUID().slice(0, 8)}`;
    await page.goto("/creator/new");
    await page.getByLabel("QUESTION").fill(question);
    await page.getByRole("textbox", { name: "OPTION 1" }).fill("Alpha");
    await page.getByRole("textbox", { name: "OPTION 2" }).fill("Beta");
    await page.getByLabel("CUSTOM LINK (OPTIONAL)").fill(reference);

    const visibilityLabel = {
      live: "LIVE",
      after_close: "AFTER CLOSE",
      creator_only: "CREATOR-ONLY",
    }[resultVisibility];
    if (!visibilityLabel) {
      throw new Error(`unknown result visibility: ${resultVisibility}`);
    }
    if (resultVisibility !== "live") {
      await page
        .locator("label.poll-option", { hasText: visibilityLabel })
        .click();
    }

    await setToggle(page, "Session Checks", sessionChecks);
    await setToggle(page, "IP Checks", ipChecks);

    await page.getByRole("button", { name: "PUBLISH POLL" }).click();
    await expect(page).toHaveURL(/\/creator\/polls\//, { timeout: 30_000 });
    const pollId = /\/creator\/polls\/([^?]+)/.exec(page.url())?.[1] ?? "";
    assertUuid(pollId);

    const toggleRow = d1Query(
      sql`SELECT session_checks_enabled, ip_checks_enabled, result_visibility FROM poll WHERE id = ${pollId}`,
    );
    expect(toggleRow[0]?.session_checks_enabled).toBe(sessionChecks ? 1 : 0);
    expect(toggleRow[0]?.ip_checks_enabled).toBe(ipChecks ? 1 : 0);
    expect(toggleRow[0]?.result_visibility).toBe(resultVisibility);

    await context.clearCookies();
    return { path: `/${reference}`, pollId, reference };
  }

  async function castVote(page, optionLabel) {
    await page.locator("label.poll-option", { hasText: optionLabel }).click();
    await page.getByRole("button", { name: "VOTE" }).click();
  }

  async function screenshotProof(page, label) {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.setViewportSize({ width: 375, height: 900 });
    await page.screenshot({
      path: `${proofDir}/${label}-375-dark.png`,
      fullPage: true,
    });
    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({
      path: `${proofDir}/${label}-1280-light.png`,
      fullPage: true,
    });
  }

  test("second browser on the same network is rejected with IP copy and unchanged tally", async ({
    browser,
    baseURL,
  }) => {
    const publisher = await browser.newContext();
    const page = observePage(await publisher.newPage());
    const poll = await publishIpPoll(page, publisher, baseURL, {
      ipChecks: true,
      sessionChecks: false,
      question: "Same network?",
    });
    await publisher.close();

    const sharedIp = "203.0.113.77";

    // Load browser B's form BEFORE browser A commits (stale form proof).
    const browserB = await browser.newContext();
    await pinClientIp(browserB, sharedIp);
    const pageB = observePage(await browserB.newPage());
    await pageB.goto(poll.path);
    await pageB.locator("label.poll-option", { hasText: "Alpha" }).click();
    const submissionB = await pageB
      .locator('input[name="submission_id"]')
      .inputValue();

    const browserA = await browser.newContext();
    await pinClientIp(browserA, sharedIp);
    const pageA = observePage(await browserA.newPage());
    await pageA.goto(poll.path);
    await castVote(pageA, "Beta");
    await expect(pageA.getByText("Counted.")).toBeVisible({ timeout: 15_000 });

    const versionAfterA = d1Query(
      sql`SELECT representation_version AS v FROM poll WHERE id = ${poll.pollId}`,
    )[0].v;
    const votesAfterA = d1Query(
      sql`SELECT COUNT(*) AS n FROM vote WHERE poll_id = ${poll.pollId}`,
    )[0].n;

    // Submit browser B's pre-loaded form.
    const [rejectionResponse] = await Promise.all([
      pageB.waitForResponse(
        (candidate) =>
          candidate.request().method() === "POST" &&
          new URL(candidate.url()).pathname === poll.path,
      ),
      pageB.getByRole("button", { name: "VOTE" }).click(),
    ]);
    expect(rejectionResponse.status()).toBe(422);
    expect(rejectionResponse.headers()["cache-control"]).toBe(
      "private, no-store",
    );
    await expect(pageB.getByText(IP_COPY_HEADING)).toBeVisible({
      timeout: 15_000,
    });
    const rejection = pageB.locator(
      '[data-vote-outcome][data-outcome-code="already_voted_ip"]',
    );
    await expect(rejection).toBeFocused();
    await expect(pageB.getByText(SESSION_COPY_HEADING)).toHaveCount(0);
    await expect(pageB.getByRole("button", { name: "VOTE" })).toHaveCount(0);
    await expect(pageB.getByText("YOUR BALLOT")).toHaveCount(0);
    await expect(pageB.locator("[data-results-tally]")).toBeVisible();
    await expect(pageB).toHaveTitle(/Already voted/);

    const versionAfterB = d1Query(
      sql`SELECT representation_version AS v FROM poll WHERE id = ${poll.pollId}`,
    )[0].v;
    const votesAfterB = d1Query(
      sql`SELECT COUNT(*) AS n FROM vote WHERE poll_id = ${poll.pollId}`,
    )[0].n;
    expect(versionAfterB).toBe(versionAfterA);
    expect(votesAfterB).toBe(votesAfterA);

    // Privacy: no address/token/digest in HTML; digests only in D1 claim rows.
    const html = await pageB.content();

    // GET preflight also shows IP copy.
    await pageB.goto(poll.path);
    await expect(pageB.getByText(IP_COPY_HEADING)).toBeVisible();

    // Cache-control on GET/HEAD via request API with the same identity header.
    const response = await pageB.request.get(
      `${requireBaseUrl(baseURL)}${poll.path}`,
      { headers: { "cf-connecting-ip": sharedIp } },
    );
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("private, no-store");

    const head = await pageB.request.fetch(
      `${requireBaseUrl(baseURL)}${poll.path}`,
      {
        method: "HEAD",
        headers: { "cf-connecting-ip": sharedIp },
      },
    );
    expect(head.status()).toBe(200);
    expect(head.headers()["cache-control"]).toBe("private, no-store");

    const claims = d1Query(
      sql`SELECT digest FROM voter_claim WHERE poll_id = ${poll.pollId}`,
    );
    expect(claims.length).toBe(1);
    expect(claims[0].digest).toMatch(/^[a-f0-9]{64}$/);
    const storedDigest = claims[0].digest;
    const nonClaimStorage = JSON.stringify({
      poll: d1Query(
        sql`SELECT id, question, description, representation_version FROM poll WHERE id = ${poll.pollId}`,
      ),
      vote: d1Query(
        sql`SELECT id, poll_id, submission_id, payload_hash, created_at_ms FROM vote WHERE poll_id = ${poll.pollId}`,
      ),
      selections: d1Query(
        sql`SELECT vote_id, poll_option_id FROM vote_selection WHERE vote_id IN (SELECT id FROM vote WHERE poll_id = ${poll.pollId})`,
      ),
    });
    const responseHeaders = JSON.stringify({
      rejection: rejectionResponse.headers(),
      get: response.headers(),
      head: head.headers(),
    });
    for (const forbidden of [
      sharedIp,
      `v4:${sharedIp}`,
      `v4-full:${sharedIp}`,
      storedDigest,
    ]) {
      expect(html).not.toContain(forbidden);
      expect(responseHeaders).not.toContain(forbidden);
      expect(nonClaimStorage).not.toContain(forbidden);
    }

    expect(submissionB.length).toBeGreaterThan(0);

    await screenshotProof(pageB, "ip-rejection");
    await browserA.close();
    await browserB.close();
  });

  test("same browser with Session Checks receives Session copy, not IP copy", async ({
    browser,
    baseURL,
  }) => {
    const publisher = await browser.newContext();
    const page = observePage(await publisher.newPage());
    const poll = await publishIpPoll(page, publisher, baseURL, {
      ipChecks: true,
      sessionChecks: true,
      question: "Session first?",
    });
    await publisher.close();

    const context = await browser.newContext();
    await pinClientIp(context, "203.0.113.88");
    const voter = observePage(await context.newPage());
    await voter.goto(poll.path);
    await castVote(voter, "Alpha");
    await expect(voter.getByText("Counted.")).toBeVisible({ timeout: 15_000 });

    await voter.goto(poll.path);
    await expect(voter.getByText(SESSION_COPY_HEADING)).toBeVisible();
    await expect(voter.getByText(IP_COPY_HEADING)).toHaveCount(0);

    await context.close();
  });

  test("IP off allows two browsers on one shared network", async ({
    browser,
    baseURL,
  }) => {
    const publisher = await browser.newContext();
    const page = observePage(await publisher.newPage());
    const poll = await publishIpPoll(page, publisher, baseURL, {
      ipChecks: false,
      sessionChecks: true,
      question: "IP off?",
    });
    await publisher.close();

    const sharedIp = "198.51.100.44";
    const a = await browser.newContext();
    await pinClientIp(a, sharedIp);
    const pageA = observePage(await a.newPage());
    await pageA.goto(poll.path);
    await castVote(pageA, "Alpha");
    await expect(pageA.getByText("Counted.")).toBeVisible({ timeout: 15_000 });

    const b = await browser.newContext();
    await pinClientIp(b, sharedIp);
    const pageB = observePage(await b.newPage());
    await pageB.goto(poll.path);
    await castVote(pageB, "Beta");
    await expect(pageB.getByText("Counted.")).toBeVisible({ timeout: 15_000 });

    const votes = d1Query(
      sql`SELECT COUNT(*) AS n FROM vote WHERE poll_id = ${poll.pollId}`,
    )[0].n;
    expect(votes).toBe(2);

    await a.close();
    await b.close();
  });

  test("IP-only read-only state honors hidden Results visibility", async ({
    browser,
    baseURL,
  }) => {
    const publisher = await browser.newContext();
    const page = observePage(await publisher.newPage());
    const poll = await publishIpPoll(page, publisher, baseURL, {
      ipChecks: true,
      resultVisibility: "creator_only",
      sessionChecks: false,
      question: "Private network result?",
    });
    await publisher.close();

    const sharedIp = "198.51.100.91";
    const a = await browser.newContext();
    await pinClientIp(a, sharedIp);
    const pageA = observePage(await a.newPage());
    await pageA.goto(poll.path);
    await castVote(pageA, "Alpha");
    await expect(pageA.getByText("Counted.")).toBeVisible({ timeout: 15_000 });

    const b = await browser.newContext();
    await pinClientIp(b, sharedIp);
    const pageB = observePage(await b.newPage());
    await pageB.goto(poll.path);
    await expect(pageB.getByText(IP_COPY_HEADING)).toBeVisible();
    await expect(pageB.locator("[data-results-tally]")).toHaveCount(0);
    await expect(pageB.locator("[data-results-explanation]")).toHaveAttribute(
      "data-results-state",
      "creator_only_hidden",
    );
    await expect(pageB.locator("[data-results-explanation]")).toHaveText(
      "These results go to the Creator only.",
    );
    await expect(pageB.getByText("YOUR BALLOT")).toHaveCount(0);

    await a.close();
    await b.close();
  });

  test("two IPv6 hosts in the same /64 share the IP claim", async ({
    browser,
    baseURL,
  }) => {
    const publisher = await browser.newContext();
    const page = observePage(await publisher.newPage());
    const poll = await publishIpPoll(page, publisher, baseURL, {
      ipChecks: true,
      sessionChecks: false,
      question: "IPv6 /64?",
    });
    await publisher.close();

    const a = await browser.newContext();
    await pinClientIp(a, "2001:db8:0:0::1");
    const pageA = observePage(await a.newPage());
    await pageA.goto(poll.path);
    await castVote(pageA, "Alpha");
    await expect(pageA.getByText("Counted.")).toBeVisible({ timeout: 15_000 });

    // Host B shares the /64 claim prefix. GET preflight is enough: the IP
    // claim is already present, so the form is read-only with IP copy.
    const b = await browser.newContext();
    await pinClientIp(b, "2001:db8:0:0::2");
    const pageB = observePage(await b.newPage());
    await pageB.goto(poll.path);
    await expect(pageB.getByText(IP_COPY_HEADING)).toBeVisible({
      timeout: 15_000,
    });
    await expect(pageB.getByRole("button", { name: "VOTE" })).toHaveCount(0);
    await expect(pageB.getByText(SESSION_COPY_HEADING)).toHaveCount(0);

    const votes = d1Query(
      sql`SELECT COUNT(*) AS n FROM vote WHERE poll_id = ${poll.pollId}`,
    )[0].n;
    expect(votes).toBe(1);

    await screenshotProof(pageB, "ipv6-64-rejection");
    await a.close();
    await b.close();
  });
});
