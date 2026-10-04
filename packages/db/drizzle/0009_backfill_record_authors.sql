INSERT INTO "record_authors" ("record_id", "name", "position")
SELECT r."id", btrim(author."name"), (author."ordinality" - 1)::integer
FROM "research_records" r
JOIN "submissions" s ON s."id" = r."submission_id"
CROSS JOIN LATERAL regexp_split_to_table(s."authors", E'\\r?\\n')
  WITH ORDINALITY AS author("name", "ordinality")
WHERE s."authors" IS NOT NULL
  AND btrim(author."name") <> ''
  AND NOT EXISTS (
    SELECT 1 FROM "record_authors" existing
    WHERE existing."record_id" = r."id"
  );
