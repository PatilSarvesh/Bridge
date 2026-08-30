import { describe, expect, it } from "vitest";

import { guideModes, guideSteps, guideStarterPrompt, guideTroubleshooting } from "./user-guide-content";

describe("user guide content", () => {
  it("keeps the recommended setup complete and REST-first", () => {
    expect(guideSteps).toHaveLength(6);
    expect(guideSteps[0]?.code).toContain("/health/ready");
    expect(guideSteps[2]?.code).toContain("bridge init");
    expect(guideSteps[5]?.code).toContain("bridge conformance");
    expect(guideModes.map((mode) => mode.label)).toEqual(["CLI + REST", "MCP", "Durable PostgreSQL"]);
  });

  it("keeps optional setup and human review instructions explicit", () => {
    expect(guideSteps[3]?.code).toBe(guideStarterPrompt);
    expect(guideSteps[4]?.description).toContain("only as a human");
    expect(guideModes[1]?.code).toContain("--mcp-url http://127.0.0.1:4100/mcp");
    expect(guideModes[2]?.code).toContain("BRIDGE_DEV_SEED_DATABASE_URL");
    expect(guideTroubleshooting).toHaveLength(4);
  });
});
