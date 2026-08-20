import assert from "node:assert/strict";
import test from "node:test";

import {
  loadReadinessManifest,
  summarizeReadiness,
  validateReadinessManifest,
} from "./pilot-readiness.mjs";

test("BRG-112 manifest covers every criterion with safe evidence", async () => {
  const manifest = await loadReadinessManifest();
  assert.deepEqual(validateReadinessManifest(manifest), []);
  assert.deepEqual(manifest.checks.map((check) => check.criterion), [1, 2, 3, 4, 5, 6]);
});

test("readiness remains external-evidence gated", async () => {
  const summary = summarizeReadiness(await loadReadinessManifest());
  assert.equal(summary.pilotReady, false);
  assert.equal(summary.decision, "not_ready_for_external_pilot_evidence");
  assert.deepEqual(summary.pendingExternalCriteria, [2, 3, 4, 5, 6]);
  assert.deepEqual(summary.completedCriteria, [1]);
});

test("manifest validation rejects credential-bearing evidence values", async () => {
  const manifest = await loadReadinessManifest();
  const unsafe = structuredClone(manifest);
  unsafe.checks[0].evidence[0].value = "postgresql://user:password@example/bridge";
  assert.match(validateReadinessManifest(unsafe).join("\n"), /unsafe or incomplete evidence/);
});
