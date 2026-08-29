import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { composeArguments, composeFile, parseLocalServicesArgs } from "./local-services.mjs";

test("local service commands use the checked-in compose file", () => {
  assert.deepEqual(composeArguments("up"), ["compose", "-f", composeFile, "up", "--detach", "--wait"]);
  assert.deepEqual(composeArguments("down"), ["compose", "-f", composeFile, "down", "--remove-orphans"]);
  assert.deepEqual(composeArguments("reset"), ["compose", "-f", composeFile, "down", "--volumes", "--remove-orphans"]);
});

test("reset requires an explicit destructive confirmation", () => {
  assert.throws(() => parseLocalServicesArgs(["reset"]), /--confirm/);
  assert.deepEqual(parseLocalServicesArgs(["reset", "--confirm"]), {
    command: "reset",
    confirmed: true,
  });
});

test("unknown commands and options fail before Docker is invoked", () => {
  assert.throws(() => parseLocalServicesArgs(["restart"]), /Unknown local service command/);
  assert.throws(() => parseLocalServicesArgs(["up", "--force"]), /Unknown local service option/);
});

test("compose declares durable local dependencies and health gating", async () => {
  const contents = await readFile(new URL("../infra/containers/compose.yaml", import.meta.url), "utf8");
  assert.match(contents, /postgres:16-alpine/);
  assert.match(contents, /minio\/minio:RELEASE\.2024-06-13T22-53-53Z/);
  assert.match(contents, /bridge-postgres-data/);
  assert.match(contents, /bridge-object-storage-data/);
  assert.match(contents, /pg_isready/);
  assert.match(contents, /POSTGRES_DB: bridge/);
  assert.match(contents, /POSTGRES_USER: bridge/);
  assert.match(contents, /POSTGRES_PASSWORD: bridge/);
  assert.doesNotMatch(contents, /BRIDGE_POSTGRES_(DB|USER|PASSWORD)/);
});
