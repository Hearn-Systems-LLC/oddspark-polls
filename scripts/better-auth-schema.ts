import { betterAuth } from "better-auth";
import { createAuthOptions } from "../src/adapters/auth/index";

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

const schemaOnlyD1 = {
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

export const auth = betterAuth(
  createAuthOptions({
    DB: schemaOnlyD1,
    BETTER_AUTH_SECRET: "schema-generation-secret-at-least-32-chars",
    BETTER_AUTH_URL: "http://localhost:4321",
    GOOGLE_CLIENT_ID: "schema-google-client",
    GOOGLE_CLIENT_SECRET: "schema-google-secret",
    GITHUB_CLIENT_ID: "schema-github-client",
    GITHUB_CLIENT_SECRET: "schema-github-secret",
  }),
);
