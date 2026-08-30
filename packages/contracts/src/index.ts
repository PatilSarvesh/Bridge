import { z } from "zod";

export const principalTypeSchema = z.enum(["human", "agent", "ci", "integration"]);
export const questionTypeSchema = z.enum([
  "information",
  "decision",
  "approval",
  "review",
  "assumption_challenge",
  "blocker",
]);
export const questionLinkTypeSchema = z.enum(["repository", "work_item", "branch", "artifact", "run", "external"]);
export const riskSchema = z.enum(["low", "medium", "high", "protected"]);
export const policyActionSchema = z.enum(["assume_and_log", "ask_async", "block", "protected_approval"]);
export const questionStatusSchema = z.enum(["open", "in_discussion", "accepted", "duplicate", "cancelled", "expired"]);
export const questionReviewStatusSchema = z.enum(["approved", "rejected"]);
export const questionDueFilterSchema = z.enum(["overdue", "next_7_days", "scheduled", "none"]);
export const notificationTypeSchema = z.enum([
  "question_assigned",
  "question_blocking_escalation",
  "question_response",
  "question_comment",
  "question_review",
  "question_accepted",
  "decision_lifecycle",
  "assumption_expired",
  "artifact_review_requested",
  "artifact_review_feedback",
  "artifact_approved",
]);
export const outboxEventTypeSchema = z.enum([
  "notification.created",
  "decision.lifecycle_changed",
  "question.reassigned",
  "run.continuation_ready",
]);
export const outboxEventStatusSchema = z.enum(["pending", "processing", "processed", "failed", "dead_letter"]);
export const deliveryChannelSchema = z.enum(["email", "slack"]);
export const outboxDeliveryStatusSchema = z.enum(["delivered", "failed", "suppressed", "deferred"]);
export const notificationDeliveryFeedbackProviderSchema = z.enum(["ses", "slack"]);
export const notificationDeliveryFeedbackTypeSchema = z.enum(["bounce", "complaint", "provider_failure"]);
export const recordOutboxDeliveryFeedbackInputSchema = z
  .object({
    channel: deliveryChannelSchema,
    provider: notificationDeliveryFeedbackProviderSchema,
    providerMessageId: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:/+=-]{0,499}$/),
    type: notificationDeliveryFeedbackTypeSchema,
    receivedAt: z.string().datetime({ offset: true }),
  })
  .superRefine((value, context) => {
    const expectedProvider = value.channel === "email" ? "ses" : "slack";
    if (value.provider !== expectedProvider) {
      context.addIssue({
        code: "custom",
        message: "Feedback provider must match delivery channel.",
        path: ["provider"],
      });
    }
  });
export const auditSourceSchema = z.enum(["web", "api", "cli", "mcp", "application", "worker", "integration"]);
export const notificationDeliveryPreferenceSchema = z.enum(["immediate", "digest", "muted"]);
export const decisionStatusSchema = z.enum(["active", "superseded", "expired", "revoked"]);
export const artifactTypeSchema = z.enum(["prd", "adr", "api_contract", "test_plan"]);
export const artifactVersionStatusSchema = z.enum(["draft", "in_review", "approved", "superseded"]);
export const artifactReviewStatusSchema = z.enum(["commented", "changes_requested", "approved"]);
export const agentRunClientSchema = z.enum(["codex", "claude_code", "cursor", "copilot", "custom", "unknown"]);
export const agentRunCapabilitySchema = z.enum(["instructions", "cli", "mcp", "hooks", "orchestrated"]);
export const agentRunContinuationModeSchema = z.enum(["manual", "automatic"]);
export const adapterDiagnosticMcpStatusSchema = z.enum(["ready", "failed", "not_configured"]);
export const adapterDiagnosticCheckNameSchema = z.enum([
  "api",
  "project-config",
  "project-mapping",
  "mcp",
  "bridge-instructions",
  "client-instructions",
]);
export const adapterDiagnosticCheckStatusSchema = z.enum(["pass", "fail"]);
export const adapterDiagnosticCheckSchema = z.object({
  name: adapterDiagnosticCheckNameSchema,
  status: adapterDiagnosticCheckStatusSchema,
});
export const recordAdapterDiagnosticInputSchema = z
  .object({
    client: agentRunClientSchema,
    capabilities: z.array(agentRunCapabilitySchema).max(10),
    mcpStatus: adapterDiagnosticMcpStatusSchema,
    checks: z.array(adapterDiagnosticCheckSchema).min(1).max(20),
  })
  .superRefine((value, context) => {
    const checkNames = new Set<string>();
    for (const [index, check] of value.checks.entries()) {
      if (checkNames.has(check.name)) {
        context.addIssue({
          code: "custom",
          message: "Each diagnostic check can appear only once.",
          path: ["checks", index, "name"],
        });
      }
      checkNames.add(check.name);
    }
    if (new Set(value.capabilities).size !== value.capabilities.length) {
      context.addIssue({
        code: "custom",
        message: "Each adapter capability can appear only once.",
        path: ["capabilities"],
      });
    }
  });
export const agentRunStatusSchema = z.enum(["running", "waiting_for_human", "completed", "failed", "cancelled"]);
export const assumptionConfidenceSchema = z.enum(["low", "medium", "high"]);
export const assumptionStatusSchema = z.enum(["active", "confirmed", "rejected", "expired", "superseded"]);

export const scopeSchema = z.object({
  repository: z.string().trim().min(1).max(200).optional(),
  component: z.string().trim().min(1).max(200).optional(),
  branch: z.string().trim().min(1).max(300).optional(),
  environment: z.string().trim().min(1).max(100).optional(),
  workItem: z.string().trim().min(1).max(300).optional(),
});

export const ownerRoleSchema = z.string().trim().min(2).max(80);

export const projectRoleDefinitionSchema = z.object({
  name: ownerRoleSchema,
  description: z.string().trim().min(2).max(500),
});

export const projectTeamInputSchema = z.object({
  key: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().trim().min(2).max(120),
  memberIds: z.array(z.string().trim().min(1).max(100)).min(1).max(100),
});

export const ownershipRuleTargetSchema = z.object({
  principalIds: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
  roles: z.array(ownerRoleSchema).max(20).default([]),
  teamKeys: z
    .array(
      z
        .string()
        .trim()
        .min(2)
        .max(80)
        .regex(/^[a-z0-9][a-z0-9-]*$/),
    )
    .max(20)
    .default([]),
});

export const ownershipRuleInputSchema = z
  .object({
    key: z
      .string()
      .trim()
      .min(2)
      .max(80)
      .regex(/^[a-z0-9][a-z0-9-]*$/),
    name: z.string().trim().min(2).max(120),
    priority: z.number().int().min(1).max(1_000),
    category: z.string().trim().min(2).max(100).optional(),
    repository: z.string().trim().min(1).max(200).optional(),
    component: z.string().trim().min(1).max(200).optional(),
    owners: ownershipRuleTargetSchema.default({ principalIds: [], roles: [], teamKeys: [] }),
    reviewers: ownershipRuleTargetSchema.default({ principalIds: [], roles: [], teamKeys: [] }),
  })
  .superRefine((value, context) => {
    const targetCount = (target: z.infer<typeof ownershipRuleTargetSchema>) =>
      target.principalIds.length + target.roles.length + target.teamKeys.length;
    if (targetCount(value.owners) + targetCount(value.reviewers) === 0) {
      context.addIssue({
        code: "custom",
        message: "An ownership rule must configure at least one owner or reviewer target.",
        path: ["owners"],
      });
    }
  });

export const replaceProjectOwnershipInputSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    roles: z.array(projectRoleDefinitionSchema).max(50).default([]),
    teams: z.array(projectTeamInputSchema).max(50).default([]),
    rules: z.array(ownershipRuleInputSchema).max(100).default([]),
  })
  .superRefine((value, context) => {
    const addUniqueIssues = (values: readonly string[], path: "roles" | "teams" | "rules", label: string) => {
      const seen = new Set<string>();
      for (const [index, current] of values.entries()) {
        const normalized = current
          .normalize("NFKC")
          .toLocaleLowerCase("en")
          .replace(/[^\p{L}\p{N}]+/gu, "-")
          .replace(/^-+|-+$/g, "");
        if (seen.has(normalized)) {
          context.addIssue({
            code: "custom",
            message: `${label} values must be unique.`,
            path: [path, index],
          });
        }
        seen.add(normalized);
      }
    };
    addUniqueIssues(
      value.roles.map((role) => role.name),
      "roles",
      "Role name",
    );
    addUniqueIssues(
      value.teams.map((team) => team.key),
      "teams",
      "Team key",
    );
    addUniqueIssues(
      value.rules.map((rule) => rule.key),
      "rules",
      "Rule key",
    );

    for (const [teamIndex, team] of value.teams.entries()) {
      const seen = new Set<string>();
      for (const [memberIndex, memberId] of team.memberIds.entries()) {
        if (seen.has(memberId)) {
          context.addIssue({
            code: "custom",
            message: "A team member can appear only once.",
            path: ["teams", teamIndex, "memberIds", memberIndex],
          });
        }
        seen.add(memberId);
      }
    }
  });

export const projectPolicyRuleInputSchema = z
  .object({
    key: z
      .string()
      .trim()
      .min(2)
      .max(80)
      .regex(/^[a-z0-9][a-z0-9-]*$/),
    name: z.string().trim().min(2).max(120),
    priority: z.number().int().min(1).max(1_000),
    category: z.string().trim().min(2).max(100).optional(),
    scope: scopeSchema.default({}),
    action: policyActionSchema,
    minimumRisk: riskSchema,
    requiredOwnerRoles: z.array(ownerRoleSchema).max(20).default([]),
    requiredReviewerRoles: z.array(ownerRoleSchema).max(20).default([]),
    reviewerQuorum: z.record(z.string().trim().min(1).max(100), z.number().int().min(1).max(20)).optional(),
  })
  .superRefine((value, context) => {
    if (value.action === "assume_and_log" && value.minimumRisk !== "low") {
      context.addIssue({
        code: "custom",
        message: "Assume-and-log rules must keep the minimum risk low.",
        path: ["minimumRisk"],
      });
    }
    if (value.action === "protected_approval" && value.minimumRisk !== "protected") {
      context.addIssue({
        code: "custom",
        message: "Protected-approval rules must set protected minimum risk.",
        path: ["minimumRisk"],
      });
    }
    const reviewerRoles = new Set(
      value.requiredReviewerRoles.map((role) =>
        role
          .normalize("NFKC")
          .toLocaleLowerCase("en")
          .replace(/[^\p{L}\p{N}]+/gu, "-")
          .replace(/^-+|-+$/g, ""),
      ),
    );
    for (const role of Object.keys(value.reviewerQuorum ?? {})) {
      const normalizedRole = role
        .normalize("NFKC")
        .toLocaleLowerCase("en")
        .replace(/[^\p{L}\p{N}]+/gu, "-")
        .replace(/^-+|-+$/g, "");
      if (!reviewerRoles.has(normalizedRole)) {
        context.addIssue({
          code: "custom",
          message: "Reviewer quorum can only be configured for a required reviewer role.",
          path: ["reviewerQuorum", role],
        });
      }
    }
    if (Object.keys(value.reviewerQuorum ?? {}).length > 0 && value.action !== "protected_approval") {
      context.addIssue({
        code: "custom",
        message: "Reviewer quorum is supported only by protected-approval policy.",
        path: ["reviewerQuorum"],
      });
    }
  });

export const replaceProjectPolicyInputSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    rules: z.array(projectPolicyRuleInputSchema).max(100).default([]),
  })
  .superRefine((value, context) => {
    const seenKeys = new Set<string>();
    for (const [index, rule] of value.rules.entries()) {
      const normalized = rule.key.normalize("NFKC").toLocaleLowerCase("en");
      if (seenKeys.has(normalized)) {
        context.addIssue({
          code: "custom",
          message: "Policy rule keys must be unique.",
          path: ["rules", index, "key"],
        });
      }
      seenKeys.add(normalized);
      for (const [field, roles] of [
        ["requiredOwnerRoles", rule.requiredOwnerRoles],
        ["requiredReviewerRoles", rule.requiredReviewerRoles],
      ] as const) {
        const seenRoles = new Set<string>();
        for (const [roleIndex, role] of roles.entries()) {
          const normalizedRole = role
            .normalize("NFKC")
            .toLocaleLowerCase("en")
            .replace(/[^\p{L}\p{N}]+/gu, "-")
            .replace(/^-+|-+$/g, "");
          if (seenRoles.has(normalizedRole)) {
            context.addIssue({
              code: "custom",
              message: "Required policy roles must be unique.",
              path: ["rules", index, field, roleIndex],
            });
          }
          seenRoles.add(normalizedRole);
        }
      }
    }
  });

export const membershipStatusSchema = z.enum(["active", "disabled"]);
export const serviceIdentityTypeSchema = z.enum(["agent", "ci", "integration"]);
export const bridgeCapabilityScopeSchema = z.enum([
  "bridge:read",
  "bridge:write",
  "bridge:admin",
  "bridge:projects:read",
  "bridge:projects:write",
  "bridge:repositories:read",
  "bridge:repositories:write",
  "bridge:context:read",
  "bridge:runs:read",
  "bridge:runs:write",
  "bridge:questions:read",
  "bridge:questions:write",
  "bridge:assumptions:read",
  "bridge:assumptions:write",
  "bridge:decisions:read",
  "bridge:decisions:write",
  "bridge:artifacts:read",
  "bridge:artifacts:write",
  "bridge:notifications:read",
  "bridge:notifications:write",
  "bridge:diagnostics:write",
  "bridge:directory:sync",
  "bridge:organization:read",
  "bridge:organization:admin",
  "bridge:project:admin",
]);
export const bridgeCapabilityScopes = {
  read: "bridge:read",
  write: "bridge:write",
  admin: "bridge:admin",
  projectsRead: "bridge:projects:read",
  projectsWrite: "bridge:projects:write",
  repositoriesRead: "bridge:repositories:read",
  repositoriesWrite: "bridge:repositories:write",
  contextRead: "bridge:context:read",
  runsRead: "bridge:runs:read",
  runsWrite: "bridge:runs:write",
  questionsRead: "bridge:questions:read",
  questionsWrite: "bridge:questions:write",
  assumptionsRead: "bridge:assumptions:read",
  assumptionsWrite: "bridge:assumptions:write",
  decisionsRead: "bridge:decisions:read",
  decisionsWrite: "bridge:decisions:write",
  artifactsRead: "bridge:artifacts:read",
  artifactsWrite: "bridge:artifacts:write",
  notificationsRead: "bridge:notifications:read",
  notificationsWrite: "bridge:notifications:write",
  diagnosticsWrite: "bridge:diagnostics:write",
  directorySync: "bridge:directory:sync",
  organizationRead: "bridge:organization:read",
  organizationAdmin: "bridge:organization:admin",
  projectAdmin: "bridge:project:admin",
} as const satisfies Record<string, z.infer<typeof bridgeCapabilityScopeSchema>>;
export const serviceCapabilityScopeSchema = bridgeCapabilityScopeSchema;

export const projectMembershipConfigurationSchema = z.object({
  projectId: z.string().trim().min(1).max(100),
  roles: z.array(ownerRoleSchema).max(30).default([]),
});

const memberConfigurationSchema = z
  .object({
    roles: z.array(ownerRoleSchema).max(30).default(["organization-member"]),
    allProjects: z.boolean().default(false),
    projectMemberships: z.array(projectMembershipConfigurationSchema).max(100).default([]),
  })
  .superRefine((value, context) => {
    const projectIds = new Set<string>();
    for (const [index, membership] of value.projectMemberships.entries()) {
      if (projectIds.has(membership.projectId)) {
        context.addIssue({
          code: "custom",
          message: "Each project can appear only once.",
          path: ["projectMemberships", index, "projectId"],
        });
      }
      projectIds.add(membership.projectId);
    }
  });

export const createOrganizationMemberInputSchema = memberConfigurationSchema.and(
  z.object({
    oidcSubject: z.string().trim().min(1).max(300),
    displayName: z.string().trim().min(2).max(200),
  }),
);

export const updateOrganizationMemberInputSchema = memberConfigurationSchema.and(
  z.object({
    expectedVersion: z.number().int().positive(),
    status: membershipStatusSchema,
  }),
);

export const createDirectoryGroupInputSchema = z.object({
  provider: z
    .string()
    .trim()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9][a-z0-9._-]*$/),
  issuer: z
    .string()
    .url()
    .max(2_000)
    .refine((value) => value.startsWith("https://"), "issuer must use HTTPS."),
  externalGroupId: z.string().trim().min(1).max(300),
  displayName: z.string().trim().min(2).max(200),
});

export const directoryGroupStatusSchema = z.enum(["active", "disabled"]);
export const syncDirectoryGroupInputSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    sourceUpdatedAt: z.string().datetime({ offset: true }),
    status: directoryGroupStatusSchema,
    members: z
      .array(
        z.object({
          subject: z.string().trim().min(1).max(300),
          displayName: z.string().trim().min(2).max(200),
        }),
      )
      .max(1_000),
  })
  .superRefine((value, context) => {
    if (value.status === "disabled" && value.members.length > 0) {
      context.addIssue({
        code: "custom",
        message: "Disabled provider groups must synchronize an empty member snapshot.",
        path: ["members"],
      });
    }
    const subjects = value.members.map((member) => member.subject);
    if (new Set(subjects).size !== subjects.length) {
      context.addIssue({
        code: "custom",
        message: "Directory member subjects must be unique.",
        path: ["members"],
      });
    }
  });

const serviceIdentityConfigurationSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    type: serviceIdentityTypeSchema,
    roles: z.array(ownerRoleSchema).max(30).default([]),
    allProjects: z.boolean().default(false),
    projectMemberships: z.array(projectMembershipConfigurationSchema).max(100).default([]),
    scopes: z.array(serviceCapabilityScopeSchema).min(1).max(30),
    expiresAt: z.string().datetime({ offset: true }).optional(),
  })
  .superRefine((value, context) => {
    const projectIds = new Set<string>();
    for (const [index, membership] of value.projectMemberships.entries()) {
      if (projectIds.has(membership.projectId)) {
        context.addIssue({
          code: "custom",
          message: "Each project can appear only once.",
          path: ["projectMemberships", index, "projectId"],
        });
      }
      projectIds.add(membership.projectId);
    }
  });

export const createServiceIdentityInputSchema = serviceIdentityConfigurationSchema;
export const revokeServiceIdentityInputSchema = z.object({
  expectedVersion: z.number().int().positive(),
});
export const rotateServiceIdentityInputSchema = z.object({
  expectedVersion: z.number().int().positive(),
});

export const registerProjectInputSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(200),
  name: z.string().trim().min(2).max(200),
  decisionOwnerIds: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
});

export const repositoryProviderSchema = z
  .string()
  .trim()
  .min(2)
  .max(50)
  .regex(/^[a-z0-9][a-z0-9._-]*$/);
export const linkRepositoryInputSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(200),
  provider: repositoryProviderSchema,
  owner: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(200),
  canonicalUrl: z
    .string()
    .url()
    .max(2_000)
    .refine(
      (value) => value.startsWith("http://") || value.startsWith("https://"),
      "canonicalUrl must use HTTP or HTTPS.",
    ),
});

export const githubPullRequestStateSchema = z.enum(["open", "closed", "merged"]);
export const syncGithubPullRequestInputSchema = z
  .object({
    repositoryId: z.string().trim().min(1).max(100),
    number: z.number().int().positive().max(2_147_483_647),
    title: z.string().trim().min(1).max(500),
    state: githubPullRequestStateSchema,
    canonicalUrl: z
      .string()
      .url()
      .max(2_000)
      .refine(
        (value) => value.startsWith("https://github.com/"),
        "canonicalUrl must be an HTTPS GitHub pull-request URL.",
      ),
    headBranch: z.string().trim().min(1).max(300),
    baseBranch: z.string().trim().min(1).max(300),
    headSha: z
      .string()
      .trim()
      .regex(/^[0-9a-f]{40}$/),
    sourceUpdatedAt: z.string().datetime({ offset: true }),
    decisionIds: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
    artifactVersionIds: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
  })
  .superRefine((value, context) => {
    for (const [field, values] of [
      ["decisionIds", value.decisionIds],
      ["artifactVersionIds", value.artifactVersionIds],
    ] as const) {
      if (new Set(values).size !== values.length) {
        context.addIssue({
          code: "custom",
          message: `${field} values must be unique.`,
          path: [field],
        });
      }
    }
  });

export const githubPullRequestListQuerySchema = z.object({
  repositoryId: z.string().trim().min(1).max(100).optional(),
  state: githubPullRequestStateSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const githubPullRequestContextQuerySchema = z.object({
  repositoryId: z.string().trim().min(1).max(100),
});

export const githubIssueStateSchema = z.enum(["open", "closed"]);
export const syncGithubIssueInputSchema = z
  .object({
    repositoryId: z.string().trim().min(1).max(100),
    number: z.number().int().positive().max(2_147_483_647),
    title: z.string().trim().min(1).max(500),
    state: githubIssueStateSchema,
    canonicalUrl: z
      .string()
      .url()
      .max(2_000)
      .refine((value) => value.startsWith("https://github.com/"), "canonicalUrl must be an HTTPS GitHub issue URL."),
    labels: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
    sourceUpdatedAt: z.string().datetime({ offset: true }),
    decisionIds: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
    artifactVersionIds: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
  })
  .superRefine((value, context) => {
    for (const [field, values] of [
      ["labels", value.labels],
      ["decisionIds", value.decisionIds],
      ["artifactVersionIds", value.artifactVersionIds],
    ] as const) {
      const normalized = field === "labels" ? values.map((label) => label.toLocaleLowerCase("en")) : values;
      if (new Set(normalized).size !== values.length) {
        context.addIssue({
          code: "custom",
          message: `${field} values must be unique.`,
          path: [field],
        });
      }
    }
  });

export const githubIssueListQuerySchema = z.object({
  repositoryId: z.string().trim().min(1).max(100).optional(),
  state: githubIssueStateSchema.optional(),
  label: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const githubIssueContextQuerySchema = z.object({
  repositoryId: z.string().trim().min(1).max(100),
});

export const questionOptionInputSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9][a-z0-9_-]*$/),
  label: z.string().trim().min(1).max(500),
  tradeoffs: z.string().trim().min(1).max(2_000),
});

export const createQuestionInputSchema = z
  .object({
    idempotencyKey: z.string().trim().min(8).max(200),
    runId: z.string().trim().min(1).max(100).optional(),
    title: z.string().trim().min(8).max(300),
    type: questionTypeSchema,
    category: z.string().trim().min(2).max(100),
    context: z.string().trim().min(10).max(10_000),
    whyItMatters: z.string().trim().min(10).max(4_000),
    intendedOwnerIds: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
    intendedOwnerRoles: z.array(ownerRoleSchema).max(20).default([]),
    risk: riskSchema,
    reversible: z.boolean(),
    blocking: z.boolean(),
    dueAt: z.string().datetime({ offset: true }).optional(),
    options: z.array(questionOptionInputSchema).max(10).default([]),
    recommendationKey: z.string().trim().min(1).max(80).optional(),
    fallback: z.string().trim().min(1).max(2_000).nullable().optional(),
    relatedLinks: z
      .array(
        z.object({
          type: questionLinkTypeSchema,
          label: z.string().trim().min(1).max(200),
          url: z.string().url().max(2_000),
        }),
      )
      .max(20)
      .optional(),
    scope: scopeSchema.default({}),
  })
  .superRefine((value, context) => {
    if (["decision", "approval", "blocker"].includes(value.type) && value.options.length < 2) {
      context.addIssue({
        code: "custom",
        message: "Decision, approval, and blocker questions require at least two options.",
        path: ["options"],
      });
    }
    if (value.recommendationKey && !value.options.some((option) => option.key === value.recommendationKey)) {
      context.addIssue({
        code: "custom",
        message: "recommendationKey must reference one of the supplied options.",
        path: ["recommendationKey"],
      });
    }
  });

export const findQuestionMatchesInputSchema = z.object({
  title: z.string().trim().min(8).max(300),
  type: questionTypeSchema,
  category: z.string().trim().min(2).max(100),
  context: z.string().trim().min(10).max(10_000),
  risk: riskSchema.optional(),
  reversible: z.boolean().optional(),
  blocking: z.boolean().optional(),
  scope: scopeSchema.default({}),
  maxItems: z.number().int().min(1).max(20).default(5),
});

export const questionInboxQuerySchema = z.object({
  status: questionStatusSchema.optional(),
  risk: riskSchema.optional(),
  category: z.string().trim().min(2).max(100).optional(),
  role: ownerRoleSchema.optional(),
  due: questionDueFilterSchema.optional(),
});

export const questionAudienceViewQuerySchema = z.object({
  role: ownerRoleSchema,
  mode: z.enum(["explain", "rewrite"]).default("explain"),
});

export const questionDecisionDigestQuerySchema = z.object({
  category: z.string().trim().min(2).max(100).optional(),
  maxDigests: z.coerce.number().int().min(1).max(20).default(10),
  maxQuestionsPerDigest: z.coerce.number().int().min(2).max(20).default(10),
});

export const questionSubmissionDispositionSchema = z.enum([
  "created",
  "idempotent_replay",
  "reused_pending",
  "reused_accepted",
]);

export const proposeAnswerInputSchema = z.object({
  answer: z.string().trim().min(2).max(5_000),
  rationale: z.string().trim().min(2).max(5_000),
  optionKey: z.string().trim().min(1).max(80).optional(),
  mentionedPrincipalIds: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
});

export const acceptAnswerInputSchema = z
  .object({
    optionKey: z.string().trim().min(1).max(80).optional(),
    answer: z.string().trim().min(2).max(5_000).optional(),
    rationale: z.string().trim().min(10).max(5_000),
  })
  .refine((value) => Boolean(value.optionKey || value.answer), {
    message: "Either optionKey or answer is required.",
  });

export const overrideQuestionApprovalInputSchema = acceptAnswerInputSchema.extend({
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().min(10).max(2_000),
});

export const changeDecisionLifecycleInputSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    status: z.enum(["superseded", "expired", "revoked"]),
    rationale: z.string().trim().min(10).max(5_000),
    replacementDecisionId: z.string().trim().min(1).max(100).optional(),
  })
  .superRefine((value, context) => {
    if (value.status === "superseded" && !value.replacementDecisionId) {
      context.addIssue({
        code: "custom",
        message: "A superseded decision requires replacementDecisionId.",
        path: ["replacementDecisionId"],
      });
    }
    if (value.status !== "superseded" && value.replacementDecisionId) {
      context.addIssue({
        code: "custom",
        message: "replacementDecisionId is valid only for a superseded decision.",
        path: ["replacementDecisionId"],
      });
    }
  });

export const questionReviewInputSchema = z.object({
  expectedVersion: z.number().int().positive(),
  status: questionReviewStatusSchema,
  rationale: z.string().trim().min(10).max(5_000),
});

export const reassignQuestionInputSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    ownerIds: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
    ownerRoles: z.array(ownerRoleSchema).max(20).default([]),
    reviewerIds: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
    reviewerRoles: z.array(ownerRoleSchema).max(20).default([]),
    reason: z.string().trim().min(10).max(2_000),
  })
  .superRefine((value, context) => {
    for (const [field, values] of [
      ["ownerIds", value.ownerIds],
      ["reviewerIds", value.reviewerIds],
    ] as const) {
      const seen = new Set<string>();
      for (const [index, id] of values.entries()) {
        if (seen.has(id)) {
          context.addIssue({
            code: "custom",
            message: "Assignment principal IDs must be unique.",
            path: [field, index],
          });
        }
        seen.add(id);
      }
    }
  });

export const questionCommentInputSchema = z.object({
  expectedVersion: z.number().int().positive(),
  body: z.string().trim().min(2).max(5_000),
  parentCommentId: z.string().trim().min(1).max(100).optional(),
  mentionedPrincipalIds: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
});

export const editQuestionResponseInputSchema = z.object({
  expectedVersion: z.number().int().positive(),
  answer: z.string().trim().min(2).max(5_000),
  rationale: z.string().trim().min(2).max(5_000),
  optionKey: z.string().trim().min(1).max(80).optional(),
  mentionedPrincipalIds: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
});

export const editQuestionCommentInputSchema = z.object({
  expectedVersion: z.number().int().positive(),
  body: z.string().trim().min(2).max(5_000),
  mentionedPrincipalIds: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
});

export const questionClarificationInputSchema = z.object({
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().min(10).max(2_000),
});

export const notificationListQuerySchema = z.object({
  projectId: z.string().trim().min(1).max(100).optional(),
  unreadOnly: z.boolean().default(false),
});

export const notificationReadAllInputSchema = z.object({
  projectId: z.string().trim().min(1).max(100).optional(),
});

export const notificationPreferenceInputSchema = z.object({
  channel: z.literal("email"),
  preference: notificationDeliveryPreferenceSchema,
});

export const outboxOperationsQuerySchema = z.object({
  status: outboxEventStatusSchema.optional(),
  type: outboxEventTypeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const projectAnalyticsQuerySchema = z
  .object({
    client: agentRunClientSchema.optional(),
    startedFrom: z.string().datetime({ offset: true }).optional(),
    startedTo: z.string().datetime({ offset: true }).optional(),
  })
  .superRefine((value, context) => {
    if (value.startedFrom && value.startedTo && Date.parse(value.startedFrom) > Date.parse(value.startedTo)) {
      context.addIssue({
        code: "custom",
        message: "startedFrom must not be after startedTo.",
        path: ["startedFrom"],
      });
    }
  });

const auditFilterFields = {
  action: z.string().trim().min(1).max(200).optional(),
  actorId: z.string().trim().min(1).max(100).optional(),
  source: auditSourceSchema.optional(),
  subjectType: z.string().trim().min(1).max(100).optional(),
  subjectId: z.string().trim().min(1).max(100).optional(),
  correlationId: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/)
    .optional(),
  createdFrom: z.string().datetime({ offset: true }).optional(),
  createdTo: z.string().datetime({ offset: true }).optional(),
};

function validateAuditDateRange(
  value: { readonly createdFrom?: string | undefined; readonly createdTo?: string | undefined },
  context: z.RefinementCtx,
): void {
  if (value.createdFrom && value.createdTo && Date.parse(value.createdFrom) > Date.parse(value.createdTo)) {
    context.addIssue({
      code: "custom",
      message: "createdFrom must not be after createdTo.",
      path: ["createdFrom"],
    });
  }
}

export const auditListQuerySchema = z
  .object({
    ...auditFilterFields,
    offset: z.coerce.number().int().min(0).max(10_000).default(0),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .superRefine(validateAuditDateRange);

export const auditExportInputSchema = z
  .object({
    ...auditFilterFields,
    format: z.enum(["json", "csv"]).default("json"),
    maxItems: z.number().int().min(1).max(5_000).default(1_000),
  })
  .superRefine(validateAuditDateRange);

export const projectDataExportInputSchema = z.object({
  decisionOffset: z.number().int().min(0).max(10_000).default(0),
  maxDecisions: z.number().int().min(1).max(1_000).default(1_000),
  artifactOffset: z.number().int().min(0).max(10_000).default(0),
  maxArtifacts: z.number().int().min(1).max(100).default(100),
  auditOffset: z.number().int().min(0).max(10_000).default(0),
  maxAuditItems: z.number().int().min(1).max(5_000).default(5_000),
});

export const replayOutboxEventInputSchema = z.object({
  expectedAttempts: z.number().int().nonnegative(),
});

export const contextQuerySchema = z.object({
  runId: z.string().trim().min(1).max(100).optional(),
  task: z.string().trim().min(3).max(2_000),
  scope: scopeSchema.default({}),
  categories: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
  maxItems: z.number().int().min(1).max(50).default(20),
});

export const decisionListQuerySchema = z
  .object({
    includeHistory: z.boolean().default(false),
    search: z.string().trim().min(2).max(200).optional(),
    status: decisionStatusSchema.optional(),
    category: z.string().trim().min(2).max(100).optional(),
    ownerId: z.string().trim().min(1).max(100).optional(),
    createdFrom: z.string().datetime({ offset: true }).optional(),
    createdTo: z.string().datetime({ offset: true }).optional(),
    scope: scopeSchema.default({}),
  })
  .superRefine((value, context) => {
    if (value.createdFrom && value.createdTo && Date.parse(value.createdFrom) > Date.parse(value.createdTo)) {
      context.addIssue({
        code: "custom",
        message: "createdFrom must not be after createdTo.",
        path: ["createdFrom"],
      });
    }
  });

export const decisionConflictQuerySchema = z.object({
  category: z.string().trim().min(2).max(100).optional(),
  scope: scopeSchema.default({}),
  maxItems: z.coerce.number().int().min(1).max(100).default(50),
});

export const decisionImpactQuerySchema = z.object({
  maxDepth: z.coerce.number().int().min(1).max(8).default(5),
  maxNodes: z.coerce.number().int().min(10).max(500).default(200),
});

export const publishArtifactInputSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(200),
  artifactId: z.string().trim().min(1).max(100).optional(),
  runId: z.string().trim().min(1).max(100).optional(),
  title: z.string().trim().min(4).max(300),
  type: artifactTypeSchema,
  summary: z.string().trim().min(10).max(4_000),
  body: z.string().trim().min(20).max(262_144),
  intendedReviewerIds: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
  intendedReviewerRoles: z.array(ownerRoleSchema).max(20).optional(),
  intendedReviewerTeamKeys: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
  requiredApprovals: z.number().int().min(1).max(20).default(1),
  citedDecisionIds: z.array(z.string().trim().min(1).max(100)).max(100).default([]),
  requestReview: z.boolean().default(true),
  scope: scopeSchema.default({}),
});

export const approveArtifactVersionInputSchema = z.object({
  rationale: z.string().trim().min(10).max(5_000),
});

export const artifactReviewInputSchema = z
  .object({
    status: z.enum(["commented", "changes_requested"]),
    body: z.string().trim().min(2).max(5_000),
  })
  .superRefine((value, context) => {
    if (value.status === "changes_requested" && value.body.length < 10) {
      context.addIssue({
        code: "custom",
        message: "A change request requires at least 10 characters of actionable feedback.",
        path: ["body"],
      });
    }
  });

export const artifactVersionDiffQuerySchema = z.object({
  fromVersionId: z.string().trim().min(1).max(100),
  toVersionId: z.string().trim().min(1).max(100),
});

export const startAgentRunInputSchema = z
  .object({
    idempotencyKey: z.string().trim().min(8).max(200),
    client: agentRunClientSchema,
    capability: agentRunCapabilitySchema,
    continuationMode: agentRunContinuationModeSchema.optional(),
    vendorSessionId: z.string().trim().uuid().optional(),
    taskSummary: z.string().trim().min(3).max(2_000),
    scope: scopeSchema.default({}),
    externalLinks: z.array(z.string().url().max(2_000)).max(20).default([]),
    continuesRunId: z.string().trim().min(1).max(100).optional(),
    resumeContextKey: z.string().trim().min(20).max(500).optional(),
  })
  .superRefine((value, context) => {
    if (Boolean(value.continuesRunId) !== Boolean(value.resumeContextKey)) {
      context.addIssue({
        code: "custom",
        message: "continuesRunId and resumeContextKey must be supplied together.",
        path: [value.continuesRunId ? "resumeContextKey" : "continuesRunId"],
      });
    }
    const continuationMode = value.continuationMode ?? "manual";
    if (continuationMode === "automatic") {
      if (value.client !== "codex") {
        context.addIssue({
          code: "custom",
          message: "Automatic continuation is currently supported only for Codex runs.",
          path: ["client"],
        });
      }
      if (!value.vendorSessionId) {
        context.addIssue({
          code: "custom",
          message: "Automatic continuation requires a Codex vendorSessionId.",
          path: ["vendorSessionId"],
        });
      }
      if (!["hooks", "orchestrated"].includes(value.capability)) {
        context.addIssue({
          code: "custom",
          message: "Automatic continuation requires hooks or orchestrated capability.",
          path: ["capability"],
        });
      }
    } else if (value.vendorSessionId) {
      context.addIssue({
        code: "custom",
        message: "vendorSessionId is allowed only for automatic continuation.",
        path: ["vendorSessionId"],
      });
    }
  });

export const reportAgentRunInputSchema = z.object({
  expectedVersion: z.number().int().positive(),
  status: agentRunStatusSchema,
  summary: z.string().trim().min(3).max(4_000).optional(),
  resultLinks: z.array(z.string().url().max(2_000)).max(20).default([]),
});

export const continuationQuerySchema = z.object({
  resumeContextKey: z.string().trim().min(20).max(500),
});

export const recordAssumptionInputSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(200),
  runId: z.string().trim().min(1).max(100).optional(),
  statement: z.string().trim().min(10).max(2_000),
  rationale: z.string().trim().min(10).max(4_000),
  category: z.string().trim().min(2).max(100),
  risk: riskSchema,
  confidence: assumptionConfidenceSchema,
  reversible: z.boolean(),
  reversalCost: z.string().trim().min(3).max(2_000),
  expiresAt: z.string().datetime({ offset: true }).optional(),
  scope: scopeSchema.default({}),
  sourceLinks: z.array(z.string().url().max(2_000)).max(20).default([]),
});

export const resolveAssumptionInputSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    status: z.enum(["confirmed", "rejected", "expired", "superseded"]),
    rationale: z.string().trim().min(10).max(5_000),
    confirmedDecisionId: z.string().trim().min(1).max(100).optional(),
    createDecision: z.boolean().optional(),
    supersedingAssumptionId: z.string().trim().min(1).max(100).optional(),
  })
  .superRefine((value, context) => {
    if (value.status === "superseded" && !value.supersedingAssumptionId) {
      context.addIssue({
        code: "custom",
        message: "A superseded assumption requires supersedingAssumptionId.",
        path: ["supersedingAssumptionId"],
      });
    }
    if (value.status !== "superseded" && value.supersedingAssumptionId) {
      context.addIssue({
        code: "custom",
        message: "supersedingAssumptionId is valid only for a superseded assumption.",
        path: ["supersedingAssumptionId"],
      });
    }
    if (value.status !== "confirmed" && value.confirmedDecisionId) {
      context.addIssue({
        code: "custom",
        message: "confirmedDecisionId is valid only for a confirmed assumption.",
        path: ["confirmedDecisionId"],
      });
    }
    if (value.status !== "confirmed" && value.createDecision) {
      context.addIssue({
        code: "custom",
        message: "createDecision is valid only for a confirmed assumption.",
        path: ["createDecision"],
      });
    }
    if (value.confirmedDecisionId && value.createDecision) {
      context.addIssue({
        code: "custom",
        message: "Choose an existing confirmedDecisionId or createDecision, not both.",
        path: ["createDecision"],
      });
    }
  });

export type PrincipalType = z.infer<typeof principalTypeSchema>;
export type QuestionType = z.infer<typeof questionTypeSchema>;
export type Risk = z.infer<typeof riskSchema>;
export type PolicyAction = z.infer<typeof policyActionSchema>;
export type QuestionStatus = z.infer<typeof questionStatusSchema>;
export type QuestionReviewStatus = z.infer<typeof questionReviewStatusSchema>;
export type NotificationType = z.infer<typeof notificationTypeSchema>;
export type OutboxEventType = z.infer<typeof outboxEventTypeSchema>;
export type OutboxEventStatus = z.infer<typeof outboxEventStatusSchema>;
export type DeliveryChannel = z.infer<typeof deliveryChannelSchema>;
export type OutboxDeliveryStatus = z.infer<typeof outboxDeliveryStatusSchema>;
export type NotificationDeliveryFeedbackProvider = z.infer<typeof notificationDeliveryFeedbackProviderSchema>;
export type NotificationDeliveryFeedbackType = z.infer<typeof notificationDeliveryFeedbackTypeSchema>;
export type AuditSource = z.infer<typeof auditSourceSchema>;
export type NotificationDeliveryPreference = z.infer<typeof notificationDeliveryPreferenceSchema>;
export type AdapterDiagnosticMcpStatus = z.infer<typeof adapterDiagnosticMcpStatusSchema>;
export type AdapterDiagnosticCheckName = z.infer<typeof adapterDiagnosticCheckNameSchema>;
export type AdapterDiagnosticCheckStatus = z.infer<typeof adapterDiagnosticCheckStatusSchema>;
export type AdapterDiagnosticCheck = z.infer<typeof adapterDiagnosticCheckSchema>;
export type DecisionStatus = z.infer<typeof decisionStatusSchema>;
export type ArtifactType = z.infer<typeof artifactTypeSchema>;
export type ArtifactVersionStatus = z.infer<typeof artifactVersionStatusSchema>;
export type ArtifactReviewStatus = z.infer<typeof artifactReviewStatusSchema>;
export type AgentRunClient = z.infer<typeof agentRunClientSchema>;
export type AgentRunCapability = z.infer<typeof agentRunCapabilitySchema>;
export type AgentRunContinuationMode = z.infer<typeof agentRunContinuationModeSchema>;
export type AgentRunStatus = z.infer<typeof agentRunStatusSchema>;
export type AssumptionConfidence = z.infer<typeof assumptionConfidenceSchema>;
export type AssumptionStatus = z.infer<typeof assumptionStatusSchema>;
export type Scope = z.infer<typeof scopeSchema>;
export type MembershipStatus = z.infer<typeof membershipStatusSchema>;
export type ServiceIdentityType = z.infer<typeof serviceIdentityTypeSchema>;
export type BridgeCapabilityScope = z.infer<typeof bridgeCapabilityScopeSchema>;
export type ServiceCapabilityScope = z.infer<typeof serviceCapabilityScopeSchema>;
export type ProjectMembershipConfiguration = z.infer<typeof projectMembershipConfigurationSchema>;
export type ProjectRoleDefinitionInput = z.infer<typeof projectRoleDefinitionSchema>;
export type ProjectTeamInput = z.infer<typeof projectTeamInputSchema>;
export type OwnershipRuleTargetInput = z.infer<typeof ownershipRuleTargetSchema>;
export type OwnershipRuleInput = z.infer<typeof ownershipRuleInputSchema>;
export type ReplaceProjectOwnershipInput = z.infer<typeof replaceProjectOwnershipInputSchema>;
export type ProjectPolicyRuleInput = z.infer<typeof projectPolicyRuleInputSchema>;
export type ReplaceProjectPolicyInput = z.infer<typeof replaceProjectPolicyInputSchema>;
export type CreateOrganizationMemberInput = z.infer<typeof createOrganizationMemberInputSchema>;
export type UpdateOrganizationMemberInput = z.infer<typeof updateOrganizationMemberInputSchema>;
export type CreateDirectoryGroupInput = z.infer<typeof createDirectoryGroupInputSchema>;
export type DirectoryGroupStatus = z.infer<typeof directoryGroupStatusSchema>;
export type SyncDirectoryGroupInput = z.infer<typeof syncDirectoryGroupInputSchema>;
export type CreateServiceIdentityInput = z.infer<typeof createServiceIdentityInputSchema>;
export type RevokeServiceIdentityInput = z.infer<typeof revokeServiceIdentityInputSchema>;
export type RotateServiceIdentityInput = z.infer<typeof rotateServiceIdentityInputSchema>;
export type RegisterProjectInput = z.infer<typeof registerProjectInputSchema>;
export type LinkRepositoryInput = z.infer<typeof linkRepositoryInputSchema>;
export type GithubPullRequestState = z.infer<typeof githubPullRequestStateSchema>;
export type SyncGithubPullRequestInput = z.infer<typeof syncGithubPullRequestInputSchema>;
export type GithubPullRequestListQuery = z.infer<typeof githubPullRequestListQuerySchema>;
export type GithubPullRequestContextQuery = z.infer<typeof githubPullRequestContextQuerySchema>;
export type GithubIssueState = z.infer<typeof githubIssueStateSchema>;
export type SyncGithubIssueInput = z.infer<typeof syncGithubIssueInputSchema>;
export type GithubIssueListQuery = z.infer<typeof githubIssueListQuerySchema>;
export type GithubIssueContextQuery = z.infer<typeof githubIssueContextQuerySchema>;
export type QuestionOptionInput = z.infer<typeof questionOptionInputSchema>;
export type QuestionLinkType = z.infer<typeof questionLinkTypeSchema>;
export type CreateQuestionInput = z.infer<typeof createQuestionInputSchema>;
export type FindQuestionMatchesInput = z.infer<typeof findQuestionMatchesInputSchema>;
export type QuestionInboxQuery = z.infer<typeof questionInboxQuerySchema>;
export type QuestionAudienceViewQuery = z.infer<typeof questionAudienceViewQuerySchema>;
export type QuestionDecisionDigestQuery = z.infer<typeof questionDecisionDigestQuerySchema>;
export type QuestionSubmissionDisposition = z.infer<typeof questionSubmissionDispositionSchema>;
export type ProposeAnswerInput = z.infer<typeof proposeAnswerInputSchema>;
export type AcceptAnswerInput = z.infer<typeof acceptAnswerInputSchema>;
export type OverrideQuestionApprovalInput = z.infer<typeof overrideQuestionApprovalInputSchema>;
export type ChangeDecisionLifecycleInput = z.infer<typeof changeDecisionLifecycleInputSchema>;
export type QuestionReviewInput = z.infer<typeof questionReviewInputSchema>;
export type ReassignQuestionInput = z.infer<typeof reassignQuestionInputSchema>;
export type QuestionCommentInput = z.infer<typeof questionCommentInputSchema>;
export type EditQuestionResponseInput = z.infer<typeof editQuestionResponseInputSchema>;
export type EditQuestionCommentInput = z.infer<typeof editQuestionCommentInputSchema>;
export type QuestionClarificationInput = z.infer<typeof questionClarificationInputSchema>;
export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;
export type NotificationReadAllInput = z.infer<typeof notificationReadAllInputSchema>;
export type NotificationPreferenceInput = z.infer<typeof notificationPreferenceInputSchema>;
export type OutboxOperationsQuery = z.infer<typeof outboxOperationsQuerySchema>;
export type ProjectAnalyticsQuery = z.infer<typeof projectAnalyticsQuerySchema>;
export type AuditListQuery = z.infer<typeof auditListQuerySchema>;
export type AuditExportInput = z.infer<typeof auditExportInputSchema>;
export type ProjectDataExportInput = z.infer<typeof projectDataExportInputSchema>;
export type ReplayOutboxEventInput = z.infer<typeof replayOutboxEventInputSchema>;
export type ContextQuery = z.infer<typeof contextQuerySchema>;
export type DecisionListQuery = z.infer<typeof decisionListQuerySchema>;
export type DecisionConflictQuery = z.infer<typeof decisionConflictQuerySchema>;
export type DecisionImpactQuery = z.infer<typeof decisionImpactQuerySchema>;
export type PublishArtifactInput = z.infer<typeof publishArtifactInputSchema>;
export type ApproveArtifactVersionInput = z.infer<typeof approveArtifactVersionInputSchema>;
export type ArtifactReviewInput = z.infer<typeof artifactReviewInputSchema>;
export type ArtifactVersionDiffQuery = z.infer<typeof artifactVersionDiffQuerySchema>;
export type StartAgentRunInput = z.infer<typeof startAgentRunInputSchema>;
export type ReportAgentRunInput = z.infer<typeof reportAgentRunInputSchema>;
export type ContinuationQuery = z.infer<typeof continuationQuerySchema>;
export type RecordAssumptionInput = z.infer<typeof recordAssumptionInputSchema>;
export type ResolveAssumptionInput = z.infer<typeof resolveAssumptionInputSchema>;
export type RecordAdapterDiagnosticInput = z.infer<typeof recordAdapterDiagnosticInputSchema>;
export type RecordOutboxDeliveryFeedbackInput = z.infer<typeof recordOutboxDeliveryFeedbackInputSchema>;

export interface ArtifactDiffVersion {
  readonly id: string;
  readonly version: number;
  readonly summary: string;
  readonly status: ArtifactVersionStatus;
  readonly createdById: string;
  readonly createdAt: string;
  readonly contentSha256: string;
}

export interface ArtifactDiffLine {
  readonly kind: "unchanged" | "added" | "removed";
  readonly text: string;
  readonly oldLineNumber?: number;
  readonly newLineNumber?: number;
}

export interface ArtifactVersionDiff {
  readonly artifactId: string;
  readonly from: ArtifactDiffVersion;
  readonly to: ArtifactDiffVersion;
  readonly lines: readonly ArtifactDiffLine[];
  readonly counts: {
    readonly unchanged: number;
    readonly added: number;
    readonly removed: number;
  };
  readonly exact: boolean;
  readonly truncated: boolean;
  readonly totalLines: number;
}
