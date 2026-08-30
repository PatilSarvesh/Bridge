export interface GuideStep {
  readonly number: string;
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly code?: string;
  readonly codeLabel?: string;
  readonly note?: string;
}

export interface GuideMode {
  readonly key: string;
  readonly label: string;
  readonly eyebrow: string;
  readonly description: string;
  readonly detail: string;
  readonly code?: string;
  readonly codeLabel?: string;
}

export interface GuideTroubleshootingItem {
  readonly problem: string;
  readonly answer: string;
}

export const guideStarterPrompt = "Build a small feature for this project.";

export const guideSteps: readonly GuideStep[] = [
  {
    number: "01",
    eyebrow: "Keep the service open",
    title: "Start Bridge from its repository",
    description:
      "Run the API and web app from the Bridge checkout. Your project only connects to this running service; installing the CLI does not start Bridge for you.",
    codeLabel: "Bridge repository",
    code: "cd /absolute/path/to/Bridge\npnpm dev\n\ncurl --fail http://127.0.0.1:4000/health/ready",
    note: "Keep this terminal running. The web review workspace is at http://127.0.0.1:3000.",
  },
  {
    number: "02",
    eyebrow: "Install the adapter",
    title: "Package the Bridge CLI",
    description:
      "Create the local CLI tarball once, then install it as a development tool in the project you want an agent to work on.",
    codeLabel: "Build and install",
    code: "cd /absolute/path/to/Bridge\npnpm cli:pack\n\nmkdir my-project && cd my-project\ngit init\npnpm init\npnpm add --save-dev /absolute/path/to/Bridge/dist/bridge-cli-0.1.0.tgz",
  },
  {
    number: "03",
    eyebrow: "Register the repository",
    title: "Initialize Bridge in your project",
    description:
      "Initialization registers a separate Bridge project and writes repository-owned workflow files. Bridge preserves unrelated instruction content and creates the adapter for your chosen client.",
    codeLabel: "Project setup",
    code: 'pnpm exec bridge init --name "My Project" --client codex --api-url http://127.0.0.1:4000\npnpm exec bridge doctor',
    note: "Use bridge init --dry-run first when you want to preview registration and file changes.",
  },
  {
    number: "04",
    eyebrow: "Work normally",
    title: "Give your agent an ordinary build request",
    description:
      "Open your agent in the initialized repository and describe the work normally. The generated instructions activate the Bridge workflow; you do not need to ask the agent to simulate Bridge commands.",
    codeLabel: "Example agent request",
    code: guideStarterPrompt,
  },
  {
    number: "05",
    eyebrow: "Human review",
    title: "Answer questions and review specifications in Bridge",
    description:
      "When the agent reaches meaningful uncertainty, it creates a structured question. Review the options, trade-offs, and rationale in the web UI, then accept the authoritative answer only as a human. Published specifications stay drafts until a human approves the exact version.",
    note: "A blocking question pauses the linked run. Acceptance changes the decision record; it does not silently restart the agent session.",
  },
  {
    number: "06",
    eyebrow: "Verify the handoff",
    title: "Check the observable run evidence",
    description:
      "After the agent has created its run, context snapshot, question, and specifications, run conformance from the same project environment. It reports missing evidence instead of guessing that the workflow completed.",
    codeLabel: "Project repository",
    code: 'pnpm exec bridge conformance --task "Build a small feature for this project."',
  },
];

export const guideChecklist: readonly string[] = [
  "Bridge API readiness returns status ready",
  "The CLI is installed in the target repository",
  "Your agent client can read the generated instructions",
];

export const guideModes: readonly GuideMode[] = [
  {
    key: "cli-rest",
    label: "CLI + REST",
    eyebrow: "Recommended",
    description: "The complete path for agents with terminal access.",
    detail:
      "The CLI is an adapter over Bridge REST. It works without MCP and preserves the same server-side policy and human approval boundary.",
  },
  {
    key: "mcp",
    label: "MCP",
    eyebrow: "Optional",
    description: "Use only when your organization has approved MCP.",
    detail:
      "Start the shared, PostgreSQL-backed MCP service, then add its endpoint during initialization. The generated client configuration contains no credentials.",
    codeLabel: "Approved MCP endpoint",
    code: 'pnpm exec bridge init --name "My Project" --client codex --api-url http://127.0.0.1:4000 --mcp-url http://127.0.0.1:4100/mcp',
  },
  {
    key: "postgresql",
    label: "Durable PostgreSQL",
    eyebrow: "Optional local mode",
    description: "Keep project state across API restarts with an isolated local database.",
    detail:
      "The default demo uses seeded in-memory state. For durable local development, use the repository's local PostgreSQL roles and an explicit loopback target; migrations remain an operator action.",
    codeLabel: "Local-only durable setup",
    code: 'export DATABASE_URL=postgresql://bridge_runtime:bridge_runtime@127.0.0.1:5433/bridge\nexport BRIDGE_DEV_SEED_DATABASE_URL=postgresql://bridge:bridge@127.0.0.1:5433/bridge\nDATABASE_URL="$BRIDGE_DEV_SEED_DATABASE_URL" pnpm db:migrate\npnpm dev:api',
  },
];

export const guideTroubleshooting: readonly GuideTroubleshootingItem[] = [
  {
    problem: "The CLI says Bridge is unreachable",
    answer:
      "Run curl --fail http://127.0.0.1:4000/health/ready from the host first. If host curl succeeds but the agent still cannot connect, its execution environment likely needs local-network access; grant it and retry the same command once. If that is not possible, an approved operator or CI process can run bridge sync and bridge spec pull.",
  },
  {
    problem: "pnpm exec bridge is not found",
    answer:
      "Install the tarball from step 02 in the target repository. If the package is already installed but dependency policy blocks pnpm exec, use ./node_modules/.bin/bridge with the same arguments.",
  },
  {
    problem: "The Bridge page is stuck loading",
    answer:
      "Start the API and web app from the Bridge repository, confirm the readiness endpoint returns ready, then open http://127.0.0.1:3000. Use the same host name consistently instead of mixing localhost and 127.0.0.1 when debugging a development-origin warning.",
  },
  {
    problem: "I need data to survive an API restart",
    answer:
      "Use the optional Durable PostgreSQL path above. Keep the target local and isolated. Never point development migrations or integration tests at a shared or production database.",
  },
];
