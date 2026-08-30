import type { BridgeDatabaseConnectionMode, BridgeMetrics } from "@bridge/observability";

interface TransactionWaiter {
  readonly queuedAt: number;
  readonly resolve: (release: () => void) => void;
}

type MonotonicNow = () => number;

/**
 * Bounds top-level Bridge transactions before they enter the Postgres.js pool.
 * Nested repository transactions reuse their existing slot.
 */
export class PostgresTransactionAdmission {
  private inUse = 0;
  private readonly waiters: TransactionWaiter[] = [];

  constructor(
    private readonly capacity: number,
    private readonly mode: BridgeDatabaseConnectionMode,
    private readonly metrics?: BridgeMetrics,
    private readonly now: MonotonicNow = () => performance.now(),
  ) {
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 100) {
      throw new Error("PostgreSQL transaction admission capacity must be an integer from 1 to 100.");
    }
    this.publish();
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await work();
    } finally {
      release();
    }
  }

  private acquire(): Promise<() => void> {
    const queuedAt = this.now();
    if (this.inUse < this.capacity) {
      this.inUse += 1;
      this.publish(0);
      return Promise.resolve(this.releaseHandle());
    }

    return new Promise((resolve) => {
      this.waiters.push({ queuedAt, resolve });
      this.publish();
    });
  }

  private releaseHandle(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.release();
    };
  }

  private release(): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      this.publish(Math.max(0, this.now() - waiter.queuedAt));
      waiter.resolve(this.releaseHandle());
      return;
    }

    this.inUse -= 1;
    this.publish();
  }

  private publish(waitDurationMs?: number): void {
    this.metrics?.recordDatabaseTransactionAdmission({
      mode: this.mode,
      capacity: this.capacity,
      inUse: this.inUse,
      waiting: this.waiters.length,
      ...(waitDurationMs === undefined ? {} : { waitDurationMs }),
    });
  }
}
