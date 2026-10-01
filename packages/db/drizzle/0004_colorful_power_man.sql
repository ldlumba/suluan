CREATE TYPE "public"."extraction_status" AS ENUM('QUEUED', 'PROCESSING', 'EXTRACTED', 'FAILED');--> statement-breakpoint
CREATE TABLE "processing_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"record_id" uuid NOT NULL,
	"status" "extraction_status" DEFAULT 'QUEUED' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"claim_token" uuid,
	"lease_until" timestamp with time zone,
	"error_code" text,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "processing_jobs_record_id_unique" UNIQUE("record_id")
);
--> statement-breakpoint
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_record_id_research_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."research_records"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- Existing accepted development records also need a durable job. No extraction
-- runs during migration, and pending/rejected submissions are excluded.
INSERT INTO processing_jobs (record_id)
SELECT r.id FROM research_records r JOIN submissions s ON s.id = r.submission_id
WHERE s.status = 'ACCEPTED'
ON CONFLICT (record_id) DO NOTHING;
