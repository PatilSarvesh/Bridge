import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const textExtensions = new Set([
  ".cjs",
  ".css",
  ".editorconfig",
  ".env",
  ".html",
  ".js",
  ".json",
  ".mjs",
  ".md",
  ".sql",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);

const textFileNames = new Set([".editorconfig", ".env.example", ".gitignore", ".nvmrc"]);
const ignoredDirectories = new Set([".git", ".next", ".turbo", "coverage", "dist", "node_modules"]);

function isTextFile(filePath) {
  return textFileNames.has(path.basename(filePath)) || textExtensions.has(path.extname(filePath));
}

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        files.push(...(await collectFiles(path.join(directory, entry.name))));
      }
      continue;
    }

    const filePath = path.join(directory, entry.name);
    if (entry.isFile() && isTextFile(filePath)) files.push(filePath);
  }

  return files.sort();
}

export function formatViolations(filePath, contents) {
  if (contents.includes("\0")) return [];

  const violations = [];
  if (contents.includes("\r")) violations.push({ filePath, type: "crlf", line: 1 });
  if (contents.length > 0 && !contents.endsWith("\n")) {
    violations.push({ filePath, type: "missing-final-newline", line: contents.split("\n").length });
  }

  if (path.extname(filePath) !== ".md") {
    for (const [index, rawLine] of contents.split("\n").entries()) {
      const line = rawLine.replace(/\r$/, "");
      if (/[ \t]+$/.test(line)) {
        violations.push({ filePath, type: "trailing-whitespace", line: index + 1 });
      }
    }
  }

  return violations;
}

export async function findFormatViolations(root = repositoryRoot) {
  const files = await collectFiles(root);
  const violations = [];
  for (const filePath of files) {
    const relativePath = path.relative(root, filePath);
    if (relativePath.startsWith("packages/database/drizzle/")) continue;
    const contents = await readFile(filePath, "utf8");
    violations.push(...formatViolations(relativePath, contents));
  }
  return violations;
}

async function readJson(root, relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
}

function workspaceDependencies(manifest, workspaceNames) {
  const dependencySections = ["dependencies", "devDependencies", "peerDependencies"];
  return dependencySections
    .flatMap((section) => Object.keys(manifest[section] ?? {}))
    .filter((name) => workspaceNames.has(name));
}

async function discoverWorkspacePackages(root) {
  const packages = [];
  for (const directory of ["apps", "packages"]) {
    const entries = await readdir(path.join(root, directory), { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const relativePath = path.join(directory, entry.name);
      const manifest = await readJson(root, path.join(relativePath, "package.json"));
      packages.push({ manifest, path: relativePath });
    }
  }
  return packages.sort((left, right) => left.manifest.name.localeCompare(right.manifest.name));
}

export async function findArchitectureViolations(root = repositoryRoot) {
  const boundaryConfig = await readJson(root, "config/package-boundaries.json");
  const packages = await discoverWorkspacePackages(root);
  const packageNames = new Set(packages.map(({ manifest }) => manifest.name));
  const configuredNames = new Set(Object.keys(boundaryConfig.packages));
  const violations = [];

  for (const packageRecord of packages) {
    const { manifest, path: relativePath } = packageRecord;
    const contract = boundaryConfig.packages[manifest.name];
    if (!contract) {
      violations.push(`${manifest.name}: missing package-boundaries.json entry`);
      continue;
    }
    if (contract.path !== relativePath) {
      violations.push(`${manifest.name}: expected path ${contract.path}, found ${relativePath}`);
    }

    for (const script of boundaryConfig.requiredScripts) {
      if (typeof manifest.scripts?.[script] !== "string") {
        violations.push(`${manifest.name}: missing required script ${script}`);
      }
    }

    const allowed = new Set(contract.allowedWorkspaceDependencies);
    for (const dependency of workspaceDependencies(manifest, packageNames)) {
      if (!allowed.has(dependency)) {
        violations.push(`${manifest.name}: disallowed workspace dependency ${dependency}`);
      }
    }
  }

  for (const configuredName of configuredNames) {
    if (!packageNames.has(configuredName)) {
      violations.push(`${configuredName}: package-boundaries.json entry has no workspace package`);
    }
  }

  return violations.sort();
}

export function normalizeRoutePath(route) {
  return route.replace(/\$\{([^}]+)\}/g, ":$1");
}

export function extractRestRoutes(source) {
  const routePattern = /app\.(get|post|patch|put|delete)\b[\s\S]{0,800}?\(\s*(["'`])(\/[^"'`]+)\2/g;
  return [...source.matchAll(routePattern)]
    .map((match) => `${match[1].toUpperCase()} ${normalizeRoutePath(match[3])}`)
    .sort();
}

export function extractMcpTools(source) {
  const toolPattern = /server\.registerTool\(\s*["']([^"']+)["']/g;
  return [...source.matchAll(toolPattern)].map((match) => match[1]).sort();
}

export function extractRestRouteBlocks(source) {
  const routePattern = /app\.(get|post|patch|put|delete)\b[\s\S]{0,800}?\(\s*(["'`])(\/[^"'`]+)\2/g;
  const matches = [...source.matchAll(routePattern)];
  return matches.map((match, index) => {
    const start = match.index ?? 0;
    const end = matches[index + 1]?.index ?? source.length;
    return {
      name: `${match[1].toUpperCase()} ${normalizeRoutePath(match[3])}`,
      source: source.slice(start, end),
    };
  });
}

export async function findContractViolations(root = repositoryRoot) {
  const baseline = await readJson(root, "config/transport-contract-baseline.json");
  const apiSource = await readFile(path.join(root, "apps/api/src/app.ts"), "utf8");
  const mcpSource = await readFile(path.join(root, "apps/mcp/src/bridge-server.ts"), "utf8");
  const actualRest = extractRestRoutes(apiSource);
  const actualMcp = extractMcpTools(mcpSource);
  const expectedRest = [...baseline.rest].sort();
  const expectedMcp = [...baseline.mcp].sort();
  const violations = [];

  if (JSON.stringify(actualRest) !== JSON.stringify(expectedRest)) {
    violations.push(
      `REST surface differs from reviewed baseline (expected ${expectedRest.length}, found ${actualRest.length})`,
    );
  }
  if (JSON.stringify(actualMcp) !== JSON.stringify(expectedMcp)) {
    violations.push(
      `MCP tool surface differs from reviewed baseline (expected ${expectedMcp.length}, found ${actualMcp.length})`,
    );
  }

  const bodylessWrites = new Set(baseline.bodylessRestWrites);
  for (const block of extractRestRouteBlocks(apiSource)) {
    if (!/^(POST|PATCH|PUT|DELETE) \/v1\//.test(block.name)) continue;
    if (bodylessWrites.has(block.name)) continue;
    if (!/\.parse\(/.test(block.source)) {
      violations.push(`${block.name}: write route has no shared contract parse`);
    }
  }

  for (const tool of baseline.mcp) {
    const toolStart = mcpSource.indexOf(`server.registerTool(\n    "${tool}"`);
    if (toolStart === -1) continue;
    const nextTool = mcpSource.indexOf("server.registerTool(", toolStart + 1);
    const block = mcpSource.slice(toolStart, nextTool === -1 ? mcpSource.length : nextTool);
    if (!/inputSchema:/.test(block)) violations.push(`${tool}: MCP tool has no input schema`);
  }

  return violations.sort();
}

const secretPatterns = [
  { name: "aws-access-key", pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { name: "github-token", pattern: /\bgh[pors]_[A-Za-z0-9]{30,}\b/g },
  { name: "stripe-key", pattern: /\bsk_(?:live|test)_[A-Za-z0-9]{20,}\b/g },
  {
    name: "private-key",
    pattern: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----\s*\n[A-Za-z0-9+/=\r\n]{40,}/g,
  },
  {
    name: "slack-webhook",
    pattern: /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]{6,}\/B[A-Z0-9]{6,}\/[A-Za-z0-9]{20,}/g,
  },
];

export function findSecrets(filePath, contents) {
  if (contents.includes("\0")) return [];
  const findings = [];
  for (const { name, pattern } of secretPatterns) {
    pattern.lastIndex = 0;
    for (const match of contents.matchAll(pattern)) {
      const before = contents.slice(0, match.index ?? 0);
      findings.push({ filePath, type: name, line: before.split("\n").length });
    }
  }
  return findings;
}

export async function findSecretViolations(root = repositoryRoot) {
  const files = await collectFiles(root);
  const findings = [];
  for (const filePath of files) {
    const contents = await readFile(filePath, "utf8");
    findings.push(...findSecrets(path.relative(root, filePath), contents));
  }
  return findings.sort((left, right) =>
    `${left.filePath}:${left.line}`.localeCompare(`${right.filePath}:${right.line}`),
  );
}

function reportViolations(title, violations) {
  if (violations.length === 0) {
    console.log(`${title}: passed`);
    return;
  }

  console.error(`${title}: failed`);
  for (const violation of violations) {
    if (typeof violation === "string") {
      console.error(`- ${violation}`);
    } else {
      console.error(`- ${violation.filePath}:${violation.line} ${violation.type}`);
    }
  }
  process.exitCode = 1;
}

async function main() {
  const command = process.argv[2];
  if (!command || !["format", "architecture", "contracts", "secrets"].includes(command)) {
    console.error("Usage: node scripts/repository-gates.mjs <format|architecture|contracts|secrets>");
    process.exitCode = 2;
    return;
  }

  const [title, violations] = {
    format: ["Format gate", await findFormatViolations()],
    architecture: ["Architecture gate", await findArchitectureViolations()],
    contracts: ["Transport contract gate", await findContractViolations()],
    secrets: ["Secret scan", await findSecretViolations()],
  }[command];
  reportViolations(title, violations);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
