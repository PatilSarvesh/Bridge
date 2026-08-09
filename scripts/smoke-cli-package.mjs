import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliPackage = JSON.parse(await readFile(join(repositoryRoot, "apps/cli/package.json"), "utf8"));
const tarball = join(repositoryRoot, "dist", `bridge-cli-${cliPackage.version}.tgz`);
await access(tarball);

const temporaryRoot = await mkdtemp(join(tmpdir(), "bridge-cli-package-smoke-"));
const prefix = join(temporaryRoot, "prefix");
const repository = join(temporaryRoot, "fresh-repository");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const bridge = process.platform === "win32"
  ? join(prefix, "bridge.cmd")
  : join(prefix, "bin", "bridge");

function run(command, args, cwd = repository) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      CI: "true",
      NPM_CONFIG_CACHE: join(temporaryRoot, "npm-cache"),
    },
  });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")} failed.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return result.stdout;
}

try {
  await mkdir(repository, { recursive: true });
  run(npm, [
    "install",
    "--global",
    "--prefix",
    prefix,
    tarball,
    "--ignore-scripts",
    "--offline",
    "--no-audit",
    "--no-fund",
  ]);
  const help = run(bridge, ["--help"]);
  assert.match(help, /Bridge CLI/);
  assert.match(help, /bridge conformance/);

  const preview = run(bridge, [
    "init",
    "--name",
    "Distribution Smoke Project",
    "--client",
    "codex",
    "--api-url",
    "http://127.0.0.1:4000",
    "--dry-run",
  ]);
  assert.match(preview, /"dryRun": true/);
  assert.match(preview, /"registrationDisposition": "would_register"/);
  await assert.rejects(access(join(repository, ".bridge")));

  process.stdout.write(`${JSON.stringify({
    ok: true,
    package: cliPackage.name,
    version: cliPackage.version,
    executable: "bridge",
    checks: ["global-tarball-install", "symlinked-entrypoint", "dry-run-bootstrap"],
  }, null, 2)}\n`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
