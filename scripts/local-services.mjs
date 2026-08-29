import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

export const composeFile = "infra/containers/compose.yaml";
export const localServiceCommands = ["up", "down", "reset", "status", "help"];

export function parseLocalServicesArgs(args) {
  const [command = "status", ...flags] = args;
  const unknownFlags = flags.filter((flag) => flag !== "--confirm");
  if (!localServiceCommands.includes(command)) {
    throw new Error(`Unknown local service command: ${command}`);
  }
  if (unknownFlags.length > 0) {
    throw new Error(`Unknown local service option: ${unknownFlags[0]}`);
  }
  const confirmed = flags.includes("--confirm");
  if (command === "reset" && !confirmed) {
    throw new Error("Reset removes local Docker volumes. Re-run with: pnpm services:reset -- --confirm");
  }
  return { command, confirmed };
}

export function composeArguments(command) {
  const base = ["compose", "-f", composeFile];
  if (command === "up") return [...base, "up", "--detach", "--wait"];
  if (command === "down") return [...base, "down", "--remove-orphans"];
  if (command === "reset") return [...base, "down", "--volumes", "--remove-orphans"];
  return [...base, "ps"];
}

export function runDockerCompose(command) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", composeArguments(command), {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`docker compose was terminated by ${signal}.`));
        return;
      }
      resolve(code ?? 1);
    });
  });
}

function printUsage() {
  console.log(`Usage:
  pnpm services:up
  pnpm services:down
  pnpm services:status
  pnpm services:reset -- --confirm

Commands start or stop the local PostgreSQL and S3-compatible object-storage
containers. Migrations and Bridge role grants remain explicit operator steps.`);
}

const isEntrypoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntrypoint) {
  try {
    const { command } = parseLocalServicesArgs(process.argv.slice(2));
    if (command === "help") {
      printUsage();
      process.exit(0);
    }
    const exitCode = await runDockerCompose(command);
    process.exitCode = exitCode;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    printUsage();
    process.exitCode = 2;
  }
}
