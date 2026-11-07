ALTER TABLE "assessments" ADD COLUMN "source_draft_id" uuid;--> statement-breakpoint
ALTER TABLE "assessments" ADD COLUMN "criterion_decisions" jsonb;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessment_id_run_scope_unique" UNIQUE("id","evaluation_run_id","submission_id","event_id");--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessment_source_draft_scope_fk" FOREIGN KEY ("source_draft_id","evaluation_run_id","submission_id","event_id") REFERENCES "public"."assessments"("id","evaluation_run_id","submission_id","event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assessment_one_review_per_run" ON "assessments" USING btree ("evaluation_run_id") WHERE "assessments"."source_draft_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessment_source_draft_unique" UNIQUE("source_draft_id");--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessment_review_shape" CHECK (("assessments"."source_draft_id" IS NULL AND "assessments"."criterion_decisions" IS NULL) OR ("assessments"."source_draft_id" IS NOT NULL AND "assessments"."source_draft_id" <> "assessments"."id" AND "assessments"."status" = 'finalized' AND jsonb_typeof("assessments"."criterion_decisions") = 'object' AND "assessments"."criterion_decisions" IS NOT NULL));
--> statement-breakpoint
-- Existing historical records remain intact. Validate every new finalization,
-- including direct SQL writers; new AI reviews must reference their source draft.
CREATE FUNCTION "public"."hackref_validate_final_assessment"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  run_record evaluation_runs%ROWTYPE;
  source_record assessments%ROWTYPE;
  rubric_criteria jsonb;
  criterion jsonb;
  suggestion jsonb;
  decision jsonb;
  criterion_key text;
BEGIN
  IF NEW.status <> 'finalized' THEN RETURN NEW; END IF;
  SELECT * INTO run_record FROM evaluation_runs WHERE id = NEW.evaluation_run_id;
  SELECT criteria INTO rubric_criteria FROM rubric_versions WHERE id = run_record.rubric_version_id;
  IF NOT EXISTS (SELECT 1 FROM hackathon_events WHERE id = NEW.event_id AND organizer_id = NEW.finalized_by) THEN
    RAISE EXCEPTION 'Reviewer must own the event' USING ERRCODE = '23514';
  END IF;
  IF length(trim(NEW.rationale)) < 10 OR jsonb_typeof(NEW.scores) IS DISTINCT FROM 'object'
     OR rubric_criteria IS NULL OR jsonb_array_length(rubric_criteria) = 0 THEN
    RAISE EXCEPTION 'A final assessment needs rationale, rubric and scores' USING ERRCODE = '23514';
  END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(NEW.scores)) <> jsonb_array_length(rubric_criteria) THEN
    RAISE EXCEPTION 'Final scores must match every rubric key' USING ERRCODE = '23514';
  END IF;
  IF NEW.source_draft_id IS NULL AND run_record.result->'draft' IS NOT NULL THEN
    RAISE EXCEPTION 'AI finalization requires a source draft and criterion decisions' USING ERRCODE = '23514';
  END IF;
  IF NEW.source_draft_id IS NOT NULL THEN
    SELECT * INTO source_record FROM assessments WHERE id = NEW.source_draft_id FOR SHARE;
    IF source_record.id IS NULL OR source_record.status <> 'draft' OR source_record.evaluation_run_id <> NEW.evaluation_run_id
       OR NEW.version <> source_record.version + 1 OR run_record.status <> 'completed'
       OR run_record.result->>'assessmentId' IS DISTINCT FROM source_record.id::text THEN
      RAISE EXCEPTION 'Review must reference the completed original draft' USING ERRCODE = '23514';
    END IF;
    IF jsonb_typeof(NEW.criterion_decisions) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'Criterion decisions are required' USING ERRCODE = '23514';
    END IF;
    IF (SELECT count(*) FROM jsonb_object_keys(NEW.criterion_decisions)) <> jsonb_array_length(rubric_criteria) THEN
      RAISE EXCEPTION 'Review every criterion explicitly' USING ERRCODE = '23514';
    END IF;
  END IF;
  FOR criterion IN SELECT value FROM jsonb_array_elements(rubric_criteria) LOOP
    criterion_key := criterion->>'key';
    IF jsonb_typeof(NEW.scores->criterion_key) IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'Every criterion needs a numeric score' USING ERRCODE = '23514';
    END IF;
    IF (NEW.scores->>criterion_key)::numeric < 0 OR (NEW.scores->>criterion_key)::numeric > (criterion->>'maxScore')::numeric THEN
      RAISE EXCEPTION 'Score exceeds rubric bounds' USING ERRCODE = '23514';
    END IF;
    IF NEW.source_draft_id IS NOT NULL THEN
      decision := NEW.criterion_decisions->criterion_key;
      IF jsonb_typeof(decision) IS DISTINCT FROM 'object' OR decision->>'action' IS NULL
         OR decision->>'action' NOT IN ('accept', 'override') OR jsonb_typeof(decision->'reason') IS DISTINCT FROM 'string' THEN
        RAISE EXCEPTION 'Invalid criterion decision' USING ERRCODE = '23514';
      END IF;
      IF decision->>'action' = 'override' AND length(trim(decision->>'reason')) < 10 THEN
        RAISE EXCEPTION 'Overrides require explicit reasoning' USING ERRCODE = '23514';
      END IF;
      IF decision->>'action' = 'accept' THEN
        SELECT value INTO suggestion FROM jsonb_array_elements(run_record.result->'draft'->'criteria') WHERE value->>'key' = criterion_key;
        IF suggestion IS NULL OR suggestion->>'status' = 'NOT_EVALUATED'
           OR jsonb_typeof(suggestion->'suggestedScore') IS DISTINCT FROM 'number'
           OR suggestion->'suggestedScore' IS DISTINCT FROM NEW.scores->criterion_key THEN
          RAISE EXCEPTION 'Unscored or changed suggestions require override reasoning' USING ERRCODE = '23514';
        END IF;
      END IF;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER assessment_validate_final BEFORE INSERT OR UPDATE ON "assessments"
FOR EACH ROW EXECUTE FUNCTION "public"."hackref_validate_final_assessment"();
--> statement-breakpoint
CREATE FUNCTION "public"."hackref_preserve_assessment"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'finalized' OR EXISTS (
    SELECT 1 FROM evaluation_runs WHERE id = OLD.evaluation_run_id AND result->>'assessmentId' = OLD.id::text
  ) THEN
    RAISE EXCEPTION 'Published assessments are immutable; create an explicit review version' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER assessment_immutable BEFORE UPDATE OR DELETE ON "assessments"
FOR EACH ROW EXECUTE FUNCTION "public"."hackref_preserve_assessment"();
--> statement-breakpoint
CREATE FUNCTION "public"."hackref_preserve_ai_provenance"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE run_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'evaluation_runs' THEN
    IF OLD.status = 'completed' AND OLD.result->'draft' IS NOT NULL THEN
      RAISE EXCEPTION 'Published AI provenance is immutable' USING ERRCODE = '23514';
    END IF;
  ELSE
    run_id := OLD.evaluation_run_id;
    IF EXISTS (SELECT 1 FROM evaluation_runs WHERE id = run_id AND status = 'completed' AND result->'draft' IS NOT NULL) THEN
      RAISE EXCEPTION 'Published AI evidence is immutable' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER ai_run_provenance_immutable BEFORE UPDATE OR DELETE ON "evaluation_runs"
FOR EACH ROW EXECUTE FUNCTION "public"."hackref_preserve_ai_provenance"();
--> statement-breakpoint
CREATE TRIGGER ai_evidence_immutable BEFORE UPDATE OR DELETE ON "evidence"
FOR EACH ROW EXECUTE FUNCTION "public"."hackref_preserve_ai_provenance"();
--> statement-breakpoint
CREATE TRIGGER ai_findings_immutable BEFORE UPDATE OR DELETE ON "findings"
FOR EACH ROW EXECUTE FUNCTION "public"."hackref_preserve_ai_provenance"();
