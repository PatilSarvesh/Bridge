import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const requiredTargets = ["BRIDGE_TEST_DATABASE_URL", "BRIDGE_RESTORE_DATABASE_URL"];
const localHosts = new Set(["127.0.0.1", "localhost", "::1"]);

function parseLocalDatabaseTarget(name, value) {
  if (typeof value !== "string" || value.length === 0) {
    return { error: `${name} is required and must point to a local PostgreSQL database.` };
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    return { error: `${name} must be a valid PostgreSQL connection string.` };
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    return { error: `${name} must use the PostgreSQL protocol.` };
  }
  if (!localHosts.has(url.hostname)) {
    return { error: `${name} must target a loopback host for local evidence.` };
  }
  if (!url.pathname || url.pathname === "/") {
    return { error: `${name} must include an explicit database name.` };
  }

  let database;
  try {
    database = decodeURIComponent(url.pathname.slice(1));
  } catch {
    return { error: `${name} must include a valid database name.` };
  }

  return {
    target: {
      database,
      host: url.hostname,
      port: url.port || "5432",
    },
    value,
  };
}

function targetKey(target) {
  return `${target.host}:${target.port}/${target.database}`;
}

export function validateLocalEvidenceEnvironment(environment = process.env) {
  const errors = [];
  const parsed = new Map();

  for (const name of requiredTargets) {
    const result = parseLocalDatabaseTarget(name, environment[name]);
    if (result.error) {
      errors.push(result.error);
    } else {
      parsed.set(name, result);
    }
  }

  const testTarget = parsed.get("BRIDGE_TEST_DATABASE_URL")?.target;
  const restoreTarget = parsed.get("BRIDGE_RESTORE_DATABASE_URL")?.target;
  if (testTarget && restoreTarget && targetKey(testTarget) === targetKey(restoreTarget)) {
    errors.push("BRIDGE_TEST_DATABASE_URL and BRIDGE_RESTORE_DATABASE_URL must target different databases.");
  }

  const configuredApplicationTarget = environment.DATABASE_URL;
  if (configuredApplicationTarget && restoreTarget) {
    const application = parseLocalDatabaseTarget("DATABASE_URL", configuredApplicationTarget);
    if (!application.error && targetKey(application.target) === targetKey(restoreTarget)) {
      errors.push("BRIDGE_RESTORE_DATABASE_URL must not target the configured application database.");
    }
  }

  return {
    errors,
    targets: {
      test: testTarget ?? null,
      restore: restoreTarget ?? null,
    },
    values: {
      test: parsed.get("BRIDGE_TEST_DATABASE_URL")?.value ?? null,
      restore: parsed.get("BRIDGE_RESTORE_DATABASE_URL")?.value ?? null,
    },
  };
}

function commandName() {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
}

function runCheck(id, title, args, environment, quiet = false) {
  const result = spawnSync(commandName(), args, {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: environment,
    encoding: "utf8",
    stdio: quiet ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  return {
    id,
    title,
    status: result.status === 0 ? "passed" : "failed",
    exitCode: result.status ?? 1,
  };
}

function finishReport(report, argv) {
  if (argv.includes("--json")) process.stdout.write(`${JSON.stringify(report)}\n`);
  else process.stdout.write(`${formatReport(report)}\n`);
  return report.checks.every((check) => check.status === "passed") ? 0 : 1;
}

function formatReport(report) {
  const lines = ["Bridge local pilot-readiness evidence", ""];
  for (const check of report.checks) {
    lines.push(`${check.status.padEnd(7)} ${check.title}`);
  }
  if (report.errors.length > 0) {
    lines.push("", `Errors: ${report.errors.join("; ")}`);
  }
  return lines.join("\n");
}

export function runLocalEvidence(argv = process.argv.slice(2), environment = process.env) {
  const validation = validateLocalEvidenceEnvironment(environment);
  const quiet = argv.includes("--json");
  const report = {
    schemaVersion: 1,
    errors: validation.errors,
    checks: [],
    targets: validation.targets,
  };

  if (validation.errors.length > 0) {
    if (argv.includes("--json")) process.stdout.write(`${JSON.stringify(report)}\n`);
    else process.stderr.write(`${formatReport(report)}\n`);
    return 2;
  }

  const testEnvironment = { ...environment, BRIDGE_TEST_DATABASE_URL: validation.values.test };
  delete testEnvironment.DATABASE_URL;
  report.checks.push(
    runCheck(
      "postgres-integration",
      "PostgreSQL integration and tenant-isolation tests",
      ["--filter", "@bridge/database", "test"],
      testEnvironment,
      quiet,
    ),
  );
  if (report.checks.at(-1).status !== "passed") return finishReport(report, argv);

  const restoreEnvironment = { ...environment, BRIDGE_RESTORE_DATABASE_URL: validation.values.restore };
  delete restoreEnvironment.DATABASE_URL;
  delete restoreEnvironment.BRIDGE_TEST_DATABASE_URL;
  report.checks.push(
    runCheck(
      "restore-verifier",
      "Read-only restore verifier against a separate local target",
      ["restore:verify"],
      restoreEnvironment,
      quiet,
    ),
  );
  if (report.checks.at(-1).status !== "passed") return finishReport(report, argv);

  report.checks.push(
    runCheck(
      "fresh-project-cli",
      "Packaged CLI fresh-project dry-run smoke test",
      ["distribution:check"],
      environment,
      quiet,
    ),
  );
  return finishReport(report, argv);
}

const isEntrypoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntrypoint) process.exitCode = runLocalEvidence();
