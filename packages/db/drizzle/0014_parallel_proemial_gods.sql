ALTER TABLE "research_records" ADD COLUMN "doi" text;--> statement-breakpoint
ALTER TABLE "research_records" ADD COLUMN "venue" text;--> statement-breakpoint
ALTER TABLE "research_records" ADD COLUMN "volume" text;--> statement-breakpoint
ALTER TABLE "research_records" ADD COLUMN "issue" text;--> statement-breakpoint
ALTER TABLE "research_records" ADD COLUMN "pages" text;--> statement-breakpoint
ALTER TABLE "research_records" ADD COLUMN "pub_year" integer;--> statement-breakpoint
ALTER TABLE "research_records" ADD COLUMN "doi_source" text;--> statement-breakpoint
ALTER TABLE "research_records" ADD COLUMN "doi_checked_at" timestamp with time zone;