import type { BridgeDetectedSecretType } from "@bridge/observability";
import { describe, expect, it } from "vitest";

import { detectSecret } from "./content-security.js";

describe("Bridge persisted-content secret detection", () => {
  it.each<[BridgeDetectedSecretType, string]>([
    ["bridge_service_token", `brg_srv_${"A".repeat(43)}`],
    ["github_token", `ghp_${"A".repeat(36)}`],
    ["aws_access_key", `AKIA${"A".repeat(16)}`],
    ["google_api_key", `AIza${"A".repeat(35)}`],
    ["slack_token", `xoxb-${"A".repeat(24)}`],
    ["stripe_live_key", `sk_live_${"A".repeat(24)}`],
    ["ai_provider_key", `sk-proj-${"A".repeat(32)}`],
    ["private_key", "-----BEGIN OPENSSH PRIVATE KEY-----"],
    ["bearer_token", `Authorization: Bearer ${"A".repeat(32)}==`],
    ["credential_url", "postgresql://bridge:password@db.example/bridge"],
    ["secret_url_parameter", `https://example.test/callback?access_token=${"A".repeat(32)}`],
  ])("detects %s without returning the matched value", (secretType, value) => {
    const detection = detectSecret({ options: [{ tradeoffs: value }] });
    expect(detection).toEqual({
      fieldPath: "content.options[0].tradeoffs",
      secretType,
    });
    expect(JSON.stringify(detection)).not.toContain(value);
  });

  it("allows documentation placeholders and URLs without embedded credentials", () => {
    expect(detectSecret({
      examples: [
        "brg_srv_...",
        "ghp_example",
        "Authorization: Bearer <token>",
        "postgresql://bridge@db.example/bridge",
        "https://example.test/callback?token=short",
      ],
    })).toBeUndefined();
  });

  it("does not reflect unsafe object keys through the reported field path", () => {
    expect(detectSecret({
      "unsafe\nfield": `brg_srv_${"A".repeat(43)}`,
    })).toEqual({
      fieldPath: "content.field",
      secretType: "bridge_service_token",
    });
  });
});
