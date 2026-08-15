import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

async function provisioningSql(): Promise<string> {
  return readFile(
    new URL("../../../scripts/provision-postgres-roles.sql", import.meta.url),
    "utf8",
  );
}

describe("PostgreSQL role provisioning contract", () => {
  it("reconciles fail-closed role attributes without handling passwords", async () => {
    const script = await provisioningSql();

    expect(script).toContain("\\set ON_ERROR_STOP on");
    expect(script).toContain("CREATE ROLE %I LOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT");
    expect(script).toContain("CREATE ROLE %I LOGIN NOSUPERUSER BYPASSRLS NOINHERIT");
    expect(script).toContain("ALTER ROLE %I WITH LOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT");
    expect(script).toContain("ALTER ROLE %I WITH LOGIN NOSUPERUSER BYPASSRLS NOINHERIT");
    expect(script).not.toMatch(/PASSWORD\s+/i);
  });

  it("keeps bootstrap data behind functions and verifies the resulting catalog state", async () => {
    const script = await provisioningSql();
    const bootstrapTables = [
      "bridge_organizations",
      "bridge_principal_identities",
      "bridge_service_credentials",
    ];
    const lookupFunctions = [
      "bridge_lookup_principal_identity_by_oidc(text, text)",
      "bridge_lookup_organization_by_external_id(text)",
      "bridge_lookup_service_token(text)",
      "bridge_get_principal_identity(text)",
      "bridge_get_service_credential(text)",
      "bridge_list_service_credentials(text)",
    ];

    expect(script).toContain("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public");
    expect(script).toContain("REVOKE SELECT ON TABLE public.%I FROM %I");
    expect(script).toContain("has_table_privilege(:'bridge_runtime_role'");
    expect(script).toContain("has_function_privilege(:'bridge_runtime_role'");
    expect(script).toContain("ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public");

    for (const table of bootstrapTables) {
      expect(script).toContain(`('${table}')`);
    }
    for (const functionSignature of lookupFunctions) {
      expect(script).toContain(`('${functionSignature}')`);
    }
  });
});
