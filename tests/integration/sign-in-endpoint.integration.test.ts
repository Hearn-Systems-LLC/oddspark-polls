import {
  applyD1Migrations,
  type D1Migration,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createAuth } from "../../src/adapters/auth/index";
import { POST } from "../../src/pages/api/sign-in";

type AuthTestEnv = Cloudflare.Env & {
  TEST_MIGRATIONS: D1Migration[];
};

const testEnv = env as AuthTestEnv;
type RouteContext = Parameters<typeof POST>[0];

function makeContext(body: URLSearchParams): RouteContext {
  return {
    request: new Request("https://polls.example.test/api/sign-in", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: "https://polls.example.test",
        "sec-fetch-site": "same-origin",
      },
      body,
    }),
  } as RouteContext;
}

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  await testEnv.DB.batch([
    testEnv.DB.prepare("DELETE FROM session"),
    testEnv.DB.prepare("DELETE FROM account"),
    testEnv.DB.prepare("DELETE FROM verification"),
    testEnv.DB.prepare("DELETE FROM user"),
  ]);
});

describe("no-JavaScript social sign-in endpoint", () => {
  it.each([
    ["google", "accounts.google.com"],
    ["github", "github.com"],
  ])(
    "creates Better Auth state and redirects %s sign-in while forwarding its cookie",
    async (provider, expectedHost) => {
      const response = await POST(
        makeContext(
          new URLSearchParams({
            provider,
            return: "/creator/new?draft=1",
          }),
        ),
      );

      expect(response.status).toBe(303);
      expect(new URL(response.headers.get("location") ?? "").host).toContain(
        expectedHost,
      );
      expect(response.headers.getSetCookie().join(";")).toContain(
        "better-auth.state",
      );

      const stateRows = await testEnv.DB.prepare(
        "SELECT COUNT(*) AS count FROM verification",
      ).first<{ count: number }>();
      expect(stateRows?.count).toBe(1);
    },
  );

  it("rejects an unknown provider at the delivery boundary without creating state", async () => {
    const response = await POST(
      makeContext(
        new URLSearchParams({
          provider: "not-a-provider",
          return: "/creator",
        }),
      ),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      code: "invalid_sign_in_request",
    });

    const stateRows = await testEnv.DB.prepare(
      "SELECT COUNT(*) AS count FROM verification",
    ).first<{ count: number }>();
    expect(stateRows?.count).toBe(0);
  });

  it("routes provider denial through the product outcome without creating identity rows", async () => {
    const initiation = await POST(
      makeContext(
        new URLSearchParams({
          provider: "google",
          return: "/creator/new?draft=1",
        }),
      ),
    );
    const providerURL = new URL(initiation.headers.get("location") ?? "");
    const state = providerURL.searchParams.get("state");
    const cookie = initiation.headers.get("set-cookie");
    if (!state || !cookie) throw new Error("OAuth initiation did not create state");

    const denial = await createAuth(testEnv).handler(
      new Request(
        `https://polls.example.test/api/auth/callback/google?error=access_denied&state=${encodeURIComponent(state)}`,
        { headers: { cookie } },
      ),
    );

    expect(denial.status).toBe(302);
    const denialURL = new URL(
      denial.headers.get("location") ?? "",
      "https://polls.example.test",
    );
    expect(`${denialURL.pathname}${denialURL.search}`).toBe(
      "/sign-in?outcome=denied&return=%2Fcreator%2Fnew%3Fdraft%3D1&error=access_denied",
    );

    for (const table of ["user", "account", "session"]) {
      const row = await testEnv.DB.prepare(
        `SELECT COUNT(*) AS count FROM ${table}`,
      ).first<{ count: number }>();
      expect(row?.count).toBe(0);
    }
  });

  it("maps missing OAuth state to the product denial fallback", async () => {
    const denial = await createAuth(testEnv).handler(
      new Request(
        "https://polls.example.test/api/auth/callback/github?error=access_denied",
      ),
    );

    expect(denial.status).toBe(302);
    const denialURL = new URL(
      denial.headers.get("location") ?? "",
      "https://polls.example.test",
    );
    expect(`${denialURL.pathname}${denialURL.search}`).toBe(
      "/sign-in?outcome=denied&return=%2Fcreator&error=state_not_found",
    );
  });
});
