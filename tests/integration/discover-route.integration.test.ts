import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createModerationPersistence } from "../../src/adapters/d1/index";
import { moderatePollDiscovery } from "../../src/modules/discovery/index";
import Discover from "../../src/pages/discover.astro";
import type { PollId, UserId } from "../../src/shared/domain/index";

type MigrationTestEnv = Cloudflare.Env & { TEST_MIGRATIONS: D1Migration[] };
const testEnv = env as MigrationTestEnv;
const ORIGIN = "https://polls.example.test";
const OWNER = "discover-route-owner";
const ADMINISTRATOR = "discover-route-administrator" as UserId;

function idFor(index: number): string {
  return `30000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

async function seed(index: number, question = `Question ${index}?`): Promise<void> {
  const now = Date.now();
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT INTO poll (
        id, owner_user_id, poll_type, question, description,
        result_visibility, discovery_state, session_checks_enabled,
        deadline_ms, closed_at_ms, representation_version, created_at_ms,
        updated_at_ms
      ) VALUES (?1, ?2, 'multiple_choice', ?3, NULL, 'creator_only',
        'listed', 1, NULL, NULL, 1, ?4, ?4)`,
    ).bind(idFor(index), OWNER, question, now + index),
    testEnv.DB.prepare(
      "INSERT INTO poll_reference (reference, poll_id, kind, is_canonical, created_at_ms) VALUES (?1, ?2, 'generated', 1, ?3)",
    ).bind(`route-ref-${index}`, idFor(index), now + index),
  ]);
}

async function render(request: Request): Promise<Response> {
  const pending: Promise<unknown>[] = [];
  const container = await AstroContainer.create();
  const response = await container.renderToResponse(Discover, {
    request,
    locals: {
      cfContext: {
        waitUntil: (promise: Promise<unknown>) => pending.push(promise),
        passThroughOnException: () => undefined,
        props: {},
      } as unknown as ExecutionContext,
    },
  });
  await Promise.allSettled(pending);
  return response;
}

async function moderate(
  pollId: string,
  intent: "delist" | "clear_delisted",
): Promise<void> {
  const result = await moderatePollDiscovery(
    {
      applyModeration: createModerationPersistence(testEnv.DB).applyModeration,
      nowMs: () => Date.now(),
    },
    { userId: ADMINISTRATOR, role: "administrator" },
    pollId as PollId,
    intent,
  );
  expect(result).toEqual({
    ok: true,
    value: { kind: "updated", intent },
  });
}

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  await testEnv.DB.prepare("DELETE FROM moderation_action").run();
  await testEnv.DB.prepare("DELETE FROM vote_selection").run();
  await testEnv.DB.prepare("DELETE FROM voter_claim").run();
  await testEnv.DB.prepare("DELETE FROM vote").run();
  await testEnv.DB.prepare("DELETE FROM poll_option").run();
  await testEnv.DB.prepare("DELETE FROM poll_reference").run();
  await testEnv.DB.prepare("DELETE FROM poll").run();
  await testEnv.DB.prepare(
    "UPDATE discovery_catalog_revision SET revision = revision + 1 WHERE singleton = 1",
  ).run();
  await testEnv.DB.prepare(
    "INSERT OR IGNORE INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?1, 'Discover Route', 'discover-route@example.test', 1, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z')",
  )
    .bind(OWNER)
    .run();
  await testEnv.DB.prepare(
    "INSERT OR IGNORE INTO user (id, name, email, email_verified, created_at, updated_at, role) VALUES (?1, 'Discover Administrator', 'discover-route-administrator@example.test', 1, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z', 'administrator')",
  )
    .bind(ADMINISTRATOR)
    .run();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SSR /discover", () => {
  it("gates unsupported methods before any D1 read", async () => {
    const prepare = vi.spyOn(testEnv.DB, "prepare");
    const response = await render(
      new Request(`${ORIGIN}/discover`, { method: "POST" }),
    );
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(prepare).not.toHaveBeenCalled();
  });

  it("renders exact empty copy, create prompt, and first-page canonical", async () => {
    const response = await render(new Request(`${ORIGIN}/discover`));
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(html).toContain(
      "Nothing here yet. Polls appear when their Creators opt them in. Yours could be the first.",
    );
    expect(html).toContain('href="/creator/new"');
    expect(html).toContain('rel="canonical" href="https://polls.example.test/discover"');
    expect(html).not.toContain('name="robots" content="noindex"');
  });

  it("renders 20 public-only rows and real OLDER pagination", async () => {
    for (let index = 1; index <= 21; index += 1) await seed(index);
    const response = await render(new Request(`${ORIGIN}/discover`));
    const html = await response.text();
    expect((html.match(/data-poll-card/g) ?? []).length).toBe(20);
    expect(html).toContain('href="/route-ref-21"');
    expect(html).not.toContain('href="/route-ref-1"');
    expect(html).toMatch(/href="\/discover\?older=[A-Za-z0-9_-]+"/);
    expect(html).not.toContain(OWNER);
    expect(html).not.toContain(idFor(21));
    expect(html).not.toContain("LISTED");
    expect(html).not.toContain("creator_only");
  });

  it("reflects real delist and clear commands immediately while prior Unlisted stays absent", async () => {
    await seed(41, "Listed directory choice?");
    await seed(42, "Unlisted private choice?");
    await testEnv.DB.prepare(
      "UPDATE poll SET discovery_state = 'unlisted' WHERE id = ?1",
    )
      .bind(idFor(42))
      .run();

    const initial = await (await render(new Request(`${ORIGIN}/discover`))).text();
    expect(initial).toContain('href="/route-ref-41"');
    expect(initial).not.toContain('href="/route-ref-42"');

    await moderate(idFor(41), "delist");
    await moderate(idFor(42), "delist");
    const delisted = await (
      await render(new Request(`${ORIGIN}/discover`))
    ).text();
    expect(delisted).not.toContain('href="/route-ref-41"');
    expect(delisted).not.toContain('href="/route-ref-42"');

    await moderate(idFor(41), "clear_delisted");
    await moderate(idFor(42), "clear_delisted");
    const cleared = await (
      await render(new Request(`${ORIGIN}/discover`))
    ).text();
    expect(cleared).toContain('href="/route-ref-41"');
    expect(cleared).not.toContain('href="/route-ref-42"');
  });

  it("escapes a domain question exactly once", async () => {
    await seed(1, "Choose <script>alert('x')</script> & enjoy?");
    const html = await (await render(new Request(`${ORIGIN}/discover`))).text();
    expect(html).toContain("Choose &lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt; &amp; enjoy?");
    expect(html).not.toContain("<script>alert('x')</script>");
    expect(html).not.toContain("&amp;lt;script");
  });

  it("rejects duplicate or conflicting cursors with a safe noindex 400", async () => {
    const raw = "secret-cursor-value";
    const response = await render(
      new Request(`${ORIGIN}/discover?older=${raw}&older=${raw}`),
    );
    const html = await response.text();
    expect(response.status).toBe(400);
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    expect(html).toContain('name="robots" content="noindex"');
    expect(html).toContain("The directory didn&#39;t load.");
    expect(html).not.toContain(raw);
  });

  it("maps a revision or D1 failure to a retryable noindex 500", async () => {
    const realPrepare = testEnv.DB.prepare.bind(testEnv.DB);
    vi.spyOn(testEnv.DB, "prepare").mockImplementation((query) => {
      if (!query.includes("SELECT revision FROM discovery_catalog_revision")) {
        return realPrepare(query);
      }
      return {
        first: async () => Promise.reject(new Error("D1 unavailable")),
      } as unknown as D1PreparedStatement;
    });
    const response = await render(new Request(`${ORIGIN}/discover`));
    const html = await response.text();
    expect(response.status).toBe(500);
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    expect(html).toContain("The directory didn&#39;t load.");
    expect(html).toContain('href="/discover"');
  });

  it("keeps validated cursor pages self-canonical and noindex", async () => {
    for (let index = 1; index <= 21; index += 1) await seed(index);
    const firstHtml = await (await render(new Request(`${ORIGIN}/discover`))).text();
    const older = /href="(\/discover\?older=[A-Za-z0-9_-]+)"/.exec(firstHtml)?.[1];
    if (!older) throw new Error("missing older link");
    const response = await render(new Request(`${ORIGIN}${older}`));
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    expect(html).toContain('name="robots" content="noindex"');
    expect(html).toContain(`rel="canonical" href="${ORIGIN}${older.replaceAll("&", "&amp;")}"`);
  });

  it("serves semantic GET and HEAD parity with no shared response cache", async () => {
    await seed(1);
    const get = await render(new Request(`${ORIGIN}/discover`));
    const head = await render(
      new Request(`${ORIGIN}/discover`, { method: "HEAD" }),
    );
    expect(head.status).toBe(get.status);
    expect(head.headers.get("cache-control")).toBe("private, no-store");
    expect(head.headers.get("content-type")).toBe(get.headers.get("content-type"));
    // AstroContainer renders the component template before the HTTP adapter
    // applies HEAD's body suppression; the running-server E2E assertion owns
    // the final empty-body contract.
    expect(await head.text()).toContain(">Discover</h1>");
  });
});
