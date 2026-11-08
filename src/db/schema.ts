import { sql } from "drizzle-orm";
import {
  check,
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const timestamps = () => ({
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  // Updated by Drizzle on application updates; raw SQL writers must set it explicitly.
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});
const id = () => uuid("id").defaultRandom().primaryKey();

export const eventStatus = pgEnum("event_status", [
  "draft",
  "open",
  "judging",
  "completed",
]);
export const evaluationStatus = pgEnum("evaluation_status", [
  "queued",
  "running",
  "completed",
  "failed",
]);
export const evidenceStatus = pgEnum("evidence_status", [
  "VERIFIED",
  "UNVERIFIED",
  "FAILED",
  "NOT_EVALUATED",
]);
export const evidenceMethod = pgEnum("evidence_method", [
  "static_analysis",
  "external_ci",
  "organizer_attestation",
  "trusted_api",
]);
export const assessmentStatus = pgEnum("assessment_status", [
  "draft",
  "finalized",
]);
export const payoutStatus = pgEnum("payout_status", [
  "intent",
  "pending",
  "succeeded",
  "failed",
  "unclaimed",
  "returned",
  "unknown",
]);

export const organizerUsers = pgTable(
  "organizer_users",
  {
    id: id(),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    passwordHash: text("password_hash"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("organizer_email_unique").on(sql`lower(${t.email})`),
    uniqueIndex("one_provisioned_organizer")
      .on(sql`(1)`)
      .where(sql`${t.passwordHash} IS NOT NULL`),
    check("organizer_email_nonempty", sql`length(trim(${t.email})) > 0`),
  ],
);

export const organizerSessions = pgTable(
  "organizer_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    organizerId: uuid("organizer_id")
      .notNull()
      .references(() => organizerUsers.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("session_expiry_idx").on(t.expiresAt)],
);

// A fixed global bucket bounds password work for this single-organizer MVP.
export const loginLimits = pgTable("login_limits", {
  key: text("key").primaryKey(),
  attempts: integer("attempts").notNull(),
  windowStartedAt: timestamp("window_started_at", {
    withTimezone: true,
  }).notNull(),
});

export const hackathonEvents = pgTable(
  "hackathon_events",
  {
    id: id(),
    organizerId: uuid("organizer_id")
      .notNull()
      .references(() => organizerUsers.id, { onDelete: "restrict" }),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    status: eventStatus("status").default("draft").notNull(),
    deadlineAt: timestamp("deadline_at", { withTimezone: true }).notNull(),
    budgetCents: integer("budget_cents").default(0).notNull(),
    currency: text("currency").default("USD").notNull(),
    isDemo: boolean("is_demo").default(false).notNull(),
    ...timestamps(),
  },
  (t) => [
    check("event_budget_nonnegative", sql`${t.budgetCents} >= 0`),
    check("event_currency_usd", sql`${t.currency} = 'USD'`),
    index("event_organizer_idx").on(t.organizerId),
    unique("one_event_per_organizer").on(t.organizerId),
  ],
);

export const rubricVersions = pgTable(
  "rubric_versions",
  {
    id: id(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => hackathonEvents.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    title: text("title").notNull(),
    criteria: jsonb("criteria")
      .$type<Array<{ key: string; label: string; maxScore: number }>>()
      .notNull(),
    ...timestamps(),
  },
  (t) => [
    unique("rubric_event_version_unique").on(t.eventId, t.version),
    unique("rubric_id_event_unique").on(t.id, t.eventId),
    check("rubric_version_positive", sql`${t.version} > 0`),
    check("rubric_criteria_array", sql`jsonb_typeof(${t.criteria}) = 'array'`),
  ],
);

export const submissions = pgTable(
  "submissions",
  {
    id: id(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => hackathonEvents.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    teamName: text("team_name").notNull(),
    repositoryUrl: text("repository_url").notNull(),
    commitSha: text("commit_sha").notNull(),
    repositoryOwner: text("repository_owner"),
    githubRepositoryId: text("github_repository_id"),
    claims: jsonb("claims").$type<string[]>().default([]).notNull(),
    ownershipAttested: boolean("ownership_attested").default(false).notNull(),
    isDemo: boolean("is_demo").default(false).notNull(),
    ...timestamps(),
  },
  (t) => [
    unique("submission_event_repository_unique").on(t.eventId, t.repositoryUrl),
    unique("submission_id_event_unique").on(t.id, t.eventId),
    check("submission_pinned_sha", sql`${t.commitSha} ~ '^[0-9a-f]{40}$'`),
    check("submission_claims_array", sql`jsonb_typeof(${t.claims}) = 'array'`),
    check(
      "submission_github_url",
      sql`${t.repositoryUrl} ~ '^https://github[.]com/[A-Za-z0-9_-]+/[A-Za-z0-9_.-]+$'`,
    ),
  ],
);

export const evaluationRuns = pgTable(
  "evaluation_runs",
  {
    id: id(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => hackathonEvents.id, { onDelete: "restrict" }),
    submissionId: uuid("submission_id").notNull(),
    rubricVersionId: uuid("rubric_version_id").notNull(),
    status: evaluationStatus("status").default("queued").notNull(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    modelVersion: text("model_version"),
    promptVersion: text("prompt_version"),
    evidenceVersion: text("evidence_version"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    attempts: integer("attempts").default(0).notNull(),
    maxAttempts: integer("max_attempts").default(3).notNull(),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    leaseToken: uuid("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    lastError: text("last_error"),
    result: jsonb("result").$type<Record<string, unknown>>(),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: "run_submission_event_fk",
      columns: [t.submissionId, t.eventId],
      foreignColumns: [submissions.id, submissions.eventId],
    }).onDelete("restrict"),
    foreignKey({
      name: "run_rubric_event_fk",
      columns: [t.rubricVersionId, t.eventId],
      foreignColumns: [rubricVersions.id, rubricVersions.eventId],
    }).onDelete("restrict"),
    unique("run_id_submission_event_unique").on(
      t.id,
      t.submissionId,
      t.eventId,
    ),
    index("run_status_idx").on(t.status),
    index("run_submission_idx").on(t.submissionId, t.eventId),
    index("run_rubric_idx").on(t.rubricVersionId, t.eventId),
    index("run_queue_idx").on(t.status, t.nextAttemptAt, t.leaseExpiresAt),
    check(
      "run_attempt_bounds",
      sql`${t.attempts} >= 0 AND ${t.maxAttempts} BETWEEN 1 AND 5 AND ${t.attempts} <= ${t.maxAttempts}`,
    ),
    check(
      "run_lease_state",
      sql`(${t.status} = 'running' AND ${t.leaseToken} IS NOT NULL AND ${t.leaseExpiresAt} IS NOT NULL) OR (${t.status} <> 'running' AND ${t.leaseToken} IS NULL AND ${t.leaseExpiresAt} IS NULL)`,
    ),
  ],
);

export const evidence = pgTable(
  "evidence",
  {
    id: id(),
    evaluationRunId: uuid("evaluation_run_id")
      .notNull()
      .references(() => evaluationRuns.id, { onDelete: "restrict" }),
    sourceUri: text("source_uri").notNull(),
    sourcePath: text("source_path"),
    contentHash: text("content_hash"),
    excerpt: text("excerpt"),
    method: evidenceMethod("method").notNull(),
    status: evidenceStatus("status").default("NOT_EVALUATED").notNull(),
    limitations: text("limitations"),
    ...timestamps(),
  },
  (t) => [
    unique("evidence_id_run_unique").on(t.id, t.evaluationRunId),
    index("evidence_run_idx").on(t.evaluationRunId),
  ],
);

export const findings = pgTable(
  "findings",
  {
    id: id(),
    evaluationRunId: uuid("evaluation_run_id")
      .notNull()
      .references(() => evaluationRuns.id, { onDelete: "restrict" }),
    evidenceId: uuid("evidence_id").notNull(),
    criterionKey: text("criterion_key").notNull(),
    summary: text("summary").notNull(),
    status: evidenceStatus("status").default("UNVERIFIED").notNull(),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: "finding_evidence_run_fk",
      columns: [t.evidenceId, t.evaluationRunId],
      foreignColumns: [evidence.id, evidence.evaluationRunId],
    }).onDelete("restrict"),
    index("finding_evidence_idx").on(t.evidenceId, t.evaluationRunId),
    index("finding_run_idx").on(t.evaluationRunId),
  ],
);

export const assessments = pgTable(
  "assessments",
  {
    id: id(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => hackathonEvents.id, { onDelete: "restrict" }),
    submissionId: uuid("submission_id").notNull(),
    evaluationRunId: uuid("evaluation_run_id").notNull(),
    version: integer("version").notNull(),
    status: assessmentStatus("status").default("draft").notNull(),
    scores: jsonb("scores").$type<Record<string, number>>().notNull(),
    rationale: text("rationale").notNull(),
    // Human decisions are new versions; the original AI draft stays intact.
    sourceDraftId: uuid("source_draft_id"),
    criterionDecisions: jsonb("criterion_decisions").$type<Record<string, { action: "accept" | "override"; reason: string }>>(),
    finalizedBy: uuid("finalized_by").references(() => organizerUsers.id, {
      onDelete: "restrict",
    }),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    unique("assessment_id_run_scope_unique").on(t.id, t.evaluationRunId, t.submissionId, t.eventId),
    foreignKey({
      name: "assessment_source_draft_scope_fk",
      columns: [t.sourceDraftId, t.evaluationRunId, t.submissionId, t.eventId],
      foreignColumns: [t.id, t.evaluationRunId, t.submissionId, t.eventId],
    }).onDelete("restrict"),
    unique("assessment_source_draft_unique").on(t.sourceDraftId),
    uniqueIndex("assessment_one_review_per_run").on(t.evaluationRunId).where(sql`${t.sourceDraftId} IS NOT NULL`),
    check("assessment_review_shape", sql`(${t.sourceDraftId} IS NULL AND ${t.criterionDecisions} IS NULL) OR (${t.sourceDraftId} IS NOT NULL AND ${t.sourceDraftId} <> ${t.id} AND ${t.status} = 'finalized' AND jsonb_typeof(${t.criterionDecisions}) = 'object' AND ${t.criterionDecisions} IS NOT NULL)`),
    foreignKey({
      name: "assessment_run_scope_fk",
      columns: [t.evaluationRunId, t.submissionId, t.eventId],
      foreignColumns: [
        evaluationRuns.id,
        evaluationRuns.submissionId,
        evaluationRuns.eventId,
      ],
    }).onDelete("restrict"),
    unique("assessment_run_version_unique").on(t.evaluationRunId, t.version),
    unique("assessment_scope_unique").on(t.id, t.submissionId, t.eventId),
    unique("assessment_status_unique").on(t.id, t.status),
    check("assessment_version_positive", sql`${t.version} > 0`),
    check(
      "assessment_scores_object",
      sql`jsonb_typeof(${t.scores}) = 'object'`,
    ),
    check(
      "assessment_finalization_complete",
      sql`(${t.status} = 'draft' AND ${t.finalizedBy} IS NULL AND ${t.finalizedAt} IS NULL) OR (${t.status} = 'finalized' AND ${t.finalizedBy} IS NOT NULL AND ${t.finalizedAt} IS NOT NULL)`,
    ),
    index("assessment_run_idx").on(
      t.evaluationRunId,
      t.submissionId,
      t.eventId,
    ),
    index("assessment_finalizer_idx").on(t.finalizedBy),
  ],
);

export const awards = pgTable(
  "awards",
  {
    id: id(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => hackathonEvents.id, { onDelete: "restrict" }),
    submissionId: uuid("submission_id").notNull(),
    assessmentId: uuid("assessment_id").notNull(),
    title: text("title").notNull(),
    revision: integer("revision").default(1).notNull(),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").default("USD").notNull(),
    recipientEmail: text("recipient_email").notNull(),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: "award_assessment_scope_fk",
      columns: [t.assessmentId, t.submissionId, t.eventId],
      foreignColumns: [
        assessments.id,
        assessments.submissionId,
        assessments.eventId,
      ],
    }).onDelete("restrict"),
    unique("award_event_title_unique").on(t.eventId, t.title),
    // Approval references every financially material term, not only the award ID.
    unique("award_terms_unique").on(
      t.id,
      t.revision,
      t.assessmentId,
      t.amountCents,
      t.currency,
      t.recipientEmail,
    ),
    check("award_amount_positive", sql`${t.amountCents} > 0`),
    check("award_revision_positive", sql`${t.revision} > 0`),
    check("award_currency_usd", sql`${t.currency} = 'USD'`),
    check(
      "award_recipient_nonempty",
      sql`length(trim(${t.recipientEmail})) > 0`,
    ),
    index("award_assessment_idx").on(t.assessmentId, t.submissionId, t.eventId),
  ],
);

export const awardApprovals = pgTable(
  "award_approvals",
  {
    id: id(),
    awardId: uuid("award_id").notNull(),
    awardRevision: integer("award_revision").notNull(),
    assessmentId: uuid("assessment_id").notNull(),
    assessmentStatus: assessmentStatus("assessment_status")
      .default("finalized")
      .notNull(),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull(),
    recipientEmail: text("recipient_email").notNull(),
    approvedBy: uuid("approved_by")
      .notNull()
      .references(() => organizerUsers.id, { onDelete: "restrict" }),
    approvedAt: timestamp("approved_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: "approval_exact_award_terms_fk",
      columns: [
        t.awardId,
        t.awardRevision,
        t.assessmentId,
        t.amountCents,
        t.currency,
        t.recipientEmail,
      ],
      foreignColumns: [
        awards.id,
        awards.revision,
        awards.assessmentId,
        awards.amountCents,
        awards.currency,
        awards.recipientEmail,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "approval_final_assessment_fk",
      columns: [t.assessmentId, t.assessmentStatus],
      foreignColumns: [assessments.id, assessments.status],
    }).onDelete("restrict"),
    check(
      "approval_requires_finalized",
      sql`${t.assessmentStatus} = 'finalized'`,
    ),
    unique("approval_award_revision_unique").on(t.awardId, t.awardRevision),
    unique("approval_id_award_unique").on(t.id, t.awardId),
    index("approval_assessment_idx").on(t.assessmentId, t.assessmentStatus),
    index("approval_organizer_idx").on(t.approvedBy),
  ],
);

export const payouts = pgTable(
  "payouts",
  {
    id: id(),
    awardId: uuid("award_id").notNull().unique(),
    approvalId: uuid("approval_id").notNull().unique(),
    environment: text("environment").default("sandbox").notNull(),
    status: payoutStatus("status").default("intent").notNull(),
    senderBatchId: text("sender_batch_id").notNull().unique(),
    senderItemId: text("sender_item_id").notNull().unique(),
    paypalBatchId: text("paypal_batch_id"),
    paypalItemId: text("paypal_item_id").unique(),
    reconciledAt: timestamp("reconciled_at", { withTimezone: true }),
    // Legacy records are never eligible for dispatch. Only new, explicitly
    // authorized intents are prepared by the Stage B service.
    dispatchState: text("dispatch_state").default("legacy").notNull(),
    authorizedBy: uuid("authorized_by").references(() => organizerUsers.id, { onDelete: "restrict" }),
    authorizedAt: timestamp("authorized_at", { withTimezone: true }),
    recipientVerifiedAt: timestamp("recipient_verified_at", { withTimezone: true }),
    dispatchClaim: uuid("dispatch_claim"),
    dispatchStartedAt: timestamp("dispatch_started_at", { withTimezone: true }),
    lastOutcome: text("last_outcome"),
    stateVersion: integer("state_version").default(0).notNull(),
    itemStatus: text("item_status"),
    evidence: jsonb("evidence").$type<{
      batchId: string; itemId: string; senderBatchId: string; senderItemId: string;
      batchStatus: string; itemStatus: string; amount: string; currency: "USD";
      recipientMatched: true;
    }>(),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: "payout_approval_award_fk",
      columns: [t.approvalId, t.awardId],
      foreignColumns: [awardApprovals.id, awardApprovals.awardId],
    }).onDelete("restrict"),
    check("payout_sandbox_only", sql`${t.environment} = 'sandbox'`),
    check(
      "payout_success_has_item",
      sql`${t.status} <> 'succeeded' OR (${t.paypalItemId} IS NOT NULL AND ${t.reconciledAt} IS NOT NULL)`,
    ),
    check("payout_dispatch_shape", sql`${t.dispatchState} IN ('legacy', 'prepared', 'started') AND (${t.dispatchState} = 'legacy' OR (${t.authorizedBy} IS NOT NULL AND ${t.authorizedAt} IS NOT NULL AND ${t.recipientVerifiedAt} IS NOT NULL)) AND ((${t.dispatchState} = 'started' AND ${t.dispatchClaim} IS NOT NULL AND ${t.dispatchStartedAt} IS NOT NULL) OR (${t.dispatchState} <> 'started' AND ${t.dispatchClaim} IS NULL AND ${t.dispatchStartedAt} IS NULL))`),
    check("payout_state_version_nonnegative", sql`${t.stateVersion} >= 0`),
    check("payout_item_success_evidence", sql`${t.dispatchState} = 'legacy' OR ${t.status} <> 'succeeded' OR coalesce((${t.itemStatus} = 'SUCCESS' AND ${t.evidence} IS NOT NULL AND ${t.evidence}->>'itemStatus' = 'SUCCESS' AND ${t.evidence}->>'itemId' = ${t.paypalItemId} AND ${t.evidence}->>'batchId' = ${t.paypalBatchId} AND ${t.evidence}->>'recipientMatched' = 'true'), false)`),
    index("payout_status_idx").on(t.status),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: id(),
    eventId: uuid("event_id").references(() => hackathonEvents.id, {
      onDelete: "restrict",
    }),
    actorId: uuid("actor_id").references(() => organizerUsers.id, {
      onDelete: "restrict",
    }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("audit_event_created_idx").on(t.eventId, t.createdAt),
    index("audit_actor_idx").on(t.actorId),
    index("audit_entity_idx").on(t.entityType, t.entityId),
  ],
);
