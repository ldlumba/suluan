CREATE TABLE "document_embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"semantic_index_id" uuid NOT NULL,
	"chunk_id" uuid NOT NULL,
	"embedding" vector(768) NOT NULL,
	CONSTRAINT "document_embeddings_chunk_id_unique" UNIQUE("chunk_id")
);
--> statement-breakpoint
CREATE TABLE "embedding_usage" (
	"bucket" text NOT NULL,
	"actor_key" text NOT NULL,
	"day" date NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	"inputs" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "embedding_usage_bucket_actor_key_day_pk" PRIMARY KEY("bucket","actor_key","day")
);
--> statement-breakpoint
CREATE TABLE "semantic_indexes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"keyword_index_id" uuid NOT NULL,
	"model" text NOT NULL,
	"dimensions" integer NOT NULL,
	"chunker_version" text NOT NULL,
	"source_sha256" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "semantic_indexes_keyword_index_id_model_dimensions_unique" UNIQUE("keyword_index_id","model","dimensions")
);
--> statement-breakpoint
ALTER TABLE "document_embeddings" ADD CONSTRAINT "document_embeddings_semantic_index_id_semantic_indexes_id_fk" FOREIGN KEY ("semantic_index_id") REFERENCES "public"."semantic_indexes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_embeddings" ADD CONSTRAINT "document_embeddings_chunk_id_document_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."document_chunks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "semantic_indexes" ADD CONSTRAINT "semantic_indexes_keyword_index_id_keyword_indexes_id_fk" FOREIGN KEY ("keyword_index_id") REFERENCES "public"."keyword_indexes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "semantic_indexes" ADD CONSTRAINT "semantic_indexes_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_embeddings_semantic_index_idx" ON "document_embeddings" USING btree ("semantic_index_id");