ALTER TABLE "research_records" ADD COLUMN "withdrawn_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "research_records" ADD COLUMN "lifecycle_version" integer DEFAULT 0 NOT NULL;