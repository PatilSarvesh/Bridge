import assert from "node:assert/strict";
import test from "node:test";
import { buildTransportSnapshot } from "./contract-schema-gates.mjs";

test("transport snapshot covers templated REST routes and reviewed response categories", async () => {
  const snapshot = await buildTransportSnapshot();

  assert.equal(snapshot.rest.length, 88);
  assert.equal(snapshot.mcp.length, 17);
  assert.deepEqual(snapshot.restContracts["POST /v1/decisions/:decisionId/:action"], {
    requestSchema: "changeDecisionLifecycleInputSchema",
    responseContract: "record",
  });
  assert.deepEqual(snapshot.restContracts["POST /v1/projects/:projectId/questions"], {
    requestSchema: "createQuestionInputSchema",
    responseContract: "record",
  });
  assert.equal(snapshot.restContracts["POST /v1/admin/projects/:projectId/export"].responseContract, "download");
  assert.equal(snapshot.mcpContracts.bridge_start_run.responseContract, "structured");
});
