const defaultApiUrl = "http://127.0.0.1:4000";
const defaultReadinessTimeoutMs = 2_000;

const healthHeaders = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
} as const;

export interface WebReadinessOptions {
  readonly apiUrl?: string;
  readonly fetch?: typeof fetch;
  readonly requestOrigin?: string;
  readonly timeoutMs?: number;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(`${JSON.stringify(body)}\n`, {
    status,
    headers: healthHeaders,
  });
}

function readinessTarget(apiUrl: string, requestOrigin?: string): URL {
  const url = new URL(apiUrl);
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw new Error("The Bridge API readiness target must be a credential-free HTTP(S) URL.");
  }
  const target = new URL("/health/ready", url);
  if (requestOrigin && target.origin === new URL(requestOrigin).origin) {
    throw new Error("The Bridge web readiness target cannot point back to the web service.");
  }
  return target;
}

function configuredApiUrl(): string {
  return process.env.BRIDGE_WEB_API_URL?.trim() || process.env.NEXT_PUBLIC_BRIDGE_API_URL?.trim() || defaultApiUrl;
}

async function fetchWithin(fetcher: typeof fetch, target: URL, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fetcher(target, {
        method: "GET",
        headers: { accept: "application/json" },
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("The Bridge API readiness probe timed out."));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function webLivenessResponse(): Response {
  return jsonResponse({ service: "bridge-web", status: "ok" }, 200);
}

export async function webReadinessResponse(options: WebReadinessOptions = {}): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? defaultReadinessTimeoutMs;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000) {
    return jsonResponse(
      {
        service: "bridge-web",
        status: "not_ready",
        checks: [{ name: "api", status: "failed" }],
      },
      503,
    );
  }

  try {
    const target = readinessTarget(options.apiUrl ?? configuredApiUrl(), options.requestOrigin);
    const response = await fetchWithin(options.fetch ?? fetch, target, timeoutMs);
    if (!response.ok) throw new Error("The Bridge API is not ready.");
    return jsonResponse(
      {
        service: "bridge-web",
        status: "ready",
        checks: [{ name: "api", status: "ready" }],
      },
      200,
    );
  } catch {
    return jsonResponse(
      {
        service: "bridge-web",
        status: "not_ready",
        checks: [{ name: "api", status: "failed" }],
      },
      503,
    );
  }
}
