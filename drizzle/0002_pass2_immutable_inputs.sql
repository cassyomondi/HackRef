-- Custom SQL migration file, put your code below! --
-- Published rubrics and registered submission snapshots are append-only inputs.
CREATE FUNCTION "public"."hackref_reject_input_update"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'updated_at') THEN
    RAISE EXCEPTION 'Registered evaluation inputs are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER rubric_snapshot_immutable BEFORE UPDATE ON "rubric_versions"
FOR EACH ROW EXECUTE FUNCTION "public"."hackref_reject_input_update"();
--> statement-breakpoint
CREATE TRIGGER submission_snapshot_immutable BEFORE UPDATE ON "submissions"
FOR EACH ROW EXECUTE FUNCTION "public"."hackref_reject_input_update"();
