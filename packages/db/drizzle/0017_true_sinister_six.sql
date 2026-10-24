CREATE TYPE "public"."repository_operation_action" AS ENUM('EXTRACTION', 'EMBEDDING');--> statement-breakpoint
CREATE TYPE "public"."repository_operation_status" AS ENUM('REQUESTED', 'DISPATCHING', 'LAUNCHED', 'FAILED');--> statement-breakpoint
CREATE TABLE "repository_operation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" "repository_operation_action" NOT NULL,
	"status" "repository_operation_status" DEFAULT 'REQUESTED' NOT NULL,
	"ticket_hash" text NOT NULL,
	"execution_name" text,
	"error_code" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repository_operation_runs_ticket_hash_unique" UNIQUE("ticket_hash")
);
--> statement-breakpoint
ALTER TABLE "repository_operation_runs" ADD CONSTRAINT "repository_operation_runs_actor_id_profiles_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "repository_operation_runs_active_action_unique" ON "repository_operation_runs" USING btree ("action") WHERE "repository_operation_runs"."status" in ('REQUESTED'::repository_operation_status, 'DISPATCHING'::repository_operation_status);