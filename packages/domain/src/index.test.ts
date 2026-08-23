import { describe, expect, it } from "vitest";

import {
  assertCanApproveArtifact,
  artifactApprovalStatus,
  assertProjectAccess,
  bridgeScopes,
  principalHasRole,
  principalHasScope,
  reviewDateFor,
  type Artifact,
  type Principal,
  type Project,
} from "./index.js";

describe("decision review policy", () => {
  const createdAt = new Date("2026-01-01T00:00:00.000Z");

  it("reviews ordinary decisions after 180 days", () => {
    expect(reviewDateFor("high", createdAt)).toBe("2026-06-30T00:00:00.000Z");
  });

  it("reviews protected decisions after 90 days", () => {
    expect(reviewDateFor("protected", createdAt)).toBe("2026-04-01T00:00:00.000Z");
  });
});

describe("capability scopes", () => {
  const agent: Principal = {
    id: "agt_scope_test",
    type: "agent",
    organizationId: "org_one",
    projectIds: ["prj_one"],
    roles: ["agent"],
    displayName: "Scoped Agent",
  };

  it("supports least-privilege resource scopes without widening admin capabilities", () => {
    expect(principalHasScope({ ...agent, scopes: [bridgeScopes.questionsRead] }, bridgeScopes.questionsRead)).toBe(true);
    expect(principalHasScope({ ...agent, scopes: [bridgeScopes.questionsRead] }, bridgeScopes.projectsRead)).toBe(false);
    expect(principalHasScope({ ...agent, scopes: [bridgeScopes.read] }, bridgeScopes.questionsRead)).toBe(true);
    expect(principalHasScope({ ...agent, scopes: [bridgeScopes.read] }, bridgeScopes.projectAdmin)).toBe(false);
    expect(principalHasScope({ ...agent, scopes: [bridgeScopes.admin] }, bridgeScopes.projectAdmin)).toBe(true);
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

  it("lets an organization administrator operate every project in only their organization", () => {
    const organizationAdmin: Principal = {
      ...principal,
      projectIds: [],
      roles: ["organization-admin"],
      projectRoles: {},
    };
    const sameOrganization: Project = {
      id: "prj_three",
      organizationId: organizationAdmin.organizationId,
      name: "Project Three",
      decisionOwnerIds: [],
    };
    const otherOrganization: Project = {
      ...sameOrganization,
      id: "prj_other",
      organizationId: "org_other",
    };

    expect(() => assertProjectAccess(organizationAdmin, sameOrganization)).not.toThrow();
    expect(principalHasRole(organizationAdmin, "project-admin", sameOrganization.id)).toBe(true);
    expect(() => assertProjectAccess(organizationAdmin, otherOrganization)).toThrowError(
      expect.objectContaining({ code: "FORBIDDEN" }),
    );
  });

  it("allows a configured project decision owner to approve but never an agent", () => {
    const artifact: Artifact = {
      id: "art_one",
      organizationId: "org_one",
      projectId: "prj_one",
      title: "Architecture decision",
      type: "adr",
      scope: {},
      reviewerIds: ["usr_reviewer"],
      createdById: "agt_one",
      createdByType: "agent",
      createdAt: "2026-01-01T00:00:00.000Z",
      currentVersionId: "av_one",
      versions: [],
    };
    const decisionOwner: Principal = {
      ...principal,
      id: "usr_decision_owner",
      roles: ["contributor"],
      projectRoles: {},
    };
    const publishingAgent: Principal = {
      ...decisionOwner,
      id: "agt_one",
      type: "agent",
      roles: ["agent"],
    };

    expect(() => assertCanApproveArtifact(decisionOwner, artifact, [decisionOwner.id])).not.toThrow();
    expect(() => assertCanApproveArtifact(publishingAgent, artifact, [publishingAgent.id])).toThrowError(
      expect.objectContaining({ code: "FORBIDDEN" }),
    );
  });
});

describe("artifact approval quorum", () => {
  it("derives progress from distinct human approvals and blocks a changed version", () => {
    const version = {
      requiredApprovals: 2,
      status: "in_review" as const,
      reviews: [
        {
          id: "arv_one",
          artifactVersionId: "av_one",
          reviewerId: "usr_one",
          reviewerType: "human" as const,
          status: "approved" as const,
          body: "The first reviewer approves this immutable version.",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "arv_duplicate",
          artifactVersionId: "av_one",
          reviewerId: "usr_one",
          reviewerType: "human" as const,
          status: "approved" as const,
          body: "A duplicate record cannot increase the distinct-human count.",
          createdAt: "2026-01-01T00:01:00.000Z",
        },
      ],
    };

    expect(artifactApprovalStatus(version)).toEqual({
      requiredCount: 2,
      approvedCount: 1,
      remainingCount: 1,
      status: "pending",
      satisfied: false,
      reviewerIds: ["usr_one"],
    });
    expect(artifactApprovalStatus({
      ...version,
      reviews: [...version.reviews, {
        id: "arv_blocked",
        artifactVersionId: "av_one",
        reviewerId: "usr_two",
        reviewerType: "human",
        status: "changes_requested",
        body: "The failure-mode evidence is incomplete.",
        createdAt: "2026-01-01T00:02:00.000Z",
      }],
    })).toMatchObject({ status: "blocked", satisfied: false });
  });
});
