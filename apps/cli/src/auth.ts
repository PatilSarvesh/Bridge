import { spawn } from "node:child_process";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";

export const cliCredentialService = "dev.bridge.cli.oauth";

export interface CliOidcConfiguration {
  readonly mode: "oidc";
  readonly clientId: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly revocationEndpoint: string;
  readonly audience: string;
  readonly redirectUri: string;
  readonly scopes: readonly string[];
  readonly organization?: string;
}

export interface StoredCliSession {
  readonly version: 1;
  readonly apiUrl: string;
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly expiresAt: number;
  readonly scopes: readonly string[];
  readonly obtainedAt: string;
}

export interface CredentialStore {
  readonly kind: string;
  get(account: string): Promise<string | undefined>;
  set(account: string, secret: string): Promise<void>;
  delete(account: string): Promise<boolean>;
}

export interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
}

export type CommandRunner = (
  executable: string,
  args: readonly string[],
  stdin?: string,
) => Promise<CommandResult>;

export interface LoopbackCallback {
  readonly waitForCode: Promise<string>;
  close(): Promise<void>;
}

export class CliAuthenticationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CliAuthenticationError";
  }
}

const maximumCommandOutputBytes = 128 * 1024;
const maximumCredentialBytes = 64 * 1024;
const defaultScopes = ["openid", "profile", "email", "offline_access"] as const;

export const runCredentialCommand: CommandRunner = (executable, args, stdin) =>
  new Promise((resolve, reject) => {
    const child = spawn(executable, [...args], {
      shell: false,
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    let outputBytes = 0;
    child.stdout.on("data", (chunk: Buffer | string) => {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      outputBytes += value.length;
      if (outputBytes <= maximumCommandOutputBytes) stdout.push(value);
    });
    child.once("error", () => reject(new CliAuthenticationError(
      "CREDENTIAL_STORE_UNAVAILABLE",
      "The operating-system credential store is unavailable.",
    )));
    child.once("close", (exitCode) => resolve({
      exitCode: exitCode ?? 1,
      stdout: Buffer.concat(stdout).toString("utf8"),
    }));
    if (stdin !== undefined) child.stdin.end(stdin);
    else child.stdin.end();
  });

function credentialAccount(apiUrl: string): string {
  const parsed = new URL(apiUrl);
  const path = parsed.pathname.replace(/\/+$/, "");
  return `${parsed.origin}${path}`;
}

class MacOsCredentialStore implements CredentialStore {
  readonly kind = "macos-keychain";

  constructor(private readonly runner: CommandRunner) {}

  async get(account: string): Promise<string | undefined> {
    const result = await this.runner("/usr/bin/security", [
      "find-generic-password",
      "-a",
      credentialAccount(account),
      "-s",
      cliCredentialService,
      "-w",
    ]);
    if (result.exitCode === 44) return undefined;
    if (result.exitCode !== 0) throw credentialStoreFailure();
    return result.stdout.replace(/\r?\n$/, "");
  }

  async set(account: string, secret: string): Promise<void> {
    assertCredentialSize(secret);
    const result = await this.runner("/usr/bin/security", [
      "add-generic-password",
      "-U",
      "-a",
      credentialAccount(account),
      "-s",
      cliCredentialService,
      "-l",
      "Bridge CLI OAuth session",
      "-w",
    ], `${secret}\n`);
    if (result.exitCode !== 0) throw credentialStoreFailure();
  }

  async delete(account: string): Promise<boolean> {
    const result = await this.runner("/usr/bin/security", [
      "delete-generic-password",
      "-a",
      credentialAccount(account),
      "-s",
      cliCredentialService,
    ]);
    if (result.exitCode === 44) return false;
    if (result.exitCode !== 0) throw credentialStoreFailure();
    return true;
  }
}

class LinuxCredentialStore implements CredentialStore {
  readonly kind = "linux-secret-service";

  constructor(private readonly runner: CommandRunner) {}

  async get(account: string): Promise<string | undefined> {
    const result = await this.runner("secret-tool", [
      "lookup",
      "service",
      cliCredentialService,
      "account",
      credentialAccount(account),
    ]);
    if (result.exitCode === 1) return undefined;
    if (result.exitCode !== 0) throw credentialStoreFailure();
    return result.stdout.replace(/\r?\n$/, "");
  }

  async set(account: string, secret: string): Promise<void> {
    assertCredentialSize(secret);
    const result = await this.runner("secret-tool", [
      "store",
      "--label=Bridge CLI OAuth session",
      "service",
      cliCredentialService,
      "account",
      credentialAccount(account),
    ], secret);
    if (result.exitCode !== 0) throw credentialStoreFailure();
  }

  async delete(account: string): Promise<boolean> {
    const existing = await this.get(account);
    if (existing === undefined) return false;
    const result = await this.runner("secret-tool", [
      "clear",
      "service",
      cliCredentialService,
      "account",
      credentialAccount(account),
    ]);
    if (result.exitCode !== 0) throw credentialStoreFailure();
    return true;
  }
}

class UnsupportedCredentialStore implements CredentialStore {
  readonly kind = "unsupported";

  async get(): Promise<string | undefined> {
    throw unsupportedCredentialStore();
  }

  async set(): Promise<void> {
    throw unsupportedCredentialStore();
  }

  async delete(): Promise<boolean> {
    throw unsupportedCredentialStore();
  }
}

export function createSystemCredentialStore(
  platform: NodeJS.Platform = process.platform,
  runner: CommandRunner = runCredentialCommand,
): CredentialStore {
  if (platform === "darwin") return new MacOsCredentialStore(runner);
  if (platform === "linux") return new LinuxCredentialStore(runner);
  return new UnsupportedCredentialStore();
}

function credentialStoreFailure(): CliAuthenticationError {
  return new CliAuthenticationError(
    "CREDENTIAL_STORE_FAILED",
    "The operating-system credential store could not complete the request.",
  );
}

function unsupportedCredentialStore(): CliAuthenticationError {
  return new CliAuthenticationError(
    "CREDENTIAL_STORE_UNSUPPORTED",
    "This Bridge build supports macOS Keychain and Linux Secret Service credential storage.",
  );
}

function assertCredentialSize(secret: string): void {
  if (Buffer.byteLength(secret, "utf8") > maximumCredentialBytes) {
    throw new CliAuthenticationError("INVALID_SESSION", "The authentication session is too large to store safely.");
  }
}

function requiredString(record: Readonly<Record<string, unknown>>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 2_048) {
    throw new CliAuthenticationError(
      "CLI_AUTH_NOT_CONFIGURED",
      "This Bridge API has not configured public-client authentication for the CLI.",
    );
  }
  return value.trim();
}

function secureEndpoint(value: string, label: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new CliAuthenticationError("INVALID_AUTH_CONFIGURATION", `${label} is not a valid URL.`);
  }
  if (parsed.protocol !== "https:") {
    throw new CliAuthenticationError("INVALID_AUTH_CONFIGURATION", `${label} must use HTTPS.`);
  }
  return parsed.toString();
}

export function parseCliOidcConfiguration(value: unknown): CliOidcConfiguration {
  if (typeof value !== "object" || value === null) {
    throw new CliAuthenticationError("INVALID_AUTH_CONFIGURATION", "Bridge returned invalid authentication configuration.");
  }
  const record = value as Readonly<Record<string, unknown>>;
  if (record.mode !== "oidc") {
    throw new CliAuthenticationError("CLI_AUTH_NOT_CONFIGURED", "This Bridge API is running in development mode.");
  }
  const redirectUri = validateLoopbackRedirectUri(requiredString(record, "cliRedirectUri")).toString();
  const scopeValue = typeof record.cliScopes === "string" ? record.cliScopes.trim() : "";
  const scopes = [...new Set((scopeValue ? scopeValue.split(/\s+/) : defaultScopes).filter(Boolean))];
  if (scopes.length > 50 || scopes.some((scope) => scope.length > 200)) {
    throw new CliAuthenticationError("INVALID_AUTH_CONFIGURATION", "The CLI OAuth scope configuration is invalid.");
  }
  return {
    mode: "oidc",
    clientId: requiredString(record, "cliClientId"),
    authorizationEndpoint: secureEndpoint(
      requiredString(record, "cliAuthorizationEndpoint"),
      "The CLI authorization endpoint",
    ),
    tokenEndpoint: secureEndpoint(requiredString(record, "cliTokenEndpoint"), "The CLI token endpoint"),
    revocationEndpoint: secureEndpoint(
      requiredString(record, "cliRevocationEndpoint"),
      "The CLI revocation endpoint",
    ),
    audience: requiredString(record, "cliAudience"),
    redirectUri,
    scopes,
    ...(typeof record.cliOrganization === "string" && record.cliOrganization.trim() && record.cliOrganization.length <= 300
      ? { organization: record.cliOrganization.trim() }
      : {}),
  };
}

export function validateLoopbackRedirectUri(value: string): URL {
  let redirect: URL;
  try {
    redirect = new URL(value);
  } catch {
    throw new CliAuthenticationError("INVALID_AUTH_CONFIGURATION", "The CLI redirect URI is invalid.");
  }
  if (
    redirect.protocol !== "http:" ||
    redirect.hostname !== "127.0.0.1" ||
    !redirect.port ||
    Number(redirect.port) < 1 ||
    Number(redirect.port) > 65_535 ||
    redirect.username ||
    redirect.password ||
    redirect.search ||
    redirect.hash
  ) {
    throw new CliAuthenticationError(
      "INVALID_AUTH_CONFIGURATION",
      "The CLI redirect URI must be an explicit http://127.0.0.1:<port>/<path> loopback URL.",
    );
  }
  return redirect;
}

export function createAuthorizationRequest(configuration: CliOidcConfiguration): {
  readonly authorizationUrl: string;
  readonly verifier: string;
  readonly state: string;
} {
  const verifier = randomBytes(48).toString("base64url");
  const state = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const authorization = new URL(configuration.authorizationEndpoint);
  authorization.search = new URLSearchParams({
    response_type: "code",
    client_id: configuration.clientId,
    redirect_uri: configuration.redirectUri,
    audience: configuration.audience,
    scope: configuration.scopes.join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    ...(configuration.organization ? { organization: configuration.organization } : {}),
  }).toString();
  return { authorizationUrl: authorization.toString(), verifier, state };
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function callbackPage(success: boolean): string {
  const title = success ? "Bridge sign-in complete" : "Bridge sign-in failed";
  const detail = success
    ? "You can close this window and return to the terminal."
    : "Return to the terminal and try signing in again.";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>${title}</title></head><body><main><h1>${title}</h1><p>${detail}</p></main></body></html>`;
}

export async function startLoopbackCallback(
  redirectUri: string,
  expectedState: string,
  timeoutMilliseconds = 300_000,
): Promise<LoopbackCallback> {
  const redirect = validateLoopbackRedirectUri(redirectUri);
  const port = Number(redirect.port);
  let server: Server;
  let completed = false;
  let resolveCode!: (code: string) => void;
  let rejectCode!: (error: Error) => void;
  const waitForCode = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });
  const finish = (result: { readonly code: string } | { readonly error: Error }): void => {
    if (completed) return;
    completed = true;
    clearTimeout(timeout);
    server.close(() => {
      if ("code" in result) resolveCode(result.code);
      else rejectCode(result.error);
    });
  };
  server = createServer((request, response) => {
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.setHeader("cache-control", "no-store");
    response.setHeader("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'");
    response.setHeader("referrer-policy", "no-referrer");
    if (request.method !== "GET") {
      response.writeHead(405, { allow: "GET" }).end(callbackPage(false));
      return;
    }
    let callback: URL;
    try {
      callback = new URL(request.url ?? "/", redirect.origin);
    } catch {
      response.writeHead(400).end(callbackPage(false));
      return;
    }
    if (callback.pathname !== redirect.pathname) {
      response.writeHead(404).end(callbackPage(false));
      return;
    }
    const state = callback.searchParams.get("state");
    if (!state || !safeEqual(state, expectedState)) {
      response.writeHead(400).end(callbackPage(false));
      return;
    }
    const providerError = callback.searchParams.get("error");
    if (providerError) {
      response.writeHead(401).end(callbackPage(false));
      finish({ error: new CliAuthenticationError("LOGIN_REJECTED", "The identity provider did not complete sign-in.") });
      return;
    }
    const code = callback.searchParams.get("code");
    if (!code || code.length > 4_096) {
      response.writeHead(400).end(callbackPage(false));
      return;
    }
    response.writeHead(200).end(callbackPage(true));
    finish({ code });
  });
  const timeout = setTimeout(() => finish({
    error: new CliAuthenticationError("LOGIN_TIMEOUT", "Browser sign-in timed out before the callback arrived."),
  }), timeoutMilliseconds);
  timeout.unref();
  await new Promise<void>((resolve, reject) => {
    server.once("error", () => {
      completed = true;
      clearTimeout(timeout);
      reject(new CliAuthenticationError(
        "CALLBACK_UNAVAILABLE",
        `Bridge could not listen on the configured loopback callback port ${port}.`,
      ));
    });
    server.listen(port, "127.0.0.1", resolve);
  });
  return {
    waitForCode,
    close: async () => {
      if (completed) return;
      completed = true;
      clearTimeout(timeout);
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rejectCode(new CliAuthenticationError("LOGIN_CANCELLED", "Browser sign-in was cancelled."));
    },
  };
}

export async function openSystemBrowser(
  url: string,
  platform: NodeJS.Platform = process.platform,
  runner: CommandRunner = runCredentialCommand,
): Promise<boolean> {
  const command = platform === "darwin"
    ? { executable: "/usr/bin/open", args: [url] }
    : platform === "linux"
      ? { executable: "xdg-open", args: [url] }
      : undefined;
  if (!command) return false;
  try {
    return (await runner(command.executable, command.args)).exitCode === 0;
  } catch {
    return false;
  }
}

export function parseStoredSession(value: string, expectedApiUrl: string): StoredCliSession {
  assertCredentialSize(value);
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new CliAuthenticationError("INVALID_SESSION", "The stored CLI authentication session is invalid.");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new CliAuthenticationError("INVALID_SESSION", "The stored CLI authentication session is invalid.");
  }
  const record = parsed as Readonly<Record<string, unknown>>;
  if (
    record.version !== 1 ||
    record.apiUrl !== expectedApiUrl ||
    typeof record.accessToken !== "string" ||
    record.accessToken.length < 20 ||
    record.accessToken.length > 32_768 ||
    typeof record.expiresAt !== "number" ||
    !Number.isSafeInteger(record.expiresAt) ||
    record.expiresAt < 1 ||
    !Array.isArray(record.scopes) ||
    record.scopes.length > 50 ||
    !record.scopes.every((scope) => typeof scope === "string") ||
    record.scopes.some((scope) => typeof scope === "string" && scope.length > 200) ||
    typeof record.obtainedAt !== "string" ||
    !Number.isFinite(Date.parse(record.obtainedAt)) ||
    (record.refreshToken !== undefined && (
      typeof record.refreshToken !== "string" ||
      record.refreshToken.length < 20 ||
      record.refreshToken.length > 32_768
    ))
  ) {
    throw new CliAuthenticationError("INVALID_SESSION", "The stored CLI authentication session is invalid.");
  }
  return record as unknown as StoredCliSession;
}

export function serializeStoredSession(session: StoredCliSession): string {
  const value = JSON.stringify(session);
  assertCredentialSize(value);
  return value;
}
