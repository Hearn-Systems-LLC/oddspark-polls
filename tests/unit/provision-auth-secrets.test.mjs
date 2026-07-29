import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const sourceScript = resolve("scripts/provision-auth-secrets.zsh");
const sandboxes = [];

function createSandbox() {
  const projectRoot = mkdtempSync(join(tmpdir(), "oddspark-provision-test-"));
  sandboxes.push(projectRoot);

  const scriptsDirectory = join(projectRoot, "scripts");
  const binDirectory = join(projectRoot, "bin");
  mkdirSync(scriptsDirectory);
  mkdirSync(binDirectory);

  const script = join(scriptsDirectory, "provision-auth-secrets.zsh");
  copyFileSync(sourceScript, script);
  chmodSync(script, 0o700);

  const opensslTrace = join(projectRoot, "openssl-called");
  const fakeOpenSSL = join(binDirectory, "openssl");
  writeFileSync(
    fakeOpenSSL,
    [
      "#!/bin/sh",
      'touch "$PROVISION_TEST_OPENSSL_TRACE"',
      "printf '%s\\n' 'test-master-secret-that-is-long-enough'",
      "",
    ].join("\n"),
    { mode: 0o700 },
  );

  const mvTrace = join(projectRoot, "mv-source");
  const fakeMv = join(binDirectory, "mv");
  writeFileSync(
    fakeMv,
    [
      "#!/bin/sh",
      'printf "%s\\n" "$3" > "$PROVISION_TEST_MV_TRACE"',
      'exec /bin/mv "$@"',
      "",
    ].join("\n"),
    { mode: 0o700 },
  );

  return {
    projectRoot,
    binDirectory,
    script,
    opensslTrace,
    mvTrace,
    env: {
      ...process.env,
      PATH: `${binDirectory}:${process.env.PATH ?? ""}`,
      PROVISION_TEST_MV_TRACE: mvTrace,
      PROVISION_TEST_OPENSSL_TRACE: opensslTrace,
    },
  };
}

function runProvision(
  sandbox,
  args,
  input,
  extraEnv = {},
) {
  return spawnSync("zsh", [sandbox.script, ...args], {
    encoding: "utf8",
    env: { ...sandbox.env, ...extraEnv },
    input,
  });
}

afterEach(() => {
  for (const sandbox of sandboxes.splice(0)) {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

describe("masked auth secret provisioning", () => {
  it("requires an explicit initialization mode and refuses to replace local master material", () => {
    const sandbox = createSandbox();
    const credentials = [
      "google-client-id",
      "google-client-secret",
      "github-client-id",
      "github-client-secret",
      "",
    ].join("\n");

    const initialized = runProvision(
      sandbox,
      ["local", "initialize"],
      credentials,
    );
    expect(initialized.status).toBe(0);

    const destination = join(sandbox.projectRoot, ".dev.vars");
    const original = readFileSync(destination, "utf8");
    expect(statSync(destination).mode & 0o777).toBe(0o600);
    expect(
      realpathSync(dirname(readFileSync(sandbox.mvTrace, "utf8").trim())),
    ).toBe(
      realpathSync(sandbox.projectRoot),
    );
    expect(original).toContain(
      "BETTER_AUTH_SECRET=test-master-secret-that-is-long-enough",
    );

    rmSync(sandbox.opensslTrace);
    const repeated = runProvision(
      sandbox,
      ["local", "initialize"],
      credentials,
    );

    expect(repeated.status).toBe(1);
    expect(repeated.stderr).toContain("already initialized");
    expect(readFileSync(destination, "utf8")).toBe(original);
    expect(existsSync(sandbox.opensslTrace)).toBe(false);
  });

  it("rotates only provider credentials while preserving local master material", () => {
    const sandbox = createSandbox();
    const initialCredentials = [
      "google-client-id",
      "google-client-secret",
      "github-client-id",
      "github-client-secret",
      "",
    ].join("\n");
    const rotatedCredentials = [
      "new-google-client-id",
      "new-google-client-secret",
      "new-github-client-id",
      "new-github-client-secret",
      "",
    ].join("\n");

    expect(
      runProvision(
        sandbox,
        ["local", "initialize"],
        initialCredentials,
      ).status,
    ).toBe(0);
    rmSync(sandbox.opensslTrace);

    const rotated = runProvision(
      sandbox,
      ["local", "rotate-providers"],
      rotatedCredentials,
    );

    expect(rotated.status).toBe(0);
    const bindings = readFileSync(
      join(sandbox.projectRoot, ".dev.vars"),
      "utf8",
    );
    expect(bindings).toContain(
      "BETTER_AUTH_SECRET=test-master-secret-that-is-long-enough",
    );
    expect(bindings).toContain("BETTER_AUTH_URL=http://localhost:4321");
    expect(bindings).toContain("GOOGLE_CLIENT_ID=new-google-client-id");
    expect(bindings).toContain(
      "GOOGLE_CLIENT_SECRET=new-google-client-secret",
    );
    expect(bindings).toContain("GITHUB_CLIENT_ID=new-github-client-id");
    expect(bindings).toContain(
      "GITHUB_CLIENT_SECRET=new-github-client-secret",
    );
    expect(existsSync(sandbox.opensslTrace)).toBe(false);
  });

  it("refuses to automate remote master-secret initialization", () => {
    const sandbox = createSandbox();

    const initialized = runProvision(
      sandbox,
      ["staging", "initialize"],
      "",
    );

    expect(initialized.status).toBe(1);
    expect(initialized.stderr).toContain(
      "Remote master-secret initialization is not automated",
    );
    expect(existsSync(sandbox.opensslTrace)).toBe(false);
  });

  it("refuses provider rotation when local master material is incomplete", () => {
    const sandbox = createSandbox();
    const destination = join(sandbox.projectRoot, ".dev.vars");
    const incomplete = [
      "BETTER_AUTH_SECRET=",
      "BETTER_AUTH_URL=http://localhost:4321",
      "GOOGLE_CLIENT_ID=old-google-client-id",
      "GOOGLE_CLIENT_SECRET=old-google-client-secret",
      "GITHUB_CLIENT_ID=old-github-client-id",
      "GITHUB_CLIENT_SECRET=old-github-client-secret",
      "",
    ].join("\n");
    writeFileSync(destination, incomplete, { mode: 0o600 });

    const rotated = runProvision(
      sandbox,
      ["local", "rotate-providers"],
      [
        "new-google-client-id",
        "new-google-client-secret",
        "new-github-client-id",
        "new-github-client-secret",
        "",
      ].join("\n"),
    );

    expect(rotated.status).toBe(1);
    expect(rotated.stderr).toContain(
      "nonempty BETTER_AUTH_SECRET and BETTER_AUTH_URL",
    );
    expect(readFileSync(destination, "utf8")).toBe(incomplete);
    expect(existsSync(sandbox.opensslTrace)).toBe(false);
  });

  it("validates the last effective local binding and rejects whitespace-only duplicates", () => {
    const sandbox = createSandbox();
    const destination = join(sandbox.projectRoot, ".dev.vars");
    const incomplete = [
      "BETTER_AUTH_SECRET=valid-master-before-duplicate",
      "BETTER_AUTH_SECRET=   ",
      "BETTER_AUTH_URL=http://localhost:4321",
      "GOOGLE_CLIENT_ID=old-google-client-id",
      "GOOGLE_CLIENT_SECRET=old-google-client-secret",
      "GITHUB_CLIENT_ID=old-github-client-id",
      "GITHUB_CLIENT_SECRET=old-github-client-secret",
      "",
    ].join("\n");
    writeFileSync(destination, incomplete, { mode: 0o600 });

    const rotated = runProvision(
      sandbox,
      ["local", "rotate-providers"],
      [
        "new-google-client-id",
        "new-google-client-secret",
        "new-github-client-id",
        "new-github-client-secret",
        "",
      ].join("\n"),
    );

    expect(rotated.status).toBe(1);
    expect(rotated.stderr).toContain(
      "nonempty BETTER_AUTH_SECRET and BETTER_AUTH_URL",
    );
    expect(readFileSync(destination, "utf8")).toBe(incomplete);
    expect(existsSync(sandbox.opensslTrace)).toBe(false);
  });

  it("omits master material from remote provider-only bulk updates", () => {
    const sandbox = createSandbox();
    const capture = join(sandbox.projectRoot, "remote-bulk-input");
    const fakePnpm = join(sandbox.binDirectory, "pnpm");
    mkdirSync(dirname(capture), { recursive: true });
    writeFileSync(
      fakePnpm,
      [
        "#!/bin/sh",
        'if [ "$4" = "list" ]; then',
        "  printf '%s\\n' '[{\"name\":\"BETTER_AUTH_SECRET\"},{\"name\":\"BETTER_AUTH_URL\"}]'",
        "  exit 0",
        "fi",
        'if [ "$4" = "bulk" ]; then',
        '  cat > "$PROVISION_TEST_CAPTURE"',
        "  exit 0",
        "fi",
        "exit 2",
        "",
      ].join("\n"),
      { mode: 0o700 },
    );

    const rotated = runProvision(
      sandbox,
      ["staging", "rotate-providers"],
      [
        "new-google-client-id",
        "new-google-client-secret",
        "new-github-client-id",
        "new-github-client-secret",
        "",
      ].join("\n"),
      { PROVISION_TEST_CAPTURE: capture },
    );

    expect(rotated.status).toBe(0);
    const payload = readFileSync(capture, "utf8");
    expect(payload).toContain("GOOGLE_CLIENT_ID=new-google-client-id");
    expect(payload).toContain(
      "GOOGLE_CLIENT_SECRET=new-google-client-secret",
    );
    expect(payload).toContain("GITHUB_CLIENT_ID=new-github-client-id");
    expect(payload).toContain(
      "GITHUB_CLIENT_SECRET=new-github-client-secret",
    );
    expect(payload).not.toContain("BETTER_AUTH_SECRET");
    expect(payload).not.toContain("BETTER_AUTH_URL");
    expect(existsSync(sandbox.opensslTrace)).toBe(false);
  });
});
