ALTER TABLE "research_records" ADD COLUMN "year" integer;
--> statement-breakpoint
UPDATE "research_records" r
SET "year" = extract(
  year from coalesce(
    (select d."decided_at" from "decisions" d where d."submission_id" = r."submission_id"),
    r."created_at"
  )
)::integer;
--> statement-breakpoint
ALTER TABLE "research_records" ALTER COLUMN "year" SET NOT NULL;
--> statement-breakpoint
INSERT INTO "schools" ("name") VALUES
  ('School of Health, Arts and Sciences'),
  ('School of Education'),
  ('School of Business'),
  ('School of Technological Studies')
ON CONFLICT ("name") DO NOTHING;
--> statement-breakpoint
INSERT INTO "courses" ("school_id", "name")
SELECT s."id", catalog."course_name"
FROM (VALUES
  ('School of Health, Arts and Sciences', 'AB Communication'),
  ('School of Health, Arts and Sciences', 'Bachelor in Human Services'),
  ('School of Health, Arts and Sciences', 'BS Psychology'),
  ('School of Health, Arts and Sciences', 'BS Criminology'),
  ('School of Health, Arts and Sciences', 'BS Nursing'),
  ('School of Health, Arts and Sciences', 'BS Pharmacy'),
  ('School of Health, Arts and Sciences', 'MA Guidance and Counseling'),
  ('School of Education', 'Bachelor of Early Childhood Education'),
  ('School of Education', 'Bachelor of Elementary Education'),
  ('School of Education', 'Bachelor of Physical Education'),
  ('School of Education', 'BSEd – English'),
  ('School of Education', 'BSEd – Mathematics'),
  ('School of Education', 'BSEd – Values Education with Religious Education'),
  ('School of Business', 'BS Accountancy'),
  ('School of Business', 'BS Accounting Information System'),
  ('School of Business', 'BS Hospitality Management'),
  ('School of Business', 'BS Tourism Management'),
  ('School of Business', 'BSBA – Marketing Management'),
  ('School of Business', 'BSBA – Operations Management'),
  ('School of Technological Studies', 'BS Architecture'),
  ('School of Technological Studies', 'BS Civil Engineering'),
  ('School of Technological Studies', 'BS Computer Engineering'),
  ('School of Technological Studies', 'BS Industrial Engineering'),
  ('School of Technological Studies', 'BS Information Technology')
) AS catalog("school_name", "course_name")
JOIN "schools" s ON s."name" = catalog."school_name"
WHERE NOT EXISTS (
  SELECT 1 FROM "courses" c
  WHERE c."school_id" = s."id" AND c."name" = catalog."course_name"
);
--> statement-breakpoint
UPDATE "submissions" submission
SET "school_id" = target_school."id", "course_id" = target_course."id"
FROM "courses" sample_course
JOIN (VALUES
  ('[SAMPLE] BS Computer Engineering', 'School of Technological Studies', 'BS Computer Engineering'),
  ('[SAMPLE] BS Civil Engineering', 'School of Technological Studies', 'BS Civil Engineering'),
  ('[SAMPLE] BA Communication', 'School of Health, Arts and Sciences', 'AB Communication'),
  ('[SAMPLE] BS Psychology', 'School of Health, Arts and Sciences', 'BS Psychology')
) AS mapping("sample_course", "target_school", "target_course")
  ON mapping."sample_course" = sample_course."name"
JOIN "schools" target_school ON target_school."name" = mapping."target_school"
JOIN "courses" target_course
  ON target_course."school_id" = target_school."id"
  AND target_course."name" = mapping."target_course"
WHERE submission."course_id" = sample_course."id";
--> statement-breakpoint
UPDATE "submissions" submission
SET "school_id" = target_school."id"
FROM "schools" sample_school
JOIN (VALUES
  ('[SAMPLE] School of Engineering', 'School of Technological Studies'),
  ('[SAMPLE] School of Arts and Sciences', 'School of Health, Arts and Sciences')
) AS mapping("sample_school", "target_school")
  ON mapping."sample_school" = sample_school."name"
JOIN "schools" target_school ON target_school."name" = mapping."target_school"
WHERE submission."school_id" = sample_school."id";
--> statement-breakpoint
DELETE FROM "courses" WHERE "name" IN (
  '[SAMPLE] BS Computer Engineering',
  '[SAMPLE] BS Civil Engineering',
  '[SAMPLE] BA Communication',
  '[SAMPLE] BS Psychology'
);
--> statement-breakpoint
DELETE FROM "schools" WHERE "name" IN (
  '[SAMPLE] School of Engineering',
  '[SAMPLE] School of Arts and Sciences'
);
