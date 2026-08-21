
# EduSphere Backend Technical Requirements Document (TRD)

| Field | Value |
| :--- | :--- |
| **Product** | EduSphere E-Learning & Assessment Platform |
| **Stack** | Node.js 22, Express 5, Prisma ORM, PostgreSQL 15, Redis 7, Zod 3, Vitest 4, AWS S3 / Cloudinary, SendGrid / Brevo REST API |
| **Architecture** | Modular Layered Architecture with RESTful APIs, JWT Authentication, and Distributed Caching |
| **Date** | August 2026 |
| **Target Release** | Version 1.0 Production Backend |

---

## Table of Contents

- [1. Executive Summary](#1-executive-summary)
  - [1.1 Overview](#11-overview)
  - [1.2 Core Workflow](#12-core-workflow)
  - [1.3 Scope & Feature Matrix](#13-scope--feature-matrix)
- [2. Project Overview](#2-project-overview)
  - [2.1 Problem Statement](#21-problem-statement)
  - [2.2 Product Vision](#22-product-vision)
  - [2.3 Target Users & Roles](#23-target-users--roles)
  - [2.4 Success Metrics](#24-success-metrics)
- [3. System Architecture](#3-system-architecture)
  - [3.1 High-Level Architecture Diagram](#31-high-level-architecture-diagram)
  - [3.2 Module Directory Convention](#32-module-directory-convention)
  - [3.3 Tech Stack & Tooling](#33-tech-stack--tooling)
  - [3.4 Project File Structure](#34-project-file-structure)
- [4. Database Schema & Data Model](#4-database-schema--data-model)
  - [4.1 Entity-Relationship (ER) Diagram](#41-entity-relationship-er-diagram)
  - [4.2 Prisma Data Model (PostgreSQL)](#42-prisma-data-model-postgresql)
- [5. Core Operational Workflows](#5-core-operational-workflows)
  - [5.1 Learning & Atomic Progress Engine](#51-learning--atomic-progress-engine)
  - [5.2 Server-Side Quiz Assessment Engine](#52-server-side-quiz-assessment-engine)
  - [5.3 Instructor Course Authoring & Publishing Lifecycle Engine](#53-instructor-course-authoring--publishing-lifecycle-engine)
  - [5.4 Pre-Signed Media & Asset Direct Upload Workflow](#54-pre-signed-media--asset-direct-upload-workflow)
  - [5.5 Admin Content Moderation & Course Takedown Engine](#55-admin-content-moderation--course-takedown-engine)
  - [5.6 User Account Governance & Immediate Session Revocation Engine](#56-user-account-governance--immediate-session-revocation-engine)
- [6. REST API Reference](#6-rest-api-reference)
  - [6.1 Authentication (`/api/v1/auth`)](#61-authentication-apiv1auth)
  - [6.2 Users & Dashboard (`/api/v1/users`)](#62-users--dashboard-apiv1users)
  - [6.3 Instructors (`/api/v1/instructors`)](#63-instructors-apiv1instructors)
  - [6.4 Subjects & Categories (`/api/v1/subjects`)](#64-subjects--categories-apiv1subjects)
  - [6.5 Courses & Curriculum (`/api/v1/courses`, `/api/v1/modules`, `/api/v1/lessons`)](#65-courses--curriculum-apiv1courses-apiv1modules-apiv1lessons)
  - [6.6 Enrollments & Progression (`/api/v1/enrollments`, `/api/v1/lessons`)](#66-enrollments--progression-apiv1enrollments-apiv1lessons)
  - [6.7 Quizzes & Assessments (`/api/v1/quizzes`)](#67-quizzes--assessments-apiv1quizzes)
  - [6.8 Engagement: Resources, Bookmarks, Reviews & Certificates](#68-engagement-resources-bookmarks-reviews--certificates)
  - [6.9 Notifications (`/api/v1/notifications`)](#69-notifications-apiv1notifications)
  - [6.10 Platform Administration (`/api/v1/admin`)](#610-platform-administration-apiv1admin)
  - [6.11 Achievements & Inbound Webhooks](#611-achievements--inbound-webhooks)
- [7. Security Architecture](#7-security-architecture)
  - [7.1 Redis Key Namespace & Session Registry](#71-redis-key-namespace--session-registry)
- [8. Implementation Plan](#8-implementation-plan)
- [9. Testing Strategy](#9-testing-strategy)
  - [9.1 Test Execution Matrix](#91-test-execution-matrix)
  - [9.2 Test Environment Provisioning](#92-test-environment-provisioning)
  - [9.3 Testing Coverage Breakdown](#93-testing-coverage-breakdown)
- [10. Deployment & Infrastructure](#10-deployment--infrastructure)
  - [10.1 Multi-Stage Dockerfile](#101-multi-stage-dockerfile)
  - [10.2 Environment Variable Matrix](#102-environment-variable-matrix)
- [11. Acceptance Criteria](#11-acceptance-criteria)
- [12. Risk Mitigation Strategy](#12-risk-mitigation-strategy)

---

## 1. Executive Summary

### 1.1 Overview
EduSphere is a multi-tenant e-learning platform providing structured courses, interactive lessons, automated quiz assessment, progress tracking, and gamified achievement badging. The backend transitions the platform from a client-side prototype using mock data (`data.js`) and `localStorage` to a production-ready, database-backed RESTful service.

### 1.2 Core Workflow

> [!NOTE]
> **Core Operational Cycle:** Instructors structure and publish courses organized by modules and lessons → Students discover, enroll, and consume learning content → Server tracks lesson progress and evaluates quiz submissions → Certificates and achievement badges are awarded automatically upon meeting completion criteria.

### 1.3 Scope & Feature Matrix

#### MVP Deliverables (Phase 1)
- **Authentication & Security:** Stateless JWT authentication with refresh token rotation and role-based access control (`STUDENT`, `INSTRUCTOR`, `ADMIN`).
- **Curriculum Management:** Full Course & Curriculum authoring (Courses, Modules, Lessons, Subjects).
- **Enrollment & Progress:** Enrollment lifecycle and atomic lesson progress calculation.
- **Assessment Engine:** Server-side quiz execution engine with immediate grading, attempt history, and score validation.
- **Analytics Dashboards:** Aggregated metric views for both Student and Instructor dashboards.
- **Asset Management:** Media and resource asset storage integration via AWS S3 / Cloudinary.
- **Gamification & Certification:** Achievement badges, streak counters, and automated PDF certificate generation (`pdfkit`).
- **Communications:** Transactional notifications and email verification via SendGrid / Brevo REST API.

#### Deferred Features (Phase 2)
- Payment gateway integration (Stripe / Paystack for paid course monetization).
- Live video streaming / WebRTC interactive virtual classrooms.
- Multi-tenant white-labeling for institutional enterprise clients.
- AI-driven personalized learning path recommendations.

---

## 2. Project Overview

### 2.1 Problem Statement
The frontend prototype relies entirely on client-side state, unencrypted mock credentials, and volatile `localStorage`. To support real-world deployment, the platform requires an authoritative backend to enforce access control, persist student progression, securely evaluate quiz assessments without exposing answer keys to clients, and manage asset delivery.

### 2.2 Product Vision
Provide an intuitive, responsive, and reliable digital learning ecosystem where learners master concepts at their own pace, instructors seamlessly organize educational material, and learning outcomes are validated through objective assessments.

### 2.3 Target Users & Roles

| Persona | System Role | Core Capabilities |
| :--- | :--- | :--- |
| **Alex** | Student (`STUDENT`) | Catalog search, enrollment, lesson viewing, quiz attempts, progress tracking, bookmarking, and profile management. |
| **Dr. Sarah Chen** | Instructor (`INSTRUCTOR`) | All student permissions plus course drafting, module/lesson authoring, quiz creation, student enrollment metrics, and review analytics. |
| **Platform Administrator** | Admin (`ADMIN`) | Full system oversight, user management, course moderation/publishing approval, global analytics, and audit inspection. |
| **Visitor** | Guest (Unauthenticated) | Public catalog browsing, subject exploration, and course preview viewing. |

> [!NOTE]
> **Guest Access Tier:** `GUEST` is not a persisted database role. Guest access is enforced by the absence of a valid JWT token in the `Authorization` header. Public routes (catalog browsing, course previews, certificate verification) require no authentication and are accessible to all visitors. The `UserRole` enum in the database contains only `STUDENT`, `INSTRUCTOR`, and `ADMIN`.
>
> **Course Preview Mechanism:** "Course preview viewing" is backed by the `Lesson.isFreePreview` boolean flag. `GET /courses/:slug` returns the full curriculum outline (module and lesson titles, types, durations) to everyone, but lesson **bodies** (`content`, `videoUrl`, `codeSnippet`) are returned only for lessons where `isFreePreview = true`. Instructors mark preview lessons during authoring. Without this flag a guest would see zero lesson content, making the stated capability unimplementable.

### 2.4 Success Metrics

| Metric | Target Goal | Verification Method |
| :--- | :--- | :--- |
| **API Response Latency (p95)** | `< 120ms` for cached reads, `< 250ms` for relational queries | `pino-http` `responseTime` field aggregated from structured logs + load testing |
| **Quiz Scoring Integrity** | 100% server-side validation with zero client answer leakage | Integration tests & audit |
| **Progress Update Latency** | `< 100ms` for the transactional core of `POST /lessons/:id/complete` (progress upsert, percentage recalculation, enrollment status, streak) | Automated performance tests, measured on the DB transaction span only |
| **Email Delivery Reliability** | `> 99%` transactional dispatch rate | Provider delivery webhooks ingested at `POST /api/v1/webhooks/email` (§6.11) |
| **Platform Availability** | `≥ 99.9%` operational uptime | Health checks & monitoring |

> [!IMPORTANT]
> **Latency Budget Boundary:** The `< 100ms` progress target covers only the synchronous database transaction. Post-commit side effects triggered by course completion (certificate record issuance is in-transaction; **PDF rendering and email dispatch are not**) are explicitly excluded from this budget — see §5.1 for the transaction boundary. Measuring end-to-end request time including a `pdfkit` render and an outbound SendGrid/Brevo HTTP call against a 100ms budget is not achievable and was a contradiction in earlier revisions of this document.

---

## 3. System Architecture

### 3.1 High-Level Architecture Diagram

```mermaid
graph TD
    Client[Clients: Web App / Mobile / Dashboards] -->|HTTPS / REST API| Gateway[Express 5 API Gateway]
    
    subgraph Gateway Layer
        Gateway --> MW[Middlewares: Helmet, CORS, Rate-Limiter, Pino Logger]
        MW --> AuthGuard[Validation & Auth: Zod Schema -> JWT Auth -> RBAC Guard]
    end

    subgraph Domain Modules
        AuthGuard --> ModAuth[Auth & Users]
        AuthGuard --> ModCourse[Courses & Curriculum]
        AuthGuard --> ModQuiz[Quiz & Assessment Engine]
        AuthGuard --> ModGamify[Gamification & Certificates]
        AuthGuard --> ModAdmin[Admin & Moderation]
    end

    subgraph Data & Storage Services
        ModAuth & ModCourse & ModQuiz & ModGamify & ModAdmin --> Postgres[(PostgreSQL 15 Primary DB / Prisma ORM)]
        ModAuth & ModCourse & ModAdmin --> Redis[(Redis 7 Cache / Sessions / Locks)]
        ModCourse & ModGamify --> S3[AWS S3 / Cloudinary Media Storage]
        ModAuth & ModGamify & ModAdmin --> Email[SendGrid / Brevo REST Email Service]
    end
```

### 3.2 Module Directory Convention

All functional units reside in `src/modules/<module>/` following a standard separation of concerns:

```text
src/modules/<module>/
├── <module>.controller.js   # Request unpacking, HTTP status mapping, response formatting
├── <module>.service.js      # Business logic, ORM queries, transactional operations
├── <module>.routes.js       # Route definitions, middleware chaining, RBAC guards
└── <module>.schema.js       # Zod validation schemas for request bodies, params, and queries
```

> [!TIP]
> **Architectural Rules:**
> - **Controller Rules:** Controllers parse incoming payloads and delegate directly to services; controllers never execute database queries directly.
> - **Service Rules:** Services encapsulate core business logic, handle transactions, throw domain-specific `AppError` exceptions, and remain completely decoupled from Express `req` and `res` objects.
> - **Middleware Pipeline:** `validate(schema)` → `requireAuth` → `requireRole([...])` → `controller`.

### 3.3 Tech Stack & Tooling

| Layer | Technology | Specification / Purpose |
| :--- | :--- | :--- |
| **Runtime & Framework** | Node.js 22 LTS / Express 5 | Core HTTP server and API routing |
| **Primary Database & ORM** | PostgreSQL 15 / Prisma 6 | Relational data persistence and schema migrations |
| **Caching & Session Storage** | Redis 7 (`ioredis`) | Refresh token sessions, verification/reset tokens, cache invalidation, rate limiting |
| **Schema Validation** | Zod 3 | Runtime request body, parameter, and query validation |
| **Authentication & Security** | `jsonwebtoken` + `bcryptjs` (12 rounds) | JWT access/refresh token pairs, password hashing |
| **Cookie Parsing** | `cookie-parser` | Reads the `HttpOnly` refresh-token cookie on `POST /auth/refresh` |
| **Media & File Storage** | `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` / `cloudinary` | Secure video hosting, downloadable lesson resources, avatars, pre-signed uploads |
| **Multipart Handling** | `multer` (memory storage, 5MB cap) | Avatar uploads only (`POST /users/me/avatar`); all large media uses pre-signed direct upload (§5.4) |
| **Document Engine** | `pdfkit` | On-demand certificate and progress report generation |
| **Transactional Email** | Brevo / SendGrid REST API (`axios`) | Account verification, course enrollment alerts, reset tokens |
| **Observability & Logging** | `pino` + `pino-http` | Structured JSON log emission; `responseTime` powers the p95 latency metric |
| **Testing Suite** | Vitest 4 + Supertest 7 + `@vitest/coverage-v8` | Unit, integration, and end-to-end API testing with coverage reporting |
| **Documentation** | `swagger-ui-express` + `swagger-jsdoc` | OpenAPI 3.0 specification generation |

> [!IMPORTANT]
> **Dependency Completeness:** `axios`, `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `cloudinary`, `cookie-parser`, and `@vitest/coverage-v8` are required by this specification and **must be present in `package.json`**. Earlier revisions listed these capabilities in prose without declaring the packages, leaving `§5.4` (pre-signed uploads), `§6.1` (cookie-based refresh), the email integration, and the `§9.1` coverage target unimplementable.
>
> **No Job Queue by Design:** There is deliberately no background worker or queue (BullMQ, Agenda) in the MVP stack. All deferred work is instead made *lazy* or *fire-and-forget with a durable database fallback* — certificate PDFs render on first download (§5.1), and email dispatch failures are absorbed without rolling back business state, with the `Notification` row acting as the durable record of the event. Introducing a queue is a Phase 2 decision.

### 3.4 Project File Structure

```text
src/
├── app.js                              # Express app setup (security, CORS, middleware, global error handler)
├── server.js                           # Server bootstrap, DB connection, Redis init, graceful shutdown
├── config/
│   ├── env.js                          # Zod-validated environment configuration
│   ├── constants.js                    # Roles, course levels, criteria enums, pagination limits
│   ├── system_messages.js              # Centralized user-facing messages and errors
│   ├── redis.js                        # Redis client instance and helper methods
│   └── swagger.js                      # OpenAPI configuration
├── database/
│   ├── index.js                        # Prisma client singleton
│   ├── schema.prisma                   # Full relational schema
│   ├── seed.js                         # Database seed script for subjects, courses, badges
│   └── migrations/                     # Prisma migration directory
├── middlewares/
│   ├── auth.middleware.js              # requireAuth (JWT verification) and optionalAuth
│   ├── rbac.middleware.js              # requireRole (STUDENT, INSTRUCTOR, ADMIN)
│   ├── validate.middleware.js          # Zod validation wrapper for body, params, query
│   ├── rate-limit.middleware.js        # Global and route-specific rate limiters
│   └── logging.middleware.js           # Structured HTTP request logger
├── modules/
│   ├── auth/                           # Authentication, verification, password recovery
│   ├── users/                          # User profile, settings, avatar management
│   ├── instructors/                    # Instructor profiles, stats, teaching portfolio
│   ├── subjects/                       # Subject categories and course counts
│   ├── courses/                        # Course catalog, search, filters, CRUD
│   ├── modules/                        # Course module ordering and hierarchy
│   ├── lessons/                        # Lesson content, video references, code snippets
│   ├── enrollments/                    # Enrollment management, progress tracking engine
│   ├── quizzes/                        # Quizzes, questions, attempt evaluation engine
│   ├── resources/                      # Downloadable attachments and file metadata
│   ├── bookmarks/                      # Course and lesson bookmarking
│   ├── reviews/                        # Course ratings, testimonials, review management
│   ├── achievements/                   # Gamification rules, user badges, streaks
│   ├── certificates/                   # PDF certificate issuing and verification
│   ├── notifications/                  # In-app and transactional notifications
│   └── admin/                          # Moderation, user controls, platform audit logs
├── integrations/
│   ├── storage/                        # AWS S3 / Cloudinary upload helpers
│   └── email/                          # Brevo/SendGrid client and HTML template renderers
└── utils/
    ├── api-response.js                 # Standardized success/created/error response builders
    ├── app-error.js                    # Custom operational error hierarchy
    ├── cache-keys.js                   # Redis key builders & pattern-eviction helper (see §7.1)
    └── certificate-generator.js        # PDF generation utility via pdfkit

tests/
├── setup.js                            # Global setup: migrate + seed test DB, flush test Redis DB
├── helpers/                            # Auth token factory, entity factories
├── unit/                               # Pure-function tests (scoring, streak, token crypto)
└── integration/                        # Supertest HTTP tests against the test database
```

> [!CAUTION]
> **Prisma Schema Path — Required Configuration:** The schema lives at `src/database/schema.prisma`, **not** at the Prisma default `prisma/schema.prisma`. Every Prisma invocation therefore requires an explicit path, or all of `prisma generate`, `prisma migrate dev`, `prisma migrate deploy`, and `prisma db seed` fail with "Could not find a schema". Resolve this **once** by declaring the path in `package.json` rather than repeating `--schema` at every call site:
>
> ```json
> "prisma": {
>   "schema": "src/database/schema.prisma",
>   "seed": "node src/database/seed.js"
> }
> ```
>
> Migrations are generated into `src/database/migrations/`. The Dockerfile (§10.1) and CI workflows must not reference a top-level `prisma/` directory — no such directory exists in this project.

> [!NOTE]
> **Test File Placement:** Two locations are valid and both must be collected by `vitest.config.js`: co-located module tests at `src/**/tests/*.test.js`, and cross-cutting suites at `tests/{unit,integration}/**/*.test.js`. A config that includes only `src/**/*.test.js` silently collects nothing from `tests/` — see §9.1.

---

## 4. Database Schema & Data Model

PostgreSQL relational schema containing 20 database tables mapped via Prisma ORM (`snake_case` DB columns → `camelCase` model attributes).

### 4.1 Entity-Relationship (ER) Diagram

```mermaid
erDiagram
    USER ||--o| INSTRUCTOR : "has profile"
    USER ||--o| USER_STREAK : "tracks activity"
    USER ||--o{ ENROLLMENT : "enrolls in"
    USER ||--o{ QUIZ_ATTEMPT : "attempts"
    USER ||--o{ BOOKMARK : "saves"
    USER ||--o{ REVIEW : "authors"
    USER ||--o{ USER_ACHIEVEMENT : "earns"
    USER ||--o{ NOTIFICATION : "receives"
    USER ||--o{ CERTIFICATE : "owns"
    USER ||--o{ RESOURCE : "uploads"
    USER ||--o{ AUDIT_LOG : "performs (admin)"

    INSTRUCTOR ||--o{ COURSE : "authors & teaches"

    SUBJECT ||--o{ COURSE : "categorizes"

    COURSE ||--o{ MODULE : "contains"
    COURSE ||--o{ ENROLLMENT : "has student"
    COURSE ||--o{ QUIZ : "includes"
    COURSE ||--o{ RESOURCE : "attaches"
    COURSE ||--o{ BOOKMARK : "bookmarked in"
    COURSE ||--o{ REVIEW : "receives"
    COURSE ||--o{ CERTIFICATE : "issues"

    MODULE ||--o{ LESSON : "contains"

    LESSON ||--o| QUIZ : "assessed by (FK on QUIZ.lessonId)"
    LESSON ||--o{ LESSON_PROGRESS : "tracked by"
    LESSON ||--o{ BOOKMARK : "bookmarked in"

    ENROLLMENT ||--o{ LESSON_PROGRESS : "records"

    QUIZ ||--o{ QUIZ_QUESTION : "contains"
    QUIZ ||--o{ QUIZ_ATTEMPT : "evaluated by"

    ACHIEVEMENT ||--o{ USER_ACHIEVEMENT : "awarded to"

    USER {
        uuid id PK
        string fullName
        string email UK
        string passwordHash
        enum role
        boolean isEmailVerified
        boolean isBanned
        datetime deletedAt
    }

    INSTRUCTOR {
        uuid id PK
        uuid userId FK_UK
        string title
        float rating
        int studentCount
    }

    USER_STREAK {
        uuid id PK
        uuid userId FK_UK
        int currentStreak
        int longestStreak
        date lastActiveDate
    }

    SUBJECT {
        uuid id PK
        string name UK
        string slug UK
        int courseCount
    }

    COURSE {
        uuid id PK
        string title
        string slug UK
        uuid subjectId FK
        uuid instructorId FK
        enum level
        decimal price
        boolean isPublished
        boolean isFeatured
    }

    MODULE {
        uuid id PK
        uuid courseId FK
        string title
        int orderIndex
    }

    LESSON {
        uuid id PK
        uuid moduleId FK
        string title
        enum type
        int durationMinutes
        boolean isFreePreview
        int orderIndex
    }

    ENROLLMENT {
        uuid id PK
        uuid userId FK
        uuid courseId FK
        float progressPercent
        enum status
    }

    LESSON_PROGRESS {
        uuid id PK
        uuid enrollmentId FK
        uuid lessonId FK
        boolean isCompleted
    }

    QUIZ {
        uuid id PK
        uuid courseId FK
        uuid lessonId FK_UK
        string title
        int passingScore
        int maxAttempts
    }

    QUIZ_QUESTION {
        uuid id PK
        uuid quizId FK
        string questionText
        enum type
        int correctAnswerIndex
    }

    QUIZ_ATTEMPT {
        uuid id PK
        uuid userId FK
        uuid quizId FK
        float score
        boolean isPassed
    }

    RESOURCE {
        uuid id PK
        string title
        uuid courseId FK
        uuid uploadedBy FK
        string fileUrl
    }

    BOOKMARK {
        uuid id PK
        uuid userId FK
        uuid courseId FK
        uuid lessonId FK
    }

    REVIEW {
        uuid id PK
        uuid userId FK
        uuid courseId FK
        int rating
        string comment
    }

    CERTIFICATE {
        uuid id PK
        string certificateNo UK
        uuid userId FK
        uuid courseId FK
        string certificateUrl
    }

    NOTIFICATION {
        uuid id PK
        uuid userId FK
        enum type
        string title
        boolean isRead
    }

    USER_ACHIEVEMENT {
        uuid id PK
        uuid userId FK
        uuid achievementId FK
        datetime earnedAt
    }

    ACHIEVEMENT {
        uuid id PK
        string name UK
        string criteriaType
        int criteriaValue
    }

    AUDIT_LOG {
        uuid id PK
        uuid adminId FK
        string actionType
        string targetType
        uuid targetId
        string reason
        datetime performedAt
    }
```

### 4.2 Prisma Data Model (PostgreSQL)

> [!CAUTION]
> **Single Source of Truth for the Lesson ↔ Quiz Link:** The foreign key lives **exclusively** on `Quiz.lessonId` (a quiz is authored *for* a lesson). `Lesson` has **no** `quizId` column. Earlier revisions declared a scalar FK on *both* sides (`Lesson.quizId @unique` carrying `fields:`/`references:`, plus an orphan `Quiz.lessonId @unique`). That schema passes `prisma validate`, but Prisma only ever maintains the side that owns the relation — the other column is created with a unique constraint and then left permanently `NULL`, giving two columns for one link and a silent data-integrity trap. The quiz→lesson completion trigger in §5.2 depends on this link, so the ambiguity was load-bearing.

> [!NOTE]
> **Constraints Requiring Hand-Written Migration SQL:** Three constraints in this model cannot be expressed in Prisma schema syntax and **must** be added manually to the generated migration. They are not optional hardening — two of them are the only thing enforcing a documented API contract.
>
> ```sql
> -- 1. Bookmark uniqueness. Postgres treats NULLs as DISTINCT in unique indexes, so a
> --    plain @@unique([userId, courseId, lessonId]) permits UNLIMITED duplicate rows for
> --    (user, course, NULL). POST /bookmarks/toggle would create duplicates forever.
> CREATE UNIQUE INDEX bookmarks_user_course_uniq ON bookmarks (user_id, course_id)
>   WHERE lesson_id IS NULL;
> CREATE UNIQUE INDEX bookmarks_user_lesson_uniq ON bookmarks (user_id, lesson_id)
>   WHERE lesson_id IS NOT NULL;
>
> -- 2. Course slug uniqueness scoped to live rows, so soft-deleted courses do not hold a
> --    slug hostage forever and block an instructor from reusing the title.
> CREATE UNIQUE INDEX courses_slug_live_uniq ON courses (slug) WHERE deleted_at IS NULL;
>
> -- 3. Rating domain enforcement at the database layer, not Zod alone.
> ALTER TABLE reviews ADD CONSTRAINT reviews_rating_range CHECK (rating BETWEEN 1 AND 5);
> ```

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

enum UserRole {
  STUDENT
  INSTRUCTOR
  ADMIN
}

enum CourseLevel {
  BEGINNER
  INTERMEDIATE
  ADVANCED
  ALL_LEVELS
}

enum LessonType {
  VIDEO
  TEXT
  CODE
  QUIZ
}

enum EnrollmentStatus {
  ACTIVE
  COMPLETED
  DROPPED
}

enum QuizQuestionType {
  MULTIPLE_CHOICE
  TRUE_FALSE
}

enum NotificationType {
  SYSTEM
  ENROLLMENT
  COURSE_UPDATE
  ACHIEVEMENT
  CERTIFICATE
}

enum AchievementCriteria {
  COURSES_COMPLETED
  QUIZ_PERFECT_SCORE
  STREAK_DAYS
  LESSONS_COMPLETED
}

enum AuditActionType {
  COURSE_APPROVED
  COURSE_REJECTED
  COURSE_DELETED
  COURSE_RESTORED
  COURSE_REPUBLISHED
  USER_BANNED
  USER_UNBANNED
  ROLE_CHANGED
  REVIEW_DELETED
}

enum AuditTargetType {
  COURSE
  USER
  REVIEW
}

model User {
  id              String            @id @default(uuid()) @db.Uuid
  fullName        String            @map("full_name")
  email           String            @unique
  passwordHash    String            @map("password_hash")
  role            UserRole          @default(STUDENT)
  avatarUrl       String?           @map("avatar_url")
  bio             String?
  isEmailVerified Boolean           @default(false) @map("is_email_verified")
  isBanned        Boolean           @default(false) @map("is_banned")
  createdAt       DateTime          @default(now()) @map("created_at")
  updatedAt       DateTime          @updatedAt @map("updated_at")
  deletedAt       DateTime?         @map("deleted_at")

  instructorProfile Instructor?
  streak            UserStreak?
  enrollments       Enrollment[]
  quizAttempts      QuizAttempt[]
  bookmarks         Bookmark[]
  reviews           Review[]
  userAchievements  UserAchievement[]
  notifications     Notification[]
  certificates      Certificate[]
  uploadedResources Resource[]
  auditLogs         AuditLog[]    @relation("AdminAuditLogs")

  @@map("users")
}

model Instructor {
  id           String   @id @default(uuid()) @db.Uuid
  userId       String   @unique @map("user_id") @db.Uuid
  title        String
  rating       Float    @default(0.0)
  studentCount Int      @default(0) @map("student_count")
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  user    User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  courses Course[]

  @@map("instructors")
}

// NOTE — Instructor.studentCount Sync Strategy:
// studentCount is incremented atomically (within prisma.$transaction) each time a NEW
// enrollment is created for any of the instructor's courses. It is NOT decremented on
// course drops — it represents total students ever taught (a lifetime metric).
// A live deduplicated unique-student count can be derived via:
//   SELECT COUNT(DISTINCT e.user_id) FROM enrollments e
//   JOIN courses c ON c.id = e.course_id
//   WHERE c.instructor_id = <instructorId>

model UserStreak {
  id             String    @id @default(uuid()) @db.Uuid
  userId         String    @unique @map("user_id") @db.Uuid
  currentStreak  Int       @default(0) @map("current_streak")
  longestStreak  Int       @default(0) @map("longest_streak")
  lastActiveDate DateTime? @map("last_active_date") @db.Date

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("user_streaks")
}

// NOTE — Streak Day Boundary (Timezone Policy):
// `lastActiveDate` is a DATE with no time component, so "yesterday" and "today" are only
// meaningful relative to a fixed timezone. All streak arithmetic is performed in **UTC**:
// the day key is `new Date().toISOString().slice(0, 10)`. This is a deliberate, documented
// choice — a user in UTC+13 crosses their streak boundary mid-afternoon local time. Storing
// a per-user IANA timezone is a Phase 2 enhancement; until then UTC must be applied
// consistently in both the streak service and any test fixtures, or streak tests will be
// flaky depending on the CI runner's clock.
//
// `lastActiveDate` is nullable so a UserStreak row can be created at registration with a
// zero streak. A non-nullable column with no default (as in earlier revisions) forces every
// caller to invent a date before the user has ever been active.

model Subject {
  id          String   @id @default(uuid()) @db.Uuid
  name        String   @unique
  slug        String   @unique
  icon        String
  color       String
  courseCount Int      @default(0) @map("course_count")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  courses Course[]

  @@map("subjects")
}

model Course {
  id              String       @id @default(uuid()) @db.Uuid
  title           String
  slug            String       @unique
  description     String
  subjectId       String       @map("subject_id") @db.Uuid
  instructorId    String       @map("instructor_id") @db.Uuid
  level           CourseLevel  @default(BEGINNER)
  price           Decimal      @default(0.00) @db.Decimal(10, 2)
  language         String      @default("English")
  durationMinutes Int          @default(0) @map("duration_minutes")
  rating          Float        @default(0.0)
  reviewCount     Int          @default(0) @map("review_count")
  studentCount    Int          @default(0) @map("student_count")
  isFeatured      Boolean      @default(false) @map("is_featured")
  isPublished     Boolean      @default(false) @map("is_published")
  publishedAt     DateTime?    @map("published_at")
  requirements    Json         @default("[]")
  objectives      Json         @default("[]")
  createdAt       DateTime     @default(now()) @map("created_at")
  updatedAt       DateTime     @updatedAt @map("updated_at")
  deletedAt       DateTime?    @map("deleted_at")

  subject      Subject       @relation(fields: [subjectId], references: [id], onDelete: Restrict)
  instructor   Instructor    @relation(fields: [instructorId], references: [id], onDelete: Restrict)
  modules      Module[]
  enrollments  Enrollment[]
  quizzes      Quiz[]
  resources    Resource[]
  bookmarks    Bookmark[]
  reviews      Review[]
  certificates Certificate[]

  @@index([subjectId])
  @@index([instructorId])
  @@index([isPublished, deletedAt])
  @@map("courses")
}

// NOTE — `slug` uniqueness is additionally scoped to live rows via a partial index
// (see the migration SQL above); the @unique here backs Prisma's findUnique. `@@index([slug])`
// was removed from earlier revisions as redundant — @unique already creates that index.
//
// NOTE — `durationMinutes` replaces the former free-text `duration String`. The student
// dashboard (§6.2) must report "total learning hours", which is not computable from strings
// like "6 weeks" or "1h 30m". It is denormalized as the sum of `Lesson.durationMinutes`
// across the course and recalculated inside the same transaction as any lesson
// create/update/delete.
//
// NOTE — `publishedAt` makes the §5.3 response contract (`{ isPublished, publishedAt }`)
// satisfiable; earlier revisions returned a timestamp that had nowhere to be stored.
//
// NOTE — `reviewCount` is stored alongside `rating` so the average can be updated
// incrementally and audited. See the Denormalized Counter Integrity note below.

model Module {
  id         String   @id @default(uuid()) @db.Uuid
  courseId   String   @map("course_id") @db.Uuid
  title      String
  orderIndex Int      @map("order_index")
  createdAt  DateTime @default(now()) @map("created_at")
  updatedAt  DateTime @updatedAt @map("updated_at")

  course  Course   @relation(fields: [courseId], references: [id], onDelete: Cascade)
  lessons Lesson[]

  @@index([courseId])
  @@map("modules")
}

model Lesson {
  id              String     @id @default(uuid()) @db.Uuid
  moduleId        String     @map("module_id") @db.Uuid
  title           String
  type            LessonType @default(TEXT)
  durationMinutes Int        @default(0) @map("duration_minutes")
  content         String     @db.Text
  videoUrl        String?    @map("video_url")
  codeSnippet     String?    @map("code_snippet") @db.Text
  orderIndex      Int        @map("order_index")
  isFreePreview   Boolean    @default(false) @map("is_free_preview")
  createdAt       DateTime   @default(now()) @map("created_at")
  updatedAt       DateTime   @updatedAt @map("updated_at")

  module    Module           @relation(fields: [moduleId], references: [id], onDelete: Cascade)
  quiz      Quiz?            @relation("LessonToQuiz")
  progress  LessonProgress[]
  bookmarks Bookmark[]

  @@unique([moduleId, orderIndex])
  @@index([moduleId])
  @@map("lessons")
}

// NOTE — No `quizId` column. The Lesson ↔ Quiz FK lives solely on `Quiz.lessonId`.
// `quiz Quiz?` is the back-reference side of the 1-1 relation and holds no scalar field.
//
// NOTE — `isFreePreview` gates guest access to lesson bodies (§2.3). `durationMinutes`
// replaces the former free-text `duration String` so learning hours are summable.
//
// NOTE — `@@unique([moduleId, orderIndex])` prevents two lessons from claiming the same
// position, which would make the sequential-unlock rule in §5.2 non-deterministic. Reordering
// must therefore be performed inside a transaction (shift affected rows, then write the
// target), not as isolated updates.

model Enrollment {
  id              String           @id @default(uuid()) @db.Uuid
  userId          String           @map("user_id") @db.Uuid
  courseId        String           @map("course_id") @db.Uuid
  enrolledAt      DateTime         @default(now()) @map("enrolled_at")
  completedAt     DateTime?        @map("completed_at")
  progressPercent Float            @default(0.0) @map("progress_percent")
  status          EnrollmentStatus @default(ACTIVE)

  user           User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  course         Course           @relation(fields: [courseId], references: [id], onDelete: Cascade)
  lessonProgress LessonProgress[]

  @@unique([userId, courseId])
  @@index([userId])
  @@index([courseId])
  @@map("enrollments")
}

model LessonProgress {
  id           String    @id @default(uuid()) @db.Uuid
  enrollmentId String    @map("enrollment_id") @db.Uuid
  lessonId     String    @map("lesson_id") @db.Uuid
  isCompleted  Boolean   @default(false) @map("is_completed")
  completedAt  DateTime? @map("completed_at")

  enrollment Enrollment @relation(fields: [enrollmentId], references: [id], onDelete: Cascade)
  lesson     Lesson     @relation(fields: [lessonId], references: [id], onDelete: Cascade)

  @@unique([enrollmentId, lessonId])
  @@index([enrollmentId])
  @@map("lesson_progress")
}

model Quiz {
  id           String   @id @default(uuid()) @db.Uuid
  courseId     String   @map("course_id") @db.Uuid
  lessonId     String?  @unique @map("lesson_id") @db.Uuid
  title        String
  passingScore Int      @default(70) @map("passing_score")
  maxAttempts  Int?     @map("max_attempts")
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  course    Course         @relation(fields: [courseId], references: [id], onDelete: Cascade)
  lesson    Lesson?        @relation("LessonToQuiz", fields: [lessonId], references: [id], onDelete: Cascade)
  questions QuizQuestion[]
  attempts  QuizAttempt[]

  @@index([courseId])
  @@map("quizzes")
}

// NOTE — `Quiz.lessonId` is the ONLY foreign key for the Lesson ↔ Quiz relation and carries
// `fields:`/`references:`. `Lesson` has no `quizId` column. See the CAUTION note above §4.2.
//
// NOTE — `maxAttempts` (NULL = unlimited) is enforced by the assessment engine in §5.2.
// Without an attempt cap, the post-submission `breakdown` payload lets a student harvest the
// answer key with throwaway attempts and then retake — which would defeat the entire
// server-side-grading design and contradict the §2.4 "zero answer leakage" metric.
// `passingScore` and all `QuizAttempt.score` values are **percentages (0–100)**, never raw
// correct-answer counts.

model QuizQuestion {
  id                 String           @id @default(uuid()) @db.Uuid
  quizId             String           @map("quiz_id") @db.Uuid
  questionText       String           @map("question_text")
  type               QuizQuestionType @default(MULTIPLE_CHOICE)
  options            Json             // Array of strings: ["Option A", "Option B", ...]
  correctAnswerIndex Int              @map("correct_answer_index")
  orderIndex         Int              @map("order_index")
  createdAt          DateTime         @default(now()) @map("created_at")
  updatedAt          DateTime         @updatedAt @map("updated_at")

  quiz Quiz @relation(fields: [quizId], references: [id], onDelete: Cascade)

  @@index([quizId])
  @@map("quiz_questions")
}

// NOTE — Question Shape Validation (Zod, cross-field — the DB cannot express this):
//   • MULTIPLE_CHOICE: `options` must be 2–6 unique non-empty strings.
//   • TRUE_FALSE:      `options` must be exactly ["True", "False"]; index 0 = True.
//   • ALWAYS:          0 <= correctAnswerIndex < options.length.
// A missing bounds check makes it possible to persist a question no student can ever answer
// correctly, silently corrupting every subsequent score.

model QuizAttempt {
  id             String   @id @default(uuid()) @db.Uuid
  userId         String   @map("user_id") @db.Uuid
  quizId         String   @map("quiz_id") @db.Uuid
  attemptNumber  Int      @map("attempt_number")
  score          Float    // PERCENTAGE 0.0–100.0, not a raw correct-answer count
  totalQuestions Int      @map("total_questions")
  answers        Json     // Array of submitted answer indexes, positionally aligned to questions
  isPassed       Boolean  @map("is_passed")
  attemptedAt    DateTime @default(now()) @map("attempted_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  quiz Quiz @relation(fields: [quizId], references: [id], onDelete: Cascade)

  @@unique([userId, quizId, attemptNumber])
  @@index([userId, quizId])
  @@index([quizId])
  @@map("quiz_attempts")
}

// NOTE — `attemptNumber` is required to enforce `Quiz.maxAttempts` without a COUNT-then-INSERT
// race. It is derived inside the submission transaction and the composite unique constraint
// makes a concurrent double-submit fail loudly rather than silently granting a bonus attempt.
//
// NOTE — `@@index([userId, quizId])` serves both the attempt-cap check and
// `GET /quizzes/:id/attempts`, which is owner-scoped (§6.7).

model Resource {
  id          String   @id @default(uuid()) @db.Uuid
  title       String
  description String?
  category    String
  fileType    String   @map("file_type")
  fileUrl     String   @map("file_url")
  fileSize    Int      @map("file_size") // in bytes
  courseId    String?  @map("course_id") @db.Uuid
  uploadedBy  String   @map("uploaded_by") @db.Uuid
  createdAt   DateTime @default(now()) @map("created_at")

  course   Course? @relation(fields: [courseId], references: [id], onDelete: SetNull)
  uploader User    @relation(fields: [uploadedBy], references: [id], onDelete: Restrict)

  @@index([courseId])
  @@map("resources")
}

model Bookmark {
  id        String   @id @default(uuid()) @db.Uuid
  userId    String   @map("user_id") @db.Uuid
  courseId  String?  @map("course_id") @db.Uuid
  lessonId  String?  @map("lesson_id") @db.Uuid
  createdAt DateTime @default(now()) @map("created_at")

  user   User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  course Course? @relation(fields: [courseId], references: [id], onDelete: Cascade)
  lesson Lesson? @relation(fields: [lessonId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("bookmarks")
}

// NOTE — Uniqueness is enforced by TWO PARTIAL UNIQUE INDEXES added in hand-written migration
// SQL (see the top of §4.2), NOT by `@@unique([userId, courseId, lessonId])`. Postgres treats
// NULL as distinct in unique indexes, so the composite version accepted unlimited duplicate
// (user, course, NULL) rows and `POST /bookmarks/toggle` would never find the existing row to
// toggle off. Zod must additionally enforce that exactly one of `courseId` / `lessonId` is
// supplied per request.

model Review {
  id                    String   @id @default(uuid()) @db.Uuid
  userId                String   @map("user_id") @db.Uuid
  courseId              String   @map("course_id") @db.Uuid
  rating                Int      // 1 to 5
  comment               String   @db.Text
  isFeaturedTestimonial Boolean  @default(false) @map("is_featured_testimonial")
  createdAt             DateTime @default(now()) @map("created_at")
  updatedAt             DateTime @updatedAt @map("updated_at")

  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  course Course @relation(fields: [courseId], references: [id], onDelete: Cascade)

  @@unique([userId, courseId])
  @@index([courseId])
  @@map("reviews")
}

model Achievement {
  id            String              @id @default(uuid()) @db.Uuid
  name          String              @unique
  description   String
  icon          String
  criteriaType  AchievementCriteria @map("criteria_type")
  criteriaValue Int                 @map("criteria_value")
  createdAt     DateTime            @default(now()) @map("created_at")

  userAchievements UserAchievement[]

  @@map("achievements")
}

model UserAchievement {
  id            String   @id @default(uuid()) @db.Uuid
  userId        String   @map("user_id") @db.Uuid
  achievementId String   @map("achievement_id") @db.Uuid
  earnedAt      DateTime @default(now()) @map("earned_at")

  user        User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  achievement Achievement @relation(fields: [achievementId], references: [id], onDelete: Cascade)

  @@unique([userId, achievementId])
  @@index([userId])
  @@map("user_achievements")
}

model Notification {
  id        String           @id @default(uuid()) @db.Uuid
  userId    String           @map("user_id") @db.Uuid
  type      NotificationType @default(SYSTEM)
  title     String
  message   String
  isRead    Boolean          @default(false) @map("is_read")
  createdAt DateTime         @default(now()) @map("created_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, isRead])
  @@index([userId, createdAt])
  @@map("notifications")
}

// NOTE — `@@index([userId, isRead])` backs the unread-count aggregate returned by
// `GET /notifications` (§6.9); `@@index([userId, createdAt])` backs its default ordering.
// The single-column `@@index([userId])` of earlier revisions forced a filter/sort on every read.

model Certificate {
  id             String   @id @default(uuid()) @db.Uuid
  certificateNo  String   @unique @map("certificate_no")
  userId         String   @map("user_id") @db.Uuid
  courseId       String   @map("course_id") @db.Uuid
  issuedAt       DateTime @default(now()) @map("issued_at")
  certificateUrl String?  @map("certificate_url")

  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  course Course @relation(fields: [courseId], references: [id], onDelete: Cascade)

  @@unique([userId, courseId])
  @@index([userId])
  @@map("certificates")
}

// NOTE — `certificateUrl` is NULLABLE by design. The certificate RECORD (with its unique
// `certificateNo`) is created inside the completion transaction in §5.1, but the PDF is
// rendered LAZILY on first `GET /certificates/:id/download` and the resulting storage URL is
// then written back. Rendering a pdfkit document and uploading it to S3 inside the
// lesson-completion request cannot meet the §2.4 latency budget, and a storage outage must not
// be able to roll back a student's legitimately earned completion.

model AuditLog {
  id          String          @id @default(uuid()) @db.Uuid
  adminId     String          @map("admin_id") @db.Uuid
  actionType  AuditActionType @map("action_type")
  targetType  AuditTargetType @map("target_type")
  targetId    String          @map("target_id") @db.Uuid
  reason      String?
  metadata    Json?           // Additional context
  performedAt DateTime        @default(now()) @map("performed_at")

  admin User @relation("AdminAuditLogs", fields: [adminId], references: [id], onDelete: Restrict)

  @@index([adminId])
  @@index([targetId])
  @@index([performedAt])
  @@map("audit_logs")
}
```

> [!CAUTION]
> **Denormalized Counter Integrity.** Five stored aggregates can silently drift from the truth. Each one needs a named owner, a fixed set of trigger points, and enclosure in the same `prisma.$transaction` as the change that causes it. Earlier revisions of this document specified only two of the five, and one of those was one-directional.
>
> | Counter | Incremented by | Decremented by | Required guard |
> | :--- | :--- | :--- | :--- |
> | `Subject.courseCount` | Course publish (§5.3) | Course unpublish (§5.5), **admin soft-delete of a published course (§5.5)**, **instructor `DELETE /courses/:id` on a published course** | Transition-guarded: only fire when `isPublished` actually flips. `PUT /courses/:id` sending `isPublished: true` on an already-published course must be a no-op, or false→true→false→true double-counts. |
> | `Course.studentCount` | New enrollment (§6.6) | Never (lifetime metric) | Skip on `DROPPED` → `ACTIVE` reactivation — that is not a new student. |
> | `Instructor.studentCount` | New enrollment on any owned course | Never (lifetime metric) | Same reactivation guard. See the Instructor note above for the deduplicated live query. |
> | `Course.rating` / `Course.reviewCount` | Review create | Review delete | Recomputed as `AVG(rating)` over live reviews on **create, update, and delete** — an update changes the average without changing the count. |
> | `Instructor.rating` | — | — | Recomputed as the enrollment-weighted average of the instructor's published courses' ratings, in the same transaction as `Course.rating`. |
>
> **Soft-delete interaction:** `Subject.courseCount` counts courses that are `isPublished = true AND deletedAt IS NULL`. Any transition out of that set decrements. The §5.5 admin soft-delete path in earlier revisions decremented on the *unpublish* branch only, leaving the count permanently inflated whenever a published course was taken down by deletion instead.
>
> **Reconciliation:** Because every one of these is recoverable from base tables, a `npm run db:reconcile` script must recompute all five and log deltas. Run it after any incident and in CI against the seeded database as a drift assertion.

---

## 5. Core Operational Workflows

### 5.1 Learning & Atomic Progress Engine

The frontend replaces volatile client-side progress arrays with atomic server endpoints.

```mermaid
sequenceDiagram
    autonumber
    actor Student
    participant API as Express API (/api/v1/lessons/:id/complete)
    participant DB as PostgreSQL (Prisma)
    participant Email as SendGrid / Brevo Service

    Student->>API: POST /lessons/:id/complete (JWT Auth)

    rect rgb(235, 245, 255)
    note over API,DB: SYNCHRONOUS — single prisma.$transaction, budgeted < 100ms
    API->>DB: 1. Verify enrollment exists AND status = ACTIVE
    API->>DB: 2. Upsert lesson_progress (is_completed = true) — idempotent
    API->>DB: 3. Guard: totalLessons > 0, then Calculate (completedLessons / totalLessons) * 100
    API->>DB: 4. Update enrollment progress_percent
    API->>DB: 5. Update user_streaks (increment / no-op / reset — UTC day boundary)

    alt Progress == 100%
        API->>DB: 6. Set enrollment.status = COMPLETED, completedAt = now()
        API->>DB: 7. Create Certificate RECORD + unique certificateNo (certificateUrl = NULL)
        API->>DB: 8. Evaluate & award achievements (COURSES_COMPLETED)
        API->>DB: 9. Insert Notification rows (CERTIFICATE, ACHIEVEMENT)
    end
    end

    API-->>Student: Return { progressPercent, completedLessons, totalLessons, isCourseCompleted, certificate? }

    rect rgb(255, 245, 235)
    note over API,Email: POST-COMMIT — after the response, failures logged not thrown
    API->>Email: Dispatch congratulatory email (PDF link, not attachment)
    end
```

> [!IMPORTANT]
> **Transaction Boundary & Side-Effect Isolation.** Everything that constitutes *earned academic state* commits atomically before the response is sent. Everything that talks to a third party happens **after** the commit and **cannot** roll it back:
>
> - **PDF rendering is deferred, not inline.** Step 7 creates only the `Certificate` row and its `certificateNo`. The `pdfkit` document is rendered on first `GET /certificates/:id/download` and the resulting URL cached back to `Certificate.certificateUrl` (which is nullable for exactly this reason). This reconciles §5.1 with §6.8, which already described that endpoint as *generating* the PDF — earlier revisions generated it twice, in two places, one of them inside a 100ms budget.
> - **Email is fire-and-forget.** A SendGrid/Brevo outage must never cost a student their completion. Dispatch failures are logged at `error` with the `userId`/`courseId` and swallowed. The `Notification` row written in step 9 is the durable record of the event, so the student still sees the outcome in-app via `GET /notifications` even when no email is ever delivered. This is what makes AC-17 satisfiable without a job queue.
> - **Concurrency.** Steps 2–4 use `SELECT ... FOR UPDATE` on the enrollment row (Prisma: `$queryRaw` lock inside the transaction) so two rapid completions cannot both read a stale `completedLessons`. The `@@unique([enrollmentId, lessonId])` on `LessonProgress` makes re-completion naturally idempotent.

> [!WARNING]
> **Division-by-Zero Guard:** The progress calculation `(completedLessons / totalLessons) * 100` must guard against `totalLessons = 0`. If a course has zero lessons (edge case during development or data inconsistency), progress defaults to `0.0` and no completion is triggered. This guard must be enforced in the **service layer** (not the controller), and the publishing validation in Section 5.3 (requiring ≥ 1 lesson) acts as a second line of defence at the data-entry stage.

> [!CAUTION]
> **Curriculum Mutation vs. Completed Enrollments.** `totalLessons` is not stable: instructors may add lessons to a published course at any time via `POST /modules/:id/lessons`. Adding one lesson to a course with 200 completed enrollments silently pushes all 200 students below 100% while their `status` remains `COMPLETED` and their certificates are already issued — an inconsistency earlier revisions had no policy for. The rule is:
>
> - **Completion is immutable once earned.** An enrollment that has reached `COMPLETED` is never demoted, and its certificate is never revoked, regardless of later curriculum growth. `progressPercent` for such enrollments is **pinned at 100.0** and excluded from recalculation.
> - **Active enrollments recalculate.** `ACTIVE` enrollments have `progressPercent` recomputed against the new `totalLessons` in the same transaction as the lesson insert/delete, so their displayed progress drops accordingly. This is correct: there is genuinely more material to cover.
> - **Notification.** Adding or removing a lesson on a published course emits a `COURSE_UPDATE` notification to all `ACTIVE` enrollees.
> - **Deleting a lesson** removes its `LessonProgress` rows by cascade and may push an `ACTIVE` enrollment to 100%, which triggers the completion path above exactly as a normal completion would.

### 5.2 Server-Side Quiz Assessment Engine

To maintain academic integrity, quiz answer keys (`correctAnswerIndex`) are kept isolated on the server and never sent to clients.

```mermaid
sequenceDiagram
    autonumber
    actor Student
    participant API as Express API (/api/v1/quizzes)
    participant DB as PostgreSQL

    Student->>API: GET /quizzes/:id
    API->>DB: Query Quiz & Questions (select omits correctAnswerIndex)
    API-->>Student: Return Questions + Options + { attemptsUsed, attemptsRemaining }

    Student->>API: POST /quizzes/:id/submit { answers: [...] }
    API->>DB: 1. Assert enrollment ACTIVE & answers length == question count
    API->>DB: 2. Assert attemptsUsed < maxAttempts (else HTTP 429)
    API->>DB: 3. Fetch Questions WITH correctAnswerIndex
    API->>API: 4. Evaluate score in server memory & determine pass/fail
    API->>DB: 5. Store QuizAttempt (attemptNumber = attemptsUsed + 1)

    opt Quiz Passed & Linked to Lesson
        API->>DB: 6. Trigger Lesson Completion Flow (§5.1 Progress Engine)
    end

    opt Perfect Score (100%)
        API->>DB: 7. Evaluate QUIZ_PERFECT_SCORE achievement
    end

    API-->>Student: Return { attemptId, score, passingScore, isPassed, attemptsRemaining, breakdown }
```

> [!CAUTION]
> **Attempt Caps Are Load-Bearing, Not Optional.** The `breakdown` field returned on submission is an answer-key oracle: with unlimited attempts a student submits a throwaway attempt, reads which items were wrong, and retakes until perfect. Unlimited retakes therefore defeat the entire server-side grading design and directly contradict the §2.4 metric *"zero client answer leakage"* — earlier revisions of this document specified the breakdown payload with no cap of any kind.
>
> **Disclosure rules — what `breakdown` may contain:**
>
> | Attempt outcome | Permitted `breakdown` content |
> | :--- | :--- |
> | **Failed**, attempts remaining | Per-question `{ questionId, isCorrect }` **only**. Never `correctAnswerIndex`, never the correct option text. |
> | **Failed**, no attempts remaining | Full review: `{ questionId, isCorrect, submittedIndex, correctAnswerIndex, explanation? }`. There is nothing left to exploit. |
> | **Passed** | Full review, as above. |
>
> **Enforcement:** `Quiz.maxAttempts` (NULL = unlimited, permitted only for ungraded practice quizzes not linked to a lesson). The cap is checked and the new `attemptNumber` derived **inside** the submission transaction; the `@@unique([userId, quizId, attemptNumber])` constraint makes a concurrent double-submit fail loudly rather than silently granting a bonus attempt. Exceeding the cap returns **HTTP 429** with `attemptsRemaining: 0`.
>
> **Seed default:** quizzes created without an explicit `maxAttempts` where `lessonId IS NOT NULL` default to **3**.

> [!IMPORTANT]
> **Sequential Lesson Unlocking (AC-5).** The original acceptance criterion folded unlocking into quiz scoring — *"returns score and unlocks the next lesson"* — which presupposes lessons are locked in the first place while defining no gating rule anywhere in the document. `GET /lessons/:id` was consequently reachable for any lesson by any enrolled student, and the criterion was untestable. Unlocking is now AC-5 in its own right, governed by lesson completion order rather than quiz outcome. The rule:
>
> - Lesson ordering is the total order `(module.orderIndex, lesson.orderIndex)` across the course, made deterministic by `@@unique([moduleId, orderIndex])` on `Lesson`.
> - A lesson is **accessible** to an enrolled student when it is the first lesson of the course, **or** every preceding lesson in that total order has `LessonProgress.isCompleted = true`.
> - A lesson whose linked quiz has not been **passed** does not count as completed, so a failed quiz blocks progression until passed or attempts are exhausted.
> - **Exhausted attempts do not permanently wall a student:** when `attemptsRemaining = 0` and the quiz was never passed, the lesson is marked complete with the best score recorded, progression continues, and the failure is reflected in dashboards. Hard-blocking would create unrecoverable dead-end enrollments with no instructor-reset endpoint in the MVP.
> - Requesting a locked lesson returns **HTTP 423 Locked** with `{ nextAccessibleLessonId }`.
> - **Bypasses:** `isFreePreview` lessons are always accessible (including to guests, bodies included); the owning `INSTRUCTOR` and `ADMIN` bypass gating entirely.

> [!WARNING]
> **Question Mutation After Attempts Exist.** `PUT /quizzes/:id` is restricted to quizzes with zero attempts, but earlier revisions left the three question-mutation routes (`POST`/`PUT`/`DELETE .../questions`) unguarded. Editing questions after attempts exist silently invalidates every stored `answers` array — those are positionally aligned indexes — and every `totalQuestions`, retroactively corrupting scores and any certificate that depended on them. Therefore once **any** attempt exists on a quiz:
> - Adding, reordering, or deleting questions returns **HTTP 409 Conflict**.
> - Editing `correctAnswerIndex` or `options` returns **HTTP 409 Conflict**.
> - Editing `questionText` for typo correction is permitted (it changes no scoring semantics).
> - The escape hatch is to create a new quiz version and relink the lesson; historical attempts stay bound to the old quiz.

### 5.3 Instructor Course Authoring & Publishing Lifecycle Engine

Instructors author courses incrementally by building the curriculum hierarchy (`Course` → `Module` → `Lesson`/`Quiz`). The course remains in a private `isPublished: false` draft state until the instructor explicitly publishes it. Admins can unpublish or take down courses after publication if content violations are found (see Section 5.5).

```mermaid
sequenceDiagram
    autonumber
    actor Instructor
    participant API as Express API Gateway
    participant DB as PostgreSQL (Prisma)
    participant Cache as Redis 7 Cache

    Instructor->>API: 1. POST /courses { title, description, subjectId } (Auth: INSTRUCTOR)
    API->>DB: Validate Subject & Create Course Draft (isPublished = false)
    API-->>Instructor: Return Course Draft JSON

    Instructor->>API: 2. POST /courses/:id/modules { title, orderIndex }
    API->>DB: Verify Ownership & Create Module Record
    API-->>Instructor: Return Module JSON

    Instructor->>API: 3. POST /modules/:id/lessons { title, type, content, videoUrl }
    API->>DB: Verify Ownership & Add Lesson Record
    API-->>Instructor: Return Lesson JSON

    Instructor->>API: 4. PUT /courses/:id { isPublished: true }
    API->>DB: 5. Publishing Validation: Assert Course has >= 1 Module & >= 1 Lesson
    API->>DB: 6. Transactional Update: Set isPublished = true & Increment subject.course_count
    API->>Cache: 7. Invalidate Public Catalog & Featured Courses Cache Keys
    API-->>Instructor: Return { status: "success", isPublished: true, publishedAt: timestamp }
```

> [!NOTE]
> **Publishing Model — Self-Publish with Admin Override:**
> - **Self-Publish:** Instructors publish courses directly once minimum curriculum requirements are met (≥ 1 module with ≥ 1 lesson). No admin approval queue is required for initial publication.
> - **Admin Override:** Admins retain the ability to unpublish, reject, or soft-delete any published course after-the-fact if content policy violations are discovered (see Section 5.5).
> - **Ownership Verification:** Every mutation on `/courses/:id`, `/modules/:id`, or `/lessons/:id` checks that `course.instructorId` matches the authenticated user's `instructorProfile.id` (or `ADMIN` role override).
> - **Atomic Validation:** Publishing fails with HTTP 422 if the course lacks at least 1 module and 1 playable lesson.
> - **Cache Eviction:** Successful publishing evicts the Redis `catalog:courses:*` keyspace — via `SCAN` + `UNLINK`, **not** `DEL` with a glob (see §7.1) — so guests immediately see the new course.

> [!CAUTION]
> **Publish Transitions Must Be Guarded, Not Just Applied.** Step 6 increments `subject.courseCount`, which makes the operation non-idempotent. `PUT /courses/:id { isPublished: true }` sent twice — a double-click, a client retry, a false→true→false→true toggle — inflates the counter permanently, and the public catalog then advertises course counts that do not match the courses it returns.
>
> - The service reads the current `isPublished` **inside** the transaction and only mutates when the value actually changes. A no-op transition returns HTTP 200 with the unchanged resource and touches no counter.
> - `publishedAt` is written on the first `false → true` transition only, and is never overwritten by a later republish, so it remains a stable "first published" date. (This column was added to §4.2 — earlier revisions returned `publishedAt` in the response with nowhere to store it.)
> - The same transition guard applies symmetrically to every unpublish path in §5.5.
> - Publishing validation counts only **live** lessons in **live** modules, so a course whose only lesson was deleted cannot remain published on the strength of a stale check.

### 5.4 Pre-Signed Media & Asset Direct Upload Workflow

To avoid bandwidth bottlenecks and node process memory exhaustion on large media uploads (lesson videos, course attachments, PDF slides), client uploads bypass the main API server using short-lived S3 / Cloudinary pre-signed URLs.

```mermaid
sequenceDiagram
    autonumber
    actor Instructor
    participant API as Express API (/api/v1/resources/upload-url)
    participant Storage as AWS S3 / Cloudinary
    participant DB as PostgreSQL

    Instructor->>API: 1. POST /resources/upload-url { fileName, fileType, fileSize, courseId }
    API->>API: 2. RBAC Guard: Verify Instructor Role & Course Ownership
    API->>API: 3. Sanitize Input & Check Policy (500MB video / 25MB docs, MIME: video/*, application/pdf)
    API->>Storage: 4. Generate Pre-Signed PUT Upload URL (TTL: 15 mins, staging/ prefix)
    API-->>Instructor: Return { uploadUrl, fileKey, publicUrl, expiresInSeconds }

    Instructor->>Storage: 5. Direct Binary Upload (HTTP PUT to uploadUrl)
    Storage-->>Instructor: HTTP 200 OK (Uploaded to S3/Cloudinary bucket)

    Instructor->>API: 6. POST /resources/confirm { fileKey, title, category, courseId }
    API->>Storage: 7. HeadObject fileKey — verify existence, size, content type
    API->>DB: 8. Create Resource Metadata Record in PostgreSQL
    API-->>Instructor: Return { status, message, data: { id, title, fileUrl } }
```

> [!TIP]
> **Direct-to-S3 Upload Security:**
> - Pre-signed URLs expire after **15 minutes**, and the remaining lifetime is returned to the client as `expiresInSeconds` (900) rather than left to be hardcoded. A client that infers the TTL cannot tell a still-valid URL from an expired one, and silently retries a `PUT` that can only fail.
> - Upload signatures specify explicit `Content-Type` headers so uploaded files cannot be morphed into executable scripts (e.g. enforcing `video/mp4` or `application/pdf`).
> - Size and MIME limits are bound into the signature at issue time. The API never sees the bytes, so validation cannot happen on arrival — a client that misreports `fileSize` or `fileType` receives a signature the storage provider itself rejects.

> [!IMPORTANT]
> **Two Upload Paths — Which Applies Where.** This section describes a three-step pre-signed flow, but the §6.8 endpoint table in earlier revisions listed only a single `POST /resources` and omitted `upload-url` and `confirm` entirely, leaving two contradictory contracts for the same feature. Both paths exist deliberately and are now both enumerated in §6.8:
>
> | Path | Endpoints | Used for | Limit |
> | :--- | :--- | :--- | :--- |
> | **Pre-signed direct upload** | `POST /resources/upload-url` → client `PUT` to storage → `POST /resources/confirm` | Lesson videos, large PDFs, ZIP archives — anything that would tie up a Node process | 500 MB video, 25 MB documents |
> | **Server-proxied multipart** | `POST /users/me/avatar` (and `POST /resources` for small already-hosted metadata) | Avatars only — small, needs immediate transformation | 5 MB, `image/*` only, `multer` memory storage |
>
> `multer` is therefore a dependency of the avatar path **only**; it must never appear in the lesson-media route chain, or the bandwidth bottleneck this section exists to prevent is reintroduced.
>
> **Orphan reaping:** a client that obtains an upload URL and never calls `confirm` leaves an unreferenced object in the bucket. Since there is no job queue (§3.3), the bucket carries a **lifecycle rule expiring objects under `staging/` after 24 hours**; `confirm` copies the object to its permanent prefix. Storage-side expiry rather than application-side cleanup keeps this reliable without a worker.
>
> **`confirm` must re-verify.** `POST /resources/confirm` re-checks course ownership and issues a `HeadObject` against the reported `fileKey` to confirm the object exists and its actual size and content type match what was authorised. Trusting the client's echoed `fileKey` and `fileSize` would let a caller register metadata for a file they never uploaded, or understate a 5 GB upload as 5 MB.

### 5.5 Admin Content Moderation & Course Takedown Engine

Administrators enforce content quality and handle policy violation takedowns on already-published courses. Since instructors self-publish (Section 5.3), admin moderation operates as a post-publication review and enforcement mechanism.

```mermaid
sequenceDiagram
    autonumber
    actor Admin
    participant API as Express API (/api/v1/admin)
    participant DB as PostgreSQL (Prisma)
    participant Cache as Redis 7 Cache
    participant Email as SendGrid / Brevo Service

    Admin->>API: 1. GET /admin/courses?isPublished=true (Auth: ADMIN)
    API->>DB: Fetch Published Courses with Filters
    API-->>Admin: Return Courses Array

    alt Unpublish / Reject Course
        Admin->>API: 2a. PATCH /admin/courses/:id/unpublish { reason: "Policy Violation" }
        API->>DB: Set course.isPublished = false & Decrement subject.course_count
        API->>DB: Record AuditLog (COURSE_REJECTED)
        API->>Cache: Evict catalog:courses:* (SCAN + UNLINK)
        API->>Email: Send Takedown Notice & Detailed Reason to Instructor
        API-->>Admin: Return HTTP 200 { status: "UNPUBLISHED" }
    else Soft-Delete Infringing Course
        Admin->>API: 2b. DELETE /admin/courses/:id { reason: "Severe Violation" }
        API->>DB: Set course.deletedAt = now(), isPublished = false
        API->>DB: Decrement subject.course_count (if it was published)
        API->>DB: Record AuditLog (COURSE_DELETED)
        API->>Cache: Evict catalog:courses:* (SCAN + UNLINK)
        API->>Email: Send Removal Notice to Instructor
        API-->>Admin: Return HTTP 200 { status: "DELETED" }
    else Restore / Republish
        Admin->>API: 2c. PATCH /admin/courses/:id/restore { reason: "Appeal Upheld" }
        API->>DB: Clear course.deletedAt (course returns as an UNPUBLISHED draft)
        API->>DB: Record AuditLog (COURSE_RESTORED)
        API-->>Admin: Return HTTP 200 { status: "RESTORED", isPublished: false }
    end
```

> [!IMPORTANT]
> **Moderation Governance & Audit Integrity:**
> - **Soft Deletion:** Courses deleted by Admins use soft-deletion (`deletedAt = timestamp`) to preserve existing enrollment records and student certificate verifications without causing orphan foreign key errors.
> - **Audit Trail:** Every moderation action (unpublishing, deletion, restoration) records an entry in the `audit_logs` table tracking `adminId`, `targetId`, `actionType`, and `reason`, written **inside the same transaction** as the action itself.
> - **Soft-delete also decrements `courseCount`.** Branch 2b must decrement `subject.courseCount` when the course was published, and must also force `isPublished = false`. Earlier revisions decremented on the unpublish branch only, so taking down a published course by *deletion* left the subject's advertised course count permanently inflated — the catalog would claim 12 courses in "Mathematics" while returning 11. Both branches remove the course from the counted set (`isPublished = true AND deletedAt IS NULL`), so both must decrement, and both must be transition-guarded so a repeated takedown does not double-decrement.
> - **Takedown is reversible.** Branch 2c (`PATCH /admin/courses/:id/restore`) is required: without it, an admin acting on a bad report or a successful instructor appeal has no path back and the instructor's work is unrecoverable through the API. A restored course returns as an **unpublished draft** — never straight back into the public catalog — so the instructor must deliberately republish it. `PATCH /admin/courses/:id/republish` exists for the narrower case of reversing an unpublish where content was never in question.
> - **Enrolled students keep access.** Soft-deleting a course hides it from the catalog and blocks new enrollments, but existing `ACTIVE` enrollees retain lesson access and can still complete it. Revoking access to already-purchased material is a Phase 2 policy decision requiring a refund path, which the MVP does not have.

### 5.6 User Account Governance & Immediate Session Revocation Engine

Administrators oversee user permissions, assign elevated roles (`INSTRUCTOR`, `ADMIN`), and execute security bans or account suspensions.

```mermaid
sequenceDiagram
    autonumber
    actor Admin
    participant API as Express API (/api/v1/admin/users)
    participant DB as PostgreSQL
    participant Redis as Redis 7 Session Store

    Admin->>API: 1. PATCH /admin/users/:id/role { role: "INSTRUCTOR" } (Auth: ADMIN)
    API->>DB: Update User Role in PostgreSQL
    API->>DB: Auto-create Instructor profile if promoting to INSTRUCTOR
    API->>DB: Record AuditLog (ROLE_CHANGED)
    API->>Redis: Invalidate cached user profile & ban/role state (DEL user:state:<id>)
    API-->>Admin: Return Updated User Profile

    opt Account Suspension / Security Ban
        Admin->>API: 2. POST /admin/users/:id/ban { reason: "Terms Violation" }
        API->>DB: Set user.isBanned = true
        API->>DB: Record AuditLog (USER_BANNED)
        API->>Redis: Read session index (SMEMBERS session:index:<id>) then UNLINK each session key
        API->>Redis: Set user:state:<id> = { isBanned: true } (fast-path ban check)
        API-->>Admin: Return { status: "BANNED", activeSessionsRevoked: count }
    end
```

> [!CAUTION]
> **Instant Security Session Revocation:**
> When an Admin bans an account, the backend sets `user.isBanned = true`, revokes every Redis session key for that user, and writes the ban into the `user:state:<id>` fast-path key so the very next request is rejected without a database round-trip. This prevents the user from refreshing access across all active web and mobile client sessions. The `isBanned` flag is separate from `deletedAt` soft-deletion, allowing admins to unban accounts later without data loss.

> [!WARNING]
> **`DEL` Does Not Accept Glob Patterns.** Earlier revisions of this document specified `DEL session:<id>:*` here, `DEL catalog:courses:*` in §5.3/§5.5, and the same pattern in the account-ban acceptance criterion (now AC-13). Redis `DEL` takes literal keys only — issued as written, these calls delete a key *named* `session:<id>:*`, succeed with a reply of `0`, and **silently revoke nothing**, leaving a banned user's sessions fully live until natural expiry. That is a security control that appears to work and does not.
>
> The correct mechanisms are specified in §7.1: an explicit **session index set** for per-user revocation (O(1), exact) and **`SCAN` + `UNLINK`** for catalog cache eviction (non-blocking, pattern-based). `KEYS` must never be used at runtime — it blocks the single-threaded server for the duration of a full keyspace walk.

> [!NOTE]
> **Role Promotion Creates the Instructor Profile.** `Course.instructorId` references `Instructor.id`, not `User.id`, so a user promoted to `INSTRUCTOR` without a corresponding `Instructor` row cannot create a course at all — `POST /courses` would fail on a missing profile while RBAC correctly permits the call. Promotion therefore upserts the `Instructor` profile (default `title` derived from the user's name) in the same transaction. Demotion from `INSTRUCTOR` retains the profile and its courses; it only removes authoring permission. Demoting a user who owns published courses returns **HTTP 409** unless `?force=true` is supplied, in which case their courses are unpublished in the same transaction (with `courseCount` decremented per §4.2).

---

## 6. REST API Reference

All API endpoints are prefixed with `/api/v1` and produce standardized JSON envelope structures.

> [!NOTE]
> **Health Check Endpoint:** `GET /health` (unauthenticated, rate-limit bypassed) returns `{ status: "ok", database: "connected", redis: "connected", uptime: <seconds> }`. Used by the Docker `HEALTHCHECK` directive and container orchestrators. See Acceptance Criteria AC-10.

**Success Response:**
```json
{
  "status": "success",
  "message": "Operation completed successfully",
  "data": {}
}
```

**Error Response:**
```json
{
  "status": "error",
  "message": "Validation failed",
  "errors": [
    { "field": "email", "message": "Invalid email format" },
    { "field": "password", "message": "Must be at least 8 characters" }
  ]
}
```

**Paginated Response:**
```json
{
  "status": "success",
  "data": [],
  "pagination": {
    "page": 1,
    "limit": 10,
    "totalItems": 156,
    "totalPages": 16,
    "hasNextPage": true
  }
}
```

> [!IMPORTANT]
> **Pagination Contract (applies to every paginated endpoint).** `page` defaults to `1`, `limit` defaults to `10`, and **`limit` is hard-capped at `100`**. A request exceeding the cap is clamped, not rejected. Both are coerced and bounds-checked by a shared Zod `paginationSchema`, with the values defined in `config/constants.js`. Earlier revisions stated no maximum, which allows `?limit=1000000` to force an unbounded result set — a trivial denial-of-service against the public, unauthenticated catalog endpoints.
>
> **Resource Identifier Convention.** Public reads address courses by **`:slug`** (SEO-friendly, stable). All mutations and all nested collections address them by **`:id`** (UUID). Nested path parameters are named for their parent (`:courseId`, not `:id`) so a route's own identifier is never ambiguous. Earlier revisions mixed `POST /courses/:id/reviews` with `PUT /courses/:courseId/reviews` in adjacent rows of the same table.

> [!CAUTION]
> **Route Registration Order.** `GET /courses/featured` must be registered **before** `GET /courses/:slug`, or Express 5 matches `featured` as a slug value and the featured-courses endpoint becomes permanently unreachable. The same applies to `PATCH /notifications/read-all` before `PATCH /notifications/:id/read`. Both collisions must be covered by an integration test that asserts the literal path returns its own payload shape, since the failure mode is a `404` on a route that exists.

### 6.1 Authentication (`/api/v1/auth`)

| Method | Endpoint | Auth Guard | Rate Limit | Purpose & Payload |
| :--- | :--- | :--- | :--- | :--- |
| `POST` | `/auth/register` | Public | 5 req / 15 min | Body: `{ fullName, email, password, role? }`. Default role: `STUDENT`. |
| `POST` | `/auth/login` | Public | 5 req / 15 min | Body: `{ email, password }` → Returns access token and sets refresh token in `HttpOnly` cookie. |
| `POST` | `/auth/logout` | Authenticated | Standard | Invalidates refresh token session in Redis. |
| `POST` | `/auth/refresh` | Public | Standard | Rotates refresh token and returns fresh access token. |
| `POST` | `/auth/verify-email` | Public | 5 req / 15 min | Body: `{ token }` → Validates verification hash and updates `isEmailVerified`. |
| `POST` | `/auth/forgot-password` | Public | 5 req / 15 min | Body: `{ email }` → Emits password reset token with 15-minute TTL. |
| `POST` | `/auth/reset-password` | Public | 5 req / 15 min | Body: `{ token, newPassword }` → Resets password hash. |
| `GET` | `/auth/me` | Authenticated | Standard | Fetches authenticated user profile and roles. |

> [!IMPORTANT]
> **Verification & Reset Token Storage.** Four of the endpoints above consume single-use tokens, but the 20-table schema in §4.2 contains no table for them and earlier revisions of this document never said where they live — leaving AC-1 unimplementable from the specification alone. Tokens are **Redis-resident**, never database columns:
>
> | Purpose | Key | Value | TTL |
> | :--- | :--- | :--- | :--- |
> | Email verification | `verify:email:<sha256(token)>` | `userId` | 24 h |
> | Password reset | `reset:pw:<sha256(token)>` | `userId` | 15 min |
>
> - The **raw** token goes in the emailed link; only its SHA-256 hash is stored, so a Redis dump does not yield usable tokens.
> - Tokens are single-use: the key is deleted in the same operation that consumes it.
> - `resetPassword` additionally revokes **all** of the user's sessions (§7.1) — a password reset must log out any attacker already holding a refresh token.
> - Issuing a new token for the same purpose invalidates the previous one.
> - **Redis is a hard dependency for account recovery**, not merely a cache. If Redis is unavailable, verification and reset fail closed (HTTP 503) rather than proceeding unverified. This is the trade-off accepted in exchange for keeping these tokens out of PostgreSQL; §12 records it as a risk.
>
> **Enumeration resistance:** `POST /auth/forgot-password` returns an identical `200` response whether or not the email exists. `POST /auth/register` returns a generic `409` that does not distinguish "already registered" from other conflicts.
>
> **Unverified-account policy:** an unverified user **may** log in and browse, but `POST /enrollments`, `POST /courses`, and all quiz submissions return **HTTP 403** until `isEmailVerified = true`. Blocking login outright would strand users behind email deliverability; blocking nothing would make the flag decorative.

### 6.2 Users & Dashboard (`/api/v1/users`)

| Method | Endpoint | Auth Guard | Purpose |
| :--- | :--- | :--- | :--- |
| `GET` | `/users/:id` | Public | Retrieves public instructor/student profile and statistics. |
| `PUT` | `/users/me` | Authenticated | Updates profile bio, full name, and social links. |
| `POST` | `/users/me/avatar` | Authenticated | Uploads avatar via `multipart/form-data` (`multer`, 5 MB, `image/*` only). |
| `DELETE` | `/users/me` | Authenticated | Self-service account deletion: sets `deletedAt`, anonymizes email, revokes all sessions. |
| `GET` | `/users/me/dashboard` | Authenticated | Aggregates active enrollments, completed courses, streak days, and learning hours (summed from `Lesson.durationMinutes`). |
| `GET` | `/users/me/achievements` | Authenticated | Lists all earned and in-progress user achievements (see §6.11). |
| `GET` | `/users/me/certificates` | Authenticated | Returns earned certificates with verification links. |

> [!NOTE]
> **Account Deletion (`DELETE /users/me`).** `User.deletedAt` exists in §4.2 but earlier revisions exposed no endpoint that could ever set it, leaving the column unreachable and the platform with no data-subject deletion path. Deletion is a **soft delete with PII anonymization**, not a row removal: `email` is rewritten to `deleted-<uuid>@invalid`, `fullName` to `"Deleted User"`, `avatarUrl` and `bio` cleared, `deletedAt` stamped, and all sessions revoked. Enrollments, quiz attempts, and certificates are retained — they are the basis of other parties' records (instructor analytics, certificate verification) and cascading them away would corrupt aggregate history. Reviews are retained but rendered as authored by "Deleted User". Freeing the original email address for reuse is deliberate; retaining it would make the anonymization ineffective.

### 6.3 Instructors (`/api/v1/instructors`)

| Method | Endpoint | Auth Guard | Purpose |
| :--- | :--- | :--- | :--- |
| `GET` | `/instructors/me/dashboard` | Instructor | Aggregates total students, published course count, average rating, and enrollment trends. |
| `GET` | `/instructors/me/courses` | Instructor | Lists all courses owned by the instructor with draft/published status and enrollment counts. |
| `GET` | `/instructors/:id` | Public | Retrieves public instructor profile, bio, rating, and teaching portfolio. |

> [!WARNING]
> **"Revenue" Is Not Measurable in the MVP.** Earlier revisions promised *revenue metrics* on this dashboard and on `GET /admin/analytics`, while §1.3 defers all payment processing to Phase 2. With no payment gateway, no transactions table, and no record of a single completed purchase, any figure produced here is `SUM(course.price × enrollments)` — **theoretical gross merchandise value for courses that were given away for free**. Reporting it as revenue would be actively misleading to instructors making decisions about their pricing.
>
> The field is therefore renamed and re-scoped for the MVP: `grossMerchandiseValue` (clearly labelled *indicative, pre-monetization* in the response and in any UI), or omitted entirely. A true `revenue` field returns only once Phase 2 introduces a `Transaction` model as its source.

### 6.4 Subjects & Categories (`/api/v1/subjects`)

| Method | Endpoint | Auth Guard | Purpose |
| :--- | :--- | :--- | :--- |
| `GET` | `/subjects` | Public | Lists all subjects with icon, theme color, and active course counts. |
| `GET` | `/subjects/:slug/courses` | Public | Paginated courses belonging to a specific subject category. |
| `POST` | `/subjects` | Admin | Creates a new subject taxonomy. |
| `PUT` | `/subjects/:id` | Admin | Updates subject name, slug, icon, or color. |
| `DELETE` | `/subjects/:id` | Admin | Deletes a subject. Returns HTTP 409 if any course still references it (`onDelete: Restrict`). |

> [!NOTE]
> **Subject Count Is Seed Data, Not a Contract.** Earlier revisions specified *"Lists all 10 subjects"*. The count is a property of `seed.js`, not of the API — and `POST /subjects` exists precisely so admins can add more, immediately falsifying it. The endpoint returns however many live subjects exist. `PUT` and `DELETE` are required to make the taxonomy maintainable: with create-only access, a typo in a subject name is permanent.

### 6.5 Courses & Curriculum (`/api/v1/courses`, `/api/v1/modules`, `/api/v1/lessons`)

| Method | Endpoint | Auth Guard | Purpose |
| :--- | :--- | :--- | :--- |
| `GET` | `/courses` | Public | Filterable catalog: `?subject=&level=&priceMax=&search=&sort=&page=&limit=`. |
| `GET` | `/courses/featured` | Public | Curated featured courses for home page carousel. **Must be registered before `/:slug`.** |
| `GET` | `/courses/:slug` | Public | Full course metadata, objectives, requirements, instructor info, and curriculum outline. Lesson bodies only for `isFreePreview` lessons. |
| `POST` | `/courses` | Instructor / Admin | Creates a new course draft. |
| `PUT` | `/courses/:id` | Instructor (Owner) / Admin | Updates course metadata, pricing, or publishing status (transition-guarded — §5.3). |
| `DELETE` | `/courses/:id` | Instructor (Owner) / Admin | Soft deletes course (`deletedAt`); decrements `subject.courseCount` if it was published. |
| `POST` | `/courses/:courseId/modules` | Instructor (Owner) / Admin | Appends a new module to course curriculum. |
| `PUT` | `/modules/:id` | Instructor (Owner) / Admin | Renames module or updates `orderIndex` (reorder is transactional — §4.2). |
| `DELETE` | `/modules/:id` | Instructor (Owner) / Admin | Removes a module and cascades deletion to all its lessons. |
| `POST` | `/modules/:moduleId/lessons` | Instructor (Owner) / Admin | Creates a lesson (Text, Video, Code, or Quiz placeholder). |
| `GET` | `/lessons/:id` | Enrolled (unlocked) / Owner / Admin / Public if `isFreePreview` | Retrieves full lesson content, secure video URL, and code snippets. Returns **HTTP 423** if locked (§5.2). |
| `PUT` | `/lessons/:id` | Instructor (Owner) / Admin | Updates lesson content and metadata; recalculates `Course.durationMinutes`. |
| `DELETE` | `/lessons/:id` | Instructor (Owner) / Admin | Removes a lesson; recalculates course duration and `ACTIVE` enrollment progress (§5.1). |

> [!NOTE]
> **Ownership Resolution.** `Course.instructorId` references `Instructor.id`, **not** `User.id`. Every ownership check must therefore resolve the authenticated user's `instructorProfile.id` first and compare against that. Comparing `course.instructorId === req.user.id` compares a UUID from one table to a UUID from another and silently denies every legitimate owner. A single shared `assertCourseOwnership(courseId, user)` helper is used by all course, module, lesson, quiz, and resource mutations; `ADMIN` bypasses it.

### 6.6 Enrollments & Progression (`/api/v1/enrollments`, `/api/v1/lessons`)

| Method | Endpoint | Auth Guard | Purpose |
| :--- | :--- | :--- | :--- |
| `POST` | `/enrollments` | Student | Enrolls current user into course: `{ courseId }`. On re-enrollment after `DROPPED`, reactivates the existing record (see note below). |
| `GET` | `/enrollments/me` | Authenticated | Lists all enrolled courses with completion progress percentages. |
| `GET` | `/enrollments/:courseId/progress` | Enrolled Student | Retrieves granular lesson completion checklist for a course. |
| `POST` | `/lessons/:id/complete` | Enrolled Student | Marks lesson complete and recalculates course progress percentage. |
| `PATCH` | `/enrollments/:courseId/drop` | Enrolled Student | Sets enrollment status to `DROPPED`. Preserves existing progress records for potential re-enrollment. |

> [!NOTE]
> **Re-Enrollment Policy:** If a student with a `DROPPED` enrollment calls `POST /enrollments` for the same course, the service must **reactivate the existing enrollment record** (`status = ACTIVE`) rather than inserting a new row — a new insert would violate the `@@unique([userId, courseId])` constraint. All previously completed `LessonProgress` records are preserved and `progressPercent` reflects the pre-drop state. The `enrolledAt` timestamp is NOT reset; a separate `reEnrolledAt` timestamp may be added in a future iteration.

### 6.7 Quizzes & Assessments (`/api/v1/quizzes`)

| Method | Endpoint | Auth Guard | Purpose |
| :--- | :--- | :--- | :--- |
| `GET` | `/quizzes/:id` | Enrolled (unlocked) / Instructor (Owner) / Admin | Retrieves quiz questions and options (answer keys omitted) plus `{ attemptsUsed, attemptsRemaining }`. |
| `POST` | `/quizzes/:id/submit` | Enrolled Student | Submits answers, scores attempt, records pass/fail, updates lesson progress. **HTTP 429** when attempts are exhausted. |
| `GET` | `/quizzes/:id/attempts` | **Authenticated (Own attempts only)** / Instructor (Owner) / Admin | Fetches the **caller's** historical attempts. Instructors and admins may pass `?userId=` to inspect a specific student. |
| `POST` | `/quizzes` | Instructor (Owner) / Admin | Creates a quiz linked to a course, optionally to a lesson via `lessonId`. |
| `PUT` | `/quizzes/:id` | Instructor (Owner) / Admin | Updates quiz title, `passingScore`, or `maxAttempts`. **HTTP 409** if any attempt exists. |
| `DELETE` | `/quizzes/:id` | Instructor (Owner) / Admin | Deletes quiz, questions, and attempts. **HTTP 409** if attempts exist unless `?force=true`. |
| `POST` | `/quizzes/:id/questions` | Instructor (Owner) / Admin | Adds one or more questions. **HTTP 409** if any attempt exists. |
| `PUT` | `/quizzes/:id/questions/:questionId` | Instructor (Owner) / Admin | Updates question text, options, or correct answer index. **HTTP 409** if any attempt exists (except `questionText`-only edits). |
| `DELETE` | `/quizzes/:id/questions/:questionId` | Instructor (Owner) / Admin | Removes a question. **HTTP 409** if any attempt exists. |

> [!CAUTION]
> **`GET /quizzes/:id/attempts` Must Be Owner-Scoped.** Earlier revisions guarded this route as merely *"Authenticated"*, meaning any logged-in account could read **any** user's attempt history for any quiz — every classmate's scores and pass/fail record, and, because attempt records carry the submitted `answers` array positionally aligned to questions, a route to reconstructing the answer key from a high-scoring peer's attempt. The guard is ownership, not authentication: the service filters on `userId = req.user.id` unconditionally, and the `?userId=` override is accepted **only** after the caller is confirmed to own the parent course or hold `ADMIN`.
>
> `POST /quizzes` and `PUT /quizzes/:id` were likewise listed as *"Instructor / Admin"* without an ownership qualifier in earlier revisions, which would let any instructor attach a quiz to a competitor's course. All quiz routes resolve ownership through `quiz.course.instructorId` via the shared helper in §6.5.

### 6.8 Engagement: Resources, Bookmarks, Reviews & Certificates

| Method | Endpoint | Auth Guard | Purpose |
| :--- | :--- | :--- | :--- |
| `GET` | `/resources` | Public | Search and filter downloadable resources by category and file type. |
| `POST` | `/resources/upload-url` | Instructor (Owner) / Admin | Issues a 15-min pre-signed PUT URL: `{ fileName, fileType, fileSize, courseId }` → `{ uploadUrl, fileKey, publicUrl, expiresInSeconds }` (§5.4). |
| `POST` | `/resources/confirm` | Instructor (Owner) / Admin | Confirms a completed direct upload and persists metadata: `{ fileKey, title, category, courseId }`. Re-verifies the object via `HeadObject`. |
| `POST` | `/resources` | Instructor (Owner) / Admin | Registers resource metadata for an already-hosted file (no binary transfer). |
| `DELETE` | `/resources/:id` | Instructor (Owner) / Admin | Deletes resource metadata record and triggers S3/Cloudinary file removal. |
| `POST` | `/bookmarks/toggle` | Authenticated | Toggles bookmark: `{ courseId }` **xor** `{ lessonId }` — exactly one required. |
| `GET` | `/bookmarks` | Authenticated | Lists all saved bookmarks for the current user. |
| `GET` | `/courses/:courseId/reviews` | Public | Lists student reviews and ratings for a course. |
| `POST` | `/courses/:courseId/reviews` | Enrolled Student | Submits course review (Rating 1–5 and comment). One review per enrolled student per course. |
| `PUT` | `/reviews/:id` | Authenticated (Owner) | Updates the caller's own review; recalculates `Course.rating`. |
| `DELETE` | `/reviews/:id` | Authenticated (Owner) / **Admin (any review)** | Deletes a review; recalculates `Course.rating`. Admin deletions write an `AuditLog` (`REVIEW_DELETED`). |
| `GET` | `/certificates/:certificateNo` | Public | Public certificate verification endpoint. |
| `GET` | `/certificates/:id/download` | Authenticated (Owner) | Renders the PDF on first call via `pdfkit`, caches the URL, then streams it (§5.1). |

> [!CAUTION]
> **Admin Review Moderation Was Unreachable.** Earlier revisions routed review updates and deletions as `PUT|DELETE /courses/:courseId/reviews`, identifying the target review implicitly by `(req.user.id, courseId)` via the `@@unique` constraint. That shape works for an owner editing their own review and is **structurally incapable** of expressing the same table's stated permission that *"Admins may remove any review for moderation purposes"* — an admin calling it could only ever delete their own review of that course, which almost certainly does not exist. Reviews are therefore addressed by their own `:id` on mutation, which makes both the owner case and the moderation case expressible on one route.
>
> This also removes the `:id` / `:courseId` parameter drift that ran through the original table, and gives review deletion an audit trail consistent with every other admin governance action (§5.5).

> [!NOTE]
> **Bookmark Toggle Semantics.** The request body must carry **exactly one** of `courseId` or `lessonId`, enforced by a Zod `.refine()`. Supplying both, or neither, is HTTP 422 — a bookmark that points at both a course and a lesson has no meaning, and the two partial unique indexes in §4.2 assume the discriminated shape. The response reports the resulting state (`{ bookmarked: true|false }`) so a client never has to guess which way the toggle went.

### 6.9 Notifications (`/api/v1/notifications`)

| Method | Endpoint | Auth Guard | Purpose |
| :--- | :--- | :--- | :--- |
| `GET` | `/notifications` | Authenticated | Paginated list of the caller's notifications (`?isRead=` filter), plus an `unreadCount` field. Served by `@@index([userId, createdAt])`. |
| `PATCH` | `/notifications/read-all` | Authenticated | Marks all unread notifications as read for the current user. **Must be registered before `/:id/read`.** |
| `PATCH` | `/notifications/:id/read` | Authenticated (Owner) | Marks a single notification as read. HTTP 404 — not 403 — if the row belongs to another user. |

> [!NOTE]
> **Ownership Is Enforced by the `WHERE` Clause.** Notification reads and mutations are always scoped `where: { id, userId: req.user.id }`, never `where: { id }` followed by a post-hoc ownership check. A miss then naturally yields HTTP 404, which is also the correct disclosure posture: an attacker probing notification IDs learns nothing about whether a given ID exists on another account.

### 6.10 Platform Administration (`/api/v1/admin`)

| Method | Endpoint | Auth Guard | Rate Limit | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/admin/courses` | Admin | Standard | Paginated list of all courses **including soft-deleted ones** (`?isPublished=&deleted=&search=&sort=`). |
| `PATCH` | `/admin/courses/:id/unpublish` | Admin | 10 req / 15 min | Unpublishes a course with reason; sends takedown notice to instructor. |
| `PATCH` | `/admin/courses/:id/republish` | Admin | 10 req / 15 min | Reverses a takedown: sets `isPublished = true`, re-increments `subject.courseCount`, notifies the instructor. |
| `DELETE` | `/admin/courses/:id` | Admin | 10 req / 15 min | Soft-deletes infringing course content with reason (§5.5). |
| `PATCH` | `/admin/courses/:id/restore` | Admin | 10 req / 15 min | Clears `deletedAt`, restoring the course to an unpublished draft state (§5.5). |
| `GET` | `/admin/users` | Admin | Standard | Paginated user list with role, status, and ban filters. |
| `PATCH` | `/admin/users/:id/role` | Admin | 10 req / 15 min | Updates user role. Promotion to `INSTRUCTOR` auto-creates the `Instructor` profile; demotion of an instructor owning published courses is **HTTP 409** unless `?force=true` (§5.6). |
| `POST` | `/admin/users/:id/ban` | Admin | 10 req / 15 min | Bans user, sets `isBanned = true`, revokes all sessions via the session index set, and writes `user:state:<id>` (§7.1). |
| `POST` | `/admin/users/:id/unban` | Admin | 10 req / 15 min | Unbans user, sets `isBanned = false`, clears `user:state:<id>`, re-enables login. |
| `GET` | `/admin/analytics` | Admin | Standard | Platform-wide metrics: total users, courses, enrollments, completions, and `grossMerchandiseValue`. |
| `GET` | `/admin/audit-logs` | Admin | Standard | Paginated query of the governance audit trail (`?actionType=&targetType=&adminId=`). |

> [!IMPORTANT]
> **Every Moderation Action Is Reversible and Audited.** Unpublish, soft-delete, ban, and role changes each have an explicit inverse on this surface, and each writes an `AuditLog` row keyed by the `AuditActionType` enum (§4.2). Earlier revisions specified only the destructive half of each pair, which meant a mistaken takedown or an erroneous soft-delete had no remedy short of a manual `UPDATE` against production — an operational hazard disguised as a missing endpoint. The `reason` string supplied on every destructive call is persisted in the audit row and echoed verbatim in the instructor's notification, so a takedown is never silent.

> [!WARNING]
> **`revenue` Is Not a Field This System Can Compute.** The `/admin/analytics` payload reports `grossMerchandiseValue` — the summed `Course.price` of paid enrollments — and deliberately does **not** report `revenue`. See §6.3: the MVP records no transactions, refunds, discounts, or payouts, so any figure labeled *revenue* would be a fabrication that reconciles against nothing. Renaming the field is not cosmetic; it prevents a number from being trusted for a purpose it cannot serve.

### 6.11 Achievements & Inbound Webhooks

| Method | Endpoint | Auth Guard | Purpose |
| :--- | :--- | :--- | :--- |
| `GET` | `/achievements` | Public | Lists the achievement catalog (title, description, icon, `criteriaType`, `criteriaValue`). |
| `GET` | `/users/me/achievements` | Authenticated | The caller's earned achievements with `earnedAt`, plus progress toward unearned ones. Defined in §6.2 and listed here for completeness — **one path, not two**. |
| `POST` | `/admin/achievements` | Admin | Creates an achievement definition. `criteriaType` must be a valid `AchievementCriteria` enum member. |
| `PUT` | `/admin/achievements/:id` | Admin | Updates an achievement definition. Does **not** retroactively revoke already-earned `UserAchievement` rows. |
| `DELETE` | `/admin/achievements/:id` | Admin | Deletes an achievement definition and cascades its `UserAchievement` rows. |
| `POST` | `/webhooks/email` | **Provider Signature** | Ingests delivery events (`delivered`, `bounce`, `spam`, `dropped`) from SendGrid / Brevo. |

> [!IMPORTANT]
> **The Achievement Engine Is Evaluated, Not Assigned.** There is no endpoint that grants an achievement to a user. Awards are computed by `achievement.service.js` at exactly three trigger points — lesson completion, quiz submission, and course completion — by evaluating every catalog row whose `criteriaType` is relevant to that event against the user's current counters. The write is `UserAchievement.createMany({ skipDuplicates: true })` guarded by `@@unique([userId, achievementId])`, which makes the evaluation idempotent: replaying a trigger cannot double-award, and a newly-seeded achievement is picked up on the user's next qualifying action without a backfill job.
>
> `criteriaType` mapping: `LESSONS_COMPLETED` and `COURSES_COMPLETED` read the user's aggregate counts; `STREAK_DAYS` reads `UserStreak.currentStreak`; `QUIZ_PERFECT_SCORE` counts `QuizAttempt` rows with `score = 100`. Because these are enum-dispatched rather than string-parsed, adding a criteria kind is a schema migration plus a `switch` arm — never a free-text convention that silently fails to match.

> [!CAUTION]
> **The Email Webhook Is Authenticated by Signature, Not by JWT.** `POST /webhooks/email` is the one route on the platform that is neither public nor session-authenticated. It must verify the provider's signature header (SendGrid `X-Twilio-Email-Event-Webhook-Signature` over the ECDSA public key, or Brevo's shared-secret HMAC) against the **raw, unparsed** request body — which means this route needs `express.raw()` mounted *before* the global `express.json()` parser, since re-serializing parsed JSON produces a different byte sequence and the signature will never match.
>
> The route is required because §2.4 makes "≥ 95% email verification delivery rate" a success metric, and delivery is a fact only the provider knows. Events update the corresponding `Notification` row's delivery state; a `bounce` or `spam` event on a verification email additionally flags the address so the platform stops retrying a dead mailbox. Unsigned or badly-signed requests are dropped with HTTP 401 and **never** processed optimistically — an unauthenticated writer on this route could forge delivery confirmations for mail that was never sent.

---

## 7. Security Architecture

> [!IMPORTANT]
> Security controls must be implemented defense-in-depth across authentication layers, request validation, database access, and HTTP response headers.

| Security Vector | Implementation Standard |
| :--- | :--- |
| **Authentication** | Dual-token authentication: Short-lived JWT access tokens (15 min) in `Authorization` header; long-lived refresh tokens (7 days) in `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/api/v1/auth` cookies with Redis-backed session tracking and revocation. Tokens are signed with **`JWT_SECRET` for access and `JWT_REFRESH_SECRET` for refresh** — two distinct keys, so a leaked access-signing key cannot mint refresh tokens. |
| **Password Hashing** | `bcryptjs` with salt round cost factor 12. |
| **RBAC Enforcement** | Strict middleware validation matching `UserRole` (`STUDENT`, `INSTRUCTOR`, `ADMIN`) against resource ownership. Instructor ownership resolves through `Instructor.id`, never `User.id` (§6.5). |
| **Account State Enforcement** | `requireAuth` rejects tokens whose subject is banned **or soft-deleted**: the guard checks `isBanned` *and* `deletedAt IS NULL` and returns HTTP 403 even when the JWT is cryptographically valid. The check reads the Redis `user:state:<id>` key first and only falls through to Postgres on a miss (§7.1), so the common path costs one `GET` rather than a row fetch per request. |
| **CSRF Defense** | The refresh cookie is `SameSite=Strict` and scoped to `Path=/api/v1/auth`, so no cross-site context can attach it to a state-changing call. All mutating endpoints authenticate from the `Authorization` header — which a browser never sends automatically — meaning no cookie-only mutation surface exists. `POST /auth/refresh` and `POST /auth/logout` are the sole cookie-reading routes and both additionally require an `Origin` / `Referer` match against `CORS_ORIGIN`. |
| **CORS** | `cors` configured with an explicit origin allow-list from `CORS_ORIGIN` and **`credentials: true`** — mandatory, since the refresh cookie is cross-origin from the SPA. Wildcard `*` is invalid in combination with credentials and must never be configured. |
| **Rate Limiting** | Tiered rate limiting via `express-rate-limit`: Global API (100 req / 15 min), Auth endpoints (5 req / 15 min), Admin destructive operations (10 req / 15 min), Health probes bypassed. Keyed on `req.ip` behind `app.set('trust proxy', 1)` so a single load-balancer IP does not throttle the entire user base. |
| **Input Sanitization** | Strict Zod validation on every route rejecting unescaped inputs or prototype pollution attempts. Schemas use `.strict()` so unknown keys are rejected rather than silently dropped, preventing mass-assignment through fields the handler forwards to Prisma. |
| **Assessment Protection** | Quiz answer keys (`correctAnswerIndex`) filtered out on all student read queries via explicit Prisma `select`, never `omit`-after-fetch; grading performed strictly in server memory. Attempt caps (§5.2) bound answer-key inference through repeated `breakdown` disclosure. |
| **HTTP Hardening** | `helmet` for standard security headers (CSP, HSTS, X-Frame-Options, X-Content-Type-Options). Request bodies capped at `express.json({ limit: '100kb' })`; the `/webhooks/email` route is mounted with `express.raw()` ahead of the JSON parser (§6.11). |
| **Error Disclosure** | The global error handler emits the standard error envelope from §6 — `{ status: "error", message, errors? }` — and returns stack traces only when `NODE_ENV !== 'production'`. Prisma error codes are mapped to HTTP status (P2002 → 409, P2025 → 404) rather than surfaced raw, which would otherwise leak table and constraint names. |

### 7.1 Redis Key Namespace & Session Registry

> [!IMPORTANT]
> **Redis Is an Authentication Dependency, Not a Cache.** Session revocation, email verification, and password reset all live exclusively in Redis (§6.1). A Redis outage therefore degrades authentication, not merely performance — so every read path must state its failure posture explicitly. The rule is **fail-closed on security decisions, fail-open on convenience reads**: a session lookup that cannot reach Redis returns HTTP 503 rather than admitting the request, while a cache miss on a course listing falls through to Postgres. This is the single most consequential architectural dependency in the system and is tracked as a named risk in §12.

| Key Pattern | Type | TTL | Purpose |
| :--- | :--- | :--- | :--- |
| `session:<jti>` | String | 7 days | Active refresh-token record → `userId`. Absence means revoked. |
| `session:index:<userId>` | Set | none | Registry of every live `jti` for one user. Enables O(1) "revoke all sessions". |
| `user:state:<userId>` | String | 15 min | Fast-path account state (`active` / `banned` / `deleted`) read by `requireAuth`. |
| `verify:email:<sha256(token)>` | String | 24 hours | Email verification token → `userId`. Single-use. |
| `reset:pw:<sha256(token)>` | String | 15 min | Password reset token → `userId`. Single-use. |
| `cache:courses:<queryHash>` | String | 5 min | Serialized course-listing responses. |
| `cache:course:<slug>` | String | 10 min | Serialized single-course detail response. |
| `ratelimit:<scope>:<ip>` | String | window | Managed by `express-rate-limit`'s Redis store. |

All patterns are constructed through `src/utils/cache-keys.js` (§3.4) — never by inline string concatenation at call sites. A single module owning the namespace is what makes the invalidation rules below auditable rather than folklore.

> [!WARNING]
> **`DEL` Does Not Accept Glob Patterns, and `KEYS` Must Never Run in a Request.** `redis.del('cache:courses:*')` deletes a key *literally named* `cache:courses:*` and reports `0` — it does not match, it silently no-ops, and stale course listings then persist for their full TTL after a publish. Pattern invalidation requires iteration:
>
> ```js
> // Correct: non-blocking cursor scan, batched unlink
> let cursor = '0';
> do {
>   const [next, keys] = await redis.scan(cursor, 'MATCH', 'cache:courses:*', 'COUNT', 100);
>   cursor = next;
>   if (keys.length) await redis.unlink(...keys);
> } while (cursor !== '0');
> ```
>
> `SCAN` is cursor-based and non-blocking; `UNLINK` reclaims memory on a background thread instead of stalling the event loop like `DEL` on a large key set. `KEYS` is **prohibited** in any request-path code — it is O(N) over the entire keyspace and blocks the single-threaded server for its duration, turning a cache invalidation into a platform-wide stall.

> [!CAUTION]
> **Session Revocation Requires the Index Set, Not a Pattern Scan.** Banning a user, resetting a password, and "log out everywhere" all need to invalidate every session belonging to one account. Deriving that set by scanning `session:*` and inspecting each value is O(all sessions on the platform) for a single-user operation. Instead, login writes the `jti` into `session:index:<userId>` alongside `session:<jti>`, and revocation is:
>
> ```js
> const jtis = await redis.smembers(`session:index:${userId}`);
> if (jtis.length) await redis.unlink(...jtis.map(j => `session:${j}`));
> await redis.unlink(`session:index:${userId}`);
> ```
>
> Because `session:<jti>` entries expire on their own but set members do not, the index accumulates dead `jti`s over time. Membership is therefore pruned opportunistically on each refresh (`SREM` the rotated `jti`), and stale members are harmless in the revocation path — unlinking an already-expired key is a no-op.

---

## 8. Implementation Plan

```text
Phase 1: Foundation (Days 1–4)
├── Prisma Configuration (package.json "prisma" key → src/database/schema.prisma)
├── Database Schema Migration (Prisma models, PostgreSQL setup, seed data)
├── Hand-Written Migration SQL (partial unique indexes, rating CHECK constraint — §4.2)
├── Redis Client, Key-Namespace Module (utils/cache-keys.js) & Session Registry
├── Auth Module (JWT, Refresh Rotation, Password Hashing, Email Verification)
├── RBAC Middleware & Global Error Handlers (incl. Prisma error-code mapping)
├── Subject & Course Catalog CRUD with Zod Validation
└── Notification Model & In-App Notification Dispatch

Phase 2: Curriculum & Assessment Engine (Days 5–8)
├── Module & Lesson Hierarchy Endpoints (incl. sequential unlocking, HTTP 423)
├── Enrollment Logic & Atomic Progress Calculation (row-locked, §5.1)
├── Unenroll / Drop Enrollment Endpoint
├── Quiz Authoring & Secure Server-Side Evaluation Engine (attempt caps, §5.2)
└── S3 / Cloudinary Upload Integration (pre-signed URLs + multer avatar path, §5.4)

Phase 3: Gamification, Dashboard & Delivery (Days 9–12)
├── Achievement Engine (UTC streak counters via UserStreak, enum-dispatched criteria)
├── Lazy PDF Certificate Generation Pipeline (pdfkit, render-on-first-download)
├── Student & Instructor Aggregated Dashboard Metrics
├── Transactional Email Integration (SendGrid / Brevo REST) + Delivery Webhook
└── Notification Endpoints (List, Mark Read, Mark All Read)

Phase 4: Admin, Testing & Deployment (Days 13–16)
├── Admin Module: Course Moderation (Unpublish/Republish, Soft-Delete/Restore + Audit Logs)
├── Admin Module: User Governance (Role Changes, Ban/Unban, Session Revocation)
├── Admin Module: Platform Analytics & Audit Log Query Endpoints
├── Counter Reconciliation Script (npm run db:reconcile — §4.2)
├── Integration & End-to-End Testing Suite (Vitest + Supertest)
└── Production Dockerization & Deployment Configuration
```

> [!NOTE]
> **Phase 1 Ordering Is Load-Bearing.** The Prisma configuration step is listed first because the schema lives at `src/database/schema.prisma` rather than the default `prisma/schema.prisma`; until `package.json` declares that path, every `prisma` CLI invocation — migrate, generate, seed, and the CI pipeline's `migrate deploy` — resolves against a directory that does not exist and fails (§3.4). Likewise the Redis key-namespace module precedes the auth module because session storage, verification tokens, and reset tokens all address Redis through it (§7.1); building auth first guarantees inline key strings that later have to be hunted down.

---

## 9. Testing Strategy

### 9.1 Test Execution Matrix

```bash
npm test                 # Full Vitest run, single pass (CI entrypoint)
npm run test:watch       # Interactive watch mode for local development
npm run test:unit        # Unit tests only  (vitest run tests/unit src)
npm run test:integration # Supertest HTTP integration against the test database
npm run test:coverage    # Target: >85% code coverage across services
```

> [!CAUTION]
> **These Scripts Must Exist in `package.json`, and the Vitest `include` Must Cover Both Test Locations.** As currently committed, `package.json` defines only `test` and `test:watch` — `test:unit`, `test:integration`, and `test:coverage` do not exist, and `.github/workflows/ci.yml` invokes a third name, `test:run`, that also does not exist. The CI test job therefore fails on an npm resolution error before a single assertion runs. Required additions:
>
> ```json
> "scripts": {
>   "test": "vitest run",
>   "test:watch": "vitest",
>   "test:unit": "vitest run --dir tests/unit",
>   "test:integration": "vitest run --dir tests/integration",
>   "test:coverage": "vitest run --coverage",
>   "db:reconcile": "node src/database/reconcile.js"
> }
> ```
>
> Separately, `vitest.config.js` sets `include: ['src/**/*.test.js']`, which collects the co-located module tests but **silently ignores the entire `tests/` tree** — integration specs would be written, committed, reported green, and never executed. The pattern must cover both locations declared in §3.4:
>
> ```js
> include: ['src/**/*.test.js', 'tests/{unit,integration}/**/*.test.js'],
> ```
>
> A test suite that is not collected is worse than a missing one: it reports success it never earned.

### 9.2 Test Environment Provisioning

> [!IMPORTANT]
> **Integration Tests Require Their Own Database and Redis Instance.** Supertest exercises real HTTP handlers against real Prisma queries, so the suite needs a disposable Postgres schema and a separate Redis logical database — never the development ones. Tests truncate tables between cases, and pointing them at a developer's working database destroys local seed data.
>
> - `.env.test` supplies `DATABASE_URL_TEST` and `REDIS_URL_TEST`; `tests/setup.js` loads it and rebinds the clients before any suite runs.
> - Redis isolation uses a distinct logical DB (`redis://localhost:6379/1`), so a test-suite `FLUSHDB` cannot wipe development sessions.
> - `tests/setup.js` runs `prisma migrate deploy` against the test database in a `globalSetup` hook, guaranteeing schema parity with production rather than relying on a hand-maintained fixture.
> - Cleanup truncates in FK-safe order via a single `TRUNCATE ... RESTART IDENTITY CASCADE`, which is materially faster than per-model `deleteMany` chains and cannot deadlock on relation order.
> - The CI service containers already provision both (`.github/workflows/ci.yml`); the workflow's `env` block must expose the **same variable names** the application reads — see §10.2, which resolves the current `REDIS_HOST`/`REDIS_PORT` versus `REDIS_URL` split.

### 9.3 Testing Coverage Breakdown
- **Unit Tests:** Password hashing, token generation/revocation, quiz scoring calculations, course progress percentage formulas (including the zero-lesson divide-by-zero guard), UTC streak increment/reset logic, and achievement criteria evaluation.
- **Integration Tests:** Full registration → email verification → login → course enrollment → lesson completion → quiz pass → certificate issuance flow.
- **RBAC Tests:** Assert that students cannot create courses or alter curriculum, and instructors cannot modify other instructors' courses.
- **Admin Tests:** Assert that admin can ban users (sessions revoked), unpublish courses (cache invalidated), restore soft-deleted courses, and that audit logs are recorded for all governance actions.
- **Ban Enforcement Tests:** Assert that banned **and soft-deleted** users receive HTTP 403 on all authenticated endpoints, even with a valid JWT.
- **Attempt Cap Tests:** Assert that a student exhausting `maxAttempts` receives HTTP 429, and that the `breakdown` payload omits `correctAnswerIndex` while attempts remain (§5.2).
- **Cache Invalidation Tests:** Assert that publishing a course clears `cache:courses:*` via `SCAN`+`UNLINK` — a literal `DEL` on the glob must fail this test (§7.1).
- **Counter Integrity Tests:** Assert that enroll/unenroll, review create/update/delete, and course soft-delete/restore leave every denormalized counter in §4.2 equal to its authoritative `COUNT`.

---

## 10. Deployment & Infrastructure

### 10.1 Multi-Stage Dockerfile

```dockerfile
# Stage 1: Build & Prisma Generation
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY src/database/schema.prisma ./src/database/schema.prisma
RUN npx prisma generate
COPY . .

# Stage 2: Production Runtime
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S nodejs && adduser -S nodeapp -G nodejs
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/src ./src
USER nodeapp
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1
CMD ["node", "src/server.js"]
```

> [!CAUTION]
> **Four Defects in the Previous Dockerfile, Each Independently Fatal.**
>
> 1. **Port mismatch.** The healthcheck probed `localhost:5000` while `.env.example`, `docker-compose.yml`, and the committed `Dockerfile` all use `3000`. The container would start, serve traffic correctly, fail every probe, and be marked permanently `unhealthy` — which in an orchestrated deployment means it is killed and restarted forever. The port is now `3000` throughout.
> 2. **`COPY prisma ./prisma/` copies nothing.** There is no `prisma/` directory in this repository; the schema lives at `src/database/schema.prisma`. In Docker, `COPY` of a non-existent path is a **hard build failure**, so the image cannot be built at all. The copy now targets the real path, and because `prisma generate` reads the schema location from the `package.json` `"prisma"` key (§3.4), no `--schema` flag is needed.
> 3. **`RUN npm run build --if-present` is dead weight.** This is a plain ES-module Node service with no transpilation step and no `build` script. The line is silently skipped, which is harmless but misleading — it implies a build artifact that downstream stages might expect to copy.
> 4. **Dev dependencies ship to production.** `npm ci` installs Vitest, Supertest, ESLint, and Prettier into the runtime image. The builder stage needs them only if it runs tests; since it does not, the runtime `node_modules` should be pruned. Either run `npm ci --omit=dev` in a dedicated deps stage, or `npm prune --omit=dev` before the final `COPY --from=builder`.
>
> Migrations are **not** run from `CMD`. `prisma migrate deploy` executes as a separate pre-deploy step (a release command, init container, or CI job) so that N replicas starting simultaneously do not race the same migration, and a failed migration fails the deploy rather than crash-looping the service.

> [!TIP]
> **Docker Build Optimization:** Create a `.dockerignore` file in the project root to exclude unnecessary files from the build context:
> ```text
> node_modules
> .git
> *.md
> .env*
> coverage
> tests
> .vscode
> ```

### 10.2 Environment Variable Matrix

```env
# Application
NODE_ENV=production
PORT=3000
LOG_LEVEL=info
CORS_ORIGIN=https://edusphere.learn

# Database & Cache
DATABASE_URL=postgresql://user:password@localhost:5432/edusphere_db?schema=public
REDIS_URL=redis://localhost:6379

# Security & JWT
JWT_SECRET=super_secure_access_secret_2026
JWT_REFRESH_SECRET=super_secure_refresh_secret_2026
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# Storage & Media
STORAGE_PROVIDER=s3
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=us-east-1
AWS_S3_BUCKET=edusphere-media-storage
CLOUDINARY_URL=

# Transactional Email
EMAIL_PROVIDER=brevo
EMAIL_API_KEY=
EMAIL_FROM=no-reply@edusphere.learn
EMAIL_WEBHOOK_SECRET=

# Test Environment (.env.test only)
DATABASE_URL_TEST=postgresql://user:password@localhost:5432/edusphere_test?schema=public
REDIS_URL_TEST=redis://localhost:6379/1
```

> [!CAUTION]
> **Four Files Currently Disagree About the Same Variables.** Configuration drift is silent: a service reads `process.env.REDIS_HOST`, gets `undefined`, falls back to a default, and connects to the wrong instance — or a validator throws at boot in staging only. The matrix above is the single source of truth, and every consumer must be reconciled to it:
>
> | Variable | Previous TRD | `.env.example` | `docker-compose.yml` | `ci.yml` | Resolution |
> | :--- | :--- | :--- | :--- | :--- | :--- |
> | Redis connection | `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` | `REDIS_URL` | `REDIS_URL` | `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` / `REDIS_DATABASE` | **`REDIS_URL`** — a single URL is what `ioredis` accepts natively and carries auth, TLS, and logical DB in one value |
> | Access token TTL | `JWT_EXPIRES_IN` | `JWT_ACCESS_EXPIRES_IN` | — | — | **`JWT_ACCESS_EXPIRES_IN`** — unambiguous against its refresh counterpart |
> | Refresh signing key | `JWT_REFRESH_SECRET` | *absent* | *absent* | — | **Required.** Distinct keys per token class (§7) |
> | Port | `5000` | `3000` | `3000` | `3000` | **`3000`** |
> | Email config | `BREVO_API_KEY` / `EMAIL_SENDER` | `EMAIL_PROVIDER` / `EMAIL_API_KEY` / `EMAIL_FROM` | — | — | **Provider-neutral names** — hardcoding `BREVO_` defeats the `EMAIL_PROVIDER` switch |
>
> Three additions have no prior definition anywhere and must be created: `JWT_REFRESH_SECRET`, `EMAIL_WEBHOOK_SECRET` (§6.11), and the `*_TEST` pair (§9.2).

> [!IMPORTANT]
> **Configuration Is Validated at Boot, Not at First Use.** `src/config/env.js` parses `process.env` through a Zod schema and calls `process.exit(1)` on failure, before the HTTP listener binds. A missing `JWT_REFRESH_SECRET` must kill the process at startup rather than surface as a 500 on the first token refresh hours into a deployment. Secrets are validated for presence and minimum length (≥ 32 characters for both JWT keys) — never merely for existence, since an empty string is a valid environment variable and an invalid signing key.

---

## 11. Acceptance Criteria

| ID | Scenario | Verification Criteria |
| :--- | :--- | :--- |
| **AC-1** | User Onboarding | User registers as `STUDENT` or `INSTRUCTOR`, verifies email via a single-use Redis token, and logs in to receive valid JWT tokens. |
| **AC-2** | Course Authoring | Instructor creates course draft, adds modules and lessons, and publishes course; published course appears in catalog and `publishedAt` is set exactly once. |
| **AC-3** | Student Enrollment | Student enrolls in published course; enrollment record initialized with `0.0%` progress; `course.studentCount` and `instructor.studentCount` both increment. |
| **AC-4** | Progress Tracking | Completing a lesson atomically updates `progressPercent`; completing all lessons marks enrollment `COMPLETED` and issues a certificate in the same transaction. |
| **AC-5** | Sequential Unlocking | A lesson whose predecessors are incomplete returns **HTTP 423 Locked** with `nextAccessibleLessonId`; completing the predecessor makes it accessible on the next request. |
| **AC-6** | Secure Quiz Scoring | Submitting a quiz evaluates answers server-side and returns a score; no response on any student-facing route contains `correctAnswerIndex`. |
| **AC-7** | Quiz Attempt Cap | A student who has consumed `maxAttempts` receives **HTTP 429**; while attempts remain, `breakdown` discloses only `{ questionId, isCorrect }` (§5.2). |
| **AC-8** | Certificate Issuance | 100% course completion creates a unique certificate record with a null `certificateUrl`; the first `GET /certificates/:id/download` renders the PDF, persists the URL, and streams the file. |
| **AC-9** | Role Enforcement | Students attempting `POST /api/v1/courses` receive HTTP 403 Forbidden. Instructors attempting to mutate another instructor's course receive HTTP 403. |
| **AC-10** | Health Monitoring | `GET /health` returns HTTP 200 with `{ status: "ok", database: "connected", redis: "connected" }` and is exempt from rate limiting. |
| **AC-11** | Course Moderation | Admin unpublishes a course with reason; course leaves the public catalog, `cache:courses:*` is invalidated via `SCAN`+`UNLINK`, instructor receives a takedown notification, and an `AuditLog` row is written. |
| **AC-12** | Moderation Reversal | Admin restores a soft-deleted course and republishes an unpublished one; the course returns to a correct state with `subject.courseCount` matching its authoritative `COUNT` (§5.5). |
| **AC-13** | User Account Ban | Admin bans a user; `isBanned` is set to `true`; every `jti` in `session:index:<userId>` is unlinked. The banned user cannot refresh access tokens or reach authenticated endpoints even while their 15-minute access token remains cryptographically valid. |
| **AC-14** | Role Elevation | Admin promotes a Student to Instructor; an `Instructor` profile is auto-created and the user gains course-authoring access on the next request. Audit log entry is recorded. |
| **AC-15** | Enrollment Drop | Student drops enrollment; status is set to `DROPPED`; `LessonProgress` rows are preserved for potential re-enrollment; student counters decrement. |
| **AC-16** | Account Deletion | `DELETE /users/me` soft-deletes the account, anonymizes PII, revokes all sessions, and causes subsequent requests with a valid JWT to return HTTP 403 (§6.2). |
| **AC-17** | Notification Delivery | Completing a course writes an in-app notification **before** the email is dispatched; the notification appears in `GET /notifications` with `isRead: false` even if the email provider call fails. |
| **AC-18** | Counter Integrity | After a mixed sequence of enrollments, unenrollments, reviews, publishes, and soft-deletes, `npm run db:reconcile` reports **zero** drift across every denormalized counter in §4.2. |

> [!NOTE]
> **Why the Criteria Were Renumbered and Expanded.** Five behaviours that the specification treats as mandatory had no acceptance criterion and were therefore unverifiable: sequential lesson unlocking (previously folded into the quiz-scoring criterion, where it did not belong — unlocking is driven by lesson completion order, not by quiz outcomes), attempt caps, moderation reversal, account deletion, and counter integrity. Two existing criteria were also unfalsifiable as written: AC-10's "all active Redis sessions are immediately revoked" gave no mechanism, and an implementation using `DEL 'session:*'` would have passed a superficial reading while revoking nothing (§7.1). Each criterion above names the observable artifact — a status code, a counter equality, a written row — so that a reviewer can determine pass or fail without consulting the implementer.

---

## 12. Risk Mitigation Strategy

> [!WARNING]
> Mitigations must be proactively enforced during implementation to prevent runtime defects and security breaches.

| Identified Risk | Impact Level | Mitigation Strategy |
| :--- | :--- | :--- |
| **Redis as a Hard Auth Dependency** | **High** | Session state, verification tokens, and reset tokens exist only in Redis, so an outage degrades authentication rather than performance. Security-critical reads fail **closed** (HTTP 503, never admit); cache reads fail **open** (fall through to Postgres). Redis runs with AOF persistence so a restart does not silently log out every user (§7.1). |
| **Quiz Answer Leakage** | High | Never return `correctAnswerIndex` in student-facing quiz APIs — enforced by explicit Prisma `select`, not post-fetch deletion. Perform all comparisons exclusively in backend service memory. |
| **Answer-Key Harvesting via Repeated Attempts** | High | Per-question `isCorrect` disclosure is itself an oracle: unlimited attempts let a student brute-force a 4-option question in at most 4 tries. `Quiz.maxAttempts` (default 3 for graded lesson quizzes) bounds the search, and full `breakdown` is released only once no further attempt is possible (§5.2). |
| **Denormalized Counter Drift** | **High** | Six counters cache values derivable by `COUNT`/`AVG` and will diverge under partial failure, soft-delete, or concurrent writes. Every mutation updates its counter inside the same `prisma.$transaction` as the source row, and `npm run db:reconcile` recomputes all six from authoritative data as a scheduled correction (§4.2, AC-18). |
| **Race Conditions in Progress Updates** | Medium | Use `prisma.$transaction` with `SELECT ... FOR UPDATE` on the enrollment row so concurrent lesson completions serialize rather than interleave read-modify-write on `progressPercent` (§5.1). |
| **Curriculum Mutation Invalidating Progress** | Medium | Adding a lesson to a live course changes the denominator of every enrolled student's progress. `ACTIVE` enrollments are recalculated in the same transaction; `COMPLETED` enrollments are pinned at 100.0 and never demoted, so an earned certificate cannot be retroactively invalidated by an instructor's edit (§5.1). |
| **Divide-by-Zero on Empty Courses** | Medium | Progress calculation guards `totalLessons === 0` before dividing; publishing requires at least one live lesson, which prevents the state from arising in the first place (§5.3). |
| **Silent Cache Staleness** | Medium | `DEL` on a glob pattern is a no-op that returns success, so stale catalog data would survive its full TTL after a publish or takedown. All pattern invalidation uses `SCAN`+`UNLINK`; `KEYS` is prohibited in request-path code and covered by an explicit test (§7.1, §9.3). |
| **Large Media Upload Bottlenecks** | Medium | Utilize direct-to-S3 pre-signed upload URLs so client media bypasses the main API server process. Orphaned `staging/` objects from abandoned uploads are reaped by a 24-hour S3 lifecycle rule (§5.4). |
| **Banned User Access Window** | Medium | Check `isBanned` **and** `deletedAt` in `requireAuth` on every request, not just at login, via the `user:state:<id>` fast path. Combine with immediate Redis session purge through the session index set on ban (§7). |
| **Configuration Drift Across Environments** | Medium | Four files previously disagreed on Redis, JWT, port, and email variable names. §10.2 is the single source of truth, and `src/config/env.js` validates every variable through Zod at boot with `process.exit(1)` on failure — so a misconfiguration fails the deploy instead of the first request that needs it. |
| **Audit Log Gaps** | Medium | Wrap all admin governance actions in service-level methods that atomically perform the action and record the audit log entry within the same database transaction, keyed by the `AuditActionType` enum so no action can be logged under an ad-hoc string. |
| **Email Delivery Failure Blocking Business Logic** | Medium | Email is dispatched **after** commit, fire-and-forget, with the `Notification` row as the durable record. A provider outage costs an email, never a certificate or an enrollment, and delivery outcomes are reconciled through the provider webhook (§6.11). |
| **Session Bloat & Cache Drift** | Low | Fixed TTL expiration on all Redis token keys; `session:index:<userId>` members are pruned opportunistically on refresh rotation, and stale members are inert in the revocation path. |