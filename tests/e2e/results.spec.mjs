import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import {
  assertUuid,
  cleanupCreator,
  d1Execute,
  d1Query,
  hasBetterAuthSecret,
  requireBaseUrl,
  seedCreatorSession,
  setPollDeadline,
  setResultVisibility,
} from "./creator-session.mjs";

// Story 1.8: the direct Results route end to end — visibility matrix,
// no-leak hidden shapes, skeleton/empty/tie presentation, SSR resilience,
// escaping, cache discipline, and browser proof of the key surfaces.

test.describe.configure({ mode: "serial", timeout: 120_000 });

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const resultsRunId = randomUUID().slice(0, 8);

function scopedReference(reference) {
  return `${reference}-${resultsRunId}`;
}

async function reserveAvailablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise((resolve) => server.close(resolve));
    throw new Error("Could not reserve an IPv4 telemetry-test port");
  }
  const port = address.port;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}

function childExitPromise(child) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (outcome) => {
      if (!settled) {
        settled = true;
        resolve(outcome);
      }
    };
    child.once("error", (error) => finish({ error, code: null, signal: null }));
    child.once("exit", (code, signal) => finish({ error: null, code, signal }));
  });
}

async function waitForOutcome(exitPromise, timeoutMs) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    return await Promise.race([exitPromise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function signalProcessGroup(child, signal) {
  if (child.pid !== undefined) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Fall through to the direct child when no process group exists.
    }
  }
  try {
    child.kill(signal);
  } catch {
    // The process exited between the state check and signal delivery.
  }
}

async function stopProcessGroup(child, exitPromise) {
  if (child.exitCode === null && child.signalCode === null) {
    signalProcessGroup(child, "SIGTERM");
  }
  let outcome = await waitForOutcome(exitPromise, 5_000);
  if (outcome === null) {
    signalProcessGroup(child, "SIGKILL");
    outcome = await waitForOutcome(exitPromise, 5_000);
  }
  if (outcome === null) {
    throw new Error("Telemetry dev-server process group did not exit");
  }
  return outcome;
}

function sqlText(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

test.describe("direct results route", () => {
  test.skip(
    !hasBetterAuthSecret(),
    "BETTER_AUTH_SECRET is not provisioned in .dev.vars — Poll setup needs the seeded creator harness",
  );

  const seededUserIds = [];
  const browserErrors = new WeakMap();

  test.beforeEach(({ page }) => {
    const errors = [];
    browserErrors.set(page, errors);
    page.on("console", (message) => {
      const text = message.text();
      // Document responses with non-2xx statuses (404/405/422) log a
      // resource error in Chromium — expected, scoped to the page URL.
      const expectedDocumentResponse =
        /^Failed to load resource: the server responded with a status of (404|405|422) \(/u.test(
          text,
        ) && message.location().url === page.url();
      if (message.type() === "error" && !expectedDocumentResponse) {
        errors.push(text);
      }
    });
    page.on("pageerror", (error) => {
      errors.push(error.message);
    });
  });

  test.afterEach(({ page }) => {
    expect(browserErrors.get(page) ?? []).toEqual([]);
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
        `Failed to clean ${cleanupErrors.length} Results E2E creator fixture(s)`,
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

  // Seeds a Poll with options, a canonical reference, and accepted Vote
  // facts directly — the route under test is read-only. The Poll is inserted
  // OPEN (the vote-insert trigger enforces effective-open) and only then
  // closed/deadlined.
  function seedPoll({
    ownerId,
    reference,
    kind = "custom",
    question = "Where to lunch?",
    options = ["Alpha", "Beta"],
    visibility = "live",
    multiSelect = false,
    votes = [],
    deadlineMs = null,
    closedAtMs = null,
  }) {
    assertUuid(ownerId);
    const pollId = randomUUID();
    const optionIds = options.map(() => randomUUID());
    const runReference = scopedReference(reference);
    const statements = [
      `INSERT INTO poll (id, owner_user_id, poll_type, question, result_visibility, session_checks_enabled, multi_select_enabled, min_selections, max_selections, deadline_ms, closed_at_ms, representation_version, created_at_ms, updated_at_ms) VALUES ('${pollId}', '${ownerId}', 'multiple_choice', ${sqlText(question)}, '${visibility}', 1, ${multiSelect ? 1 : 0}, NULL, NULL, NULL, NULL, 1, 0, 0);`,
      ...options.map(
        (label, position) =>
          `INSERT INTO poll_option (id, poll_id, label, position, created_at_ms) VALUES ('${optionIds[position]}', '${pollId}', ${sqlText(label)}, ${position}, 0);`,
      ),
      `INSERT INTO poll_reference (reference, poll_id, kind, is_canonical, created_at_ms) VALUES (${sqlText(runReference)}, '${pollId}', '${kind}', 1, 0);`,
    ];
    votes.forEach((selections, index) => {
      const voteId = randomUUID();
      statements.push(
        `INSERT INTO vote (id, poll_id, submission_id, payload_hash, created_at_ms) VALUES ('${voteId}', '${pollId}', '${randomUUID()}', 'hash-${index}', 0);`,
        ...selections.map(
          (optionIndex) =>
            `INSERT INTO vote_selection (vote_id, poll_option_id) VALUES ('${voteId}', '${optionIds[optionIndex]}');`,
        ),
      );
    });
    if (deadlineMs !== null) {
      statements.push(
        `UPDATE poll SET deadline_ms = ${deadlineMs} WHERE id = '${pollId}';`,
      );
    }
    if (closedAtMs !== null) {
      statements.push(
        `UPDATE poll SET closed_at_ms = ${closedAtMs} WHERE id = '${pollId}';`,
      );
    }
    d1Execute(statements.join(""));
    return {
      pollId,
      optionIds,
      reference: runReference,
      pollPath: `/${runReference}`,
      path: `/${runReference}/results`,
    };
  }

  async function formatDeadlineLocally(page, deadlineMs) {
    return page.evaluate((timestampMs) => {
      const timestamp = new Date(timestampMs);
      const now = new Date();
      const options = {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      };
      if (timestamp.getFullYear() !== now.getFullYear()) {
        options.year = "numeric";
      }
      return new Intl.DateTimeFormat(undefined, options).format(timestamp);
    }, deadlineMs);
  }

  async function dispatchPersistedPageShow(page) {
    await page.evaluate(() => {
      const pageShow =
        typeof PageTransitionEvent === "function"
          ? new PageTransitionEvent("pageshow", { persisted: true })
          : new Event("pageshow");
      if (!("persisted" in pageShow)) {
        Object.defineProperty(pageShow, "persisted", { value: true });
      }
      window.dispatchEvent(pageShow);
    });
  }

  // No-leak assertions target the rendered content area. Astro hoists the
  // CSS of every statically-imported component into <head> even when the
  // component never renders, so head markup is meaningless for leaks.
  function mainHtmlOf(html) {
    return html.match(/<main[\s\S]*<\/main>/)?.[0] ?? "";
  }

  function expectNoAggregateResultFacts(html) {
    for (const forbidden of [
      "results-bar-track",
      "data-tally-final",
      "data-tally-skeleton",
      "data-your-ballot",
      "results-tally-summary",
      "results-tally-tied",
      "results-bar-leader-mark",
      "--bar-width",
      "representation",
      // Story 1.10: the chart-form toggle, pie mount, and own-vote marker
      // are visible-Tally artifacts and never leak onto hidden surfaces.
      "data-chart-form-toggle",
      "data-chart-form-pie",
      "chart-form-toggle-option",
      "data-your-option",
      "data-pie-share",
    ]) {
      expect(html).not.toContain(forbidden);
    }
    expect(html).not.toMatch(
      /\b\d+\s*(?:%|votes?|voters?|selections?)\b/iu,
    );
    expect(html).not.toMatch(/\bTIED\b|◆/u);
  }

  test("renders a Live Tally to anonymous, owner, and non-owner, open and closed", async ({
    page,
    context,
    baseURL,
  }) => {
    const owner = await seedOwner();
    const nonOwner = await seedOwner();
    const poll = seedPoll({
      ownerId: owner.userId,
      reference: "live-matrix",
      votes: [[0], [0], [1]],
    });

    const anonymous = await page.request.get(poll.path);
    expect(anonymous.status()).toBe(200);
    expect(anonymous.headers()["cache-control"]).toBe("private, no-store");
    expect(anonymous.headers()["etag"]).toBeUndefined();
    expect(anonymous.headers()["x-request-id"]).toBeTruthy();
    expect(await anonymous.text()).toContain(
      "Alpha, 67 percent, 2 votes, leading",
    );

    const expectLiveTally = async () => {
      await expect(
        page.getByRole("img", {
          name: "Alpha, 67 percent, 2 votes, leading",
        }),
      ).toBeVisible();
      await expect(
        page.getByRole("img", { name: "Beta, 33 percent, 1 vote" }),
      ).toBeVisible();
      await expect(
        page.locator(".results-bar-leader-mark:not([hidden])"),
      ).toHaveCount(1);
    };

    // Anonymous, owner, and signed-in non-owner all receive the open Tally.
    await page.goto(poll.path);
    await expectLiveTally();

    await signIn(context, baseURL, owner);
    await page.goto(poll.path);
    await expectLiveTally();

    await context.clearCookies();
    await signIn(context, baseURL, nonOwner);
    await page.goto(poll.path);
    await expectLiveTally();
    await context.clearCookies();

    // A closed Live Poll still renders the same Tally to all three audiences.
    d1Execute(
      `UPDATE poll SET closed_at_ms = ${Date.now()} WHERE id = '${poll.pollId}';`,
    );
    await signIn(context, baseURL, owner);
    await page.goto(poll.path);
    await expectLiveTally();

    await context.clearCookies();
    await signIn(context, baseURL, nonOwner);
    await page.goto(poll.path);
    await expectLiveTally();

    await context.clearCookies();
    const closed = await page.request.get(poll.path);
    expect(closed.status()).toBe(200);
    expect(await closed.text()).toContain(
      "Alpha, 67 percent, 2 votes, leading",
    );
  });

  test("hides an open After Close Poll, then opens it by deadline comparison alone", async ({
    page,
  }) => {
    const owner = await seedOwner();
    const deadlineMs = Date.now() + 48 * 60 * 60 * 1000;
    const poll = seedPoll({
      ownerId: owner.userId,
      reference: "after-close-hidden",
      visibility: "after_close",
      votes: [[0], [1]],
      deadlineMs,
    });

    const hidden = await page.request.get(poll.path);
    expect(hidden.status()).toBe(200);
    expect(hidden.headers()["cache-control"]).toBe("private, no-store");
    expect(hidden.headers()["etag"]).toBeUndefined();
    const hiddenMain = mainHtmlOf(await hidden.text());
    expect(hiddenMain).toContain("Where to lunch?");
    // Nothing about the aggregate result's shape leaks. Creator-authored
    // option text is public on the Poll itself, so this guard targets result
    // structures/counts rather than brittle literal-label bans.
    expectNoAggregateResultFacts(hiddenMain);

    await page.goto(poll.path);
    const main = page.locator("main");
    await expect(main.getByRole("heading", { level: 1 })).toHaveText(
      "Where to lunch?",
    );
    // Question precedes the explanation in reading order.
    const mainText = await main.innerText();
    expect(mainText.indexOf("Where to lunch?")).toBeLessThan(
      mainText.indexOf("Results open when the Poll closes"),
    );
    expect(mainText).not.toMatch(/\d+\s*%|\b\d+ votes?\b/i);
    const time = page.locator("time[data-deadline]");
    await expect(time).toHaveAttribute(
      "datetime",
      new Date(deadlineMs).toISOString(),
    );
    await expect(time).toHaveText(await formatDeadlineLocally(page, deadlineMs));
    // The hidden Tally still exposes the canonical Share action (Story 1.13),
    // but never a vote affordance or any result-shape control.
    await expect(main.getByRole("button", { name: "SHARE" })).toBeVisible();
    await expect(main.getByRole("button")).toHaveCount(1);
    await expect(main.locator("[data-share-url-text]")).toContainText(
      `/${poll.reference}`,
    );
    await expect(
      main.getByRole("link", { name: "View the public repository" }),
    ).toBeVisible();
    await expect(main.getByRole("radio")).toHaveCount(0);

    // Deadline comparison opens the Tally with no write: closed_at stays
    // NULL and the representation version never moves.
    setPollDeadline(poll.pollId, Date.now() - 1000);
    await page.goto(poll.path);
    await expect(
      page.getByRole("img", { name: "Alpha, 50 percent, 1 vote" }),
    ).toBeVisible();
    expect(
      d1Query(
        `SELECT closed_at_ms, representation_version FROM poll WHERE id = '${poll.pollId}'`,
      ),
    ).toEqual([{ closed_at_ms: null, representation_version: 1 }]);
  });

  test("refreshes a restored After Close page once its deadline has passed", async ({
    page,
  }) => {
    const owner = await seedOwner();
    const deadlineMs = Date.now() + 48 * 60 * 60 * 1000;
    const poll = seedPoll({
      ownerId: owner.userId,
      reference: "after-close-restored",
      visibility: "after_close",
      votes: [[0], [1]],
      deadlineMs,
    });

    await page.goto(poll.path);
    const time = page.locator("time[data-deadline]");
    await expect(time).toBeVisible();

    const navigationPaths = [];
    const trackNavigation = (request) => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
        navigationPaths.push(new URL(request.url()).pathname);
      }
    };
    page.on("request", trackNavigation);

    try {
      // A persisted restoration while the rendered deadline is still in the
      // future must stay on the no-poll hidden surface.
      await dispatchPersistedPageShow(page);
      await page.waitForTimeout(100);
      expect(navigationPaths).toEqual([]);
      await expect(time).toBeVisible();

      // Model the same document returning from BFCache after its deadline:
      // D1 is now due and the cached DOM still needs one server reevaluation.
      const pastDeadlineMs = Date.now() - 1000;
      setPollDeadline(poll.pollId, pastDeadlineMs);
      await time.evaluate((element, timestampMs) => {
        element.dataset.deadline = String(timestampMs);
        element.dateTime = new Date(timestampMs).toISOString();
      }, pastDeadlineMs);

      await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded" }),
        dispatchPersistedPageShow(page),
      ]);
      await expect(
        page.getByRole("img", { name: "Alpha, 50 percent, 1 vote" }),
      ).toBeVisible();

      // The visible response carries no restoration enhancer, so the one
      // reevaluation cannot turn into a reload loop.
      await page.waitForTimeout(100);
      expect(navigationPaths).toEqual([poll.path]);
      await expect(page.locator("time[data-deadline]")).toHaveCount(0);
    } finally {
      page.off("request", trackNavigation);
    }
  });

  test("renders the no-timestamp hidden variant for a manual-close-only Poll", async ({
    page,
  }) => {
    const owner = await seedOwner();
    const poll = seedPoll({
      ownerId: owner.userId,
      reference: "after-close-manual",
      visibility: "after_close",
      votes: [[0]],
    });

    await page.goto(poll.path);
    await expect(page.locator("main")).toContainText(
      "Results open when the Poll closes.",
    );
    await expect(page.locator("time[data-deadline]")).toHaveCount(0);
    await expect(page.locator("main")).not.toContainText("—");
    expect(await page.locator("main").innerText()).not.toContain("Alpha");
  });

  test("serves Creator-Only results to the owner alone", async ({
    page,
    context,
    baseURL,
  }) => {
    const owner = await seedOwner();
    const nonOwner = await seedOwner();
    const poll = seedPoll({
      ownerId: owner.userId,
      reference: "creator-only-matrix",
      visibility: "creator_only",
      votes: [[0], [0], [1]],
    });

    // Anonymous: hidden shape, no counts, no sign-in prompt revealing
    // entitlement.
    const anonymous = await page.request.get(poll.path);
    expect(anonymous.status()).toBe(200);
    const anonymousMain = mainHtmlOf(await anonymous.text());
    expect(anonymousMain).toContain("These results go to the Creator only.");
    expectNoAggregateResultFacts(anonymousMain);
    expect(anonymousMain).not.toMatch(/sign in/iu);

    // A signed-in non-owner is identical to anonymous.
    await signIn(context, baseURL, nonOwner);
    const nonOwnerResponse = await page.request.get(poll.path);
    expect(nonOwnerResponse.status()).toBe(200);
    const nonOwnerMain = mainHtmlOf(await nonOwnerResponse.text());
    expect(nonOwnerMain).toContain("These results go to the Creator only.");
    expectNoAggregateResultFacts(nonOwnerMain);
    expect(nonOwnerMain).toBe(anonymousMain);
    await context.clearCookies();

    // The owning Creator gets the full Tally.
    await signIn(context, baseURL, owner);
    await page.goto(poll.path);
    await expect(
      page.getByRole("img", { name: "Alpha, 67 percent, 2 votes, leading" }),
    ).toBeVisible();
    await context.clearCookies();
  });

  test("renders the empty state with labelled zero-width bars when no one has voted", async ({
    page,
    request,
    baseURL,
  }) => {
    const owner = await seedOwner();
    const poll = seedPoll({
      ownerId: owner.userId,
      reference: "empty-state",
      options: ["Alpha", "Beta", "Gamma"],
    });

    // The raw document carries skeleton rows at the real option count with
    // loading-specific names — never fake "0 percent" results.
    const raw = await request.get(`${requireBaseUrl(baseURL)}${poll.path}`);
    const html = await raw.text();
    expect(html.match(/, loading"/g)).toHaveLength(3);
    expect(html).toContain('aria-busy="true"');

    await page.goto(poll.path);
    await expect(page.locator(".results-tally-empty")).toHaveText(
      "No Votes yet. Yours would be the first, which is a kind of power.",
    );
    await expect(
      page.getByRole("img", { name: "Alpha, 0 percent, 0 votes" }),
    ).toBeVisible();
    // All-zero is the empty state: no TIED, no gold, no diamond.
    await expect(page.locator(".results-tally-tied")).toBeHidden();
    await expect(page.locator(".results-bar.is-leader")).toHaveCount(0);
    await expect(
      page.locator(".results-bar-leader-mark:not([hidden])"),
    ).toHaveCount(0);
    // Zero-width bars keep their baseline rules and suppress the 2px edge.
    const edges = await page
      .locator("[data-tally-final] .results-bar-fill")
      .evaluateAll((fills) =>
        fills.map((fill) => getComputedStyle(fill).borderRightWidth),
      );
    expect(edges).toEqual(["0px", "0px", "0px"]);
    const baselines = await page
      .locator("[data-tally-final] .results-bar")
      .evaluateAll((bars) =>
        bars.map((bar) => getComputedStyle(bar).borderBottomWidth),
      );
    expect(baselines).toEqual(["1px", "1px", "1px"]);
  });

  test("withdraws all gold on an exact tie and marks one unique leader", async ({
    page,
  }) => {
    const owner = await seedOwner();
    const tied = seedPoll({
      ownerId: owner.userId,
      reference: "exact-tie",
      votes: [[0], [1]],
    });

    await page.goto(tied.path);
    // TIED is visible text — the absence of gold is never the only signal.
    await expect(page.locator(".results-tally-tied")).toHaveText("TIED");
    await expect(page.locator(".results-bar.is-leader")).toHaveCount(0);
    await expect(
      page.locator(".results-bar-leader-mark:not([hidden])"),
    ).toHaveCount(0);
    // No accessible name claims leadership; the diamond is excluded from
    // every name.
    for (const name of [
      "Alpha, 50 percent, 1 vote",
      "Beta, 50 percent, 1 vote",
    ]) {
      await expect(page.getByRole("img", { name, exact: true })).toBeVisible();
    }
    expect(await page.locator("main").innerText()).not.toContain("◆");

    const leading = seedPoll({
      ownerId: owner.userId,
      reference: "unique-leader",
      votes: [[0], [0], [1]],
    });
    await page.goto(leading.path);
    await expect(page.locator(".results-tally-tied")).toBeHidden();
    await expect(page.locator(".results-bar.is-leader")).toHaveCount(1);
    // The leader is named semantically; the ◆ is decorative only.
    await expect(
      page.getByRole("img", { name: "Alpha, 67 percent, 2 votes, leading" }),
    ).toBeVisible();
    await expect(
      page.locator(".results-bar-leader-mark").first(),
    ).toHaveAttribute("aria-hidden", "true");
  });

  test("reports multi-select Voters and selections as separate totals", async ({
    page,
  }) => {
    const owner = await seedOwner();
    const poll = seedPoll({
      ownerId: owner.userId,
      reference: "multi-totals",
      options: ["Alpha", "Beta", "Gamma"],
      multiSelect: true,
      votes: [
        [0, 1],
        [0, 2],
      ],
    });

    await page.goto(poll.path);
    await expect(page.locator(".results-tally-summary")).toHaveText(
      "2 VOTERS · 4 SELECTIONS",
    );
    // Percentages are shares of Voters — they intentionally total past 100.
    await expect(
      page.getByRole("img", { name: "Alpha, 100 percent, 2 votes, leading" }),
    ).toBeVisible();
    await expect(
      page.getByRole("img", { name: "Beta, 50 percent, 1 vote" }),
    ).toBeVisible();
    await expect(
      page.getByRole("img", { name: "Gamma, 50 percent, 1 vote" }),
    ).toBeVisible();
  });

  test("answers missing and deleted references with the identical plain 404", async ({
    page,
  }) => {
    const owner = await seedOwner();
    const poll = seedPoll({ ownerId: owner.userId, reference: "doomed" });
    const missingPath = `/${scopedReference("never-existed")}/results`;

    const missing = await page.request.get(missingPath);
    expect(missing.status()).toBe(404);
    const missingBody = await missing.text();

    d1Execute(`DELETE FROM poll WHERE id = '${poll.pollId}';`);
    const deleted = await page.request.get(poll.path);
    expect(deleted.status()).toBe(404);
    const deletedBody = await deleted.text();
    expect(deletedBody).toBe(missingBody);

    await page.goto(missingPath);
    await expect(page.locator("h1.not-found")).toHaveText(
      "This Poll doesn't exist.",
    );
    await expect(page.locator("h1.not-found")).toBeFocused();
    await expect(page.locator("[data-public-repository-footer]")).toHaveCount(0);
  });

  test("redirects a case-variant custom link to the canonical results URL with the query preserved", async ({
    page,
  }) => {
    const owner = await seedOwner();
    const custom = seedPoll({
      ownerId: owner.userId,
      reference: "case-target",
    });
    const caseVariant = custom.reference.replace(
      /^case-target/u,
      "Case-Target",
    );

    const hit = await page.request.get(`/${caseVariant}/results?utm=keep`, {
      maxRedirects: 0,
    });
    expect(hit.status()).toBe(301);
    expect(hit.headers()["location"]).toBe(`${custom.path}?utm=keep`);
    expect(hit.headers()["cache-control"]).toBe("private, no-store");

    // A mixed-case miss on a generated reference stays 404 — case folding
    // is bounded to custom links.
    const generated = seedPoll({
      ownerId: owner.userId,
      reference: "GenRef-AbC123-xYz_9",
      kind: "generated",
    });
    const generatedVariant = generated.reference.replace(
      /^GenRef/u,
      "genref",
    );
    const miss = await page.request.get(`/${generatedVariant}/results`, {
      maxRedirects: 0,
    });
    expect(miss.status()).toBe(404);
  });

  test("answers GET and HEAD and rejects mutations before any private tally read", async ({
    page,
    baseURL,
  }) => {
    const owner = await seedOwner();
    const poll = seedPoll({ ownerId: owner.userId, reference: "methods" });

    const get = await page.request.get(poll.path);
    expect(get.status()).toBe(200);
    const head = await page.request.fetch(poll.path, { method: "HEAD" });
    expect(head.status()).toBe(200);
    expect(await head.text()).toBe("");
    expect(head.headers()["cache-control"]).toBe("private, no-store");

    for (const method of ["POST", "PUT", "DELETE"]) {
      const rejected = await page.request.fetch(poll.path, {
        method,
        headers: {
          origin: requireBaseUrl(baseURL),
          "sec-fetch-site": "same-origin",
        },
      });
      expect(rejected.status()).toBe(405);
      expect(rejected.headers()["allow"]).toBe("GET, HEAD");
    }
  });

  test("keeps the busy skeleton through one frame and hides all final metadata until resolution", async ({
    page,
  }) => {
    const owner = await seedOwner();
    const poll = seedPoll({
      ownerId: owner.userId,
      reference: "cold-load",
      options: ["Alpha", "Beta", "Gamma"],
      multiSelect: true,
      votes: [[0], [1]],
    });
    const emptyPoll = seedPoll({
      ownerId: owner.userId,
      reference: "cold-load-empty",
      options: ["Alpha", "Beta", "Gamma"],
    });

    // Take control of frame delivery so the cold-load state and each of the
    // enhancer's two frames are independently observable. Callbacks queued
    // by a callback belong to the next frame, matching browser scheduling.
    await page.addInitScript(() => {
      let nextFrameId = 0;
      const callbacks = new Map();
      window.requestAnimationFrame = (callback) => {
        nextFrameId += 1;
        callbacks.set(nextFrameId, callback);
        return nextFrameId;
      };
      window.cancelAnimationFrame = (frameId) => {
        callbacks.delete(frameId);
      };
      window.__advanceResultsAnimationFrame = () => {
        const frame = Array.from(callbacks.values());
        callbacks.clear();
        const timestamp = performance.now();
        for (const callback of frame) {
          callback(timestamp);
        }
      };
    });
    await page.goto(poll.path);
    const skeleton = page.locator("[data-tally-skeleton]");
    const finalRegion = page.locator("[data-tally-final-region]");
    await expect(skeleton).toBeVisible();
    await expect(skeleton).toHaveAttribute("aria-busy", "true");
    await expect(finalRegion).toBeHidden();
    await expect(page.locator(".results-tally-summary")).toBeHidden();
    await expect(page.locator(".results-tally-tied")).toBeHidden();
    await expect(skeleton.locator(".results-bar")).toHaveCount(3);
    for (const label of ["Alpha", "Beta", "Gamma"]) {
      await expect(
        skeleton.getByRole("img", { name: `${label}, loading` }),
      ).toBeVisible();
    }
    const motion = await skeleton.locator(".results-bar-fill").first().evaluate(
      (fill) => ({
        transition: getComputedStyle(fill).transitionDuration,
        animation: getComputedStyle(fill).animationName,
      }),
    );
    expect(motion).toEqual({ transition: "0s", animation: "none" });

    // The first delivered frame is intentionally still loading. Final
    // totals, TIED, and bars all remain hidden together.
    await page.evaluate(() => window.__advanceResultsAnimationFrame());
    await expect(skeleton).toBeVisible();
    await expect(finalRegion).toBeHidden();
    await expect(page.locator(".results-tally-summary")).toBeHidden();
    await expect(page.locator(".results-tally-tied")).toBeHidden();

    // The second frame atomically exposes the whole final region and removes
    // the skeleton from both layout and the accessibility busy state.
    await page.evaluate(() => window.__advanceResultsAnimationFrame());
    await expect(finalRegion).toBeVisible();
    await expect(page.locator(".results-tally-summary")).toHaveText(
      "2 VOTERS · 2 SELECTIONS",
    );
    await expect(page.locator(".results-tally-tied")).toHaveText("TIED");
    await expect(skeleton).toBeHidden();
    await expect(skeleton).not.toHaveAttribute("aria-busy", "true");

    // Empty-state copy is final-result metadata too: it obeys the same
    // two-frame boundary rather than leaking beside the loading skeleton.
    await page.goto(emptyPoll.path);
    const emptySkeleton = page.locator("[data-tally-skeleton]");
    const emptyFinalRegion = page.locator("[data-tally-final-region]");
    await expect(emptySkeleton).toBeVisible();
    await expect(emptyFinalRegion).toBeHidden();
    await expect(page.locator(".results-tally-empty")).toBeHidden();
    await page.evaluate(() => window.__advanceResultsAnimationFrame());
    await expect(emptySkeleton).toBeVisible();
    await expect(page.locator(".results-tally-empty")).toBeHidden();
    await page.evaluate(() => window.__advanceResultsAnimationFrame());
    await expect(page.locator(".results-tally-empty")).toHaveText(
      "No Votes yet. Yours would be the first, which is a kind of power.",
    );
    await expect(emptySkeleton).toBeHidden();

    // Uncontrolled (a fresh page without the init script): the rendered
    // final Tally resolves normally and the skeleton leaves the tree.
    const warmPage = await page.context().newPage();
    await warmPage.goto(poll.path);
    const warmSkeleton = warmPage.locator("[data-tally-skeleton]");
    await expect(warmPage.locator("[data-tally-final-region]")).toBeVisible();
    await expect(warmSkeleton).toBeHidden();
    await expect(warmSkeleton).not.toHaveAttribute("aria-busy", "true");
    await expect(
      warmPage.getByRole("img", { name: "Alpha, 50 percent, 1 vote" }),
    ).toBeVisible();
    const finalMotion = await warmPage
      .locator("[data-tally-final] .results-bar-fill")
      .first()
      .evaluate((fill) => getComputedStyle(fill).transitionDuration);
    expect(finalMotion).toBe("0s");
    await warmPage.close();
  });

  test("keeps max-length unbroken labels inside fixed bars without hiding values", async ({
    page,
  }) => {
    const owner = await seedOwner();
    const longLabel = "W".repeat(100);
    const poll = seedPoll({
      ownerId: owner.userId,
      reference: "long-option-label",
      options: [longLabel, "Beta"],
      votes: [[0], [1], [1]],
    });

    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(poll.path);
    const firstBar = page.locator("[data-tally-final] .results-bar").first();
    await expect(firstBar.locator(".results-bar-value")).toBeVisible();
    await expect(firstBar.locator(".results-bar-pct")).toHaveText("33%");
    await expect(firstBar.locator(".results-bar-count")).toHaveText(" · 1");
    await expect(firstBar).toHaveAttribute(
      "aria-label",
      `${longLabel}, 33 percent, 1 vote`,
    );
    await expect(firstBar.locator(".results-bar-track")).toHaveAttribute(
      "style",
      "--bar-width: 33%",
    );

    const assertBarLayout = async (height) => {
      const layout = await page
        .locator("[data-tally-final] .results-bar")
        .evaluateAll((bars) =>
          bars.map((bar) => {
            const track = bar.querySelector(".results-bar-track");
            const content = bar.querySelector(".results-bar-content");
            const value = bar.querySelector(".results-bar-value");
            const trackBox = track.getBoundingClientRect();
            const valueBox = value.getBoundingClientRect();
            return {
              trackHeight: trackBox.height,
              contentHeight: content.getBoundingClientRect().height,
              valueInside:
                valueBox.left >= trackBox.left - 0.5 &&
                valueBox.right <= trackBox.right + 0.5,
            };
          }),
        );
      expect(layout.map(({ trackHeight }) => trackHeight)).toEqual([
        height,
        height,
      ]);
      expect(layout.map(({ contentHeight }) => contentHeight)).toEqual([
        height,
        height,
      ]);
      expect(layout.every(({ valueInside }) => valueInside)).toBe(true);
      expect(
        await page.evaluate(() => {
          const main = document.querySelector("main");
          return (
            document.documentElement.scrollWidth <=
              document.documentElement.clientWidth &&
            main.scrollWidth <= main.clientWidth
          );
        }),
      ).toBe(true);
    };

    const labelPresentation = await firstBar
      .locator(".results-bar-label")
      .evaluate((label) => ({
        text: label.textContent,
        clipped: label.scrollWidth > label.clientWidth,
        overflow: getComputedStyle(label).textOverflow,
        whiteSpace: getComputedStyle(label).whiteSpace,
      }));
    expect(labelPresentation).toEqual({
      text: longLabel,
      clipped: true,
      overflow: "ellipsis",
      whiteSpace: "nowrap",
    });
    await assertBarLayout(34);

    await page.setViewportSize({ width: 1280, height: 900 });
    await assertBarLayout(38);
  });

  test("keeps the final Tally and hidden states fully useful without JavaScript", async ({
    browser,
    baseURL,
  }) => {
    const owner = await seedOwner();
    const live = seedPoll({
      ownerId: owner.userId,
      reference: "no-js-live",
      votes: [[0], [1]],
    });
    const hidden = seedPoll({
      ownerId: owner.userId,
      reference: "no-js-hidden",
      visibility: "after_close",
      votes: [[0]],
    });

    const noJsContext = await browser.newContext({ javaScriptEnabled: false });
    const noJsPage = await noJsContext.newPage();
    await noJsPage.goto(`${requireBaseUrl(baseURL)}${live.path}`);
    await expect(noJsPage.locator("[data-tally-final]")).toBeVisible();
    await expect(noJsPage.locator("[data-tally-skeleton]")).toBeHidden();
    await expect(
      noJsPage.getByRole("img", { name: "Alpha, 50 percent, 1 vote" }),
    ).toBeVisible();

    await noJsPage.goto(`${requireBaseUrl(baseURL)}${hidden.path}`);
    await expect(noJsPage.locator("main")).toContainText(
      "Results open when the Poll closes.",
    );
    await expect(noJsPage.locator("[data-results-tally]")).toHaveCount(0);
    await noJsContext.close();
  });

  test("escapes adversarial Creator-authored question and option labels on every Results surface", async ({
    page,
    baseURL,
  }) => {
    const owner = await seedOwner();
    const question = 'Lunch <img src="x" onerror="alert(1)">?';
    const scriptLabel = "Alpha <script>alert(2)</script>";
    const attributeLabel = 'Beta " autofocus onfocus="alert(3)';
    const poll = seedPoll({
      ownerId: owner.userId,
      reference: "adversarial",
      question,
      options: [scriptLabel, attributeLabel],
      votes: [[0]],
    });

    // Visible surface: literal text, no element or attribute injection.
    await page.goto(poll.path);
    await expect(page.locator("h1.results-question")).toHaveText(question);
    await expect(
      page.getByRole("img", { name: `${scriptLabel}, 100 percent, 1 vote, leading` }),
    ).toBeVisible();
    // The labels render as escaped text — no element or event-handler
    // attribute materializes anywhere in <main>.
    expect(await page.locator('main img[src="x"]').count()).toBe(0);
    expect(await page.locator("main [onerror]").count()).toBe(0);
    expect(await page.locator("main [onfocus]").count()).toBe(0);
    const mainHtml = await page.locator("main").innerHTML();
    expect(mainHtml).not.toContain("<script>alert(2)</script>");
    expect(mainHtml).toContain("&lt;script&gt;alert(2)&lt;/script&gt;");

    // Hidden surface: the question stays escaped there too.
    setResultVisibility(poll.pollId, "after_close");
    const hidden = await page.request.get(
      `${requireBaseUrl(baseURL)}${poll.path}`,
    );
    const hiddenHtml = await hidden.text();
    expect(hiddenHtml).toContain(
      "Lunch &lt;img src=&quot;x&quot; onerror=&quot;alert(1)&quot;&gt;?",
    );
    expect(hiddenHtml).not.toContain('<img src="x"');
  });

  test("proves the key surfaces in a real browser — 375px dark and desktop light", async ({
    page,
    context,
    baseURL,
  }) => {
    const owner = await seedOwner();
    const proofDir = "test-results/results-proof";
    const storyProofDir =
      "test-results/story-3-6-presentable-repository-proof";

    // Direct results with a unique leader — 375px, dark.
    const leader = seedPoll({
      ownerId: owner.userId,
      reference: "proof-leader",
      options: ["Taqueria on Fourth", "The ramen place with no sign"],
      votes: [[0], [1], [1]],
    });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(leader.path);
    await expect(
      page.getByRole("img", {
        name: "The ramen place with no sign, 67 percent, 2 votes, leading",
      }),
    ).toBeVisible();
    const mobileRepository = page.getByRole("link", {
      name: "View the public repository",
    });
    await mobileRepository.focus();
    await expect(mobileRepository).toBeFocused();
    await expect(mobileRepository).toHaveCSS("outline-width", "2px");
    await expect(mobileRepository).toHaveCSS("outline-offset", "2px");
    expect((await mobileRepository.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    expect(
      await page.evaluate(() => {
        const share = document.querySelector(".share-block");
        const footer = document.querySelector(
          "[data-public-repository-footer]",
        );
        return Boolean(
          share &&
            footer &&
            share.compareDocumentPosition(footer) &
              Node.DOCUMENT_POSITION_FOLLOWING,
        );
      }),
    ).toBe(true);
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
    await page.screenshot({
      path: `${storyProofDir}/results-375-dark.png`,
      fullPage: true,
    });
    await page.screenshot({
      path: `${proofDir}/direct-leader-375-dark.png`,
      fullPage: true,
    });

    // Exact tie — 375px, dark.
    const tie = seedPoll({
      ownerId: owner.userId,
      reference: "proof-tie",
      votes: [[0], [1]],
    });
    await page.goto(tie.path);
    await expect(page.locator(".results-tally-tied")).toHaveText("TIED");
    await page.screenshot({
      path: `${proofDir}/direct-tie-375-dark.png`,
      fullPage: true,
    });

    // Direct results with a unique leader — desktop, light.
    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(leader.path);
    await expect(
      page.getByRole("img", {
        name: "The ramen place with no sign, 67 percent, 2 votes, leading",
      }),
    ).toBeVisible();
    const desktopRepository = page.getByRole("link", {
      name: "View the public repository",
    });
    await expect(desktopRepository).toHaveAttribute(
      "href",
      "https://github.com/Hearn-Systems-LLC/oddspark-polls",
    );
    await expect(desktopRepository).not.toHaveAttribute("target", /.+/);
    await desktopRepository.focus();
    await expect(desktopRepository).toBeFocused();
    await page.screenshot({
      path: `${storyProofDir}/results-1280-light.png`,
      fullPage: true,
    });
    await page.screenshot({
      path: `${proofDir}/direct-leader-1280-light.png`,
      fullPage: true,
    });

    // Post-vote surface — ≥1024px, light: YOUR BALLOT left, Tally right.
    // Beta leads on seeded votes; the voter chose Alpha — exactly one gold,
    // on the leader, and never a second one on the ballot.
    const postVote = seedPoll({
      ownerId: owner.userId,
      reference: "proof-post-vote",
      votes: [[1], [1]],
    });
    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(postVote.pollPath);
    await page.locator("label.poll-option", { hasText: "Alpha" }).click();
    await page.getByRole("button", { name: "VOTE" }).click();
    await expect(page).toHaveTitle(/Counted — /);
    const ballot = page.locator("[data-your-ballot]");
    await expect(ballot).toBeVisible();
    const bars = page.locator("[data-tally-final]");
    await expect(bars).toBeVisible();
    await expect(
      page.getByRole("img", { name: "Beta, 67 percent, 2 votes, leading" }),
    ).toBeVisible();
    await expect(
      page.locator(".results-bar-leader-mark:not([hidden])"),
    ).toHaveCount(1);
    const [ballotBox, barsBox] = await Promise.all([
      ballot.boundingBox(),
      bars.boundingBox(),
    ]);
    expect(ballotBox).not.toBeNull();
    expect(barsBox).not.toBeNull();
    // Two columns: the ballot sits left of the bars at lg.
    expect(ballotBox.x + ballotBox.width).toBeLessThanOrEqual(barsBox.x);
    await page.screenshot({
      path: `${proofDir}/post-vote-1280-light.png`,
      fullPage: true,
    });

    // Below lg the same compact composition is one reading-order column —
    // confirmation, ballot, then Tally. Resizing in place keeps the Counted
    // state (no reload, which would become already-voted).
    await page.setViewportSize({ width: 375, height: 812 });
    await page.emulateMedia({ colorScheme: "dark" });
    const [mobileBallotBox, mobileBarsBox] = await Promise.all([
      ballot.boundingBox(),
      bars.boundingBox(),
    ]);
    expect(mobileBallotBox.y + mobileBallotBox.height).toBeLessThanOrEqual(
      mobileBarsBox.y,
    );
    await page.screenshot({
      path: `${proofDir}/post-vote-375-dark.png`,
      fullPage: true,
    });
  });

  test("sets requestContext.pollId for Results operations and keeps result facts out of telemetry", async ({
    baseURL,
  }) => {
    requireBaseUrl(baseURL);
    const owner = await seedOwner();
    const visible = seedPoll({
      ownerId: owner.userId,
      reference: "telemetry-visible",
      visibility: "after_close",
      votes: [[0], [0], [1]],
      closedAtMs: Date.now(),
    });
    const hidden = seedPoll({
      ownerId: owner.userId,
      reference: "telemetry-hidden",
      visibility: "after_close",
      votes: [[0]],
    });
    const unavailable = seedPoll({
      ownerId: owner.userId,
      reference: "telemetry-unavailable",
      votes: [[0]],
      closedAtMs: Date.now(),
    });
    d1Execute(
      `DELETE FROM vote_selection WHERE vote_id IN (SELECT id FROM vote WHERE poll_id = '${unavailable.pollId}')`,
    );
    const missingReference = scopedReference("telemetry-missing");
    const missingPath = `/${missingReference}/results`;

    // The Playwright-managed server's stdout isn't readable, so this test
    // runs its own dev server and captures the Workers Logs telemetry.
    const port = await reserveAvailablePort();
    const child = spawn(
      "pnpm",
      [
        "dev",
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
        "--ignore-lock",
      ],
      {
        cwd: repoRoot,
        env: { ...process.env, ASTRO_DEV_BACKGROUND: "0" },
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const exitPromise = childExitPromise(child);
    let exitOutcome = null;
    void exitPromise.then((outcome) => {
      exitOutcome = outcome;
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });

    const parseRecords = () => {
      const records = [];
      for (const line of output.split("\n")) {
        const json = line.match(/\{"requestId":[^{}]*\}/u)?.[0];
        if (!json) {
          continue;
        }
        try {
          const record = JSON.parse(json);
          if (typeof record.operation === "string") {
            records.push(record);
          }
        } catch {
          // Ignore non-telemetry dev-server output that only resembles JSON.
        }
      }
      return records;
    };
    let requestIds = null;
    let records = [];

    try {
      const origin = `http://127.0.0.1:${port}`;
      const earlyExitError = () => {
        const detail = exitOutcome?.error
          ? exitOutcome.error.message
          : `code=${exitOutcome?.code ?? "null"} signal=${exitOutcome?.signal ?? "null"}`;
        return new Error(
          `Telemetry dev server exited early (${detail}). Output:\n${output.slice(-2_000)}`,
        );
      };

      const startupDeadline = Date.now() + 60_000;
      let ready = false;
      while (!ready && Date.now() < startupDeadline) {
        if (exitOutcome !== null) {
          throw earlyExitError();
        }
        // Vite may auto-increment when a requested port is occupied. Require
        // this child to advertise the exact reserved origin before accepting
        // an HTTP response, so a stale listener cannot satisfy readiness.
        if (output.includes(origin)) {
          try {
            ready = (await fetch(`${origin}/favicon.svg`)).ok;
          } catch {
            ready = false;
          }
        }
        if (!ready) {
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
      if (!ready) {
        throw new Error(
          `Telemetry dev server did not become ready. Output:\n${output.slice(-2_000)}`,
        );
      }

      const visibleResponse = await fetch(`${origin}${visible.path}`);
      const liveResponse = await fetch(`${origin}${visible.path}/live`);
      const hiddenResponse = await fetch(`${origin}${hidden.path}`);
      const missingResponse = await fetch(`${origin}${missingPath}`);
      const unavailableResponse = await fetch(
        `${origin}${unavailable.pollPath}`,
      );
      expect(visibleResponse.status).toBe(200);
      expect(liveResponse.status).toBe(200);
      expect(liveResponse.headers.get("etag")).toBeTruthy();
      expect(hiddenResponse.status).toBe(200);
      expect(missingResponse.status).toBe(404);
      expect(unavailableResponse.status).toBe(200);
      expect(await unavailableResponse.text()).toContain(
        "Results are unavailable right now.",
      );
      const responseRequestId = (response, label) => {
        const requestId = response.headers.get("x-request-id");
        expect(requestId, `${label} response request ID`).toBeTruthy();
        return requestId;
      };
      requestIds = {
        visible: responseRequestId(visibleResponse, "visible"),
        live: responseRequestId(liveResponse, "live"),
        hidden: responseRequestId(hiddenResponse, "hidden"),
        missing: responseRequestId(missingResponse, "missing"),
        unavailable: responseRequestId(
          unavailableResponse,
          "unavailable",
        ),
      };

      // A later sentinel record proves all preceding telemetry bytes have
      // traversed the ordered stdout pipe before cardinality is inspected.
      const sentinel = await fetch(`${origin}/api/health`);
      expect(sentinel.status).toBe(200);
      const telemetryDeadline = Date.now() + 15_000;
      let sentinelSeen = false;
      while (!sentinelSeen && Date.now() < telemetryDeadline) {
        if (exitOutcome !== null) {
          throw earlyExitError();
        }
        records = parseRecords();
        sentinelSeen = records.some(
          (record) => record.operation === "GET /api/health",
        );
        if (!sentinelSeen) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      if (!sentinelSeen) {
        throw new Error(
          `Telemetry sentinel did not flush. Output:\n${output.slice(-2_000)}`,
        );
      }
    } finally {
      await stopProcessGroup(child, exitPromise);
    }

    expect(requestIds).not.toBeNull();
    const targetRequestIds = new Set(Object.values(requestIds));
    const targetRecords = records.filter((record) =>
      targetRequestIds.has(record.requestId),
    );
    for (const [label, requestId] of Object.entries(requestIds)) {
      expect(
        targetRecords.filter((record) => record.requestId === requestId),
        `${label} request must emit exactly one telemetry record`,
      ).toHaveLength(1);
    }
    const byRequestId = new Map(
      targetRecords.map((record) => [record.requestId, record]),
    );

    const visibleRecord = byRequestId.get(requestIds.visible);
    const liveRecord = byRequestId.get(requestIds.live);
    const hiddenRecord = byRequestId.get(requestIds.hidden);
    const missingRecord = byRequestId.get(requestIds.missing);
    const unavailableRecord = byRequestId.get(requestIds.unavailable);
    expect(visibleRecord?.pollId).toBe(visible.pollId);
    expect(liveRecord?.pollId).toBe(visible.pollId);
    expect(hiddenRecord?.pollId).toBe(hidden.pollId);
    expect(missingRecord?.pollId).toBeNull();
    expect(unavailableRecord?.pollId).toBe(unavailable.pollId);
    expect(visibleRecord?.result).toBe("ok");
    expect(liveRecord?.result).toBe("ok");
    expect(hiddenRecord?.result).toBe("ok");
    expect(missingRecord?.result).toBe("not_found");
    expect(unavailableRecord?.result).toBe("error");
    expect(visibleRecord?.operation).toBe("GET /:reference/results");
    expect(liveRecord?.operation).toBe("GET /:reference/results/live");
    expect(hiddenRecord?.operation).toBe("GET /:reference/results");
    expect(missingRecord?.operation).toBe("GET /:reference/results");
    expect(unavailableRecord?.operation).toBe("GET /:reference");

    // Exactly the six voter-blind fields — never a reference, count, or
    // ballot fact.
    const publicReferences = [
      visible.reference,
      hidden.reference,
      missingReference,
      unavailable.reference,
    ];
    for (const record of [
      visibleRecord,
      liveRecord,
      hiddenRecord,
      missingRecord,
      unavailableRecord,
    ]) {
      expect(record).toBeTruthy();
      expect(Object.keys(record).sort()).toEqual([
        "durationMs",
        "operation",
        "pollId",
        "providerOutcome",
        "requestId",
        "result",
      ]);
      const serializedRecord = JSON.stringify(record);
      for (const reference of publicReferences) {
        expect(serializedRecord).not.toContain(reference);
      }
    }
  });
});
