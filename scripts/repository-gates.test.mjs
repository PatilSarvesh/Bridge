import assert from "node:assert/strict";
import test from "node:test";
import {
  extractMcpTools,
  extractRestRouteBlocks,
  extractRestRoutes,
  findSecrets,
  formatViolations,
} from "./repository-gates.mjs";

test("format gate detects CRLF, trailing whitespace, and missing final newline", () => {
  const violations = formatViolations("fixture.ts", "const value = true; \r\nconst next = false;");
  assert.deepEqual(
    violations.map(({ type, line }) => ({ type, line })),
    [
      { type: "crlf", line: 1 },
      { type: "missing-final-newline", line: 2 },
      { type: "trailing-whitespace", line: 1 },
    ],
  );
});

test("markdown keeps intentional trailing spaces available for hard breaks", () => {
  assert.deepEqual(formatViolations("fixture.md", "line with break  \n"), []);
});

test("REST route extraction normalizes methods and supports typed Fastify routes", () => {
  const source = `
    app.get("/health", handler);
    app.post<{ Body: unknown }>(
      "/v1/questions/:questionId",
      handler,
    );
    app.post(
      \`/v1/decisions/:decisionId/\${action}\`,
      handler,
    );
  `;
  assert.deepEqual(extractRestRoutes(source), [
    "GET /health",
    "POST /v1/decisions/:decisionId/:action",
    "POST /v1/questions/:questionId",
  ]);
  assert.equal(
    extractRestRouteBlocks(source).find((block) => block.name.includes("/decisions/"))?.name,
    "POST /v1/decisions/:decisionId/:action",
  );
});

test("MCP tool extraction returns a stable sorted compatibility list", () => {
  const source = `
    server.registerTool("bridge_z", {}, callback);
    server.registerTool("bridge_a", {}, callback);
  `;
  assert.deepEqual(extractMcpTools(source), ["bridge_a", "bridge_z"]);
});

test("secret scan catches realistic credentials but ignores bounded placeholders", () => {
  const findings = findSecrets(
    "fixture.txt",
    [
      "placeholder: https://hooks.slack.com/services/T000/B000/secret",
      `token: ghp_${"A".repeat(36)}`,
      `key: AKIA${"B".repeat(16)}`,
      "-----BEGIN OPENSSH PRIVATE KEY-----\n" + "A".repeat(48),
    ].join("\n"),
  );
  assert.deepEqual(findings.map(({ type }) => type).sort(), ["aws-access-key", "github-token", "private-key"]);
});
