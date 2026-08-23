import { createServer, type Server } from "node:http";

import { type BridgeMetrics, type SafeLogger } from "@bridge/observability";

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
  readonly logger?: SafeLogger;
}

export interface WorkerMetricsServer {
  readonly host: string;
  readonly port: number;
  close(): Promise<void>;
}

export function workerMetricsHttpResponse(
  metrics: BridgeMetrics,
  method: string | undefined,
  requestUrl: string | undefined,
): WorkerMetricsHttpResponse {
  const startedAt = performance.now();
  let pathname = "unmatched";
  try {
    pathname = new URL(requestUrl ?? "/", "http://bridge-worker.invalid").pathname;
  } catch {
    // Malformed request targets are deliberately collapsed into the bounded unmatched label.
  }
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
    metrics.recordHttpRequest({
      service: "worker",
      operation,
      statusCode,
      durationMs: Math.max(0, performance.now() - startedAt),
    });
    body = method === "HEAD" ? "" : metrics.renderPrometheus();
    return { statusCode, headers, body };
  }

  metrics.recordHttpRequest({
    service: "worker",
    operation,
    statusCode,
    durationMs: Math.max(0, performance.now() - startedAt),
  });
  return { statusCode, headers, body };
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

export function startWorkerMetricsServer(
  options: WorkerMetricsServerOptions,
): Promise<WorkerMetricsServer> {
  return new Promise((resolve, reject) => {
    const server = createServer((request, response) => {
      const rendered = workerMetricsHttpResponse(options.metrics, request.method, request.url);
      response.writeHead(rendered.statusCode, rendered.headers);
      response.end(rendered.body);
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
