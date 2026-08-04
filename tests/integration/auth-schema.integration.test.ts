import {
  applyD1Migrations,
  type D1Migration,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { betterAuth } from "better-auth";
import { beforeEach, describe, expect, it } from "vitest";
import { createAuth, createAuthOptions } from "../../src/adapters/auth/index";

type MigrationTestEnv = Cloudflare.Env & {
  TEST_MIGRATIONS: D1Migration[];
};

const testEnv = env as MigrationTestEnv;

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

describe("Better Auth D1 schema", () => {
  it("creates all four explicitly mapped auth tables", async () => {
    const rows = await testEnv.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    ).all<{ name: string }>();

    expect(rows.results.map(({ name }) => name)).toEqual(
      expect.arrayContaining(["account", "session", "user", "verification"]),
    );
  });

  it("uses the mapped snake_case fields and UUID-compatible text IDs", async () => {
    const userColumns = await testEnv.DB.prepare(
      "PRAGMA table_info('user')",
    ).all<{ name: string; type: string; notnull: number }>();
    const accountColumns = await testEnv.DB.prepare(
      "PRAGMA table_info('account')",
    ).all<{ name: string; type: string; notnull: number }>();

    expect(userColumns.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "id", type: "TEXT", notnull: 1 }),
        expect.objectContaining({
          name: "email_verified",
          type: "INTEGER",
          notnull: 1,
        }),
        expect.objectContaining({
          name: "created_at",
          type: "TEXT",
          notnull: 1,
        }),
        expect.objectContaining({
          name: "updated_at",
          type: "TEXT",
          notnull: 1,
        }),
      ]),
    );
    expect(accountColumns.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "account_id" }),
        expect.objectContaining({ name: "provider_id" }),
        expect.objectContaining({ name: "user_id" }),
        expect.objectContaining({ name: "access_token_expires_at" }),
        expect.objectContaining({ name: "refresh_token_expires_at" }),
      ]),
    );
  });

  it("enforces provider-account uniqueness and cascading ownership", async () => {
    const now = new Date().toISOString();
    await testEnv.DB.prepare(
      `INSERT INTO user
        (id, name, email, email_verified, image, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        "00000000-0000-4000-8000-000000000001",
        "Creator",
        "creator@example.test",
        1,
        null,
        now,
        now,
      )
      .run();

    const insertAccount = () =>
      testEnv.DB.prepare(
        `INSERT INTO account
          (id, account_id, provider_id, user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          crypto.randomUUID(),
          "provider-account",
          "github",
          "00000000-0000-4000-8000-000000000001",
          now,
          now,
        )
        .run();

    await insertAccount();
    await expect(insertAccount()).rejects.toThrow();

    await testEnv.DB.prepare("DELETE FROM user WHERE id = ?")
      .bind("00000000-0000-4000-8000-000000000001")
      .run();
    const accountCount = await testEnv.DB.prepare(
      "SELECT COUNT(*) AS count FROM account",
    ).first<{ count: number }>();
    expect(accountCount?.count).toBe(0);
  });

  it("accepts provider identity writes through Better Auth's real D1 adapter", async () => {
    const auth = createAuth(testEnv);
    const context = await auth.$context;
    const providerAccountId = `github-${crypto.randomUUID()}`;
    const created = await context.internalAdapter.createOAuthUser(
      {
        name: "Provider Creator",
        email: `${crypto.randomUUID()}@example.test`,
        emailVerified: true,
        image: null,
      },
      {
        providerId: "github",
        accountId: providerAccountId,
        idToken: "provider-id-token-must-not-persist",
      },
    );

    expect(created.user.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(created.account.userId).toBe(created.user.id);

    const row = await testEnv.DB.prepare(
      `SELECT provider_id, account_id, user_id, id_token
       FROM account
       WHERE id = ?`,
    )
      .bind(created.account.id)
      .first<{
        provider_id: string;
        account_id: string;
        user_id: string;
        id_token: string | null;
      }>();
    expect(row).toEqual({
      provider_id: "github",
      account_id: providerAccountId,
      user_id: created.user.id,
      id_token: null,
    });

    await context.internalAdapter.updateAccount(created.account.id, {
      idToken: "replacement-id-token-must-not-persist",
    });
    const updated = await testEnv.DB.prepare(
      "SELECT id_token FROM account WHERE id = ?",
    )
      .bind(created.account.id)
      .first<{ id_token: string | null }>();
    expect(updated?.id_token).toBeNull();
  });

  it("defaults API-created users to creator and rejects submitted role escalation", async () => {
    const auth = betterAuth({
      ...createAuthOptions(testEnv),
      emailAndPassword: { enabled: true },
    });
    const email = `${crypto.randomUUID()}@example.test`;
    const created = await auth.api.signUpEmail({
      body: {
        name: "Role Boundary Creator",
        email,
        password: "integration-password-123",
        role: "administrator",
      } as never,
    });

    expect(created.user.role).toBe("creator");
    const row = await testEnv.DB.prepare("SELECT role FROM user WHERE id = ?")
      .bind(created.user.id)
      .first<{ role: string }>();
    expect(row?.role).toBe("creator");
  });
});
