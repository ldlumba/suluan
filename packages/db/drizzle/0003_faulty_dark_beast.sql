ALTER TABLE "outbox_events" ADD COLUMN "claim_token" uuid;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "lease_until" timestamp with time zone;