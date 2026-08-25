import { spawn } from "node:child_process";
import { isAbsolute } from "node:path";

import type { OutboxEvent } from "@bridge/domain";

export interface CodexWorkspaceDirectory {
  resolveWorkspace(projectId: string): Promise<string | undefined>;
}

export interface CodexResumeRequest {
  readonly sessionId: string;
  readonly workspace: string;
  readonly prompt: string;
}

export interface CodexSessionResumer {
  resume(request: CodexResumeRequest): Promise<void>;
}

export interface CodexCliSessionResumerOptions {
  readonly executable?: string;
  readonly timeoutMs?: number;
}

export interface CodexContinuationHandlerOptions {
  readonly workspaces: CodexWorkspaceDirectory;
  readonly resumer: CodexSessionResumer;
}

const codexSessionIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validateProjectId(projectId: string): string {
  const normalized = projectId.trim();
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(normalized)) {
    throw new Error("Codex workspace mappings contain an invalid project ID.");
  }
  return normalized;
}

function validateWorkspace(workspace: string): string {
  const normalized = workspace.trim();
  if (!normalized || normalized.length > 1_000 || !isAbsolute(normalized) || normalized.includes("\0")) {
    throw new Error("Codex continuation workspaces must be absolute paths.");
  }
  return normalized;
}

function validateExecutable(executable: string): string {
  const normalized = executable.trim();
  if (
    !normalized ||
    normalized.length > 1_000 ||
    normalized.includes("\0") ||
    (!isAbsolute(normalized) && !/^[A-Za-z0-9._-]{1,100}$/.test(normalized))
  ) {
    throw new Error("The Codex executable must be an absolute path or a safe command name.");
  }
  return normalized;
}

function validateTimeout(timeoutMs: number): number {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 60 * 60 * 1_000) {
    throw new Error("The Codex continuation timeout must be between 1000 and 3600000 milliseconds.");
  }
  return timeoutMs;
}

function parseWorkspaceMapping(raw: string): ReadonlyMap<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("BRIDGE_CODEX_PROJECT_WORKSPACES must be valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("BRIDGE_CODEX_PROJECT_WORKSPACES must be a JSON object keyed by project ID.");
  }
  return new Map(Object.entries(parsed).map(([projectId, workspace]) => {
    if (typeof workspace !== "string") {
      throw new Error(`Codex workspace mapping for ${projectId} must be a path string.`);
    }
    return [validateProjectId(projectId), validateWorkspace(workspace)] as const;
  }));
}

export function createCodexWorkspaceDirectory(
  mapping: Readonly<Record<string, string>>,
): CodexWorkspaceDirectory {
  const workspaces = new Map(Object.entries(mapping).map(([projectId, workspace]) =>
    [validateProjectId(projectId), validateWorkspace(workspace)] as const));
  return {
    resolveWorkspace: async (projectId) => workspaces.get(projectId),
  };
}

export function createCodexWorkspaceDirectoryFromEnvironment(
  raw = process.env.BRIDGE_CODEX_PROJECT_WORKSPACES,
): CodexWorkspaceDirectory {
  if (!raw?.trim()) return createCodexWorkspaceDirectory({});
  const workspaces = parseWorkspaceMapping(raw);
  return {
    resolveWorkspace: async (projectId) => workspaces.get(projectId),
  };
}

export function createCodexCliSessionResumer(
  options: CodexCliSessionResumerOptions = {},
): CodexSessionResumer {
  const executable = validateExecutable(options.executable ?? "codex");
  const timeoutMs = validateTimeout(options.timeoutMs ?? 15 * 60 * 1_000);
  return {
    resume(request) {
      if (!codexSessionIdPattern.test(request.sessionId)) {
        return Promise.reject(new Error("The Codex continuation session ID is invalid."));
      }
      const workspace = validateWorkspace(request.workspace);
      return new Promise<void>((resolve, reject) => {
        const child = spawn(
          executable,
          ["exec", "resume", "--json", request.sessionId, request.prompt],
          { cwd: workspace, shell: false, stdio: "ignore" },
        );
        let timedOut = false;
        let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
        const timer = setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
          forceKillTimer = setTimeout(() => child.kill("SIGKILL"), 5_000);
        }, timeoutMs);
        child.once("error", () => {
          clearTimeout(timer);
          if (forceKillTimer) clearTimeout(forceKillTimer);
          reject(new Error("The Codex continuation process could not be started."));
        });
        child.once("exit", (code) => {
          clearTimeout(timer);
          if (forceKillTimer) clearTimeout(forceKillTimer);
          if (timedOut) {
            reject(new Error("The Codex continuation process timed out."));
          } else if (code === 0) {
            resolve();
          } else {
            reject(new Error("The Codex continuation process did not complete successfully."));
          }
        });
      });
    },
  };
}

export function codexContinuationPrompt(runId: string): string {
  if (!/^run_[A-Za-z0-9_-]{1,96}$/.test(runId)) {
    throw new Error("The Codex continuation run ID is invalid.");
  }
  return [
    `Bridge reports that every linked blocking question for run ${runId} has a human decision.`,
    "Use the Bridge continuation locator already retained in this session to re-check the canonical continuation state.",
    "Retrieve approved context through Bridge and continue only when Bridge reports canContinue=true.",
    "This signal contains no decision content and grants no approval authority.",
  ].join(" ");
}

export function createCodexContinuationHandler(
  options: CodexContinuationHandlerOptions,
): (event: OutboxEvent) => Promise<void> {
  return async (event) => {
    if (event.type !== "run.continuation_ready") return;
    if (
      !("runId" in event.payload) ||
      !("client" in event.payload) ||
      !("vendorSessionId" in event.payload) ||
      event.payload.client !== "codex" ||
      !codexSessionIdPattern.test(event.payload.vendorSessionId)
    ) {
      throw new Error("The Codex continuation outbox payload is invalid.");
    }
    const workspace = await options.workspaces.resolveWorkspace(event.projectId);
    if (!workspace) {
      throw new Error("No Codex continuation workspace is configured for this project.");
    }
    await options.resumer.resume({
      sessionId: event.payload.vendorSessionId,
      workspace,
      prompt: codexContinuationPrompt(event.payload.runId),
    });
  };
}
