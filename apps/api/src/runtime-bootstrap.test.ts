import { describe, expect, it, vi } from "vitest";

import type { PostgresBridgeStore } from "@bridge/database";
import type { DemoRuntime } from "@bridge/test-support";

import {
  createRuntimeForServer,
  type RuntimeBootstrapDependencies,
} from "./runtime-bootstrap.js";

const serviceOptions = { publicBaseUrl: "http://127.0.0.1:3000" };
const runtime = { repository: {}, service: {}, principals: {} } as unknown as DemoRuntime;

function store(repository: PostgresBridgeStore["repository"]): PostgresBridgeStore {
  return { repository, close: vi.fn(async () => undefined) };
}

describe("createRuntimeForServer", () => {
  it("requires an explicit bootstrap connection for durable development", async () => {
    const close = vi.fn(async () => undefined);
    const createPostgresStoreMock = vi.fn(() => ({
      repository: {} as PostgresBridgeStore["repository"],
      close,
    }));
    const createPostgresStore = createPostgresStoreMock as unknown as RuntimeBootstrapDependencies["createPostgresStore"];

    await expect(createRuntimeForServer({
      databaseUrl: "postgresql://runtime/bridge",
      oidcEnabled: false,
      serviceOptions,
    }, {
      createMemoryRuntime: vi.fn(),
      createPostgresStore,
      createRuntimeWithRepository: vi.fn(),
    })).rejects.toThrow("BRIDGE_DEV_SEED_DATABASE_URL is required");
    expect(createPostgresStoreMock).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it("seeds through the explicit bootstrap store and serves through the runtime store", async () => {
    const seedRepository = {} as PostgresBridgeStore["repository"];
    const runtimeRepository = {} as PostgresBridgeStore["repository"];
    const seedStore = store(seedRepository);
    const runtimeStore = store(runtimeRepository);
    const createPostgresStoreMock = vi.fn()
      .mockReturnValueOnce(seedStore)
      .mockReturnValueOnce(runtimeStore);
    const createPostgresStore = createPostgresStoreMock as unknown as RuntimeBootstrapDependencies["createPostgresStore"];
    const createRuntimeWithRepository = vi.fn(async () => runtime);

    const result = await createRuntimeForServer({
      databaseUrl: "postgresql://runtime/bridge",
      devSeedDatabaseUrl: "postgresql://bootstrap/bridge",
      oidcEnabled: false,
      serviceOptions,
    }, {
      createMemoryRuntime: vi.fn(),
      createPostgresStore,
      createRuntimeWithRepository,
    });

    expect(result).toEqual({ runtime, postgresStore: runtimeStore });
    expect(createPostgresStoreMock).toHaveBeenNthCalledWith(1, "postgresql://bootstrap/bridge", {});
    expect(createPostgresStoreMock).toHaveBeenNthCalledWith(2, "postgresql://runtime/bridge", {});
    expect(createRuntimeWithRepository).toHaveBeenNthCalledWith(
      1,
      seedRepository,
      expect.objectContaining({
        seedFixtures: true,
        seedQuestion: true,
        seedArtifact: true,
        seedShowcase: true,
      }),
    );
    expect(createRuntimeWithRepository).toHaveBeenNthCalledWith(
      2,
      runtimeRepository,
      expect.objectContaining({
        seedFixtures: false,
        seedQuestion: false,
        seedArtifact: false,
        seedShowcase: false,
      }),
    );
    expect(seedStore.close).toHaveBeenCalledOnce();
    expect(runtimeStore.close).not.toHaveBeenCalled();
  });
});
