CREATE TYPE "public"."activity_event_type" AS ENUM('PAPER_VIEW', 'CITATION_COPY', 'DOWNLOAD_START');--> statement-breakpoint
CREATE TABLE "activity_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"event_type" "activity_event_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_record_id_research_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."research_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_events_created_at_idx" ON "activity_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "activity_events_record_type_idx" ON "activity_events" USING btree ("record_id","event_type","created_at");--> statement-breakpoint
CREATE INDEX "activity_events_profile_record_type_idx" ON "activity_events" USING btree ("profile_id","record_id","event_type","created_at");