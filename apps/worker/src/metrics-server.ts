import { createServer, type Server } from "node:http";

import type { BridgeReadiness } from "@bridge/application";
import type { BridgeMetrics, SafeLogger } from "@bridge/observability";

const prometheusContentType = "text/plain; version=0.0.4; charset=utf-8";

export interface WorkerMetricsHttpResponse {
  readonly statusCode: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface WorkerMetricsServerOptions {
  readonly metrics: BridgeMetrics;
  readonly host: string;
  readonly port: number;
  readonly checkReadiness: () => Promise<BridgeReadiness>;
  readonly readinessTimeoutMs?: number;
  readonly logger?: SafeLogger;
}

export interface WorkerMetricsServer {
  readonly host: string;
  readonly port: number;
  close(): Promise<void>;
}

const healthHeaders = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
} as const;

function requestPath(requestUrl: string | undefined): string {
  try {
    return new URL(requestUrl ?? "/", "http://bridge-worker.invalid").pathname;
  } catch {
    return "unmatched";
  }
}

function jsonBody(value: unknown, method: string | undefined): string {
  return method === "HEAD" ? "" : `${JSON.stringify(value)}\n`;
}

function recordRequest(metrics: BridgeMetrics, operation: string, statusCode: number, startedAt: number): void {
  metrics.recordHttpRequest({
    service: "worker",
    operation,
    statusCode,
    durationMs: Math.max(0, performance.now() - startedAt),
  });
}

export function workerMetricsHttpResponse(
  metrics: BridgeMetrics,
  method: string | undefined,
  requestUrl: string | undefined,
): WorkerMetricsHttpResponse {
  const startedAt = performance.now();
  const pathname = requestPath(requestUrl);
  const operation = pathname === "/metrics" ? "/metrics" : "unmatched";
  let statusCode = 200;
  let body: string;
  const headers: Record<string, string> = {
    "cache-control": "no-store",
    "content-type": "text/plain; charset=utf-8",
    "x-content-type-options": "nosniff",
  };

  if (pathname !== "/metrics") {
    statusCode = 404;
    body = "Not found\n";
  } else if (method !== "GET" && method !== "HEAD") {
    statusCode = 405;
    headers.allow = "GET, HEAD";
    body = "Method not allowed\n";
  } else {
    headers["content-type"] = prometheusContentType;
    recordRequest(metrics, operation, statusCode, startedAt);
    body = method === "HEAD" ? "" : metrics.renderPrometheus();
    return { statusCode, headers, body };
  }

  recordRequest(metrics, operation, statusCode, startedAt);
  return { statusCode, headers, body };
}

async function readinessWithin(
  checkReadiness: () => Promise<BridgeReadiness>,
  timeoutMs: number,
): Promise<BridgeReadiness> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      checkReadiness(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Worker readiness check timed out.")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function workerHttpResponse(
  metrics: BridgeMetrics,
  method: string | undefined,
  requestUrl: string | undefined,
  checkReadiness: () => Promise<BridgeReadiness>,
  readinessTimeoutMs = 2_000,
): Promise<WorkerMetricsHttpResponse> {
  const pathname = requestPath(requestUrl);
  if (pathname !== "/health" && pathname !== "/health/live" && pathname !== "/health/ready") {
    return workerMetricsHttpResponse(metrics, method, requestUrl);
  }

  const startedAt = performance.now();
  const operation = pathname;
  if (method !== "GET" && method !== "HEAD") {
    const statusCode = 405;
    recordRequest(metrics, operation, statusCode, startedAt);
    return {
      statusCode,
      headers: { ...healthHeaders, allow: "GET, HEAD" },
      body: "Method not allowed\n",
    };
  }

  if (pathname === "/health" || pathname === "/health/live") {
    const statusCode = 200;
    recordRequest(metrics, operation, statusCode, startedAt);
    return {
      statusCode,
      headers: healthHeaders,
      body: jsonBody({ service: "bridge-worker", status: "ok" }, method),
    };
  }

  let readiness: BridgeReadiness;
  try {
    if (!Number.isSafeInteger(readinessTimeoutMs) || readinessTimeoutMs < 1 || readinessTimeoutMs > 10_000) {
      throw new Error("Worker readiness timeout is invalid.");
    }
    readiness = await readinessWithin(checkReadiness, readinessTimeoutMs);
  } catch {
    readiness = {
      status: "not_ready",
      checks: [{ name: "repository", status: "failed", message: "Repository dependency is unavailable." }],
    };
  }
  const statusCode = readiness.status === "ready" ? 200 : 503;
  recordRequest(metrics, operation, statusCode, startedAt);
  return {
    statusCode,
    headers: healthHeaders,
    body: jsonBody({ service: "bridge-worker", ...readiness }, method),
  };
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

export function startWorkerMetricsServer(options: WorkerMetricsServerOptions): Promise<WorkerMetricsServer> {
  return new Promise((resolve, reject) => {
    const server = createServer((request, response) => {
      void workerHttpResponse(
        options.metrics,
        request.method,
        request.url,
        options.checkReadiness,
        options.readinessTimeoutMs,
      )
        .then((rendered) => {
          response.writeHead(rendered.statusCode, rendered.headers);
          response.end(rendered.body);
        })
        .catch((error: unknown) => {
          options.logger?.error("worker_http.request_failed", { error, status: "failed" });
          if (response.headersSent) {
            response.destroy();
            return;
          }
          response.writeHead(500, {
            "cache-control": "no-store",
            "content-type": "text/plain; charset=utf-8",
            "x-content-type-options": "nosniff",
          });
          response.end("Internal error\n");
        });
    });
    const startupError = (error: Error): void => {
      reject(error);
    };
    server.once("error", startupError);
    server.listen(options.port, options.host, () => {
      server.removeListener("error", startupError);
      server.on("error", (error) => {
        options.logger?.error("worker_metrics.server_failed", { error, status: "failed" });
      });
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : options.port;
      resolve({
        host: options.host,
        port,
        close: () => closeServer(server),
      });
    });
  });
}
