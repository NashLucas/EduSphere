// ─────────────────────────────────────────────────────────────────────────────
// Application constants — TRD §6/§7, apidoc §4/§6/§7, task 2.2.
//
// This module is the single JS-side source for the values that would otherwise be
// retyped as literals across dozens of call sites: the system enums, the pagination
// bounds, the field limits, the credential parameters, and the rate-limit tiers.
// It is the constants analogue of
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

// ── Field limits (apidoc §8.2, §8.3) ─────────────────────────────────────────
//
// Bounds the Zod schemas enforce on user-supplied strings. Here rather than in
// one module's schema file because each is used by more than one module: the
// name bounds by POST /auth/register and PATCH /users/me, the password bounds by
// register and reset-password. The wording that reports a breach lives in
// MESSAGES.VALIDATION; these are the numbers that wording describes.
//
// Two of these are not in the plan text and exist for a measured reason:
//
// EMAIL_MAX_LENGTH is RFC 5321's cap on a forward path (64-octet local part +
// @ + 255-octet domain, 254 in practice). It matters here because `email` is a
// PostgreSQL `text` column with a UNIQUE constraint and therefore a btree index,
// and btree refuses an entry over roughly 2704 bytes. Unbounded, a long address
// turns the uniqueness check into a 500 from the driver instead of a 422 from
// the validator.
//
// PASSWORD_MAX_BYTES is bcrypt's block limit, and the reason it is in BYTES.
// Measured on bcryptjs 2.4.3: hashing 72 'A's and then comparing 72 'A's + 'B'
// returns TRUE, as does the same hash against 272 characters. 36 accented
// characters (72 bytes) compare TRUE against the hash of 40 of them. Everything
// past the 72nd byte is silently discarded, so without this cap two different
// passwords sharing a 72-byte prefix are interchangeable at login -- and the
// boundary lands mid-string for any non-ASCII passphrase.
export const FIELD_LIMITS = Object.freeze({
  NAME_MIN_LENGTH: 2,
  NAME_MAX_LENGTH: 100,
  EMAIL_MAX_LENGTH: 254,
  PASSWORD_MIN_LENGTH: 8,
  PASSWORD_MAX_BYTES: 72,
});

// ── Credential parameters (TRD §7, task 3.3) ─────────────────────────────────
//
// FIELD_LIMITS above bounds what a CLIENT may send. These two describe what this
// application GENERATES, which is why they are a separate group: one is a
// validation ceiling, the other is a security parameter with a cost attached.

/**
 * bcryptjs cost factor — TRD §7, "Password Hashing: bcryptjs with salt round
 * cost factor 12".
 *
 * Deliberately not an environment variable. A cost factor read from the
 * environment is a silent downgrade waiting to happen: every password hashed
 * after a typo'd `BCRYPT_ROUNDS=4` stays weak forever, because the cost is baked
 * into each stored hash and nothing re-hashes them. As a constant it is visible
 * in a diff and identical in every environment.
 *
 * The number has a runtime cost, which is why both call sites hash OUTSIDE their
 * transaction: measured on this machine over 7 runs, one hash at cost 12 costs
 * 255-351 ms of pure CPU, median ~290 ms (src/modules/auth/auth.service.js,
 * src/database/seed.js:199).
 */
export const BCRYPT_ROUNDS = 12;

// One number, so the generator and the schema that validates its output cannot
// disagree. 32 bytes of crypto.randomBytes → 64 lowercase hex characters, 256
// bits of entropy; a token is unguessable rather than merely unlikely to be
// guessed, which matters because possessing one verifies an account or resets a
// password (TRD §6.1).
const TOKEN_BYTES = 32;

/**
 * The single-use tokens emailed for verification (24 h) and password reset
 * (15 min) — TRD §6.1, generated by `generateToken()` in the auth service and
 * validated by the shared `token` builder in auth.schema.js.
 *
 * LENGTH is derived rather than written, so widening BYTES cannot leave the
 * schema rejecting the generator's own output.
 */
export const TOKEN = Object.freeze({
  BYTES: TOKEN_BYTES,
  LENGTH: TOKEN_BYTES * 2, // hex is two characters per byte
});

// ── JWT parameters (TRD §6.1, §7.1) ──────────────────────────────────────────
//
// Both of these lived in auth.service.js until task 3.10, which is when they
// acquired a second reader: requireAuth VERIFIES what signAccessToken MINTS, from a
// different file. A duplicated pair is the drift hazard signAccessToken's own
// comment names — "a token signed with the wrong `type` claim is refused by nothing
// until requireAuth reads it" — so the constants moved here, where a change is a
// change for both sides at once.
//
// The middleware is why they are here and not exported from the auth service:
// requireAuth guards every module, and pointing platform-wide infrastructure at one
// module's service would put the whole auth service (bcrypt, Prisma, the email
// client) into the import graph of every route file that only wanted a guard. This
// module is dependency-free by design — see the header.

/**
 * The single algorithm either JWT key is ever accepted under.
 *
 * Pinned on every verify, and measured to be load-bearing. Without it, a token
 * whose header says HS512 and whose signature is a correct HS512 MAC over the
 * same secret VERIFIES — jsonwebtoken trusts the header's `alg` when given no
 * list. With it the same token is refused as "invalid algorithm".
 *
 * Not, as the usual telling has it, a defence against `alg:none`: jsonwebtoken 9
 * refuses an unsigned token unaided, with or without this list (also measured).
 * The real exposure is algorithm substitution, and the pin closes it by leaving
 * exactly one algorithm the header is allowed to name.
 *
 * Stated on the sign calls too, where it is already jsonwebtoken's default. That
 * is the point: a reader should not have to know the library's default to see
 * that what this application signs and what it accepts are the same one algorithm.
 */
export const JWT_ALGORITHM = 'HS256';

/**
 * The `type` claim carried by each of the two token kinds.
 *
 * Secondary to the two signing keys, never a substitute: an access token presented
 * to `POST /auth/refresh` fails on the SIGNATURE before its `type` is read, and a
 * refresh token presented as a Bearer fails the same way (both measured). The claim
 * is the belt behind those braces — it is what makes a mint/verify mismatch a 401
 * at the door rather than a token that works in the wrong half of the system.
 */
export const TOKEN_TYPE = Object.freeze({
  ACCESS: 'access',
  REFRESH: 'refresh',
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
