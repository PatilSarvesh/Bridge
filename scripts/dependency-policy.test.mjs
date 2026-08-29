import assert from "node:assert/strict";
import test from "node:test";
import {
  dependencyViolationsForSource,
  findDependencyPolicyViolations,
  packageNameFromSpecifier,
} from "./dependency-policy.mjs";

test("dependency policy resolves scoped and unscoped package names", () => {
  assert.equal(packageNameFromSpecifier("@bridge/domain"), "@bridge/domain");
  assert.equal(packageNameFromSpecifier("@modelcontextprotocol/sdk/server/mcp.js"), "@modelcontextprotocol/sdk");
  assert.equal(packageNameFromSpecifier("fastify/types"), "fastify");
});

test("dependency policy catches forbidden and undeclared imports", () => {
  const violations = dependencyViolationsForSource({
    packageName: "@bridge/domain",
    filePath: "packages/domain/src/index.ts",
    contents: 'import Fastify from "fastify";\nimport thing from "unlisted";\n',
    runtimeDependencies: new Set(),
    developmentDependencies: new Set(),
    peerDependencies: new Set(),
    workspaceNames: new Set(),
    forbiddenImports: { "@bridge/domain": ["fastify"] },
  });
  assert.deepEqual(violations, [
    "packages/domain/src/index.ts: @bridge/domain may not import fastify",
    "packages/domain/src/index.ts: @bridge/domain imports undeclared dependency fastify",
    "packages/domain/src/index.ts: @bridge/domain imports undeclared dependency unlisted",
  ]);
});

test("dependency policy requires workspace imports to be declared directly", () => {
  const violations = dependencyViolationsForSource({
    packageName: "@bridge/application",
    filePath: "packages/application/src/index.ts",
    contents: 'import { BridgeError } from "@bridge/domain";\n',
    runtimeDependencies: new Set(),
    developmentDependencies: new Set(),
    peerDependencies: new Set(),
    workspaceNames: new Set(["@bridge/domain"]),
    forbiddenImports: {},
  });
  assert.deepEqual(violations, [
    "packages/application/src/index.ts: @bridge/application imports undeclared workspace dependency @bridge/domain",
  ]);
});

test("the checked-in workspace satisfies the dependency policy", async () => {
  assert.deepEqual(await findDependencyPolicyViolations(), []);
});
