CREATE TYPE "public"."assessment_status" AS ENUM('draft', 'finalized');--> statement-breakpoint
CREATE TYPE "public"."evaluation_status" AS ENUM('queued', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."event_status" AS ENUM('draft', 'open', 'judging', 'completed');--> statement-breakpoint
CREATE TYPE "public"."evidence_method" AS ENUM('static_analysis', 'external_ci', 'organizer_attestation', 'trusted_api');--> statement-breakpoint
CREATE TYPE "public"."evidence_status" AS ENUM('VERIFIED', 'UNVERIFIED', 'FAILED', 'NOT_EVALUATED');--> statement-breakpoint
CREATE TYPE "public"."payout_status" AS ENUM('intent', 'pending', 'succeeded', 'failed', 'unclaimed', 'returned', 'unknown');--> statement-breakpoint
CREATE TABLE "assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"evaluation_run_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" "assessment_status" DEFAULT 'draft' NOT NULL,
	"scores" jsonb NOT NULL,
	"rationale" text NOT NULL,
	"finalized_by" uuid,
	"finalized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assessment_run_version_unique" UNIQUE("evaluation_run_id","version"),
	CONSTRAINT "assessment_scope_unique" UNIQUE("id","submission_id","event_id"),
	CONSTRAINT "assessment_status_unique" UNIQUE("id","status"),
	CONSTRAINT "assessment_version_positive" CHECK ("assessments"."version" > 0),
	CONSTRAINT "assessment_scores_object" CHECK (jsonb_typeof("assessments"."scores") = 'object'),
	CONSTRAINT "assessment_finalization_complete" CHECK (("assessments"."status" = 'draft' AND "assessments"."finalized_by" IS NULL AND "assessments"."finalized_at" IS NULL) OR ("assessments"."status" = 'finalized' AND "assessments"."finalized_by" IS NOT NULL AND "assessments"."finalized_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "award_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"award_id" uuid NOT NULL,
	"award_revision" integer NOT NULL,
	"assessment_id" uuid NOT NULL,
	"assessment_status" "assessment_status" DEFAULT 'finalized' NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"recipient_email" text NOT NULL,
	"approved_by" uuid NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_award_revision_unique" UNIQUE("award_id","award_revision"),
	CONSTRAINT "approval_id_award_unique" UNIQUE("id","award_id"),
	CONSTRAINT "approval_requires_finalized" CHECK ("award_approvals"."assessment_status" = 'finalized')
);
--> statement-breakpoint
CREATE TABLE "awards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"assessment_id" uuid NOT NULL,
	"title" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"recipient_email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "award_event_title_unique" UNIQUE("event_id","title"),
	CONSTRAINT "award_terms_unique" UNIQUE("id","revision","assessment_id","amount_cents","currency","recipient_email"),
	CONSTRAINT "award_amount_positive" CHECK ("awards"."amount_cents" > 0),
	CONSTRAINT "award_revision_positive" CHECK ("awards"."revision" > 0),
	CONSTRAINT "award_currency_usd" CHECK ("awards"."currency" = 'USD'),
	CONSTRAINT "award_recipient_nonempty" CHECK (length(trim("awards"."recipient_email")) > 0)
);
--> statement-breakpoint
CREATE TABLE "evaluation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"rubric_version_id" uuid NOT NULL,
	"status" "evaluation_status" DEFAULT 'queued' NOT NULL,
	"idempotency_key" text NOT NULL,
	"model_version" text,
	"prompt_version" text,
	"evidence_version" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evaluation_runs_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "run_id_submission_event_unique" UNIQUE("id","submission_id","event_id")
);
--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"evaluation_run_id" uuid NOT NULL,
	"source_uri" text NOT NULL,
	"source_path" text,
	"content_hash" text,
	"excerpt" text,
	"method" "evidence_method" NOT NULL,
	"status" "evidence_status" DEFAULT 'NOT_EVALUATED' NOT NULL,
	"limitations" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_id_run_unique" UNIQUE("id","evaluation_run_id")
);
--> statement-breakpoint
CREATE TABLE "findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"evaluation_run_id" uuid NOT NULL,
	"evidence_id" uuid NOT NULL,
	"criterion_key" text NOT NULL,
	"summary" text NOT NULL,
	"status" "evidence_status" DEFAULT 'UNVERIFIED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hackathon_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizer_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"status" "event_status" DEFAULT 'draft' NOT NULL,
	"deadline_at" timestamp with time zone NOT NULL,
	"budget_cents" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hackathon_events_slug_unique" UNIQUE("slug"),
	CONSTRAINT "event_budget_nonnegative" CHECK ("hackathon_events"."budget_cents" >= 0),
	CONSTRAINT "event_currency_usd" CHECK ("hackathon_events"."currency" = 'USD')
);
--> statement-breakpoint
CREATE TABLE "organizer_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizer_email_nonempty" CHECK (length(trim("organizer_users"."email")) > 0)
);
--> statement-breakpoint
CREATE TABLE "payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"award_id" uuid NOT NULL,
	"approval_id" uuid NOT NULL,
	"environment" text DEFAULT 'sandbox' NOT NULL,
	"status" "payout_status" DEFAULT 'intent' NOT NULL,
	"sender_batch_id" text NOT NULL,
	"sender_item_id" text NOT NULL,
	"paypal_batch_id" text,
	"paypal_item_id" text,
	"reconciled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payouts_award_id_unique" UNIQUE("award_id"),
	CONSTRAINT "payouts_approval_id_unique" UNIQUE("approval_id"),
	CONSTRAINT "payouts_sender_batch_id_unique" UNIQUE("sender_batch_id"),
	CONSTRAINT "payouts_sender_item_id_unique" UNIQUE("sender_item_id"),
	CONSTRAINT "payouts_paypal_item_id_unique" UNIQUE("paypal_item_id"),
	CONSTRAINT "payout_sandbox_only" CHECK ("payouts"."environment" = 'sandbox'),
	CONSTRAINT "payout_success_has_item" CHECK ("payouts"."status" <> 'succeeded' OR ("payouts"."paypal_item_id" IS NOT NULL AND "payouts"."reconciled_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "rubric_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"criteria" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rubric_event_version_unique" UNIQUE("event_id","version"),
	CONSTRAINT "rubric_id_event_unique" UNIQUE("id","event_id"),
	CONSTRAINT "rubric_version_positive" CHECK ("rubric_versions"."version" > 0),
	CONSTRAINT "rubric_criteria_array" CHECK (jsonb_typeof("rubric_versions"."criteria") = 'array')
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	"team_name" text NOT NULL,
	"repository_url" text NOT NULL,
	"commit_sha" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "submission_event_repository_unique" UNIQUE("event_id","repository_url"),
	CONSTRAINT "submission_id_event_unique" UNIQUE("id","event_id"),
	CONSTRAINT "submission_pinned_sha" CHECK ("submissions"."commit_sha" ~ '^[0-9a-f]{40}$'),
	CONSTRAINT "submission_github_url" CHECK ("submissions"."repository_url" ~ '^https://github[.]com/[A-Za-z0-9_-]+/[A-Za-z0-9_.-]+$')
);
--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_event_id_hackathon_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."hackathon_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_finalized_by_organizer_users_id_fk" FOREIGN KEY ("finalized_by") REFERENCES "public"."organizer_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessment_run_scope_fk" FOREIGN KEY ("evaluation_run_id","submission_id","event_id") REFERENCES "public"."evaluation_runs"("id","submission_id","event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_event_id_hackathon_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."hackathon_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_organizer_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."organizer_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "award_approvals" ADD CONSTRAINT "award_approvals_approved_by_organizer_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."organizer_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "award_approvals" ADD CONSTRAINT "approval_exact_award_terms_fk" FOREIGN KEY ("award_id","award_revision","assessment_id","amount_cents","currency","recipient_email") REFERENCES "public"."awards"("id","revision","assessment_id","amount_cents","currency","recipient_email") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "award_approvals" ADD CONSTRAINT "approval_final_assessment_fk" FOREIGN KEY ("assessment_id","assessment_status") REFERENCES "public"."assessments"("id","status") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "awards" ADD CONSTRAINT "awards_event_id_hackathon_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."hackathon_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "awards" ADD CONSTRAINT "award_assessment_scope_fk" FOREIGN KEY ("assessment_id","submission_id","event_id") REFERENCES "public"."assessments"("id","submission_id","event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_runs" ADD CONSTRAINT "evaluation_runs_event_id_hackathon_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."hackathon_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_runs" ADD CONSTRAINT "run_submission_event_fk" FOREIGN KEY ("submission_id","event_id") REFERENCES "public"."submissions"("id","event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_runs" ADD CONSTRAINT "run_rubric_event_fk" FOREIGN KEY ("rubric_version_id","event_id") REFERENCES "public"."rubric_versions"("id","event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_evaluation_run_id_evaluation_runs_id_fk" FOREIGN KEY ("evaluation_run_id") REFERENCES "public"."evaluation_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_evaluation_run_id_evaluation_runs_id_fk" FOREIGN KEY ("evaluation_run_id") REFERENCES "public"."evaluation_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "finding_evidence_run_fk" FOREIGN KEY ("evidence_id","evaluation_run_id") REFERENCES "public"."evidence"("id","evaluation_run_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hackathon_events" ADD CONSTRAINT "hackathon_events_organizer_id_organizer_users_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "public"."organizer_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payout_approval_award_fk" FOREIGN KEY ("approval_id","award_id") REFERENCES "public"."award_approvals"("id","award_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric_versions" ADD CONSTRAINT "rubric_versions_event_id_hackathon_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."hackathon_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_event_id_hackathon_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."hackathon_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assessment_run_idx" ON "assessments" USING btree ("evaluation_run_id","submission_id","event_id");--> statement-breakpoint
CREATE INDEX "assessment_finalizer_idx" ON "assessments" USING btree ("finalized_by");--> statement-breakpoint
CREATE INDEX "audit_event_created_idx" ON "audit_events" USING btree ("event_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_actor_idx" ON "audit_events" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "approval_assessment_idx" ON "award_approvals" USING btree ("assessment_id","assessment_status");--> statement-breakpoint
CREATE INDEX "approval_organizer_idx" ON "award_approvals" USING btree ("approved_by");--> statement-breakpoint
CREATE INDEX "award_assessment_idx" ON "awards" USING btree ("assessment_id","submission_id","event_id");--> statement-breakpoint
CREATE INDEX "run_status_idx" ON "evaluation_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "run_submission_idx" ON "evaluation_runs" USING btree ("submission_id","event_id");--> statement-breakpoint
CREATE INDEX "run_rubric_idx" ON "evaluation_runs" USING btree ("rubric_version_id","event_id");--> statement-breakpoint
CREATE INDEX "evidence_run_idx" ON "evidence" USING btree ("evaluation_run_id");--> statement-breakpoint
CREATE INDEX "finding_evidence_idx" ON "findings" USING btree ("evidence_id","evaluation_run_id");--> statement-breakpoint
CREATE INDEX "finding_run_idx" ON "findings" USING btree ("evaluation_run_id");--> statement-breakpoint
CREATE INDEX "event_organizer_idx" ON "hackathon_events" USING btree ("organizer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organizer_email_unique" ON "organizer_users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "payout_status_idx" ON "payouts" USING btree ("status");