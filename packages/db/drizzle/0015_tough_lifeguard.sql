ALTER TABLE "courses" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "normalized_title" text;--> statement-breakpoint
UPDATE "submissions" SET "normalized_title" = regexp_replace(
  btrim(lower(regexp_replace("title", '[^[:alnum:]]+', ' ', 'g'))),
  '[[:space:]]+', ' ', 'g'
);--> statement-breakpoint
ALTER TABLE "submissions" ALTER COLUMN "normalized_title" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "submissions_one_pending_title_per_submitter" ON "submissions" USING btree ("submitter_id","normalized_title") WHERE "submissions"."status" = 'PENDING';
