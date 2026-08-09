import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { cliExitCodes, isCliEntrypoint, runCli, type CliRuntime } from "./index.js";

interface MockState {
  question: Record<string, unknown>;
  artifacts: Array<Record<string, unknown>>;
  assumptions: Array<Record<string, unknown>>;
  projects?: Array<Record<string, unknown>>;
  run?: Record<string, unknown>;
  mcpAvailable?: boolean;
  mcpMalformed?: boolean;
}

function mockBridge(state: MockState): CliRuntime["fetch"] {
  return async (input, init) => {
    const url = new URL(String(input));
    const json = (value: unknown, status = 200) =>
      new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
    if (url.pathname === "/health") return json({ status: "ok", service: "bridge-api" });
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
    if (/^\/v1\/projects\/[^/]+$/.test(url.pathname)) {
      const projectId = url.pathname.split("/").at(-1);
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

    expect(await runCli(["init", "prj_payments", "--api-url", "http://bridge.test"], runtime)).toBe(0);
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
    await runCli(["init", "prj_payments", "--api-url", "http://bridge.test"], runtime);

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
    ], runtime)).toBe(0);
    expect(stdout.at(-1)).toContain('"status": "confirmed"');

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
    ], runtime)).toBe(0);
    expect(stdout.at(-1)).toContain("art_cli_1");

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
});
