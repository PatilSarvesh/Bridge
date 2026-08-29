import assert from "node:assert/strict";
import test from "node:test";

import { validateLocalEvidenceEnvironment } from "./pilot-readiness-local.mjs";

const validEnvironment = {
  BRIDGE_TEST_DATABASE_URL: "postgresql://bridge:bridge@127.0.0.1:5433/bridge_test",
  BRIDGE_RESTORE_DATABASE_URL: "postgresql://bridge:bridge@127.0.0.1:5433/bridge_restore",
};

test("local evidence rejects missing database targets", () => {
  const result = validateLocalEvidenceEnvironment({});
  assert.equal(result.targets.test, null);
  assert.equal(result.targets.restore, null);
  assert.match(result.errors.join("\n"), /BRIDGE_TEST_DATABASE_URL is required/);
  assert.match(result.errors.join("\n"), /BRIDGE_RESTORE_DATABASE_URL is required/);
});

test("local evidence requires two explicit loopback database targets", () => {
  const result = validateLocalEvidenceEnvironment(validEnvironment);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.targets.test, {
    database: "bridge_test",
    host: "127.0.0.1",
    port: "5433",
  });
  assert.deepEqual(result.targets.restore, {
    database: "bridge_restore",
    host: "127.0.0.1",
    port: "5433",
  });
});

test("local evidence rejects remote database targets", () => {
  const result = validateLocalEvidenceEnvironment({
    ...validEnvironment,
    BRIDGE_TEST_DATABASE_URL: "postgresql://bridge:bridge@db.example/bridge_test",
  });
  assert.match(result.errors.join("\n"), /BRIDGE_TEST_DATABASE_URL must target a loopback host/);
});

test("local evidence rejects the same test and restore database", () => {
  const result = validateLocalEvidenceEnvironment({
    ...validEnvironment,
    BRIDGE_RESTORE_DATABASE_URL: validEnvironment.BRIDGE_TEST_DATABASE_URL,
  });
  assert.match(result.errors.join("\n"), /must target different databases/);
});

test("local evidence rejects a restore target that matches the configured application database", () => {
  const result = validateLocalEvidenceEnvironment({
    ...validEnvironment,
    DATABASE_URL: validEnvironment.BRIDGE_RESTORE_DATABASE_URL,
  });
  assert.match(result.errors.join("\n"), /must not target the configured application database/);
});
