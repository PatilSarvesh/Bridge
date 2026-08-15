import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const lookupFunctions = [
  "bridge_lookup_principal_identity_by_oidc(text, text)",
  "bridge_lookup_organization_by_external_id(text)",
  "bridge_lookup_service_token(text)",
  "bridge_get_principal_identity(text)",
  "bridge_get_service_credential(text)",
  "bridge_list_service_credentials(text)",
] as const;

async function migrationSql(): Promise<string> {
  return readFile(
    new URL("../drizzle/0021_bootstrap_directory_security.sql", import.meta.url),
    "utf8",
  );
}

describe("bootstrap directory security migration", () => {
  it("defines bounded security-definer lookups with a safe search path", async () => {
    const migration = await migrationSql();

    for (const functionSignature of lookupFunctions) {
      const functionName = functionSignature.slice(0, functionSignature.indexOf("("));
      expect(migration).toContain(`CREATE OR REPLACE FUNCTION public.${functionName}(`);
      expect(migration).toContain(`REVOKE ALL ON FUNCTION public.${functionSignature} FROM PUBLIC`);
    }

    expect(migration.match(/SECURITY DEFINER/g)).toHaveLength(lookupFunctions.length);
    expect(migration.match(/SET search_path = pg_catalog, public/g)).toHaveLength(lookupFunctions.length);
    expect(migration).toContain(
      "REVOKE ALL ON TABLE\n  public.bridge_organizations,\n  public.bridge_principal_identities,\n  public.bridge_service_credentials\nFROM PUBLIC;",
    );
    expect(migration).not.toMatch(/GRANT\s+.*\s+TO\s+PUBLIC/i);
  });

  it("keeps tenant-scoped directory functions fail-closed", async () => {
    const migration = await migrationSql();
    const currentTenant = "nullif(current_setting('bridge.organization_id', true), '')";

    expect(migration.match(new RegExp(currentTenant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))).toHaveLength(3);
    expect(migration).toContain("c.organization_id = p_organization_id");
    expect(migration).toContain("m.organization_id = nullif(current_setting('bridge.organization_id', true), '')");
  });
});
