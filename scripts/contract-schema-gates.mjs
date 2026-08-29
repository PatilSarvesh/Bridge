import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { extractMcpTools, extractRestRouteBlocks, extractRestRoutes } from "./repository-gates.mjs";

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const schemaBaselinePath = path.join(repositoryRoot, "config/contract-schema-baseline.json");
export const transportBaselinePath = path.join(repositoryRoot, "config/transport-contract-baseline.json");

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortJson(item)]),
    );
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(sortJson(value));
}

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

async function loadContracts() {
  const contracts = await import(pathToFileURL(path.join(repositoryRoot, "packages/contracts/dist/index.js")));
  const zod = await import(pathToFileURL(path.join(repositoryRoot, "packages/contracts/node_modules/zod/index.js")));
  return { contracts, z: zod.z };
}

export async function buildSchemaSnapshot() {
  const source = await readFile(path.join(repositoryRoot, "packages/contracts/src/index.ts"), "utf8");
  const { contracts, z } = await loadContracts();
  const schemaNames = Object.keys(contracts)
    .filter((name) => name.endsWith("Schema"))
    .sort();
  const schemas = Object.fromEntries(
    schemaNames.map((name) => [name, z.toJSONSchema(contracts[name], { target: "draft-2020-12" })]),
  );
  return {
    schemaVersion: 1,
    sourceSha256: sha256(source),
    schemaCount: schemaNames.length,
    schemas,
  };
}

function responseContract(name, source) {
  if (["GET /health", "GET /health/live", "GET /health/ready"].includes(name)) return "health";
  if (name === "GET /metrics") return "metrics";
  if (["GET /v1/auth/login", "GET /v1/auth/callback", "GET /v1/auth/logout"].includes(name)) return "redirect";
  if (source.includes(".send(result.body)")) return "download";
  if (/return\s*\{\s*items\b/.test(source)) return "collection";
  return "record";
}

export async function buildTransportSnapshot() {
  const apiSource = await readFile(path.join(repositoryRoot, "apps/api/src/app.ts"), "utf8");
  const mcpSource = await readFile(path.join(repositoryRoot, "apps/mcp/src/bridge-server.ts"), "utf8");
  const restBlocks = extractRestRouteBlocks(apiSource);
  const restContracts = Object.fromEntries(
    restBlocks.map(({ name, source }) => [
      name,
      {
        requestSchema: source.match(/([A-Za-z][A-Za-z0-9]+Schema)\.parse\(/)?.[1] ?? "none",
        responseContract: responseContract(name, source),
      },
    ]),
  );
  const mcpContracts = Object.fromEntries(
    extractMcpTools(mcpSource).map((name) => [
      name,
      { requestContract: "inputSchema", responseContract: "structured" },
    ]),
  );
  return {
    rest: extractRestRoutes(apiSource),
    mcp: extractMcpTools(mcpSource),
    restContracts,
    mcpContracts,
  };
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

export async function updateBaselines() {
  const schemaSnapshot = await buildSchemaSnapshot();
  const transportSnapshot = await buildTransportSnapshot();
  const transportBaseline = await readJson(transportBaselinePath);
  await writeFile(schemaBaselinePath, `${JSON.stringify(schemaSnapshot, null, 2)}\n`);
  await writeFile(
    transportBaselinePath,
    `${JSON.stringify({ ...transportBaseline, ...transportSnapshot, contractVersion: 1 }, null, 2)}\n`,
  );
}

export async function findContractSchemaViolations() {
  const schemaBaseline = await readJson(schemaBaselinePath);
  const transportBaseline = await readJson(transportBaselinePath);
  const currentSchema = await buildSchemaSnapshot();
  const currentTransport = await buildTransportSnapshot();
  const apiSource = await readFile(path.join(repositoryRoot, "apps/api/src/app.ts"), "utf8");
  const mcpSource = await readFile(path.join(repositoryRoot, "apps/mcp/src/bridge-server.ts"), "utf8");
  const violations = [];

  if (schemaBaseline.schemaVersion !== 1) violations.push("contract schema baseline has an unsupported version");
  if (schemaBaseline.sourceSha256 !== currentSchema.sourceSha256)
    violations.push("request schema source changed without a reviewed baseline update");
  if (schemaBaseline.schemaCount !== currentSchema.schemaCount)
    violations.push("request schema count changed without a reviewed baseline update");
  if (stableJson(schemaBaseline.schemas) !== stableJson(currentSchema.schemas)) {
    violations.push("generated request schemas differ from the reviewed baseline");
  }

  const currentRest = extractRestRoutes(apiSource);
  const currentMcp = extractMcpTools(mcpSource);
  if (stableJson(currentRest) !== stableJson([...(transportBaseline.rest ?? [])].sort()))
    violations.push("REST surface differs from reviewed baseline");
  if (stableJson(currentMcp) !== stableJson([...(transportBaseline.mcp ?? [])].sort()))
    violations.push("MCP tool surface differs from reviewed baseline");
  if (stableJson(currentTransport.restContracts) !== stableJson(transportBaseline.restContracts)) {
    violations.push("REST request/response contracts differ from the reviewed baseline");
  }
  if (stableJson(currentTransport.mcpContracts) !== stableJson(transportBaseline.mcpContracts)) {
    violations.push("MCP request/response contracts differ from the reviewed baseline");
  }

  const schemaNames = new Set(Object.keys(currentSchema.schemas));
  for (const [route, contract] of Object.entries(currentTransport.restContracts)) {
    if (contract.requestSchema !== "none" && !schemaNames.has(contract.requestSchema)) {
      violations.push(`${route}: request schema ${contract.requestSchema} is not exported by @bridge/contracts`);
    }
  }
  for (const tool of currentMcp) {
    const blockStart = mcpSource.indexOf(`server.registerTool(\n    "${tool}"`);
    const nextTool = mcpSource.indexOf("server.registerTool(", blockStart + 1);
    const block = mcpSource.slice(blockStart, nextTool === -1 ? mcpSource.length : nextTool);
    if (!/inputSchema:/.test(block)) violations.push(`${tool}: MCP tool has no inputSchema`);
  }
  return violations.sort();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--update")) {
    await updateBaselines();
    console.log("Contract baselines updated.");
  } else {
    const violations = await findContractSchemaViolations();
    if (violations.length > 0) {
      console.error("Contract schema gate: failed");
      for (const violation of violations) console.error(`- ${violation}`);
      process.exitCode = 1;
    } else {
      console.log("Contract schema gate: passed");
    }
  }
}
