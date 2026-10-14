CREATE TABLE "role_management_state" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"admin_count" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_management_state_singleton_true" CHECK ("role_management_state"."singleton"),
	CONSTRAINT "role_management_state_admin_count_nonnegative" CHECK ("role_management_state"."admin_count" >= 0)
);
--> statement-breakpoint
INSERT INTO "role_management_state" ("singleton", "admin_count")
SELECT true, count(*)::integer FROM "profiles" WHERE "role" = 'ADMIN';
