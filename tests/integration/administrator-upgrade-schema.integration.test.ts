import {
  applyD1Migrations,
  type D1Migration,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect, it } from "vitest";

type MigrationTestEnv = Cloudflare.Env & {
  TEST_MIGRATIONS: D1Migration[];
};

const testEnv = env as MigrationTestEnv;

it("upgrades every existing user to the least-privileged creator role", async () => {
  const moderationMigrationIndex = testEnv.TEST_MIGRATIONS.findIndex(
    (migration) => migration.name === "0011_administrator_moderation.sql",
  );
  expect(moderationMigrationIndex).toBeGreaterThan(0);

  await applyD1Migrations(
    testEnv.DB,
    testEnv.TEST_MIGRATIONS.slice(0, moderationMigrationIndex),
  );
  const now = new Date().toISOString();
  await testEnv.DB.prepare(
    `INSERT INTO user
      (id, name, email, email_verified, created_at, updated_at)
     VALUES ('existing-user', 'Existing Creator', 'existing@example.test', 1, ?, ?)`,
  )
    .bind(now, now)
    .run();

  await applyD1Migrations(
    testEnv.DB,
    testEnv.TEST_MIGRATIONS.slice(moderationMigrationIndex),
  );

  const row = await testEnv.DB.prepare(
    "SELECT id, role FROM user WHERE id = 'existing-user'",
  ).first<{ id: string; role: string }>();
  expect(row).toEqual({ id: "existing-user", role: "creator" });
});
