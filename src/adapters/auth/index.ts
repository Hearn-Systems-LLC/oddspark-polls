import { betterAuth, type BetterAuthOptions } from "better-auth";

type AuthEnv = Pick<
  Env,
  | "DB"
  | "BETTER_AUTH_SECRET"
  | "BETTER_AUTH_URL"
  | "GOOGLE_CLIENT_ID"
  | "GOOGLE_CLIENT_SECRET"
  | "GITHUB_CLIENT_ID"
  | "GITHUB_CLIENT_SECRET"
>;

function requireBinding(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`Missing required auth binding: ${name}`);
  }
  return normalized;
}

function resolveBaseURL(value: string): string {
  const url = new URL(requireBinding(value, "BETTER_AUTH_URL"));
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error("BETTER_AUTH_URL must be an origin without a path");
  }
  return url.origin;
}

export function createAuthOptions(env: AuthEnv): BetterAuthOptions {
  const baseURL = resolveBaseURL(env.BETTER_AUTH_URL);
  const defaultAuthErrorURL = new URL(
    "/sign-in?outcome=denied&return=%2Fcreator",
    baseURL,
  ).toString();

  return {
    database: env.DB,
    secret: requireBinding(env.BETTER_AUTH_SECRET, "BETTER_AUTH_SECRET"),
    baseURL,
    trustedOrigins: [baseURL],
    onAPIError: {
      errorURL: defaultAuthErrorURL,
    },
    databaseHooks: {
      account: {
        create: {
          before: async (account) => ({
            data: {
              ...account,
              // Better Auth 1.6 encrypts access/refresh tokens but persists
              // OAuth ID tokens verbatim. They are not needed after callback
              // validation, so never retain them at rest.
              idToken: null,
            },
          }),
        },
        update: {
          before: async (account) => ({
            data: {
              ...account,
              // Also clears any value written before this policy existed.
              idToken: null,
            },
          }),
        },
      },
    },
    socialProviders: {
      google: {
        clientId: requireBinding(env.GOOGLE_CLIENT_ID, "GOOGLE_CLIENT_ID"),
        clientSecret: requireBinding(
          env.GOOGLE_CLIENT_SECRET,
          "GOOGLE_CLIENT_SECRET",
        ),
      },
      github: {
        clientId: requireBinding(env.GITHUB_CLIENT_ID, "GITHUB_CLIENT_ID"),
        clientSecret: requireBinding(
          env.GITHUB_CLIENT_SECRET,
          "GITHUB_CLIENT_SECRET",
        ),
      },
    },
    advanced: {
      database: {
        generateId: "uuid",
      },
    },
    user: {
      modelName: "user",
      fields: {
        name: "name",
        email: "email",
        emailVerified: "email_verified",
        image: "image",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
    session: {
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
    },
    account: {
      modelName: "account",
      encryptOAuthTokens: true,
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
    },
    verification: {
      modelName: "verification",
      fields: {
        identifier: "identifier",
        value: "value",
        expiresAt: "expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
  };
}

export function createAuth(env: AuthEnv) {
  return betterAuth(createAuthOptions(env));
}
