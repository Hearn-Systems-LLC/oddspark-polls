import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  agePoll,
  assertUuid,
  cleanupCreator,
  closePoll,
  d1Execute,
  d1Query,
  hasBetterAuthSecret,
  requireBaseUrl,
  seedCreatorSession,
  setPollDeadline,
} from "./creator-session.mjs";

// Story 1.9: conditional live Results polling, privacy, lifecycle behavior,
// accessibility, and visual proof.
test.describe.configure({ mode: "serial", timeout: 120_000 });

const liveRunId = randomUUID().slice(0, 8);
const proofDir = "test-results/live-results-proof";

function scopedReference(reference) {
  return `${reference}-${liveRunId}`;
}

function sqlText(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

test.describe("live-updating results", () => {
  test.skip(
    !hasBetterAuthSecret(),
    "BETTER_AUTH_SECRET is not provisioned in .dev.vars — Poll setup needs the seeded creator harness",
  );

  const seededUserIds = [];
  let pagesUnderTest = [];

  function watchConsole(page) {
    if (pagesUnderTest.some(({ observedPage }) => observedPage === page)) {
      return page;
    }
    const errors = [];
    pagesUnderTest.push({ observedPage: page, errors });
    page.on("console", (message) => {
      if (message.type() === "error") {
        errors.push(message.text());
      }
    });
    page.on("pageerror", (error) => {
      errors.push(error.message);
    });
    return page;
  }

  test.beforeEach(({ page }) => {
    pagesUnderTest = [];
    watchConsole(page);
  });

  test.afterEach(() => {
    for (const { errors } of pagesUnderTest) {
      expect(errors).toEqual([]);
    }
  });

  test.afterAll(() => {
    const cleanupErrors = [];
    for (const userId of seededUserIds) {
      try {
        cleanupCreator(userId);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        cleanupErrors,
        `Failed to clean ${cleanupErrors.length} live Results E2E creator fixture(s)`,
      );
    }
  });

  async function seedOwner() {
    const seeded = await seedCreatorSession();
    assertUuid(seeded.userId);
    seededUserIds.push(seeded.userId);
    return seeded;
  }

  async function signIn(context, baseURL, seeded) {
    await context.addCookies([
      {
        name: "better-auth.session_token",
        value: seeded.cookieValue,
        url: requireBaseUrl(baseURL),
      },
    ]);
  }

  // Seed OPEN first so the real vote-open trigger accepts every fixture Vote,
  // then age the Poll through the shared helper. Closure is always a separate
  // helper call after this function returns.
  function seedPoll({
    ownerId,
    reference,
    visibility = "live",
    options = ["Alpha", "Beta"],
    votes = [],
    multiSelect = false,
  }) {
    assertUuid(ownerId);
    const pollId = randomUUID();
    const optionIds = options.map(() => randomUUID());
    const runReference = scopedReference(reference);
    const nowMs = Date.now();
    const statements = [
      `INSERT INTO poll (id, owner_user_id, poll_type, question, result_visibility, session_checks_enabled, multi_select_enabled, min_selections, max_selections, deadline_ms, closed_at_ms, representation_version, created_at_ms, updated_at_ms) VALUES ('${pollId}', '${ownerId}', 'multiple_choice', 'Live Results?', '${visibility}', 1, ${multiSelect ? 1 : 0}, NULL, NULL, NULL, NULL, ${1 + votes.length}, ${nowMs}, ${nowMs});`,
      ...options.map(
        (label, position) =>
          `INSERT INTO poll_option (id, poll_id, label, position, created_at_ms) VALUES ('${optionIds[position]}', '${pollId}', ${sqlText(label)}, ${position}, ${nowMs});`,
      ),
      `INSERT INTO poll_reference (reference, poll_id, kind, is_canonical, created_at_ms) VALUES (${sqlText(runReference)}, '${pollId}', 'custom', 1, ${nowMs});`,
    ];
    votes.forEach((selections, index) => {
      const voteId = randomUUID();
      statements.push(
        `INSERT INTO vote (id, poll_id, submission_id, payload_hash, created_at_ms) VALUES ('${voteId}', '${pollId}', '${randomUUID()}', 'seed-${liveRunId}-${index}', ${nowMs});`,
        ...selections.map(
          (optionIndex) =>
            `INSERT INTO vote_selection (vote_id, poll_option_id) VALUES ('${voteId}', '${optionIds[optionIndex]}');`,
        ),
      );
    });
    d1Execute(statements.join(""));
    agePoll(pollId, nowMs - 60_000);
    return {
      pollId,
      optionIds,
      reference: runReference,
      pollPath: `/${runReference}`,
      resultsPath: `/${runReference}/results`,
      livePath: `/${runReference}/results/live`,
    };
  }

  async function castVote(page, poll, optionLabel) {
    await page.goto(poll.pollPath);
    await page.locator("label.poll-option", { hasText: optionLabel }).click();
    await page.getByRole("button", { name: "VOTE" }).click();
    await expect(page).toHaveTitle(/Counted — /u);
  }

  async function installLiveRecorder(page) {
    return page.evaluate(() => {
      const region = document.querySelector("[data-results-live-region]");
      const announcement = document.querySelector("[data-live-announcement]");
      const stale = document.querySelector("[data-live-stale]");
      if (!region || !announcement || !stale) {
        throw new Error("Live Results recorder could not find its DOM hooks");
      }
      const token = crypto.randomUUID();
      region.dataset.e2ePersistenceToken = token;
      const record = {
        announcements: [],
        staleNotices: [],
      };
      let lastAnnouncement = "";
      let staleVisible = !stale.hidden;
      const observe = () => {
        const message = announcement.textContent?.trim() ?? "";
        if (message && message !== lastAnnouncement) {
          record.announcements.push(message);
        }
        lastAnnouncement = message;
        const nextStaleVisible = !stale.hidden;
        if (nextStaleVisible && !staleVisible) {
          record.staleNotices.push(stale.textContent?.trim() ?? "");
        }
        staleVisible = nextStaleVisible;
      };
      new MutationObserver(observe).observe(region, {
        attributes: true,
        childList: true,
        characterData: true,
        subtree: true,
      });
      window.__liveResultsE2eRecord = record;
      return token;
    });
  }

  async function liveRecord(page) {
    return page.evaluate(() => window.__liveResultsE2eRecord);
  }

  async function captureProof(page, filename) {
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({
      path: `${proofDir}/${filename}`,
      fullPage: true,
    });
  }

  test("snaps a two-context Tally live without navigation and preserves YOUR BALLOT", async ({
    page,
    browser,
    baseURL,
  }) => {
    const owner = await seedOwner();
    const poll = seedPoll({
      ownerId: owner.userId,
      reference: "two-context",
      votes: [[0]],
    });
    const voterOneContext = await browser.newContext({
      baseURL: requireBaseUrl(baseURL),
    });
    const voterTwoContext = await browser.newContext({
      baseURL: requireBaseUrl(baseURL),
    });
    const voterOne = watchConsole(await voterOneContext.newPage());
    const voterTwo = watchConsole(await voterTwoContext.newPage());

    try {
      await page.emulateMedia({ colorScheme: "dark" });
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(poll.resultsPath);
      await expect(page.locator("[data-tally-final-region]")).toBeVisible();
      await expect(page.locator("[data-live-label]")).toHaveText("LIVE");
      const dot = page.locator(".live-indicator-dot");
      await expect(dot).toHaveAttribute("aria-hidden", "true");
      expect(
        await dot.evaluate((element) => getComputedStyle(element).animationName),
      ).not.toBe("none");
      await captureProof(page, "live-375-dark.png");

      const regionToken = await installLiveRecorder(page);
      let navigationCount = 0;
      page.on("request", (request) => {
        if (
          request.isNavigationRequest() &&
          request.frame() === page.mainFrame()
        ) {
          navigationCount += 1;
        }
      });

      // Reduced motion freezes only the decorative dot; live data still
      // applies with the same fidelity.
      await page.emulateMedia({
        colorScheme: "dark",
        reducedMotion: "reduce",
      });
      expect(
        await dot.evaluate((element) => ({
          animation: getComputedStyle(element).animationName,
          opacity: getComputedStyle(element).opacity,
        })),
      ).toEqual({ animation: "none", opacity: "1" });

      const versionBeforeVote = d1Query(
        `SELECT representation_version FROM poll WHERE id = '${poll.pollId}'`,
      )[0].representation_version;
      await castVote(voterOne, poll, "Beta");
      expect(
        d1Query(
          `SELECT representation_version FROM poll WHERE id = '${poll.pollId}'`,
        ),
      ).toEqual([{ representation_version: versionBeforeVote + 1 }]);
      await expect(page.locator("[data-live-tied]")).toBeVisible({
        timeout: 7_000,
      });
      await expect(
        page.getByRole("img", { name: "Beta, 50 percent, 1 vote" }),
      ).toBeVisible();
      await expect
        .poll(async () => (await liveRecord(page)).announcements, {
          timeout: 7_000,
        })
        .toContain("TIED");

      await expect(
        voterOne.locator("[data-your-ballot] .results-tally-ballot-label"),
      ).toHaveText("YOUR BALLOT");
      await expect(
        voterOne.locator("[data-your-ballot] .results-tally-ballot-value"),
      ).toHaveText("Beta");

      await castVote(voterTwo, poll, "Beta");
      await expect(
        page.getByRole("img", {
          name: "Beta, 67 percent, 2 votes, leading",
        }),
      ).toBeVisible({ timeout: 7_000 });
      await expect(
        voterOne.getByRole("img", {
          name: "Beta, 67 percent, 2 votes, leading",
        }),
      ).toBeVisible({ timeout: 7_000 });
      await expect(
        voterOne.locator("[data-your-ballot] .results-tally-ballot-value"),
      ).toHaveText("Beta");
      await expect
        .poll(async () => (await liveRecord(page)).announcements, {
          timeout: 7_000,
        })
        .toContain("Beta now leading, 67 percent.");

      const betaTrack = page
        .locator("[data-tally-final] .results-bar")
        .filter({ hasText: "Beta" })
        .locator(".results-bar-track");
      expect(
        await betaTrack.evaluate((element) =>
          element.style.getPropertyValue("--bar-width"),
        ),
      ).toBe("67%");
      // Story 1.10 splits the snap-era assertion in two: armed (AC #1), the
      // fill transitions width over 480ms and the leader cross-fade over
      // 240ms; under reduced motion (AC #4) the same update still lands —
      // the duration just reads 0s while the value moved.
      await page.emulateMedia({
        colorScheme: "dark",
        reducedMotion: "no-preference",
      });
      const armedMotion = await betaTrack
        .locator(".results-bar-fill")
        .evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            duration: style.transitionDuration,
            property: style.transitionProperty,
          };
        });
      expect(armedMotion).toEqual({
        duration: "0.48s, 0.24s, 0.24s",
        property: "width, background-color, border-right-color",
      });
      await page.emulateMedia({
        colorScheme: "dark",
        reducedMotion: "reduce",
      });
      expect(
        await betaTrack
          .locator(".results-bar-fill")
          .evaluate((element) => getComputedStyle(element).transitionDuration),
      ).toBe("0s");
      await expect(page.locator("[data-live-total]")).toHaveText("3 VOTES");
      expect(navigationCount).toBe(0);

      const tally = page.locator("[data-results-tally]");
      await expect(
        tally.locator('[aria-live="polite"]'),
      ).toHaveCount(1);
      await expect(tally.locator('[role="img"] [aria-live]')).toHaveCount(0);
      await expect(tally.locator("input, select, textarea, a")).toHaveCount(
        0,
      );
      // Story 1.10 (AC #5): exactly the two chart-form toggle buttons.
      await expect(tally.locator("button")).toHaveCount(2);
      await expect(tally.locator("button[data-chart-form]")).toHaveCount(2);
      await expect(page.locator(".results-bar-leader-mark:visible")).toHaveCount(
        1,
      );
      await expect(page.locator("[data-results-live-region]")).toHaveAttribute(
        "data-e2e-persistence-token",
        regionToken,
      );
    } finally {
      await voterOneContext.close();
      await voterTwoContext.close();
    }
  });

  test("changes validators for Votes and Deadline closure, then stops permanently", async ({
    page,
    browser,
    baseURL,
  }) => {
    const owner = await seedOwner();
    const votePoll = seedPoll({
      ownerId: owner.userId,
      reference: "validator-vote",
    });
    const first = await page.request.get(votePoll.livePath);
    expect(first.status()).toBe(200);
    const firstValidator = first.headers().etag;
    expect(firstValidator).toMatch(/^"[1-9]\d*:open"$/u);
    expect(first.headers()["cache-control"]).toBe("private, no-store");

    const unchanged = await page.request.get(votePoll.livePath, {
      headers: { "if-none-match": firstValidator },
    });
    expect(unchanged.status()).toBe(304);
    expect(unchanged.headers().etag).toBe(firstValidator);
    expect(await unchanged.text()).toBe("");

    const voterContext = await browser.newContext({
      baseURL: requireBaseUrl(baseURL),
    });
    const voter = watchConsole(await voterContext.newPage());
    try {
      await castVote(voter, votePoll, "Alpha");
    } finally {
      await voterContext.close();
    }
    const afterVote = await page.request.get(votePoll.livePath, {
      headers: { "if-none-match": firstValidator },
    });
    expect(afterVote.status()).toBe(200);
    const firstVersion = Number(/\d+/u.exec(firstValidator)?.[0]);
    expect(afterVote.headers().etag).toBe(`"${firstVersion + 1}:open"`);
    expect((await afterVote.json()).voterCount).toBe(1);

    const deadlinePoll = seedPoll({
      ownerId: owner.userId,
      reference: "validator-deadline",
    });
    const deadlineMs = Date.now() + 2_500;
    setPollDeadline(deadlinePoll.pollId, deadlineMs);
    const open = await page.request.get(deadlinePoll.livePath);
    expect(open.status()).toBe(200);
    const openValidator = open.headers().etag;
    expect(openValidator).toMatch(/^"[1-9]\d*:open"$/u);

    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize({ width: 1280, height: 900 });
    const liveRequests = [];
    page.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (pathname.endsWith("/results/live")) {
        liveRequests.push(pathname);
      }
    });
    await page.goto(deadlinePoll.resultsPath);
    await expect(page.locator("[data-live-label]")).toHaveText("LIVE");
    await page.waitForTimeout(Math.max(0, deadlineMs - Date.now() + 100));

    const deadlineClosed = await page.request.get(deadlinePoll.livePath, {
      headers: { "if-none-match": openValidator },
    });
    expect(deadlineClosed.status()).toBe(200);
    expect(deadlineClosed.headers().etag).toBe(
      openValidator.replace(":open", ":closed"),
    );
    expect((await deadlineClosed.json()).status).toBe("closed");
    expect(
      d1Query(
        `SELECT representation_version, closed_at_ms FROM poll WHERE id = '${deadlinePoll.pollId}'`,
      ),
    ).toEqual([{ representation_version: 1, closed_at_ms: null }]);

    await expect(page.locator("[data-live-label]")).toHaveText("CLOSED", {
      timeout: 7_000,
    });
    await expect(page.locator(".live-indicator-dot")).toBeHidden();
    await captureProof(page, "closed-1280-light.png");
    const terminalRequestCount = liveRequests.length;
    await page.evaluate(() => {
      window.dispatchEvent(new Event("offline"));
      window.dispatchEvent(new Event("online"));
    });
    await expect(page.locator("[data-live-label]")).toHaveText("CLOSED");
    expect(liveRequests).toHaveLength(terminalRequestCount);
    await page.waitForTimeout(3_250);
    expect(liveRequests).toHaveLength(terminalRequestCount);
    await page.emulateMedia({ colorScheme: "dark" });
    await page.setViewportSize({ width: 375, height: 812 });
    await captureProof(page, "closed-375-dark.png");

    const initiallyClosed = seedPoll({
      ownerId: owner.userId,
      reference: "initially-closed",
    });
    closePoll(initiallyClosed.pollId, Date.now());
    const requestsBeforeClosedNavigation = liveRequests.length;
    await page.goto(initiallyClosed.resultsPath);
    await expect(page.locator("[data-live-label]")).toHaveText("CLOSED");
    await expect(page.locator("[data-results-tally]")).not.toHaveAttribute(
      "data-live-endpoint",
    );
    await page.waitForTimeout(3_250);
    expect(liveRequests).toHaveLength(requestsBeforeClosedNavigation);
  });

  test("keeps hidden live responses byte-stable around a Vote and exposes only to owners", async ({
    page,
    browser,
    baseURL,
  }) => {
    const owner = await seedOwner();
    const nonOwner = await seedOwner();
    const afterClose = seedPoll({
      ownerId: owner.userId,
      reference: "hidden-after-close",
      visibility: "after_close",
    });
    const creatorOnly = seedPoll({
      ownerId: owner.userId,
      reference: "hidden-creator-only",
      visibility: "creator_only",
    });

    const hiddenShape = async (response) => ({
      status: response.status(),
      cacheControl: response.headers()["cache-control"],
      etag: response.headers().etag ?? null,
      lastModified: response.headers()["last-modified"] ?? null,
      body: await response.text(),
    });

    const before = await hiddenShape(
      await page.request.get(afterClose.livePath),
    );
    expect(before).toEqual({
      status: 204,
      cacheControl: "private, no-store",
      etag: null,
      lastModified: null,
      body: "",
    });

    const voterContext = await browser.newContext({
      baseURL: requireBaseUrl(baseURL),
    });
    const voter = watchConsole(await voterContext.newPage());
    try {
      await castVote(voter, afterClose, "Alpha");
    } finally {
      await voterContext.close();
    }
    const after = await hiddenShape(
      await page.request.get(afterClose.livePath),
    );
    expect(after).toEqual(before);

    const nonOwnerContext = await browser.newContext({
      baseURL: requireBaseUrl(baseURL),
    });
    const ownerContext = await browser.newContext({
      baseURL: requireBaseUrl(baseURL),
    });
    try {
      await signIn(nonOwnerContext, baseURL, nonOwner);
      await signIn(ownerContext, baseURL, owner);
      for (const poll of [afterClose, creatorOnly]) {
        expect(
          await hiddenShape(await nonOwnerContext.request.get(poll.livePath)),
        ).toEqual({
          status: 204,
          cacheControl: "private, no-store",
          etag: null,
          lastModified: null,
          body: "",
        });
      }
      expect(
        await hiddenShape(
          await ownerContext.request.get(afterClose.livePath),
        ),
      ).toEqual({
        status: 204,
        cacheControl: "private, no-store",
        etag: null,
        lastModified: null,
        body: "",
      });
      const entitled = await ownerContext.request.get(creatorOnly.livePath);
      expect(entitled.status()).toBe(200);
      expect(entitled.headers().etag).toMatch(/^"[1-9]\d*:open"$/u);
    } finally {
      await nonOwnerContext.close();
      await ownerContext.close();
    }

    for (const poll of [afterClose, creatorOnly]) {
      const hiddenPage = await page.request.get(poll.resultsPath);
      expect(hiddenPage.status()).toBe(200);
      const html = await hiddenPage.text();
      expect(html).not.toContain("data-live-endpoint");
      expect(html).not.toContain("data-results-live-region");
      expect(html).not.toContain(poll.livePath);
    }
  });

  test("holds the last Tally through failure and resumes in the persistent region once", async ({
    page,
    browser,
    baseURL,
  }) => {
    const owner = await seedOwner();
    const poll = seedPoll({
      ownerId: owner.userId,
      reference: "failure-recovery",
      votes: [[0]],
    });
    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.route(`**${poll.livePath}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "cache-control": "private, no-store" },
        body: "{}",
      }),
    );
    await page.goto(poll.resultsPath);
    await expect(page.locator("[data-live-label]")).toHaveText("LIVE");
    await captureProof(page, "live-1280-light.png");
    const regionToken = await installLiveRecorder(page);
    const initialTime = await page
      .locator("[data-results-tally]")
      .evaluate((root) =>
        new Intl.DateTimeFormat(undefined, {
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        }).format(new Date(Number(root.dataset.liveInitialRenderAt))),
      );
    const expectedNotice = `Not receiving updates. The counts shown are from ${initialTime}.`;

    const stale = page.locator("[data-live-stale]");
    await expect(stale).toHaveText(expectedNotice, { timeout: 5_000 });
    await expect(stale).toBeVisible();
    await expect(page.locator("[data-live-status-content]")).toBeHidden();
    await expect(
      page.getByRole("img", {
        name: "Alpha, 100 percent, 1 vote, leading",
      }),
    ).toBeVisible();
    await captureProof(page, "stale-1280-light.png");
    await page.emulateMedia({ colorScheme: "dark" });
    await page.setViewportSize({ width: 375, height: 812 });
    await captureProof(page, "stale-375-dark.png");

    const voterContext = await browser.newContext({
      baseURL: requireBaseUrl(baseURL),
    });
    const voter = watchConsole(await voterContext.newPage());
    try {
      await castVote(voter, poll, "Beta");
    } finally {
      await voterContext.close();
    }
    await expect(
      page.getByRole("img", {
        name: "Alpha, 100 percent, 1 vote, leading",
      }),
    ).toBeVisible();

    await page.unroute(`**${poll.livePath}`);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.locator("[data-live-tied]")).toBeVisible({
      timeout: 3_000,
    });
    await expect(stale).toBeHidden();
    await expect(page.locator("[data-live-status-content]")).toBeVisible();
    await expect
      .poll(
        async () =>
          (await liveRecord(page)).announcements.filter(
            (message) => message === "Updates resumed.",
          ).length,
        { timeout: 7_000 },
      )
      .toBe(1);
    const record = await liveRecord(page);
    expect(record.staleNotices).toEqual([expectedNotice]);
    expect(
      record.announcements.filter(
        (message) => message === "Updates resumed.",
      ),
    ).toHaveLength(1);
    await expect(page.locator("[data-results-live-region]")).toHaveAttribute(
      "data-e2e-persistence-token",
      regionToken,
    );
  });

  test("pauses while hidden and refreshes immediately when visible again", async ({
    page,
    browser,
    baseURL,
  }) => {
    await page.addInitScript(() => {
      let visibility = "visible";
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => visibility,
      });
      window.__setLiveResultsVisibility = (next) => {
        visibility = next;
        document.dispatchEvent(new Event("visibilitychange"));
      };
    });
    const owner = await seedOwner();
    const poll = seedPoll({
      ownerId: owner.userId,
      reference: "visibility",
      votes: [[0]],
    });
    const requests = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === poll.livePath) {
        requests.push(request);
      }
    });
    await page.goto(poll.resultsPath);
    await page.evaluate(() => window.__setLiveResultsVisibility("hidden"));
    const hiddenRequestCount = requests.length;
    await page.waitForTimeout(3_250);
    expect(requests).toHaveLength(hiddenRequestCount);

    const voterContext = await browser.newContext({
      baseURL: requireBaseUrl(baseURL),
    });
    const voter = watchConsole(await voterContext.newPage());
    try {
      await castVote(voter, poll, "Beta");
    } finally {
      await voterContext.close();
    }
    await expect(
      page.getByRole("img", {
        name: "Alpha, 100 percent, 1 vote, leading",
      }),
    ).toBeVisible();

    await Promise.all([
      page.waitForRequest(
        (request) => new URL(request.url()).pathname === poll.livePath,
        { timeout: 2_000 },
      ),
      page.evaluate(() => window.__setLiveResultsVisibility("visible")),
    ]);
    await expect(page.locator("[data-live-tied]")).toBeVisible({
      timeout: 2_000,
    });
  });
});
