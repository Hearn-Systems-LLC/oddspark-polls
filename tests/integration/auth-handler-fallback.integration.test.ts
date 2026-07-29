import {
  applyD1Migrations,
  type D1Migration,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { ALL } from "../../src/pages/api/auth/[...all]";
import { SIGN_IN_DENIED_PATH } from "../../src/modules/identity/index";

type AuthTestEnv = Cloudflare.Env & {
  TEST_MIGRATIONS: D1Migration[];
};

const testEnv = env as AuthTestEnv;

function makeContext(request: Request) {
  return { request } as unknown as Parameters<typeof ALL>[0];
}

// Force createAuth to throw by blanking a required binding. Better Auth's
// own endpoints convert most in-handler storage failures into structured
// APIError responses themselves (get-session → FAILED_TO_GET_SESSION),
// so a missing-binding construction failure is the deterministic way to
// exercise the mount route's catch. Restored in finally — env is shared.
async function withBrokenAuthConfig<T>(run: () => T | Promise<T>): Promise<T> {
  const original = testEnv.BETTER_AUTH_SECRET;
  testEnv.BETTER_AUTH_SECRET = "";
  try {
    return await run();
  } finally {
    testEnv.BETTER_AUTH_SECRET = original;
  }
}

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

describe("auth handler fallback", () => {
  it("redirects browser navigations to the denial outcome when auth fails", async () => {
    const response = await withBrokenAuthConfig(() =>
      ALL(
        makeContext(
          new Request("https://polls.example.test/api/auth/get-session"),
        ),
      ),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(SIGN_IN_DENIED_PATH);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("returns a JSON error for non-navigation API calls when auth fails", async () => {
    const response = await withBrokenAuthConfig(() =>
      ALL(
        makeContext(
          new Request("https://polls.example.test/api/auth/sign-out", {
            method: "POST",
          }),
        ),
      ),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      code: "auth_unavailable",
    });
  });
});
