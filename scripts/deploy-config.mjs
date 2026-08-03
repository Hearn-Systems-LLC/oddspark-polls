/**
 * Side-effect-free remote Wrangler config builder for deploy.mjs.
 *
 * Copies the selected environment's vars, secrets, and ratelimits so staged
 * deploys receive the target binding set (not the local defaults).
 */

/**
 * Build a deploy-ready Wrangler JSON object for a named remote environment.
 *
 * @param {object} wranglerJson Parsed root wrangler.jsonc
 * @param {"staging" | "production"} envName Target environment name
 * @returns {object} Deploy config suitable for writing as wrangler.json
 */
export function buildRemoteDeployConfig(wranglerJson, envName) {
  if (envName !== "staging" && envName !== "production") {
    throw new Error(`Unsupported deploy environment: ${envName}`);
  }

  const envCfg = wranglerJson.env?.[envName];
  if (!envCfg?.name) {
    throw new Error(`Missing env.${envName} in wrangler.jsonc`);
  }

  return {
    name: envCfg.name,
    main: "worker/index.mjs",
    no_bundle: true,
    rules: [{ type: "ESModule", globs: ["**/*.js", "**/*.mjs"] }],
    compatibility_date: wranglerJson.compatibility_date,
    compatibility_flags: wranglerJson.compatibility_flags,
    assets: {
      binding: "ASSETS",
      directory: "./client",
    },
    observability: { enabled: true },
    workers_dev: true,
    vars: envCfg.vars ?? {},
    secrets: envCfg.secrets ?? { required: [] },
    ratelimits: envCfg.ratelimits ?? [],
    kv_namespaces: envCfg.kv_namespaces,
    d1_databases: (envCfg.d1_databases ?? []).map(
      ({ migrations_dir: _m, ...rest }) => rest,
    ),
    r2_buckets: envCfg.r2_buckets,
  };
}
