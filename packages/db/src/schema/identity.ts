import { relations, sql } from 'drizzle-orm'
import {
  boolean,
  check,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

/**
 * LOCKED roles (Architecture v1 §4). STUDENT_RESEARCH / FACULTY_RESEARCH are
 * research categories, NOT privilege levels — never add them here.
 * First-admin provisioning is explicit and audited; never seed an admin row.
 */
export const role = pgEnum('role', ['USER', 'REPOSITORY_MANAGER', 'ADMIN'])

export const profiles = pgTable('profiles', {
  id: uuid('id').defaultRandom().primaryKey(),
  // Firebase UID. Stage 2 wires real verification; until then this is an
  // unverified placeholder populated by whatever the client claims.
  firebaseUid: text('firebase_uid').notNull().unique(),
  // Verified email from the identity provider (Stage 2+). Nullable because
  // identity providers are not guaranteed to supply one; unique because one
  // person holds one account. Used by governed bootstrap/administration flows.
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

/**
 * Single serialization point for governed role changes. Production bootstrap
 * and ADMIN role-management writes update this row in the same SQL statement,
 * so two administrators cannot concurrently remove the final ADMIN account.
 */
export const roleManagementState = pgTable(
  'role_management_state',
  {
    singleton: boolean('singleton').primaryKey().default(true),
    adminCount: integer('admin_count').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check('role_management_state_singleton_true', sql`${table.singleton}`),
    check(
      'role_management_state_admin_count_nonnegative',
      sql`${table.adminCount} >= 0`,
    ),
  ],
)

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
  /** Hidden courses remain valid historical references but cannot be selected. */
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
})

export const schoolsRelations = relations(schools, ({ many }) => ({
  courses: many(courses),
}))

export const coursesRelations = relations(courses, ({ one }) => ({
  school: one(schools, {
    fields: [courses.schoolId],
    references: [schools.id],
  }),
}))
