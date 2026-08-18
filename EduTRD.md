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
- [7. Security Architecture](#7-security-architecture)
- [8. Implementation Plan](#8-implementation-plan)
- [9. Testing Strategy](#9-testing-strategy)
  - [9.1 Test Execution Matrix](#91-test-execution-matrix)
  - [9.2 Testing Coverage Breakdown](#92-testing-coverage-breakdown)
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

### 2.4 Success Metrics

| Metric | Target Goal | Verification Method |
| :--- | :--- | :--- |
| **API Response Latency (p95)** | `< 120ms` for cached reads, `< 250ms` for relational queries | APM logging / Load testing |
| **Quiz Scoring Integrity** | 100% server-side validation with zero client answer leakage | Integration tests & audit |
| **Progress Update Latency** | `< 100ms` atomic update on lesson completion | Automated performance tests |
| **Email Delivery Reliability** | `> 99%` transactional dispatch rate | Webhook callback metrics |
| **Platform Availability** | `≥ 99.9%` operational uptime | Health checks & monitoring |

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
| **Caching & Session Storage** | Redis 7 (`ioredis`) | Refresh token sessions, cache invalidation, rate limiting |
| **Schema Validation** | Zod 3 | Runtime request body, parameter, and query validation |
| **Authentication & Security** | `jsonwebtoken` + `bcryptjs` (12 rounds) | JWT access/refresh token pairs, password hashing |
| **Media & File Storage** | AWS S3 SDK / Cloudinary | Secure video hosting, downloadable lesson resources, avatars |
| **Document Engine** | `pdfkit` | On-demand certificate and progress report generation |
| **Transactional Email** | Brevo / SendGrid REST API (`axios`) | Account verification, course enrollment alerts, reset tokens |
| **Observability & Logging** | `pino` + `pino-http` | Structured JSON log emission |
| **Testing Suite** | Vitest 4 + Supertest 7 | Unit, integration, and end-to-end API testing |
| **Documentation** | `swagger-ui-express` + `swagger-jsdoc` | OpenAPI 3.0 specification generation |

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
    └── certificate-generator.js        # PDF generation utility via pdfkit
```

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

    LESSON ||--o| QUIZ : "links to"
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
        uuid quizId FK_UK
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
  id             String   @id @default(uuid()) @db.Uuid
  userId         String   @unique @map("user_id") @db.Uuid
  currentStreak  Int      @default(0) @map("current_streak")
  longestStreak  Int      @default(0) @map("longest_streak")
  lastActiveDate DateTime @map("last_active_date") @db.Date

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("user_streaks")
}

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
  id           String       @id @default(uuid()) @db.Uuid
  title        String
  slug         String       @unique
  description  String
  subjectId    String       @map("subject_id") @db.Uuid
  instructorId String       @map("instructor_id") @db.Uuid
  level        CourseLevel  @default(BEGINNER)
  price        Decimal      @default(0.00) @db.Decimal(10, 2)
  language     String       @default("English")
  duration     String
  rating       Float        @default(0.0)
  studentCount Int          @default(0) @map("student_count")
  isFeatured   Boolean      @default(false) @map("is_featured")
  isPublished  Boolean      @default(false) @map("is_published")
  requirements Json         @default("[]")
  objectives   Json         @default("[]")
  createdAt    DateTime     @default(now()) @map("created_at")
  updatedAt    DateTime     @updatedAt @map("updated_at")
  deletedAt    DateTime?    @map("deleted_at")

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
  @@index([slug])
  @@map("courses")
}

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
  id          String         @id @default(uuid()) @db.Uuid
  moduleId    String         @map("module_id") @db.Uuid
  title       String
  type        LessonType     @default(TEXT)
  duration    String
  content     String         @db.Text
  videoUrl    String?        @map("video_url")
  codeSnippet String?        @map("code_snippet") @db.Text
  orderIndex  Int            @map("order_index")
  quizId      String?        @unique @map("quiz_id") @db.Uuid
  createdAt   DateTime       @default(now()) @map("created_at")
  updatedAt   DateTime       @updatedAt @map("updated_at")

  module   Module           @relation(fields: [moduleId], references: [id], onDelete: Cascade)
  quiz     Quiz?            @relation("LessonToQuiz", fields: [quizId], references: [id])
  progress LessonProgress[]
  bookmarks Bookmark[]

  @@index([moduleId])
  @@map("lessons")
}

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
  id           String         @id @default(uuid()) @db.Uuid
  courseId     String         @map("course_id") @db.Uuid
  lessonId     String?        @unique @map("lesson_id") @db.Uuid
  title        String
  passingScore Int            @default(70) @map("passing_score")
  createdAt    DateTime       @default(now()) @map("created_at")
  updatedAt    DateTime       @updatedAt @map("updated_at")

  course    Course         @relation(fields: [courseId], references: [id], onDelete: Cascade)
  lesson    Lesson?        @relation("LessonToQuiz")
  questions QuizQuestion[]
  attempts  QuizAttempt[]

  @@index([courseId])
  @@map("quizzes")
}

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

model QuizAttempt {
  id             String   @id @default(uuid()) @db.Uuid
  userId         String   @map("user_id") @db.Uuid
  quizId         String   @map("quiz_id") @db.Uuid
  score          Float
  totalQuestions Int      @map("total_questions")
  answers        Json     // Array of submitted answer indexes
  isPassed       Boolean  @map("is_passed")
  attemptedAt    DateTime @default(now()) @map("attempted_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  quiz Quiz @relation(fields: [quizId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([quizId])
  @@map("quiz_attempts")
}

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

  @@unique([userId, courseId, lessonId])
  @@index([userId])
  @@map("bookmarks")
}

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
  id            String   @id @default(uuid()) @db.Uuid
  name          String   @unique
  description   String
  icon          String
  criteriaType  String   @map("criteria_type")  // COURSES_COMPLETED, QUIZ_PERFECT_SCORE, STREAK_DAYS
  criteriaValue Int      @map("criteria_value")
  createdAt     DateTime @default(now()) @map("created_at")

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

  @@index([userId])
  @@map("notifications")
}

model Certificate {
  id             String   @id @default(uuid()) @db.Uuid
  certificateNo  String   @unique @map("certificate_no")
  userId         String   @map("user_id") @db.Uuid
  courseId       String   @map("course_id") @db.Uuid
  issuedAt       DateTime @default(now()) @map("issued_at")
  certificateUrl String   @map("certificate_url")

  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  course Course @relation(fields: [courseId], references: [id], onDelete: Cascade)

  @@unique([userId, courseId])
  @@index([userId])
  @@map("certificates")
}

model AuditLog {
  id          String   @id @default(uuid()) @db.Uuid
  adminId     String   @map("admin_id") @db.Uuid
  actionType  String   @map("action_type")  // COURSE_APPROVED, COURSE_REJECTED, COURSE_DELETED, USER_BANNED, USER_UNBANNED, ROLE_CHANGED
  targetType  String   @map("target_type")  // COURSE, USER
  targetId    String   @map("target_id") @db.Uuid
  reason      String?
  metadata    Json?    // Additional context
  performedAt DateTime @default(now()) @map("performed_at")

  admin User @relation("AdminAuditLogs", fields: [adminId], references: [id], onDelete: Restrict)

  @@index([adminId])
  @@index([targetId])
  @@index([performedAt])
  @@map("audit_logs")
}
```

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
    participant Cert as PDF & Cert Generator
    participant Email as SendGrid / Brevo Service

    Student->>API: POST /lessons/:id/complete (JWT Auth)
    API->>DB: 1. Verify Active Course Enrollment
    API->>DB: 2. Upsert lesson_progress (is_completed = true)
    API->>DB: 3. Guard: totalLessons > 0, then Calculate (completedLessons / totalLessons) * 100
    API->>DB: 4. Update enrollment progress_percent
    API->>DB: 5. Update user_streaks (increment or reset streak)

    alt Progress == 100%
        API->>DB: Set enrollment.status = COMPLETED
        API->>Cert: Generate Certificate & Unique Cert No.
        API->>DB: Award "Course Master" Achievement Badge
        API->>Email: Dispatch Congratulatory Email & PDF Certificate
    end

    API-->>Student: Return { progressPercent, completedLessons, totalLessons, isCourseCompleted }
```

> [!WARNING]
> **Division-by-Zero Guard:** The progress calculation `(completedLessons / totalLessons) * 100` must guard against `totalLessons = 0`. If a course has zero lessons (edge case during development or data inconsistency), progress defaults to `0.0` and no completion is triggered. This guard must be enforced in the **service layer** (not the controller), and the publishing validation in Section 5.3 (requiring ≥ 1 lesson) acts as a second line of defence at the data-entry stage.

### 5.2 Server-Side Quiz Assessment Engine

To maintain academic integrity, quiz answer keys (`correctAnswerIndex`) are kept isolated on the server and never sent to clients.

```mermaid
sequenceDiagram
    autonumber
    actor Student
    participant API as Express API (/api/v1/quizzes)
    participant DB as PostgreSQL

    Student->>API: GET /quizzes/:id
    API->>DB: Query Quiz & Questions
    API-->>Student: Return Questions + Options (EXCLUDES correctAnswerIndex)

    Student->>API: POST /quizzes/:id/submit { answers: [...] }
    API->>DB: Fetch Questions with correctAnswerIndex
    API->>API: Evaluate Score & Determine Pass/Fail Status
    API->>DB: Store QuizAttempt Record

    opt Quiz Passed & Linked to Lesson
        API->>DB: Trigger Lesson Completion Flow (Progress Engine)
    end

    API-->>Student: Return { attemptId, score, passingScore, isPassed, breakdown }
```

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
> - **Ownership Verification:** Every mutation on `/courses/:id`, `/modules/:id`, or `/lessons/:id` checks that `course.instructorId` matches the authenticated `req.user.id` (or `ADMIN` role override).
> - **Atomic Validation:** Publishing fails with HTTP 422 if the course lacks at least 1 module and 1 playable lesson.
> - **Cache Eviction:** Successful publishing triggers Redis `DEL catalog:courses:*` pattern invalidation so guests immediately see the new course.

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
    API->>API: 3. Sanitize Input & Check Policy (Max Size < 500MB, MIME: video/*, application/pdf)
    API->>Storage: 4. Generate Pre-Signed PUT Upload URL (TTL: 15 mins)
    API-->>Instructor: Return { uploadUrl, fileKey, publicUrl }

    Instructor->>Storage: 5. Direct Binary Upload (HTTP PUT to uploadUrl)
    Storage-->>Instructor: HTTP 200 OK (Uploaded to S3/Cloudinary bucket)

    Instructor->>API: 6. POST /resources/confirm { fileKey, title, category, courseId }
    API->>DB: 7. Create Resource Metadata Record in PostgreSQL
    API-->>Instructor: Return { status: "success", resource: { id, title, fileUrl } }
```

> [!TIP]
> **Direct-to-S3 Upload Security:**
> - Pre-signed URLs expire after **15 minutes**.
> - Upload signatures specify explicit `Content-Type` headers so uploaded files cannot be morphed into executable scripts (e.g. enforcing `video/mp4` or `application/pdf`).

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
        API->>Cache: Invalidate Public Course Catalog Cache (DEL catalog:courses:*)
        API->>Email: Send Takedown Notice & Detailed Reason to Instructor
        API-->>Admin: Return HTTP 200 { status: "UNPUBLISHED" }
    else Soft-Delete Infringing Course
        Admin->>API: 2b. DELETE /admin/courses/:id { reason: "Severe Violation" }
        API->>DB: Set course.deletedAt = now() (Soft-Delete)
        API->>DB: Record AuditLog (COURSE_DELETED)
        API->>Cache: Evict Cache Keys
        API->>Email: Send Removal Notice to Instructor
        API-->>Admin: Return HTTP 200 { status: "DELETED" }
    end
```

> [!IMPORTANT]
> **Moderation Governance & Audit Integrity:**
> - **Soft Deletion:** Courses deleted by Admins use soft-deletion (`deletedAt = timestamp`) to preserve existing enrollment records and student certificate verifications without causing orphan foreign key errors.
> - **Audit Trail:** Every moderation action (unpublishing, deletion) records an entry in the `audit_logs` table tracking `adminId`, `targetId`, `actionType`, and `reason`.

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
    API->>DB: Record AuditLog (ROLE_CHANGED)
    API->>Redis: Invalidate Cached User Profile (DEL user:profile:<id>)
    API-->>Admin: Return Updated User Profile

    opt Account Suspension / Security Ban
        Admin->>API: 2. POST /admin/users/:id/ban { reason: "Terms Violation" }
        API->>DB: Set user.isBanned = true
        API->>DB: Record AuditLog (USER_BANNED)
        API->>Redis: Immediate Purge of Refresh Tokens & Session Keys (DEL session:<id>:*)
        API-->>Admin: Return { status: "BANNED", activeSessionsRevoked: count }
    end
```

> [!CAUTION]
> **Instant Security Session Revocation:**
> When an Admin bans an account, the backend sets `user.isBanned = true` and instantly purges all Redis session keys associated with `session:<userId>:*`, preventing the user from refreshing access across all active web and mobile client sessions. The `isBanned` flag is separate from `deletedAt` soft-deletion, allowing admins to unban accounts later without data loss.

---

## 6. REST API Reference

All API endpoints are prefixed with `/api/v1` and produce standardized JSON envelope structures.

> [!NOTE]
> **Health Check Endpoint:** `GET /health` (unauthenticated, rate-limit bypassed) returns `{ status: "ok", database: "connected", redis: "connected", uptime: <seconds> }`. Used by the Docker `HEALTHCHECK` directive and container orchestrators. See Acceptance Criteria AC-8.

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

### 6.2 Users & Dashboard (`/api/v1/users`)

| Method | Endpoint | Auth Guard | Purpose |
| :--- | :--- | :--- | :--- |
| `GET` | `/users/:id` | Public | Retrieves public instructor/student profile and statistics. |
| `PUT` | `/users/me` | Authenticated | Updates profile bio, full name, and social links. |
| `POST` | `/users/me/avatar` | Authenticated | Uploads avatar to S3/Cloudinary via `multipart/form-data`. |
| `GET` | `/users/me/dashboard` | Authenticated | Aggregates active enrollments, completed courses, streak days, and learning hours. |
| `GET` | `/users/me/achievements` | Authenticated | Lists all earned and in-progress user achievements. |
| `GET` | `/users/me/certificates` | Authenticated | Returns earned certificates with verification links. |

### 6.3 Instructors (`/api/v1/instructors`)

| Method | Endpoint | Auth Guard | Purpose |
| :--- | :--- | :--- | :--- |
| `GET` | `/instructors/me/dashboard` | Instructor | Aggregates total students, published course count, average rating, enrollment trends, and revenue metrics. |
| `GET` | `/instructors/me/courses` | Instructor | Lists all courses owned by the instructor with draft/published status and enrollment counts. |
| `GET` | `/instructors/:id` | Public | Retrieves public instructor profile, bio, rating, and teaching portfolio. |

### 6.4 Subjects & Categories (`/api/v1/subjects`)

| Method | Endpoint | Auth Guard | Purpose |
| :--- | :--- | :--- | :--- |
| `GET` | `/subjects` | Public | Lists all 10 subjects with icon, theme color, and active course counts. |
| `GET` | `/subjects/:slug/courses` | Public | Paginated courses belonging to a specific subject category. |
| `POST` | `/subjects` | Admin | Creates a new subject taxonomy. |

### 6.5 Courses & Curriculum (`/api/v1/courses`, `/api/v1/modules`, `/api/v1/lessons`)

| Method | Endpoint | Auth Guard | Purpose |
| :--- | :--- | :--- | :--- |
| `GET` | `/courses` | Public | Filterable catalog: `?category=&level=&price=&search=&sort=&page=&limit=`. |
| `GET` | `/courses/featured` | Public | Curated featured courses for home page carousel. |
| `GET` | `/courses/:slug` | Public | Full course metadata, objectives, requirements, instructor info, and curriculum. |
| `POST` | `/courses` | Instructor / Admin | Creates a new course draft. |
| `PUT` | `/courses/:id` | Instructor (Owner) / Admin | Updates course metadata, pricing, or publishing status. |
| `DELETE` | `/courses/:id` | Instructor (Owner) / Admin | Soft deletes course (`deletedAt`). |
| `POST` | `/courses/:id/modules` | Instructor (Owner) / Admin | Appends a new module to course curriculum. |
| `PUT` | `/modules/:id` | Instructor (Owner) / Admin | Renames module or updates `orderIndex`. |
| `DELETE` | `/modules/:id` | Instructor (Owner) / Admin | Removes a module and cascades deletion to all its lessons. |
| `POST` | `/modules/:id/lessons` | Instructor (Owner) / Admin | Creates a lesson (Text, Video, Code, or Quiz placeholder). |
| `GET` | `/lessons/:id` | Enrolled / Owner / Admin | Retrieves full lesson content, secure video URL, and code snippets. |
| `PUT` | `/lessons/:id` | Instructor (Owner) / Admin | Updates lesson content and metadata. |
| `DELETE` | `/lessons/:id` | Instructor (Owner) / Admin | Removes a lesson from curriculum. |

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
| `GET` | `/quizzes/:id` | Enrolled / Instructor | Retrieves quiz questions and options (answer keys omitted). |
| `POST` | `/quizzes/:id/submit` | Enrolled Student | Submits answers, scores attempt, records pass/fail, and updates lesson progress. |
| `GET` | `/quizzes/:id/attempts` | Authenticated | Fetches user historical attempts and scores for the specified quiz. |
| `POST` | `/quizzes` | Instructor / Admin | Creates a quiz linked to a course or lesson. |
| `PUT` | `/quizzes/:id` | Instructor (Owner) / Admin | Updates quiz title or `passingScore`. Only permitted if no attempts exist yet. |
| `DELETE` | `/quizzes/:id` | Instructor (Owner) / Admin | Deletes quiz, all its questions, and all attempt records (use with caution). |
| `POST` | `/quizzes/:id/questions` | Instructor / Admin | Adds one or more multiple-choice or true/false questions with answer indexes. |
| `PUT` | `/quizzes/:id/questions/:questionId` | Instructor (Owner) / Admin | Updates question text, options, or correct answer index. |
| `DELETE` | `/quizzes/:id/questions/:questionId` | Instructor (Owner) / Admin | Removes a single question from the quiz. |

### 6.8 Engagement: Resources, Bookmarks, Reviews & Certificates

| Method | Endpoint | Auth Guard | Purpose |
| :--- | :--- | :--- | :--- |
| `GET` | `/resources` | Public | Search and filter downloadable resources by category and file type. |
| `POST` | `/resources` | Instructor / Admin | Uploads resource attachment (PDF, ZIP, DOCX). |
| `DELETE` | `/resources/:id` | Instructor (Owner) / Admin | Deletes resource metadata record and triggers S3/Cloudinary file removal. |
| `POST` | `/bookmarks/toggle` | Authenticated | Toggles bookmark for course or lesson: `{ courseId?, lessonId? }`. |
| `GET` | `/bookmarks` | Authenticated | Lists all saved bookmarks for the current user. |
| `GET` | `/courses/:id/reviews` | Public | Lists student reviews and ratings for a course. |
| `POST` | `/courses/:id/reviews` | Enrolled Student | Submits course review (Rating 1–5 and comment). One review per enrolled student per course. |
| `PUT` | `/courses/:courseId/reviews` | Authenticated (Owner) | Updates the authenticated user's own existing review (rating and/or comment). |
| `DELETE` | `/courses/:courseId/reviews` | Authenticated (Owner) / Admin | Deletes a review. Admins may remove any review for moderation purposes. |
| `GET` | `/certificates/:certificateNo` | Public | Public certificate verification endpoint. |
| `GET` | `/certificates/:id/download` | Authenticated (Owner) | Generates and downloads PDF certificate via `pdfkit`. |

### 6.9 Notifications (`/api/v1/notifications`)

| Method | Endpoint | Auth Guard | Purpose |
| :--- | :--- | :--- | :--- |
| `GET` | `/notifications` | Authenticated | Paginated list of user notifications with unread count. |
| `PATCH` | `/notifications/:id/read` | Authenticated | Marks a single notification as read. |
| `PATCH` | `/notifications/read-all` | Authenticated | Marks all unread notifications as read for the current user. |

### 6.10 Platform Administration (`/api/v1/admin`)

| Method | Endpoint | Auth Guard | Rate Limit | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/admin/courses` | Admin | Standard | Paginated list of all courses with filters (`?isPublished=&search=&sort=`). |
| `PATCH` | `/admin/courses/:id/unpublish` | Admin | 10 req / 15 min | Unpublishes a course with reason; sends takedown notice to instructor. |
| `DELETE` | `/admin/courses/:id` | Admin | 10 req / 15 min | Soft-deletes infringing course content with reason. |
| `GET` | `/admin/users` | Admin | Standard | Paginated user list with role, status, and ban filters. |
| `PATCH` | `/admin/users/:id/role` | Admin | 10 req / 15 min | Updates user role (`STUDENT` / `INSTRUCTOR` / `ADMIN`). |
| `POST` | `/admin/users/:id/ban` | Admin | 10 req / 15 min | Bans user, sets `isBanned = true`, and revokes all active sessions. |
| `POST` | `/admin/users/:id/unban` | Admin | 10 req / 15 min | Unbans user, sets `isBanned = false`, re-enables login. |
| `GET` | `/admin/analytics` | Admin | Standard | Platform-wide metrics (total users, courses, enrollments, revenue). |
| `GET` | `/admin/audit-logs` | Admin | Standard | Paginated query of moderation and governance audit trail. |

---

## 7. Security Architecture

> [!IMPORTANT]
> Security controls must be implemented defense-in-depth across authentication layers, request validation, database access, and HTTP response headers.

| Security Vector | Implementation Standard |
| :--- | :--- |
| **Authentication** | Dual-token authentication: Short-lived JWT access tokens (15 min) in `Authorization` header; long-lived refresh tokens (7 days) in `HttpOnly`, `Secure`, `SameSite=Strict` cookies with Redis-backed session tracking and revocation. |
| **Password Hashing** | `bcryptjs` with salt round cost factor 12. |
| **RBAC Enforcement** | Strict middleware validation matching `UserRole` (`STUDENT`, `INSTRUCTOR`, `ADMIN`) against resource ownership. |
| **Ban Enforcement** | `requireAuth` middleware checks `user.isBanned` on every authenticated request and returns HTTP 403 for banned accounts, even if the JWT is still technically valid. |
| **Rate Limiting** | Tiered rate limiting via `express-rate-limit`: Global API (100 req / 15 min), Auth endpoints (5 req / 15 min), Admin destructive operations (10 req / 15 min), Health probes bypassed. |
| **Input Sanitization** | Strict Zod validation on every route rejecting unescaped inputs or prototype pollution attempts. |
| **Assessment Protection** | Quiz answer keys (`correct_answer_index`) filtered out on all student read queries; grading performed strictly in server memory. |
| **HTTP Hardening** | `helmet` for standard security headers (CSP, HSTS, X-Frame-Options, X-Content-Type-Options). |

---

## 8. Implementation Plan

```text
Phase 1: Foundation (Days 1–4)
├── Database Schema Migration (Prisma models, PostgreSQL setup, seed data)
├── Auth Module (JWT, Refresh Rotation, Password Hashing, Email Verification)
├── RBAC Middleware & Global Error Handlers
├── Subject & Course Catalog CRUD with Zod Validation
└── Notification Model & In-App Notification Dispatch

Phase 2: Curriculum & Assessment Engine (Days 5–8)
├── Module & Lesson Hierarchy Endpoints
├── Enrollment Logic & Atomic Progress Calculation
├── Unenroll / Drop Enrollment Endpoint
├── Quiz Authoring & Secure Server-Side Evaluation Engine
└── S3 / Cloudinary File Upload Integration for Media and Resources

Phase 3: Gamification, Dashboard & Delivery (Days 9–12)
├── Achievement Engine (Streak counters via UserStreak, Badge evaluation)
├── PDF Certificate Generation Pipeline (pdfkit)
├── Student & Instructor Aggregated Dashboard Metrics
├── Transactional Email Integration (SendGrid / Brevo REST)
└── Notification Endpoints (List, Mark Read, Mark All Read)

Phase 4: Admin, Testing & Deployment (Days 13–16)
├── Admin Module: Course Moderation (Unpublish, Soft-Delete with Audit Logs)
├── Admin Module: User Governance (Role Changes, Ban/Unban, Session Revocation)
├── Admin Module: Platform Analytics & Audit Log Query Endpoints
├── Integration & End-to-End Testing Suite (Vitest + Supertest)
└── Production Dockerization & Deployment Configuration
```

---

## 9. Testing Strategy

### 9.1 Test Execution Matrix

```bash
npm run test:unit        # Vitest unit tests (scoring math, token crypto, validators, streak logic)
npm run test:integration # Supertest HTTP integration against test database
npm run test:coverage    # Target: >85% code coverage across services
```

### 9.2 Testing Coverage Breakdown
- **Unit Tests:** Password hashing, token generation/revocation, quiz scoring calculations, course progress percentage formulas, and streak increment/reset logic.
- **Integration Tests:** Full registration → email verification → login → course enrollment → lesson completion → quiz pass → certificate issuance flow.
- **RBAC Tests:** Assert that students cannot create courses or alter curriculum, and instructors cannot modify other instructors' courses.
- **Admin Tests:** Assert that admin can ban users (sessions revoked), unpublish courses (cache invalidated), and that audit logs are recorded for all governance actions.
- **Ban Enforcement Tests:** Assert that banned users receive HTTP 403 on all authenticated endpoints, even with a valid JWT.

---

## 10. Deployment & Infrastructure

### 10.1 Multi-Stage Dockerfile

```dockerfile
# Stage 1: Build & Prisma Generation
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY prisma ./prisma/
RUN npx prisma generate
COPY . .
RUN npm run build --if-present

# Stage 2: Production Runtime
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S nodejs && adduser -S nodeapp -G nodejs
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/src ./src
USER nodeapp
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:5000/health || exit 1
CMD ["node", "src/server.js"]
```

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
PORT=5000
LOG_LEVEL=info
CORS_ORIGIN=https://edusphere.learn

# Database & Cache
DATABASE_URL=postgresql://user:password@localhost:5432/edusphere_db?schema=public
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Security & JWT
JWT_SECRET=super_secure_access_secret_2026
JWT_EXPIRES_IN=15m
JWT_REFRESH_SECRET=super_secure_refresh_secret_2026
JWT_REFRESH_EXPIRES_IN=7d

# Storage & Media
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=us-east-1
AWS_S3_BUCKET=edusphere-media-storage
CLOUDINARY_URL=

# Transactional Email
BREVO_API_KEY=
EMAIL_SENDER=no-reply@edusphere.learn
```

---

## 11. Acceptance Criteria

| ID | Scenario | Verification Criteria |
| :--- | :--- | :--- |
| **AC-1** | User Onboarding | User registers as `STUDENT` or `INSTRUCTOR`, verifies email via token, and logs in to receive valid JWT tokens. |
| **AC-2** | Course Authoring | Instructor creates course draft, adds modules and lessons, and publishes course; published course appears in catalog. |
| **AC-3** | Student Enrollment | Student enrolls in published course; enrollment record initialized with `0.0%` progress. |
| **AC-4** | Progress Tracking | Completing a lesson atomically updates `progress_percent`; completing all lessons marks enrollment `COMPLETED`. |
| **AC-5** | Secure Quiz Scoring | Submitting quiz evaluates answers server-side; returns score and unlocks next lesson without exposing answer keys. |
| **AC-6** | Certificate Issuance | 100% course completion generates unique certificate record with downloadable PDF link. |
| **AC-7** | Role Enforcement | Students attempting `POST /api/v1/courses` receive HTTP 403 Forbidden. |
| **AC-8** | Health Monitoring | `GET /health` returns HTTP 200 with `{ status: "ok", database: "connected", redis: "connected" }`. |
| **AC-9** | Course Moderation | Admin unpublishes a course with reason; course is removed from public catalog; instructor receives takedown notification email. Audit log entry is recorded. |
| **AC-10** | User Account Ban | Admin bans a user; `isBanned` is set to `true`; all active Redis sessions are immediately revoked. Banned user cannot refresh access tokens or access authenticated endpoints. |
| **AC-11** | Role Elevation | Admin promotes a Student to Instructor; user gains immediate access to course authoring endpoints on next request. Audit log entry is recorded. |
| **AC-12** | Enrollment Drop | Student drops enrollment; status is set to `DROPPED`; progress records are preserved for potential re-enrollment. |
| **AC-13** | Notification Delivery | Completing a course triggers an in-app notification and transactional email; notification appears in `GET /notifications` with `isRead: false`. |

---

## 12. Risk Mitigation Strategy

> [!WARNING]
> Mitigations must be proactively enforced during implementation to prevent runtime defects and security breaches.

| Identified Risk | Impact Level | Mitigation Strategy |
| :--- | :--- | :--- |
| **Quiz Answer Leakage** | High | Never return `correct_answer_index` in student-facing quiz APIs. Perform all comparisons exclusively in backend service memory. |
| **Race Conditions in Progress Updates** | Medium | Use database transactions (`prisma.$transaction`) and PostgreSQL row-level locks when updating progress percentages. |
| **Large Media Upload Bottlenecks** | Medium | Utilize direct-to-S3 pre-signed upload URLs so client media bypasses the main API server process. |
| **Session Bloat & Cache Drift** | Low | Implement fixed TTL expiration on all Redis token keys with active session pruning. |
| **Banned User Access Window** | Medium | Check `isBanned` flag in `requireAuth` middleware on every request, not just at login. Combine with immediate Redis session purge on ban. |
| **Audit Log Gaps** | Medium | Wrap all admin governance actions in service-level methods that atomically perform the action and record the audit log entry within the same database transaction. |