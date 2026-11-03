-- Custom SQL migration file, put your code below! --
INSERT INTO "courses" ("school_id", "name")
SELECT s."id", 'Other'
FROM "schools" s
WHERE s."name" IN ('School of Health, Arts and Sciences', 'School of Education', 'School of Business', 'School of Technological Studies')
  AND NOT EXISTS (
    SELECT 1 FROM "courses" c WHERE c."school_id" = s."id" AND c."name" = 'Other'
  );
