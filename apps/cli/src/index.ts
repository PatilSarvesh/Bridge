#!/usr/bin/env node

import { createHash } from "node:crypto";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const cliExitCodes = {
  success: 0,
  usage: 2,
  configuration: 3,
  connection: 4,
  pending: 10,
  forbidden: 11,
  notFound: 12,
  conflict: 13,
  internal: 20,
} as const;

type FetchFunction = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface CliRuntime {
  readonly cwd: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly fetch: FetchFunction;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  readonly readStdin: () => Promise<string>;
  readonly sleep: (milliseconds: number) => Promise<void>;
  readonly now: () => Date;
}

interface ProjectConfig {
  readonly version: 1;
  readonly projectId: string;
  readonly apiUrl: string;
  readonly repository: string;
  readonly client: AgentClient;
  readonly mcpUrl?: string;
}

type AgentClient = "codex" | "claude_code" | "cursor" | "copilot";

interface ConnectionOptions {
  readonly apiUrl: string;
  readonly principalId: string;
}

class CliError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly exitCode: number,
    public readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "CliError";
  }
}

function defaultRuntime(): CliRuntime {
  return {
    cwd: process.cwd(),
    environment: process.env,
    fetch: (input, init) => fetch(input, init),
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    readStdin: async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      }
      return Buffer.concat(chunks).toString("utf8");
    },
    sleep: (milliseconds) => new Promise((complete) => setTimeout(complete, milliseconds)),
    now: () => new Date(),
  };
}

function optionValue(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function firstPositional(args: readonly string[], start = 1): string | undefined {
  const candidate = args[start];
  return candidate && !candidate.startsWith("--") ? candidate : undefined;
}

function usage(): string {
  return `Bridge CLI — works with or without MCP

Usage:
  bridge init [project-id] [--name <project-name>] [--client <client>] [--api-url <url>] [--mcp-url <url>] [--repository <name>] [--force] [--dry-run]
  bridge install [--client <client>] [--dry-run]
  bridge doctor
  bridge run start [project-id] --task <description> [--client <name>] [--capability <level>] [--continues <run-id> --resume-key <key>]
  bridge run get <run-id>
  bridge run report <run-id> --status <status> --version <number> [--summary <text>]
  bridge run continue <run-id> --resume-key <key>
  bridge run list [project-id]
  bridge context [project-id] --task <description> [--run-id <id>] [--component <name>] [--category <name>]
  bridge ask [project-id] --file <question.json|->
  bridge question matches [project-id] --file <question.json|->
  bridge question get <question-id>
  bridge wait <question-id> [--timeout <seconds>] [--interval <seconds>]
  bridge inbox [project-id] [--status <state>] [--risk <risk>] [--category <category>] [--role <role>]
  bridge pending [project-id]
  bridge assumption add [project-id] --file <assumption.json|->
  bridge assumption get <assumption-id>
  bridge assumption list [project-id]
  bridge assumption resolve <assumption-id> --status <status> --version <number> --rationale <text>
  bridge sync [project-id] [--task <description>] [--run-id <id>]
  bridge spec publish [project-id] --file <spec.md> --title <title> --type <prd|adr|api_contract|test_plan> [--run-id <id>]
  bridge spec get <artifact-id>
  bridge spec pull [project-id] [--out <directory>]

Configuration:
  bridge init --name <name> registers a project and activates repository instructions for the selected client.
  bridge install activates or switches a client adapter for an existing .bridge/project.yaml without registering a project.
  A project ID can then be omitted from repository-scoped commands.

Development environment:
  BRIDGE_API_URL        Overrides the configured API URL
  BRIDGE_MCP_URL        Overrides the optional configured MCP endpoint
  BRIDGE_PRINCIPAL_ID   Local development identity (default: agt_codex)

Exit codes:
  0 success, 2 invalid input, 3 configuration, 4 connection/server,
  10 answer still pending, 11 forbidden, 12 not found, 13 conflict, 20 internal.`;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function yamlValue(value: string): string {
  return JSON.stringify(value);
}

function serializeProjectConfig(config: ProjectConfig): string {
  return `# Generated by Bridge CLI. Safe to commit; do not place secrets here.
version: 1
project_id: ${yamlValue(config.projectId)}
api_url: ${yamlValue(config.apiUrl)}
repository: ${yamlValue(config.repository)}
client: ${yamlValue(config.client)}
${config.mcpUrl ? `mcp_url: ${yamlValue(config.mcpUrl)}\n` : ""}
`;
}

function parseYamlScalar(value: string): string {
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "string" ? parsed : String(parsed);
  } catch {
    return value;
  }
}

async function loadProjectConfig(cwd: string): Promise<ProjectConfig | undefined> {
  const path = resolve(cwd, ".bridge", "project.yaml");
  if (!(await exists(path))) return undefined;
  const fields = new Map<string, string>();
  for (const line of (await readFile(path, "utf8")).split(/\r?\n/)) {
    const match = /^([a-z_]+):\s*(.+)$/.exec(line.trim());
    if (match?.[1] && match[2]) fields.set(match[1], parseYamlScalar(match[2].trim()));
  }
  const projectId = fields.get("project_id");
  const apiUrl = fields.get("api_url");
  const repository = fields.get("repository");
  const client = fields.get("client") ?? "codex";
  const mcpUrl = fields.get("mcp_url");
  if (!projectId || !apiUrl || !repository) {
    throw new CliError(
      "INVALID_CONFIG",
      ".bridge/project.yaml is missing project_id, api_url, or repository.",
      cliExitCodes.configuration,
    );
  }
  if (!["codex", "claude_code", "cursor", "copilot"].includes(client)) {
    throw new CliError(
      "INVALID_CONFIG",
      ".bridge/project.yaml contains an unsupported client.",
      cliExitCodes.configuration,
    );
  }
  return {
    version: 1,
    projectId,
    apiUrl,
    repository,
    client: client as AgentClient,
    ...(mcpUrl ? { mcpUrl } : {}),
  };
}

function optionalHttpUrl(value: string | undefined, optionName: string): string | undefined {
  if (!value) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new CliError("INVALID_URL", `${optionName} must be an absolute http(s) URL.`, cliExitCodes.usage);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new CliError("INVALID_URL", `${optionName} must use http or https.`, cliExitCodes.usage);
  }
  return value.replace(/\/$/, "");
}

function parseAgentClient(value: string | undefined, optionName = "--client"): AgentClient {
  const candidate = value ?? "codex";
  if (!["codex", "claude_code", "cursor", "copilot"].includes(candidate)) {
    throw new CliError(
      "INVALID_CLIENT",
      `${optionName} must be codex, claude_code, cursor, or copilot.`,
      cliExitCodes.usage,
    );
  }
  return candidate as AgentClient;
}

function connectionOptions(
  args: readonly string[],
  runtime: CliRuntime,
  config?: ProjectConfig,
): ConnectionOptions {
  return {
    apiUrl: (
      optionValue(args, "--api-url") ??
      runtime.environment.BRIDGE_API_URL ??
      config?.apiUrl ??
      "http://127.0.0.1:4000"
    ).replace(/\/$/, ""),
    principalId: runtime.environment.BRIDGE_PRINCIPAL_ID ?? "agt_codex",
  };
}

function requireProjectId(explicit: string | undefined, config?: ProjectConfig): string {
  const projectId = explicit ?? config?.projectId;
  if (!projectId) {
    throw new CliError(
      "PROJECT_NOT_CONFIGURED",
      "Provide a project ID or run `bridge init <project-id>` in this repository.",
      cliExitCodes.configuration,
    );
  }
  return projectId;
}

function apiExitCode(status: number): number {
  if (status === 401 || status === 403) return cliExitCodes.forbidden;
  if (status === 404) return cliExitCodes.notFound;
  if (status === 409) return cliExitCodes.conflict;
  if (status === 400 || status === 422) return cliExitCodes.usage;
  return cliExitCodes.connection;
}

async function bridgeFetch(
  path: string,
  options: ConnectionOptions,
  runtime: CliRuntime,
  init: RequestInit = {},
): Promise<unknown> {
  let response: Response;
  try {
    response = await runtime.fetch(`${options.apiUrl}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        "x-bridge-principal-id": options.principalId,
        ...init.headers,
      },
    });
  } catch (error) {
    throw new CliError(
      "CONNECTION_FAILED",
      `Could not reach Bridge at ${options.apiUrl}.`,
      cliExitCodes.connection,
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }

  const text = await response.text();
  let body: unknown = undefined;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!response.ok) {
    const code =
      typeof body === "object" && body !== null && "code" in body ? String(body.code) : "API_ERROR";
    const message =
      typeof body === "object" && body !== null && "message" in body
        ? String(body.message)
        : `Bridge API returned ${response.status}.`;
    throw new CliError(code, message, apiExitCode(response.status), { status: response.status });
  }
  return body;
}

function output(runtime: CliRuntime, value: unknown): void {
  runtime.stdout(`${JSON.stringify(value, null, 2)}\n`);
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null ? value as Readonly<Record<string, unknown>> : undefined;
}

function itemsFrom(value: unknown): readonly unknown[] {
  const record = asRecord(value);
  return record && Array.isArray(record.items) ? record.items : [];
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "specification";
}

function currentArtifactVersion(artifact: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> | undefined {
  const versions = Array.isArray(artifact.versions) ? artifact.versions.map(asRecord) : [];
  return versions.find((version) => version?.id === artifact.currentVersionId);
}

function approvedArtifactVersion(artifact: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> | undefined {
  const versions = Array.isArray(artifact.versions) ? artifact.versions.map(asRecord) : [];
  return versions.find(
    (version) => Boolean(version && version.id === artifact.approvedVersionId && version.status === "approved"),
  );
}

function renderContextMarkdown(projectId: string, task: string, context: unknown): string {
  const record = asRecord(context);
  const items = itemsFrom(context);
  const sections = items.map((item) => {
    const entry = asRecord(item);
    if (!entry) return "";
    const id = String(entry.id ?? "unknown");
    const title = String(entry.title ?? "Untitled context");
    const summary = String(entry.summary ?? "");
    const authority = String(entry.authority ?? "unknown");
    const sourceUrl = String(entry.sourceUrl ?? "");
    return `## ${title}\n\n- Bridge ID: \`${id}\`\n- Authority: ${authority}\n- Source: ${sourceUrl}\n\n${summary}`;
  }).filter(Boolean);
  return `# Bridge project context

> Generated file. Refresh with \`bridge sync\`. Authority labels distinguish approved decisions from temporary or confirmed assumptions; local edits never create approval.

- Project: \`${projectId}\`
- Task: ${task}
- Context snapshot: \`${String(record?.contextSnapshotId ?? "unknown")}\`

${sections.length > 0 ? sections.join("\n\n") : "No approved context matched this task."}
`;
}

async function writeAtomic(path: string, content: string): Promise<void> {
  const temporaryPath = `${path}.tmp-${process.pid}`;
  await writeFile(temporaryPath, content, "utf8");
  await rename(temporaryPath, path);
}

function generatedInstructions(): string {
  return `# Bridge agent instructions

This repository uses Bridge even when MCP is unavailable.

Command invocation: use \`bridge\` when the CLI is installed globally. When it is installed as this repository's pnpm development dependency, replace \`bridge\` in every command below with \`pnpm exec bridge\`.

1. Start consequential work with \`bridge run start --task "<current task>"\`; keep the returned run ID and continuation locator outside committed repository files.
2. Retrieve approved context with \`bridge context --task "<current task>" --run-id <run-id>\`.
3. Search the returned approved decisions and run \`bridge question matches --file <question.json>\` before asking the team again.
4. Record only low-risk reversible uncertainty with \`bridge assumption add --file <path>\`; include the run ID, reversal cost, confidence, and expiry.
5. For every meaningful product, BA, architecture, QA, data, privacy, security, or operational ambiguity requiring shared human authority, create a structured question with the run ID and run \`bridge ask --file <path>\`. Do not use a private/native clarification prompt for those questions.
6. A greenfield system request must publish its generated PRD, ADR, API contract, and test plan with \`bridge spec publish --run-id <run-id>\`. Publish later material revisions as new immutable versions.
7. Never present an assumption, agent recommendation, or generated specification as human approval.
8. Do not continue protected or blocking work until \`bridge wait <question-id>\` returns an accepted answer.
9. Resolve the durable handoff with \`bridge run continue <run-id> --resume-key <key>\`; start a later run using \`--continues\` and \`--resume-key\`.
10. Cite Bridge decision and assumption IDs in implementation summaries and specifications.
11. Before claiming completion, verify required specifications were published and report the run using \`bridge run report <run-id> --status completed --version <version> --summary "<outcome>"\`.
12. Run \`bridge sync --task "<current task>" --run-id <run-id>\` when the agent cannot make outbound calls; read \`.bridge/context.md\` afterward.
13. Use \`bridge spec pull\` to materialize only human-approved specification versions.

Generated snapshots are evidence of server-approved context. Local edits do not create or change Bridge decisions.
`;
}

const bridgeInstructionsStart = "<!-- bridge:instructions:start -->";
const bridgeInstructionsEnd = "<!-- bridge:instructions:end -->";

function clientInstructionPath(cwd: string, client: AgentClient): string {
  if (client === "codex") return resolve(cwd, "AGENTS.md");
  if (client === "claude_code") return resolve(cwd, "CLAUDE.md");
  if (client === "cursor") return resolve(cwd, ".cursor", "rules", "bridge.mdc");
  return resolve(cwd, ".github", "copilot-instructions.md");
}

function bridgeInstructionBlock(): string {
  return `${bridgeInstructionsStart}
## Bridge workflow

Read and follow \`.bridge/agent-instructions.md\` before starting meaningful work in this repository.

The \`bridge\` CLI is the required adapter for shared questions, assumptions, specifications, decisions, and run continuation. MCP is optional. Do not bypass Bridge with private clarification prompts when a question requires shared human authority.
${bridgeInstructionsEnd}`;
}

async function mergeClientInstructions(path: string): Promise<"created" | "updated" | "unchanged"> {
  const block = bridgeInstructionBlock();
  if (!(await exists(path))) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${block}\n`, "utf8");
    return "created";
  }
  const current = await readFile(path, "utf8");
  const next = mergeClientInstructionContent(current, block);
  if (next === current) return "unchanged";
  await writeAtomic(path, next);
  return "updated";
}

function mergeClientInstructionContent(current: string, block: string): string {
  if (!current) return `${block}\n`;
  const start = current.indexOf(bridgeInstructionsStart);
  const end = current.indexOf(bridgeInstructionsEnd);
  return start >= 0 && end >= start
    ? `${current.slice(0, start)}${block}${current.slice(end + bridgeInstructionsEnd.length)}`
    : `${current.trimEnd()}\n\n${block}\n`;
}

function exampleQuestion(): string {
  return `${JSON.stringify({
    idempotencyKey: "replace-with-stable-task-key",
    runId: "replace-with-agent-run-id",
    title: "Which implementation option should be used?",
    type: "decision",
    category: "architecture",
    context: "Describe the current implementation, constraint, and the ambiguity that remains.",
    whyItMatters: "Explain the concrete delivery, product, operational, or security consequence.",
    intendedOwnerIds: [],
    intendedOwnerRoles: [],
    risk: "medium",
    reversible: true,
    blocking: true,
    options: [
      { key: "option-a", label: "Option A", tradeoffs: "Describe benefits and costs." },
      { key: "option-b", label: "Option B", tradeoffs: "Describe benefits and costs." },
    ],
    recommendationKey: "option-a",
    fallback: "Pause the affected work until a decision is accepted.",
    scope: { repository: "replace-with-repository", component: "replace-with-component" },
  }, null, 2)}\n`;
}

function exampleAssumption(): string {
  return `${JSON.stringify({
    idempotencyKey: "replace-with-stable-assumption-key",
    runId: "replace-with-agent-run-id",
    statement: "Internal retry metrics may use the existing transfer namespace.",
    rationale: "The namespace is internal, reversible, and already used by adjacent transfer metrics.",
    category: "observability",
    risk: "low",
    confidence: "medium",
    reversible: true,
    reversalCost: "Rename the metric and update the internal dashboard query.",
    scope: { repository: "replace-with-repository", component: "replace-with-component" },
    sourceLinks: [],
  }, null, 2)}\n`;
}

async function initializeRepository(args: readonly string[], runtime: CliRuntime): Promise<void> {
  let projectId = optionValue(args, "--project") ?? firstPositional(args);
  const projectName = optionValue(args, "--name");
  const requestedRepository = optionValue(args, "--repository");
  const requestedClient = optionValue(args, "--client");
  const bridgeDirectory = resolve(runtime.cwd, ".bridge");
  const paths = {
    project: resolve(bridgeDirectory, "project.yaml"),
    instructions: resolve(bridgeDirectory, "agent-instructions.md"),
    example: resolve(bridgeDirectory, "question.example.json"),
    assumptionExample: resolve(bridgeDirectory, "assumption.example.json"),
  };
  const force = args.includes("--force");
  const dryRun = args.includes("--dry-run");
  const existingConfig = (force || dryRun) && await exists(paths.project)
    ? await loadProjectConfig(runtime.cwd)
    : undefined;
  if (!projectId && existingConfig && (dryRun || !projectName)) {
    projectId = existingConfig.projectId;
  }
  if (!projectId && !projectName) {
    throw new CliError(
      "PROJECT_REQUIRED",
      "bridge init requires an existing project ID, --name, or an existing .bridge/project.yaml with --force/--dry-run.",
      cliExitCodes.usage,
    );
  }
  const repository = requestedRepository ?? existingConfig?.repository ?? basename(runtime.cwd);
  const client = parseAgentClient(requestedClient ?? existingConfig?.client);
  const requestedMcpUrl = optionValue(args, "--mcp-url");
  const mcpUrl = optionalHttpUrl(
    requestedMcpUrl ?? existingConfig?.mcpUrl,
    requestedMcpUrl ? "--mcp-url" : ".bridge/project.yaml mcp_url",
  );
  if (!force && !dryRun) {
    const existing = (await Promise.all(Object.values(paths).map(async (path) => ({ path, exists: await exists(path) }))))
      .filter((entry) => entry.exists)
      .map((entry) => entry.path);
    if (existing.length > 0) {
      throw new CliError(
        "CONFIG_EXISTS",
        "Bridge configuration already exists. Use --force to regenerate only Bridge-owned files.",
        cliExitCodes.conflict,
        { paths: existing },
      );
    }
  }
  const apiUrl = (
    optionValue(args, "--api-url") ??
    runtime.environment.BRIDGE_API_URL ??
    existingConfig?.apiUrl ??
    "http://127.0.0.1:4000"
  ).replace(/\/$/, "");
  let registrationDisposition: string | undefined;
  if (!projectId && projectName && !dryRun) {
    const registration = await bridgeFetch(
      "/v1/projects",
      {
        apiUrl,
        principalId:
          optionValue(args, "--principal-id") ??
          runtime.environment.BRIDGE_INIT_PRINCIPAL_ID ??
          "usr_architect",
      },
      runtime,
      {
        method: "POST",
        body: JSON.stringify({
          idempotencyKey:
            optionValue(args, "--idempotency-key") ??
            `project-${createHash("sha256")
              .update(`${repository}:${projectName}`)
              .digest("hex")
              .slice(0, 32)}`,
          name: projectName,
          decisionOwnerIds: [],
        }),
      },
    );
    const registrationRecord = asRecord(registration);
    const projectRecord = asRecord(registrationRecord?.project);
    if (!projectRecord?.id) {
      throw new CliError(
        "INVALID_PROJECT_RESPONSE",
        "Bridge did not return a project ID during initialization.",
        cliExitCodes.connection,
      );
    }
    projectId = String(projectRecord.id);
    registrationDisposition = String(registrationRecord?.disposition ?? "created");
  }
  if (!projectId && !projectName) {
    throw new CliError("PROJECT_REQUIRED", "Bridge project registration failed.", cliExitCodes.configuration);
  }
  if (dryRun) {
    const plannedProjectId = projectId ?? "<registered-project-id>";
    const config: ProjectConfig = {
      version: 1,
      projectId: plannedProjectId,
      apiUrl,
      repository,
      client,
      ...(mcpUrl ? { mcpUrl } : {}),
    };
    const adapterPath = clientInstructionPath(runtime.cwd, client);
    const changes: Array<{
      readonly path: string;
      readonly action: "create" | "update" | "unchanged";
    }> = [];
    const relativePath = (path: string) => path.slice(runtime.cwd.length + 1);
    const planFile = async (path: string, content: string): Promise<void> => {
      const current = await exists(path) ? await readFile(path, "utf8") : undefined;
      changes.push({
        path: relativePath(path),
        action: current === undefined ? "create" : current === content ? "unchanged" : "update",
      });
    };
    await planFile(paths.project, serializeProjectConfig(config));
    await planFile(paths.instructions, generatedInstructions());
    await planFile(paths.example, exampleQuestion());
    await planFile(paths.assumptionExample, exampleAssumption());
    const currentAdapter = await exists(adapterPath) ? await readFile(adapterPath, "utf8") : "";
    await planFile(adapterPath, mergeClientInstructionContent(currentAdapter, bridgeInstructionBlock()));
    output(runtime, {
      ok: true,
      dryRun: true,
      projectId: projectId ?? null,
      projectName: projectName ?? null,
      repository,
      client,
      mcpUrl: mcpUrl ?? null,
      registrationDisposition: projectId ? "existing_project" : "would_register",
      changes,
      note: "Dry run completed; no API state or repository files were changed.",
    });
    return;
  }
  if (!projectId) {
    throw new CliError("PROJECT_REQUIRED", "Bridge project registration failed.", cliExitCodes.configuration);
  }
  const config: ProjectConfig = {
    version: 1,
    projectId,
    apiUrl,
    repository,
    client,
    ...(mcpUrl ? { mcpUrl } : {}),
  };
  await mkdir(bridgeDirectory, { recursive: true });
  await writeFile(paths.project, serializeProjectConfig(config), "utf8");
  await writeFile(paths.instructions, generatedInstructions(), "utf8");
  await writeFile(paths.example, exampleQuestion(), "utf8");
  await writeFile(paths.assumptionExample, exampleAssumption(), "utf8");
  const adapterPath = clientInstructionPath(runtime.cwd, client);
  const adapterDisposition = await mergeClientInstructions(adapterPath);
  output(runtime, {
    ok: true,
    projectId,
    projectName: projectName ?? null,
    repository: config.repository,
    client,
    mcpUrl: config.mcpUrl ?? null,
    registrationDisposition: registrationDisposition ?? "existing_project",
    adapterDisposition,
    files: [...Object.values(paths), adapterPath].map((path) => path.slice(runtime.cwd.length + 1)),
    next: `Open ${client} in this repository and give it a normal build request. The generated repository instructions activate Bridge automatically.`,
  });
}

async function installAdapter(args: readonly string[], runtime: CliRuntime): Promise<void> {
  const config = await loadProjectConfig(runtime.cwd);
  if (!config) {
    throw new CliError(
      "PROJECT_NOT_CONFIGURED",
      "bridge install requires .bridge/project.yaml. Run `bridge init` first.",
      cliExitCodes.configuration,
    );
  }
  const client = parseAgentClient(optionValue(args, "--client") ?? config.client, "--client");
  const nextConfig: ProjectConfig = { ...config, client };
  const bridgeDirectory = resolve(runtime.cwd, ".bridge");
  const paths = {
    project: resolve(bridgeDirectory, "project.yaml"),
    instructions: resolve(bridgeDirectory, "agent-instructions.md"),
    example: resolve(bridgeDirectory, "question.example.json"),
    assumptionExample: resolve(bridgeDirectory, "assumption.example.json"),
  };
  const adapterPath = clientInstructionPath(runtime.cwd, client);
  const dryRun = args.includes("--dry-run");
  const changes: Array<{
    readonly path: string;
    readonly action: "create" | "update" | "unchanged";
  }> = [];
  const relativePath = (path: string) => path.slice(runtime.cwd.length + 1);
  const planFile = async (path: string, content: string): Promise<void> => {
    const current = await exists(path) ? await readFile(path, "utf8") : undefined;
    changes.push({
      path: relativePath(path),
      action: current === undefined ? "create" : current === content ? "unchanged" : "update",
    });
  };
  await planFile(paths.project, serializeProjectConfig(nextConfig));
  await planFile(paths.instructions, generatedInstructions());
  await planFile(paths.example, exampleQuestion());
  await planFile(paths.assumptionExample, exampleAssumption());
  const currentAdapter = await exists(adapterPath) ? await readFile(adapterPath, "utf8") : "";
  await planFile(adapterPath, mergeClientInstructionContent(currentAdapter, bridgeInstructionBlock()));

  if (dryRun) {
    output(runtime, {
      ok: true,
      dryRun: true,
      projectId: config.projectId,
      previousClient: config.client,
      client,
      changes,
      note: "Adapter dry run completed; no API state or repository files were changed.",
    });
    return;
  }

  await mkdir(bridgeDirectory, { recursive: true });
  await writeFile(paths.project, serializeProjectConfig(nextConfig), "utf8");
  await writeFile(paths.instructions, generatedInstructions(), "utf8");
  await writeFile(paths.example, exampleQuestion(), "utf8");
  await writeFile(paths.assumptionExample, exampleAssumption(), "utf8");
  const adapterDisposition = await mergeClientInstructions(adapterPath);
  output(runtime, {
    ok: true,
    projectId: config.projectId,
    previousClient: config.client,
    client,
    adapterDisposition,
    files: [...Object.values(paths), adapterPath].map((path) => relativePath(path)),
    note: "Adapter installed without project registration. Existing unrelated instruction content was preserved.",
  });
}

interface DoctorCheck {
  readonly name: string;
  readonly status: "pass" | "fail";
  readonly detail: string;
  readonly path?: string;
}

interface McpProbeResult {
  readonly status: "ready" | "failed";
  readonly detail: string;
}

function isMcpInitializeResult(value: unknown): boolean {
  const envelope = asRecord(value);
  const result = asRecord(envelope?.result);
  const serverInfo = asRecord(result?.serverInfo);
  return envelope?.jsonrpc === "2.0" &&
    typeof result?.protocolVersion === "string" &&
    typeof serverInfo?.name === "string";
}

function containsMcpInitializeResult(responseText: string): boolean {
  const candidates = [
    responseText,
    ...responseText
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trim()),
  ];
  return candidates.some((candidate) => {
    if (!candidate) return false;
    try {
      return isMcpInitializeResult(JSON.parse(candidate));
    } catch {
      return false;
    }
  });
}

async function probeMcpEndpoint(url: string, runtime: CliRuntime): Promise<McpProbeResult> {
  try {
    const response = await runtime.fetch(url, {
      method: "POST",
      signal: AbortSignal.timeout(5_000),
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "MCP-Protocol-Version": "2025-06-18",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "bridge-doctor",
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "bridge-doctor", version: "0.1.0" },
        },
      }),
    });
    const responseText = await response.text();
    if (!response.ok || !containsMcpInitializeResult(responseText)) {
      return {
        status: "failed",
        detail: `MCP initialize probe returned HTTP ${response.status} without a valid initialize result.`,
      };
    }
    return {
      status: "ready",
      detail: `MCP endpoint completed protocol initialization at ${url}.`,
    };
  } catch (error) {
    const timedOut = error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name);
    return {
      status: "failed",
      detail: timedOut
        ? "MCP initialize probe timed out after 5 seconds."
        : error instanceof Error
          ? error.message
          : "MCP initialize probe failed.",
    };
  }
}

async function runDoctor(
  config: ProjectConfig | undefined,
  connection: ConnectionOptions,
  runtime: CliRuntime,
): Promise<void> {
  const checks: DoctorCheck[] = [];
  let health: unknown = null;
  try {
    health = await bridgeFetch("/health", connection, runtime);
    checks.push({ name: "api", status: "pass", detail: `Bridge API reachable at ${connection.apiUrl}.` });
  } catch (error) {
    checks.push({
      name: "api",
      status: "fail",
      detail: error instanceof CliError ? error.message : "Bridge API health check failed.",
    });
    output(runtime, { ok: false, configured: Boolean(config), apiUrl: connection.apiUrl, health, checks });
    throw error;
  }

  if (!config) {
    checks.push({
      name: "project-config",
      status: "fail",
      detail: "No .bridge/project.yaml was found; run `bridge init` first.",
    });
    output(runtime, { ok: false, configured: false, apiUrl: connection.apiUrl, health, checks });
    throw new CliError(
      "PROJECT_NOT_CONFIGURED",
      "Bridge is reachable, but this repository is not configured.",
      cliExitCodes.configuration,
    );
  }

  const projectConfigPath = resolve(runtime.cwd, ".bridge", "project.yaml");
  checks.push({
    name: "project-config",
    status: "pass",
    detail: `Project ${config.projectId} is configured for ${config.client}.`,
    path: projectConfigPath.slice(runtime.cwd.length + 1),
  });

  try {
    const project = asRecord(
      await bridgeFetch(`/v1/projects/${encodeURIComponent(config.projectId)}`, connection, runtime),
    );
    const projectName = String(project?.name ?? "");
    checks.push({
      name: "project-mapping",
      status: project?.id === config.projectId ? "pass" : "fail",
      detail: project?.id === config.projectId
        ? `Project mapping is valid${projectName ? ` (${projectName})` : ""}.`
        : "The API returned a different project ID for this repository.",
    });
  } catch (error) {
    checks.push({
      name: "project-mapping",
      status: "fail",
      detail: error instanceof CliError ? error.message : "Project mapping could not be verified.",
    });
  }

  const rawMcpUrl = runtime.environment.BRIDGE_MCP_URL ?? config.mcpUrl;
  let configuredMcpUrl: string | undefined;
  let mcpStatus: "ready" | "failed" | "not_configured" = "not_configured";
  if (rawMcpUrl) {
    try {
      const validatedMcpUrl = optionalHttpUrl(
        rawMcpUrl,
        runtime.environment.BRIDGE_MCP_URL ? "BRIDGE_MCP_URL" : ".bridge/project.yaml mcp_url",
      );
      if (!validatedMcpUrl) throw new CliError("INVALID_URL", "MCP endpoint URL is empty.", cliExitCodes.configuration);
      configuredMcpUrl = validatedMcpUrl;
      const probe = await probeMcpEndpoint(validatedMcpUrl, runtime);
      mcpStatus = probe.status;
      checks.push({ name: "mcp", status: probe.status === "ready" ? "pass" : "fail", detail: probe.detail });
    } catch (error) {
      mcpStatus = "failed";
      checks.push({
        name: "mcp",
        status: "fail",
        detail: error instanceof CliError ? error.message : "MCP endpoint configuration is invalid.",
      });
    }
  }

  const bridgeInstructionsPath = resolve(runtime.cwd, ".bridge", "agent-instructions.md");
  const nativeInstructionsPath = clientInstructionPath(runtime.cwd, config.client);
  const requiredFiles: Array<{ name: string; path: string; predicate: (content: string) => boolean; detail: string }> = [
    {
      name: "bridge-instructions",
      path: bridgeInstructionsPath,
      predicate: (content) => content.includes("bridge run start") && content.includes("bridge sync"),
      detail: "Generated Bridge agent instructions are present.",
    },
    {
      name: "client-instructions",
      path: nativeInstructionsPath,
      predicate: (content) =>
        content.includes(bridgeInstructionsStart) && content.includes(bridgeInstructionsEnd),
      detail: `Managed Bridge instructions are present in the ${config.client} adapter file.`,
    },
  ];
  for (const file of requiredFiles) {
    const relativePath = file.path.slice(runtime.cwd.length + 1);
    if (!(await exists(file.path))) {
      checks.push({
        name: file.name,
        status: "fail",
        detail: "Required file is missing.",
        path: relativePath,
      });
      continue;
    }
    const content = await readFile(file.path, "utf8");
    checks.push({
      name: file.name,
      status: file.predicate(content) ? "pass" : "fail",
      detail: file.predicate(content) ? file.detail : "Required Bridge content is missing or incomplete.",
      path: relativePath,
    });
  }

  const instructionReady = checks
    .filter((check) => check.name === "bridge-instructions" || check.name === "client-instructions")
    .every((check) => check.status === "pass");
  const capabilityLevel = !instructionReady
    ? "unconfigured"
    : mcpStatus === "ready"
      ? "instructions+mcp"
      : mcpStatus === "failed"
        ? "instructions+mcp-failed"
        : "instructions";
  const ok = checks.every((check) => check.status === "pass");
  output(runtime, {
    ok,
    configured: true,
    projectId: config.projectId,
    apiUrl: connection.apiUrl,
    client: config.client,
    mcpUrl: configuredMcpUrl ?? null,
    capabilityLevel,
    capabilities: {
      instructions: instructionReady,
      cli: true,
      mcp: mcpStatus,
      hooks: "not_configured",
      continuation: true,
    },
    health,
    checks,
  });
  if (!ok) {
    throw new CliError(
      "DOCTOR_FAILED",
      "Bridge doctor found one or more configuration problems.",
      cliExitCodes.configuration,
      { checks },
    );
  }
}

async function executeCli(args: readonly string[], runtime: CliRuntime): Promise<void> {
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    runtime.stdout(`${usage()}\n`);
    return;
  }

  const command = args[0];
  if (command === "init") {
    await initializeRepository(args, runtime);
    return;
  }
  if (command === "install") {
    await installAdapter(args, runtime);
    return;
  }

  const config = await loadProjectConfig(runtime.cwd);
  const connection = connectionOptions(args, runtime, config);

  if (command === "doctor") {
    await runDoctor(config, connection, runtime);
    return;
  }

  if (command === "run") {
    const action = args[1];
    if (action === "start") {
      const projectId = requireProjectId(firstPositional(args, 2), config);
      const taskSummary = optionValue(args, "--task");
      if (!taskSummary) {
        throw new CliError("TASK_REQUIRED", "run start requires --task.", cliExitCodes.usage);
      }
      const client = optionValue(args, "--client") ?? "codex";
      if (!["codex", "claude_code", "cursor", "copilot", "custom", "unknown"].includes(client)) {
        throw new CliError("INVALID_RUN_CLIENT", "Unsupported --client value.", cliExitCodes.usage);
      }
      const capability = optionValue(args, "--capability") ?? "cli";
      if (!["instructions", "cli", "mcp", "hooks", "orchestrated"].includes(capability)) {
        throw new CliError("INVALID_RUN_CAPABILITY", "Unsupported --capability value.", cliExitCodes.usage);
      }
      const continuesRunId = optionValue(args, "--continues");
      const resumeContextKey = optionValue(args, "--resume-key");
      if (Boolean(continuesRunId) !== Boolean(resumeContextKey)) {
        throw new CliError(
          "INVALID_CONTINUATION",
          "--continues and --resume-key must be supplied together.",
          cliExitCodes.usage,
        );
      }
      const input = {
        idempotencyKey:
          optionValue(args, "--idempotency-key") ??
          `run-${createHash("sha256").update(`${projectId}:${taskSummary}:${continuesRunId ?? "new"}`).digest("hex").slice(0, 32)}`,
        client,
        capability,
        taskSummary,
        scope: Object.fromEntries(
          (["repository", "component", "branch", "environment", "workItem"] as const)
            .flatMap((key): Array<readonly [string, string]> => {
              const value = optionValue(args, `--${key}`);
              return value ? [[key, value]] : [];
            }),
        ),
        externalLinks: (optionValue(args, "--links") ?? "").split(",").filter(Boolean),
        ...(continuesRunId ? { continuesRunId, resumeContextKey } : {}),
      };
      output(
        runtime,
        await bridgeFetch(
          `/v1/projects/${encodeURIComponent(projectId)}/runs`,
          connection,
          runtime,
          { method: "POST", body: JSON.stringify(input) },
        ),
      );
      return;
    }

    if (action === "get") {
      const runId = firstPositional(args, 2);
      if (!runId) throw new CliError("RUN_REQUIRED", "A run ID is required.", cliExitCodes.usage);
      output(runtime, await bridgeFetch(`/v1/runs/${encodeURIComponent(runId)}`, connection, runtime));
      return;
    }

    if (action === "list") {
      const projectId = requireProjectId(firstPositional(args, 2), config);
      output(
        runtime,
        await bridgeFetch(`/v1/projects/${encodeURIComponent(projectId)}/runs`, connection, runtime),
      );
      return;
    }

    if (action === "continue") {
      const runId = firstPositional(args, 2);
      const resumeContextKey = optionValue(args, "--resume-key");
      if (!runId || !resumeContextKey) {
        throw new CliError(
          "CONTINUATION_REQUIRED",
          "run continue requires a run ID and --resume-key.",
          cliExitCodes.usage,
        );
      }
      output(
        runtime,
        await bridgeFetch(
          `/v1/runs/${encodeURIComponent(runId)}/continuation`,
          connection,
          runtime,
          { method: "POST", body: JSON.stringify({ resumeContextKey }) },
        ),
      );
      return;
    }

    if (action === "report") {
      const runId = firstPositional(args, 2);
      const status = optionValue(args, "--status");
      const expectedVersion = Number(optionValue(args, "--version"));
      if (!runId || !status || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
        throw new CliError(
          "RUN_REPORT_REQUIRED",
          "run report requires a run ID, --status, and positive --version.",
          cliExitCodes.usage,
        );
      }
      if (!["running", "waiting_for_human", "completed", "failed", "cancelled"].includes(status)) {
        throw new CliError("INVALID_RUN_STATUS", "Unsupported --status value.", cliExitCodes.usage);
      }
      output(
        runtime,
        await bridgeFetch(
          `/v1/runs/${encodeURIComponent(runId)}`,
          connection,
          runtime,
          {
            method: "PATCH",
            body: JSON.stringify({
              expectedVersion,
              status,
              ...(optionValue(args, "--summary") ? { summary: optionValue(args, "--summary") } : {}),
              resultLinks: (optionValue(args, "--links") ?? "").split(",").filter(Boolean),
            }),
          },
        ),
      );
      return;
    }

    throw new CliError(
      "UNKNOWN_RUN_COMMAND",
      "Use `bridge run start`, `get`, `list`, `continue`, or `report`.",
      cliExitCodes.usage,
    );
  }

  if (command === "spec") {
    const action = args[1];
    if (action === "publish") {
      const projectId = requireProjectId(firstPositional(args, 2), config);
      const file = optionValue(args, "--file");
      const title = optionValue(args, "--title");
      const type = optionValue(args, "--type");
      if (!file || !title || !type) {
        throw new CliError(
          "SPEC_INPUT_REQUIRED",
          "spec publish requires --file, --title, and --type.",
          cliExitCodes.usage,
        );
      }
      if (!["prd", "adr", "api_contract", "test_plan"].includes(type)) {
        throw new CliError(
          "INVALID_SPEC_TYPE",
          "--type must be prd, adr, api_contract, or test_plan.",
          cliExitCodes.usage,
        );
      }
      const body = file === "-" ? await runtime.readStdin() : await readFile(resolve(runtime.cwd, file), "utf8");
      const summary = optionValue(args, "--summary") ?? body
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.length >= 10 && !line.startsWith("#"));
      if (!summary) {
        throw new CliError(
          "SPEC_SUMMARY_REQUIRED",
          "Provide --summary or include a descriptive paragraph in the Markdown file.",
          cliExitCodes.usage,
        );
      }
      const artifactId = optionValue(args, "--artifact-id");
      const runId = optionValue(args, "--run-id");
      const contentHash = createHash("sha256").update(body).digest("hex");
      const input = {
        idempotencyKey:
          optionValue(args, "--idempotency-key") ??
          `spec-${createHash("sha256").update(`${projectId}:${artifactId ?? "new"}:${contentHash}`).digest("hex").slice(0, 32)}`,
        ...(artifactId ? { artifactId } : {}),
        ...(runId ? { runId } : {}),
        title,
        type,
        summary,
        body,
        intendedReviewerIds: (optionValue(args, "--reviewers") ?? "").split(",").filter(Boolean),
        citedDecisionIds: (optionValue(args, "--decisions") ?? "").split(",").filter(Boolean),
        requestReview: !args.includes("--draft"),
        scope: Object.fromEntries(
          (["repository", "component", "branch", "environment", "workItem"] as const)
            .flatMap((key): Array<readonly [string, string]> => {
              const value = optionValue(args, `--${key}`);
              return value ? [[key, value]] : [];
            }),
        ),
      };
      output(
        runtime,
        await bridgeFetch(
          `/v1/projects/${encodeURIComponent(projectId)}/artifacts`,
          connection,
          runtime,
          { method: "POST", body: JSON.stringify(input) },
        ),
      );
      return;
    }

    if (action === "get") {
      const artifactId = firstPositional(args, 2);
      if (!artifactId) throw new CliError("ARTIFACT_REQUIRED", "A specification ID is required.", cliExitCodes.usage);
      output(runtime, await bridgeFetch(`/v1/artifacts/${encodeURIComponent(artifactId)}`, connection, runtime));
      return;
    }

    if (action === "pull") {
      const projectId = requireProjectId(firstPositional(args, 2), config);
      const response = await bridgeFetch(
        `/v1/projects/${encodeURIComponent(projectId)}/artifacts`,
        connection,
        runtime,
      );
      const outputDirectory = resolve(runtime.cwd, optionValue(args, "--out") ?? ".bridge/specs");
      await mkdir(outputDirectory, { recursive: true });
      const manifestEntries: Array<Record<string, unknown>> = [];
      for (const value of itemsFrom(response)) {
        const artifact = asRecord(value);
        if (!artifact) continue;
        const version = approvedArtifactVersion(artifact);
        if (!version) continue;
        const artifactId = String(artifact.id);
        const versionId = String(version.id);
        const filename = `${slug(String(artifact.type))}-${slug(String(artifact.title))}-${slug(artifactId)}.md`;
        const path = resolve(outputDirectory, filename);
        const body = String(version.body ?? "");
        await writeAtomic(path, body.endsWith("\n") ? body : `${body}\n`);
        manifestEntries.push({
          artifactId,
          versionId,
          version: version.version,
          title: artifact.title,
          type: artifact.type,
          approvedAt: version.approvedAt ?? null,
          approvedById: version.approvedById ?? null,
          contentSha256: createHash("sha256").update(body).digest("hex"),
          file: path.slice(runtime.cwd.length + 1),
        });
      }
      const manifestPath = resolve(outputDirectory, "manifest.json");
      await writeAtomic(manifestPath, `${JSON.stringify({
        schemaVersion: 1,
        projectId,
        generatedAt: runtime.now().toISOString(),
        source: connection.apiUrl,
        items: manifestEntries,
      }, null, 2)}\n`);
      output(runtime, {
        ok: true,
        projectId,
        count: manifestEntries.length,
        directory: outputDirectory.slice(runtime.cwd.length + 1),
        manifest: manifestPath.slice(runtime.cwd.length + 1),
      });
      return;
    }

    throw new CliError(
      "UNKNOWN_SPEC_COMMAND",
      "Use `bridge spec publish`, `bridge spec get`, or `bridge spec pull`.",
      cliExitCodes.usage,
    );
  }

  if (command === "context") {
    const projectId = requireProjectId(firstPositional(args), config);
    const task = optionValue(args, "--task");
    if (!task) throw new CliError("TASK_REQUIRED", "--task is required for context retrieval.", cliExitCodes.usage);
    const query = new URLSearchParams({ task });
    const runId = optionValue(args, "--run-id");
    if (runId) query.set("runId", runId);
    for (const key of ["repository", "component", "branch", "environment", "workItem"] as const) {
      const value = optionValue(args, `--${key}`);
      if (value) query.set(key, value);
    }
    const category = optionValue(args, "--category");
    if (category) query.set("categories", category);
    const context = await bridgeFetch(
      `/v1/projects/${encodeURIComponent(projectId)}/context?${query}`,
      connection,
      runtime,
    );
    if (optionValue(args, "--format") === "markdown") {
      runtime.stdout(renderContextMarkdown(projectId, task, context));
    } else {
      output(runtime, context);
    }
    return;
  }

  if (command === "ask") {
    const projectId = requireProjectId(firstPositional(args), config);
    const file = optionValue(args, "--file");
    if (!file) throw new CliError("FILE_REQUIRED", "--file is required for bridge ask.", cliExitCodes.usage);
    let input: unknown;
    try {
      const content = file === "-" ? await runtime.readStdin() : await readFile(resolve(runtime.cwd, file), "utf8");
      input = JSON.parse(content);
    } catch (error) {
      throw new CliError(
        "INVALID_QUESTION_FILE",
        "The question file must contain valid JSON.",
        cliExitCodes.usage,
        { cause: error instanceof Error ? error.message : String(error) },
      );
    }
    const question = await bridgeFetch(
      `/v1/projects/${encodeURIComponent(projectId)}/questions`,
      connection,
      runtime,
      { method: "POST", body: JSON.stringify(input) },
    );
    const record = asRecord(question);
    output(runtime, {
      ok: true,
      questionId: record?.id ?? null,
      status: record?.status ?? null,
      submissionDisposition: record?.submissionDisposition ?? null,
      ownerIds: record?.ownerIds ?? [],
      ownerRoles: record?.ownerRoles ?? [],
      blocking: record?.blocking ?? false,
      risk: record?.risk ?? null,
      question,
    });
    return;
  }

  if (command === "question") {
    if (args[1] === "matches") {
      const projectId = requireProjectId(firstPositional(args, 2), config);
      const file = optionValue(args, "--file");
      if (!file) {
        throw new CliError(
          "FILE_REQUIRED",
          "question matches requires --file.",
          cliExitCodes.usage,
        );
      }
      let input: unknown;
      try {
        const content = file === "-"
          ? await runtime.readStdin()
          : await readFile(resolve(runtime.cwd, file), "utf8");
        input = JSON.parse(content);
      } catch (error) {
        throw new CliError(
          "INVALID_QUESTION_FILE",
          "The question file must contain valid JSON.",
          cliExitCodes.usage,
          { cause: error instanceof Error ? error.message : String(error) },
        );
      }
      output(
        runtime,
        await bridgeFetch(
          `/v1/projects/${encodeURIComponent(projectId)}/questions/matches`,
          connection,
          runtime,
          { method: "POST", body: JSON.stringify(input) },
        ),
      );
      return;
    }
    const questionId = args[1] === "get" ? args[2] : args[1];
    if (!questionId) throw new CliError("QUESTION_REQUIRED", "A question ID is required.", cliExitCodes.usage);
    output(runtime, await bridgeFetch(`/v1/questions/${encodeURIComponent(questionId)}`, connection, runtime));
    return;
  }

  if (command === "wait") {
    const questionId = firstPositional(args);
    if (!questionId) throw new CliError("QUESTION_REQUIRED", "A question ID is required.", cliExitCodes.usage);
    const timeout = Number(optionValue(args, "--timeout") ?? 60);
    const interval = Number(optionValue(args, "--interval") ?? 2);
    if (!Number.isFinite(timeout) || timeout < 0 || timeout > 3_600 || !Number.isFinite(interval) || interval <= 0) {
      throw new CliError(
        "INVALID_WAIT",
        "--timeout must be 0–3600 seconds and --interval must be greater than zero.",
        cliExitCodes.usage,
      );
    }
    let elapsed = 0;
    while (true) {
      const question = await bridgeFetch(`/v1/questions/${encodeURIComponent(questionId)}`, connection, runtime);
      const record = asRecord(question);
      const status = String(record?.status ?? "unknown");
      if (status === "accepted") {
        const responses = Array.isArray(record?.responses) ? record.responses : [];
        const acceptedResponse = responses
          .map(asRecord)
          .find((response) => response?.id === record?.acceptedResponseId);
        output(runtime, {
          ok: true,
          questionId,
          status,
          decisionId: record?.decisionId ?? null,
          answer: acceptedResponse?.answer ?? null,
          rationale: acceptedResponse?.rationale ?? null,
        });
        return;
      }
      if (["duplicate", "cancelled", "expired"].includes(status)) {
        throw new CliError(
          "QUESTION_CLOSED",
          `Question ${questionId} closed with status ${status} without an accepted answer.`,
          cliExitCodes.conflict,
          { questionId, status },
        );
      }
      if (elapsed >= timeout) {
        throw new CliError(
          "QUESTION_PENDING",
          `Question ${questionId} is still awaiting a human decision.`,
          cliExitCodes.pending,
          { questionId, status, waitedSeconds: elapsed },
        );
      }
      const waitSeconds = Math.min(interval, timeout - elapsed);
      await runtime.sleep(waitSeconds * 1_000);
      elapsed += waitSeconds;
    }
  }

  if (command === "pending") {
    const projectId = requireProjectId(firstPositional(args), config);
    const response = await bridgeFetch(
      `/v1/projects/${encodeURIComponent(projectId)}/questions`,
      connection,
      runtime,
    );
    const pending = itemsFrom(response).filter((question) => {
      const record = asRecord(question);
      return record && ["open", "in_discussion"].includes(String(record.status));
    });
    output(runtime, { items: pending });
    return;
  }

  if (command === "inbox") {
    const projectId = requireProjectId(firstPositional(args), config);
    const query = new URLSearchParams();
    for (const key of ["status", "risk", "category", "role"] as const) {
      const value = optionValue(args, `--${key}`);
      if (value) query.set(key, value);
    }
    output(
      runtime,
      await bridgeFetch(
        `/v1/projects/${encodeURIComponent(projectId)}/inbox${query.size > 0 ? `?${query}` : ""}`,
        connection,
        runtime,
      ),
    );
    return;
  }

  if (command === "assumption") {
    const action = args[1];
    if (action === "add") {
      const projectId = requireProjectId(firstPositional(args, 2), config);
      const file = optionValue(args, "--file");
      if (!file) {
        throw new CliError(
          "FILE_REQUIRED",
          "assumption add requires --file.",
          cliExitCodes.usage,
        );
      }
      let input: unknown;
      try {
        const content = file === "-"
          ? await runtime.readStdin()
          : await readFile(resolve(runtime.cwd, file), "utf8");
        input = JSON.parse(content);
      } catch (error) {
        throw new CliError(
          "INVALID_ASSUMPTION_FILE",
          "The assumption file must contain valid JSON.",
          cliExitCodes.usage,
          { cause: error instanceof Error ? error.message : String(error) },
        );
      }
      const assumption = await bridgeFetch(
        `/v1/projects/${encodeURIComponent(projectId)}/assumptions`,
        connection,
        runtime,
        { method: "POST", body: JSON.stringify(input) },
      );
      output(runtime, { ok: true, assumption });
      return;
    }

    if (action === "get") {
      const assumptionId = firstPositional(args, 2);
      if (!assumptionId) {
        throw new CliError("ASSUMPTION_REQUIRED", "An assumption ID is required.", cliExitCodes.usage);
      }
      output(
        runtime,
        await bridgeFetch(`/v1/assumptions/${encodeURIComponent(assumptionId)}`, connection, runtime),
      );
      return;
    }

    if (action === "list") {
      const projectId = requireProjectId(firstPositional(args, 2), config);
      output(
        runtime,
        await bridgeFetch(
          `/v1/projects/${encodeURIComponent(projectId)}/assumptions`,
          connection,
          runtime,
        ),
      );
      return;
    }

    if (action === "resolve") {
      const assumptionId = firstPositional(args, 2);
      const status = optionValue(args, "--status");
      const rationale = optionValue(args, "--rationale");
      const expectedVersion = Number(optionValue(args, "--version"));
      if (
        !assumptionId ||
        !status ||
        !rationale ||
        !Number.isInteger(expectedVersion) ||
        expectedVersion < 1
      ) {
        throw new CliError(
          "ASSUMPTION_RESOLUTION_REQUIRED",
          "assumption resolve requires an ID, --status, --version, and --rationale.",
          cliExitCodes.usage,
        );
      }
      if (!["confirmed", "rejected", "expired", "superseded"].includes(status)) {
        throw new CliError(
          "INVALID_ASSUMPTION_STATUS",
          "Unsupported assumption resolution status.",
          cliExitCodes.usage,
        );
      }
      output(
        runtime,
        await bridgeFetch(
          `/v1/assumptions/${encodeURIComponent(assumptionId)}/resolve`,
          connection,
          runtime,
          {
            method: "POST",
            body: JSON.stringify({
              expectedVersion,
              status,
              rationale,
              ...(optionValue(args, "--decision-id")
                ? { confirmedDecisionId: optionValue(args, "--decision-id") }
                : {}),
              ...(optionValue(args, "--superseding-id")
                ? { supersedingAssumptionId: optionValue(args, "--superseding-id") }
                : {}),
            }),
          },
        ),
      );
      return;
    }

    throw new CliError(
      "UNKNOWN_ASSUMPTION_COMMAND",
      "Use `bridge assumption add`, `get`, `list`, or `resolve`.",
      cliExitCodes.usage,
    );
  }

  if (command === "sync") {
    const projectId = requireProjectId(firstPositional(args), config);
    const task = optionValue(args, "--task") ?? "Synchronize approved repository context";
    const query = new URLSearchParams({ task });
    const runId = optionValue(args, "--run-id");
    if (runId) query.set("runId", runId);
    if (config?.repository) query.set("repository", config.repository);
    const [context, decisions, assumptions, questions, artifacts] = await Promise.all([
      bridgeFetch(`/v1/projects/${encodeURIComponent(projectId)}/context?${query}`, connection, runtime),
      bridgeFetch(`/v1/projects/${encodeURIComponent(projectId)}/decisions`, connection, runtime),
      bridgeFetch(`/v1/projects/${encodeURIComponent(projectId)}/assumptions`, connection, runtime),
      bridgeFetch(`/v1/projects/${encodeURIComponent(projectId)}/questions`, connection, runtime),
      bridgeFetch(`/v1/projects/${encodeURIComponent(projectId)}/artifacts`, connection, runtime),
    ]);
    const bridgeDirectory = resolve(runtime.cwd, ".bridge");
    await mkdir(bridgeDirectory, { recursive: true });
    const contextRecord = asRecord(context);
    const currentAssumptions = {
      items: itemsFrom(assumptions).filter((value) => {
        const assumption = asRecord(value);
        return assumption ? ["active", "confirmed"].includes(String(assumption.status)) : false;
      }),
    };
    const approvedArtifacts = {
      items: itemsFrom(artifacts).filter((value) => {
        const artifact = asRecord(value);
        return artifact ? Boolean(approvedArtifactVersion(artifact)) : false;
      }),
    };
    const pendingQuestions = {
      items: itemsFrom(questions).filter((value) => {
        const question = asRecord(value);
        return question ? ["open", "in_discussion"].includes(String(question.status)) : false;
      }),
    };
    const metadata = {
      schemaVersion: 1,
      projectId,
      repository: config?.repository ?? null,
      generatedAt: runtime.now().toISOString(),
      task,
      contextSnapshotId: contextRecord?.contextSnapshotId ?? null,
      itemCount: itemsFrom(context).length,
      assumptionCount: currentAssumptions.items.length,
      pendingQuestionCount: pendingQuestions.items.length,
      specificationCount: approvedArtifacts.items.length,
      source: connection.apiUrl,
    };
    const files = {
      markdown: resolve(bridgeDirectory, "context.md"),
      context: resolve(bridgeDirectory, "context.json"),
      decisions: resolve(bridgeDirectory, "decisions.json"),
      assumptions: resolve(bridgeDirectory, "assumptions.json"),
      questions: resolve(bridgeDirectory, "questions.json"),
      specifications: resolve(bridgeDirectory, "specifications.json"),
      metadata: resolve(bridgeDirectory, "sync-metadata.json"),
    };
    await Promise.all([
      writeAtomic(files.markdown, renderContextMarkdown(projectId, task, context)),
      writeAtomic(files.context, `${JSON.stringify(context, null, 2)}\n`),
      writeAtomic(files.decisions, `${JSON.stringify(decisions, null, 2)}\n`),
      writeAtomic(files.assumptions, `${JSON.stringify(currentAssumptions, null, 2)}\n`),
      writeAtomic(files.questions, `${JSON.stringify(pendingQuestions, null, 2)}\n`),
      writeAtomic(files.specifications, `${JSON.stringify(approvedArtifacts, null, 2)}\n`),
      writeAtomic(files.metadata, `${JSON.stringify(metadata, null, 2)}\n`),
    ]);
    output(runtime, {
      ok: true,
      ...metadata,
      files: Object.values(files).map((path) => path.slice(runtime.cwd.length + 1)),
    });
    return;
  }

  throw new CliError("UNKNOWN_COMMAND", `Unknown command: ${String(command)}\n\n${usage()}`, cliExitCodes.usage);
}

export async function runCli(
  args: readonly string[],
  overrides: Partial<CliRuntime> = {},
): Promise<number> {
  const runtime = { ...defaultRuntime(), ...overrides };
  try {
    await executeCli(args, runtime);
    return cliExitCodes.success;
  } catch (error) {
    const cliError = error instanceof CliError
      ? error
      : new CliError(
          "INTERNAL_ERROR",
          error instanceof Error ? error.message : String(error),
          cliExitCodes.internal,
        );
    runtime.stderr(`${JSON.stringify({
      ok: false,
      code: cliError.code,
      message: cliError.message,
      exitCode: cliError.exitCode,
      ...(cliError.details ? { details: cliError.details } : {}),
    })}\n`);
    return cliError.exitCode;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runCli(process.argv.slice(2));
}
