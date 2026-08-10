import { describe, expect, it } from "vitest";

import { principalHasRole, reviewDateFor, type Principal } from "./index.js";

describe("decision review policy", () => {
  const createdAt = new Date("2026-01-01T00:00:00.000Z");

  it("reviews ordinary decisions after 180 days", () => {
    expect(reviewDateFor("high", createdAt)).toBe("2026-06-30T00:00:00.000Z");
  });

  it("reviews protected decisions after 90 days", () => {
    expect(reviewDateFor("protected", createdAt)).toBe("2026-04-01T00:00:00.000Z");
  });
});

describe("project-scoped roles", () => {
  const principal: Principal = {
    id: "usr_scoped_admin",
    type: "human",
    organizationId: "org_one",
    projectIds: ["prj_one", "prj_two"],
    roles: ["organization-member"],
    projectRoles: { prj_one: ["project-admin"] },
    displayName: "Scoped Administrator",
  };

  it("does not leak a role from one project into another", () => {
    expect(principalHasRole(principal, "project-admin", "prj_one")).toBe(true);
    expect(principalHasRole(principal, "project-admin", "prj_two")).toBe(false);
  });
});
