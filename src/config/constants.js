// ─────────────────────────────────────────────────────────────────────────────
// Application constants — TRD §6/§7, apidoc §4/§6/§7, task 2.2.
//
// This module is the single JS-side source for three kinds of value that would
// otherwise be retyped as literals across dozens of call sites: the system enums,
// the pagination bounds, and the rate-limit tiers. It is the constants analogue of
// src/utils/cache-keys.js — the point is that no Zod schema, middleware, or service
// writes `'STUDENT'` or `100` inline, because a literal that drifts from the schema
// is a bug no test looking at one file would catch.
//
// ── The enums are a hand-authored MIRROR of schema.prisma, on purpose ─────────
//
// @prisma/client does export these enums as runtime objects, and importing them
// here would make drift impossible. It is deliberately not done: constants.js is
// imported by middleware that has nothing to do with the database (the rate
// limiter, the validator), and coupling it to the generated Prisma client would
// drag the client into every one of those import graphs and into unit tests that
// never touch Postgres. The mirror stays dependency-free; a probe asserted it
// matches @prisma/client's enums exactly at authoring time (all nine, member for
// member), and apidoc §7 pins the same nine as the published contract.
//
// ── Why all nine, when the plan names only two ───────────────────────────────
//
// Task 2.2's text lists "role enums, course levels" as the enum examples. All nine
// are mirrored rather than those two, because apidoc §7 frames them as one
// reference set ("all nine enums") and §6 already names `config/constants.js` as
// where the shared values live. Mirroring two of nine would send the Zod schemas
// on Day 3+ back to inline `z.enum(['ACTIVE','COMPLETED','DROPPED'])` literals —
// exactly the retyping this file exists to prevent. The values are copied, not
// invented, so the breadth carries no correctness risk.
//
// Each enum is a frozen object whose keys equal their values, which is how Prisma
// represents string enums and what makes `z.nativeEnum(EnrollmentStatus)` accept
// it directly.
// ─────────────────────────────────────────────────────────────────────────────

/** `UserRole` — authorization tier (apidoc §3, §7). */
export const UserRole = Object.freeze({
  STUDENT: 'STUDENT',
  INSTRUCTOR: 'INSTRUCTOR',
  ADMIN: 'ADMIN',
});

/** `CourseLevel` — course taxonomy & difficulty (apidoc §7). */
export const CourseLevel = Object.freeze({
  BEGINNER: 'BEGINNER',
  INTERMEDIATE: 'INTERMEDIATE',
  ADVANCED: 'ADVANCED',
  ALL_LEVELS: 'ALL_LEVELS',
});

/** `LessonType` — lesson content player rendering (apidoc §7). */
export const LessonType = Object.freeze({
  VIDEO: 'VIDEO',
  TEXT: 'TEXT',
  CODE: 'CODE',
  QUIZ: 'QUIZ',
});

/** `EnrollmentStatus` — student course participation lifecycle (apidoc §7). */
export const EnrollmentStatus = Object.freeze({
  ACTIVE: 'ACTIVE',
  COMPLETED: 'COMPLETED',
  DROPPED: 'DROPPED',
});

/** `QuizQuestionType` — assessment grading logic (apidoc §7). */
export const QuizQuestionType = Object.freeze({
  MULTIPLE_CHOICE: 'MULTIPLE_CHOICE',
  TRUE_FALSE: 'TRUE_FALSE',
});

/** `NotificationType` — in-app notification categorization (apidoc §7). */
export const NotificationType = Object.freeze({
  SYSTEM: 'SYSTEM',
  ENROLLMENT: 'ENROLLMENT',
  COURSE_UPDATE: 'COURSE_UPDATE',
  ACHIEVEMENT: 'ACHIEVEMENT',
  CERTIFICATE: 'CERTIFICATE',
});

/** `AchievementCriteria` — achievement evaluation dispatch (apidoc §7, §8.12). */
export const AchievementCriteria = Object.freeze({
  COURSES_COMPLETED: 'COURSES_COMPLETED',
  QUIZ_PERFECT_SCORE: 'QUIZ_PERFECT_SCORE',
  STREAK_DAYS: 'STREAK_DAYS',
  LESSONS_COMPLETED: 'LESSONS_COMPLETED',
});

/** `AuditActionType` — the governance trail on `AuditLog.actionType` (apidoc §8.11). */
export const AuditActionType = Object.freeze({
  COURSE_APPROVED: 'COURSE_APPROVED',
  COURSE_REJECTED: 'COURSE_REJECTED',
  COURSE_DELETED: 'COURSE_DELETED',
  COURSE_RESTORED: 'COURSE_RESTORED',
  COURSE_REPUBLISHED: 'COURSE_REPUBLISHED',
  USER_BANNED: 'USER_BANNED',
  USER_UNBANNED: 'USER_UNBANNED',
  ROLE_CHANGED: 'ROLE_CHANGED',
  REVIEW_DELETED: 'REVIEW_DELETED',
});

/** `AuditTargetType` — the subject of an `AuditLog` row (apidoc §7). */
export const AuditTargetType = Object.freeze({
  COURSE: 'COURSE',
  USER: 'USER',
  REVIEW: 'REVIEW',
});

// ── Pagination (apidoc §6, TRD §6) ───────────────────────────────────────────
//
// DEFAULT_LIMIT and MAX_LIMIT are the numbers the shared Zod paginationSchema
// (task 2.6) coerces and bounds-checks against. MAX_LIMIT is a *clamp*, not a
// rejection: `?limit=1000000` serves 100 items rather than erroring or running an
// unbounded scan. Keeping both numbers here is what lets that one schema define
// the policy for every list endpoint.
export const PAGINATION = Object.freeze({
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 10,
  MAX_LIMIT: 100,
});

// ── Rate-limit tiers (apidoc §4, TRD §7) ─────────────────────────────────────
//
// The three tiers task 2.4 wires into express-rate-limit, each keyed on req.ip
// behind `trust proxy`. The window is 15 minutes for all three; only the ceiling
// differs. GET /health is bypassed entirely (see app.js), so it has no tier.
//
// windowMs is expressed in milliseconds because that is the unit express-rate-limit
// takes; the max is the request ceiling within that window.
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

export const RATE_LIMITS = Object.freeze({
  // General API traffic. apidoc §4: 100 requests / 15 min.
  GLOBAL: Object.freeze({ windowMs: RATE_LIMIT_WINDOW_MS, max: 100 }),
  // register, login, refresh, forgot-password, reset-password, verify-email.
  // Deliberately strict: these are the brute-force surface (apidoc §4: 5 / 15 min).
  AUTH: Object.freeze({ windowMs: RATE_LIMIT_WINDOW_MS, max: 5 }),
  // unpublish, republish, soft-delete, restore, ban, unban, role
  // (apidoc §4: 10 / 15 min).
  ADMIN: Object.freeze({ windowMs: RATE_LIMIT_WINDOW_MS, max: 10 }),
});
