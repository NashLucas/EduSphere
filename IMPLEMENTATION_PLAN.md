# EduSphere Backend — Implementation Plan

| Field | Value |
| :--- | :--- |
| **Project** | EduSphere E-Learning & Assessment Platform Backend |
| **Timeline** | 16 Working Days (4 Phases × 4 Days) |
| **Team Model** | Solo / Small-Team Backend Development |
| **Source of Truth** | [EduTRD.md](./EduTRD.md), [ARCHITECTURE.md](./ARCHITECTURE.md), [apidoc.md](./docs/apidoc.md) |
| **Branch Strategy** | Feature branches (`feat/<name>`) off `dev`; PRs into `dev`; `main` is production ([CONTRIBUTING.md](./CONTRIBUTING.md)) |
| **Date** | August 2026 |

---

## Executive Overview

This document expands the four-phase implementation roadmap outlined in the Technical Requirements Document (Section 8) into a detailed, actionable engineering plan. Each phase is broken down into daily work units with explicit deliverables, dependency chains, verification checkpoints, and rollback strategies.

The plan follows a **bottom-up construction** approach: infrastructure and security primitives are established first (Phase 1), domain-critical business logic is layered on top (Phases 2–3), and administrative tooling, automated testing, and production hardening close the cycle (Phase 4).

> [!NOTE]
> **Guiding Principle:** Every phase ends with a functional, testable vertical slice. No phase leaves behind dead code, unconnected routes, or migrations that haven't been verified against seed data.

---

## Git Workflow

All development follows the branching strategy defined in [CONTRIBUTING.md](./CONTRIBUTING.md):

1. Each phase (or major feature day) produces a **feature branch** off `dev` (e.g., `feat/phase-1-foundation`, `feat/quiz-assessment-engine`).
2. Branch names follow the convention: `feat/<name>`, `fix/<name>`, or `chore/<name>`.
3. Commits use **Conventional Commits** format (e.g., `feat: implement atomic lesson completion`).
4. Each feature branch is submitted as a **Pull Request targeting `dev`**, reviewed, and merged after CI passes.
5. `main` is production-only — merged from `dev` via release PRs after phase completion.

> [!TIP]
> **Unit tests are written continuously** alongside service code in each module's `tests/` folder (e.g., `src/modules/quizzes/tests/`). Day 15 focuses on cross-module integration tests and the coverage sweep — not on writing unit tests retroactively.

---

## Phase 1: Foundation & Core Infrastructure (Days 1–4)

**Objective:** Stand up the project skeleton, database schema, authentication system, RBAC middleware pipeline, and the first public-facing CRUD modules (Subjects & Courses). By the end of Phase 1, the API should accept user registration, issue JWT tokens, enforce role-based access, and serve a browsable course catalog.

---

### Day 1 — Project Bootstrap & Database Schema

**Goal:** Initialize the project, configure the development environment, deploy the full Prisma schema, and seed reference data.

| # | Task | Details |
| :--- | :--- | :--- |
| 1.1 | **Project Initialization** | Scaffold `package.json` with ES Module support (`"type": "module"`). Install all production and dev dependencies (Express 5, Prisma 6, `ioredis`, `jsonwebtoken`, `bcryptjs`, `zod`, `helmet`, `cors`, `pino`, `pino-http`, `express-rate-limit`, `pdfkit`, `swagger-ui-express`, `axios`). |
| 1.2 | **Environment Configuration** | Create `src/config/env.js` with Zod schema validation for all environment variables. Invalid or missing values halt startup with descriptive error messages. Create `.env.example` as the reference template. |
| 1.3 | **Docker Compose Setup** | Author `docker-compose.yml` provisioning PostgreSQL 15 (port 5432) and Redis 7 (port 6379) containers with persistent volumes and health checks. |
| 1.4 | **Prisma Schema & Migration** | Write `src/database/schema.prisma` defining all 20 models, 6 enums, indexes, unique constraints, and cascade rules. Run `prisma migrate dev --name init` to generate the initial migration. |
| 1.5 | **Database Seed Script** | Implement `src/database/seed.js` populating: 10 subject categories (Technology, Business, Design, etc.) with icons and colors; 3–5 achievement badge definitions (Course Master, Quiz Ace, Streak Champion); 1 admin user account for immediate testing. |
| 1.6 | **Prisma Client Singleton** | Create `src/database/index.js` exporting a lazy-initialized Prisma Client with connection logging and graceful disconnect on `SIGTERM`. |
| 1.7 | **Redis Client Setup** | Implement `src/config/redis.js` with `ioredis` connection, automatic reconnection strategy, error logging, and helper methods (`setWithTTL`, `getJSON`, `deletePattern`). |

**Deliverables:**
- Running PostgreSQL with all 20 tables created via migration
- Running Redis instance with verified connectivity
- Seeded subjects and achievement definitions
- Zod-validated environment boot

**Verification:**
```bash
docker compose up -d
npm run db:migrate
npm run db:seed
# Confirm: prisma studio shows populated subjects table
```

---

### Day 2 — Express Application Shell & Middleware Pipeline

**Goal:** Build the Express 5 application skeleton with the complete security middleware stack, global error handler, health check endpoint, and structured logging.

| # | Task | Details |
| :--- | :--- | :--- |
| 2.1 | **Express App Factory** | Create `src/app.js` wiring middleware in order: `helmet()` → `cors({ origin, credentials })` → `express.json({ limit: '10mb' })` → `pino-http` logger → rate limiter → API router → 404 handler → global error handler. |
| 2.2 | **Constants & System Messages** | Populate `src/config/constants.js` (role enums, course levels, pagination defaults, rate limit tiers) and `src/config/system_messages.js` (user-facing error/success message strings). |
| 2.3 | **Utility Classes** | Implement `src/utils/app-error.js` (custom `AppError` class with `statusCode`, `isOperational` flag, and error code taxonomy) and `src/utils/api-response.js` (standardized `success()`, `created()`, `paginated()` response builders). |
| 2.4 | **Rate Limiting** | Configure `src/middlewares/rate-limit.middleware.js` with tiered rate limits: Global API (100 req / 15 min), Auth endpoints (5 req / 15 min), Admin destructive actions (10 req / 15 min). Health probe endpoint bypassed. |
| 2.5 | **Structured Logging** | Implement `src/middlewares/logging.middleware.js` using `pino-http` with request ID generation, response time tracking, and log-level filtering by `NODE_ENV`. |
| 2.6 | **Zod Validation Middleware** | Create `src/middlewares/validate.middleware.js` accepting a Zod schema object with optional `body`, `params`, and `query` keys. Returns HTTP 422 with field-level error details on validation failure. |
| 2.7 | **Health Check Endpoint** | Implement `GET /health` executing a live database ping (`SELECT 1` via Prisma `$queryRaw`) and Redis `PING`. Returns `200` with status payload or `503` on failure. |
| 2.8 | **Server Bootstrap** | Create `src/server.js` initializing database connection, Redis connection, and HTTP listener. Implements graceful shutdown on `SIGTERM`/`SIGINT` with a 10-second drain timeout. |

**Deliverables:**
- `GET /health` returning `{ status: "ok", database: "connected", redis: "connected" }`
- Structured JSON request logs in terminal
- Rate limiting active on all routes
- Global error handler catching and formatting `AppError` instances

**Verification:**
```bash
npm run dev
curl http://localhost:5000/health
# Confirm 200 OK with healthy status
```

---

### Day 3 — Authentication Module & RBAC Guards

**Goal:** Implement the complete authentication lifecycle (register, login, logout, token refresh, email verification, password reset) and RBAC middleware.

| # | Task | Details |
| :--- | :--- | :--- |
| 3.1 | **Auth Zod Schemas** | Define `src/modules/auth/auth.schema.js` with strict schemas: `registerSchema` (fullName 2–100 chars, email, password 8+ chars with complexity rules, optional role), `loginSchema`, `refreshSchema`, `verifyEmailSchema`, `forgotPasswordSchema`, `resetPasswordSchema`. |
| 3.2 | **Email Stub Service** | Create `src/integrations/email/index.js` as a lightweight stub that **logs email content to the console** via `pino` instead of making real API calls. Exports the same interface (`sendVerificationEmail`, `sendPasswordResetEmail`, etc.) that will be replaced with the real Brevo/SendGrid client on Day 11. This unblocks auth email flows without front-loading the full integration. |
| 3.3 | **Auth Service — Registration** | Implement `register()`: check email uniqueness → hash password (bcrypt, 12 rounds) → create user record → generate email verification token → store token in Redis with 24h TTL → dispatch verification email via stub → return sanitized user object (no `passwordHash`). |
| 3.4 | **Auth Service — Login** | Implement `login()`: find user by email → verify password hash → check `isBanned` flag → check `deletedAt` soft-delete → generate access token (15m) and refresh token (7d) → store refresh token hash in Redis (`session:<userId>:<tokenId>`) → return token pair. |
| 3.5 | **Auth Service — Token Refresh** | Implement `refresh()`: extract refresh token from `HttpOnly` cookie → verify JWT signature → validate session exists in Redis → rotate: delete old session key, issue new token pair, store new session → return fresh tokens. |
| 3.6 | **Auth Service — Logout** | Implement `logout()`: delete the specific `session:<userId>:<tokenId>` key from Redis → clear refresh cookie. |
| 3.7 | **Auth Service — Password Recovery** | Implement `forgotPassword()` (generate reset token, store in Redis with 15m TTL, send email via stub) and `resetPassword()` (validate token, hash new password, update user, delete token from Redis, purge all sessions). |
| 3.8 | **Auth Service — Email Verification** | Implement `verifyEmail()`: validate token against Redis → set `isEmailVerified = true` → delete verification token from Redis. |
| 3.9 | **Auth Controller & Routes** | Wire all 8 auth endpoints with appropriate Zod validation, rate limiting (5 req / 15 min on sensitive endpoints), and response formatting. |
| 3.10 | **requireAuth Middleware** | Create `src/middlewares/auth.middleware.js`: extract Bearer token → verify JWT → fetch user from DB → check `isBanned` → check `deletedAt` → attach `req.user` with `{ id, email, role }`. Also implement `optionalAuth` variant for public routes that benefit from user context. |
| 3.11 | **requireRole Middleware** | Create `src/middlewares/rbac.middleware.js`: accepts array of allowed roles → compares against `req.user.role` → returns HTTP 403 if unauthorized. |

**Deliverables:**
- Full auth flow: register → verify email → login → access protected route → refresh token → logout
- `requireAuth` blocks unauthenticated requests with 401
- `requireRole` blocks unauthorized roles with 403
- Refresh token rotation invalidates previous tokens
- Banned users receive 403 even with valid JWT

**Verification:**
- Register a user via `POST /api/v1/auth/register`
- Login and receive JWT pair
- Access `GET /api/v1/auth/me` with Bearer token
- Refresh token and confirm old token is invalidated
- Test role guard rejection for unauthorized role access

---

### Day 4 — Subjects, Course Catalog & Notification Foundation

**Goal:** Build the first public-facing content modules (Subjects and Courses) and lay the groundwork for the notification system.

| # | Task | Details |
| :--- | :--- | :--- |
| 4.1 | **Subjects Module** | Implement full CRUD: `GET /subjects` (public, cached in Redis), `GET /subjects/:slug/courses` (paginated course listing filtered by subject), `POST /subjects` (Admin only). Include Redis cache with 1-hour TTL on subject listings. |
| 4.2 | **Courses Module — Read Operations** | Implement `GET /courses` with multi-parameter filtering (`?category=&level=&price=&search=&sort=&page=&limit=`), `GET /courses/featured` (cached), `GET /courses/:slug` (full course detail with instructor info, curriculum outline, review summary). |
| 4.3 | **Courses Module — Write Operations** | Implement `POST /courses` (Instructor creates draft), `PUT /courses/:id` (update metadata, publishing), `DELETE /courses/:id` (soft-delete with `deletedAt`). Enforce ownership verification: `course.instructorId === req.user.instructorProfile.id`. |
| 4.4 | **Course Publishing Validation** | On `PUT /courses/:id { isPublished: true }`: validate course has ≥ 1 module with ≥ 1 lesson. Atomically update `isPublished` and increment `subject.courseCount` within a `prisma.$transaction`. Invalidate Redis catalog cache keys. |
| 4.5 | **Swagger/OpenAPI Configuration** | Set up `src/config/swagger.js` and mount Swagger UI at `/api-docs`. Document all implemented endpoints with request/response schemas. |
| 4.6 | **Notification Model & Service** | Implement `src/modules/notifications/notifications.service.js` with `createNotification(userId, type, title, message)` as a reusable internal utility. This will be consumed by other modules (enrollments, achievements, admin) in later phases. |
| 4.7 | **Instructor Profile Auto-Creation** | When a user registers with `role: INSTRUCTOR` or is elevated to Instructor by an admin, automatically create the associated `Instructor` profile record in a transaction. |

**Deliverables:**
- Public course catalog with search, filtering, and pagination
- Subject-based course browsing
- Instructor course authoring (create draft, update, soft-delete)
- Course publishing with atomic validation
- Swagger UI accessible at `/api-docs`
- Notification creation utility ready for cross-module consumption

**Verification:**
- Browse `GET /courses?search=javascript&level=BEGINNER&page=1&limit=10`
- Create a course draft as Instructor, confirm it does not appear in public catalog
- Attempt to publish a course with no modules → expect HTTP 422
- Confirm subject course count increments on successful publish

---

### Phase 1 Exit Criteria

| Criteria | Status |
| :--- | :--- |
| Health check returns 200 with DB and Redis connected | ☐ |
| User registration, login, token refresh, and logout work end-to-end | ☐ |
| Role-based access control blocks unauthorized operations | ☐ |
| Banned users are rejected on all authenticated routes | ☐ |
| Public course catalog supports search, filter, and pagination | ☐ |
| Course publishing validates minimum curriculum requirements | ☐ |
| Swagger UI renders all Phase 1 endpoints | ☐ |

---

## Phase 2: Curriculum Engine & Assessment System (Days 5–8)

**Objective:** Build the hierarchical curriculum authoring system (Modules → Lessons), the enrollment and atomic progress tracking engine, the secure server-side quiz assessment system, and the cloud media upload integration. By the end of Phase 2, a student should be able to enroll in a course, consume lessons, take quizzes, and have their progress tracked atomically.

---

### Day 5 — Curriculum Hierarchy (Modules & Lessons)

**Goal:** Implement the Module and Lesson CRUD endpoints that form the backbone of course content structure.

| # | Task | Details |
| :--- | :--- | :--- |
| 5.1 | **Modules Module** | Implement `POST /courses/:id/modules` (create module with `orderIndex`), `PUT /modules/:id` (rename, reorder), `DELETE /modules/:id` (cascade deletes all child lessons). Enforce instructor ownership on all mutations. |
| 5.2 | **Lessons Module** | Implement `POST /modules/:id/lessons` (create lesson with type: VIDEO/TEXT/CODE/QUIZ, content, videoUrl, codeSnippet, `orderIndex`), `GET /lessons/:id` (full content — restricted to enrolled students, course owner, or admin), `PUT /lessons/:id`, `DELETE /lessons/:id`. |
| 5.3 | **Ownership Verification Helper** | Extract a shared `verifyCourseOwnership(courseId, userId)` utility used across courses, modules, and lessons to DRY up authorization checks. Admin role bypasses ownership checks. |
| 5.4 | **Nested Curriculum Response** | Enhance `GET /courses/:slug` to return the full nested curriculum: `course.modules[].lessons[]` with lesson metadata (title, type, duration) but without full content for non-enrolled visitors. |

**Deliverables:**
- Instructors can build a full curriculum: Course → Modules → Lessons
- Module and lesson ordering via `orderIndex`
- Course detail endpoint returns nested curriculum outline
- Lesson content gated behind enrollment verification

---

### Day 6 — Enrollment & Atomic Progress Engine

**Goal:** Implement the enrollment lifecycle and the atomic progress calculation engine that tracks lesson completions.

| # | Task | Details |
| :--- | :--- | :--- |
| 6.1 | **Enrollments Module — Enroll** | Implement `POST /enrollments { courseId }`: verify course exists and `isPublished`, check for existing enrollment (handle re-enrollment of `DROPPED` status by reactivating), create enrollment record, atomically increment `course.studentCount` and `instructor.studentCount` in a `prisma.$transaction`, create notification. |
| 6.2 | **Enrollments Module — My Enrollments** | Implement `GET /enrollments/me`: list all enrolled courses with `progressPercent`, `status`, course title, thumbnail, and instructor name. Support `?status=ACTIVE&page=1&limit=10` filtering. |
| 6.3 | **Enrollments Module — Progress Detail** | Implement `GET /enrollments/:courseId/progress`: return granular lesson-by-lesson completion checklist with `isCompleted` and `completedAt` per lesson, organized by module. |
| 6.4 | **Lesson Completion Endpoint** | Implement `POST /lessons/:id/complete`: verify active enrollment → upsert `LessonProgress` (idempotent) → count completed vs total lessons with division-by-zero guard → update `enrollment.progressPercent` → update user streak → check for 100% completion. All within `prisma.$transaction`. |
| 6.5 | **User Streak Engine** | On lesson completion, update `UserStreak`: if `lastActiveDate` is yesterday → increment `currentStreak` (and update `longestStreak` if new record); if `lastActiveDate` is today → no-op; otherwise → reset `currentStreak` to 1. |
| 6.6 | **Drop Enrollment** | Implement `PATCH /enrollments/:courseId/drop`: set `status = DROPPED`, preserve all `LessonProgress` records for potential re-enrollment. Do NOT decrement student counts (lifetime metric). |

**Deliverables:**
- Students can enroll in published courses
- Lesson completion atomically recalculates progress percentage
- Division-by-zero guard prevents crashes on empty courses
- Re-enrollment reactivates dropped enrollments without data loss
- User learning streaks update daily

**Unit Tests (written same day in `src/modules/enrollments/tests/`):**
- Progress percentage formula correctness (e.g., 3/10 lessons = 30.0%)
- Division-by-zero guard returns 0.0% for courses with 0 lessons
- Streak increment logic (yesterday → +1, today → no-op, gap → reset to 1)
- Re-enrollment status transition from `DROPPED` → `ACTIVE`

---

### Day 7 — Server-Side Quiz Assessment Engine

**Goal:** Build the complete quiz system: authoring, question management, secure answer isolation, server-side grading, and automatic lesson completion linkage.

| # | Task | Details |
| :--- | :--- | :--- |
| 7.1 | **Quiz CRUD** | Implement `POST /quizzes` (create quiz linked to course and optionally a lesson), `PUT /quizzes/:id` (update title, `passingScore` — blocked if attempts exist), `DELETE /quizzes/:id` (cascade delete questions and attempts). |
| 7.2 | **Question Management** | Implement `POST /quizzes/:id/questions` (batch create questions with `questionText`, `type`, `options[]`, `correctAnswerIndex`, `orderIndex`), `PUT /quizzes/:id/questions/:questionId`, `DELETE /quizzes/:id/questions/:questionId`. |
| 7.3 | **Quiz Retrieval (Answer Isolation)** | Implement `GET /quizzes/:id`: return quiz metadata and questions with options, but **strip `correctAnswerIndex`** from the response for student-facing requests. Instructor/Admin requests include answer keys. |
| 7.4 | **Quiz Submission & Grading** | Implement `POST /quizzes/:id/submit { answers: [0, 2, 1, ...] }`: validate enrolled student → fetch questions with answer keys → compare submitted answers → calculate score percentage → determine pass/fail against `passingScore` → store `QuizAttempt` record → if passed and quiz is linked to a lesson, trigger the lesson completion flow from Day 6. |
| 7.5 | **Attempt History** | Implement `GET /quizzes/:id/attempts`: return user's historical attempts with scores, timestamps, and pass/fail status. |

**Deliverables:**
- Instructors can create quizzes with multiple-choice and true/false questions
- Answer keys never exposed to students via any API endpoint
- Server evaluates submissions and records attempt history
- Passing a quiz automatically completes the linked lesson
- Full attempt history available per user per quiz

**Unit Tests (written same day in `src/modules/quizzes/tests/`):**
- Score calculation correctness (e.g., 7/10 correct = 70.0%)
- Pass/fail determination against `passingScore` threshold
- `correctAnswerIndex` stripped from student-facing response serialization
- Edge case: submitting fewer or more answers than questions

---

### Day 8 — Cloud Storage Integration & Resource Management

**Goal:** Integrate AWS S3 / Cloudinary for media uploads and implement the resource management module.

| # | Task | Details |
| :--- | :--- | :--- |
| 8.1 | **Storage Integration** | Implement `src/integrations/storage/index.js`: pre-signed URL generation for S3 PUT uploads (15m TTL, enforced `Content-Type`), file deletion, and public URL construction. Support Cloudinary as an alternative provider via environment flag. |
| 8.2 | **Upload URL Endpoint** | Implement `POST /resources/upload-url { fileName, fileType, fileSize, courseId }`: RBAC guard (Instructor + ownership) → validate file type (whitelist: `video/*`, `application/pdf`, `image/*`, `application/zip`) and size (max 500MB for video, 10MB for documents) → generate and return pre-signed URL with file key. |
| 8.3 | **Upload Confirmation** | Implement `POST /resources/confirm { fileKey, title, description, category, courseId }`: verify the file exists in storage → create `Resource` metadata record in PostgreSQL → return resource details. |
| 8.4 | **Resource Listing, Direct Upload & Deletion** | Implement `GET /resources?category=&courseId=&page=&limit=` (public browsing), `POST /resources` (Instructor/Admin — direct resource metadata upload without pre-signed URL flow), `DELETE /resources/:id` (Instructor owner or Admin — deletes metadata record and triggers S3/Cloudinary file removal). |
| 8.5 | **Avatar Upload** | Implement `POST /users/me/avatar` using `multer` for direct multipart upload (max 2MB, `image/*` only) → upload to S3/Cloudinary → update `user.avatarUrl` in database. |

**Deliverables:**
- Pre-signed upload workflow functional for videos and documents
- Resource metadata persisted with file URLs
- Avatar upload working with size and type validation
- File deletion cleans up both database records and cloud storage

---

### Phase 2 Exit Criteria

| Criteria | Status |
| :--- | :--- |
| Full curriculum hierarchy: Course → Module → Lesson CRUD | ☐ |
| Student enrollment with atomic progress tracking | ☐ |
| Lesson completion recalculates progress with zero-division guard | ☐ |
| Quiz submission evaluates server-side with no answer leakage | ☐ |
| Passing a quiz triggers linked lesson completion | ☐ |
| Pre-signed upload URL workflow is functional | ☐ |
| User avatar upload works end-to-end | ☐ |
| Re-enrollment reactivates dropped enrollments | ☐ |

---

## Phase 3: Gamification, Dashboards & Communication (Days 9–12)

**Objective:** Build the gamification engine (achievements, badges, streaks), PDF certificate generation pipeline, aggregated dashboard analytics for students and instructors, transactional email integration, and the remaining engagement modules (bookmarks, reviews, notifications). By the end of Phase 3, the platform feels complete from a user-experience perspective.

---

### Day 9 — Achievement Engine & Certificate Generation

**Goal:** Implement the gamification rules engine and the automated PDF certificate issuance pipeline.

| # | Task | Details |
| :--- | :--- | :--- |
| 9.1 | **Achievement Evaluation Engine** | Implement `src/modules/achievements/achievements.service.js` with `evaluateAchievements(userId)`: query user metrics (courses completed, quizzes with perfect scores, current streak days) → compare against all `Achievement` criteria definitions → award any newly unlocked badges via `UserAchievement` insert → create notification for each new badge. |
| 9.2 | **Achievement Trigger Points** | Hook `evaluateAchievements()` into lesson completion (100% progress) and quiz submission (perfect score check). Run asynchronously after the primary transaction completes to avoid blocking the response. |
| 9.3 | **Achievement Endpoints** | Implement `GET /users/me/achievements` (list earned and available badges with progress indicators) and add achievement data to the student dashboard response. |
| 9.4 | **PDF Certificate Generator** | Implement `src/utils/certificate-generator.js` using `pdfkit`: generate a professional certificate PDF with student name, course title, completion date, unique certificate number (`EDU-YYYY-XXXXX`), and a QR code or verification URL. Stream to S3 and store `certificateUrl` in database. |
| 9.5 | **Certificate Issuance Flow** | On 100% course completion: generate unique certificate number → render PDF → upload to S3 → create `Certificate` record → create notification → dispatch congratulatory email with PDF attachment. |
| 9.6 | **Certificate Endpoints** | Implement `GET /certificates/:certificateNo` (public verification — returns certificate details without requiring auth), `GET /certificates/:id/download` (authenticated owner — streams PDF), `GET /users/me/certificates` (list all earned certificates). |

**Deliverables:**
- Achievements automatically unlock on milestone events
- PDF certificates generated with unique verifiable numbers
- Public certificate verification endpoint
- Certificate download streams PDF directly

**Unit Tests (written same day in `src/modules/achievements/tests/` and `src/modules/certificates/tests/`):**
- Achievement criteria matching logic (e.g., 5 courses completed → unlocks "Course Master")
- Certificate number format validation (`EDU-YYYY-XXXXX`)
- Idempotency: re-completing a course does not re-issue a certificate

---

### Day 10 — Student & Instructor Dashboards

**Goal:** Build the aggregated analytics dashboard endpoints that power the frontend dashboard views for both students and instructors.

| # | Task | Details |
| :--- | :--- | :--- |
| 10.1 | **Student Dashboard** | Implement `GET /users/me/dashboard` aggregating: total enrolled courses, active courses, completed courses, overall completion rate, current learning streak, longest streak, total learning hours (estimated from lesson durations), recent activity (last 5 lesson completions), and upcoming lessons. |
| 10.2 | **Instructor Dashboard** | Implement `GET /instructors/me/dashboard` aggregating: total published courses, total students across all courses, average course rating, total reviews received, enrollment trends (last 30 days grouped by date), top-performing course (by enrollment count), and recent enrollments. |
| 10.3 | **Instructor Course Management** | Implement `GET /instructors/me/courses`: list all courses owned by the instructor with draft/published status, enrollment count, average rating, and revenue metrics. Support sorting by `createdAt`, `studentCount`, `rating`. |
| 10.4 | **Public Instructor Profile** | Implement `GET /instructors/:id`: return public instructor profile including bio, avatar, rating, student count, course count, and list of published courses. |
| 10.5 | **User Profile Module** | Implement `GET /users/:id` (public profile), `PUT /users/me` (update fullName, bio, social links). Ensure `passwordHash` is never included in any user-facing response. |

**Deliverables:**
- Student dashboard with comprehensive learning metrics
- Instructor dashboard with teaching analytics and trends
- Public instructor profiles with portfolio
- User profile update functionality

---

### Day 11 — Bookmarks, Reviews & Email Integration

**Goal:** Implement the remaining engagement modules and integrate the transactional email service.

| # | Task | Details |
| :--- | :--- | :--- |
| 11.1 | **Bookmarks Module** | Implement `POST /bookmarks/toggle { courseId?, lessonId? }` (idempotent toggle — creates if not exists, deletes if exists), `GET /bookmarks` (list all user bookmarks with course/lesson details, paginated). |
| 11.2 | **Reviews Module** | Implement `POST /courses/:id/reviews { rating, comment }` (enrolled students only, one review per student per course), `GET /courses/:id/reviews` (paginated reviews with user names and avatars), `PUT /courses/:courseId/reviews` (update own review), `DELETE /courses/:courseId/reviews` (delete own or admin moderation). |
| 11.3 | **Review Aggregation** | On review create/update/delete: recalculate and update `course.rating` as the average of all review ratings for that course. Use `prisma.$transaction` to ensure consistency. |
| 11.4 | **Email Integration (Replace Stub)** | Replace the console-logging email stub (created on Day 3) in `src/integrations/email/index.js` with the real SendGrid / Brevo REST API client (`axios`). The exported interface (`sendVerificationEmail`, `sendPasswordResetEmail`, `sendEnrollmentConfirmation`, `sendCourseCompletionEmail`, `sendTakedownNotice`) remains identical — only the internal implementation changes from `logger.info()` to `axios.post()`. Add HTML email template functions for all 6 email types. |
| 11.5 | **Email Dispatch Verification** | Verify that all existing email dispatch points (auth registration, forgot password, enrollment creation, course completion, admin course unpublish, admin user ban) now fire real emails via the new client. No call sites need to change since the stub interface was designed to match. |
| 11.6 | **Email Resilience** | Emails dispatch asynchronously after database transactions commit. Failures are logged via `pino` but never roll back user-facing operations. Implement retry logic (max 3 attempts with exponential backoff). |

**Deliverables:**
- Bookmark toggle working for courses and lessons
- Course reviews with 1–5 star ratings
- Course average rating auto-recalculated on review changes
- Transactional emails dispatched for all key user events
- Email failures are non-blocking and logged

---

### Day 12 — Notification Endpoints & Polish

**Goal:** Complete the notification system with user-facing endpoints and polish all Phase 3 deliverables.

| # | Task | Details |
| :--- | :--- | :--- |
| 12.1 | **Notification Endpoints** | Implement `GET /notifications?page=&limit=` (paginated list with unread count in response metadata), `PATCH /notifications/:id/read` (mark single notification as read), `PATCH /notifications/read-all` (mark all unread as read for the current user). |
| 12.2 | **Notification Triggers Audit** | Verify that notifications are correctly created for: new enrollment, course completion, certificate issued, achievement unlocked, admin role change, admin account ban, and course takedown. |
| 12.3 | **Redis Caching Review** | Review and optimize caching strategy: ensure catalog queries (`GET /courses`, `GET /courses/featured`, `GET /subjects`) are cached with appropriate TTLs. Verify cache invalidation fires correctly on course publish/unpublish, review changes, and enrollment counts. |
| 12.4 | **Response Sanitization Audit** | Sweep all endpoints to confirm: `passwordHash` never appears in responses, `correctAnswerIndex` is stripped for students, `deletedAt` records are excluded from public queries, banned user profiles are handled gracefully. |
| 12.5 | **Swagger Documentation Update** | Update OpenAPI specs for all Phase 2 and Phase 3 endpoints. Ensure request/response schemas are accurate and examples are provided. |

**Deliverables:**
- Complete notification system with unread counts
- All notification trigger points verified
- Redis caching optimized and invalidation verified
- No sensitive data leakage in any API response
- Swagger documentation current for all endpoints

---

### Phase 3 Exit Criteria

| Criteria | Status |
| :--- | :--- |
| Achievements auto-unlock on course completion and quiz milestones | ☐ |
| PDF certificates generated and downloadable | ☐ |
| Public certificate verification works without authentication | ☐ |
| Student and instructor dashboards return correct aggregated metrics | ☐ |
| Bookmarks toggle and listing work correctly | ☐ |
| Course reviews with auto-calculated average ratings | ☐ |
| Transactional emails dispatched for all key events | ☐ |
| Notification list, mark-read, and mark-all-read functional | ☐ |

---

## Phase 4: Administration, Testing & Production Deployment (Days 13–16)

**Objective:** Build the administrative governance suite (content moderation, user management, analytics, audit logs), write comprehensive integration and end-to-end tests, and prepare the application for production deployment with Docker and CI/CD pipelines.

---

### Day 13 — Admin Module: Course Moderation & User Governance

**Goal:** Implement the full admin moderation toolkit for content oversight and user account management.

| # | Task | Details |
| :--- | :--- | :--- |
| 13.1 | **Admin Course Listing** | Implement `GET /admin/courses?isPublished=&search=&sort=&page=&limit=`: paginated list of all courses (including unpublished and soft-deleted) with instructor details and enrollment counts. |
| 13.2 | **Course Unpublish (Takedown)** | Implement `PATCH /admin/courses/:id/unpublish { reason }`: set `isPublished = false` → decrement `subject.courseCount` → record `AuditLog` (COURSE_REJECTED) → invalidate Redis catalog cache → send takedown notification email to instructor with reason. All within `prisma.$transaction`. |
| 13.3 | **Course Soft-Delete** | Implement `DELETE /admin/courses/:id { reason }`: set `course.deletedAt = now()` → record `AuditLog` (COURSE_DELETED) → invalidate cache → send removal notice to instructor. Preserves enrollment and certificate records via soft-delete. |
| 13.4 | **Admin User Listing** | Implement `GET /admin/users?role=&isBanned=&search=&sort=&page=&limit=`: paginated user list with role, banned status, email verification status, and account creation date. |
| 13.5 | **Role Management** | Implement `PATCH /admin/users/:id/role { role }`: update user role → if elevating to `INSTRUCTOR`, create `Instructor` profile record → record `AuditLog` (ROLE_CHANGED) → invalidate Redis user profile cache → create notification for user. |
| 13.6 | **User Ban** | Implement `POST /admin/users/:id/ban { reason }`: set `isBanned = true` → record `AuditLog` (USER_BANNED) → purge all Redis session keys (`DEL session:<userId>:*`) → return count of revoked sessions. |
| 13.7 | **User Unban** | Implement `POST /admin/users/:id/unban { reason }`: set `isBanned = false` → record `AuditLog` (USER_UNBANNED) → create notification informing user their account is restored. |

**Deliverables:**
- Admin can browse, unpublish, and soft-delete courses with auditable reasons
- Admin can view, filter, and manage all user accounts
- Role elevation automatically creates instructor profiles
- Account bans instantly revoke all active sessions
- Every admin action recorded in immutable audit log

---

### Day 14 — Admin Analytics, Audit Logs & Edge Cases

**Goal:** Build platform-wide analytics, the audit log query system, and handle remaining edge cases across all modules.

| # | Task | Details |
| :--- | :--- | :--- |
| 14.1 | **Platform Analytics** | Implement `GET /admin/analytics`: total users (by role breakdown), total courses (published/draft/deleted), total enrollments (active/completed/dropped), total quiz attempts, completion rate, average course rating, new users this month, and enrollment growth trend (last 30 days). |
| 14.2 | **Audit Log Query** | Implement `GET /admin/audit-logs?actionType=&targetType=&adminId=&startDate=&endDate=&page=&limit=`: paginated, filterable audit trail with admin user details, target details, timestamps, and reasons. |
| 14.3 | **Edge Case Hardening** | Address cross-cutting edge cases: attempting to delete a subject with existing courses → return 409 Conflict; attempting to enroll in own course (instructor) → return 400; attempting to review a course without completing any lessons → allow (students may want to review early); duplicate quiz submissions within rapid succession → idempotent handling; concurrent enrollment requests → database unique constraint catches duplicates gracefully. |
| 14.4 | **Soft-Delete Query Guards** | Audit all queries across every module to ensure `deletedAt IS NULL` filters are applied consistently for User and Course models. Soft-deleted records should never appear in public-facing queries but should be visible in admin views. |
| 14.5 | **Error Response Standardization** | Final sweep of all error responses to ensure consistent format: `{ status: "error", message: "...", errors?: [...] }`. Production mode masks stack traces and internal error details. |

**Deliverables:**
- Platform-wide analytics dashboard for admins
- Filterable audit log with full governance trail
- All edge cases handled with appropriate HTTP status codes
- Soft-delete filters consistently applied
- Error responses standardized across all endpoints

---

### Day 15 — Integration & End-to-End Testing

**Goal:** Write comprehensive test suites covering critical paths, security boundaries, and business logic.

| # | Task | Details |
| :--- | :--- | :--- |
| 15.1 | **Test Infrastructure** | Configure `vitest.config.js` with test database connection, setup/teardown scripts that migrate and seed a test database, and global test utilities (auth helper to generate test tokens, factory functions for creating test users/courses/enrollments). |
| 15.2 | **Auth Flow Tests** | Test complete auth lifecycle: registration → email verification → login → protected route access → token refresh → logout. Verify invalid credentials return 401, banned users return 403, and expired tokens return 401. |
| 15.3 | **RBAC Boundary Tests** | Verify: students cannot create courses (403), instructors cannot modify other instructors' courses (403), non-enrolled students cannot access lesson content (403), admin can perform all operations. |
| 15.4 | **Progress Engine Tests** | Test: lesson completion recalculates percentage correctly, 100% completion triggers certificate and achievement, re-completing a lesson is idempotent, division-by-zero guard works for empty courses. |
| 15.5 | **Quiz Assessment Tests** | Test: quiz retrieval strips answer keys for students, submission calculates correct score, passing triggers lesson completion, attempt history records correctly. |
| 15.6 | **Admin Governance Tests** | Test: course unpublish decrements subject count and invalidates cache, user ban revokes Redis sessions, audit logs are created for all governance actions, unbanned users can log in again. |
| 15.7 | **Enrollment Edge Case Tests** | Test: re-enrollment reactivates dropped enrollment, duplicate enrollment returns 409, enrollment in unpublished course returns 404, dropping preserves progress. |
| 15.8 | **Code Coverage Report** | Generate coverage report and verify >85% coverage across all service files. Identify and document any intentional coverage gaps (e.g., email dispatch in test environment). |

**Deliverables:**
- Comprehensive test suite: 60+ integration tests covering all critical paths
- RBAC boundary tests confirming security enforcement
- Progress engine and quiz grading mathematical correctness verified
- Code coverage report generated with >85% target met
- All tests pass in CI environment

---

### Day 16 — Production Hardening & Deployment

**Goal:** Finalize Docker configuration, CI/CD pipelines, production environment hardening, and deployment.

| # | Task | Details |
| :--- | :--- | :--- |
| 16.1 | **Multi-Stage Dockerfile** | Finalize production `Dockerfile` with: Node.js 22 Alpine base, non-root user (`nodeapp`), `npm ci --omit=dev` for minimal production dependencies, Prisma client generation, health check directive. |
| 16.2 | **Docker Compose Production** | Create `docker-compose.prod.yml` with production-grade PostgreSQL and Redis configurations, restart policies, resource limits, and network isolation. |
| 16.3 | **CI Pipeline (GitHub Actions)** | Finalize `.github/workflows/ci.yml`: checkout → install → lint → type-check → run tests with PostgreSQL and Redis service containers → generate coverage report → fail on coverage below 85%. |
| 16.4 | **CD Pipeline (GitHub Actions)** | Finalize `.github/workflows/cd.yaml`: trigger on `main` branch push → build Docker image → push to container registry → deploy to Railway / cloud provider → run smoke tests against deployed health endpoint. |
| 16.5 | **PR Validation Workflow** | Finalize `.github/workflows/pr-validation.yml`: lint, test, and coverage checks run on every pull request. Block merge if any check fails. |
| 16.6 | **Production Logging** | Verify `pino` log output is JSON-formatted in production mode, stack traces are suppressed in error responses, and sensitive fields (`passwordHash`, `JWT_SECRET`) are never logged. |
| 16.7 | **Security Hardening Checklist** | Final audit: CORS origin whitelist locked to production domain, rate limits active, `helmet` headers set correctly, `HttpOnly`/`Secure`/`SameSite=Strict` cookie flags on refresh tokens, all environment variables required in production mode. |
| 16.8 | **Final Swagger & README Update** | Update `swagger.json` with all 52+ endpoints. Update `README.md` with accurate clone URL, setup instructions, and current feature list. |
| 16.9 | **Deployment Verification** | Deploy to staging environment → run full smoke test suite against live endpoints → verify health check, auth flow, course catalog, and enrollment lifecycle. |

**Deliverables:**
- Production-ready Docker image with non-root user
- CI/CD pipelines running and green
- All security hardening measures verified
- Swagger documentation complete for all endpoints
- Staging deployment verified with smoke tests

---

### Phase 4 Exit Criteria

| Criteria | Status |
| :--- | :--- |
| Admin can moderate courses (unpublish, soft-delete) with audit trail | ☐ |
| Admin can manage users (role change, ban/unban) with session revocation | ☐ |
| Platform analytics endpoint returns accurate aggregated metrics | ☐ |
| Audit log query supports filtering by action type, date range, and admin | ☐ |
| Integration test suite passes with >85% code coverage | ☐ |
| CI pipeline runs lint, tests, and coverage on every push | ☐ |
| Docker image builds and runs in production mode | ☐ |
| Staging deployment passes health check and smoke tests | ☐ |

---

## Cross-Cutting Concerns (Applied Across All Phases)

These concerns are not isolated to a single phase but must be maintained continuously throughout development.

| Concern | Implementation |
| :--- | :--- |
| **Consistent Error Handling** | All services throw `AppError` subclasses. The global error handler in `app.js` catches and formats them. Unhandled rejections and uncaught exceptions trigger graceful shutdown. |
| **Input Validation** | Every route has a corresponding Zod schema. The `validate()` middleware runs before any controller logic. No raw `req.body` access without prior validation. |
| **Pagination** | All list endpoints support `?page=&limit=` with defaults (`page=1`, `limit=20`, max `limit=100`). Responses include `pagination` metadata with `hasNextPage` and `hasPrevPage` flags ([apidoc.md §6](./docs/apidoc.md)). |
| **Soft Deletes** | `User` and `Course` models use `deletedAt` timestamps. All public queries filter `WHERE deletedAt IS NULL`. Admin queries can include deleted records. |
| **Audit Trail** | Every admin governance action creates an `AuditLog` entry within the same database transaction as the action itself. |
| **Cache Invalidation** | Redis cache keys follow the pattern `catalog:<resource>:<params>`. Invalidation uses `DEL` with pattern matching on write operations that affect cached data. |
| **Idempotency** | Lesson completion and bookmark toggle are idempotent. Re-completing a lesson does not re-trigger certificate generation or achievement evaluation if already earned. |
| **Continuous Unit Testing** | Unit tests for service-layer business logic (scoring math, progress formulas, streak logic, criteria matching) are written in the module's `tests/` folder on the same day the service is implemented. Day 15 focuses on cross-module integration/E2E tests and the coverage sweep. |
| **Swagger Documentation** | Every endpoint is documented as it is built, not retroactively. Request/response schemas, auth requirements, and example payloads are included. |

---

## Risk Register & Mitigation Strategies

| Risk | Likelihood | Impact | Mitigation |
| :--- | :--- | :--- | :--- |
| **Schema migration conflicts during parallel development** | Medium | High | Single developer owns migration files. Never manually edit generated migrations. Use `prisma migrate reset` on conflicts. |
| **Quiz answer leakage via response serialization bug** | Low | Critical | Dedicated Prisma `select` statements on quiz endpoints that explicitly exclude `correctAnswerIndex`. Integration tests assert absence of answer keys in student responses. |
| **Progress race condition on rapid lesson completions** | Medium | Medium | `prisma.$transaction` with serializable isolation on progress updates. Unique constraint on `[enrollmentId, lessonId]` prevents duplicate progress records. |
| **Email service outage blocking user operations** | Medium | Medium | Email dispatch is fire-and-forget after DB commit. Service returns success to user regardless of email delivery. Failures logged with structured error context. |
| **Redis connection loss during auth flow** | Low | High | `ioredis` auto-reconnection with exponential backoff. Auth middleware falls back to DB-only verification if Redis is temporarily unavailable. Health check reports Redis status. |
| **Large file upload timeout** | Low | Medium | Pre-signed URL approach means uploads go directly to S3, never touching the API server. 15-minute TTL on pre-signed URLs provides ample upload time. |

---

## Appendix: Endpoint Delivery Schedule

| Phase | Endpoints Delivered | Running Total |
| :--- | :--- | :--- |
| **Phase 1** (Days 1–4) | Health, Auth (8), Subjects (3), Courses (6) | ~18 endpoints |
| **Phase 2** (Days 5–8) | Modules (3), Lessons (4), Enrollments (5), Quizzes (8), Resources (4), Avatar (1) | ~43 endpoints |
| **Phase 3** (Days 9–12) | Achievements (1), Certificates (3), Dashboards (5), Bookmarks (2), Reviews (4), Notifications (3), Email triggers | ~61 endpoints |
| **Phase 4** (Days 13–16) | Admin Courses (3), Admin Users (4), Admin Analytics (1), Admin Audit Logs (1), Testing & CI/CD | ~70 endpoints |
