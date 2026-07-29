import { defineConfig } from "vitest/config";

/**
 * Vitest 4 projects split: unit stays on node; integration uses workerd
 * via a separate config so unit tests don't pay workerd startup.
 */
export default defineConfig({
  test: {
    projects: [
      "./vitest.unit.config.ts",
      "./vitest.integration.config.ts",
    ],
  },
});
