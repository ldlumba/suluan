-- Enable the approved extension without choosing an embedding model/dimension.
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TABLE "document_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"index_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"start_offset" integer NOT NULL,
	"end_offset" integer NOT NULL,
	"content" text NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, content)) STORED,
	CONSTRAINT "document_chunks_index_id_ordinal_unique" UNIQUE("index_id","ordinal")
);
--> statement-breakpoint
CREATE TABLE "keyword_indexes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"record_id" uuid NOT NULL,
	"extraction_claim_token" uuid NOT NULL,
	"chunker_version" text NOT NULL,
	"source_sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "keyword_indexes_record_id_extraction_claim_token_chunker_version_unique" UNIQUE("record_id","extraction_claim_token","chunker_version")
);
--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_index_id_keyword_indexes_id_fk" FOREIGN KEY ("index_id") REFERENCES "public"."keyword_indexes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keyword_indexes" ADD CONSTRAINT "keyword_indexes_record_id_research_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."research_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_chunks_search_gin" ON "document_chunks" USING gin ("search_vector");
