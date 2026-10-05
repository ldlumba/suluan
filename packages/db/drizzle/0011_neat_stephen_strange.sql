CREATE TABLE "embedding_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_token" uuid NOT NULL,
	"kind" text DEFAULT 'prep' NOT NULL,
	"inputs" integer DEFAULT 0 NOT NULL,
	"payload" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "embedding_claims_claim_token_unique" UNIQUE("claim_token")
);
