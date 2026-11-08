ALTER TABLE "payouts" ADD COLUMN "dispatch_state" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "payouts" ADD COLUMN "authorized_by" uuid;--> statement-breakpoint
ALTER TABLE "payouts" ADD COLUMN "authorized_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payouts" ADD COLUMN "recipient_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payouts" ADD COLUMN "dispatch_claim" uuid;--> statement-breakpoint
ALTER TABLE "payouts" ADD COLUMN "dispatch_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payouts" ADD COLUMN "last_outcome" text;--> statement-breakpoint
ALTER TABLE "payouts" ADD COLUMN "state_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payouts" ADD COLUMN "item_status" text;--> statement-breakpoint
ALTER TABLE "payouts" ADD COLUMN "evidence" jsonb;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_authorized_by_organizer_users_id_fk" FOREIGN KEY ("authorized_by") REFERENCES "public"."organizer_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payout_dispatch_shape" CHECK ("payouts"."dispatch_state" IN ('legacy', 'prepared', 'started') AND ("payouts"."dispatch_state" = 'legacy' OR ("payouts"."authorized_by" IS NOT NULL AND "payouts"."authorized_at" IS NOT NULL AND "payouts"."recipient_verified_at" IS NOT NULL)) AND (("payouts"."dispatch_state" = 'started' AND "payouts"."dispatch_claim" IS NOT NULL AND "payouts"."dispatch_started_at" IS NOT NULL) OR ("payouts"."dispatch_state" <> 'started' AND "payouts"."dispatch_claim" IS NULL AND "payouts"."dispatch_started_at" IS NULL)));--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payout_state_version_nonnegative" CHECK ("payouts"."state_version" >= 0);--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payout_item_success_evidence" CHECK ("payouts"."dispatch_state" = 'legacy' OR "payouts"."status" <> 'succeeded' OR coalesce(("payouts"."item_status" = 'SUCCESS' AND "payouts"."evidence" IS NOT NULL AND "payouts"."evidence"->>'itemStatus' = 'SUCCESS' AND "payouts"."evidence"->>'itemId' = "payouts"."paypal_item_id" AND "payouts"."evidence"->>'batchId' = "payouts"."paypal_batch_id" AND "payouts"."evidence"->>'recipientMatched' = 'true'), false));--> statement-breakpoint
-- Permanent database barrier: no deletion, identity rotation, claim reset or
-- reopening a legacy record. Provider duplicate retention is not this barrier.
CREATE FUNCTION "public"."hackref_payout_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE owner_id uuid; approved award_approvals%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Payout history cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.id, NEW.award_id, NEW.approval_id, NEW.environment, NEW.sender_batch_id, NEW.sender_item_id, NEW.authorized_by, NEW.authorized_at, NEW.recipient_verified_at, NEW.created_at)
       IS DISTINCT FROM ROW(OLD.id, OLD.award_id, OLD.approval_id, OLD.environment, OLD.sender_batch_id, OLD.sender_item_id, OLD.authorized_by, OLD.authorized_at, OLD.recipient_verified_at, OLD.created_at)
       OR (OLD.dispatch_state = 'legacy' AND NEW.dispatch_state <> 'legacy')
       OR (OLD.dispatch_state = 'prepared' AND NEW.dispatch_state NOT IN ('prepared', 'started'))
       OR (OLD.dispatch_state = 'started' AND ROW(NEW.dispatch_state, NEW.dispatch_claim, NEW.dispatch_started_at) IS DISTINCT FROM ROW(OLD.dispatch_state, OLD.dispatch_claim, OLD.dispatch_started_at))
       OR (OLD.paypal_batch_id IS NOT NULL AND NEW.paypal_batch_id IS DISTINCT FROM OLD.paypal_batch_id)
       OR (OLD.paypal_item_id IS NOT NULL AND NEW.paypal_item_id IS DISTINCT FROM OLD.paypal_item_id)
       OR NEW.state_version <= OLD.state_version THEN
      RAISE EXCEPTION 'Payout identity and dispatch claim are permanent; updates require a newer version' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.dispatch_state <> 'legacy' THEN
    SELECT e.organizer_id INTO owner_id FROM awards a JOIN hackathon_events e ON e.id = a.event_id WHERE a.id = NEW.award_id;
    SELECT * INTO approved FROM award_approvals WHERE id = NEW.approval_id AND award_id = NEW.award_id;
    IF NEW.authorized_by IS DISTINCT FROM owner_id OR approved.approved_by IS DISTINCT FROM owner_id THEN
      RAISE EXCEPTION 'Payout authorization must belong to the event organizer' USING ERRCODE = '23514';
    END IF;
    IF NEW.dispatch_state = 'prepared' AND (NEW.status <> 'intent' OR NEW.paypal_batch_id IS NOT NULL OR NEW.paypal_item_id IS NOT NULL OR NEW.evidence IS NOT NULL) THEN
      RAISE EXCEPTION 'Prepared payout has not been dispatched' USING ERRCODE = '23514';
    END IF;
    IF NEW.evidence IS NOT NULL AND (
      NEW.evidence->>'senderBatchId' IS DISTINCT FROM NEW.sender_batch_id OR
      NEW.evidence->>'senderItemId' IS DISTINCT FROM NEW.sender_item_id OR
      NEW.evidence->>'batchId' IS DISTINCT FROM NEW.paypal_batch_id OR
      NEW.evidence->>'itemId' IS DISTINCT FROM NEW.paypal_item_id OR
      NEW.evidence->>'itemStatus' IS DISTINCT FROM NEW.item_status OR
      NEW.evidence->>'currency' IS DISTINCT FROM 'USD' OR
      NEW.evidence->>'amount' IS DISTINCT FROM ((approved.amount_cents / 100)::text || '.' || lpad((approved.amount_cents % 100)::text, 2, '0')) OR
      NEW.evidence->>'recipientMatched' IS DISTINCT FROM 'true' OR NEW.reconciled_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Payout evidence must match the approved item' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER payout_permanent_guard BEFORE INSERT OR UPDATE OR DELETE ON "payouts"
FOR EACH ROW EXECUTE FUNCTION "public"."hackref_payout_guard"();
