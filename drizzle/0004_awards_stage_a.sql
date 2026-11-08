-- Additive guards only: no existing financial or judging records are rewritten.
-- All allocations reserve funds. Approval consumes that reservation, never a
-- second reservation. The event row is the shared serialization point.
CREATE FUNCTION "public"."hackref_award_allocation_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE event_record hackathon_events%ROWTYPE; assessment_record assessments%ROWTYPE; reserved bigint;
BEGIN
  SELECT * INTO event_record FROM hackathon_events WHERE id = NEW.event_id FOR UPDATE;
  IF event_record.id IS NULL THEN RAISE EXCEPTION 'Event not found' USING ERRCODE = '23503'; END IF;
  SELECT * INTO assessment_record FROM assessments WHERE id = NEW.assessment_id FOR SHARE;
  IF assessment_record.id IS NULL OR assessment_record.event_id <> NEW.event_id OR assessment_record.submission_id <> NEW.submission_id THEN
    RAISE EXCEPTION 'Assessment scope mismatch' USING ERRCODE = '23503';
  END IF;
  IF assessment_record.status <> 'finalized' OR assessment_record.finalized_by IS DISTINCT FROM event_record.organizer_id OR assessment_record.finalized_at IS NULL THEN
    RAISE EXCEPTION 'Award requires an organizer-finalized assessment' USING ERRCODE = '23514';
  END IF;
  IF NEW.revision <> 1 OR length(NEW.title) NOT BETWEEN 1 AND 120 OR NEW.title <> trim(NEW.title)
     OR NEW.title ~ '[[:cntrl:]]' OR length(NEW.recipient_email) > 254
     OR NEW.recipient_email !~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?([.][A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$' THEN
    RAISE EXCEPTION 'Invalid award terms' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM awards WHERE event_id = NEW.event_id AND (submission_id = NEW.submission_id OR lower(title) = lower(NEW.title))) THEN
    RAISE EXCEPTION 'An award already uses this project or title' USING ERRCODE = '23505';
  END IF;
  SELECT coalesce(sum(amount_cents), 0) INTO reserved FROM awards WHERE event_id = NEW.event_id;
  IF reserved + NEW.amount_cents > event_record.budget_cents THEN
    RAISE EXCEPTION 'Award exceeds event budget' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER award_allocation_guard BEFORE INSERT ON "awards"
FOR EACH ROW EXECUTE FUNCTION "public"."hackref_award_allocation_guard"();
--> statement-breakpoint
CREATE FUNCTION "public"."hackref_award_budget_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.budget_cents < (SELECT coalesce(sum(amount_cents), 0) FROM awards WHERE event_id = NEW.id) THEN
    RAISE EXCEPTION 'Budget is below reserved awards' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER award_budget_guard BEFORE UPDATE OF budget_cents ON "hackathon_events"
FOR EACH ROW EXECUTE FUNCTION "public"."hackref_award_budget_guard"();
--> statement-breakpoint
CREATE FUNCTION "public"."hackref_award_approval_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE event_record hackathon_events%ROWTYPE; award_record awards%ROWTYPE;
BEGIN
  -- Read only to discover the lock key; awards cannot be changed/deleted.
  SELECT * INTO award_record FROM awards WHERE id = NEW.award_id;
  IF award_record.id IS NULL THEN RAISE EXCEPTION 'Award not found' USING ERRCODE = '23503'; END IF;
  SELECT * INTO event_record FROM hackathon_events WHERE id = award_record.event_id FOR UPDATE;
  IF NEW.approved_by IS DISTINCT FROM event_record.organizer_id THEN
    RAISE EXCEPTION 'Approver must own the event' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM assessments WHERE id = award_record.assessment_id AND status = 'finalized' AND finalized_by = NEW.approved_by AND finalized_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Award requires a human-finalized assessment' USING ERRCODE = '23514';
  END IF;
  IF event_record.budget_cents < (SELECT coalesce(sum(amount_cents), 0) FROM awards WHERE event_id = event_record.id) THEN
    RAISE EXCEPTION 'Awards exceed event budget' USING ERRCODE = '23514';
  END IF;
  -- Existing composite foreign keys enforce every approved financial term.
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER award_approval_guard BEFORE INSERT ON "award_approvals"
FOR EACH ROW EXECUTE FUNCTION "public"."hackref_award_approval_guard"();
--> statement-breakpoint
CREATE FUNCTION "public"."hackref_preserve_award_history"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Award allocations and approvals are immutable; correction requires an explicit future workflow' USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER award_history_immutable BEFORE UPDATE OR DELETE ON "awards"
FOR EACH ROW EXECUTE FUNCTION "public"."hackref_preserve_award_history"();
--> statement-breakpoint
CREATE TRIGGER award_approval_immutable BEFORE UPDATE OR DELETE ON "award_approvals"
FOR EACH ROW EXECUTE FUNCTION "public"."hackref_preserve_award_history"();
