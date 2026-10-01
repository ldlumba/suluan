CREATE TYPE "public"."record_visibility" AS ENUM('PUBLIC', 'UA_ONLY', 'RESTRICTED');--> statement-breakpoint
ALTER TABLE "research_records" ADD COLUMN "visibility" "record_visibility" DEFAULT 'PUBLIC' NOT NULL;--> statement-breakpoint
ALTER TABLE "research_records" ADD COLUMN "embargo_until" date;