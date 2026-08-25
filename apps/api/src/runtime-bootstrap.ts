import {
  createPostgresBridgeStore,
  type PostgresBridgeStore,
} from "@bridge/database";
import {
  createDemoRuntime,
  createDemoRuntimeWithRepository,
  type DemoRuntime,
  type DemoRuntimeOptions,
} from "@bridge/test-support";
import type { BridgeServiceOptions } from "@bridge/application";

export interface RuntimeBootstrapOptions {
  readonly databaseUrl?: string;
  readonly devSeedDatabaseUrl?: string;
  readonly oidcEnabled: boolean;
  readonly serviceOptions: BridgeServiceOptions;
}

export interface RuntimeBootstrapResult {
  readonly runtime: DemoRuntime;
  readonly postgresStore?: PostgresBridgeStore;
}

export interface RuntimeBootstrapDependencies {
  readonly createMemoryRuntime: typeof createDemoRuntime;
  readonly createPostgresStore: typeof createPostgresBridgeStore;
  readonly createRuntimeWithRepository: typeof createDemoRuntimeWithRepository;
}

const defaultDependencies: RuntimeBootstrapDependencies = {
  createMemoryRuntime: createDemoRuntime,
  createPostgresStore: createPostgresBridgeStore,
  createRuntimeWithRepository: createDemoRuntimeWithRepository,
};

function fixtureOptions(
  oidcEnabled: boolean,
  serviceOptions: BridgeServiceOptions,
): DemoRuntimeOptions {
  return {
    seedFixtures: !oidcEnabled,
    seedQuestion: !oidcEnabled,
    seedArtifact: !oidcEnabled,
    serviceOptions,
  };
}

export async function createRuntimeForServer(
  options: RuntimeBootstrapOptions,
  dependencies: RuntimeBootstrapDependencies = defaultDependencies,
): Promise<RuntimeBootstrapResult> {
  const databaseUrl = options.databaseUrl?.trim();
  const devSeedDatabaseUrl = options.devSeedDatabaseUrl?.trim();

  if (!databaseUrl) {
    if (devSeedDatabaseUrl) {
      throw new Error("BRIDGE_DEV_SEED_DATABASE_URL requires DATABASE_URL.");
    }
    return {
      runtime: await dependencies.createMemoryRuntime(
        fixtureOptions(options.oidcEnabled, options.serviceOptions),
      ),
    };
  }

  if (!options.oidcEnabled && !devSeedDatabaseUrl) {
    throw new Error(
      "BRIDGE_DEV_SEED_DATABASE_URL is required for durable local development without OIDC. "
      + "Keep DATABASE_URL on a non-superuser NOBYPASSRLS role and use a separate local "
      + "bootstrap connection only for development fixture seeding.",
    );
  }

  if (!options.oidcEnabled && devSeedDatabaseUrl) {
    const seedStore = dependencies.createPostgresStore(
      devSeedDatabaseUrl,
      options.serviceOptions.metrics
        ? { metrics: options.serviceOptions.metrics }
        : {},
    );
    try {
      await dependencies.createRuntimeWithRepository(
        seedStore.repository,
        fixtureOptions(options.oidcEnabled, options.serviceOptions),
      );
    } finally {
      await seedStore.close();
    }
  }

  const postgresStore = dependencies.createPostgresStore(
    databaseUrl,
    options.serviceOptions.metrics
      ? { metrics: options.serviceOptions.metrics }
      : {},
  );
  const runtime = await dependencies.createRuntimeWithRepository(
    postgresStore.repository,
    {
      seedFixtures: false,
      seedQuestion: false,
      seedArtifact: false,
      serviceOptions: options.serviceOptions,
    },
  );
  return { runtime, postgresStore };
}
