// ─────────────────────────────────────────────────────────────────────────────
// EduSphere database seed — reference data only.
//
// Task 1.5 of IMPLEMENTATION_PLAN.md. Seeds the three sets of rows the platform
// cannot function without and that no user action creates: the subject taxonomy,
// the achievement catalog, and one admin account.
//
// TWO PROPERTIES ARE REQUIREMENTS, NOT NICETIES:
//
// 1. IDEMPOTENT. `npm run db:seed` must succeed against an already-populated
//    database (the plan's Day 1 verification runs it twice). Every write is an
//    upsert keyed on a UNIQUE column — subjects on `slug`, achievements on
//    `title`, the admin on `email`. The `update` branches deliberately omit
//    `Subject.courseCount` and `User.passwordHash`: those are live state that a
//    re-seed must never reset. See the note above each one.
//
// 2. FAILS LOUDLY. `prisma db seed` propagates this script's exit status without
//    inspecting what happened, so a caught-and-logged error would still exit 0
//    and `migrate reset` would report a fully seeded reset of an empty database
//    (IMPLEMENTATION_PLAN.md, CAUTION under task 0.1). The catch below therefore
//    sets a non-zero exit code; it exists to label the failure, never to absorb
//    it. Do not change it to log and return.
//
// All writes run in a single transaction, so a failure part-way through commits
// nothing rather than leaving a half-populated taxonomy.
// ─────────────────────────────────────────────────────────────────────────────

import { PrismaClient, UserRole, AchievementCriteria } from '@prisma/client';
import bcrypt from 'bcryptjs';

// Own client, not the src/database/index.js singleton (task 1.6): that one caches
// onto globalThis and never disconnects, which is right for a long-lived server
// and wrong for a one-shot script that must release the connection and exit.
const prisma = new PrismaClient();

// bcryptjs cost factor 12 — TRD §7 ("Password Hashing: bcryptjs with salt round
// cost factor 12"). The same constant the auth service hashes with on Day 3.
const BCRYPT_ROUNDS = 12;

// `icon` holds an icon NAME, not an emoji or a URL — apidoc §8.5 documents
// `{ "name": "Artificial Intelligence", "slug": "ai", "icon": "cpu",
// "color": "#8B5CF6" }`, which is the third row below verbatim. `color` is a hex
// string the client renders directly, so every value here is distinguishable.
//
// Ten rows because the plan asks for ten. That count is NOT a contract: TRD
// §6.5 is explicit that "Subject Count Is Seed Data, Not a Contract" — POST
// /subjects exists so admins can add more, and GET /subjects returns however
// many live subjects exist. No test should assert a length of 10.
const SUBJECTS = [
  { name: 'Mathematics', slug: 'mathematics', icon: 'sigma', color: '#3B82F6' },
  {
    name: 'Computer Science',
    slug: 'computer-science',
    icon: 'code',
    color: '#6366F1',
  },
  {
    name: 'Artificial Intelligence',
    slug: 'ai',
    icon: 'cpu',
    color: '#8B5CF6',
  },
  { name: 'Physics', slug: 'physics', icon: 'atom', color: '#0EA5E9' },
  {
    name: 'Chemistry',
    slug: 'chemistry',
    icon: 'flask-conical',
    color: '#14B8A6',
  },
  { name: 'Biology', slug: 'biology', icon: 'dna', color: '#22C55E' },
  { name: 'Business', slug: 'business', icon: 'briefcase', color: '#F59E0B' },
  { name: 'Design', slug: 'design', icon: 'palette', color: '#EC4899' },
  { name: 'Languages', slug: 'languages', icon: 'languages', color: '#EF4444' },
  { name: 'Music', slug: 'music', icon: 'music', color: '#A855F7' },
];

// The catalog covers all FOUR AchievementCriteria members. Coverage is
// load-bearing: `evaluateAchievements()` tests catalog rows whose `criteriaType`
// matches the firing event, so a criteria kind with no rows means that trigger
// point can never award anything (IMPLEMENTATION_PLAN.md task 9.3 makes the same
// point about COURSES_COMPLETED and course completion).
//
// `criteriaType` uses the generated Prisma enum rather than a bare string, so a
// typo is `undefined` at import time instead of a P2009 at query time.
// `criteriaValue` is the numeric threshold: a count for the *_COMPLETED and
// QUIZ_PERFECT_SCORE kinds, a number of days for STREAK_DAYS.
//
// Raising a threshold later does not revoke badges already earned under the old
// one (apidoc §8.12), and adding a row here needs no backfill — it is picked up
// on each user's next qualifying action.
const ACHIEVEMENTS = [
  {
    title: 'First Steps',
    description: 'Complete your first course',
    icon: 'award',
    criteriaType: AchievementCriteria.COURSES_COMPLETED,
    criteriaValue: 1,
  },
  {
    title: 'Course Collector',
    description: 'Complete 5 courses',
    icon: 'library',
    criteriaType: AchievementCriteria.COURSES_COMPLETED,
    criteriaValue: 5,
  },
  {
    title: 'Scholar',
    description: 'Complete 10 courses',
    icon: 'graduation-cap',
    criteriaType: AchievementCriteria.COURSES_COMPLETED,
    criteriaValue: 10,
  },
  {
    title: 'Getting Started',
    description: 'Complete your first lesson',
    icon: 'play',
    criteriaType: AchievementCriteria.LESSONS_COMPLETED,
    criteriaValue: 1,
  },
  {
    title: 'Fast Learner',
    description: 'Complete 10 lessons',
    icon: 'bolt',
    criteriaType: AchievementCriteria.LESSONS_COMPLETED,
    criteriaValue: 10,
  },
  {
    title: 'Centurion',
    description: 'Complete 100 lessons',
    icon: 'trophy',
    criteriaType: AchievementCriteria.LESSONS_COMPLETED,
    criteriaValue: 100,
  },
  {
    title: 'Flawless',
    description: 'Score 100% on a quiz',
    icon: 'target',
    criteriaType: AchievementCriteria.QUIZ_PERFECT_SCORE,
    criteriaValue: 1,
  },
  {
    title: 'Sharpshooter',
    description: 'Score 100% on 10 quizzes',
    icon: 'crosshair',
    criteriaType: AchievementCriteria.QUIZ_PERFECT_SCORE,
    criteriaValue: 10,
  },
  {
    title: 'Consistent',
    description: 'Maintain a 7-day learning streak',
    icon: 'flame',
    criteriaType: AchievementCriteria.STREAK_DAYS,
    criteriaValue: 7,
  },
  {
    title: 'Unstoppable',
    description: 'Maintain a 30-day learning streak',
    icon: 'zap',
    criteriaType: AchievementCriteria.STREAK_DAYS,
    criteriaValue: 30,
  },
];

/**
 * Resolve the admin credentials.
 *
 * These are read straight from `process.env` rather than through
 * `src/config/env.js`: they are not part of the TRD §10.2 matrix that env.js
 * validates, and a seed has no business demanding CLOUDINARY_URL be present.
 *
 * The development defaults exist so `npm run db:seed` works from a fresh
 * `cp .env.example .env` with no extra setup. They are refused under
 * NODE_ENV=production, because a published default password on an ADMIN account
 * is a backdoor, and seeding one silently is worse than failing.
 */
function resolveAdminCredentials() {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;

  if (process.env.NODE_ENV === 'production' && !(email && password)) {
    throw new Error(
      'Refusing to seed the admin account with development defaults while ' +
        'NODE_ENV=production. Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD ' +
        'explicitly, or do not run the seed in production.',
    );
  }

  return {
    email: email || 'admin@edusphere.local',
    password: password || 'ChangeMe!Admin1',
    fullName: process.env.SEED_ADMIN_NAME || 'EduSphere Admin',
    usingDefaults: !(email && password),
  };
}

async function seed() {
  const admin = resolveAdminCredentials();

  // Hashed OUTSIDE the transaction: bcrypt at cost 12 takes ~100ms of CPU and
  // has no reason to be holding a database transaction open while it runs.
  const passwordHash = await bcrypt.hash(admin.password, BCRYPT_ROUNDS);

  const writes = [
    ...SUBJECTS.map((subject) =>
      prisma.subject.upsert({
        where: { slug: subject.slug },
        create: subject,
        // `courseCount` is deliberately absent. It is a denormalized live
        // counter maintained by the courses module and reconciled by
        // `npm run db:reconcile`; writing it here would zero every subject's
        // count on a re-seed of a populated database.
        update: {
          name: subject.name,
          icon: subject.icon,
          color: subject.color,
        },
      }),
    ),

    ...ACHIEVEMENTS.map((achievement) =>
      prisma.achievement.upsert({
        where: { title: achievement.title },
        create: achievement,
        // The catalog is reference data this file owns, so edits here do
        // propagate on re-seed — unlike the two cases above and below.
        update: {
          description: achievement.description,
          icon: achievement.icon,
          criteriaType: achievement.criteriaType,
          criteriaValue: achievement.criteriaValue,
        },
      }),
    ),

    prisma.user.upsert({
      where: { email: admin.email },
      create: {
        fullName: admin.fullName,
        email: admin.email,
        passwordHash,
        role: UserRole.ADMIN,
        // Verified on creation: the admin has no verification email to click,
        // and an unverified admin is locked out of every guarded route.
        isEmailVerified: true,
      },
      // `passwordHash` and `fullName` are deliberately absent. A re-seed must
      // not silently reset a rotated admin password back to the seed value.
      // Only the two invariants that make the account usable are re-asserted.
      update: { role: UserRole.ADMIN, isEmailVerified: true },
    }),
  ];

  const results = await prisma.$transaction(writes);

  // Guards against a future edit that drops a write out of the array without
  // anyone noticing the seed got quieter.
  const expected = SUBJECTS.length + ACHIEVEMENTS.length + 1;
  if (results.length !== expected) {
    throw new Error(`Seed wrote ${results.length} rows, expected ${expected}.`);
  }

  const criteriaCovered = new Set(ACHIEVEMENTS.map((a) => a.criteriaType)).size;
  const criteriaTotal = Object.keys(AchievementCriteria).length;
  if (criteriaCovered !== criteriaTotal) {
    throw new Error(
      `Achievement catalog covers ${criteriaCovered} of ${criteriaTotal} ` +
        'AchievementCriteria members; a kind with no rows can never be awarded.',
    );
  }

  console.info(`[seed] subjects:     ${SUBJECTS.length}`);
  console.info(
    `[seed] achievements: ${ACHIEVEMENTS.length} (covering all ${criteriaTotal} criteria kinds)`,
  );
  console.info(`[seed] admin:        ${admin.email}`);
  if (admin.usingDefaults) {
    console.warn(
      '[seed] admin seeded with the DEVELOPMENT default password — set ' +
        'SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD for any shared environment.',
    );
  }
  console.info('[seed] done — re-running this script is safe.');
}

try {
  await seed();
} catch (error) {
  // Labels the failure and guarantees a non-zero exit. It must not swallow:
  // an exit code of 0 here makes `prisma db seed` and `migrate reset` both
  // report success over an unseeded database.
  //
  // The wording covers both failure shapes — the transaction rolled back, or it
  // never opened (a bad credential check throws before any query runs).
  console.error('[seed] FAILED — no changes were committed.');
  console.error(error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
