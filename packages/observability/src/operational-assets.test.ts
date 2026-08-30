import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

interface DashboardPanel {
  readonly title?: string;
  readonly targets?: readonly { readonly expr?: string }[];
}

interface DashboardDefinition {
  readonly panels?: readonly DashboardPanel[];
  readonly version?: number;
}

describe("portable observability assets", () => {
  it("keeps database transaction admission metrics visible in the pilot dashboard", () => {
    const dashboard = JSON.parse(
      readFileSync(new URL("../../../config/observability/bridge-pilot-dashboard.json", import.meta.url), "utf8"),
    ) as DashboardDefinition;
    const titles = dashboard.panels?.map((panel) => panel.title) ?? [];
    const expressions =
      dashboard.panels
        ?.flatMap((panel) => panel.targets ?? [])
        .map((target) => target.expr ?? "")
        .join("\n") ?? "";

    expect(dashboard.version).toBe(4);
    expect(titles).toEqual(
      expect.arrayContaining([
        "Database transaction slot utilization",
        "Database transactions waiting for a slot",
        "Database transaction admission p95 wait",
      ]),
    );
    expect(expressions).toContain("bridge_database_transaction_slots_in_use");
    expect(expressions).toContain("bridge_database_transaction_slots_waiting");
    expect(expressions).toContain("bridge_database_transaction_admission_wait_duration_seconds_bucket");
  });

  it("keeps a sustained database transaction saturation alert in the portable rules", () => {
    const rules = readFileSync(
      new URL("../../../config/observability/bridge-pilot-alerts.yml", import.meta.url),
      "utf8",
    );

    expect(rules).toContain("alert: BridgeDatabaseTransactionSaturation");
    expect(rules).toContain("bridge_database_transaction_slots_in_use");
    expect(rules).toContain("bridge_database_transaction_slots_waiting");
    expect(rules).toContain("for: 5m");
  });
});
