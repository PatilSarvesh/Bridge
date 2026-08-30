import { describe, expect, it, vi } from "vitest";

import { webLivenessResponse, webReadinessResponse } from "./health";

describe("web health surfaces", () => {
  it("reports liveness without probing the API", async () => {
    const response = webLivenessResponse();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ service: "bridge-web", status: "ok" });
  });

  it("reports readiness only when the canonical API readiness endpoint succeeds", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 200 }));

    const response = await webReadinessResponse({
      apiUrl: "https://api.bridge.example/base",
      fetch: fetcher,
      timeoutMs: 100,
    });

    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[0].toString()).toBe("https://api.bridge.example/health/ready");
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      method: "GET",
      cache: "no-store",
      redirect: "error",
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      service: "bridge-web",
      status: "ready",
      checks: [{ name: "api", status: "ready" }],
    });
  });

  it("returns a sanitized failure for an unavailable API", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("postgresql://secret@database/bridge"));

    const response = await webReadinessResponse({
      apiUrl: "http://127.0.0.1:4000",
      fetch: fetcher,
      timeoutMs: 100,
    });
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(body).toContain('"status":"not_ready"');
    expect(body).not.toContain("postgresql");
    expect(body).not.toContain("secret");
  });

  it("rejects credential-bearing or invalid readiness targets without making a request", async () => {
    const fetcher = vi.fn<typeof fetch>();

    const response = await webReadinessResponse({
      apiUrl: "https://bridge:secret@api.bridge.example",
      fetch: fetcher,
      timeoutMs: 100,
    });

    expect(response.status).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();

    const selfReferential = await webReadinessResponse({
      apiUrl: "http://127.0.0.1:3000",
      requestOrigin: "http://127.0.0.1:3000",
      fetch: fetcher,
      timeoutMs: 100,
    });
    expect(selfReferential.status).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("bounds an API probe even when the fetch implementation does not observe abort", async () => {
    const response = await webReadinessResponse({
      apiUrl: "http://127.0.0.1:4000",
      fetch: () => new Promise(() => undefined),
      timeoutMs: 5,
    });

    expect(response.status).toBe(503);
  });
});
