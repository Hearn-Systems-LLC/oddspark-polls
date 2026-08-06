import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";
import type { APIContext } from "astro";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createModerationPersistence } from "../../src/adapters/d1/index";
import { moderatePollDiscovery } from "../../src/modules/discovery/index";
import {
  ALL as sitemapAll,
  GET as sitemapGet,
} from "../../src/pages/sitemap.xml";
import * as SitemapEndpoint from "../../src/pages/sitemap.xml";
import {
  ALL as robotsAll,
  GET as robotsGet,
} from "../../src/pages/robots.txt";
import * as RobotsEndpoint from "../../src/pages/robots.txt";
import type { PollId, UserId } from "../../src/shared/domain/index";

type MigrationTestEnv = Cloudflare.Env & { TEST_MIGRATIONS: D1Migration[] };
const testEnv = env as MigrationTestEnv;
const OWNER = "discovery-endpoint-owner";
const ADMINISTRATOR = "discovery-endpoint-administrator" as UserId;
const ORIGIN = "https://polls.example.test";

function context(path: string, init?: RequestInit): APIContext {
  return {
    request: new Request(`${ORIGIN}${path}`, init),
  } as APIContext;
}

async function seed(input: {
  index: number;
  state?: "listed" | "unlisted" | "delisted";
  deadlineMs?: number | null;
  closedAtMs?: number | null;
  reference?: string;
}): Promise<string> {
  const id = `60000000-0000-4000-8000-${String(input.index).padStart(12, "0")}`;
  const createdAtMs = Date.now() + input.index;
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT INTO poll (
        id, owner_user_id, poll_type, question, description,
        result_visibility, discovery_state, session_checks_enabled,
        deadline_ms, closed_at_ms, representation_version, created_at_ms,
        updated_at_ms
      ) VALUES (?1, ?2, 'multiple_choice', ?3, NULL, 'live', ?4, 1,
        ?5, ?6, 1, ?7, ?7)`,
    ).bind(
      id,
      OWNER,
      `Endpoint ${input.index}?`,
      input.state ?? "listed",
      input.deadlineMs ?? null,
      input.closedAtMs ?? null,
      createdAtMs,
    ),
    testEnv.DB.prepare(
      "INSERT INTO poll_reference (reference, poll_id, kind, is_canonical, created_at_ms) VALUES (?1, ?2, 'generated', 1, ?3)",
    ).bind(input.reference ?? `endpoint-${input.index}`, id, createdAtMs),
  ]);
  return id;
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
    "INSERT OR IGNORE INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?1, 'Discovery Endpoint', 'discovery-endpoint@example.test', 1, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z')",
  )
    .bind(OWNER)
    .run();
  await testEnv.DB.prepare(
    "INSERT OR IGNORE INTO user (id, name, email, email_verified, created_at, updated_at, role) VALUES (?1, 'Discovery Administrator', 'discovery-endpoint-administrator@example.test', 1, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z', 'administrator')",
  )
    .bind(ADMINISTRATOR)
    .run();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sitemap.xml", () => {
  it("emits only the two static URLs when no Poll is eligible", async () => {
    const response = await sitemapGet(context("/sitemap.xml"));
    const xml = await response.text();
    expect(xml.match(/<url><loc>/g)).toHaveLength(2);
    expect(xml).toContain(`<loc>${ORIGIN}/</loc>`);
    expect(xml).toContain(`<loc>${ORIGIN}/discover</loc>`);
  });

  it("emits only static and canonical listed/open URLs from the request origin", async () => {
    const openId = await seed({ index: 1, reference: "xml&poll" });
    await testEnv.DB.prepare(
      "INSERT INTO poll_reference (reference, poll_id, kind, is_canonical, created_at_ms) VALUES ('hidden-alias', ?1, 'custom', 0, ?2)",
    )
      .bind(openId, Date.now())
      .run();
    await seed({ index: 2, state: "unlisted" });
    await seed({ index: 3, state: "delisted" });
    await seed({ index: 4, closedAtMs: Date.now() - 1 });
    await seed({ index: 5, deadlineMs: Date.now() - 1 });
    await seed({ index: 6, deadlineMs: Date.now() + 60_000 });

    const response = await sitemapGet(
      context("/sitemap.xml", {
        headers: { "x-forwarded-host": "attacker.example" },
      }),
    );
    const xml = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/xml; charset=utf-8",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(xml).toContain("<?xml version=\"1.0\" encoding=\"UTF-8\"?>");
    expect(xml).toContain(`<loc>${ORIGIN}/</loc>`);
    expect(xml).toContain(`<loc>${ORIGIN}/discover</loc>`);
    expect(xml).toContain(`<loc>${ORIGIN}/xml%26poll</loc>`);
    expect(xml).toContain(`<loc>${ORIGIN}/endpoint-6</loc>`);
    expect(xml).not.toContain("attacker.example");
    expect(xml).not.toContain("hidden-alias");
    expect(xml).not.toContain("endpoint-2");
    expect(xml).not.toContain("endpoint-3");
    expect(xml).not.toContain("endpoint-4");
    expect(xml).not.toContain("endpoint-5");
  });

  it("reflects close, unlist, and delete on the next request", async () => {
    const id = await seed({ index: 10 });
    expect(await (await sitemapGet(context("/sitemap.xml"))).text()).toContain(
      "/endpoint-10",
    );

    await testEnv.DB.prepare("UPDATE poll SET closed_at_ms = ?1 WHERE id = ?2")
      .bind(Date.now(), id)
      .run();
    expect(await (await sitemapGet(context("/sitemap.xml"))).text()).not.toContain(
      "/endpoint-10",
    );

    await testEnv.DB.prepare(
      "UPDATE poll SET closed_at_ms = NULL, discovery_state = 'unlisted' WHERE id = ?1",
    )
      .bind(id)
      .run();
    expect(await (await sitemapGet(context("/sitemap.xml"))).text()).not.toContain(
      "/endpoint-10",
    );

    await testEnv.DB.prepare("DELETE FROM poll WHERE id = ?1").bind(id).run();
    expect(await (await sitemapGet(context("/sitemap.xml"))).text()).not.toContain(
      "/endpoint-10",
    );
  });

  it("reflects real delist and clear commands while prior Unlisted stays absent", async () => {
    const listedId = await seed({ index: 11, state: "listed" });
    const unlistedId = await seed({ index: 12, state: "unlisted" });

    const initial = await (await sitemapGet(context("/sitemap.xml"))).text();
    expect(initial).toContain(`${ORIGIN}/endpoint-11</loc>`);
    expect(initial).not.toContain("endpoint-12");

    await moderate(listedId, "delist");
    await moderate(unlistedId, "delist");
    const delisted = await (await sitemapGet(context("/sitemap.xml"))).text();
    expect(delisted).not.toContain("endpoint-11");
    expect(delisted).not.toContain("endpoint-12");

    await moderate(listedId, "clear_delisted");
    await moderate(unlistedId, "clear_delisted");
    const cleared = await (await sitemapGet(context("/sitemap.xml"))).text();
    expect(cleared).toContain(`${ORIGIN}/endpoint-11</loc>`);
    expect(cleared).not.toContain("endpoint-12");
  });

  it("walks beyond one 1,000-row merged batch", async () => {
    const now = Date.now();
    await testEnv.DB.prepare(
      `WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 1001)
       INSERT INTO poll (
         id, owner_user_id, poll_type, question, result_visibility,
         discovery_state, session_checks_enabled, representation_version,
         created_at_ms, updated_at_ms
       )
       SELECT printf('70000000-0000-4000-8000-%012d', n), '${OWNER}',
         'multiple_choice', 'Batch', 'live', 'listed', 1, 1, ${now} + n, ${now} + n
       FROM seq`,
    ).run();
    await testEnv.DB.prepare(
      `WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 1001)
       INSERT INTO poll_reference (reference, poll_id, kind, is_canonical, created_at_ms)
       SELECT printf('batch-%d', n), printf('70000000-0000-4000-8000-%012d', n),
         'generated', 1, ${now} + n FROM seq`,
    ).run();

    const xml = await (await sitemapGet(context("/sitemap.xml"))).text();
    expect(xml.match(/<url><loc>/g)).toHaveLength(1_003);
    expect(xml).toContain("/batch-1</loc>");
    expect(xml).toContain("/batch-1001</loc>");
  });

  it("keeps fresh children range-bounded through boundary deletion and Deadline exclusion", async () => {
    const now = Date.now();
    await testEnv.DB.prepare(
      `WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 45001)
       INSERT INTO poll (
         id, owner_user_id, poll_type, question, result_visibility,
         discovery_state, session_checks_enabled, deadline_ms,
         representation_version, created_at_ms, updated_at_ms
       )
       SELECT printf('71000000-0000-4000-8000-%012d', n), '${OWNER}',
         'multiple_choice', 'Range child', 'live', 'listed', 1,
         CASE WHEN n = 45001 THEN ${now} + 60000 ELSE NULL END,
         1, ${now} + n, ${now} + n
       FROM seq`,
    ).run();
    await testEnv.DB.prepare(
      `WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 45001)
       INSERT INTO poll_reference (reference, poll_id, kind, is_canonical, created_at_ms)
       SELECT printf('range-%d', n), printf('71000000-0000-4000-8000-%012d', n),
         'generated', 1, ${now} + n FROM seq`,
    ).run();

    const root = await sitemapGet(context("/sitemap.xml"));
    const index = await root.text();
    const children = [
      ...index.matchAll(/<sitemap><loc>([^<]+)<\/loc><\/sitemap>/gu),
    ].map((match) => new URL((match[1] as string).replaceAll("&amp;", "&")));
    expect(root.status).toBe(200);
    expect(index).toContain("<sitemapindex");
    expect(children).toHaveLength(2);

    await testEnv.DB.batch([
      testEnv.DB.prepare(
        "DELETE FROM poll WHERE id = '71000000-0000-4000-8000-000000000002'",
      ),
      testEnv.DB.prepare(
        "UPDATE poll SET deadline_ms = ?1 WHERE id = '71000000-0000-4000-8000-000000045001'",
      ).bind(Date.now() - 1),
    ]);

    const childDocuments: string[] = [];
    for (const child of children) {
      const response = await sitemapGet(context(`${child.pathname}${child.search}`));
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      childDocuments.push(await response.text());
    }
    const combined = childDocuments.join("\n");
    const pollLocations = [...combined.matchAll(/<url><loc>([^<]+)<\/loc><\/url>/gu)]
      .map((match) => match[1] as string)
      .filter((location) => location.includes("/range-"));
    expect(pollLocations).toHaveLength(44_999);
    expect(new Set(pollLocations)).toHaveLength(44_999);
    expect(combined).not.toContain("/range-2</loc>");
    expect(combined).not.toContain("/range-45001</loc>");
    expect(childDocuments[0]?.match(/<url><loc>/g)).toHaveLength(45_000);
    expect(childDocuments[1]?.match(/<url><loc>/g)).toHaveLength(1);

    await testEnv.DB.prepare(
      "DELETE FROM poll WHERE id = '71000000-0000-4000-8000-000000000001'",
    ).run();
    const emptied = await sitemapGet(
      context(`${children[1]!.pathname}${children[1]!.search}`),
    );
    expect(emptied.status).toBe(410);
    expect(emptied.headers.get("cache-control")).toBe("no-store");
    expect(await emptied.text()).toBe("sitemap_range_gone");
  });

  it("rejects malformed range queries before touching D1", async () => {
    const prepare = vi.spyOn(testEnv.DB, "prepare");
    const response = await sitemapGet(
      context("/sitemap.xml?range=bad&range=duplicate&private=value"),
    );
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("invalid_sitemap_range");
    expect(prepare).not.toHaveBeenCalled();
  });

  it("maps an already-disconnected request to the stable abort response", async () => {
    const prepare = vi.spyOn(testEnv.DB, "prepare");
    const controller = new AbortController();
    controller.abort();
    const response = await sitemapGet(
      context("/sitemap.xml", { signal: controller.signal }),
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("sitemap_generation_aborted");
    expect(prepare).not.toHaveBeenCalled();
  });

  it("maps persistence failures to a stable private-data-free response", async () => {
    vi.spyOn(testEnv.DB, "prepare").mockImplementation(() => {
      throw new Error("private poll reference");
    });
    const response = await sitemapGet(context("/sitemap.xml"));
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("sitemap_unavailable");
  });

  it("rejects unsupported methods without discovery work", async () => {
    const prepare = vi.spyOn(testEnv.DB, "prepare");
    const response = await sitemapAll(context("/sitemap.xml", { method: "POST" }));
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(prepare).not.toHaveBeenCalled();
  });
});

describe("robots.txt", () => {
  it("allows crawling and advertises only the absolute sitemap URL", async () => {
    const response = await robotsGet(
      context("/robots.txt", {
        headers: { "x-forwarded-host": "attacker.example" },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/plain; charset=utf-8",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe(
      `User-agent: *\nAllow: /\nSitemap: ${ORIGIN}/sitemap.xml\n`,
    );
  });

  it("rejects unsupported methods without exposing route details", async () => {
    const response = await robotsAll(context("/robots.txt", { method: "DELETE" }));
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD");
    expect(await response.text()).toBe("Method not allowed.");
  });
});

describe("Astro endpoint HEAD semantics", () => {
  it.each([
    ["sitemap.xml", SitemapEndpoint, "application/xml; charset=utf-8"],
    ["robots.txt", RobotsEndpoint, "text/plain; charset=utf-8"],
  ])("runs %s GET for HEAD and strips only the body", async (path, endpoint, contentType) => {
    const container = await AstroContainer.create();
    const get = await container.renderToResponse(endpoint as never, {
      routeType: "endpoint",
      request: new Request(`${ORIGIN}/${path}`),
    });
    const head = await container.renderToResponse(endpoint as never, {
      routeType: "endpoint",
      request: new Request(`${ORIGIN}/${path}`, { method: "HEAD" }),
    });
    const post = await container.renderToResponse(endpoint as never, {
      routeType: "endpoint",
      request: new Request(`${ORIGIN}/${path}`, { method: "POST" }),
    });

    expect(head.status).toBe(get.status);
    expect(head.headers.get("content-type")).toBe(contentType);
    expect(head.headers.get("cache-control")).toBe(
      get.headers.get("cache-control"),
    );
    expect(await head.text()).toBe("");
    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe("GET, HEAD");
  });
});
