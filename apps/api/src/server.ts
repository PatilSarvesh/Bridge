import { createPostgresBridgeStore } from "@bridge/database";
import { OidcAuthenticator, type OidcConfiguration } from "@bridge/auth";
import { BridgeMetrics } from "@bridge/observability";
import { createDemoRuntime, createDemoRuntimeWithRepository } from "@bridge/test-support";

import { buildApp } from "./app.js";

const databaseUrl = process.env.DATABASE_URL;
const publicWebUrl = process.env.BRIDGE_PUBLIC_WEB_URL ?? "http://127.0.0.1:3000";
const publicApiUrl = process.env.BRIDGE_PUBLIC_API_URL ?? "http://127.0.0.1:4000";
const configuredOidcIssuer = process.env.BRIDGE_OIDC_ISSUER?.trim();
const oidcEnabled = Boolean(configuredOidcIssuer);
if (process.env.NODE_ENV === "production" && !oidcEnabled) {
  throw new Error("BRIDGE_OIDC_ISSUER is required in production.");
}
if (process.env.NODE_ENV === "production" && oidcEnabled && !databaseUrl) {
  throw new Error("DATABASE_URL is required for durable production organization membership.");
}
const metrics = new BridgeMetrics();
const postgresStore = databaseUrl ? createPostgresBridgeStore(databaseUrl, { metrics }) : undefined;
const runtime = postgresStore
  ? await createDemoRuntimeWithRepository(postgresStore.repository, {
      seedFixtures: !oidcEnabled,
      seedQuestion: !oidcEnabled,
      seedArtifact: !oidcEnabled,
      serviceOptions: {
        publicBaseUrl: publicWebUrl,
        ...(configuredOidcIssuer ? { identityIssuer: configuredOidcIssuer } : {}),
        metrics,
      },
    })
  : await createDemoRuntime({
      seedFixtures: !oidcEnabled,
      seedQuestion: !oidcEnabled,
      seedArtifact: !oidcEnabled,
      serviceOptions: {
        publicBaseUrl: publicWebUrl,
        ...(configuredOidcIssuer ? { identityIssuer: configuredOidcIssuer } : {}),
        metrics,
      },
    });

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required when OIDC authentication is enabled.`);
  return value;
}

let authenticator: OidcAuthenticator | undefined;
if (oidcEnabled) {
  const cliClientId = process.env.BRIDGE_OIDC_CLI_CLIENT_ID?.trim();
  const cliRedirectUri = process.env.BRIDGE_OIDC_CLI_REDIRECT_URI?.trim();
  if (Boolean(cliClientId) !== Boolean(cliRedirectUri)) {
    throw new Error(
      "BRIDGE_OIDC_CLI_CLIENT_ID and BRIDGE_OIDC_CLI_REDIRECT_URI must be configured together.",
    );
  }
  const configuration: OidcConfiguration = {
    issuer: requiredEnvironment("BRIDGE_OIDC_ISSUER"),
    audience: requiredEnvironment("BRIDGE_OIDC_AUDIENCE"),
    clientId: requiredEnvironment("BRIDGE_OIDC_CLIENT_ID"),
    clientSecret: requiredEnvironment("BRIDGE_OIDC_CLIENT_SECRET"),
    sessionSecret: requiredEnvironment("BRIDGE_AUTH_SESSION_SECRET"),
    publicApiUrl,
    publicWebUrl,
    organizationClaim: process.env.BRIDGE_OIDC_ORGANIZATION_CLAIM ?? "org_id",
    ...(process.env.BRIDGE_OIDC_LOGIN_ORGANIZATION
      ? { loginOrganization: process.env.BRIDGE_OIDC_LOGIN_ORGANIZATION }
      : {}),
    ...(cliClientId && cliRedirectUri ? { cliClientId, cliRedirectUri } : {}),
    secureCookies: process.env.BRIDGE_AUTH_INSECURE_COOKIES !== "true",
  };
  authenticator = new OidcAuthenticator(configuration, runtime.repository);

  const bootstrapNames = [
    "BRIDGE_BOOTSTRAP_ORGANIZATION_ID",
    "BRIDGE_BOOTSTRAP_OIDC_ORGANIZATION_ID",
    "BRIDGE_BOOTSTRAP_ORGANIZATION_SLUG",
    "BRIDGE_BOOTSTRAP_ORGANIZATION_NAME",
    "BRIDGE_BOOTSTRAP_ADMIN_ID",
    "BRIDGE_BOOTSTRAP_ADMIN_SUBJECT",
    "BRIDGE_BOOTSTRAP_ADMIN_NAME",
  ] as const;
  const bootstrapRequested = bootstrapNames.some((name) => Boolean(process.env[name]?.trim()));
  if (bootstrapRequested) {
    const values = Object.fromEntries(
      bootstrapNames.map((name) => [name, requiredEnvironment(name)]),
    ) as Record<(typeof bootstrapNames)[number], string>;
    const now = new Date().toISOString();
    await runtime.repository.transaction(async (repository) => {
      await repository.saveOrganization({
        id: values.BRIDGE_BOOTSTRAP_ORGANIZATION_ID,
        externalIdentityProviderId: values.BRIDGE_BOOTSTRAP_OIDC_ORGANIZATION_ID,
        slug: values.BRIDGE_BOOTSTRAP_ORGANIZATION_SLUG,
        name: values.BRIDGE_BOOTSTRAP_ORGANIZATION_NAME,
        createdAt: now,
      });
      await repository.savePrincipalIdentity({
        id: values.BRIDGE_BOOTSTRAP_ADMIN_ID,
        type: "human",
        displayName: values.BRIDGE_BOOTSTRAP_ADMIN_NAME,
        oidcIssuer: `${requiredEnvironment("BRIDGE_OIDC_ISSUER").replace(/\/+$/, "")}/`,
        oidcSubject: values.BRIDGE_BOOTSTRAP_ADMIN_SUBJECT,
        createdAt: now,
      });
      const existingMembership = await repository.getOrganizationMembership(
        values.BRIDGE_BOOTSTRAP_ORGANIZATION_ID,
        values.BRIDGE_BOOTSTRAP_ADMIN_ID,
      );
      if (!existingMembership) {
        await repository.saveOrganizationMembership({
          organizationId: values.BRIDGE_BOOTSTRAP_ORGANIZATION_ID,
          principalId: values.BRIDGE_BOOTSTRAP_ADMIN_ID,
          status: "active",
          roles: ["organization-admin", "project-admin"],
          allProjects: true,
          provisioning: "manual",
          createdAt: now,
          updatedAt: now,
          version: 1,
        });
      }
    }, { organizationId: values.BRIDGE_BOOTSTRAP_ORGANIZATION_ID });
  }
}
const app = await buildApp({
  service: runtime.service,
  principals: runtime.principals,
  ...(authenticator ? { authenticator } : {}),
  ...(authenticator ? { corsOrigin: new URL(publicWebUrl).origin } : {}),
  logger: true,
  metrics,
});

if (postgresStore) {
  app.addHook("onClose", async () => postgresStore.close());
}

const port = Number(process.env.BRIDGE_API_PORT ?? 4000);
const host = process.env.BRIDGE_API_HOST ?? "127.0.0.1";
await app.listen({ host, port });
