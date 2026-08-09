import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { findArtifactHashMismatches, isSameDatabaseTarget } from "./verify-restore.js";

describe("restore verification", () => {
  it("detects artifact content corruption without returning artifact bodies", () => {
    const validBody = "# Approved specification\n";
    expect(findArtifactHashMismatches([
      {
        id: "avr_valid",
        body: validBody,
        contentSha256: createHash("sha256").update(validBody).digest("hex"),
      },
      { id: "avr_changed", body: "changed", contentSha256: "0".repeat(64) },
    ])).toEqual(["avr_changed"]);
  });

  it("treats credentials and connection options as the same database target", () => {
    expect(isSameDatabaseTarget(
      "postgres://restore:one@db.example:5432/bridge_restore?sslmode=require",
      "postgresql://application:two@db.example/bridge_restore",
    )).toBe(true);
    expect(isSameDatabaseTarget(
      "postgresql://restore@db.example/bridge_restore",
      "postgresql://restore@db.example/bridge_production",
    )).toBe(false);
  });
});
