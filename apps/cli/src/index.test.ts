import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { cliExitCodes, isCliEntrypoint, runCli, type CliRuntime } from "./index.js";

interface MockState {
  question: Record<string, unknown>;
  artifacts: Array<Record<string, unknown>>;
  artifactRequestBodies?: Array<Record<string, unknown>>;
  assumptions: Array<Record<string, unknown>>;
  projects?: Array<Record<string, unknown>>;
  serviceIdentities?: Array<Record<string, unknown>>;
  serviceRequestBodies?: Array<Record<string, unknown>>;
  repositories?: Array<Record<string, unknown>>;
  serviceToken?: string;
  rejectSecretWrites?: boolean;
  rejectProjectReads?: boolean;
  run?: Record<string, unknown>;
  mcpAvailable?: boolean;
  mcpMalformed?: boolean;
  diagnosticPersistenceAvailable?: boolean;
}

function mockBridge(state: MockState): CliRuntime["fetch"] {
  return async (input, init) => {
    const url = new URL(String(input));
    const json = (value: unknown, status = 200) =>
      new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
    if (url.pathname === "/health") return json({ status: "ok", service: "bridge-api" });
    if (url.pathname === "/v1/auth/config") return json({ mode: "development" });
    if (url.pathname === "/v1/admin/organization/service-identities" && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      state.serviceRequestBodies = [...(state.serviceRequestBodies ?? []), body];
      const serviceIdentity = {
        id: "scr_cli_1",
        principalId: "svc_cli_1",
        name: body.name,
        type: body.type,
        scopes: body.scopes,
        roles: body.roles,
        allProjects: body.allProjects,
        projectMemberships: body.projectMemberships,
        createdAt: "2026-08-11T00:00:00.000Z",
        expiresAt: body.expiresAt ?? "2026-11-09T00:00:00.000Z",
        version: 1,
      };
      state.serviceIdentities = [serviceIdentity];
      state.serviceToken ??= `brg_srv_${"a".repeat(43)}`;
      return json({ serviceIdentity, token: state.serviceToken }, 201);
    }
    if (url.pathname === "/v1/admin/organization/service-identities") {
      return json({ items: state.serviceIdentities ?? [] });
    }
    if (url.pathname.endsWith("/service-identities/scr_cli_1/rotate") && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      state.serviceRequestBodies = [...(state.serviceRequestBodies ?? []), body];
      const current = state.serviceIdentities?.[0] ?? { id: "scr_cli_1", version: 1 };
      state.serviceToken = `brg_srv_${"b".repeat(43)}`;
      const serviceIdentity = {
        ...current,
        version: 2,
        rotatedAt: "2026-08-11T00:01:00.000Z",
      };
      state.serviceIdentities = [serviceIdentity];
      return json({ serviceIdentity, token: state.serviceToken });
    }
    if (url.pathname.endsWith("/service-identities/scr_cli_1/revoke") && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      state.serviceRequestBodies = [...(state.serviceRequestBodies ?? []), body];
      const current = state.serviceIdentities?.[0] ?? { id: "scr_cli_1", version: 1 };
      return json({ ...current, version: 3, revokedAt: "2026-08-11T00:02:00.000Z" });
    }
    if (url.hostname === "mcp.test" && url.pathname === "/mcp") {
      if (!state.mcpAvailable) {
        return json({ jsonrpc: "2.0", error: { code: -32000, message: "MCP unavailable" } }, 503);
      }
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      if (body.method !== "initialize") {
        return json({ jsonrpc: "2.0", error: { code: -32601, message: "Method not found" } }, 400);
      }
      if (state.mcpMalformed) {
        return json({
          jsonrpc: "2.0",
          id: body.id,
          error: { code: -32603, message: 'Invalid "protocolVersion" and "serverInfo".' },
        });
      }
      return json({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          protocolVersion: "2025-06-18",
          serverInfo: { name: "bridge-test-mcp", version: "0.1.0" },
          capabilities: {},
        },
      });
    }
    if (url.pathname === "/v1/projects" && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      const existing = state.projects?.find((project) => project.name === body.name);
      const project = existing ?? {
        id: "prj_hospital",
        organizationId: "org_acme",
        name: body.name,
        decisionOwnerIds: ["usr_architect"],
      };
      if (!existing) state.projects = [...(state.projects ?? []), project];
      return json({
        project,
        disposition: existing ? "idempotent_replay" : "created",
      }, existing ? 200 : 201);
    }
    if (url.pathname === "/v1/projects") return json({ items: state.projects ?? [] });
    if (/^\/v1\/projects\/[^/]+\/repositories$/.test(url.pathname)) {
      const projectId = url.pathname.split("/")[3];
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        const existing = state.repositories?.find((repository) =>
          repository.projectId === projectId &&
          repository.provider === body.provider &&
          repository.owner === body.owner &&
          repository.name === body.name,
        );
        const repository = existing ?? {
          id: "repo_cli_1",
          organizationId: "org_acme",
          projectId,
          provider: body.provider,
          owner: body.owner,
          name: body.name,
          canonicalUrl: body.canonicalUrl,
          createdAt: "2026-08-16T00:00:00.000Z",
        };
        if (!existing) state.repositories = [...(state.repositories ?? []), repository];
        return json({ repository, disposition: existing ? "idempotent_replay" : "created" }, existing ? 200 : 201);
      }
      return json({ items: state.repositories?.filter((repository) => repository.projectId === projectId) ?? [] });
    }
    if (/^\/v1\/projects\/[^/]+\/adapter-diagnostics$/.test(url.pathname) && init?.method === "POST") {
      if (state.diagnosticPersistenceAvailable === false) {
        return json({ code: "UNAVAILABLE", message: "Diagnostic persistence unavailable." }, 503);
      }
      return json({
        organizationId: "org_acme",
        projectId: url.pathname.split("/")[3],
        client: JSON.parse(String(init.body)).client,
        reportedById: "agt_cli",
        reportedByType: "agent",
        correlationId: "cli_diagnostic_001",
        capabilities: JSON.parse(String(init.body)).capabilities,
        mcpStatus: JSON.parse(String(init.body)).mcpStatus,
        checks: JSON.parse(String(init.body)).checks,
        status: "pass",
        observedAt: "2026-08-15T00:00:00.000Z",
      });
    }
    if (/^\/v1\/projects\/[^/]+$/.test(url.pathname)) {
      const projectId = url.pathname.split("/").at(-1);
      if (state.rejectProjectReads) {
        return json({ code: "NOT_FOUND", message: "Project not found." }, 404);
      }
      return json(
        state.projects?.find((project) => project.id === projectId) ?? {
          id: projectId,
          organizationId: "org_acme",
          name: "Configured Project",
          decisionOwnerIds: ["usr_architect"],
        },
      );
    }
    if (url.pathname.endsWith("/runs") && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      state.run = {
        id: "run_cli_1",
        ...body,
        status: "running",
        version: 1,
        contextSnapshotIds: [],
        questionIds: [],
        artifactVersionIds: [],
        assumptionIds: [],
      };
      return json({ run: state.run, resumeContextKey: "resume_cli_000000000000000000000000" }, 201);
    }
    if (url.pathname === "/v1/runs/run_cli_1/continuation") {
      return json({
        run: state.run,
        blockingQuestions: [],
        acceptedDecisionIds: ["dec_cli_1"],
        remainingQuestionIds: [],
        canContinue: true,
      });
    }
    if (url.pathname === "/v1/runs/run_cli_1" && init?.method === "PATCH") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      state.run = { ...state.run, ...body, version: 2 };
      return json(state.run);
    }
    if (url.pathname === "/v1/runs/run_cli_1") return json(state.run);
    if (url.pathname.endsWith("/runs")) return json({ items: state.run ? [state.run] : [] });
    if (url.pathname.endsWith("/questions/matches") && init?.method === "POST") {
      return json({
        items: state.question.id
          ? [{
              questionId: state.question.id,
              title: state.question.title,
              category: state.question.category,
              status: state.question.status,
              score: 100,
              matchKind: "exact",
              reasons: ["same normalized question and scope"],
              scope: state.question.scope,
            }]
          : [],
      });
    }
    if (url.pathname.endsWith("/questions") && init?.method === "POST") {
      if (state.rejectSecretWrites) {
        return json({
          code: "SECRET_DETECTED",
          message: "Potential credential detected in content. Remove it and retry; Bridge did not store this request.",
          details: {
            contentType: "question",
            fieldPath: "content.context",
            secretType: "bridge_service_token",
          },
        }, 422);
      }
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      state.question = {
        ...body,
        id: "qst_cli_1",
        status: "open",
        submissionDisposition: "created",
        ownerIds: ["usr_architect"],
        responses: [],
      };
      return json(state.question, 201);
    }
    if (url.pathname.endsWith("/assumptions") && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      const assumption = {
        id: "asm_cli_1",
        ...body,
        status: "active",
        expiresAt: body.expiresAt ?? "2026-08-14T00:00:00.000Z",
        version: 1,
      };
      state.assumptions = [assumption];
      return json(assumption, 201);
    }
    if (url.pathname === "/v1/assumptions/asm_cli_1/resolve" && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      const assumption = { ...state.assumptions[0], ...body, version: 2 };
      state.assumptions = [assumption];
      return json(assumption);
    }
    if (url.pathname === "/v1/assumptions/asm_cli_1") return json(state.assumptions[0]);
    if (url.pathname.endsWith("/artifacts") && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      state.artifactRequestBodies = [...(state.artifactRequestBodies ?? []), body];
      const artifact = {
        id: "art_cli_1",
        projectId: "prj_payments",
        title: body.title,
        type: body.type,
        currentVersionId: "av_cli_1",
        versions: [{
          id: "av_cli_1",
          artifactId: "art_cli_1",
          version: 1,
          summary: body.summary,
          body: body.body,
          status: "in_review",
        }],
      };
      state.artifacts = [artifact];
      return json({ artifact, version: artifact.versions[0] }, 201);
    }
    if (url.pathname === "/v1/questions/qst_cli_1") return json(state.question);
    if (url.pathname.endsWith("/context")) {
      return json({
        contextSnapshotId: "ctx_cli_1",
        truncated: false,
        items: [{
          id: "dec_cli_1",
          type: "decision",
          title: "Retry transient failures",
          summary: "Use bounded exponential backoff.",
          authority: "approved",
          sourceUrl: "http://bridge.test/decisions/dec_cli_1",
          scope: { component: "transfers" },
          updatedAt: "2026-08-07T00:00:00.000Z",
        }],
      });
    }
    if (url.pathname.endsWith("/decisions")) {
      return json({ items: [{ id: "dec_cli_1", answer: "Retry transient failures" }] });
    }
    if (url.pathname.endsWith("/inbox")) return json({ items: state.question.id ? [state.question] : [] });
    if (url.pathname.endsWith("/assumptions")) return json({ items: state.assumptions });
    if (url.pathname.endsWith("/artifacts")) return json({ items: state.artifacts });
    if (url.pathname.endsWith("/questions")) return json({ items: [state.question] });
    return json({ code: "NOT_FOUND", message: "Route not found." }, 404);
  };
}

describe("Bridge CLI fallback adapter", () => {
  it("recognizes a pnpm-style symlink as the executable entrypoint", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "bridge-cli-entrypoint-"));
    const target = join(cwd, "package", "dist", "index.js");
    const link = join(cwd, "node_modules", ".bin", "bridge");
    await mkdir(join(cwd, "package", "dist"), { recursive: true });
    await mkdir(join(cwd, "node_modules", ".bin"), { recursive: true });
    await writeFile(target, "// packaged Bridge CLI\n", "utf8");
    await symlink(target, link);

    expect(await isCliEntrypoint(link, pathToFileURL(target).href)).toBe(true);
    expect(await isCliEntrypoint(join(cwd, "unrelated.js"), pathToFileURL(target).href)).toBe(false);
  });

  it("registers a fresh project and safely activates Codex instructions", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "bridge-cli-fresh-project-"));
    const stdout: string[] = [];
    const state: MockState = { question: {}, artifacts: [], assumptions: [], projects: [] };
    await writeFile(join(cwd, "AGENTS.md"), "# Existing repository instructions\n\nKeep this content.\n");
    const runtime: Partial<CliRuntime> = {
      cwd,
      fetch: mockBridge(state),
      stdout: (text) => stdout.push(text),
      stderr: () => undefined,
      environment: {},
    };

    expect(await runCli([
      "init",
      "--name",
      "Hospital Management System",
      "--client",
      "codex",
      "--api-url",
      "http://bridge.test",
    ], runtime)).toBe(0);
    const config = await readFile(join(cwd, ".bridge", "project.yaml"), "utf8");
    expect(config).toContain('project_id: "prj_hospital"');
    expect(config).toContain('client: "codex"');
    expect(await readFile(join(cwd, ".bridge", "agent-instructions.md"), "utf8"))
      .toContain("./node_modules/.bin/bridge");
    const firstInstructions = await readFile(join(cwd, "AGENTS.md"), "utf8");
    expect(firstInstructions).toContain("Keep this content.");
    expect(firstInstructions).toContain(".bridge/agent-instructions.md");
    expect(firstInstructions.match(/bridge:instructions:start/g)).toHaveLength(1);
    expect(stdout.at(-1)).toContain('"registrationDisposition": "created"');

    expect(await runCli(["doctor"], runtime)).toBe(0);
    expect(stdout.at(-1)).toContain('"capabilityLevel": "instructions"');
    expect(stdout.at(-1)).toContain('"mcp": "not_configured"');
    expect(stdout.at(-1)).toContain('"name": "project-mapping"');
    expect(stdout.at(-1)).toContain('"diagnosticPersisted": true');

    state.diagnosticPersistenceAvailable = false;
    expect(await runCli(["doctor"], runtime)).toBe(cliExitCodes.configuration);
    expect(stdout.at(-1)).toContain('"name": "diagnostic-persistence"');
    state.diagnosticPersistenceAvailable = true;

    expect(await runCli([
      "init",
      "--name",
      "Hospital Management System",
      "--client",
      "codex",
      "--api-url",
      "http://bridge.test",
      "--force",
    ], runtime)).toBe(0);
    const repeatedInstructions = await readFile(join(cwd, "AGENTS.md"), "utf8");
    expect(repeatedInstructions).toContain("Keep this content.");
    expect(repeatedInstructions.match(/bridge:instructions:start/g)).toHaveLength(1);
    expect(stdout.at(-1)).toContain('"registrationDisposition": "idempotent_replay"');
  });

  it("previews fresh-project registration and adapter files without mutating state", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "bridge-cli-dry-run-"));
    const stdout: string[] = [];
    const state: MockState = { question: {}, artifacts: [], assumptions: [], projects: [] };
    const runtime: Partial<CliRuntime> = {
      cwd,
      fetch: mockBridge(state),
      stdout: (text) => stdout.push(text),
      stderr: () => undefined,
    };

    expect(await runCli([
      "init",
      "--name",
      "Hospital Management System",
      "--client",
      "codex",
      "--api-url",
      "http://bridge.test",
      "--dry-run",
    ], runtime)).toBe(0);
    expect(state.projects).toEqual([]);
    expect(stdout.at(-1)).toContain('"dryRun": true');
    expect(stdout.at(-1)).toContain('"registrationDisposition": "would_register"');
    expect(stdout.at(-1)).toContain('"path": ".bridge/project.yaml"');
    await expect(readFile(join(cwd, ".bridge", "project.yaml"), "utf8")).rejects.toThrow();
  });

  it("selects an authorized project interactively and validates the mapping before writing", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "bridge-cli-interactive-init-"));
    const stdout: string[] = [];
    const stderr: string[] = [];
    const prompts: string[] = [];
    const state: MockState = {
      question: {},
      artifacts: [],
      assumptions: [],
      projects: [
        { id: "prj_alpha", organizationId: "org_acme", name: "Alpha", decisionOwnerIds: [] },
        { id: "prj_payments", organizationId: "org_acme", name: "Payments", decisionOwnerIds: [] },
      ],
    };
    const runtime: Partial<CliRuntime> = {
      cwd,
      fetch: mockBridge(state),
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
      environment: {},
      isInteractive: true,
      prompt: async (message) => {
        prompts.push(message);
        return "2";
      },
    };

    expect(await runCli(["init", "--interactive", "--repository", "bridge-repo", "--api-url", "http://bridge.test"], runtime))
      .toBe(0);
    expect(await readFile(join(cwd, ".bridge", "project.yaml"), "utf8"))
      .toContain('project_id: "prj_payments"');
    expect(JSON.parse(stdout.at(-1) ?? "{}")).toMatchObject({
      projectId: "prj_payments",
      projectName: "Payments",
      repository: "bridge-repo",
      mappingValidated: true,
    });
    expect(prompts).toEqual(["Select a project number (or q to cancel): "]);
    expect(stderr.join("\n")).toContain("Authorized Bridge projects for bridge-repo");
  });

  it("does not write repository files when API mapping validation fails", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "bridge-cli-invalid-mapping-"));
    const stderr: string[] = [];
    const state: MockState = {
      question: {},
      artifacts: [],
      assumptions: [],
      rejectProjectReads: true,
    };
    const runtime: Partial<CliRuntime> = {
      cwd,
      fetch: mockBridge(state),
      stderr: (text) => stderr.push(text),
      environment: {},
      isInteractive: false,
    };

    expect(await runCli(["init", "prj_missing", "--api-url", "http://bridge.test"], runtime))
      .toBe(cliExitCodes.notFound);
    await expect(readFile(join(cwd, ".bridge", "project.yaml"), "utf8")).rejects.toThrow();
    expect(JSON.parse(stderr.at(-1) ?? "{}")).toMatchObject({ code: "NOT_FOUND" });
  });

  it("requires confirmation before applying an existing configuration diff", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "bridge-cli-init-confirmation-"));
    const stdout: string[] = [];
    const stderr: string[] = [];
    const state: MockState = { question: {}, artifacts: [], assumptions: [] };
    const runtime: Partial<CliRuntime> = {
      cwd,
      fetch: mockBridge(state),
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
      environment: {},
      isInteractive: false,
    };
    await runCli(["init", "prj_payments", "--api-url", "http://bridge.test"], runtime);
    const originalConfig = await readFile(join(cwd, ".bridge", "project.yaml"), "utf8");

    const interactiveRuntime: Partial<CliRuntime> = {
      ...runtime,
      isInteractive: true,
      prompt: async () => "n",
    };
    expect(await runCli([
      "init",
      "prj_payments",
      "--client",
      "claude_code",
      "--api-url",
      "http://bridge.test",
    ], interactiveRuntime)).toBe(cliExitCodes.conflict);
    expect(await readFile(join(cwd, ".bridge", "project.yaml"), "utf8")).toBe(originalConfig);
    expect(stderr.join("\n")).toContain("Bridge will change these files");

    const approvedRuntime: Partial<CliRuntime> = {
      ...runtime,
      isInteractive: true,
      prompt: async () => "yes",
    };
    expect(await runCli([
      "init",
      "prj_payments",
      "--client",
      "claude_code",
      "--api-url",
      "http://bridge.test",
    ], approvedRuntime)).toBe(0);
    expect(await readFile(join(cwd, ".bridge", "project.yaml"), "utf8"))
      .toContain('client: "claude_code"');
    expect(stdout.at(-1)).toContain('"mappingValidated": true');
  });

  it("installs or switches an adapter without registering another project", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "bridge-cli-install-"));
    const stdout: string[] = [];
    const state: MockState = { question: {}, artifacts: [], assumptions: [], projects: [] };
    const runtime: Partial<CliRuntime> = {
      cwd,
      fetch: mockBridge(state),
      stdout: (text) => stdout.push(text),
      stderr: () => undefined,
    };

    await runCli(["init", "prj_payments", "--api-url", "http://bridge.test"], runtime);
    await writeFile(join(cwd, "CLAUDE.md"), "# Existing Claude guidance\n");
    expect(await runCli(["install", "--client", "claude_code"], runtime)).toBe(0);
    expect(state.projects).toEqual([]);
    expect(await readFile(join(cwd, ".bridge", "project.yaml"), "utf8"))
      .toContain('client: "claude_code"');
    const claudeInstructions = await readFile(join(cwd, "CLAUDE.md"), "utf8");
    expect(claudeInstructions).toContain("Existing Claude guidance");
    expect(claudeInstructions).toContain("bridge:instructions:start");
    expect(stdout.at(-1)).toContain('"previousClient": "codex"');

    expect(await runCli(["install", "--client", "cursor", "--dry-run"], runtime)).toBe(0);
    expect(stdout.at(-1)).toContain('"dryRun": true');
    expect(stdout.at(-1)).toContain('"path": ".cursor/rules/bridge.mdc"');
    expect(await readFile(join(cwd, ".bridge", "project.yaml"), "utf8"))
      .toContain('client: "claude_code"');
    await expect(readFile(join(cwd, ".cursor", "rules", "bridge.mdc"), "utf8")).rejects.toThrow();

    expect(await runCli(["init", "--dry-run"], runtime)).toBe(0);
    expect(stdout.at(-1)).toContain('"projectId": "prj_payments"');
    expect(stdout.at(-1)).toContain('"client": "claude_code"');
    expect(await runCli(["init", "--force"], runtime)).toBe(0);
    const regeneratedConfig = await readFile(join(cwd, ".bridge", "project.yaml"), "utf8");
    expect(regeneratedConfig).toContain('api_url: "http://bridge.test"');
    expect(regeneratedConfig).toContain('client: "claude_code"');
    expect(state.projects).toEqual([]);
  });

  it("records and probes an optional MCP endpoint while retaining a CLI-only fallback", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "bridge-cli-mcp-"));
    const stdout: string[] = [];
    const stderr: string[] = [];
    const state: MockState = {
      question: {},
      artifacts: [],
      assumptions: [],
      mcpAvailable: true,
    };
    const runtime: Partial<CliRuntime> = {
      cwd,
      fetch: mockBridge(state),
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
      environment: {},
    };

    expect(await runCli([
      "init",
      "prj_payments",
      "--api-url",
      "http://bridge.test",
      "--mcp-url",
      "http://mcp.test/mcp",
    ], runtime)).toBe(0);
    expect(await readFile(join(cwd, ".bridge", "project.yaml"), "utf8"))
      .toContain('mcp_url: "http://mcp.test/mcp"');
    const codexMcpConfig = await readFile(join(cwd, ".codex", "config.toml"), "utf8");
    expect(codexMcpConfig).toContain("# bridge:mcp:start");
    expect(codexMcpConfig).toContain("Bridge-managed MCP configuration version: 1");
    expect(codexMcpConfig).toContain('[mcp_servers.bridge]');
    expect(codexMcpConfig).toContain('url = "http://mcp.test/mcp"');
    expect(await runCli(["doctor"], runtime)).toBe(0);
    expect(stdout.at(-1)).toContain('"capabilityLevel": "instructions+mcp"');
    expect(stdout.at(-1)).toContain('"mcp": "ready"');

    state.mcpAvailable = false;
    expect(await runCli(["doctor"], runtime)).toBe(cliExitCodes.configuration);
    expect(stderr.at(-1)).toContain('"code":"DOCTOR_FAILED"');

    state.mcpAvailable = true;
    state.mcpMalformed = true;
    expect(await runCli(["doctor"], runtime)).toBe(cliExitCodes.configuration);
    expect(stdout.at(-1)).toContain('"mcp": "failed"');
  });

  it("generates and safely merges the Claude project MCP configuration", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "bridge-cli-claude-mcp-config-"));
    const stdout: string[] = [];
    const state: MockState = { question: {}, artifacts: [], assumptions: [] };
    const runtime: Partial<CliRuntime> = {
      cwd,
      fetch: mockBridge(state),
      stdout: (text) => stdout.push(text),
      stderr: () => undefined,
      environment: {},
    };
    await writeFile(join(cwd, ".mcp.json"), `${JSON.stringify({
      customSetting: true,
      mcpServers: {
        other: { type: "http", url: "https://example.test/mcp" },
      },
    }, null, 2)}\n`, "utf8");

    expect(await runCli([
      "init",
      "prj_payments",
      "--client",
      "claude_code",
      "--api-url",
      "http://bridge.test",
      "--mcp-url",
      "https://bridge.test/mcp",
    ], runtime)).toBe(0);
    const firstConfig = JSON.parse(await readFile(join(cwd, ".mcp.json"), "utf8")) as {
      customSetting: boolean;
      mcpServers: Record<string, Record<string, unknown>>;
      "x-bridge": Record<string, unknown>;
    };
    expect(firstConfig.customSetting).toBe(true);
    expect(firstConfig.mcpServers.other?.url).toBe("https://example.test/mcp");
    expect(firstConfig.mcpServers.bridge).toMatchObject({
      type: "http",
      url: "https://bridge.test/mcp",
      "x-bridge": { managedBy: "bridge-cli", version: 1 },
    });
    expect(firstConfig["x-bridge"]).toEqual({ managedBy: "bridge-cli", version: 1 });
    expect(stdout.at(-1)).toContain('".mcp.json"');

    expect(await runCli(["install", "--client", "codex"], runtime)).toBe(0);
    expect(await readFile(join(cwd, ".codex", "config.toml"), "utf8"))
      .toContain('[mcp_servers.bridge]');
    const preservedClaudeConfig = JSON.parse(await readFile(join(cwd, ".mcp.json"), "utf8")) as {
      mcpServers: Record<string, Record<string, unknown>>;
    };
    expect(preservedClaudeConfig.mcpServers.other?.url).toBe("https://example.test/mcp");
    expect(preservedClaudeConfig.mcpServers.bridge?.url).toBe("https://bridge.test/mcp");

    await writeFile(join(cwd, ".mcp.json"), `${JSON.stringify({
      mcpServers: { bridge: { type: "http", url: "https://unrelated.test/mcp" } },
    }, null, 2)}\n`, "utf8");
    expect(await runCli(["install", "--client", "claude_code"], runtime)).toBe(cliExitCodes.conflict);
    expect(await readFile(join(cwd, ".bridge", "project.yaml"), "utf8"))
      .toContain('client: "codex"');
  });

  it("starts, reads, continues, and reports an agent run without MCP", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "bridge-cli-"));
    const stdout: string[] = [];
    const state: MockState = { question: {}, artifacts: [], assumptions: [] };
    const runtime: Partial<CliRuntime> = {
      cwd,
      fetch: mockBridge(state),
      stdout: (text) => stdout.push(text),
      stderr: () => undefined,
    };
    expect(await runCli(["init", "prj_payments", "--api-url", "http://bridge.test"], runtime)).toBe(0);

    expect(await runCli([
      "run",
      "start",
      "--task",
      "Implement transfer retry handling",
      "--component",
      "transfers",
    ], runtime)).toBe(0);
    expect(stdout.at(-1)).toContain("run_cli_1");
    expect(await runCli(["run", "get", "run_cli_1"], runtime)).toBe(0);
    expect(await runCli([
      "run",
      "continue",
      "run_cli_1",
      "--resume-key",
      "resume_cli_000000000000000000000000",
    ], runtime)).toBe(0);
    expect(stdout.at(-1)).toContain('"canContinue": true');
    expect(await runCli([
      "run",
      "report",
      "run_cli_1",
      "--status",
      "completed",
      "--version",
      "1",
      "--summary",
      "Implemented bounded transient retries",
    ], runtime)).toBe(0);
    expect(stdout.at(-1)).toContain('"status": "completed"');
  });

  it("verifies observable independent-agent conformance for a greenfield task", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "bridge-cli-conformance-"));
    const stdout: string[] = [];
    const stderr: string[] = [];
    const runId = "run_cli_hospital";
    const state: MockState = {
      question: {
        id: "qst_cli_patient_identity",
        runId,
        title: "Which patient identity policy should the hospital use?",
        type: "decision",
        category: "privacy",
        context: "Patient matching must be consistent across hospital registration and clinical workflows.",
        whyItMatters: "A wrong match could merge records or expose protected patient information.",
        risk: "protected",
        blocking: true,
        ownerIds: [],
        ownerRoles: ["business-analyst", "security-reviewer"],
        options: [
          { key: "enterprise-mrn", label: "Enterprise MRN", tradeoffs: "Central governance." },
          { key: "facility-mrn", label: "Facility MRN", tradeoffs: "Local autonomy." },
        ],
        recommendationKey: "enterprise-mrn",
        scope: { repository: "hospital-management-system", component: "patient-registry" },
        createdByType: "agent",
        status: "open",
      },
      artifacts: (["prd", "adr", "api_contract", "test_plan"] as const).map((type, index) => ({
        id: `art_cli_hospital_${type}`,
        type,
        versions: [{
          id: `av_cli_hospital_${index + 1}`,
          runId,
          createdByType: "agent",
          status: "in_review",
        }],
      })),
      assumptions: [],
      run: {
        id: runId,
        client: "codex",
        taskSummary: "Build a production-ready Hospital Management System",
        status: "waiting_for_human",
        contextSnapshotIds: ["ctx_cli_hospital"],
        questionIds: ["qst_cli_patient_identity"],
        artifactVersionIds: [
          "av_cli_hospital_1",
          "av_cli_hospital_2",
          "av_cli_hospital_3",
          "av_cli_hospital_4",
        ],
      },
    };
    const runtime: Partial<CliRuntime> = {
      cwd,
      fetch: mockBridge(state),
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
    };
    await runCli(["init", "prj_payments", "--api-url", "http://bridge.test"], runtime);

    expect(await runCli([
      "conformance",
      "--task",
      "Build a Hospital Management System.",
      "--run-id",
      runId,
    ], runtime)).toBe(cliExitCodes.success);
    expect(JSON.parse(stdout.at(-1) ?? "{}")).toMatchObject({
      ok: true,
      runId,
      linkedSpecificationTypes: ["adr", "api_contract", "prd", "test_plan"],
      checks: expect.arrayContaining([
        expect.objectContaining({ name: "context-retrieval", status: "pass" }),
        expect.objectContaining({ name: "routed-question", status: "pass" }),
        expect.objectContaining({ name: "required-specifications", status: "pass" }),
      ]),
    });
    expect(stderr).toEqual([]);
  });

  it("returns pending conformance evidence when an agent omits governed records", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "bridge-cli-conformance-failed-"));
    const stdout: string[] = [];
    const stderr: string[] = [];
    const state: MockState = {
      question: {},
      artifacts: [],
      assumptions: [],
      run: {
        id: "run_cli_incomplete",
        client: "codex",
        taskSummary: "Build a Hospital Management System",
        status: "running",
        contextSnapshotIds: [],
        questionIds: [],
        artifactVersionIds: [],
      },
    };
    const runtime: Partial<CliRuntime> = {
      cwd,
      fetch: mockBridge(state),
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
    };
    await runCli(["init", "prj_payments", "--api-url", "http://bridge.test"], runtime);

    expect(await runCli([
      "conformance",
      "--task",
      "Build a Hospital Management System.",
    ], runtime)).toBe(cliExitCodes.pending);
    expect(JSON.parse(stdout.at(-1) ?? "{}")).toMatchObject({
      ok: false,
      checks: expect.arrayContaining([
        expect.objectContaining({ name: "routed-question", status: "fail" }),
        expect.objectContaining({ name: "required-specifications", status: "fail" }),
      ]),
    });
    expect(JSON.parse(stderr.at(-1) ?? "{}")).toMatchObject({
      code: "CONFORMANCE_FAILED",
      exitCode: cliExitCodes.pending,
    });
  });

  it("renders human-readable output without changing the JSON default", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "bridge-cli-human-output-"));
    const stdout: string[] = [];
    const stderr: string[] = [];
    const state: MockState = { question: {}, artifacts: [], assumptions: [], projects: [] };
    const runtime: Partial<CliRuntime> = {
      cwd,
      fetch: mockBridge(state),
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
    };

    expect(await runCli([
      "init",
      "--name",
      "Hospital Management System",
      "--client",
      "codex",
      "--api-url",
      "http://bridge.test",
      "--output",
      "human",
    ], runtime)).toBe(cliExitCodes.success);
    expect(stdout.at(-1)).toContain("Status: OK");
    expect(stdout.at(-1)).toContain("Project ID: prj_hospital");
    expect(stdout.at(-1)).toContain("Files:");
    expect(stdout.at(-1)).not.toContain('"projectId"');

    expect(await runCli(["doctor"], runtime)).toBe(cliExitCodes.success);
    expect(stdout.at(-1)).toContain('"capabilityLevel": "instructions"');
    expect(stderr).toEqual([]);
  });

  it("creates, lists, rotates, and revokes service identities without persisting tokens", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "bridge-cli-service-identity-"));
    const stdout: string[] = [];
    const stderr: string[] = [];
    const state: MockState = { question: {}, artifacts: [], assumptions: [] };
    const runtime: Partial<CliRuntime> = {
      cwd,
      fetch: mockBridge(state),
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
      environment: {},
    };

    expect(await runCli([
      "service",
      "identity",
      "create",
      "--name",
      "Hospital CI",
      "--type",
      "ci",
      "--scope",
      "bridge:read",
      "--scope",
      "bridge:questions:write",
      "--role",
      "agent",
      "--project",
      "prj_hospital=contributor,qa",
      "--all-projects",
      "--expires-at",
      "2026-12-01T00:00:00Z",
      "--api-url",
      "http://bridge.test",
    ], runtime)).toBe(0);
    const created = JSON.parse(stdout.at(-1) ?? "{}");
    expect(created).toMatchObject({
      token: state.serviceToken,
      tokenNotice: "Store this token now; Bridge will not show it again.",
      serviceIdentity: { name: "Hospital CI", type: "ci", version: 1 },
    });
    expect(state.serviceRequestBodies?.[0]).toEqual({
      name: "Hospital CI",
      type: "ci",
      roles: ["agent"],
      allProjects: true,
      projectMemberships: [{ projectId: "prj_hospital", roles: ["contributor", "qa"] }],
      scopes: ["bridge:read", "bridge:questions:write"],
      expiresAt: "2026-12-01T00:00:00Z",
    });
    expect(await readFile(join(cwd, ".bridge", "project.yaml"), "utf8").catch(() => "")).toBe("");

    expect(await runCli([
      "service",
      "identity",
      "list",
      "--api-url",
      "http://bridge.test",
    ], runtime)).toBe(0);
    expect(stdout.at(-1)).toContain("scr_cli_1");
    expect(stdout.at(-1)).not.toContain(state.serviceToken!);

    const firstToken = created.token;
    expect(await runCli([
      "service",
      "identity",
      "rotate",
      "scr_cli_1",
      "--version",
      "1",
      "--api-url",
      "http://bridge.test",
    ], runtime)).toBe(0);
    const rotated = JSON.parse(stdout.at(-1) ?? "{}");
    expect(rotated).toMatchObject({
      tokenNotice: "Store this token now; Bridge will not show it again.",
      serviceIdentity: { id: "scr_cli_1", version: 2, rotatedAt: "2026-08-11T00:01:00.000Z" },
    });
    expect(rotated.token).not.toBe(firstToken);
    expect(state.serviceRequestBodies?.at(-1)).toEqual({ expectedVersion: 1 });

    expect(await runCli([
      "service",
      "identity",
      "revoke",
      "scr_cli_1",
      "--version",
      "2",
      "--api-url",
      "http://bridge.test",
    ], runtime)).toBe(0);
    expect(stdout.at(-1)).toContain('"version": 3');
    expect(state.serviceRequestBodies?.at(-1)).toEqual({ expectedVersion: 2 });
    expect(stderr).toEqual([]);
  });

  it("rejects an unsupported output mode with the stable usage exit code", async () => {
    const stderr: string[] = [];
    expect(await runCli(["doctor", "--output", "yaml"], {
      cwd: await mkdtemp(join(tmpdir(), "bridge-cli-invalid-output-")),
      stderr: (text) => stderr.push(text),
    })).toBe(cliExitCodes.usage);
    expect(JSON.parse(stderr.at(-1) ?? "{}")).toMatchObject({
      code: "INVALID_OUTPUT_MODE",
      exitCode: cliExitCodes.usage,
    });
  });

  it("links and lists project repositories through the CLI", async () => {
    const stdout: string[] = [];
    const state: MockState = { question: {}, artifacts: [], assumptions: [], repositories: [] };
    const runtime: Partial<CliRuntime> = {
      cwd: "/tmp/bridge-cli",
      fetch: mockBridge(state),
      stdout: (text) => stdout.push(text),
      stderr: () => undefined,
      environment: {},
    };

    expect(await runCli([
      "repository",
      "link",
      "prj_payments",
      "--provider",
      "GitHub",
      "--owner",
      "bridge-org",
      "--name",
      "bridge",
      "--url",
      "https://github.com/bridge-org/bridge",
    ], runtime)).toBe(0);
    expect(state.repositories).toEqual([expect.objectContaining({
      projectId: "prj_payments",
      provider: "github",
      canonicalUrl: "https://github.com/bridge-org/bridge",
    })]);
    expect(JSON.parse(stdout.at(-1) ?? "{}")).toMatchObject({ disposition: "created" });

    expect(await runCli(["repository", "list", "prj_payments"], runtime)).toBe(0);
    expect(JSON.parse(stdout.at(-1) ?? "{}").items).toEqual([
      expect.objectContaining({ name: "bridge", owner: "bridge-org" }),
    ]);
  });

  it("surfaces a secret rejection without printing the submitted credential", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "bridge-cli-secret-rejection-"));
    const stdout: string[] = [];
    const stderr: string[] = [];
    const state: MockState = {
      question: {},
      artifacts: [],
      assumptions: [],
      projects: [],
      rejectSecretWrites: true,
    };
    const runtime: Partial<CliRuntime> = {
      cwd,
      fetch: mockBridge(state),
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
      environment: {},
    };
    expect(await runCli(["init", "prj_payments", "--api-url", "http://bridge.test"], runtime)).toBe(0);
    const secret = `brg_srv_${"A".repeat(43)}`;
    const questionPath = join(cwd, "secret-question.json");
    await writeFile(questionPath, JSON.stringify({
      idempotencyKey: "cli-secret-question-001",
      title: "Which credential policy should the worker follow?",
      type: "decision",
      category: "security",
      context: `The proposed configuration embeds ${secret} in a durable file.`,
      whyItMatters: "Persisting the credential would expose privileged access to later readers.",
      intendedOwnerIds: ["usr_architect"],
      risk: "protected",
      reversible: false,
      blocking: true,
      options: [
        { key: "manager", label: "Use a secret manager", tradeoffs: "Requires deployment integration." },
        { key: "environment", label: "Use runtime injection", tradeoffs: "Requires environment configuration." },
      ],
      recommendationKey: "manager",
      scope: { component: "worker" },
    }));

    expect(await runCli(["ask", "--file", questionPath], runtime)).toBe(cliExitCodes.usage);
    expect(JSON.parse(stderr.at(-1) ?? "{}")).toMatchObject({
      code: "SECRET_DETECTED",
      message: "Potential credential detected in content. Remove it and retry; Bridge did not store this request.",
      exitCode: cliExitCodes.usage,
      details: { status: 422 },
    });
    expect(stderr.join("\n")).not.toContain(secret);
    expect(state.question).toEqual({});
  });

  it("initializes a repository, asks a question, reads its answer, and synchronizes context", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "bridge-cli-"));
    const stdout: string[] = [];
    const stderr: string[] = [];
    const state: MockState = { question: {}, artifacts: [], assumptions: [] };
    const runtime: Partial<CliRuntime> = {
      cwd,
      fetch: mockBridge(state),
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
      now: () => new Date("2026-08-07T00:00:00.000Z"),
      sleep: async () => undefined,
    };

    expect(await runCli(["init", "prj_payments", "--api-url", "http://bridge.test"], runtime)).toBe(0);
    expect(await readFile(join(cwd, ".bridge", "project.yaml"), "utf8")).toContain("prj_payments");
    expect(await readFile(join(cwd, ".bridge", "assumption.example.json"), "utf8"))
      .toContain("reversalCost");

    const questionPath = join(cwd, "question.json");
    await writeFile(questionPath, JSON.stringify({
      idempotencyKey: "cli-question-001",
      title: "Which transfer failures should be retried?",
      type: "decision",
      category: "architecture",
      context: "The worker currently retries every transfer failure without classification.",
      whyItMatters: "Permanent failures should not consume capacity or hide required user action.",
      intendedOwnerIds: ["usr_architect"],
      risk: "high",
      reversible: false,
      blocking: true,
      options: [
        { key: "transient", label: "Retry transient failures", tradeoffs: "Requires classification." },
        { key: "all", label: "Retry every failure", tradeoffs: "Retries permanent failures." },
      ],
      recommendationKey: "transient",
      scope: { component: "transfers" },
    }));
    expect(await runCli(["ask", "--file", questionPath], runtime)).toBe(0);
    expect(stdout.at(-1)).toContain('"submissionDisposition": "created"');
    expect(await runCli(["inbox", "--status", "open", "--risk", "high"], runtime)).toBe(0);
    expect(stdout.at(-1)).toContain('"qst_cli_1"');
    expect(await runCli(["question", "matches", "--file", questionPath], runtime)).toBe(0);
    expect(stdout.at(-1)).toContain('"matchKind": "exact"');
    expect(await runCli(["sync", "--task", "Implement transfer retry handling"], runtime)).toBe(0);
    expect(await readFile(join(cwd, ".bridge", "questions.json"), "utf8"))
      .toContain("qst_cli_1");

    state.question = {
      ...state.question,
      status: "accepted",
      acceptedResponseId: "rsp_cli_1",
      decisionId: "dec_cli_1",
      responses: [{
        id: "rsp_cli_1",
        answer: "Retry transient failures",
        rationale: "Use bounded exponential backoff.",
      }],
    };
    expect(await runCli(["wait", "qst_cli_1", "--timeout", "0"], runtime)).toBe(0);
    expect(stdout.at(-1)).toContain("dec_cli_1");

    const assumptionPath = join(cwd, "assumption.json");
    await writeFile(assumptionPath, JSON.stringify({
      idempotencyKey: "cli-assumption-001",
      runId: "run_cli_1",
      statement: "Internal retry metrics may use the existing transfer namespace.",
      rationale: "The namespace is internal, reversible, and used by adjacent transfer metrics.",
      category: "observability",
      risk: "low",
      confidence: "medium",
      reversible: true,
      reversalCost: "Rename the metric and update its internal dashboard query.",
      scope: { component: "transfers" },
      sourceLinks: [],
    }));
    expect(await runCli(["assumption", "add", "--file", assumptionPath], runtime)).toBe(0);
    expect(stdout.at(-1)).toContain("asm_cli_1");
    expect(await runCli(["assumption", "get", "asm_cli_1"], runtime)).toBe(0);
    expect(await runCli([
      "assumption",
      "resolve",
      "asm_cli_1",
      "--status",
      "confirmed",
      "--version",
      "1",
      "--rationale",
      "The namespace follows the project observability conventions.",
      "--create-decision",
    ], runtime)).toBe(0);
    expect(stdout.at(-1)).toContain('"status": "confirmed"');
    expect(stdout.at(-1)).toContain('"createDecision": true');

    expect(await runCli(["sync", "--task", "Implement transfer retry handling"], runtime)).toBe(0);
    const context = await readFile(join(cwd, ".bridge", "context.md"), "utf8");
    expect(context).toContain("Retry transient failures");
    expect(context).toContain("dec_cli_1");
    expect(await readFile(join(cwd, ".bridge", "assumptions.json"), "utf8"))
      .toContain("asm_cli_1");
    expect(JSON.parse(await readFile(join(cwd, ".bridge", "questions.json"), "utf8")))
      .toEqual({ items: [] });
    expect(stderr).toEqual([]);
  });

  it("publishes Markdown and pulls only its approved immutable version", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "bridge-cli-"));
    const stdout: string[] = [];
    const state: MockState = { question: {}, artifacts: [], assumptions: [] };
    const runtime: Partial<CliRuntime> = {
      cwd,
      fetch: mockBridge(state),
      stdout: (text) => stdout.push(text),
      stderr: () => undefined,
      now: () => new Date("2026-08-07T00:00:00.000Z"),
    };
    await runCli(["init", "prj_payments", "--api-url", "http://bridge.test"], runtime);
    const specPath = join(cwd, "retry-policy.md");
    await writeFile(specPath, "# Retry policy\n\nRetry transient failures using bounded exponential backoff.\n");

    expect(await runCli([
      "spec",
      "publish",
      "--file",
      specPath,
      "--title",
      "Transfer retry policy",
      "--type",
      "adr",
      "--reviewers",
      "usr_architect",
      "--reviewer-roles",
      "qa-lead,architecture-reviewer",
      "--reviewer-teams",
      "architecture",
    ], runtime)).toBe(0);
    expect(stdout.at(-1)).toContain("art_cli_1");
    expect(state.artifactRequestBodies).toEqual([
      expect.objectContaining({
        intendedReviewerIds: ["usr_architect"],
        intendedReviewerRoles: ["qa-lead", "architecture-reviewer"],
        intendedReviewerTeamKeys: ["architecture"],
      }),
    ]);

    const current = state.artifacts[0]?.versions as Array<Record<string, unknown>>;
    if (current?.[0]) {
      current[0] = {
        ...current[0],
        status: "approved",
        approvedAt: "2026-08-07T00:00:00.000Z",
        approvedById: "usr_architect",
      };
      if (state.artifacts[0]) state.artifacts[0].approvedVersionId = "av_cli_1";
    }
    expect(await runCli(["spec", "pull"], runtime)).toBe(0);
    const manifest = JSON.parse(await readFile(join(cwd, ".bridge", "specs", "manifest.json"), "utf8")) as {
      items: Array<{ artifactId: string }>;
    };
    expect(manifest.items).toEqual([expect.objectContaining({ artifactId: "art_cli_1" })]);
    expect(await readFile(join(cwd, ".bridge", "specs", "adr-transfer-retry-policy-art-cli-1.md"), "utf8"))
      .toContain("bounded exponential backoff");
  });

  it("returns a stable pending exit code when an answer has not arrived", async () => {
    const stderr: string[] = [];
    const state: MockState = {
      question: { id: "qst_cli_1", status: "open", responses: [] },
      artifacts: [],
      assumptions: [],
    };
    const exitCode = await runCli(
      ["wait", "qst_cli_1", "--timeout", "0"],
      {
        cwd: await mkdtemp(join(tmpdir(), "bridge-cli-")),
        fetch: mockBridge(state),
        stdout: () => undefined,
        stderr: (text) => stderr.push(text),
      },
    );

    expect(exitCode).toBe(cliExitCodes.pending);
    expect(JSON.parse(stderr[0] ?? "{}")).toMatchObject({ code: "QUESTION_PENDING", exitCode: 10 });
  });

  it("logs in with public-client PKCE, refreshes, authenticates API calls, and revokes logout", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "bridge-cli-oidc-"));
    const stdout: string[] = [];
    const stderr: string[] = [];
    const opened: string[] = [];
    const stored = new Map<string, string>();
    const tokenRequests: URLSearchParams[] = [];
    const apiAuthorizations: string[] = [];
    const accessTokenOne = "access-token-one-with-sufficient-test-length";
    const accessTokenTwo = "access-token-two-with-sufficient-test-length";
    const refreshToken = "refresh-token-with-sufficient-test-length";
    let now = new Date("2026-08-10T00:00:00.000Z");
    let revoked = false;
    const runtime: Partial<CliRuntime> = {
      cwd,
      environment: {},
      now: () => now,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
      openBrowser: async (url) => {
        opened.push(url);
        return true;
      },
      startOAuthCallback: async () => ({
        waitForCode: Promise.resolve("authorization-code"),
        close: async () => undefined,
      }),
      credentialStore: {
        kind: "test-keychain",
        get: async (account) => stored.get(account),
        set: async (account, secret) => {
          stored.set(account, secret);
        },
        delete: async (account) => stored.delete(account),
      },
      fetch: async (input, init) => {
        const url = new URL(String(input));
        const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
          status,
          headers: { "content-type": "application/json" },
        });
        if (url.origin === "http://bridge.test" && url.pathname === "/v1/auth/config") {
          return json({
            mode: "oidc",
            cliClientId: "bridge-cli",
            cliAuthorizationEndpoint: "https://identity.test/authorize",
            cliTokenEndpoint: "https://identity.test/oauth/token",
            cliRevocationEndpoint: "https://identity.test/oauth/revoke",
            cliAudience: "https://api.bridge.test",
            cliRedirectUri: "http://127.0.0.1:8765/callback",
            cliScopes: "openid profile offline_access",
            cliOrganization: "org_acme",
          });
        }
        if (url.origin === "https://identity.test" && url.pathname === "/oauth/token") {
          const parameters = new URLSearchParams(String(init?.body));
          tokenRequests.push(parameters);
          expect(parameters.has("client_secret")).toBe(false);
          if (parameters.get("grant_type") === "authorization_code") {
            expect(parameters.get("code")).toBe("authorization-code");
            expect(parameters.get("code_verifier")?.length).toBeGreaterThanOrEqual(43);
            return json({
              access_token: accessTokenOne,
              refresh_token: refreshToken,
              expires_in: 300,
              token_type: "Bearer",
              scope: "openid profile offline_access",
            });
          }
          expect(parameters.get("grant_type")).toBe("refresh_token");
          expect(parameters.get("refresh_token")).toBe(refreshToken);
          return json({
            access_token: accessTokenTwo,
            expires_in: 300,
            token_type: "Bearer",
          });
        }
        if (url.origin === "https://identity.test" && url.pathname === "/oauth/revoke") {
          const parameters = new URLSearchParams(String(init?.body));
          expect(parameters.get("token")).toBe(refreshToken);
          revoked = true;
          return new Response(null, { status: 200 });
        }
        if (url.origin === "http://bridge.test" && url.pathname === "/v1/auth/me") {
          const headers = new Headers(init?.headers);
          expect(headers.get("x-bridge-principal-id")).toBeNull();
          const authorization = headers.get("authorization") ?? "";
          apiAuthorizations.push(authorization);
          if (![accessTokenOne, accessTokenTwo].some((token) => authorization === `Bearer ${token}`)) {
            return json({ code: "UNAUTHENTICATED", message: "Authentication is required." }, 401);
          }
          return json({
            id: "usr_member",
            type: "human",
            displayName: "Bridge Member",
            organizationId: "org_acme",
            roles: ["organization-member"],
            projectRoles: { prj_payments: ["contributor"] },
            projectIds: ["prj_payments"],
            allProjects: false,
          });
        }
        if (url.origin === "http://bridge.test" && url.pathname === "/v1/projects/prj_payments") {
          return json({
            id: "prj_payments",
            organizationId: "org_acme",
            name: "Payments",
            decisionOwnerIds: [],
          });
        }
        if (url.pathname.endsWith("/context")) {
          const headers = new Headers(init?.headers);
          expect(headers.get("x-bridge-principal-id")).toBeNull();
          const authorization = headers.get("authorization") ?? "";
          apiAuthorizations.push(authorization);
          return json({ contextSnapshotId: "ctx_oidc", items: [], truncated: false });
        }
        return json({ code: "NOT_FOUND", message: "Route not found." }, 404);
      },
    };

    expect(await runCli(["login", "--api-url", "http://bridge.test"], runtime))
      .toBe(cliExitCodes.success);
    expect(opened).toHaveLength(1);
    const authorization = new URL(opened[0]!);
    expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorization.searchParams.get("organization")).toBe("org_acme");
    expect(stored.has("http://bridge.test")).toBe(true);
    expect(stdout.at(-1)).toContain('"status": "authenticated"');

    now = new Date("2026-08-10T00:06:00.000Z");
    expect(await runCli(["auth", "status", "--api-url", "http://bridge.test"], runtime))
      .toBe(cliExitCodes.success);
    expect(stdout.at(-1)).toContain('"authenticated": true');
    expect(tokenRequests.map((request) => request.get("grant_type")))
      .toEqual(["authorization_code", "refresh_token"]);

    expect(await runCli(["init", "prj_payments", "--api-url", "http://bridge.test"], runtime))
      .toBe(cliExitCodes.success);
    expect(await runCli(["context", "--task", "Review authenticated context"], runtime))
      .toBe(cliExitCodes.success);
    expect(apiAuthorizations.at(-1)).toBe(`Bearer ${accessTokenTwo}`);

    expect(await runCli(["logout", "--api-url", "http://bridge.test"], runtime))
      .toBe(cliExitCodes.success);
    expect(revoked).toBe(true);
    expect(stored.size).toBe(0);
    const terminalOutput = [...stdout, ...stderr].join("\n");
    expect(terminalOutput).not.toContain(accessTokenOne);
    expect(terminalOutput).not.toContain(accessTokenTwo);
    expect(terminalOutput).not.toContain(refreshToken);
  });
});
