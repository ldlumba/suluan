import { pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

/**
 * LOCKED roles (Architecture v1 §4). STUDENT_RESEARCH / FACULTY_RESEARCH are
 * research categories, NOT privilege levels — never add them here.
 * First-admin provisioning is TBD; do not seed an admin row.
 */
export const role = pgEnum('role', ['USER', 'REPOSITORY_MANAGER', 'ADMIN'])

export const profiles = pgTable('profiles', {
  id: uuid('id').defaultRandom().primaryKey(),
  // Firebase UID. Stage 2 wires real verification; until then this is an
  // unverified placeholder populated by whatever the client claims.
  firebaseUid: text('firebase_uid').notNull().unique(),
  // Verified email from the identity provider (Stage 2+). Nullable because
  // identity providers are not guaranteed to supply one; unique because one
  // person holds one account. Used by the dev-only admin promotion script.
  email: text('email').unique(),
  role: role('role').notNull().default('USER'),
  displayName: text('display_name'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
})

// School/course catalogs live in Neon with course depending on school.
// Concrete catalog contents are TBD — these tables ship EMPTY.
export const schools = pgTable('schools', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
})

export const courses = pgTable('courses', {
  id: uuid('id').defaultRandom().primaryKey(),
  schoolId: uuid('school_id')
    .notNull()
    .references(() => schools.id),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
})
