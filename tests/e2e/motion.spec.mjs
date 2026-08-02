import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  agePoll,
  assertUuid,
  cleanupCreator,
  closePoll,
  d1Execute,
  hasBetterAuthSecret,
  requireBaseUrl,
  seedCreatorSession,
} from "./creator-session.mjs";

// Story 1.10: the four motion primitives, the reduced-motion contract, the
// BARS · PIE chart-form toggle with its static pie, and the own-vote spark
// on the confirmation render.
test.describe.configure({ mode: "serial", timeout: 120_000 });

const motionRunId = randomUUID().slice(0, 8);
const proofDir = "test-results/motion-proof";

function scopedReference(reference) {
  return `${reference}-${motionRunId}`;
}

function sqlText(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

// Frame control (house idiom, results.spec.mjs cold-load test): callbacks
// queued by a callback belong to the next frame, matching browser
// scheduling. CSS transitions and the spark are compositor-driven and
// unaffected; the rAF count-up tween becomes deterministic.
function installFrameControl({ virtualTime = false } = {}) {
  let nextFrameId = 0;
  let virtualNowMs = 0;
  const callbacks = new Map();
  if (virtualTime) {
    Object.defineProperty(performance, "now", {
      configurable: true,
      value: () => virtualNowMs,
    });
  }
  window.requestAnimationFrame = (callback) => {
    nextFrameId += 1;
    callbacks.set(nextFrameId, callback);
    return nextFrameId;
  };
  window.cancelAnimationFrame = (frameId) => {
    callbacks.delete(frameId);
  };
  window.__advanceResultsAnimationFrame = (deltaMs = 0) => {
    if (virtualTime) {
      virtualNowMs += deltaMs;
    }
    const frame = Array.from(callbacks.values());
    callbacks.clear();
    const timestamp = performance.now();
    for (const callback of frame) {
      callback(timestamp);
    }
  };
}

function installFastResultsCadence() {
  const nativeSetTimeout = window.setTimeout.bind(window);
  window.setTimeout = (callback, delay, ...args) =>
    nativeSetTimeout(callback, delay === 3_000 ? 25 : delay, ...args);
}

function installVisibilityControl() {
  let visibility = "visible";
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
  window.__setLiveResultsVisibility = (next) => {
    visibility = next;
    document.dispatchEvent(new Event("visibilitychange"));
  };
}

function installSparkObservation() {
  window.__observedResultSparks = [];
  new MutationObserver((records) => {
    for (const record of records) {
      const fill = record.target;
      if (!(fill instanceof HTMLElement) || !fill.classList.contains("is-spark")) {
        continue;
      }
      const optionId = fill.closest("[data-option-id]")?.dataset.optionId;
      if (!window.__observedResultSparks.includes(optionId)) {
        window.__observedResultSparks.push(optionId);
      }
    }
  }).observe(document, {
    attributes: true,
    attributeFilter: ["class"],
    subtree: true,
  });
}

test.describe("motion system and chart toggle", () => {
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
        `Failed to clean ${cleanupErrors.length} motion E2E creator fixture(s)`,
      );
    }
  });

  async function seedOwner() {
    const seeded = await seedCreatorSession();
    assertUuid(seeded.userId);
    seededUserIds.push(seeded.userId);
    return seeded;
  }

  async function captureProof(page, filename) {
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({
      path: `${proofDir}/${filename}`,
      fullPage: true,
    });
  }

  // Same direct-insert fixture shape as the other specs: OPEN first so the
  // vote-open trigger accepts the rows, then aged past creation.
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
      `INSERT INTO poll (id, owner_user_id, poll_type, question, result_visibility, session_checks_enabled, multi_select_enabled, min_selections, max_selections, deadline_ms, closed_at_ms, representation_version, created_at_ms, updated_at_ms) VALUES ('${pollId}', '${ownerId}', 'multiple_choice', 'Motion?', '${visibility}', 1, ${multiSelect ? 1 : 0}, NULL, NULL, NULL, NULL, ${1 + votes.length}, ${nowMs}, ${nowMs});`,
      ...options.map(
        (label, position) =>
          `INSERT INTO poll_option (id, poll_id, label, position, created_at_ms) VALUES ('${optionIds[position]}', '${pollId}', ${sqlText(label)}, ${position}, ${nowMs});`,
      ),
      `INSERT INTO poll_reference (reference, poll_id, kind, is_canonical, created_at_ms) VALUES (${sqlText(runReference)}, '${pollId}', 'custom', 1, ${nowMs});`,
    ];
    votes.forEach((selections, index) => {
      const voteId = randomUUID();
      statements.push(
        `INSERT INTO vote (id, poll_id, submission_id, payload_hash, created_at_ms) VALUES ('${voteId}', '${pollId}', '${randomUUID()}', 'seed-${motionRunId}-${index}', ${nowMs});`,
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
      labels: options,
      reference: runReference,
      pollPath: `/${runReference}`,
      resultsPath: `/${runReference}/results`,
      livePath: `/${runReference}/results/live`,
    };
  }

  function livePayload(poll, counts) {
    const voterCount = counts.reduce((sum, count) => sum + count, 0);
    const positiveMax = Math.max(0, ...counts);
    const leaders = counts.filter((count) => count === positiveMax);
    const tied = positiveMax > 0 && leaders.length > 1;
    return {
      multiSelectEnabled: false,
      options: counts.map((count, position) => {
        const pieShare = voterCount === 0 ? 0 : count / voterCount;
        return {
          id: poll.optionIds[position],
          label: poll.labels[position],
          position,
          count,
          percent: Math.round(pieShare * 100),
          pieShare,
          leading: positiveMax > 0 && !tied && count === positiveMax,
        };
      }),
      voterCount,
      selectionCount: voterCount,
      tied,
      empty: positiveMax === 0,
      status: "open",
    };
  }

  // Mid-test Vote arrival without a browser flow: direct rows plus the
  // representation_version bump that makes the next poll return fresh data.
  function addVotes(poll, selectionsList) {
    const nowMs = Date.now();
    const statements = [];
    for (const selections of selectionsList) {
      const voteId = randomUUID();
      statements.push(
        `INSERT INTO vote (id, poll_id, submission_id, payload_hash, created_at_ms) VALUES ('${voteId}', '${poll.pollId}', '${randomUUID()}', 'motion-${randomUUID()}', ${nowMs});`,
        ...selections.map(
          (optionIndex) =>
            `INSERT INTO vote_selection (vote_id, poll_option_id) VALUES ('${voteId}', '${poll.optionIds[optionIndex]}');`,
        ),
      );
    }
    statements.push(
      `UPDATE poll SET representation_version = representation_version + 1, updated_at_ms = ${nowMs} WHERE id = '${poll.pollId}';`,
    );
    d1Execute(statements.join(""));
  }

  function bar(page, label) {
    return page
      .locator("[data-tally-final] .results-bar")
      .filter({ hasText: label });
  }

  async function barWidth(page, label) {
    return bar(page, label)
      .locator(".results-bar-track")
      .evaluate((element) => element.style.getPropertyValue("--bar-width"));
  }

  async function waitForWidth(page, label, width) {
    await expect
      .poll(async () => barWidth(page, label), { timeout: 7_000 })
      .toBe(width);
  }

  // Loads the Results route under frame control and drives the cold-load
  // reveal. Also proves the initial-paint contract (AC #5): revealed but
  // not yet armed, an idle tally reports zero motion.
  async function loadTally(page, resultsPath) {
    await page.goto(resultsPath);
    await page.evaluate(() => window.__advanceResultsAnimationFrame());
    await page.evaluate(() => window.__advanceResultsAnimationFrame());
    await expect(page.locator("[data-tally-final-region]")).toBeVisible();
    const tally = page.locator("[data-results-tally]");
    await expect(tally).not.toHaveClass(/is-motion-armed/);
    const idleDuration = await page
      .locator("[data-tally-final] .results-bar-fill")
      .first()
      .evaluate((element) => getComputedStyle(element).transitionDuration);
    expect(idleDuration).toBe("0s");
    return tally;
  }

  test("arms on the first update: width transition, changed-bar spark, and exact count landing", async ({
    page,
  }) => {
    await page.addInitScript(installFrameControl);
    const owner = await seedOwner();
    const poll = seedPoll({
      ownerId: owner.userId,
      reference: "armed-update",
      votes: [[0]],
    });
    const tally = await loadTally(page, poll.resultsPath);
    await page.evaluate(() => {
      window.__observedResultSparks = [];
      for (const fill of document.querySelectorAll(
        "[data-tally-final] .results-bar-fill",
      )) {
        new MutationObserver(() => {
          if (!fill.classList.contains("is-spark")) {
            return;
          }
          const style = getComputedStyle(fill);
          window.__observedResultSparks.push({
            optionId: fill.closest("[data-option-id]")?.dataset.optionId,
            name: style.animationName,
            duration: style.animationDuration,
          });
        }).observe(fill, { attributes: true, attributeFilter: ["class"] });
      }
    });

    // Five Beta Votes land in one representation-version change before the
    // first cadence response. Keep this to one D1 invocation: Wrangler startup
    // is slow enough in CI for the poller to observe two separate writes.
    addVotes(poll, [[1], [1], [1], [1], [1]]);
    await waitForWidth(page, "Beta", "83%");

    // AC #1: every fill transitions width over 480ms with the leader
    // cross-fade legs at 240ms, on the spec easing.
    const armedMotion = await bar(page, "Beta")
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
    await expect(tally).toHaveClass(/is-motion-armed/);

    // The spark fires on the count-increased bar only: Beta gained five
    // Votes; Alpha's share settled without a count increase, so no spark.
    await expect
      .poll(() => page.evaluate(() => window.__observedResultSparks))
      .toEqual([
        {
          optionId: poll.optionIds[1],
          name: "results-bar-spark",
          duration: "0.18s",
        },
      ]);

    // The count-up is rAF-driven: under frame control the displayed values
    // still read the pre-update SSR text until frames advance.
    const betaPct = bar(page, "Beta").locator(".results-bar-pct");
    const betaCount = bar(page, "Beta").locator(".results-bar-count");
    await expect(betaPct).toHaveText("0%");
    await expect(betaCount).toHaveText(" · 0");

    // One intermediate frame: ticking, never past the true final value.
    await page.evaluate(() => window.__advanceResultsAnimationFrame());
    const intermediate = Number.parseInt(await betaPct.textContent(), 10);
    expect(intermediate).toBeGreaterThanOrEqual(0);
    expect(intermediate).toBeLessThanOrEqual(83);

    // Past the 400ms window, one more frame lands exactly on the final
    // values — one settle to the latest, never a queued replay.
    await page.waitForTimeout(450);
    await page.evaluate(() => window.__advanceResultsAnimationFrame());
    await expect(betaPct).toHaveText("83%");
    await expect(betaCount).toHaveText(" · 5");
    await page.evaluate(() => window.__advanceResultsAnimationFrame());
    await page.evaluate(() => window.__advanceResultsAnimationFrame());
    await expect(betaPct).toHaveText("83%");
    await expect(betaCount).toHaveText(" · 5");

    // The leadership cross-fade moved the ◆ to Beta — exactly one per
    // surface, moving with the gold.
    await expect(bar(page, "Beta")).toHaveClass(/is-leader/);
    await expect(bar(page, "Alpha")).not.toHaveClass(/is-leader/);
    await expect(
      page.locator(".results-bar-leader-mark:visible"),
    ).toHaveCount(1);
    await expect(page.locator(".results-bar-fill.is-spark")).toHaveCount(0);
  });

  test("coalesces two client reconciles inside one count-up window", async ({
    page,
  }) => {
    await page.addInitScript(installFrameControl, { virtualTime: true });
    await page.addInitScript(installFastResultsCadence);
    const owner = await seedOwner();
    const poll = seedPoll({
      ownerId: owner.userId,
      reference: "two-reconciles",
      votes: [[0]],
    });
    const payloads = [livePayload(poll, [100, 100]), livePayload(poll, [100, 200])];
    const etags = ['"3:open"', '"4:open"'];
    let releaseFirst;
    let releaseSecond;
    const firstGate = new Promise((resolve) => {
      releaseFirst = resolve;
    });
    const secondGate = new Promise((resolve) => {
      releaseSecond = resolve;
    });
    const requestValidators = [];
    let responseIndex = 0;
    await page.route(`**${poll.livePath}`, async (route) => {
      requestValidators.push(
        route.request().headers()["if-none-match"] ?? null,
      );
      if (responseIndex < payloads.length) {
        const current = responseIndex;
        responseIndex += 1;
        await (current === 0 ? firstGate : secondGate);
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: {
            "cache-control": "private, no-store",
            etag: etags[current],
          },
          body: JSON.stringify(payloads[current]),
        });
        return;
      }
      await route.fulfill({
        status: 304,
        headers: {
          "cache-control": "private, no-store",
          etag: etags.at(-1),
        },
      });
    });

    await loadTally(page, poll.resultsPath);
    await page.evaluate((optionId) => {
      const target = document.querySelector(`[data-option-id="${optionId}"]`);
      window.__betaCountTargets = [];
      new MutationObserver(() => {
        window.__betaCountTargets.push(target?.getAttribute("data-count"));
      }).observe(target, { attributes: true, attributeFilter: ["data-count"] });
    }, poll.optionIds[1]);

    releaseFirst();
    await expect(bar(page, "Beta")).toHaveAttribute("data-count", "100");
    await waitForWidth(page, "Beta", "50%");
    await page.evaluate(() => window.__advanceResultsAnimationFrame(100));
    const firstIntermediateText = await bar(page, "Beta")
      .locator(".results-bar-count")
      .textContent();
    const firstIntermediate = Number.parseInt(
      firstIntermediateText?.match(/\d+/u)?.[0] ?? "",
      10,
    );
    expect(firstIntermediate).toBeGreaterThan(0);
    expect(firstIntermediate).toBeLessThan(100);

    releaseSecond();
    await expect(bar(page, "Beta")).toHaveAttribute("data-count", "200");
    await waitForWidth(page, "Beta", "67%");
    await expect.poll(() => requestValidators[1]).toBe(etags[0]);
    await expect
      .poll(() => page.evaluate(() => window.__betaCountTargets))
      .toEqual(["100", "200"]);

    await page.evaluate(() => window.__advanceResultsAnimationFrame(399));
    const latestIntermediateText = await bar(page, "Beta")
      .locator(".results-bar-count")
      .textContent();
    expect(
      Number.parseInt(latestIntermediateText?.match(/\d+/u)?.[0] ?? "", 10),
    ).toBeLessThanOrEqual(200);
    await page.evaluate(() => window.__advanceResultsAnimationFrame(1));
    await expect(bar(page, "Beta").locator(".results-bar-pct")).toHaveText(
      "67%",
    );
    await expect(bar(page, "Beta").locator(".results-bar-count")).toHaveText(
      " · 200",
    );
    await expect(page.locator("[data-live-total-visual]")).toHaveText(
      "300 VOTES",
    );
    await page.evaluate(() => window.__advanceResultsAnimationFrame(500));
    await expect(bar(page, "Beta").locator(".results-bar-count")).toHaveText(
      " · 200",
    );
  });

  test("withdraws all gold and ◆ under TIED on an exact tie, then re-awards on a flip", async ({
    page,
  }) => {
    await page.addInitScript(installFrameControl);
    const owner = await seedOwner();
    const poll = seedPoll({
      ownerId: owner.userId,
      reference: "tie-withdrawal",
      votes: [[0], [0], [1]],
    });
    await loadTally(page, poll.resultsPath);

    // 2–2 exact tie: TIED appears, gold and ◆ withdraw from EVERY bar.
    addVotes(poll, [[1]]);
    await expect(page.locator("[data-live-tied]")).toBeVisible({
      timeout: 7_000,
    });
    await expect(page.locator("[data-tally-final] .is-leader")).toHaveCount(
      0,
    );
    await expect(
      page.locator(".results-bar-leader-mark:visible"),
    ).toHaveCount(0);

    // A further Vote breaks the tie: the new leader takes the gold and the
    // one ◆ back.
    addVotes(poll, [[1]]);
    await waitForWidth(page, "Beta", "60%");
    await expect(page.locator("[data-live-tied]")).toBeHidden();
    await expect(bar(page, "Beta")).toHaveClass(/is-leader/);
    await expect(
      page.locator(".results-bar-leader-mark:visible"),
    ).toHaveCount(1);
  });

  test("snaps visibility-return and stale-recovery refreshes to current values", async ({
    page,
  }) => {
    await page.addInitScript(installFrameControl);
    await page.addInitScript(installVisibilityControl);
    const owner = await seedOwner();
    const poll = seedPoll({
      ownerId: owner.userId,
      reference: "snap-contexts",
      votes: [[0]],
    });
    const tally = await loadTally(page, poll.resultsPath);

    // First drive an ordinary 200 cadence so the tally is armed and its
    // numeric slots have an active target while frame callbacks are held.
    addVotes(poll, [[1]]);
    await waitForWidth(page, "Beta", "50%");
    await expect(tally).toHaveClass(/is-motion-armed/);
    await expect(bar(page, "Beta").locator(".results-bar-count")).toHaveText(
      " · 0",
    );

    // No data changes while away, so the visibility recovery gets 304. It
    // must still snap the armed target instead of resuming the old tween.
    await page.evaluate(() => window.__setLiveResultsVisibility("hidden"));
    await page.evaluate(() => window.__setLiveResultsVisibility("visible"));
    await expect(bar(page, "Beta").locator(".results-bar-pct")).toHaveText(
      "50%",
    );
    await expect(bar(page, "Beta").locator(".results-bar-count")).toHaveText(
      " · 1",
    );
    await expect(page.locator(".results-bar-fill.is-spark")).toHaveCount(0);

    // Hidden: polling pauses. Two more Beta Votes land while away.
    await page.evaluate(() => window.__setLiveResultsVisibility("hidden"));
    addVotes(poll, [[1], [1]]);
    await page.evaluate(() => window.__setLiveResultsVisibility("visible"));

    // The visibility-return refresh is a snap context (UX-DR15): values
    // land final with NO count-up frames advanced.
    await waitForWidth(page, "Beta", "75%");
    await expect(bar(page, "Beta").locator(".results-bar-pct")).toHaveText(
      "75%",
    );
    await expect(bar(page, "Beta").locator(".results-bar-count")).toHaveText(
      " · 3",
    );

    // Stale recovery: answer polls with a malformed payload until the
    // poller presents stale (a network abort would log a console error and
    // fail the collector), then reconnect — another snap context.
    await page.route(`**${poll.livePath}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "cache-control": "private, no-store" },
        body: "{}",
      }),
    );
    await expect(page.locator("[data-live-stale]")).toBeVisible({
      timeout: 10_000,
    });
    addVotes(poll, [[1]]);
    await page.unroute(`**${poll.livePath}`);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await waitForWidth(page, "Beta", "80%");
    await expect(bar(page, "Beta").locator(".results-bar-pct")).toHaveText(
      "80%",
    );
    await expect(bar(page, "Beta").locator(".results-bar-count")).toHaveText(
      " · 4",
    );
    await expect(page.locator("[data-live-stale]")).toBeHidden();
  });

  test("lands every update instantly under reduced motion without losing information", async ({
    page,
  }) => {
    await page.addInitScript(installFrameControl);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const owner = await seedOwner();
    const poll = seedPoll({
      ownerId: owner.userId,
      reference: "reduced-motion",
      votes: [[0]],
    });
    await loadTally(page, poll.resultsPath);

    addVotes(poll, [[1], [1]]);
    await waitForWidth(page, "Beta", "67%");

    // AC #4: widths and numbers snap (no count-up frames needed), the
    // spark is omitted, leader colors change on the frame — full fidelity.
    await expect(bar(page, "Beta").locator(".results-bar-pct")).toHaveText(
      "67%",
    );
    await expect(bar(page, "Beta").locator(".results-bar-count")).toHaveText(
      " · 2",
    );
    await expect(
      bar(page, "Beta").locator(".results-bar-fill"),
    ).not.toHaveClass(/is-spark/);
    const reducedDuration = await bar(page, "Beta")
      .locator(".results-bar-fill")
      .evaluate((element) => ({
        duration: getComputedStyle(element).transitionDuration,
        animation: getComputedStyle(element).animationName,
      }));
    expect(reducedDuration).toEqual({ duration: "0s", animation: "none" });
    await expect(bar(page, "Beta")).toHaveClass(/is-leader/);
    await expect(
      page.locator(".results-bar-leader-mark:visible"),
    ).toHaveCount(1);
  });

  test("snaps an active count-up when reduced motion becomes enabled", async ({
    page,
  }) => {
    await page.addInitScript(installFrameControl);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const owner = await seedOwner();
    const poll = seedPoll({
      ownerId: owner.userId,
      reference: "reduced-motion-change",
      votes: [[0]],
    });
    await loadTally(page, poll.resultsPath);

    addVotes(poll, [[1], [1]]);
    await waitForWidth(page, "Beta", "67%");
    await expect(bar(page, "Beta").locator(".results-bar-count")).toHaveText(
      " · 0",
    );

    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(bar(page, "Beta").locator(".results-bar-pct")).toHaveText(
      "67%",
    );
    await expect(bar(page, "Beta").locator(".results-bar-count")).toHaveText(
      " · 2",
    );
    await expect(page.locator("[data-live-total-visual]")).toHaveText(
      "3 VOTES",
    );
    await expect(page.locator(".results-bar-fill.is-spark")).toHaveCount(0);

    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.evaluate(() => window.__advanceResultsAnimationFrame());
    await expect(bar(page, "Beta").locator(".results-bar-count")).toHaveText(
      " · 2",
    );
  });

  test("toggles BARS · PIE: static pie with ◆ legend, static live re-render, BARS default on reload", async ({
    page,
  }) => {
    await page.addInitScript(installFrameControl);
    const owner = await seedOwner();
    const poll = seedPoll({
      ownerId: owner.userId,
      reference: "chart-toggle",
      votes: [[0], [0], [1]],
    });
    await loadTally(page, poll.resultsPath);

    const toggle = page.locator("[data-chart-form-toggle]");
    await expect(toggle).toBeVisible();
    const barsButton = toggle.locator('[data-chart-form="bars"]');
    const pieButton = toggle.locator('[data-chart-form="pie"]');
    await expect(barsButton).toHaveAttribute("aria-pressed", "true");
    await expect(pieButton).toHaveAttribute("aria-pressed", "false");

    // 48px hit target on the row's buttons.
    const barsBox = await barsButton.boundingBox();
    expect(barsBox).not.toBeNull();
    expect(barsBox.height).toBeGreaterThanOrEqual(48);

    // Keyboard focus carries the 2px token focus ring.
    for (let tab = 0; tab < 10; tab += 1) {
      const focused = await page.evaluate(
        () => document.activeElement?.dataset?.chartForm ?? null,
      );
      if (focused === "pie") {
        break;
      }
      await page.keyboard.press("Tab");
    }
    await expect(pieButton).toBeFocused();
    const focusRing = await pieButton.evaluate((element) => {
      const style = getComputedStyle(element);
      return { width: style.outlineWidth, style: style.outlineStyle };
    });
    expect(focusRing).toEqual({ width: "2px", style: "solid" });

    // Switch to PIE: bars hide visually, the static pie renders.
    await pieButton.click();
    await expect(page.locator("[data-tally-final]")).toBeHidden();
    const pie = page.locator("[data-chart-form-pie]");
    await expect(pie).toBeVisible();
    await expect(pieButton).toHaveAttribute("aria-pressed", "true");
    await expect(barsButton).toHaveAttribute("aria-pressed", "false");
    const svg = pie.locator("svg");
    await expect(svg).toHaveAttribute("aria-hidden", "true");
    await expect(pie.locator(".chart-form-pie-slice")).toHaveCount(2);
    await expect(pie.locator(".chart-form-pie-slice-leader")).toHaveCount(1);
    const legendRows = pie.locator(".chart-form-pie-legend-row");
    await expect(legendRows).toHaveCount(2);
    await expect(legendRows.first()).toHaveAttribute(
      "aria-label",
      "Alpha, 67 percent, 2 votes, leading",
    );
    await expect(legendRows.nth(1)).toHaveAttribute(
      "aria-label",
      "Beta, 33 percent, 1 vote",
    );
    await legendRows.evaluateAll((rows) => {
      for (const [index, row] of rows.entries()) {
        row.setAttribute("data-persistence-token", `legend-${index}`);
      }
    });
    // Never a percentage without its raw count; exactly one ◆.
    await expect(legendRows.first()).toContainText("67%");
    await expect(legendRows.first()).toContainText(" · 2");
    await expect(pie.locator(".chart-form-pie-legend-mark")).toHaveCount(1);

    // No motion computed anywhere in the pie view.
    const pieMotion = await pie.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        transition: style.transitionDuration,
        animation: style.animationName,
      };
    });
    expect(pieMotion).toEqual({ transition: "0s", animation: "none" });

    // A live update while PIE is active lands as a plain re-render at the
    // new values — legend, slices, and the one ◆ all move statically.
    addVotes(poll, [[1], [1]]);
    await expect(legendRows.first()).toHaveAttribute(
      "aria-label",
      "Alpha, 40 percent, 2 votes",
      { timeout: 7_000 },
    );
    await expect(legendRows.nth(1)).toHaveAttribute(
      "aria-label",
      "Beta, 60 percent, 3 votes, leading",
    );
    await expect(legendRows.first()).toHaveAttribute(
      "data-persistence-token",
      "legend-0",
    );
    await expect(legendRows.nth(1)).toHaveAttribute(
      "data-persistence-token",
      "legend-1",
    );
    await expect(pie.locator(".chart-form-pie-legend-mark")).toHaveCount(1);

    // Switching back re-enters bars at current values with no replay.
    await barsButton.click();
    await expect(page.locator("[data-tally-final]")).toBeVisible();
    await expect(pie).toBeHidden();
    expect(await barWidth(page, "Beta")).toBe("60%");
    await expect(bar(page, "Beta").locator(".results-bar-pct")).toHaveText(
      "60%",
    );
    await expect(page.locator(".results-bar-fill.is-spark")).toHaveCount(0);

    // Enter PIE during a fresh BARS tween. The chart-form handshake snaps
    // every numeric slot before hiding, and BARS re-entry cannot replay it.
    addVotes(poll, [[0]]);
    await waitForWidth(page, "Alpha", "50%");
    await expect(bar(page, "Alpha").locator(".results-bar-count")).toHaveText(
      " · 2",
    );
    await pieButton.click();
    await expect(legendRows.first()).toHaveAttribute(
      "aria-label",
      "Alpha, 50 percent, 3 votes",
    );
    await expect(legendRows.nth(1)).toHaveAttribute(
      "aria-label",
      "Beta, 50 percent, 3 votes",
    );
    await expect(page.locator(".results-bar-fill.is-spark")).toHaveCount(0);
    await barsButton.click();
    await expect(bar(page, "Alpha").locator(".results-bar-count")).toHaveText(
      " · 3",
    );
    await page.evaluate(() => window.__advanceResultsAnimationFrame());
    await expect(bar(page, "Alpha").locator(".results-bar-count")).toHaveText(
      " · 3",
    );

    // The choice never persists: a reload lands on BARS again.
    await page.reload();
    await page.evaluate(() => window.__advanceResultsAnimationFrame());
    await page.evaluate(() => window.__advanceResultsAnimationFrame());
    await expect(page.locator("[data-tally-final]")).toBeVisible();
    await expect(page.locator("[data-chart-form-pie]")).toBeHidden();
    await expect(
      page.locator('[data-chart-form="bars"]'),
    ).toHaveAttribute("aria-pressed", "true");
  });

  test("renders every positive wedge from exact shares when rounded percentages overshoot", async ({
    page,
  }) => {
    const owner = await seedOwner();
    const counts = [...Array(24).fill(2), ...Array(6).fill(1)];
    const poll = seedPoll({
      ownerId: owner.userId,
      reference: "exact-pie-shares",
      options: counts.map((_, index) => `Option ${index + 1}`),
      votes: counts.flatMap((count, optionIndex) =>
        Array.from({ length: count }, () => [optionIndex])
      ),
    });
    await page.goto(poll.resultsPath);
    await expect(page.locator("[data-tally-final-region]")).toBeVisible();
    await page.locator('[data-chart-form="pie"]').click();

    const bars = page.locator("[data-tally-final] [data-option-id]");
    await expect(bars).toHaveCount(30);
    expect(
      await bars.evaluateAll((rows) =>
        rows.every((row) => Number(row.getAttribute("data-pie-share")) > 0)
      ),
    ).toBe(true);
    await expect(
      page.locator("[data-chart-form-pie] .chart-form-pie-slice"),
    ).toHaveCount(30);
  });

  test("sparks a positive-count option whose displayed percentage rounds to zero", async ({
    page,
  }) => {
    const owner = await seedOwner();
    const poll = seedPoll({
      ownerId: owner.userId,
      reference: "rounded-zero-spark",
      votes: [[0]],
    });
    const payload = livePayload(poll, [200, 1]);
    let releaseResponse;
    const responseGate = new Promise((resolve) => {
      releaseResponse = resolve;
    });
    let served = false;
    await page.route(`**${poll.livePath}`, async (route) => {
      if (!served) {
        served = true;
        await responseGate;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: {
            "cache-control": "private, no-store",
            etag: '"3:open"',
          },
          body: JSON.stringify(payload),
        });
        return;
      }
      await route.fulfill({
        status: 304,
        headers: {
          "cache-control": "private, no-store",
          etag: '"3:open"',
        },
      });
    });
    await page.goto(poll.resultsPath);
    await expect(page.locator("[data-tally-final-region]")).toBeVisible();
    await page.evaluate((optionId) => {
      const fill = document.querySelector(
        `[data-option-id="${optionId}"] .results-bar-fill`,
      );
      window.__roundedZeroSpark = null;
      new MutationObserver(() => {
        if (fill?.classList.contains("is-spark")) {
          const style = getComputedStyle(fill);
          window.__roundedZeroSpark = {
            animationName: style.animationName,
            borderRightStyle: style.borderRightStyle,
          };
        }
      }).observe(fill, { attributes: true, attributeFilter: ["class"] });
    }, poll.optionIds[1]);

    releaseResponse();
    await expect(bar(page, "Beta")).toHaveAttribute("data-count", "1", {
      timeout: 7_000,
    });
    await expect(bar(page, "Beta")).toHaveAttribute("data-percent", "0");
    await expect(bar(page, "Beta")).not.toHaveClass(/is-zero/);
    await expect
      .poll(() => page.evaluate(() => window.__roundedZeroSpark))
      .toEqual({
        animationName: "results-bar-spark",
        borderRightStyle: "solid",
      });
    await expect(
      bar(page, "Beta").locator(".results-bar-fill"),
    ).not.toHaveClass(/is-spark/, { timeout: 1_000 });
  });

  test("keeps the value cluster fixed while counting across 9 to 10", async ({
    page,
  }) => {
    await page.addInitScript(installFrameControl, { virtualTime: true });
    const owner = await seedOwner();
    const poll = seedPoll({
      ownerId: owner.userId,
      reference: "digit-boundary",
      votes: [...Array(9).fill([0]), [1]],
    });
    await loadTally(page, poll.resultsPath);
    addVotes(poll, [[0]]);
    await expect(bar(page, "Alpha")).toHaveAttribute("data-count", "10", {
      timeout: 7_000,
    });

    const measure = () =>
      bar(page, "Alpha").evaluate((element) => {
        const value = element.querySelector(".results-bar-value")?.getBoundingClientRect();
        const label = element.querySelector(".results-bar-label")?.getBoundingClientRect();
        return {
          value: value && { left: value.left, right: value.right, width: value.width },
          label: label && { right: label.right, width: label.width },
        };
      });
    const baseline = await measure();
    for (const deltaMs of [0, 100, 100, 199, 1]) {
      await page.evaluate(
        (delta) => window.__advanceResultsAnimationFrame(delta),
        deltaMs,
      );
      const sample = await measure();
      for (const group of ["value", "label"]) {
        for (const key of Object.keys(baseline[group])) {
          expect(sample[group][key]).toBeCloseTo(baseline[group][key], 2);
        }
      }
    }
    await expect(bar(page, "Alpha").locator(".results-bar-count")).toHaveText(
      " · 10",
    );
  });

  test("omits the toggle on multi-select Tallies and hides it without JavaScript", async ({
    page,
    browser,
    baseURL,
  }) => {
    const owner = await seedOwner();
    const multi = seedPoll({
      ownerId: owner.userId,
      reference: "multi-no-toggle",
      multiSelect: true,
      votes: [[0], [1]],
    });
    await page.goto(multi.resultsPath);
    await expect(page.locator("[data-tally-final-region]")).toBeVisible();
    await expect(page.locator(".results-tally-summary")).toHaveText(
      "2 VOTERS · 2 SELECTIONS",
    );
    await expect(page.locator("[data-chart-form-toggle]")).toHaveCount(0);
    await expect(page.locator("[data-chart-form-pie]")).toHaveCount(0);
    await expect(
      page.locator("[data-tally-final] .results-bar"),
    ).toHaveCount(2);

    const single = seedPoll({
      ownerId: owner.userId,
      reference: "no-js-toggle",
      votes: [[0]],
    });
    const noJsContext = await browser.newContext({
      baseURL: requireBaseUrl(baseURL),
      javaScriptEnabled: false,
    });
    const noJsPage = await noJsContext.newPage();
    try {
      await noJsPage.goto(single.resultsPath);
      // The no-JS floor: the complete bar Tally, never a dead control.
      await expect(noJsPage.locator("[data-tally-final]")).toBeVisible();
      await expect(
        noJsPage.locator("[data-chart-form-toggle]"),
      ).toBeHidden();
    } finally {
      await noJsContext.close();
    }
  });

  test("sparks the voter's own bar as the Counted. confirmation renders, outcome line focused", async ({
    page,
  }) => {
    await page.addInitScript(installSparkObservation);
    const owner = await seedOwner();
    const poll = seedPoll({ ownerId: owner.userId, reference: "own-spark" });
    await page.goto(poll.pollPath);
    await page.locator("label.poll-option", { hasText: "Beta" }).click();
    await page.getByRole("button", { name: "VOTE" }).click();
    await expect(page).toHaveTitle(/Counted — /u);

    // The focus contract is undisturbed: the outcome line, not the Tally.
    await expect(page.locator("[data-vote-outcome]")).toBeFocused();

    // AC #6: the voter's own bar sparks — and only theirs.
    await expect(page.locator("[data-your-option]")).toHaveCount(1);
    const betaFill = bar(page, "Beta").locator(".results-bar-fill");
    await expect
      .poll(() => page.evaluate(() => window.__observedResultSparks))
      .toEqual([poll.optionIds[1]]);
    await expect(betaFill).not.toHaveClass(/is-spark/, { timeout: 1_000 });
  });

  test("sparks every selected bar simultaneously on a multi-select confirmation", async ({
    page,
  }) => {
    await page.addInitScript(installSparkObservation);
    const owner = await seedOwner();
    const poll = seedPoll({
      ownerId: owner.userId,
      reference: "own-spark-multi",
      options: ["Alpha", "Beta", "Gamma"],
      multiSelect: true,
    });
    await page.goto(poll.pollPath);
    await page.locator("label.poll-option", { hasText: "Alpha" }).click();
    await page.locator("label.poll-option", { hasText: "Beta" }).click();
    await page.getByRole("button", { name: "VOTE" }).click();
    await expect(page).toHaveTitle(/Counted — /u);

    await expect(page.locator("[data-your-option]")).toHaveCount(2);
    await expect
      .poll(() => page.evaluate(() => window.__observedResultSparks))
      .toEqual([poll.optionIds[0], poll.optionIds[1]]);
    await expect(page.locator(".results-bar-fill.is-spark")).toHaveCount(0, {
      timeout: 1_000,
    });
  });

  test("omits the own-vote spark under reduced motion but keeps the confirmation", async ({
    page,
  }) => {
    await page.addInitScript(installSparkObservation);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const owner = await seedOwner();
    const poll = seedPoll({
      ownerId: owner.userId,
      reference: "own-spark-reduced",
    });
    await page.goto(poll.pollPath);
    await page.locator("label.poll-option", { hasText: "Beta" }).click();
    await page.getByRole("button", { name: "VOTE" }).click();
    await expect(page).toHaveTitle(/Counted — /u);

    // The marker still renders; the spark is omitted entirely — the
    // confirmation text IS the state change.
    await expect(page.locator("[data-your-option]")).toHaveCount(1);
    await expect(page.locator(".results-bar-fill.is-spark")).toHaveCount(0);
    expect(await page.evaluate(() => window.__observedResultSparks)).toEqual(
      [],
    );
    await expect(page.locator("[data-vote-outcome]")).toBeFocused();
  });

  test("confirms with a spark when the Poll closes between vote and render, with no poller", async ({
    page,
    baseURL,
  }) => {
    await page.addInitScript(installSparkObservation);
    const owner = await seedOwner();
    const poll = seedPoll({
      ownerId: owner.userId,
      reference: "own-spark-closed",
    });
    await page.goto(poll.pollPath);
    // Vote through the shared request context without following the 303, so
    // the close lands deterministically between the accepted POST and the
    // confirmation navigation (a route gate can't hold a redirect chain).
    const submissionId = await page
      .locator('input[name="submission_id"]')
      .getAttribute("value");
    const betaOptionId = await page
      .locator("label.poll-option", { hasText: "Beta" })
      .locator('input[name="option_id"]')
      .getAttribute("value");
    const posted = await page.request.post(poll.pollPath, {
      form: {
        submission_id: submissionId ?? "",
        option_id: betaOptionId ?? "",
      },
      headers: {
        origin: requireBaseUrl(baseURL),
        "sec-fetch-site": "same-origin",
      },
      maxRedirects: 0,
    });
    expect(posted.status()).toBe(303);
    closePoll(poll.pollId, Date.now());
    await page.goto(poll.pollPath);

    await expect(page).toHaveTitle(/Counted — /u);
    await expect(page.locator("[data-live-label]")).toHaveText("CLOSED");
    // The poller never loads on a closed Tally — the spark is the
    // enhancement layer's, and it still fires.
    expect(
      await page
        .locator("[data-results-tally]")
        .getAttribute("data-live-enhanced"),
    ).toBeNull();
    await expect
      .poll(() => page.evaluate(() => window.__observedResultSparks))
      .toEqual([poll.optionIds[1]]);
    await expect(page.locator(".results-bar-fill.is-spark")).toHaveCount(0, {
      timeout: 1_000,
    });
  });

  test("captures the motion-era browser proof at 375px dark and desktop light", async ({
    page,
  }) => {
    const owner = await seedOwner();
    const poll = seedPoll({
      ownerId: owner.userId,
      reference: "proof-tally",
      votes: [[0], [0], [1]],
    });

    // (a) The bar Tally after a live update has settled — Beta has just
    // taken the lead 3–2, mid motion era.
    await page.setViewportSize({ width: 375, height: 812 });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto(poll.resultsPath);
    await expect(page.locator("[data-tally-final-region]")).toBeVisible();
    addVotes(poll, [[1], [1]]);
    await waitForWidth(page, "Beta", "60%");
    await expect(bar(page, "Beta").locator(".results-bar-pct")).toHaveText(
      "60%",
    );
    await expect(bar(page, "Beta")).toHaveClass(/is-leader/);
    await captureProof(page, "tally-post-update-375-dark.png");

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ colorScheme: "light" });
    await captureProof(page, "tally-post-update-1280-light.png");

    // (b) + (c-pie) The PIE view with its legend; the toggle row above it
    // shows PIE current.
    await page.locator('[data-chart-form="pie"]').click();
    await expect(page.locator("[data-chart-form-pie]")).toBeVisible();
    await expect(
      page.locator(".chart-form-pie-legend-row").first(),
    ).toHaveAttribute("aria-label", "Alpha, 40 percent, 2 votes");
    await captureProof(page, "pie-with-legend-1280-light.png");

    await page.setViewportSize({ width: 375, height: 812 });
    await page.emulateMedia({ colorScheme: "dark" });
    await captureProof(page, "pie-with-legend-375-dark.png");

    // (c-bars) The toggle with BARS current above the settled Tally.
    await page.locator('[data-chart-form="bars"]').click();
    await expect(page.locator("[data-tally-final]")).toBeVisible();
    await captureProof(page, "toggle-bars-375-dark.png");

    // (d) The post-vote confirmation — the voter's own bar sparked as the
    // Counted. outcome rendered (the 180ms flash itself is asserted by
    // class in the tests above; this is the settled confirmation surface).
    const confirmation = seedPoll({
      ownerId: owner.userId,
      reference: "proof-confirmation",
    });
    await page.goto(confirmation.pollPath);
    await page.locator("label.poll-option", { hasText: "Beta" }).click();
    await page.getByRole("button", { name: "VOTE" }).click();
    await expect(page).toHaveTitle(/Counted — /u);
    await expect(page.locator("[data-vote-outcome]")).toBeFocused();
    await expect(
      bar(page, "Beta").locator(".results-bar-fill"),
    ).toHaveClass(/is-spark/);
    await captureProof(page, "confirmation-spark-375-dark.png");

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ colorScheme: "light" });
    await captureProof(page, "confirmation-spark-1280-light.png");
  });
});
