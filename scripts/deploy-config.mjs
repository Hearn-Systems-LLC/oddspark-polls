/**
 * Side-effect-free remote Wrangler config builder for deploy.mjs.
 *
 * Copies the selected environment's vars, secrets, and ratelimits so staged
 * deploys receive the target binding set (not the local defaults).
 */

/**
 * Parse the JSON-with-comments form Wrangler accepts without corrupting
 * comment-like characters or trailing-comma text inside string values.
 *
 * @param {string} text JSONC source
 * @returns {object}
 */
export function parseJsonc(text) {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
      out += "\n";
      continue;
    }
    out += ch;
  }

  const chars = [...out];
  inString = false;
  escaped = false;
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === ",") {
      let j = i + 1;
      while (j < chars.length && /\s/u.test(chars[j])) j += 1;
      if (chars[j] === "}" || chars[j] === "]") chars[i] = " ";
    }
  }
  return JSON.parse(chars.join(""));
}

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
