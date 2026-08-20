#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";

import {
  CliAuthenticationError,
  createAuthorizationRequest,
  createSystemCredentialStore,
  openSystemBrowser,
  parseCliOidcConfiguration,
  parseStoredSession,
  serializeStoredSession,
  startLoopbackCallback,
  type CliOidcConfiguration,
  type CredentialStore,
  type LoopbackCallback,
  type StoredCliSession,
} from "./auth.js";

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
  readonly outputMode: "json" | "human";
  readonly fetch: FetchFunction;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  readonly readStdin: () => Promise<string>;
  readonly isInteractive: boolean;
  readonly prompt: (message: string) => Promise<string>;
  readonly sleep: (milliseconds: number) => Promise<void>;
  readonly now: () => Date;
  readonly credentialStore: CredentialStore;
  readonly openBrowser: (url: string) => Promise<boolean>;
  readonly startOAuthCallback: (
    redirectUri: string,
    expectedState: string,
    timeoutMilliseconds?: number,
  ) => Promise<LoopbackCallback>;
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

interface ConnectionAuthenticationState {
  publicConfiguration?: Promise<Readonly<Record<string, unknown>>>;
  session?: Promise<StoredCliSession | undefined>;
}

const connectionAuthenticationStates = new WeakMap<ConnectionOptions, ConnectionAuthenticationState>();

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
    outputMode: "json",
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
    isInteractive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    prompt: async (message) => {
      const readline = createInterface({ input: process.stdin, output: process.stderr });
      try {
        return await readline.question(message);
      } finally {
        readline.close();
      }
    },
    sleep: (milliseconds) => new Promise((complete) => setTimeout(complete, milliseconds)),
    now: () => new Date(),
    credentialStore: createSystemCredentialStore(),
    openBrowser: (url) => openSystemBrowser(url),
    startOAuthCallback: (redirectUri, expectedState, timeoutMilliseconds) =>
      startLoopbackCallback(redirectUri, expectedState, timeoutMilliseconds),
  };
}

function optionValue(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function optionValues(args: readonly string[], name: string): readonly string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== name) continue;
    const value = args[index + 1];
    if (value && !value.startsWith("--")) values.push(value);
  }
  return values;
}

function commaSeparatedOptionValues(args: readonly string[], name: string): readonly string[] {
  return optionValues(args, name)
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
}

function requiredOptionValue(args: readonly string[], name: string, message: string): string {
  const value = optionValue(args, name)?.trim();
  if (!value) throw new CliError("OPTION_REQUIRED", message, cliExitCodes.usage);
  return value;
}

function firstPositional(args: readonly string[], start = 1): string | undefined {
  const candidate = args[start];
  return candidate && !candidate.startsWith("--") ? candidate : undefined;
}

function usage(): string {
  return `Bridge CLI — works with or without MCP

Usage:
  bridge login [--api-url <url>] [--no-browser]
  bridge logout [--api-url <url>]
  bridge auth status [--api-url <url>]
  bridge service identity list [--api-url <url>]
  bridge service identity create --name <name> --type <agent|ci|integration> --scope <scope>[,<scope>...] [--role <role>] [--project <project-id[=role,...]>] [--all-projects] [--expires-at <ISO datetime>] [--api-url <url>]
  bridge service identity rotate <credential-id> --version <number> [--api-url <url>]
  bridge service identity revoke <credential-id> --version <number> [--api-url <url>]
  bridge init [project-id] [--name <project-name>] [--client <client>] [--api-url <url>] [--mcp-url <url>] [--repository <name>] [--interactive] [--force] [--yes] [--dry-run]
  bridge install [--client <client>] [--dry-run]
  bridge repository list [project-id]
  bridge repository link [project-id] --provider <provider> --owner <owner> --name <name> --url <http(s)-url> [--idempotency-key <key>]
  bridge doctor
  bridge conformance [project-id] --task <description> [--run-id <id>]
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
  bridge assumption resolve <assumption-id> --status <status> --version <number> --rationale <text> [--decision-id <id> | --create-decision] [--superseding-id <id>]
  bridge sync [project-id] [--task <description>] [--run-id <id>]
  bridge spec publish [project-id] --file <spec.md> --title <title> --type <prd|adr|api_contract|test_plan> [--run-id <id>]
  bridge spec get <artifact-id>
  bridge spec pull [project-id] [--out <directory>]

Output:
  --output <json|human>  JSON is the stable default for agents and automation.

Configuration:
  bridge init --name <name> registers a project and activates repository instructions for the selected client.
  bridge init --interactive lists projects visible to the current principal and asks which one to use.
  With --mcp-url, Codex and Claude Code also receive project-scoped MCP configuration without credentials; omit it for the instruction/CLI-only path.
  When existing Bridge-owned files would change, an interactive run shows the planned changes and asks for confirmation; use --yes only for an explicitly approved noninteractive update.
  bridge install activates or switches a client adapter for an existing .bridge/project.yaml without registering a project.
  A project ID can then be omitted from repository-scoped commands.

Development environment:
  BRIDGE_API_URL        Overrides the configured API URL
  BRIDGE_MCP_URL        Overrides the optional configured MCP endpoint
  BRIDGE_PRINCIPAL_ID   Development-mode identity (default: agt_codex; ignored by OIDC servers)

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

interface ProjectSelection {
  readonly id: string;
  readonly name: string;
}

async function detectRepositoryName(cwd: string): Promise<string> {
  const fallback = basename(cwd);
  try {
    const gitConfig = await readFile(resolve(cwd, ".git", "config"), "utf8");
    const origin = /\[remote\s+"origin"\]([\s\S]*?)(?=\n\[|$)/i.exec(gitConfig)?.[1];
    const remoteUrl = origin ? /^\s*url\s*=\s*(\S+)\s*$/im.exec(origin)?.[1] : undefined;
    if (!remoteUrl) return fallback;
    const remotePath = remoteUrl
      .replace(/^[^:]+:\/?/, "")
      .replace(/^https?:\/\/[^/]+\//i, "")
      .replace(/\.git\/?$/, "")
      .replace(/\/$/, "");
    const repositoryName = remotePath.split("/").at(-1)?.trim();
    return repositoryName || fallback;
  } catch {
    return fallback;
  }
}

function initializationPrincipal(args: readonly string[], runtime: CliRuntime): string {
  return optionValue(args, "--principal-id") ?? runtime.environment.BRIDGE_INIT_PRINCIPAL_ID ?? "usr_architect";
}

function projectSelectionItems(value: unknown): ProjectSelection[] {
  const items = asRecord(value)?.items;
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      const record = asRecord(item);
      const id = typeof record?.id === "string" ? record.id.trim() : "";
      const name = typeof record?.name === "string" ? record.name.trim() : "";
      return id && name ? { id, name } : undefined;
    })
    .filter((item): item is ProjectSelection => item !== undefined)
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}

async function selectAuthorizedProject(
  repository: string,
  apiUrl: string,
  args: readonly string[],
  runtime: CliRuntime,
): Promise<ProjectSelection> {
  const projects = projectSelectionItems(await bridgeFetch(
    "/v1/projects",
    { apiUrl, principalId: initializationPrincipal(args, runtime) },
    runtime,
    { method: "GET" },
  ));
  if (projects.length === 0) {
    throw new CliError(
      "NO_AUTHORIZED_PROJECTS",
      "Bridge returned no projects that this principal can access. Ask a project administrator to grant access or use --name to register a project.",
      cliExitCodes.forbidden,
      { repository },
    );
  }
  runtime.stderr(`Authorized Bridge projects for ${repository}:\n${projects
    .map((project, index) => `  ${index + 1}. ${project.name} (${project.id})`)
    .join("\n")}\n`);
  const answer = (await runtime.prompt("Select a project number (or q to cancel): ")).trim();
  if (answer.toLowerCase() === "q" || answer.toLowerCase() === "quit") {
    throw new CliError("PROJECT_SELECTION_CANCELLED", "Project selection was cancelled.", cliExitCodes.usage);
  }
  const numericSelection = Number.parseInt(answer, 10);
  const selected = Number.isInteger(numericSelection) && numericSelection > 0
    ? projects[numericSelection - 1]
    : projects.find((project) => project.id === answer || project.name.toLowerCase() === answer.toLowerCase());
  if (!selected) {
    throw new CliError(
      "INVALID_PROJECT_SELECTION",
      "Choose one of the listed project numbers, or enter a project ID or name.",
      cliExitCodes.usage,
      { availableProjectIds: projects.map((project) => project.id) },
    );
  }
  return selected;
}

async function validateProjectMapping(
  projectId: string,
  apiUrl: string,
  args: readonly string[],
  runtime: CliRuntime,
): Promise<string> {
  const project = asRecord(await bridgeFetch(
    `/v1/projects/${encodeURIComponent(projectId)}`,
    { apiUrl, principalId: initializationPrincipal(args, runtime) },
    runtime,
    { method: "GET" },
  ));
  if (!project || project.id !== projectId || typeof project.name !== "string" || !project.name.trim()) {
    throw new CliError(
      "INVALID_PROJECT_RESPONSE",
      "Bridge returned an invalid project while validating the repository mapping.",
      cliExitCodes.connection,
      { projectId },
    );
  }
  return project.name;
}

type InitializationChange = {
  readonly path: string;
  readonly action: "create" | "update" | "unchanged";
};

async function planInitializationFiles(
  runtime: CliRuntime,
  paths: Readonly<Record<"project" | "instructions" | "example" | "assumptionExample", string>>,
  adapterPath: string,
  config: ProjectConfig,
): Promise<InitializationChange[]> {
  const changes: InitializationChange[] = [];
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
  const mcpConfig = await planMcpConfig(runtime.cwd, config.client, config.mcpUrl);
  if (mcpConfig) await planFile(mcpConfig.path, mcpConfig.content);
  return changes;
}

async function confirmInitializationChanges(
  runtime: CliRuntime,
  changes: readonly InitializationChange[],
): Promise<void> {
  const changed = changes.filter((change) => change.action !== "unchanged");
  if (changed.length === 0) return;
  runtime.stderr(`Bridge will change these files:\n${changed
    .map((change) => `  ${change.action}: ${change.path}`)
    .join("\n")}\n`);
  const answer = (await runtime.prompt("Apply these Bridge-owned changes? [y/N] ")).trim().toLowerCase();
  if (answer !== "y" && answer !== "yes") {
    throw new CliError(
      "CONFIRMATION_REQUIRED",
      "Repository changes were not applied. Re-run and confirm the displayed Bridge-owned changes.",
      cliExitCodes.conflict,
      { changes: changed },
    );
  }
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
  const apiUrl = optionalHttpUrl(
    optionValue(args, "--api-url") ??
      runtime.environment.BRIDGE_API_URL ??
      config?.apiUrl ??
      "http://127.0.0.1:4000",
    "Bridge API URL",
  )!;
  return {
    apiUrl,
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
  authenticate = true,
): Promise<unknown> {
  const authenticationHeaders = authenticate
    ? await resolveAuthenticationHeaders(options, runtime)
    : {};
  let response: Response;
  try {
    response = await runtime.fetch(`${options.apiUrl}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        "x-bridge-correlation-id": `cli_${randomUUID().replaceAll("-", "")}`,
        ...init.headers,
        ...authenticationHeaders,
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
    if (response.status === 401 && authenticate) {
      const configuration = await authenticationState(options).publicConfiguration?.catch(() => undefined);
      if (configuration?.mode === "oidc") {
        await deleteStoredSession(options, runtime).catch(() => undefined);
      }
    }
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

function authenticationState(options: ConnectionOptions): ConnectionAuthenticationState {
  const existing = connectionAuthenticationStates.get(options);
  if (existing) return existing;
  const state: ConnectionAuthenticationState = {};
  connectionAuthenticationStates.set(options, state);
  return state;
}

async function publicAuthenticationConfiguration(
  options: ConnectionOptions,
  runtime: CliRuntime,
): Promise<Readonly<Record<string, unknown>>> {
  const state = authenticationState(options);
  state.publicConfiguration ??= bridgeFetch(
    "/v1/auth/config",
    options,
    runtime,
    { method: "GET" },
    false,
  ).then((value) => {
    const record = asRecord(value);
    if (!record || (record.mode !== "development" && record.mode !== "oidc")) {
      throw new CliError(
        "INVALID_AUTH_CONFIGURATION",
        "Bridge returned invalid authentication configuration.",
        cliExitCodes.connection,
      );
    }
    return record;
  });
  return state.publicConfiguration;
}

async function resolveAuthenticationHeaders(
  options: ConnectionOptions,
  runtime: CliRuntime,
): Promise<Readonly<Record<string, string>>> {
  const configuration = await publicAuthenticationConfiguration(options, runtime);
  if (configuration.mode === "development") {
    return { "x-bridge-principal-id": options.principalId };
  }
  const session = await usableStoredSession(options, runtime, configuration);
  if (!session) {
    throw new CliError(
      "AUTHENTICATION_REQUIRED",
      `Sign in with \`bridge login --api-url ${options.apiUrl}\` before calling this OIDC Bridge API.`,
      cliExitCodes.forbidden,
    );
  }
  return { authorization: `Bearer ${session.accessToken}` };
}

function humanLabel(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const acronyms = new Set(["api", "cli", "id", "mcp", "url"]);
  return words.length > 0
    ? words.map((word) => acronyms.has(word.toLowerCase())
      ? word.toUpperCase()
      : `${word[0]?.toUpperCase()}${word.slice(1)}`).join(" ")
    : key;
}

function humanScalar(value: string | number | boolean | null): string {
  if (value === null) return "none";
  return typeof value === "boolean" ? (value ? "yes" : "no") : String(value);
}

function renderHumanFields(record: Readonly<Record<string, unknown>>, indentation = 0): string[] {
  const prefix = " ".repeat(indentation);
  const lines: string[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (key === "ok") continue;
    const label = humanLabel(key);
    if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
      lines.push(`${prefix}${label}: ${humanScalar(value as string | number | boolean | null)}`);
      continue;
    }
    if (Array.isArray(value)) {
      lines.push(`${prefix}${label}:`);
      if (value.length === 0) {
        lines.push(`${prefix}  (none)`);
        continue;
      }
      for (const item of value) {
        const itemRecord = asRecord(item);
        if (!itemRecord) {
          lines.push(`${prefix}  - ${humanScalar(item as string | number | boolean | null)}`);
          continue;
        }
        if (key === "checks") {
          const status = String(itemRecord.status ?? "unknown").toUpperCase();
          const name = String(itemRecord.name ?? "check");
          const detail = String(itemRecord.detail ?? "");
          lines.push(`${prefix}  [${status}] ${name}${detail ? ` — ${detail}` : ""}`);
          continue;
        }
        lines.push(`${prefix}  -`);
        lines.push(...renderHumanFields(itemRecord, indentation + 4));
      }
      continue;
    }
    const nested = asRecord(value);
    if (nested) {
      lines.push(`${prefix}${label}:`);
      lines.push(...renderHumanFields(nested, indentation + 2));
    }
  }
  return lines;
}

function renderHumanOutput(value: unknown): string {
  const record = asRecord(value);
  if (!record) {
    if (Array.isArray(value)) {
      return value.map((item) => `- ${String(item)}`).join("\n");
    }
    return String(value ?? "");
  }
  const lines = typeof record.ok === "boolean"
    ? [`Status: ${record.ok ? "OK" : "FAILED"}`]
    : [];
  lines.push(...renderHumanFields(record));
  return `${lines.join("\n")}\n`;
}

function output(runtime: CliRuntime, value: unknown): void {
  runtime.stdout(runtime.outputMode === "human"
    ? renderHumanOutput(value)
    : `${JSON.stringify(value, null, 2)}\n`);
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null ? value as Readonly<Record<string, unknown>> : undefined;
}

interface TokenGrant {
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly expiresIn: number;
  readonly scopes?: readonly string[];
}

function asCliAuthenticationError(error: unknown): CliError {
  if (error instanceof CliError) return error;
  if (error instanceof CliAuthenticationError) {
    return new CliError(
      error.code,
      error.message,
      error.code === "LOGIN_REJECTED" ? cliExitCodes.forbidden : cliExitCodes.configuration,
    );
  }
  return new CliError(
    "AUTHENTICATION_FAILED",
    "CLI authentication could not complete safely.",
    cliExitCodes.configuration,
  );
}

function cliOidcConfiguration(value: unknown): CliOidcConfiguration {
  try {
    return parseCliOidcConfiguration(value);
  } catch (error) {
    throw asCliAuthenticationError(error);
  }
}

async function loadStoredSession(
  options: ConnectionOptions,
  runtime: CliRuntime,
): Promise<StoredCliSession | undefined> {
  const state = authenticationState(options);
  state.session ??= runtime.credentialStore.get(options.apiUrl).then((value) => {
    if (value === undefined) return undefined;
    try {
      return parseStoredSession(value, options.apiUrl);
    } catch (error) {
      throw asCliAuthenticationError(error);
    }
  }).catch((error: unknown) => {
    throw asCliAuthenticationError(error);
  });
  return state.session;
}

async function saveStoredSession(
  options: ConnectionOptions,
  runtime: CliRuntime,
  session: StoredCliSession,
): Promise<void> {
  try {
    await runtime.credentialStore.set(options.apiUrl, serializeStoredSession(session));
  } catch (error) {
    throw asCliAuthenticationError(error);
  }
  authenticationState(options).session = Promise.resolve(session);
}

async function deleteStoredSession(
  options: ConnectionOptions,
  runtime: CliRuntime,
): Promise<boolean> {
  try {
    const deleted = await runtime.credentialStore.delete(options.apiUrl);
    authenticationState(options).session = Promise.resolve(undefined);
    return deleted;
  } catch (error) {
    throw asCliAuthenticationError(error);
  }
}

async function requestToken(
  configuration: CliOidcConfiguration,
  runtime: CliRuntime,
  parameters: URLSearchParams,
  failureCode: "LOGIN_EXCHANGE_FAILED" | "SESSION_REFRESH_FAILED",
): Promise<TokenGrant> {
  let response: Response;
  try {
    response = await runtime.fetch(configuration.tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: parameters,
    });
  } catch {
    throw new CliError(
      "IDENTITY_PROVIDER_UNAVAILABLE",
      "The CLI could not reach the configured identity provider.",
      cliExitCodes.connection,
    );
  }
  if (!response.ok) {
    throw new CliError(
      failureCode,
      failureCode === "LOGIN_EXCHANGE_FAILED"
        ? "The identity provider rejected the CLI sign-in exchange."
        : "The CLI session could not be refreshed; sign in again.",
      cliExitCodes.forbidden,
    );
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new CliError(failureCode, "The identity provider returned an invalid token response.", cliExitCodes.connection);
  }
  const record = asRecord(body);
  const accessToken = record?.access_token;
  const refreshToken = record?.refresh_token;
  const expiresIn = record?.expires_in;
  const tokenType = record?.token_type;
  if (
    typeof accessToken !== "string" ||
    accessToken.length < 20 ||
    accessToken.length > 32_768 ||
    typeof expiresIn !== "number" ||
    !Number.isSafeInteger(expiresIn) ||
    expiresIn < 1 ||
    expiresIn > 2_592_000 ||
    (refreshToken !== undefined && (
      typeof refreshToken !== "string" ||
      refreshToken.length < 20 ||
      refreshToken.length > 32_768
    )) ||
    (tokenType !== undefined && (typeof tokenType !== "string" || tokenType.toLowerCase() !== "bearer"))
  ) {
    throw new CliError(failureCode, "The identity provider returned an invalid token response.", cliExitCodes.connection);
  }
  const scope = typeof record?.scope === "string"
    ? [...new Set(record.scope.split(/\s+/).filter(Boolean))]
    : undefined;
  return {
    accessToken,
    expiresIn,
    ...(typeof refreshToken === "string" ? { refreshToken } : {}),
    ...(scope ? { scopes: scope } : {}),
  };
}

function sessionFromGrant(
  options: ConnectionOptions,
  runtime: CliRuntime,
  configuration: CliOidcConfiguration,
  grant: TokenGrant,
  previous?: StoredCliSession,
): StoredCliSession {
  const now = runtime.now();
  const refreshToken = grant.refreshToken ?? previous?.refreshToken;
  return {
    version: 1,
    apiUrl: options.apiUrl,
    accessToken: grant.accessToken,
    ...(refreshToken ? { refreshToken } : {}),
    expiresAt: Math.floor(now.getTime() / 1_000) + grant.expiresIn,
    scopes: grant.scopes ?? previous?.scopes ?? configuration.scopes,
    obtainedAt: now.toISOString(),
  };
}

async function currentPrincipalForToken(
  options: ConnectionOptions,
  runtime: CliRuntime,
  accessToken: string,
): Promise<Readonly<Record<string, unknown>>> {
  try {
    const value = await bridgeFetch(
      "/v1/auth/me",
      options,
      runtime,
      { headers: { authorization: `Bearer ${accessToken}` } },
      false,
    );
    const principal = asRecord(value);
    if (!principal || typeof principal.id !== "string" || principal.type !== "human") {
      throw new Error("invalid principal");
    }
    return principal;
  } catch (error) {
    if (error instanceof CliError && error.exitCode === cliExitCodes.connection) throw error;
    throw new CliError(
      "SESSION_VALIDATION_FAILED",
      "Bridge rejected the CLI session; sign in again or ask an administrator to verify membership.",
      cliExitCodes.forbidden,
    );
  }
}

async function refreshStoredSession(
  options: ConnectionOptions,
  runtime: CliRuntime,
  configuration: CliOidcConfiguration,
  session: StoredCliSession,
): Promise<StoredCliSession> {
  if (!session.refreshToken) {
    await deleteStoredSession(options, runtime);
    throw new CliError(
      "AUTHENTICATION_EXPIRED",
      `The CLI session expired and cannot refresh; run \`bridge login --api-url ${options.apiUrl}\` again.`,
      cliExitCodes.forbidden,
    );
  }
  let grant: TokenGrant;
  try {
    grant = await requestToken(configuration, runtime, new URLSearchParams({
      grant_type: "refresh_token",
      client_id: configuration.clientId,
      refresh_token: session.refreshToken,
    }), "SESSION_REFRESH_FAILED");
  } catch (error) {
    if (error instanceof CliError && error.code === "IDENTITY_PROVIDER_UNAVAILABLE") throw error;
    await deleteStoredSession(options, runtime);
    throw error;
  }
  const refreshed = sessionFromGrant(options, runtime, configuration, grant, session);
  try {
    await currentPrincipalForToken(options, runtime, refreshed.accessToken);
  } catch (error) {
    await deleteStoredSession(options, runtime);
    throw error;
  }
  await saveStoredSession(options, runtime, refreshed);
  return refreshed;
}

async function usableStoredSession(
  options: ConnectionOptions,
  runtime: CliRuntime,
  publicConfiguration: unknown,
): Promise<StoredCliSession | undefined> {
  const session = await loadStoredSession(options, runtime);
  if (!session) return undefined;
  if (session.expiresAt > Math.floor(runtime.now().getTime() / 1_000) + 60) return session;
  return refreshStoredSession(options, runtime, cliOidcConfiguration(publicConfiguration), session);
}

async function runLogin(
  args: readonly string[],
  connection: ConnectionOptions,
  runtime: CliRuntime,
): Promise<void> {
  const configuration = cliOidcConfiguration(
    await publicAuthenticationConfiguration(connection, runtime),
  );
  const authorization = createAuthorizationRequest(configuration);
  let callback: LoopbackCallback;
  try {
    callback = await runtime.startOAuthCallback(configuration.redirectUri, authorization.state, 300_000);
  } catch (error) {
    throw asCliAuthenticationError(error);
  }
  output(runtime, {
    ok: true,
    status: "waiting_for_browser",
    authorizationUrl: authorization.authorizationUrl,
    callback: configuration.redirectUri,
  });
  if (!args.includes("--no-browser")) await runtime.openBrowser(authorization.authorizationUrl);
  let code: string;
  try {
    code = await callback.waitForCode;
  } catch (error) {
    throw asCliAuthenticationError(error);
  } finally {
    await callback.close().catch(() => undefined);
  }
  const grant = await requestToken(configuration, runtime, new URLSearchParams({
    grant_type: "authorization_code",
    client_id: configuration.clientId,
    code,
    code_verifier: authorization.verifier,
    redirect_uri: configuration.redirectUri,
  }), "LOGIN_EXCHANGE_FAILED");
  const session = sessionFromGrant(connection, runtime, configuration, grant);
  const principal = await currentPrincipalForToken(connection, runtime, session.accessToken);
  await saveStoredSession(connection, runtime, session);
  output(runtime, {
    ok: true,
    status: "authenticated",
    apiUrl: connection.apiUrl,
    principal: {
      id: principal.id,
      displayName: principal.displayName,
      organizationId: principal.organizationId,
      roles: principal.roles,
    },
    expiresAt: new Date(session.expiresAt * 1_000).toISOString(),
    refreshAvailable: Boolean(session.refreshToken),
    credentialStore: runtime.credentialStore.kind,
  });
}

async function runAuthStatus(
  connection: ConnectionOptions,
  runtime: CliRuntime,
): Promise<void> {
  const publicConfiguration = await publicAuthenticationConfiguration(connection, runtime);
  if (publicConfiguration.mode === "development") {
    output(runtime, {
      ok: true,
      mode: "development",
      authenticated: true,
      principalId: connection.principalId,
      credentialStore: "not_used",
    });
    return;
  }
  let configuration: CliOidcConfiguration;
  try {
    configuration = parseCliOidcConfiguration(publicConfiguration);
  } catch (error) {
    if (error instanceof CliAuthenticationError && error.code === "CLI_AUTH_NOT_CONFIGURED") {
      output(runtime, { ok: true, mode: "oidc", configured: false, authenticated: false, loginRequired: true });
      return;
    }
    throw asCliAuthenticationError(error);
  }
  let session: StoredCliSession | undefined;
  try {
    session = await loadStoredSession(connection, runtime);
  } catch (error) {
    if (error instanceof CliError && error.code === "INVALID_SESSION") {
      await deleteStoredSession(connection, runtime);
      output(runtime, {
        ok: true,
        mode: "oidc",
        configured: true,
        authenticated: false,
        loginRequired: true,
        invalidSessionRemoved: true,
        credentialStore: runtime.credentialStore.kind,
      });
      return;
    }
    throw error;
  }
  if (!session) {
    output(runtime, {
      ok: true,
      mode: "oidc",
      configured: true,
      authenticated: false,
      loginRequired: true,
      credentialStore: runtime.credentialStore.kind,
    });
    return;
  }
  if (session.expiresAt <= Math.floor(runtime.now().getTime() / 1_000) + 60) {
    try {
      session = await refreshStoredSession(connection, runtime, configuration, session);
    } catch (error) {
      if (error instanceof CliError && error.code !== "IDENTITY_PROVIDER_UNAVAILABLE") {
        output(runtime, {
          ok: true,
          mode: "oidc",
          configured: true,
          authenticated: false,
          loginRequired: true,
          credentialStore: runtime.credentialStore.kind,
        });
        return;
      }
      throw error;
    }
  }
  let principal: Readonly<Record<string, unknown>>;
  try {
    principal = await currentPrincipalForToken(connection, runtime, session.accessToken);
  } catch (error) {
    if (error instanceof CliError && error.code === "SESSION_VALIDATION_FAILED") {
      await deleteStoredSession(connection, runtime);
      output(runtime, {
        ok: true,
        mode: "oidc",
        configured: true,
        authenticated: false,
        loginRequired: true,
        invalidSessionRemoved: true,
        credentialStore: runtime.credentialStore.kind,
      });
      return;
    }
    throw error;
  }
  output(runtime, {
    ok: true,
    mode: "oidc",
    configured: true,
    authenticated: true,
    principal: {
      id: principal.id,
      displayName: principal.displayName,
      organizationId: principal.organizationId,
      roles: principal.roles,
    },
    expiresAt: new Date(session.expiresAt * 1_000).toISOString(),
    refreshAvailable: Boolean(session.refreshToken),
    credentialStore: runtime.credentialStore.kind,
  });
}

async function runLogout(
  connection: ConnectionOptions,
  runtime: CliRuntime,
): Promise<void> {
  const publicConfiguration = await publicAuthenticationConfiguration(connection, runtime);
  if (publicConfiguration.mode === "development") {
    output(runtime, { ok: true, mode: "development", deleted: false, remoteRevoked: false });
    return;
  }
  let session: StoredCliSession | undefined;
  let invalidSessionRemoved = false;
  try {
    session = await loadStoredSession(connection, runtime);
  } catch (error) {
    if (!(error instanceof CliError) || error.code !== "INVALID_SESSION") throw error;
    await deleteStoredSession(connection, runtime);
    invalidSessionRemoved = true;
  }
  let remoteRevoked = false;
  if (session?.refreshToken) {
    try {
      const configuration = parseCliOidcConfiguration(publicConfiguration);
      const response = await runtime.fetch(configuration.revocationEndpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: configuration.clientId,
          token: session.refreshToken,
          token_type_hint: "refresh_token",
        }),
      });
      remoteRevoked = response.ok;
    } catch {
      remoteRevoked = false;
    }
  }
  const deleted = invalidSessionRemoved || await deleteStoredSession(connection, runtime);
  output(runtime, {
    ok: true,
    mode: "oidc",
    deleted,
    remoteRevoked,
    invalidSessionRemoved,
    credentialStore: runtime.credentialStore.kind,
  });
}

type ServiceIdentityType = "agent" | "ci" | "integration";
type ServiceCapabilityScope = "bridge:read" | "bridge:write" | "bridge:admin";

function parseServiceIdentityType(value: string): ServiceIdentityType {
  if (value !== "agent" && value !== "ci" && value !== "integration") {
    throw new CliError(
      "INVALID_SERVICE_IDENTITY_TYPE",
      "--type must be agent, ci, or integration.",
      cliExitCodes.usage,
    );
  }
  return value;
}

function parseServiceScopes(args: readonly string[]): readonly ServiceCapabilityScope[] {
  const supported = new Set<ServiceCapabilityScope>(["bridge:read", "bridge:write", "bridge:admin"]);
  const values = commaSeparatedOptionValues(args, "--scope");
  if (values.length === 0) {
    throw new CliError(
      "SERVICE_SCOPES_REQUIRED",
      "service identity create requires at least one --scope (bridge:read, bridge:write, or bridge:admin).",
      cliExitCodes.usage,
    );
  }
  for (const value of values) {
    if (!supported.has(value as ServiceCapabilityScope)) {
      throw new CliError(
        "INVALID_SERVICE_SCOPE",
        "--scope values must be bridge:read, bridge:write, or bridge:admin.",
        cliExitCodes.usage,
      );
    }
  }
  return [...new Set(values)] as ServiceCapabilityScope[];
}

function parseServiceProjectMemberships(args: readonly string[]): readonly {
  readonly projectId: string;
  readonly roles: readonly string[];
}[] {
  return optionValues(args, "--project").map((value) => {
    const separator = value.indexOf("=");
    const projectId = (separator < 0 ? value : value.slice(0, separator)).trim();
    const rolesValue = separator < 0 ? "" : value.slice(separator + 1);
    const roles = rolesValue
      .split(",")
      .map((role) => role.trim())
      .filter(Boolean);
    if (!projectId) {
      throw new CliError(
        "INVALID_SERVICE_PROJECT",
        "Each --project value must include a project ID, optionally followed by =role,role.",
        cliExitCodes.usage,
      );
    }
    return { projectId, roles };
  });
}

function parseServiceExpiry(args: readonly string[]): string | undefined {
  const value = optionValue(args, "--expires-at")?.trim();
  if (!value) return undefined;
  if (!Number.isFinite(Date.parse(value)) || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new CliError(
      "INVALID_SERVICE_EXPIRY",
      "--expires-at must be an ISO-8601 datetime with a timezone offset.",
      cliExitCodes.usage,
    );
  }
  return value;
}

async function runServiceIdentityCommand(
  args: readonly string[],
  connection: ConnectionOptions,
  runtime: CliRuntime,
): Promise<void> {
  const action = args[2];
  if (action === "list") {
    output(runtime, await bridgeFetch(
      "/v1/admin/organization/service-identities",
      connection,
      runtime,
    ));
    return;
  }

  if (action === "create") {
    const name = requiredOptionValue(
      args,
      "--name",
      "service identity create requires --name.",
    );
    if (name.length < 2 || name.length > 120) {
      throw new CliError(
        "INVALID_SERVICE_NAME",
        "--name must contain between 2 and 120 characters.",
        cliExitCodes.usage,
      );
    }
    const type = parseServiceIdentityType(requiredOptionValue(
      args,
      "--type",
      "service identity create requires --type.",
    ));
    const roles = commaSeparatedOptionValues(args, "--role");
    const projectMemberships = parseServiceProjectMemberships(args);
    const expiresAt = parseServiceExpiry(args);
    const registration = await bridgeFetch(
      "/v1/admin/organization/service-identities",
      connection,
      runtime,
      {
        method: "POST",
        body: JSON.stringify({
          name,
          type,
          roles,
          allProjects: args.includes("--all-projects"),
          projectMemberships,
          scopes: parseServiceScopes(args),
          ...(expiresAt ? { expiresAt } : {}),
        }),
      },
    );
    const record = asRecord(registration);
    if (!record || typeof record.token !== "string" || !asRecord(record.serviceIdentity)) {
      throw new CliError(
        "INVALID_SERVICE_RESPONSE",
        "Bridge returned an invalid service-identity registration response.",
        cliExitCodes.connection,
      );
    }
    output(runtime, {
      ...record,
      tokenNotice: "Store this token now; Bridge will not show it again.",
    });
    return;
  }

  if (action === "revoke") {
    const serviceCredentialId = firstPositional(args, 3);
    const expectedVersion = Number(optionValue(args, "--version"));
    if (!serviceCredentialId || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      throw new CliError(
        "SERVICE_REVOCATION_REQUIRED",
        "service identity revoke requires a credential ID and positive --version.",
        cliExitCodes.usage,
      );
    }
    output(runtime, await bridgeFetch(
      `/v1/admin/organization/service-identities/${encodeURIComponent(serviceCredentialId)}/revoke`,
      connection,
      runtime,
      { method: "POST", body: JSON.stringify({ expectedVersion }) },
    ));
    return;
  }

  if (action === "rotate") {
    const serviceCredentialId = firstPositional(args, 3);
    const expectedVersion = Number(optionValue(args, "--version"));
    if (!serviceCredentialId || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      throw new CliError(
        "SERVICE_ROTATION_REQUIRED",
        "service identity rotate requires a credential ID and positive --version.",
        cliExitCodes.usage,
      );
    }
    const registration = await bridgeFetch(
      `/v1/admin/organization/service-identities/${encodeURIComponent(serviceCredentialId)}/rotate`,
      connection,
      runtime,
      { method: "POST", body: JSON.stringify({ expectedVersion }) },
    );
    const record = asRecord(registration);
    if (!record || typeof record.token !== "string" || !asRecord(record.serviceIdentity)) {
      throw new CliError(
        "INVALID_SERVICE_RESPONSE",
        "Bridge returned an invalid service-identity rotation response.",
        cliExitCodes.connection,
      );
    }
    output(runtime, {
      ...record,
      tokenNotice: "Store this token now; Bridge will not show it again.",
    });
    return;
  }

  throw new CliError(
    "UNKNOWN_SERVICE_IDENTITY_COMMAND",
    "Use `bridge service identity list`, `create`, `rotate`, or `revoke`.",
    cliExitCodes.usage,
  );
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

Command invocation: use \`bridge\` when the CLI is installed globally. When it is installed as this repository's pnpm development dependency, replace \`bridge\` in every command below with \`pnpm exec bridge\`. If pnpm refuses to execute because unrelated application dependencies have unapproved install scripts, invoke \`./node_modules/.bin/bridge\` directly; this is the same repository-installed CLI and does not require reinstalling dependencies.

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
11. After routing questions and publishing the required specifications, run \`bridge conformance --task "<current task>" --run-id <run-id>\` and fix every failed observable check.
12. Before claiming completion, verify required specifications were published and report the run using \`bridge run report <run-id> --status completed --version <version> --summary "<outcome>"\`.
13. Run \`bridge sync --task "<current task>" --run-id <run-id>\` when the agent cannot make outbound calls; read \`.bridge/context.md\` afterward.
14. Use \`bridge spec pull\` to materialize only human-approved specification versions.

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

interface PlannedMcpConfig {
  readonly path: string;
  readonly content: string;
}

const mcpConfigMarker = "x-bridge";

function clientMcpConfigPath(cwd: string, client: AgentClient): string | undefined {
  if (client === "codex") return resolve(cwd, ".codex", "config.toml");
  if (client === "claude_code") return resolve(cwd, ".mcp.json");
  return undefined;
}

function isManagedMcpMarker(value: unknown): boolean {
  const marker = asRecord(value);
  return marker?.managedBy === "bridge-cli" && marker.version === 1;
}

function parseMcpJsonConfig(current: string, path: string): Record<string, unknown> {
  if (!current.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(current);
  } catch (error) {
    throw new CliError(
      "INVALID_MCP_CONFIG",
      `${path.slice(1)} is not valid JSON; Bridge will not overwrite it.`,
      cliExitCodes.configuration,
      { path, cause: error instanceof Error ? error.message : String(error) },
    );
  }
  if (!asRecord(parsed) || Array.isArray(parsed)) {
    throw new CliError(
      "INVALID_MCP_CONFIG",
      `${path.slice(1)} must contain a JSON object; Bridge will not overwrite it.`,
      cliExitCodes.configuration,
      { path },
    );
  }
  return { ...(parsed as Record<string, unknown>) };
}

function mergeClaudeMcpConfigContent(current: string, path: string, mcpUrl: string): string {
  const document = parseMcpJsonConfig(current, path);
  if (document[mcpConfigMarker] !== undefined && !isManagedMcpMarker(document[mcpConfigMarker])) {
    throw new CliError(
      "MCP_CONFIG_CONFLICT",
      `${path.slice(1)} contains an unrelated ${mcpConfigMarker} marker; Bridge will not overwrite it.`,
      cliExitCodes.conflict,
      { path },
    );
  }
  const existingServers = document.mcpServers;
  if (existingServers !== undefined && !asRecord(existingServers)) {
    throw new CliError(
      "INVALID_MCP_CONFIG",
      `${path.slice(1)} contains a non-object mcpServers value; Bridge will not overwrite it.`,
      cliExitCodes.configuration,
      { path },
    );
  }
  const servers = (existingServers ? { ...(existingServers as Record<string, unknown>) } : {});
  const existingBridge = servers.bridge;
  if (existingBridge !== undefined && !isManagedMcpMarker(asRecord(existingBridge)?.[mcpConfigMarker])) {
    throw new CliError(
      "MCP_CONFIG_CONFLICT",
      `${path.slice(1)} already defines an unrelated bridge MCP server; Bridge will not overwrite it.`,
      cliExitCodes.conflict,
      { path, server: "bridge" },
    );
  }
  document.mcpServers = {
    ...servers,
    bridge: {
      type: "http",
      url: mcpUrl,
      [mcpConfigMarker]: { managedBy: "bridge-cli", version: 1 },
    },
  };
  document[mcpConfigMarker] = { managedBy: "bridge-cli", version: 1 };
  return `${JSON.stringify(document, null, 2)}\n`;
}

const codexMcpBlockStart = "# bridge:mcp:start";
const codexMcpBlockEnd = "# bridge:mcp:end";

function mergeCodexMcpConfigContent(current: string, mcpUrl: string): string {
  const block = `${codexMcpBlockStart}\n# Generated by Bridge CLI. Safe to commit; do not place secrets here.\n# Bridge-managed MCP configuration version: 1\n[mcp_servers.bridge]\nurl = ${JSON.stringify(mcpUrl)}\n${codexMcpBlockEnd}`;
  const start = current.indexOf(codexMcpBlockStart);
  const end = current.indexOf(codexMcpBlockEnd);
  if (start >= 0 || end >= 0) {
    if (start < 0 || end < start) {
      throw new CliError(
        "INVALID_MCP_CONFIG",
        ".codex/config.toml contains an incomplete Bridge-managed MCP block.",
        cliExitCodes.configuration,
        { path: ".codex/config.toml" },
      );
    }
    return `${current.slice(0, start)}${block}${current.slice(end + codexMcpBlockEnd.length)}`;
  }
  if (/^\s*\[mcp_servers\.bridge\]\s*$/m.test(current)) {
    throw new CliError(
      "MCP_CONFIG_CONFLICT",
      ".codex/config.toml already defines an unrelated bridge MCP server; Bridge will not overwrite it.",
      cliExitCodes.conflict,
      { path: ".codex/config.toml", server: "bridge" },
    );
  }
  return current.trimEnd() ? `${current.trimEnd()}\n\n${block}\n` : `${block}\n`;
}

async function planMcpConfig(
  cwd: string,
  client: AgentClient,
  mcpUrl: string | undefined,
): Promise<PlannedMcpConfig | undefined> {
  const path = clientMcpConfigPath(cwd, client);
  if (!path || !mcpUrl) return undefined;
  const current = await exists(path) ? await readFile(path, "utf8") : "";
  return {
    path,
    content: client === "codex"
      ? mergeCodexMcpConfigContent(current, mcpUrl)
      : mergeClaudeMcpConfigContent(current, path, mcpUrl),
  };
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
  const yes = args.includes("--yes");
  const dryRun = args.includes("--dry-run");
  const interactive = args.includes("--interactive") || runtime.isInteractive;
  const existingConfig = await exists(paths.project)
    ? await loadProjectConfig(runtime.cwd)
    : undefined;
  if (!projectId && existingConfig && (dryRun || (!projectName && (force || interactive)))) {
    projectId = existingConfig.projectId;
  }
  const repository = requestedRepository ?? existingConfig?.repository ?? await detectRepositoryName(runtime.cwd);
  const client = parseAgentClient(requestedClient ?? existingConfig?.client);
  const requestedMcpUrl = optionValue(args, "--mcp-url");
  const mcpUrl = optionalHttpUrl(
    requestedMcpUrl ?? existingConfig?.mcpUrl,
    requestedMcpUrl ? "--mcp-url" : ".bridge/project.yaml mcp_url",
  );
  const apiUrl = (
    optionValue(args, "--api-url") ??
    runtime.environment.BRIDGE_API_URL ??
    existingConfig?.apiUrl ??
    "http://127.0.0.1:4000"
  ).replace(/\/$/, "");
  if (!projectId && !projectName && interactive) {
    projectId = (await selectAuthorizedProject(repository, apiUrl, args, runtime)).id;
  }
  if (!projectId && !projectName) {
    throw new CliError(
      "PROJECT_REQUIRED",
      "bridge init requires an existing project ID, --name, or an interactive project selection.",
      cliExitCodes.usage,
    );
  }
  const existing = (await Promise.all(Object.values(paths).map(async (path) => ({ path, exists: await exists(path) }))))
    .filter((entry) => entry.exists)
    .map((entry) => entry.path);
  const plannedProjectId = projectId ?? "<registered-project-id>";
  const plannedConfig: ProjectConfig = {
    version: 1,
    projectId: plannedProjectId,
    apiUrl,
    repository,
    client,
    ...(mcpUrl ? { mcpUrl } : {}),
  };
  const adapterPath = clientInstructionPath(runtime.cwd, client);
  const plannedChanges = await planInitializationFiles(runtime, paths, adapterPath, plannedConfig);
  if (existing.length > 0 && !dryRun) {
    if (!force && !yes && !interactive) {
      throw new CliError(
        "CONFIG_EXISTS",
        "Bridge configuration already exists. Use --force for an explicit update, or run interactively to review and confirm the file diff.",
        cliExitCodes.conflict,
        { paths: existing, changes: plannedChanges.filter((change) => change.action !== "unchanged") },
      );
    }
    if (interactive && !yes) await confirmInitializationChanges(runtime, plannedChanges);
  }
  let registrationDisposition: string | undefined;
  if (!projectId && projectName && !dryRun) {
    const registration = await bridgeFetch(
      "/v1/projects",
      {
        apiUrl,
        principalId: initializationPrincipal(args, runtime),
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
  let validatedProjectName: string | undefined;
  if (projectId) {
    validatedProjectName = await validateProjectMapping(projectId, apiUrl, args, runtime);
  }
  if (dryRun) {
    output(runtime, {
      ok: true,
      dryRun: true,
      projectId: projectId ?? null,
      projectName: validatedProjectName ?? projectName ?? null,
      repository,
      client,
      mcpUrl: mcpUrl ?? null,
      registrationDisposition: projectId ? "existing_project" : "would_register",
      mappingValidated: Boolean(projectId),
      changes: plannedChanges,
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
  const mcpConfig = await planMcpConfig(runtime.cwd, client, mcpUrl);
  if (mcpConfig) {
    await mkdir(dirname(mcpConfig.path), { recursive: true });
    await writeAtomic(mcpConfig.path, mcpConfig.content);
  }
  const adapterDisposition = await mergeClientInstructions(adapterPath);
  output(runtime, {
    ok: true,
    projectId,
    projectName: validatedProjectName ?? projectName ?? null,
    repository: config.repository,
    client,
    mcpUrl: config.mcpUrl ?? null,
    registrationDisposition: registrationDisposition ?? "existing_project",
    adapterDisposition,
    mappingValidated: true,
    changes: plannedChanges,
    files: [...Object.values(paths), adapterPath, ...(mcpConfig ? [mcpConfig.path] : [])]
      .map((path) => path.slice(runtime.cwd.length + 1)),
    next: `Open ${client} in this repository and give it a normal build request. The generated repository instructions activate Bridge automatically.`,
  });
}

function parseRepositoryProvider(value: string): string {
  const provider = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(provider) || provider.length > 50) {
    throw new CliError(
      "INVALID_REPOSITORY_PROVIDER",
      "--provider must contain only lowercase letters, numbers, dots, underscores, or hyphens.",
      cliExitCodes.usage,
    );
  }
  return provider;
}

async function runRepositoryCommand(
  args: readonly string[],
  config: ProjectConfig | undefined,
  connection: ConnectionOptions,
  runtime: CliRuntime,
): Promise<void> {
  const action = args[1];
  const projectId = requireProjectId(firstPositional(args, 2), config);
  if (action === "list") {
    output(
      runtime,
      await bridgeFetch(`/v1/projects/${encodeURIComponent(projectId)}/repositories`, connection, runtime),
    );
    return;
  }
  if (action === "link") {
    const provider = parseRepositoryProvider(
      requiredOptionValue(args, "--provider", "repository link requires --provider."),
    );
    const owner = requiredOptionValue(args, "--owner", "repository link requires --owner.");
    const name = requiredOptionValue(args, "--name", "repository link requires --name.");
    const canonicalUrl = optionalHttpUrl(
      requiredOptionValue(args, "--url", "repository link requires --url."),
      "--url",
    )!;
    const idempotencyKey = optionValue(args, "--idempotency-key") ??
      `repository-${createHash("sha256")
        .update(`${projectId}:${provider}:${owner}:${name}:${canonicalUrl}`)
        .digest("hex")
        .slice(0, 32)}`;
    output(
      runtime,
      await bridgeFetch(
        `/v1/projects/${encodeURIComponent(projectId)}/repositories`,
        connection,
        runtime,
        {
          method: "POST",
          body: JSON.stringify({ idempotencyKey, provider, owner, name, canonicalUrl }),
        },
      ),
    );
    return;
  }
  throw new CliError(
    "UNKNOWN_REPOSITORY_COMMAND",
    "Use `bridge repository list` or `bridge repository link`.",
    cliExitCodes.usage,
  );
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
  const mcpConfig = await planMcpConfig(runtime.cwd, client, config.mcpUrl);
  if (mcpConfig) await planFile(mcpConfig.path, mcpConfig.content);

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
  if (mcpConfig) {
    await mkdir(dirname(mcpConfig.path), { recursive: true });
    await writeAtomic(mcpConfig.path, mcpConfig.content);
  }
  const adapterDisposition = await mergeClientInstructions(adapterPath);
  output(runtime, {
    ok: true,
    projectId: config.projectId,
    previousClient: config.client,
    client,
    adapterDisposition,
    files: [...Object.values(paths), adapterPath, ...(mcpConfig ? [mcpConfig.path] : [])]
      .map((path) => relativePath(path)),
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
        "x-bridge-correlation-id": `cli_${randomUUID().replaceAll("-", "")}`,
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
  let diagnosticPersisted = false;
  try {
    await bridgeFetch(
      `/v1/projects/${encodeURIComponent(config.projectId)}/adapter-diagnostics`,
      connection,
      runtime,
      {
        method: "POST",
        body: JSON.stringify({
          client: config.client,
          capabilities: [
            ...(instructionReady ? ["instructions"] : []),
            "cli",
            ...(mcpStatus === "ready" ? ["mcp"] : []),
          ],
          mcpStatus,
          checks: checks.map(({ name, status }) => ({ name, status })),
        }),
      },
    );
    diagnosticPersisted = true;
    checks.push({
      name: "diagnostic-persistence",
      status: "pass",
      detail: "The bounded doctor result was recorded for the project support view.",
    });
  } catch (error) {
    checks.push({
      name: "diagnostic-persistence",
      status: "fail",
      detail: error instanceof CliError
        ? error.message
        : "The doctor result could not be recorded in Bridge.",
    });
  }
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
    diagnosticPersisted,
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

const conformanceSpecificationTypes = ["prd", "adr", "api_contract", "test_plan"] as const;

function normalizedWords(value: unknown): readonly string[] {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0 && !["a", "an", "the"].includes(word));
}

function taskMatches(candidate: unknown, expected: string): boolean {
  const candidateWords = new Set(normalizedWords(candidate));
  const expectedWords = normalizedWords(expected);
  return expectedWords.length > 0 && expectedWords.every((word) => candidateWords.has(word));
}

function nonEmptyArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value.filter((item) => item !== null && item !== undefined) : [];
}

function isMeaningfullyRoutedQuestion(value: unknown, runId: string): boolean {
  const question = asRecord(value);
  if (!question || question.runId !== runId || question.createdByType !== "agent") return false;
  const ownerCount = nonEmptyArray(question.ownerIds).length + nonEmptyArray(question.ownerRoles).length;
  const options = nonEmptyArray(question.options).map(asRecord).filter(Boolean);
  const recommendationKey = String(question.recommendationKey ?? "");
  const recommendationIsValid = recommendationKey.length > 0 &&
    options.some((option) => String(option?.key ?? "") === recommendationKey);
  const scope = asRecord(question.scope);
  const riskIsValid = ["low", "medium", "high", "protected"].includes(String(question.risk ?? ""));
  return String(question.title ?? "").trim().length >= 8 &&
    String(question.category ?? "").trim().length >= 2 &&
    String(question.context ?? "").trim().length >= 10 &&
    String(question.whyItMatters ?? "").trim().length >= 10 &&
    ownerCount > 0 &&
    options.length >= 2 &&
    recommendationIsValid &&
    riskIsValid &&
    Boolean(scope && Object.keys(scope).length > 0) &&
    question.blocking === true;
}

async function runConformance(
  args: readonly string[],
  config: ProjectConfig | undefined,
  connection: ConnectionOptions,
  runtime: CliRuntime,
): Promise<void> {
  const projectId = requireProjectId(firstPositional(args), config);
  const task = optionValue(args, "--task");
  if (!task) {
    throw new CliError(
      "TASK_REQUIRED",
      "conformance requires --task so the observed records can be tied to the independent-agent request.",
      cliExitCodes.usage,
    );
  }

  const [runsResponse, questionsResponse, artifactsResponse] = await Promise.all([
    bridgeFetch(`/v1/projects/${encodeURIComponent(projectId)}/runs`, connection, runtime),
    bridgeFetch(`/v1/projects/${encodeURIComponent(projectId)}/questions`, connection, runtime),
    bridgeFetch(`/v1/projects/${encodeURIComponent(projectId)}/artifacts`, connection, runtime),
  ]);
  const requestedRunId = optionValue(args, "--run-id");
  const matchingRuns = itemsFrom(runsResponse)
    .map(asRecord)
    .filter((run): run is Readonly<Record<string, unknown>> => Boolean(
      run &&
      (!requestedRunId || run.id === requestedRunId) &&
      taskMatches(run.taskSummary, task),
    ))
    .sort((left, right) => String(right.startedAt ?? "").localeCompare(String(left.startedAt ?? "")));
  const run = matchingRuns[0];
  const runId = String(run?.id ?? requestedRunId ?? "");
  const linkedQuestions = itemsFrom(questionsResponse).filter((question) => asRecord(question)?.runId === runId);
  const routedQuestions = linkedQuestions.filter((question) => isMeaningfullyRoutedQuestion(question, runId));
  const artifacts = itemsFrom(artifactsResponse).map(asRecord).filter(Boolean);
  const linkedSpecificationTypes = new Set<string>();
  const linkedVersionIds = new Set<string>();
  for (const artifact of artifacts) {
    if (!artifact) continue;
    const versions = nonEmptyArray(artifact.versions).map(asRecord).filter(Boolean);
    const linkedVersions = versions.filter((version) => version?.runId === runId && version.createdByType === "agent");
    if (linkedVersions.length > 0) {
      for (const version of linkedVersions) linkedVersionIds.add(String(version?.id ?? ""));
      linkedSpecificationTypes.add(String(artifact.type ?? ""));
    }
  }
  const missingSpecificationTypes = conformanceSpecificationTypes.filter(
    (type) => !linkedSpecificationTypes.has(type),
  );
  const runQuestionIds = nonEmptyArray(run?.questionIds).map(String);
  const runArtifactVersionIds = nonEmptyArray(run?.artifactVersionIds).map(String);
  const checks = [
    {
      name: "task-run",
      status: run ? "pass" : "fail",
      detail: run
        ? `Run ${runId} is linked to the requested task.`
        : requestedRunId
          ? `Run ${requestedRunId} was not found or its task summary does not match.`
          : "No run has a task summary matching the requested task.",
    },
    {
      name: "context-retrieval",
      status: nonEmptyArray(run?.contextSnapshotIds).length > 0 ? "pass" : "fail",
      detail: nonEmptyArray(run?.contextSnapshotIds).length > 0
        ? "The run retrieved and linked a Bridge context snapshot."
        : "The run has no linked context snapshot.",
    },
    {
      name: "routed-question",
      status: routedQuestions.length > 0 ? "pass" : "fail",
      detail: routedQuestions.length > 0
        ? `${routedQuestions.length} agent-created blocking question(s) include owners, options, recommendation, risk context, scope, and run provenance.`
        : "No agent-created blocking question has complete routing, options, recommendation, scope, and run provenance.",
    },
    {
      name: "run-question-link",
      status: routedQuestions.some((question) => runQuestionIds.includes(String(asRecord(question)?.id ?? "")))
        ? "pass"
        : "fail",
      detail: routedQuestions.some((question) => runQuestionIds.includes(String(asRecord(question)?.id ?? "")))
        ? "The conforming question appears in the run's questionIds."
        : "The conforming question must also appear in the run's questionIds.",
    },
    {
      name: "required-specifications",
      status: missingSpecificationTypes.length === 0 ? "pass" : "fail",
      detail: missingSpecificationTypes.length === 0
        ? "PRD, ADR, API contract, and test plan have agent-created versions linked to the run."
        : `Missing run-linked specification types: ${missingSpecificationTypes.join(", ")}.`,
    },
    {
      name: "run-specification-links",
      status: [...linkedVersionIds].filter((versionId) => runArtifactVersionIds.includes(versionId)).length >=
        conformanceSpecificationTypes.length
        ? "pass"
        : "fail",
      detail: [...linkedVersionIds].filter((versionId) => runArtifactVersionIds.includes(versionId)).length >=
        conformanceSpecificationTypes.length
        ? "The run links all four observed agent-created specification versions."
        : "The run must link at least four observed agent-created specification versions.",
    },
    {
      name: "human-boundary",
      status: ["waiting_for_human", "completed"].includes(String(run?.status ?? "")) ? "pass" : "fail",
      detail: run?.status === "waiting_for_human"
        ? "The run is waiting at the human decision boundary."
        : run?.status === "completed"
          ? "The run completed after its Bridge workflow."
          : `The run status is ${String(run?.status ?? "missing")}; expected waiting_for_human or completed.`,
    },
  ] as const;
  const ok = checks.every((check) => check.status === "pass");
  const result = {
    ok,
    projectId,
    task,
    runId: run?.id ?? null,
    client: run?.client ?? null,
    runStatus: run?.status ?? null,
    routedQuestionIds: routedQuestions.map((question) => asRecord(question)?.id),
    linkedSpecificationTypes: [...linkedSpecificationTypes].sort(),
    checks,
    limitation: "This verifies observable Bridge records. It cannot detect a vendor-native clarification prompt that the vendor does not expose.",
  };
  output(runtime, result);
  if (!ok) {
    throw new CliError(
      "CONFORMANCE_FAILED",
      "Independent-agent conformance evidence is incomplete.",
      cliExitCodes.pending,
      { projectId, runId: run?.id ?? null, failedChecks: checks.filter((check) => check.status === "fail") },
    );
  }
}

async function executeCli(args: readonly string[], runtime: CliRuntime): Promise<void> {
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    runtime.stdout(`${usage()}\n`);
    return;
  }

  const requestedOutput = optionValue(args, "--output") ?? "json";
  if (requestedOutput !== "json" && requestedOutput !== "human") {
    throw new CliError(
      "INVALID_OUTPUT_MODE",
      "--output must be json or human.",
      cliExitCodes.usage,
    );
  }
  runtime = { ...runtime, outputMode: requestedOutput };

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

  if (command === "login") {
    await runLogin(args, connection, runtime);
    return;
  }

  if (command === "logout") {
    await runLogout(connection, runtime);
    return;
  }

  if (command === "auth") {
    if (args[1] !== "status") {
      throw new CliError("UNKNOWN_AUTH_COMMAND", "Use `bridge auth status`.", cliExitCodes.usage);
    }
    await runAuthStatus(connection, runtime);
    return;
  }

  if (command === "service") {
    if (args[1] !== "identity") {
      throw new CliError(
        "UNKNOWN_SERVICE_COMMAND",
        "Use `bridge service identity list`, `create`, `rotate`, or `revoke`.",
        cliExitCodes.usage,
      );
    }
    await runServiceIdentityCommand(args, connection, runtime);
    return;
  }

  if (command === "repository") {
    await runRepositoryCommand(args, config, connection, runtime);
    return;
  }

  if (command === "doctor") {
    await runDoctor(config, connection, runtime);
    return;
  }

  if (command === "conformance") {
    await runConformance(args, config, connection, runtime);
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
              ...(args.includes("--create-decision") ? { createDecision: true } : {}),
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
    const cliError = error instanceof CliError || error instanceof CliAuthenticationError
      ? asCliAuthenticationError(error)
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

export async function isCliEntrypoint(
  executablePath: string | undefined = process.argv[1],
  moduleUrl: string = import.meta.url,
): Promise<boolean> {
  if (!executablePath) return false;
  try {
    return await realpath(executablePath) === await realpath(new URL(moduleUrl));
  } catch {
    return moduleUrl === pathToFileURL(executablePath).href;
  }
}

if (await isCliEntrypoint()) {
  process.exitCode = await runCli(process.argv.slice(2));
}
