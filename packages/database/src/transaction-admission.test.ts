import { BridgeMetrics } from "@bridge/observability";
import { describe, expect, it, vi } from "vitest";

import { PostgresBridgeRepository } from "./repository.js";
import { PostgresTransactionAdmission } from "./transaction-admission.js";

function gauge(metrics: BridgeMetrics, name: string): number | undefined {
  return metrics.snapshot().gauges.find((sample) => sample.name === name)?.value;
}

describe("PostgreSQL transaction admission", () => {
  it("publishes bounded initial capacity and rejects unsafe configuration", () => {
    const metrics = new BridgeMetrics();
    new PostgresTransactionAdmission(10, "maintenance", metrics);

    expect(gauge(metrics, "bridge_database_transaction_slots_capacity")).toBe(10);
    expect(gauge(metrics, "bridge_database_transaction_slots_in_use")).toBe(0);
    expect(gauge(metrics, "bridge_database_transaction_slots_waiting")).toBe(0);
    expect(() => new PostgresTransactionAdmission(0, "application", metrics)).toThrow(
      "PostgreSQL transaction admission capacity must be an integer from 1 to 100.",
    );
  });

  it("admits work in FIFO order and reports queue pressure without leaking work details", async () => {
    const metrics = new BridgeMetrics();
    let now = 0;
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const admission = new PostgresTransactionAdmission(1, "application", metrics, () => now);
    const order: string[] = [];

    const first = admission.run(async () => {
      order.push("first:start");
      await firstGate;
      order.push("first:end");
    });
    await Promise.resolve();
    const second = admission.run(async () => {
      order.push("second");
    });
    const third = admission.run(async () => {
      order.push("third");
    });
    await Promise.resolve();

    expect(gauge(metrics, "bridge_database_transaction_slots_in_use")).toBe(1);
    expect(gauge(metrics, "bridge_database_transaction_slots_waiting")).toBe(2);
    expect(order).toEqual(["first:start"]);

    now = 25;
    releaseFirst?.();
    await Promise.all([first, second, third]);

    expect(order).toEqual(["first:start", "first:end", "second", "third"]);
    expect(gauge(metrics, "bridge_database_transaction_slots_in_use")).toBe(0);
    expect(gauge(metrics, "bridge_database_transaction_slots_waiting")).toBe(0);
    expect(metrics.snapshot().histograms).toContainEqual(
      expect.objectContaining({
        name: "bridge_database_transaction_admission_wait_duration_seconds",
        labels: { mode: "application" },
        count: 3,
        sum: 0.05,
      }),
    );
  });

  it("returns a slot after failed work", async () => {
    const metrics = new BridgeMetrics();
    const admission = new PostgresTransactionAdmission(1, "application", metrics);

    await expect(
      admission.run(async () => {
        throw new Error("failed transaction");
      }),
    ).rejects.toThrow("failed transaction");

    expect(gauge(metrics, "bridge_database_transaction_slots_in_use")).toBe(0);
    await expect(admission.run(async () => "recovered")).resolves.toBe("recovered");
  });

  it("admits a repository transaction once while nested work reuses its slot", async () => {
    const metrics = new BridgeMetrics();
    const admission = new PostgresTransactionAdmission(1, "application", metrics);
    const transaction = vi.fn();
    const database = { transaction };
    transaction.mockImplementation(async (work: (scoped: unknown) => Promise<unknown>) => work(database));
    const repository = new PostgresBridgeRepository(database as never, false, metrics, undefined, false, admission);

    await expect(repository.transaction((scoped) => scoped.transaction(async () => "nested result"))).resolves.toBe(
      "nested result",
    );

    expect(transaction).toHaveBeenCalledOnce();
    expect(gauge(metrics, "bridge_database_transaction_slots_in_use")).toBe(0);
    expect(metrics.snapshot().histograms).toContainEqual(
      expect.objectContaining({
        name: "bridge_database_transaction_admission_wait_duration_seconds",
        labels: { mode: "application" },
        count: 1,
      }),
    );
  });
});
