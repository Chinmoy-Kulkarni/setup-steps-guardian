import { z } from "zod";

export const FindingSeveritySchema = z.enum(["info", "warning", "error"]);
export type FindingSeverity = z.infer<typeof FindingSeveritySchema>;

export const FindingEvidenceValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const FindingSchema = z.object({
  code: z.string().regex(/^[A-Z][A-Z0-9_]+$/),
  severity: FindingSeveritySchema,
  title: z.string().min(1),
  message: z.string().min(1),
  path: z.string().min(1),
  line: z.number().int().positive().optional(),
  evidence: z.record(z.string(), FindingEvidenceValueSchema).default({}),
  remediation: z.string().min(1),
  documentationUrl: z.string().url().optional(),
});
export type Finding = z.infer<typeof FindingSchema>;

export const RepositorySetupStatusSchema = z.enum([
  "missing",
  "invalid",
  "drifting",
  "unproven",
  "passing",
  "failing",
  "stale",
]);
export type RepositorySetupStatus = z.infer<typeof RepositorySetupStatusSchema>;

export const WorkflowConclusionSchema = z.enum([
  "success",
  "failure",
  "cancelled",
  "timed_out",
  "skipped",
  "action_required",
  "neutral",
  "startup_failure",
]);
export type WorkflowConclusion = z.infer<typeof WorkflowConclusionSchema>;

export const WorkflowEvidenceSchema = z.object({
  repositoryId: z.string().min(1),
  commitSha: z.string().regex(/^[a-f0-9]{40}$/i),
  workflowHash: z.string().regex(/^[a-f0-9]{64}$/i),
  policyHash: z.string().regex(/^[a-f0-9]{64}$/i),
  lockfileHashes: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/i)),
  runnerLabel: z.string().min(1),
  conclusion: WorkflowConclusionSchema,
  durationMs: z.number().int().nonnegative(),
  failedStep: z.string().min(1).optional(),
  runId: z.string().min(1),
  runAttempt: z.number().int().positive(),
  completedAt: z.string().datetime({ offset: true }),
});
export type WorkflowEvidence = z.infer<typeof WorkflowEvidenceSchema>;

export const PatchProposalSchema = z.object({
  path: z.string().min(1),
  operation: z.enum(["create", "replace"]),
  description: z.string().min(1),
  content: z.string().min(1),
});
export type PatchProposal = z.infer<typeof PatchProposalSchema>;

export const ValidationResultSchema = z.object({
  schemaVersion: z.literal(1),
  status: z.enum(["valid", "invalid"]),
  workflowPath: z.string().min(1),
  workflowHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/i)
    .optional(),
  policyHash: z.string().regex(/^[a-f0-9]{64}$/i),
  findings: z.array(FindingSchema),
  patches: z.array(PatchProposalSchema),
});
export type ValidationResult = z.infer<typeof ValidationResultSchema>;

export const RepositorySummarySchema = z.object({
  repositoryId: z.string().min(1),
  owner: z.string().min(1),
  name: z.string().min(1),
  isPrivate: z.boolean(),
  defaultBranch: z.string().min(1),
  status: RepositorySetupStatusSchema,
  lastEvidenceAt: z.string().datetime({ offset: true }).nullable(),
  errorCount: z.number().int().nonnegative(),
  warningCount: z.number().int().nonnegative(),
});
export type RepositorySummary = z.infer<typeof RepositorySummarySchema>;

export const FleetSummarySchema = z.object({
  accountId: z.string().min(1),
  repositories: z.array(RepositorySummarySchema),
  totals: z.object({
    selected: z.number().int().nonnegative(),
    passing: z.number().int().nonnegative(),
    attention: z.number().int().nonnegative(),
  }),
});
export type FleetSummary = z.infer<typeof FleetSummarySchema>;

export const RepositoryDetailSchema = z.object({
  repository: RepositorySummarySchema,
  findings: z.array(FindingSchema),
  evidence: WorkflowEvidenceSchema.nullable(),
});
export type RepositoryDetail = z.infer<typeof RepositoryDetailSchema>;

export const AuthorizedAccountSchema = z.object({
  accountId: z.string().min(1),
  login: z.string().min(1),
  accountType: z.enum(["Organization", "User"]),
  canManage: z.boolean(),
});
export type AuthorizedAccount = z.infer<typeof AuthorizedAccountSchema>;

export const SessionResponseSchema = z.object({
  user: z.object({
    id: z.string().min(1),
    login: z.string().min(1),
    avatarUrl: z.string().url(),
  }),
  accounts: z.array(AuthorizedAccountSchema),
  csrfToken: z.string().min(16),
});
export type SessionResponse = z.infer<typeof SessionResponseSchema>;

export const CheckoutRequestSchema = z.object({
  accountId: z.string().min(1),
  plan: z.enum(["team", "fleet"]),
});
export type CheckoutRequest = z.infer<typeof CheckoutRequestSchema>;

export const CheckoutResponseSchema = z.object({
  transactionId: z.string().min(1),
  checkoutUrl: z.string().url(),
});
export type CheckoutResponse = z.infer<typeof CheckoutResponseSchema>;

export const HealthResponseSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  version: z.string().min(1),
  timestamp: z.string().datetime({ offset: true }),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
