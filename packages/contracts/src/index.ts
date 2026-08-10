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
export const riskSchema = z.enum(["low", "medium", "high", "protected"]);
export const questionStatusSchema = z.enum([
  "open",
  "in_discussion",
  "accepted",
  "duplicate",
  "cancelled",
  "expired",
]);
export const questionReviewStatusSchema = z.enum(["approved", "rejected"]);
export const notificationTypeSchema = z.enum([
  "question_assigned",
  "question_response",
  "question_comment",
  "question_review",
  "question_accepted",
  "decision_lifecycle",
  "artifact_review_requested",
  "artifact_review_feedback",
  "artifact_approved",
]);
export const outboxEventTypeSchema = z.enum(["notification.created", "decision.lifecycle_changed"]);
export const outboxEventStatusSchema = z.enum([
  "pending",
  "processing",
  "processed",
  "failed",
  "dead_letter",
]);
export const deliveryChannelSchema = z.enum(["email"]);
export const outboxDeliveryStatusSchema = z.enum(["delivered", "failed", "suppressed", "deferred"]);
export const notificationDeliveryPreferenceSchema = z.enum(["immediate", "digest", "muted"]);
export const decisionStatusSchema = z.enum(["active", "superseded", "expired", "revoked"]);
export const artifactTypeSchema = z.enum(["prd", "adr", "api_contract", "test_plan"]);
export const artifactVersionStatusSchema = z.enum(["draft", "in_review", "approved", "superseded"]);
export const artifactReviewStatusSchema = z.enum(["commented", "changes_requested"]);
export const agentRunClientSchema = z.enum([
  "codex",
  "claude_code",
  "cursor",
  "copilot",
  "custom",
  "unknown",
]);
export const agentRunCapabilitySchema = z.enum([
  "instructions",
  "cli",
  "mcp",
  "hooks",
  "orchestrated",
]);
export const agentRunStatusSchema = z.enum([
  "running",
  "waiting_for_human",
  "completed",
  "failed",
  "cancelled",
]);
export const assumptionConfidenceSchema = z.enum(["low", "medium", "high"]);
export const assumptionStatusSchema = z.enum([
  "active",
  "confirmed",
  "rejected",
  "expired",
  "superseded",
]);

export const scopeSchema = z.object({
  repository: z.string().trim().min(1).max(200).optional(),
  component: z.string().trim().min(1).max(200).optional(),
  branch: z.string().trim().min(1).max(300).optional(),
  environment: z.string().trim().min(1).max(100).optional(),
  workItem: z.string().trim().min(1).max(300).optional(),
});

export const ownerRoleSchema = z.string().trim().min(2).max(80);

export const membershipStatusSchema = z.enum(["active", "disabled"]);

export const projectMembershipConfigurationSchema = z.object({
  projectId: z.string().trim().min(1).max(100),
  roles: z.array(ownerRoleSchema).max(30).default([]),
});

const memberConfigurationSchema = z.object({
  roles: z.array(ownerRoleSchema).max(30).default(["organization-member"]),
  allProjects: z.boolean().default(false),
  projectMemberships: z.array(projectMembershipConfigurationSchema).max(100).default([]),
}).superRefine((value, context) => {
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

export const createOrganizationMemberInputSchema = memberConfigurationSchema.and(z.object({
  oidcSubject: z.string().trim().min(1).max(300),
  displayName: z.string().trim().min(2).max(200),
}));

export const updateOrganizationMemberInputSchema = memberConfigurationSchema.and(z.object({
  expectedVersion: z.number().int().positive(),
  status: membershipStatusSchema,
}));

export const registerProjectInputSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(200),
  name: z.string().trim().min(2).max(200),
  decisionOwnerIds: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
});

export const questionOptionInputSchema = z.object({
  key: z.string().trim().min(1).max(80).regex(/^[a-z0-9][a-z0-9_-]*$/),
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
    options: z.array(questionOptionInputSchema).max(10).default([]),
    recommendationKey: z.string().trim().min(1).max(80).optional(),
    fallback: z.string().trim().min(1).max(2_000).nullable().optional(),
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

export const questionCommentInputSchema = z.object({
  expectedVersion: z.number().int().positive(),
  body: z.string().trim().min(2).max(5_000),
  parentCommentId: z.string().trim().min(1).max(100).optional(),
});

export const notificationListQuerySchema = z.object({
  projectId: z.string().trim().min(1).max(100).optional(),
  unreadOnly: z.boolean().default(false),
});

export const notificationReadAllInputSchema = z.object({
  projectId: z.string().trim().min(1).max(100).optional(),
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

export const publishArtifactInputSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(200),
  artifactId: z.string().trim().min(1).max(100).optional(),
  runId: z.string().trim().min(1).max(100).optional(),
  title: z.string().trim().min(4).max(300),
  type: artifactTypeSchema,
  summary: z.string().trim().min(10).max(4_000),
  body: z.string().trim().min(20).max(262_144),
  intendedReviewerIds: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
  citedDecisionIds: z.array(z.string().trim().min(1).max(100)).max(100).default([]),
  requestReview: z.boolean().default(true),
  scope: scopeSchema.default({}),
});

export const approveArtifactVersionInputSchema = z.object({
  rationale: z.string().trim().min(10).max(5_000),
});

export const artifactReviewInputSchema = z
  .object({
    status: artifactReviewStatusSchema,
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
  });

export type PrincipalType = z.infer<typeof principalTypeSchema>;
export type QuestionType = z.infer<typeof questionTypeSchema>;
export type Risk = z.infer<typeof riskSchema>;
export type QuestionStatus = z.infer<typeof questionStatusSchema>;
export type QuestionReviewStatus = z.infer<typeof questionReviewStatusSchema>;
export type NotificationType = z.infer<typeof notificationTypeSchema>;
export type OutboxEventType = z.infer<typeof outboxEventTypeSchema>;
export type OutboxEventStatus = z.infer<typeof outboxEventStatusSchema>;
export type DeliveryChannel = z.infer<typeof deliveryChannelSchema>;
export type OutboxDeliveryStatus = z.infer<typeof outboxDeliveryStatusSchema>;
export type NotificationDeliveryPreference = z.infer<typeof notificationDeliveryPreferenceSchema>;
export type DecisionStatus = z.infer<typeof decisionStatusSchema>;
export type ArtifactType = z.infer<typeof artifactTypeSchema>;
export type ArtifactVersionStatus = z.infer<typeof artifactVersionStatusSchema>;
export type ArtifactReviewStatus = z.infer<typeof artifactReviewStatusSchema>;
export type AgentRunClient = z.infer<typeof agentRunClientSchema>;
export type AgentRunCapability = z.infer<typeof agentRunCapabilitySchema>;
export type AgentRunStatus = z.infer<typeof agentRunStatusSchema>;
export type AssumptionConfidence = z.infer<typeof assumptionConfidenceSchema>;
export type AssumptionStatus = z.infer<typeof assumptionStatusSchema>;
export type Scope = z.infer<typeof scopeSchema>;
export type MembershipStatus = z.infer<typeof membershipStatusSchema>;
export type ProjectMembershipConfiguration = z.infer<typeof projectMembershipConfigurationSchema>;
export type CreateOrganizationMemberInput = z.infer<typeof createOrganizationMemberInputSchema>;
export type UpdateOrganizationMemberInput = z.infer<typeof updateOrganizationMemberInputSchema>;
export type RegisterProjectInput = z.infer<typeof registerProjectInputSchema>;
export type QuestionOptionInput = z.infer<typeof questionOptionInputSchema>;
export type CreateQuestionInput = z.infer<typeof createQuestionInputSchema>;
export type FindQuestionMatchesInput = z.infer<typeof findQuestionMatchesInputSchema>;
export type QuestionInboxQuery = z.infer<typeof questionInboxQuerySchema>;
export type QuestionSubmissionDisposition = z.infer<typeof questionSubmissionDispositionSchema>;
export type ProposeAnswerInput = z.infer<typeof proposeAnswerInputSchema>;
export type AcceptAnswerInput = z.infer<typeof acceptAnswerInputSchema>;
export type ChangeDecisionLifecycleInput = z.infer<typeof changeDecisionLifecycleInputSchema>;
export type QuestionReviewInput = z.infer<typeof questionReviewInputSchema>;
export type QuestionCommentInput = z.infer<typeof questionCommentInputSchema>;
export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;
export type NotificationReadAllInput = z.infer<typeof notificationReadAllInputSchema>;
export type OutboxOperationsQuery = z.infer<typeof outboxOperationsQuerySchema>;
export type ProjectAnalyticsQuery = z.infer<typeof projectAnalyticsQuerySchema>;
export type ReplayOutboxEventInput = z.infer<typeof replayOutboxEventInputSchema>;
export type ContextQuery = z.infer<typeof contextQuerySchema>;
export type DecisionListQuery = z.infer<typeof decisionListQuerySchema>;
export type PublishArtifactInput = z.infer<typeof publishArtifactInputSchema>;
export type ApproveArtifactVersionInput = z.infer<typeof approveArtifactVersionInputSchema>;
export type ArtifactReviewInput = z.infer<typeof artifactReviewInputSchema>;
export type ArtifactVersionDiffQuery = z.infer<typeof artifactVersionDiffQuerySchema>;
export type StartAgentRunInput = z.infer<typeof startAgentRunInputSchema>;
export type ReportAgentRunInput = z.infer<typeof reportAgentRunInputSchema>;
export type ContinuationQuery = z.infer<typeof continuationQuerySchema>;
export type RecordAssumptionInput = z.infer<typeof recordAssumptionInputSchema>;
export type ResolveAssumptionInput = z.infer<typeof resolveAssumptionInputSchema>;

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
