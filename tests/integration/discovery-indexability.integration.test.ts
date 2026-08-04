import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { beforeEach, describe, expect, it } from "vitest";
import PollPage from "../../src/pages/[reference].astro";
import ResultsPage from "../../src/pages/[reference]/results.astro";

type MigrationTestEnv = Cloudflare.Env & { TEST_MIGRATIONS: D1Migration[] };
const testEnv = env as MigrationTestEnv;
const OWNER = "indexability-owner";
const ORIGIN = "https://polls.example.test";

async function seed(input: {
  index: number;
  state: "listed" | "unlisted" | "delisted";
  closedAtMs?: number | null;
  deadlineMs?: number | null;
  alias?: string;
}): Promise<string> {
  const id = `80000000-0000-4000-8000-${String(input.index).padStart(12, "0")}`;
  const reference = `canonical-${input.index}`;
  const now = Date.now();
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT INTO poll (
        id, owner_user_id, poll_type, question, result_visibility,
        discovery_state, session_checks_enabled, representation_version,
        deadline_ms, closed_at_ms, created_at_ms, updated_at_ms
      ) VALUES (?1, ?2, 'multiple_choice', ?3, 'live', ?4, 0, 1, ?5, ?6, ?7, ?7)`,
    ).bind(
      id,
      OWNER,
      `Indexability ${input.index}?`,
      input.state,
      input.deadlineMs ?? null,
      input.closedAtMs ?? null,
      now,
    ),
    testEnv.DB.prepare(
      "INSERT INTO poll_option (id, poll_id, label, position, created_at_ms) VALUES (?1, ?2, 'Yes', 0, ?3)",
    ).bind(`indexability-option-${input.index}`, id, now),
    testEnv.DB.prepare(
      "INSERT INTO poll_reference (reference, poll_id, kind, is_canonical, created_at_ms) VALUES (?1, ?2, 'generated', 1, ?3)",
    ).bind(reference, id, now),
  ]);
  if (input.alias) {
    await testEnv.DB.prepare(
      "INSERT INTO poll_reference (reference, poll_id, kind, is_canonical, created_at_ms) VALUES (?1, ?2, 'custom', 0, ?3)",
    )
      .bind(input.alias, id, now)
      .run();
  }
  return reference;
}

async function render(
  component: typeof PollPage | typeof ResultsPage,
  path: string,
  reference: string,
): Promise<Response> {
  const container = await AstroContainer.create();
  return container.renderToResponse(component, {
    request: new Request(`${ORIGIN}${path}`),
    params: { reference },
    locals: {
      cfContext: {
        waitUntil: () => undefined,
        passThroughOnException: () => undefined,
        props: {},
      } as unknown as ExecutionContext,
    },
  });
}

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  await testEnv.DB.prepare("DELETE FROM vote_selection").run();
  await testEnv.DB.prepare("DELETE FROM voter_claim").run();
  await testEnv.DB.prepare("DELETE FROM vote").run();
  await testEnv.DB.prepare("DELETE FROM poll_option").run();
  await testEnv.DB.prepare("DELETE FROM poll_reference").run();
  await testEnv.DB.prepare("DELETE FROM poll").run();
  await testEnv.DB.prepare(
    "INSERT OR IGNORE INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?1, 'Indexability', 'indexability@example.test', 1, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z')",
  )
    .bind(OWNER)
    .run();
});

describe("voting-page discovery indexability", () => {
  it("indexes only a listed and effectively open canonical Poll page", async () => {
    const reference = await seed({ index: 1, state: "listed" });
    const response = await render(PollPage, `/${reference}`, reference);
    const html = await response.text();
    expect(response.headers.get("x-robots-tag")).toBeNull();
    expect(html).toContain(`rel="canonical" href="${ORIGIN}/${reference}"`);
    expect(html).not.toContain('name="robots" content="noindex"');
    expect(html).not.toMatch(/>\s*(?:LISTED|UNLISTED|DELISTED)\s*</);
  });

  it.each([
    ["unlisted", { state: "unlisted" as const }],
    ["delisted", { state: "delisted" as const }],
    ["manually closed", { state: "listed" as const, closedAtMs: Date.now() - 1 }],
    ["deadline expired", { state: "listed" as const, deadlineMs: Date.now() - 1 }],
  ])("marks a %s Poll noindex without voter-visible listing copy", async (_case, input) => {
    const reference = await seed({ index: 2, ...input });
    const response = await render(PollPage, `/${reference}`, reference);
    const html = await response.text();
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    expect(html).toContain('name="robots" content="noindex"');
    expect(html).toContain(`rel="canonical" href="${ORIGIN}/${reference}"`);
    expect(html).not.toMatch(/>\s*(?:LISTED|UNLISTED|DELISTED)\s*</);
  });

  it("canonicalizes a found alias to the Poll's canonical voting URL", async () => {
    const reference = await seed({ index: 3, state: "listed", alias: "old-link" });
    const response = await render(PollPage, "/old-link", "old-link");
    expect(await response.text()).toContain(
      `rel="canonical" href="${ORIGIN}/${reference}"`,
    );
  });
});

describe("Results-page indexing", () => {
  it("is always noindex and canonicalizes a resolved alias to voting", async () => {
    const reference = await seed({ index: 4, state: "listed", alias: "old-results" });
    const response = await render(ResultsPage, "/old-results/results", "old-results");
    const html = await response.text();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    expect(html).toContain('name="robots" content="noindex"');
    expect(html).toContain(`rel="canonical" href="${ORIGIN}/${reference}"`);
  });

  it("keeps a missing Results route noindex without inventing a canonical", async () => {
    const response = await render(ResultsPage, "/missing/results", "missing");
    const html = await response.text();
    expect(response.status).toBe(404);
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    expect(html).toContain('name="robots" content="noindex"');
    expect(html).not.toContain('rel="canonical"');
  });
});
