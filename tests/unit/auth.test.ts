import { describe, expect, it } from "vitest";
import {
  createAuth,
  createAuthOptions,
} from "../../src/adapters/auth/index";

function createSchemaOnlyD1(): D1Database {
  const emptyResult = {
    results: [],
    success: true,
    meta: {
      changes: 0,
      last_row_id: null,
    },
  };
  const statement = {
    bind() {
      return statement;
    },
    async all() {
      return emptyResult;
    },
  };

  return {
    prepare() {
      return statement;
    },
    async batch() {
      return [];
    },
    async exec() {
      return { count: 0, duration: 0 };
    },
  } as unknown as D1Database;
}

function createTestEnv(): Env {
  return {
    DB: createSchemaOnlyD1(),
    MEDIA: {} as R2Bucket,
    ASSETS: {} as Fetcher,
    SESSION: {} as KVNamespace,
    VOTE_RATE_LIMITER: {} as RateLimit,
    BETTER_AUTH_SECRET: "test-secret-that-is-at-least-32-characters",
    BETTER_AUTH_URL: "https://polls.example.test",
    VOTE_DIGEST_SECRET: "test-vote-digest-secret",
    GOOGLE_CLIENT_ID: "google-client-id",
    GOOGLE_CLIENT_SECRET: "google-client-secret",
    GITHUB_CLIENT_ID: "github-client-id",
    GITHUB_CLIENT_SECRET: "github-client-secret",
  };
}

describe("Better Auth factory", () => {
  it("builds a provider-only config around the request D1 binding", () => {
    const env = createTestEnv();
    const options = createAuthOptions(env);

    expect(options.database).toBe(env.DB);
    expect(options.secret).toBe(env.BETTER_AUTH_SECRET);
    expect(options.baseURL).toBe(env.BETTER_AUTH_URL);
    expect(options.trustedOrigins).toEqual([env.BETTER_AUTH_URL]);
    expect(options.emailAndPassword).toBeUndefined();
    expect(options.socialProviders).toEqual({
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      },
      github: {
        clientId: env.GITHUB_CLIENT_ID,
        clientSecret: env.GITHUB_CLIENT_SECRET,
      },
    });
    expect(options.advanced?.database?.generateId).toBe("uuid");
    expect(options.account?.encryptOAuthTokens).toBe(true);
    expect(options.onAPIError?.errorURL).toBe(
      "https://polls.example.test/sign-in?outcome=denied&return=%2Fcreator",
    );
    // Rethrow non-APIError endpoint failures so the mount route's catch can
    // redirect to the denial outcome instead of better-call's bare 500.
    expect(options.onAPIError?.throw).toBe(true);
  });

  it("maps every Better Auth model field explicitly to snake_case", () => {
    const options = createAuthOptions(createTestEnv());

    expect(options.user).toEqual({
      modelName: "user",
      fields: {
        name: "name",
        email: "email",
        emailVerified: "email_verified",
        image: "image",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    });
    expect(options.session).toEqual({
      modelName: "session",
      fields: {
        expiresAt: "expires_at",
        token: "token",
        createdAt: "created_at",
        updatedAt: "updated_at",
        ipAddress: "ip_address",
        userAgent: "user_agent",
        userId: "user_id",
      },
    });
    expect(options.account).toEqual({
      modelName: "account",
      encryptOAuthTokens: true,
      accountLinking: {
        enabled: true,
        trustedProviders: ["google", "github"],
      },
      fields: {
        accountId: "account_id",
        providerId: "provider_id",
        userId: "user_id",
        accessToken: "access_token",
        refreshToken: "refresh_token",
        idToken: "id_token",
        accessTokenExpiresAt: "access_token_expires_at",
        refreshTokenExpiresAt: "refresh_token_expires_at",
        scope: "scope",
        password: "password",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    });
    expect(options.verification).toEqual({
      modelName: "verification",
      fields: {
        identifier: "identifier",
        value: "value",
        expiresAt: "expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    });
  });

  it("strips provider ID tokens before account creates and updates", async () => {
    const options = createAuthOptions(createTestEnv());
    const createBefore = options.databaseHooks?.account?.create?.before;
    const updateBefore = options.databaseHooks?.account?.update?.before;
    const account = {
      id: "account-id",
      accountId: "provider-account-id",
      providerId: "google",
      userId: "user-id",
      accessToken: "encrypted-access-token",
      refreshToken: "encrypted-refresh-token",
      idToken: "plaintext-id-token",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    expect(createBefore).toBeTypeOf("function");
    expect(updateBefore).toBeTypeOf("function");

    const createResult = await createBefore!(account, null);
    const updateResult = await updateBefore!(account, null);

    expect(createResult).toMatchObject({
      data: {
        ...account,
        idToken: null,
      },
    });
    expect(updateResult).toMatchObject({
      data: {
        ...account,
        idToken: null,
      },
    });
  });

  it("creates a Better Auth instance with API and handler surfaces", () => {
    const auth = createAuth(createTestEnv());

    expect(auth.api.getSession).toBeTypeOf("function");
    expect(auth.api.signInSocial).toBeTypeOf("function");
    expect(auth.handler).toBeTypeOf("function");
  });
});
