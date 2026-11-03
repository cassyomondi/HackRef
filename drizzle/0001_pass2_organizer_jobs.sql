CREATE TABLE "login_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"attempts" integer NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizer_sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"organizer_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "evaluation_runs" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "evaluation_runs" ADD COLUMN "max_attempts" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "evaluation_runs" ADD COLUMN "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "evaluation_runs" ADD COLUMN "lease_token" uuid;--> statement-breakpoint
ALTER TABLE "evaluation_runs" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "evaluation_runs" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "evaluation_runs" ADD COLUMN "result" jsonb;--> statement-breakpoint
ALTER TABLE "hackathon_events" ADD COLUMN "is_demo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organizer_users" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "repository_owner" text;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "github_repository_id" text;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "claims" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "ownership_attested" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "is_demo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organizer_sessions" ADD CONSTRAINT "organizer_sessions_organizer_id_organizer_users_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "public"."organizer_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "session_expiry_idx" ON "organizer_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "run_queue_idx" ON "evaluation_runs" USING btree ("status","next_attempt_at","lease_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "one_provisioned_organizer" ON "organizer_users" USING btree ((1)) WHERE "organizer_users"."password_hash" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "hackathon_events" ADD CONSTRAINT "one_event_per_organizer" UNIQUE("organizer_id");--> statement-breakpoint
ALTER TABLE "evaluation_runs" ADD CONSTRAINT "run_attempt_bounds" CHECK ("evaluation_runs"."attempts" >= 0 AND "evaluation_runs"."max_attempts" BETWEEN 1 AND 5 AND "evaluation_runs"."attempts" <= "evaluation_runs"."max_attempts");--> statement-breakpoint
ALTER TABLE "evaluation_runs" ADD CONSTRAINT "run_lease_state" CHECK (("evaluation_runs"."status" = 'running' AND "evaluation_runs"."lease_token" IS NOT NULL AND "evaluation_runs"."lease_expires_at" IS NOT NULL) OR ("evaluation_runs"."status" <> 'running' AND "evaluation_runs"."lease_token" IS NULL AND "evaluation_runs"."lease_expires_at" IS NULL));--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submission_claims_array" CHECK (jsonb_typeof("submissions"."claims") = 'array');