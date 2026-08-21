# EduSphere API Documentation & Reference

* **Base URL (local):** `http://localhost:3000`
* **API Version:** `v1` (Prefix: `/api/v1` — `GET /health` is deliberately outside the prefix)
* **Transport:** HTTP/1.1. TLS is terminated at the load balancer in production; the Node process itself serves plain HTTP.
* **TRD Alignment:** Synchronized with [EduTRD.md](../EduTRD.md) — the TRD is the **source of truth**. Where this document and the TRD disagree, the TRD governs and this file is the defect.
* **Interactive OpenAPI Specs:** Served at `/api-docs` by `swagger-ui-express`, with the spec assembled by `swagger-jsdoc` from route annotations (TRD §3.3). The committed `swagger.json` is currently a stub covering `/health` only — and its health schema omits `database` and `redis`, so it does not yet match §8.1.

> [!IMPORTANT]
> **Port is `3000`, not `5000`.** `.env.example`, `docker-compose.yml`, the `Dockerfile` `EXPOSE`/`HEALTHCHECK`, and TRD §10.2 all specify `3000`. Earlier revisions of this document used `5000` throughout, which made every example URL in it unusable.

---

## Table of Contents

- [1. Overview & Standard Envelopes](#1-overview--standard-envelopes)
- [2. Authentication & Dual-Token Security](#2-authentication--dual-token-security)
- [3. Role-Based Access Control (RBAC)](#3-role-based-access-control-rbac)
- [4. Rate Limiting & Security Policy](#4-rate-limiting--security-policy)
- [5. Error Handling & HTTP Status Catalog](#5-error-handling--http-status-catalog)
- [6. Pagination, Filtering & Path Parameter Standard](#6-pagination-filtering--path-parameter-standard)
- [7. System Enums Reference](#7-system-enums-reference)
- [8. API Endpoints Reference](#8-api-endpoints-reference)
  - [8.1 Health Check](#81-health-check)
  - [8.2 Authentication (`/api/v1/auth`)](#82-authentication-apiv1auth--trd-61) — TRD §6.1
  - [8.3 Users & Learner Dashboard (`/api/v1/users`)](#83-users--learner-dashboard-apiv1users--trd-62) — TRD §6.2
  - [8.4 Instructors & Teaching Portfolio (`/api/v1/instructors`)](#84-instructors--teaching-portfolio-apiv1instructors--trd-63) — TRD §6.3
  - [8.5 Subjects & Categories (`/api/v1/subjects`)](#85-subjects--categories-apiv1subjects--trd-64) — TRD §6.4
  - [8.6 Courses, Modules & Lessons (`/api/v1/courses`, `/api/v1/modules`, `/api/v1/lessons`)](#86-courses-modules--lessons-apiv1courses-apiv1modules-apiv1lessons--trd-65) — TRD §6.5
  - [8.7 Enrollments & Progress Engine (`/api/v1/enrollments`, `/api/v1/lessons`)](#87-enrollments--progress-engine-apiv1enrollments-apiv1lessons--trd-51--66) — TRD §5.1 & §6.6
  - [8.8 Quizzes & Server-Side Assessment Engine (`/api/v1/quizzes`)](#88-quizzes--server-side-assessment-engine-apiv1quizzes--trd-52--67) — TRD §5.2 & §6.7
  - [8.9 Engagement: Resources, Direct Uploads, Bookmarks, Reviews & Certificates](#89-engagement-resources-direct-uploads-bookmarks-reviews--certificates--trd-54--68) — TRD §5.4 & §6.8
  - [8.10 Notifications (`/api/v1/notifications`)](#810-notifications-apiv1notifications--trd-69) — TRD §6.9
  - [8.11 Platform Administration & Governance (`/api/v1/admin`)](#811-platform-administration--governance-apiv1admin--trd-55-56--610) — TRD §5.5, §5.6 & §6.10
  - [8.12 Achievements & Inbound Webhooks](#812-achievements--inbound-webhooks--trd-611) — TRD §6.11

---

## 1. Overview & Standard Envelopes

All JSON endpoints return standardized envelope structures matching **TRD Section 6** to ensure consistent client-side parsing across web and mobile applications.

### Success Envelope Structure
```json
{
  "status": "success",
  "message": "Operation completed successfully",
  "data": {}
}
```

### Error Envelope Structure (Validation Errors)
```json
{
  "status": "error",
  "message": "Validation failed",
  "errors": [
    {
      "field": "email",
      "message": "Invalid email format"
    },
    {
      "field": "password",
      "message": "Password must be at least 8 characters long with uppercase, lowercase, and numbers"
    }
  ]
}
```

### Paginated List Envelope Structure
```json
{
  "status": "success",
  "data": [],
  "pagination": {
    "page": 1,
    "limit": 10,
    "totalItems": 156,
    "totalPages": 16,
    "hasNextPage": true,
    "hasPrevPage": false
  }
}
```

> [!NOTE]
> Binary file downloads (PDF Certificates and raw downloadable resources) bypass the JSON envelope and stream content directly with appropriate `Content-Type` headers (`application/pdf`, `application/octet-stream`).

> [!IMPORTANT]
> **`status` Is a String, Not a Boolean.** Every JSON response carries `status: "success" | "error"`. A `{ success: false }` shape appears nowhere in this API. The global error handler emits the error envelope above and includes a stack trace **only** when `NODE_ENV !== 'production'`. Prisma error codes are mapped before serialization (P2002 → `409`, P2025 → `404`) rather than surfaced raw, since raw Prisma errors leak table and constraint names (TRD §7).

---

## 2. Authentication & Dual-Token Security

EduSphere implements dual-token JWT authentication with Redis-backed session state, as specified in **TRD §7 and §7.1**:

1. **Access Tokens:** Short-lived JWTs (TTL: **15 minutes**, `JWT_ACCESS_EXPIRES_IN`) signed with `JWT_SECRET` and passed in the `Authorization` HTTP header:
   ```http
   Authorization: Bearer <accessToken>
   ```
2. **Refresh Tokens:** Long-lived JWTs (TTL: **7 days**, `JWT_REFRESH_EXPIRES_IN`) signed with a **separate** key, `JWT_REFRESH_SECRET`, and delivered in a cookie flagged `HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth`.
3. **Session Revocation:** Each live refresh token is recorded at `session:<jti>`, and its `jti` is added to the per-user set `session:index:<userId>`. Logout unlinks one key; ban, password reset, and account deletion read the index set and unlink every session the user holds.

> [!CAUTION]
> **`DEL` Does Not Accept Glob Patterns.** Earlier revisions of this document specified `DEL session:<userId>:*` for ban and `DEL catalog:courses:*` for cache invalidation. Redis `DEL` takes **literal keys only** — those calls delete a key *named* `session:<userId>:*`, reply `0`, and revoke nothing, leaving a banned user's sessions live until natural expiry. Session revocation uses the index set (`SMEMBERS` → `UNLINK`); cache invalidation uses `SCAN` + `UNLINK`. `KEYS` is prohibited in request-path code. See TRD §7.1 for the full key namespace.

> [!NOTE]
> **Why the API is not "stateless."** Access-token *verification* is stateless, but authorization is not: `requireAuth` additionally rejects banned and soft-deleted accounts, and refresh depends on Redis session state. A Redis outage therefore degrades authentication — security-critical reads fail **closed** with `503`, cache reads fail **open** to PostgreSQL (TRD §7.1, §12).

**CSRF & CORS.** The refresh cookie is `SameSite=Strict` and path-scoped to `/api/v1/auth`, so no cross-site context can attach it to a state-changing call. Every mutating endpoint authenticates from the `Authorization` header, which browsers never send automatically — so no cookie-only mutation surface exists. `POST /auth/refresh` and `POST /auth/logout` are the only cookie-reading routes and additionally require an `Origin`/`Referer` match against `CORS_ORIGIN`. CORS runs with an explicit origin allow-list and **`credentials: true`**; wildcard `*` is invalid alongside credentials and must never be configured.

---

## 3. Role-Based Access Control (RBAC)

The system defines 3 persistent database roles (`UserRole`) aligned with **TRD §2.3 & §4.2**:

| Role | Access Scope & System Capabilities |
| :--- | :--- |
| **`STUDENT`** | Catalog discovery, course enrollment, lesson consumption, quiz submission, badge earning, review authoring, and profile management. |
| **`INSTRUCTOR`** | All `STUDENT` permissions plus course drafting, module/lesson authoring, quiz creation, and analytics **for courses they own**. Ownership resolves through `Instructor.id`, never `User.id` (TRD §6.5). |
| **`ADMIN`** | System-wide oversight: role elevation, ban/unban, unpublish/republish, soft-delete/restore, review moderation, analytics, and audit log inspection. Bypasses all ownership checks. |

> [!NOTE]
> **Guest Access.** Unauthenticated visitors may read the public catalog: `GET /courses`, `GET /courses/featured`, `GET /courses/{slug}`, `GET /subjects`, `GET /subjects/{slug}/courses`, `GET /instructors/{id}`, `GET /users/{id}`, `GET /resources`, `GET /achievements`, `GET /courses/{courseId}/reviews`, and `GET /certificates/{certificateNo}`.
>
> **Course preview.** `GET /courses/{slug}` returns the full curriculum **outline** (module and lesson titles, ordering, durations) to guests, but lesson **bodies** — `content`, `videoUrl`, `codeSnippet` — only for lessons flagged `isFreePreview = true`. A guest requesting `GET /lessons/{id}` for a non-preview lesson receives `401`; an enrolled student requesting a still-locked lesson receives `423` (TRD §2.3, §5.2).

> [!WARNING]
> **Unverified accounts are gated, not blocked.** A user with `isEmailVerified = false` may log in and browse, but `POST /enrollments`, `POST /courses`, and all quiz submissions return **`403`** until verification completes. Blocking login outright would strand users behind email deliverability; blocking nothing would make the flag decorative (TRD §6.1).

---

## 4. Rate Limiting & Security Policy

Tiered rate limiting is enforced per client IP via `express-rate-limit`, keyed on `req.ip` behind `app.set('trust proxy', 1)` so a single load-balancer address does not throttle the whole user base (**TRD §7**):

* **Global API Limit:** 100 requests per 15-minute window across general API endpoints.
* **Authentication Endpoints:** 5 requests per 15-minute window (`register`, `login`, `refresh`, `forgot-password`, `reset-password`, `verify-email`).
* **Admin Destructive & Governance Operations:** 10 requests per 15-minute window (`unpublish`, `republish`, soft-`delete`, `restore`, `ban`, `unban`, `role`).
* **Health Probes:** Bypassed for load balancers and container orchestrators (`GET /health`).
* **Request Body Size:** capped at `100kb` via `express.json({ limit: '100kb' })`. The `/webhooks/email` route is mounted with `express.raw()` **ahead of** the JSON parser so its signature can be verified over unparsed bytes (§8.12).

Requests exceeding a rate limit return HTTP `429 Too Many Requests` with a `Retry-After` header.

> [!NOTE]
> **`429` has a second, unrelated cause.** `POST /quizzes/{id}/submit` also returns `429` when a student has consumed `Quiz.maxAttempts`. That response carries `attemptsRemaining: 0` and **no** `Retry-After` header — waiting does not grant another attempt (§8.8, TRD §5.2).

---

## 5. Error Handling & HTTP Status Catalog

| Status Code | Meaning | Cause & Trigger |
| :--- | :--- | :--- |
| **`200 OK`** | Success | Request succeeded and data payload returned. |
| **`201 Created`** | Resource Created | Entity successfully created (User, Course, Module, Enrollment, Attempt). |
| **`400 Bad Request`** | Malformed Payload | Invalid JSON formatting or missing mandatory request headers. |
| **`401 Unauthorized`** | Authentication Failure | Missing, invalid, or expired JWT access token; invalid login credentials. |
| **`403 Forbidden`** | Permission Denied | Insufficient role, non-owner resource mutation, **banned or soft-deleted account**, or unverified email on a gated action. |
| **`404 Not Found`** | Entity Not Found | Target record does not exist, has been soft-deleted, or belongs to another user (ownership misses return `404`, not `403`, to avoid confirming existence). |
| **`409 Conflict`** | State or Constraint Conflict | Email already registered, duplicate enrollment or review, deleting a subject still referenced by a course, demoting an instructor who owns published courses, or **mutating a quiz/question once any attempt exists**. |
| **`413 Payload Too Large`** | Size Threshold Exceeded | Avatar multipart upload exceeds **5 MB** (`multer`), or a JSON body exceeds `100kb`. Large media never transits the API — see §8.9. |
| **`422 Unprocessable`** | Schema Validation Error | Payload failed a Zod schema constraint, including cross-field rules (`.strict()` rejects unknown keys; bookmark toggle requires exactly one of `courseId`/`lessonId`). |
| **`423 Locked`** | Lesson Not Yet Unlocked | Enrolled student requested a lesson whose predecessors are incomplete. Response carries `nextAccessibleLessonId` (TRD §5.2). |
| **`429 Too Many Requests`** | Rate Limit **or** Attempt Cap | Client exceeded a request quota for the window, **or** exhausted `Quiz.maxAttempts` on a quiz submission. |
| **`500 Internal Error`** | Server Operational Error | Unhandled server exception. Stack trace included only outside production. |
| **`503 Service Unavailable`** | Dependency Unavailable | Redis unreachable on a security-critical path (session lookup, email verification, password reset). These fail **closed** rather than admitting the request (TRD §7.1). |

---

## 6. Pagination, Filtering & Path Parameter Standard

All catalog and list queries support standardized URL query parameters:

* `page` (integer, default: `1`): Target page number.
* `limit` (integer, default: **`10`**, hard cap **`100`**): Results per page. A request above the cap is **clamped, not rejected** — `?limit=1000000` returns 100 items, not an error and not an unbounded scan.
* `search` (string): Case-insensitive text search across titles and descriptions.
* `sort` (string): Field sort modifier (e.g. `newest`, `popular`, `rating`, `price-low`, `price-high`).

Both `page` and `limit` are coerced and bounds-checked by a shared Zod `paginationSchema` with values from `config/constants.js` (TRD §6).

> [!NOTE]
> **Path Parameter Convention.** Public course reads address the resource by **`{slug}`** (SEO-friendly, stable); every mutation and every nested collection addresses it by **`{id}`** (UUID). Nested parameters are named for their parent — `{courseId}`, `{moduleId}`, `{questionId}` — so a route's own identifier is never ambiguous. This document writes parameters in OpenAPI brace style (`{id}`); the TRD writes the same routes in Express colon style (`:id`). They denote identical paths.

---

## 7. System Enums Reference

Exact enum mapping matching the **Prisma Data Model (TRD §4.2)** — all nine enums:

| Enum Name | Supported Values | Context / Model Usage |
| :--- | :--- | :--- |
| `UserRole` | `STUDENT`, `INSTRUCTOR`, `ADMIN` | User authorization & access tier |
| `CourseLevel` | `BEGINNER`, `INTERMEDIATE`, `ADVANCED`, `ALL_LEVELS` | Course taxonomy & difficulty |
| `LessonType` | `VIDEO`, `TEXT`, `CODE`, `QUIZ` | Lesson content player rendering |
| `EnrollmentStatus` | `ACTIVE`, `COMPLETED`, `DROPPED` | Student course participation lifecycle |
| `QuizQuestionType` | `MULTIPLE_CHOICE`, `TRUE_FALSE` | Assessment question grading logic |
| `NotificationType` | `SYSTEM`, `ENROLLMENT`, `COURSE_UPDATE`, `ACHIEVEMENT`, `CERTIFICATE` | In-app notification categorization |
| `AchievementCriteria` | `COURSES_COMPLETED`, `QUIZ_PERFECT_SCORE`, `STREAK_DAYS`, `LESSONS_COMPLETED` | Achievement evaluation dispatch (§8.12) |
| `AuditActionType` | `COURSE_APPROVED`, `COURSE_REJECTED`, `COURSE_DELETED`, `COURSE_RESTORED`, `COURSE_REPUBLISHED`, `USER_BANNED`, `USER_UNBANNED`, `ROLE_CHANGED`, `REVIEW_DELETED` | `AuditLog.actionType` — governance trail (§8.11) |
| `AuditTargetType` | `COURSE`, `USER`, `REVIEW` | `AuditLog.targetType` |

> [!NOTE]
> `QuizQuestionType` carries cross-field validation beyond the enum itself: `MULTIPLE_CHOICE` requires 2–6 unique options, `TRUE_FALSE` requires exactly `["True", "False"]`, and both require `0 <= correctAnswerIndex < options.length` (TRD §4.2).

---

## 8. API Endpoints Reference

### 8.1 Health Check

#### `GET /health`
Check backend server, PostgreSQL database, and Redis cache connectivity.
* **Auth Guard:** Public (Rate limit bypassed) | **Path:** outside the `/api/v1` prefix
* **TRD Alignment:** §6 preamble & Acceptance Criteria **AC-10**
* **Response `200 OK`:** *(flat, not enveloped — the Docker `HEALTHCHECK` and orchestrator probes read these keys directly)*
```json
{
  "status": "ok",
  "database": "connected",
  "redis": "connected",
  "uptime": 14250
}
```
* **Response `503 Service Unavailable`:** returned when either dependency is unreachable, with the failing key set to `"disconnected"`.

> [!NOTE]
> This endpoint deliberately does **not** use the `{ status, message, data }` envelope from §1. `status: "ok"` is the literal contract asserted by AC-10 and probed by the `Dockerfile` `HEALTHCHECK` directive; wrapping it would break both.

---

### 8.2 Authentication (`/api/v1/auth`) — TRD §6.1

#### `POST /api/v1/auth/register`
Register a new student or instructor account. Default role is `STUDENT`.
* **Auth Guard:** Public | **Rate Limit:** 5 req / 15 min
* **Body:**
```json
{
  "fullName": "Alex Morgan",
  "email": "alex@example.com",
  "password": "SecurePassword123!",
  "role": "STUDENT"
}
```
* **Response `201 Created`:**
```json
{
  "status": "success",
  "message": "Account registered successfully",
  "data": {
    "user": {
      "id": "c7a6e118-2894-4d2b-a5d2-f1d1840e6c01",
      "fullName": "Alex Morgan",
      "email": "alex@example.com",
      "role": "STUDENT",
      "isEmailVerified": false
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```
* **Response `409 Conflict`:** Email address already registered.

---

#### `POST /api/v1/auth/login`
Authenticate user credentials and establish session.
* **Auth Guard:** Public | **Rate Limit:** 5 req / 15 min
* **Body:** `{ "email": "alex@example.com", "password": "SecurePassword123!" }`
* **Response `200 OK`:** Same structure as register (`data.user` + `data.accessToken`; refresh token delivered in the `HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth` cookie).
* **Response `401 Unauthorized`:** Invalid credentials.
* **Response `403 Forbidden`:** Credentials valid but the account is **banned** or **soft-deleted**. Distinct from `401` — the caller proved identity; the account is denied.

---

#### `POST /api/v1/auth/refresh`
Rotate refresh token cookie and issue a fresh access token.
* **Auth Guard:** Public (Valid `refreshToken` Cookie Required) + `Origin`/`Referer` match against `CORS_ORIGIN`
* **Response `200 OK`:** `{ "status": "success", "data": { "accessToken": "eyJhbG..." } }`
* **Response `401 Unauthorized`:** Cookie absent, expired, or its `session:<jti>` key no longer exists in Redis (revoked).
* **Response `503 Service Unavailable`:** Redis unreachable. Fails **closed** — a session that cannot be verified is not honoured.

---

#### `POST /api/v1/auth/logout`
Revoke the active refresh token session in Redis and clear the cookie.
* **Auth Guard:** Authenticated
* **Behaviour:** Unlinks `session:<jti>` and removes that `jti` from `session:index:<userId>`.
* **Response `200 OK`:** `{ "status": "success", "message": "Logged out successfully", "data": null }`

---

#### `POST /api/v1/auth/verify-email`
Validate email verification token.
* **Auth Guard:** Public | **Rate Limit:** 5 req / 15 min
* **Body:** `{ "token": "4f9c8d2e6712c91b3b2990a8e1b12f4..." }` — the raw token from the emailed link.
* **Token store:** Redis `verify:email:<sha256(token)>` → `userId`, TTL **24 h**, single-use. Only the hash is stored, so a Redis dump yields no usable tokens.
* **Response `200 OK`:** Email address marked verified (`isEmailVerified = true`).
* **Response `400 Bad Request`:** Token unknown, already consumed, or expired.
* **Response `503 Service Unavailable`:** Redis unreachable — verification fails closed rather than proceeding unverified.

---

#### `POST /api/v1/auth/forgot-password`
Request password reset token email.
* **Auth Guard:** Public | **Rate Limit:** 5 req / 15 min
* **Body:** `{ "email": "alex@example.com" }`
* **Response `200 OK`:** **Identical** response whether or not the account exists — this endpoint is deliberately not an account-enumeration oracle.

---

#### `POST /api/v1/auth/reset-password`
Reset account password using reset token.
* **Auth Guard:** Public | **Rate Limit:** 5 req / 15 min
* **Body:** `{ "token": "a1b2c3d4...", "newPassword": "BrandNewPassword2026!" }`
* **Token store:** Redis `reset:pw:<sha256(token)>` → `userId`, TTL **15 min**, single-use.
* **Side effect:** revokes **all** of the user's sessions via `session:index:<userId>` — a reset must log out any attacker already holding a refresh token.
* **Response `200 OK`:** Password hash updated.

---

#### `GET /api/v1/auth/me`
Retrieve profile of currently authenticated user.
* **Auth Guard:** Authenticated
* **Response `200 OK`:** Full user profile object.

---

### 8.3 Users & Learner Dashboard (`/api/v1/users`) — TRD §6.2

#### `GET /api/v1/users/{id}`
Fetch public profile of student or instructor.
* **Auth Guard:** Public
* **Response `200 OK`:** Public details, avatar, bio, and associated instructor metrics if applicable.

---

#### `PUT /api/v1/users/me`
Update authenticated user profile information.
* **Auth Guard:** Authenticated
* **Body:** `{ "fullName": "Alex Morgan", "bio": "Software developer & learner" }`
* **Response `200 OK`:** Updated user object.

---

#### `POST /api/v1/users/me/avatar`
Upload user avatar image.
* **Auth Guard:** Authenticated | **Content-Type:** `multipart/form-data`
* **Body:** `file` (`image/*` only; max **5 MB**, `multer` memory storage)
* **Response `200 OK`:** Returns uploaded `avatarUrl`.
* **Response `413 Payload Too Large`:** File exceeds 5 MB.

> [!NOTE]
> This is the **only** route in the API that accepts a file through the Express process. All large media uses the pre-signed direct-upload flow in §8.9; `multer` must never appear in a lesson-media route chain (TRD §5.4).

---

#### `DELETE /api/v1/users/me`
Self-service account deletion (data-subject deletion path).
* **Auth Guard:** Authenticated
* **Behaviour:** **Soft delete with PII anonymization**, not row removal — `deletedAt` is stamped, `email` is rewritten to `deleted-<uuid>@invalid`, `fullName` to `"Deleted User"`, `avatarUrl` and `bio` are cleared, and all sessions are revoked.
* **Retained:** enrollments, quiz attempts, and certificates — they are the basis of other parties' records (instructor analytics, certificate verification) and cascading them away would corrupt aggregate history. Reviews are retained, rendered as authored by "Deleted User".
* **Response `200 OK`:** Account deleted. Subsequent requests bearing the still-valid access token return `403`.
* **TRD Alignment:** §6.2 — releasing the original email address for reuse is deliberate; retaining it would defeat the anonymization.

---

#### `GET /api/v1/users/me/dashboard`
Aggregated student learning dashboard statistics.
* **Auth Guard:** Authenticated
* **Response `200 OK`:** Active enrollments, completed courses, streak days, recent achievements, and total learning hours summed from `Lesson.durationMinutes`.

---

#### `GET /api/v1/users/me/achievements`
List earned and in-progress achievement badges.
* **Auth Guard:** Authenticated
* **Response `200 OK`:** Array of user achievements with `earnedAt`, plus progress toward unearned ones. See §8.12 for the achievement catalog and evaluation model.

---

#### `GET /api/v1/users/me/certificates`
List all earned certificates for the authenticated user.
* **Auth Guard:** Authenticated
* **Response `200 OK`:** Array of certificate records with `certificateNo` and download links. `certificateUrl` is `null` until the PDF is first rendered (§8.9).

---

### 8.4 Instructors & Teaching Portfolio (`/api/v1/instructors`) — TRD §6.3

#### `GET /api/v1/instructors/me/dashboard`
Aggregated instructor metrics dashboard.
* **Auth Guard:** Instructor
* **Response `200 OK`:** Total students taught, active course count, average rating, review count, and enrollment trends.

> [!WARNING]
> **No revenue field.** This dashboard reports **no** monetary figure. The MVP has no payment gateway and no `Transaction` model, so any "revenue" number would be `SUM(course.price × enrollments)` for courses that were given away free — actively misleading to an instructor making pricing decisions. A true `revenue` field returns only in Phase 2 (TRD §6.3).

---

#### `GET /api/v1/instructors/me/courses`
Retrieve all courses owned by the authenticated instructor.
* **Auth Guard:** Instructor
* **Response `200 OK`:** Array of course records with `isPublished` draft status, `publishedAt`, and student counts.

---

#### `GET /api/v1/instructors/{id}`
Public instructor profile and published course portfolio.
* **Auth Guard:** Public
* **Response `200 OK`:** Instructor biography, title, rating, total student count, and published courses.

> [!IMPORTANT]
> **`{id}` here is `Instructor.id`, not `User.id`.** `Course.instructorId` references `Instructor.id`. Every ownership check must resolve the caller's `instructorProfile.id` before comparing; `course.instructorId === req.user.id` compares UUIDs from two different tables and silently denies every legitimate owner (TRD §6.5).

---

### 8.5 Subjects & Categories (`/api/v1/subjects`) — TRD §6.4

#### `GET /api/v1/subjects`
List all subjects with course count metrics.
* **Auth Guard:** Public
* **Response `200 OK`:** Array of live subject taxonomies with name, slug, icon, theme color, and active course count.

> [!NOTE]
> The endpoint returns **however many live subjects exist**. Earlier revisions promised "all 10 subjects"; the count is a property of `seed.js`, not of the API, and `POST /subjects` exists precisely so admins can add more (TRD §6.4).

---

#### `GET /api/v1/subjects/{slug}/courses`
Paginated course list under a specific subject category.
* **Auth Guard:** Public
* **Query:** `page`, `limit`, `sort`
* **Response `200 OK`:** Paginated course array filtered by subject.

---

#### `POST /api/v1/subjects`
Create a new subject category taxonomy.
* **Auth Guard:** Admin
* **Body:** `{ "name": "Artificial Intelligence", "slug": "ai", "icon": "cpu", "color": "#8B5CF6" }`
* **Response `201 Created`:** Created subject object.

---

#### `PUT /api/v1/subjects/{id}`
Update subject name, slug, icon, or color.
* **Auth Guard:** Admin
* **Body:** `{ "name": "AI & Machine Learning", "color": "#7C3AED" }`
* **Response `200 OK`:** Updated subject object.

---

#### `DELETE /api/v1/subjects/{id}`
Delete a subject taxonomy.
* **Auth Guard:** Admin
* **Response `200 OK`:** Subject deleted.
* **Response `409 Conflict`:** One or more courses still reference this subject (`onDelete: Restrict`). Reassign them first.

> [!NOTE]
> `PUT` and `DELETE` are required to make the taxonomy maintainable — with create-only access, a typo in a subject name is permanent (TRD §6.4).

---

### 8.6 Courses, Modules & Lessons (`/api/v1/courses`, `/api/v1/modules`, `/api/v1/lessons`) — TRD §6.5

#### `GET /api/v1/courses`
Filterable and searchable public course catalog.
* **Auth Guard:** Public
* **Query:** `subject`, `level`, `priceMax`, `search`, `sort`, `page`, `limit`
* **Response `200 OK`:** Paginated course list matching query filters.

---

#### `GET /api/v1/courses/featured`
Curated featured courses for home page carousel.
* **Auth Guard:** Public
* **Response `200 OK`:** Array of featured course cards.

> [!CAUTION]
> **Route registration order is load-bearing.** This route must be registered **before** `GET /courses/{slug}`, or Express 5 matches `featured` as a slug value and this endpoint becomes permanently unreachable — failing as a `404` on a route that exists. The same applies to `PATCH /notifications/read-all` before `PATCH /notifications/{id}/read` (§8.10). Both collisions require an integration test (TRD §6).

---

#### `GET /api/v1/courses/{slug}`
Full course details including curriculum module/lesson hierarchy.
* **Auth Guard:** Public
* **Response `200 OK`:** Course object with nested curriculum **outline**. Lesson bodies (`content`, `videoUrl`, `codeSnippet`) are included only for lessons flagged `isFreePreview = true`; all other lessons expose title, type, `durationMinutes`, and ordering only (TRD §2.3).

---

#### `POST /api/v1/courses`
Create a new course draft.
* **Auth Guard:** Instructor / Admin (verified email required)
* **Body:**
```json
{
  "title": "Modern TypeScript",
  "subjectId": "sub-101",
  "description": "Patterns",
  "level": "INTERMEDIATE",
  "price": "0.00"
}
```
* **Response `201 Created`:** Created course draft with `isPublished: false`, `publishedAt: null`, `durationMinutes: 0`.

> [!NOTE]
> **`durationMinutes` is derived, never submitted.** `Course.durationMinutes` is an `Int` recomputed from the sum of its lessons' `durationMinutes` on every lesson mutation. Earlier revisions accepted a free-text `"duration": "6 weeks"`, which cannot be summed, sorted, or filtered — and the learner dashboard's "total learning hours" metric is not computable from it (TRD §4.2).

---

#### `PUT /api/v1/courses/{id}`
Update course metadata, pricing, or publishing status.
* **Auth Guard:** Instructor (Owner) / Admin
* **Body:** `{ "title": "Updated Title", "price": "19.99", "isPublished": true }`
* **Response `200 OK`:** Updated course object.
* **Response `422 Unprocessable`:** Publish attempted with zero live modules or zero live lessons.

> [!IMPORTANT]
> **Publishing is transition-guarded, not merely applied.** The service re-reads `isPublished` **inside** the transaction and acts only on an actual state change: `publishedAt` is stamped exactly once (on the first false→true transition and never overwritten), `subject.courseCount` increments only on that same transition, and a no-op `PUT` with `isPublished: true` on an already-published course changes nothing. Without the guard, repeated calls inflate `courseCount` without bound (TRD §5.3).

---

#### `DELETE /api/v1/courses/{id}`
Soft-delete a course (`deletedAt`).
* **Auth Guard:** Instructor (Owner) / Admin
* **Response `200 OK`:** Course soft-deleted (`deletedAt = now()`). If it was published, `subject.courseCount` is decremented and `isPublished` is forced to `false` in the same transaction.
* **Note:** Already-enrolled students retain access to the course content; it is removed from the public catalog only (TRD §5.5).

---

#### `POST /api/v1/courses/{courseId}/modules`
Add a module to course curriculum.
* **Auth Guard:** Instructor (Owner) / Admin
* **Body:** `{ "title": "Module 1: Language Fundamentals", "orderIndex": 1 }`
* **Response `201 Created`:** Created module object.

---

#### `PUT /api/v1/modules/{id}`
Update module title or ordering.
* **Auth Guard:** Instructor (Owner) / Admin
* **Body:** `{ "title": "Module 1: ES6+ Essentials", "orderIndex": 1 }`
* **Response `200 OK`:** Updated module object. Reordering is transactional — `@@unique([courseId, orderIndex])` means a naive sequential update collides mid-flight.

---

#### `DELETE /api/v1/modules/{id}`
Remove a module and cascade deletion to all its lessons.
* **Auth Guard:** Instructor (Owner) / Admin
* **Response `200 OK`:** Module and child lessons deleted; course duration and `ACTIVE` enrollment progress recalculated.

---

#### `POST /api/v1/modules/{moduleId}/lessons`
Add a lesson to a module.
* **Auth Guard:** Instructor (Owner) / Admin
* **Body:**
```json
{
  "title": "Promises & Async",
  "type": "VIDEO",
  "durationMinutes": 15,
  "content": "Markdown text",
  "videoUrl": "https://cdn...",
  "orderIndex": 1,
  "isFreePreview": false
}
```
* **Response `201 Created`:** Created lesson record. `Course.durationMinutes` is recalculated.
* **Response `409 Conflict`:** `orderIndex` already taken within this module (`@@unique([moduleId, orderIndex])`).

---

#### `GET /api/v1/lessons/{id}`
Retrieve full lesson viewer content.
* **Auth Guard:** Enrolled Student (**unlocked only**) / Instructor (Owner) / Admin / **Public if `isFreePreview`**
* **Response `200 OK`:** Lesson content, video URL, code snippets, and navigation pointers.
* **Response `423 Locked`:** Enrolled student requested a lesson whose predecessors are incomplete. Body carries `nextAccessibleLessonId`.
* **Response `401 Unauthorized`:** Guest requested a non-preview lesson.

> [!IMPORTANT]
> **Sequential unlocking rule (TRD §5.2, AC-5).** Lessons are ordered by the total order `(module.orderIndex, lesson.orderIndex)` across the course. A lesson is accessible when it is the course's first lesson, **or** every preceding lesson in that order has `LessonProgress.isCompleted = true`. A lesson whose linked quiz has not been passed does not count as completed — **except** that a student who has exhausted `maxAttempts` without passing is allowed through with their best score recorded, so a failed quiz never produces an unrecoverable dead-end enrollment. Owners and admins bypass gating entirely.

---

#### `PUT /api/v1/lessons/{id}`
Update lesson content or metadata.
* **Auth Guard:** Instructor (Owner) / Admin
* **Body:** Lesson fields to update.
* **Response `200 OK`:** Updated lesson object; `Course.durationMinutes` recalculated.

---

#### `DELETE /api/v1/lessons/{id}`
Remove a lesson from curriculum.
* **Auth Guard:** Instructor (Owner) / Admin
* **Response `200 OK`:** Lesson deleted; course duration and `ACTIVE` enrollment progress recalculated.

> [!WARNING]
> **Curriculum changes move the progress denominator.** Adding or removing a lesson on a live course changes `progressPercent` for every enrolled student. `ACTIVE` enrollments are recalculated in the same transaction and receive a `COURSE_UPDATE` notification; `COMPLETED` enrollments are **pinned at 100.0 and never demoted**, so an instructor's edit cannot retroactively invalidate an issued certificate (TRD §5.1).

---

### 8.7 Enrollments & Progress Engine (`/api/v1/enrollments`, `/api/v1/lessons`) — TRD §5.1 & §6.6

#### `POST /api/v1/enrollments`
Enroll current student into a course.
* **Auth Guard:** Student (**verified email required**)
* **Body:** `{ "courseId": "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed" }`
* **Response `201 Created`:** New active enrollment created (`progressPercent: 0.0`); `course.studentCount` and `instructor.studentCount` both incremented in the same transaction.
* **Response `403 Forbidden`:** Email not verified (TRD §3).
* **Response `409 Conflict`:** An `ACTIVE` or `COMPLETED` enrollment already exists for this `(userId, courseId)` pair.
* **Response `422 Unprocessable`:** Course is unpublished or soft-deleted.
* **TRD Policy:** On re-enrollment after `DROPPED`, the service reactivates the existing record (`status = ACTIVE`) and restores prior progress history without creating a duplicate record — `@@unique([userId, courseId])` makes a second row impossible, so an `upsert`-style reactivation is the only correct implementation (TRD §6.6).

---

#### `GET /api/v1/enrollments/me`
List student's active and completed enrollments.
* **Auth Guard:** Authenticated
* **Query:** `status` (`ACTIVE` / `COMPLETED` / `DROPPED`), `page`, `limit`
* **Response `200 OK`:** Array of student enrollments with progress percentages.

---

#### `GET /api/v1/enrollments/{courseId}/progress`
Get granular lesson completion checklist for a course.
* **Auth Guard:** Authenticated (Enrolled Student)
* **Response `200 OK`:** Completed lesson IDs list, calculated progress percentage, and `nextAccessibleLessonId` — the pointer a client uses to resume, and the same value returned in a `423` body (§8.6).

---

#### `POST /api/v1/lessons/{id}/complete`
Mark lesson complete and atomically update course progress percentage.
* **Auth Guard:** Authenticated (Enrolled Student)
* **Response `200 OK`:** Recalculated `progressPercent`, and on reaching 100% an enrollment flipped to `COMPLETED` plus a `Certificate` record.
* **Response `423 Locked`:** The lesson is still gated by an incomplete predecessor — completion cannot be used to skip the sequence.

> [!IMPORTANT]
> **One transaction, one row lock, three writes.** Upserting `LessonProgress`, recounting completions, and writing `Enrollment.progressPercent` happen inside a single `$transaction` with a row-level lock on the enrollment. Two concurrent completions without the lock both read the same stale count and the second overwrites the first, permanently under-reporting progress. The denominator is read live and guarded against `totalLessons = 0`, which would otherwise throw on a course whose lessons were all deleted (TRD §5.1).

> [!CAUTION]
> **No PDF is generated here.** Earlier revisions of this document promised an "automatic PDF certificate payload" in this response. Certificate rendering is **lazy**: the completion transaction writes only a `Certificate` row with a unique `certificateNumber` and leaves `certificateUrl` as `null`. The PDF is rendered by `pdfkit` on the first `GET /certificates/{id}/download` (§8.9). Rendering inside the transaction would hold a database lock open for the duration of file I/O and make progress updates fail whenever PDF generation fails (TRD §5.1).

---

#### `PATCH /api/v1/enrollments/{courseId}/drop`
Drop active course enrollment.
* **Auth Guard:** Authenticated (Enrolled Student)
* **Response `200 OK`:** Sets enrollment status to `DROPPED`. Preserves lesson progress records for future re-enrollment.
* **Response `409 Conflict`:** Enrollment is already `COMPLETED` — a completed course cannot be dropped, as that would orphan an issued certificate.

> [!IMPORTANT]
> **Dropping does not decrement any counter.** `Course.studentCount` and `Instructor.studentCount` are **lifetime metrics** — total students ever enrolled and ever taught. They increment on a new enrollment and are never decremented, not on drop and not on soft-delete (TRD §4.2). The corollary is the reactivation guard: a `DROPPED` → `ACTIVE` re-enrollment must **skip** the increment, because that user was already counted the first time. Incrementing on reactivation is the one way this counter can inflate, and it is the case a naive `upsert` gets wrong.

---

### 8.8 Quizzes & Server-Side Assessment Engine (`/api/v1/quizzes`) — TRD §5.2 & §6.7

#### `GET /api/v1/quizzes/{id}`
Fetch quiz questions for assessment.
* **Auth Guard:** Enrolled Student (**unlocked lesson only**) / Instructor (Owner) / Admin
* **Response `200 OK`:** Quiz details, questions array with options, and the caller's attempt budget:
```json
{
  "status": "success",
  "message": "Quiz retrieved successfully",
  "data": {
    "id": "qz-88",
    "title": "ES6 Quiz",
    "passingScore": 70,
    "maxAttempts": 3,
    "attemptsUsed": 2,
    "attemptsRemaining": 1,
    "questions": [
      { "id": "q-1", "questionText": "Which keyword declares a block-scoped binding?", "type": "MULTIPLE_CHOICE", "options": ["var", "let", "function", "with"], "points": 1 }
    ]
  }
}
```
* **Response `423 Locked`:** The quiz's parent lesson is still gated (§8.6).

> [!IMPORTANT]
> **`correctAnswerIndex` never leaves the server.** The answer key is stripped by an explicit Prisma `select` on the question model — not by deleting fields from a fetched object, and not by relying on a serializer. `attemptsUsed` / `attemptsRemaining` are computed per-caller, so this response differs between two students looking at the same quiz.

---

#### `POST /api/v1/quizzes/{id}/submit`
Submit student quiz answers for server-side evaluation.
* **Auth Guard:** Authenticated (Enrolled Student)
* **Body:** `{ "answers": [{ "questionId": "q-1", "selectedIndex": 1 }] }`
* **Response `200 OK`:** Calculated score, pass/fail status, passing threshold, and attempt summary.
* **Response `429 Too Many Requests`:** `maxAttempts` exhausted. Carries `attemptsRemaining: 0` and **no** `Retry-After` header — the limit is permanent, not temporal (§4).

> [!CAUTION]
> **The attempt cap is an anti-oracle control, not a fairness rule.** Scoring is server-side and the answer key is never sent, but the `breakdown` in a submission response tells a student which questions they got wrong. Unlimited attempts turn that into a decision oracle: a student brute-forces one option per submission and reconstructs the entire answer key in `options × questions` attempts. `maxAttempts` (default 3) bounds that. What the response discloses is therefore graduated (TRD §5.2):
>
> | Condition | `score` | `passed` | `breakdown` |
> | :--- | :--- | :--- | :--- |
> | Passed | ✅ | ✅ | ✅ per-question correctness |
> | Failed, attempts remain | ✅ | ✅ | ❌ omitted |
> | Failed, attempts exhausted | ✅ | ✅ | ✅ per-question correctness |
>
> Once no attempts remain there is nothing left to harvest, so the full breakdown becomes a learning aid rather than a leak. Exhausting attempts without passing also **unblocks sequential progression** — the best score is recorded and the next lesson unlocks, so a failed quiz never strands an enrollment (§8.6).

---

#### `GET /api/v1/quizzes/{id}/attempts`
Retrieve historical attempts for a quiz.
* **Auth Guard:** **Authenticated (own attempts only)** / Instructor (Owner) / Admin
* **Query:** `userId` — accepted **only** from the parent course's owner or an `ADMIN`; ignored (not rejected) is not an option, an unauthorized `?userId=` is `403`.
* **Response `200 OK`:** Historical attempt scores and pass/fail records for the scoped user.

> [!WARNING]
> **This route was previously guarded as merely "Authenticated."** That let any logged-in account read any user's attempt history for any quiz — every classmate's scores, and, because attempt records store the submitted `answers` array positionally aligned to questions, a path to reconstructing the answer key from a high-scoring peer's attempt. The service filters on `userId = req.user.id` unconditionally and only widens that filter after confirming course ownership or `ADMIN` (TRD §6.7).

---

#### `POST /api/v1/quizzes`
Create a quiz linked to a course or lesson.
* **Auth Guard:** Instructor (**Owner of the target course**) / Admin
* **Body:** `{ "courseId": "1b9d6bcd...", "lessonId": "les-02", "title": "ES6 Quiz", "passingScore": 70, "maxAttempts": 3 }`
* **Response `201 Created`:** Created quiz object.
* **Response `403 Forbidden`:** Caller does not own the course named in `courseId`.

---

#### `PUT /api/v1/quizzes/{id}`
Update quiz title, passing score threshold, or attempt cap.
* **Auth Guard:** Instructor (Owner) / Admin
* **Body:** `{ "title": "Updated Quiz Title", "passingScore": 80, "maxAttempts": 2 }`
* **Response `200 OK`:** Updated quiz record.
* **Response `409 Conflict`:** One or more attempts already exist — raising `passingScore` after the fact would retroactively fail students who had already passed.

---

#### `DELETE /api/v1/quizzes/{id}`
Delete a quiz and its questions.
* **Auth Guard:** Instructor (Owner) / Admin
* **Response `200 OK`:** Quiz, questions, and attempts deleted.
* **Response `409 Conflict`:** Attempts exist. Override with `?force=true`, which is audited.

---

#### `POST /api/v1/quizzes/{id}/questions`
Add multiple-choice or true/false questions with answer indexes.
* **Auth Guard:** Instructor (**Owner**) / Admin
* **Body:** Questions array with `questionText`, `type`, `options`, `correctAnswerIndex`, `points`.
* **Response `201 Created`:** Array of created quiz questions.
* **Response `409 Conflict`:** Attempts exist — adding a question changes the denominator of every score already recorded.
* **Response `422 Unprocessable`:** `type: "TRUE_FALSE"` with anything other than exactly two options, or `correctAnswerIndex` outside the bounds of `options` (§7).

---

#### `PUT /api/v1/quizzes/{id}/questions/{questionId}`
Update a specific question text, options, or answer key.
* **Auth Guard:** Instructor (Owner) / Admin
* **Body:** Question update fields.
* **Response `200 OK`:** Updated question record.
* **Response `409 Conflict`:** Attempts exist — **except** for a `questionText`-only edit, which is permitted so instructors can still fix a typo without invalidating recorded scores.

---

#### `DELETE /api/v1/quizzes/{id}/questions/{questionId}`
Remove a question from a quiz.
* **Auth Guard:** Instructor (Owner) / Admin
* **Response `200 OK`:** Question removed.
* **Response `409 Conflict`:** Attempts exist.

> [!NOTE]
> **Every quiz route resolves ownership through `quiz.course.instructorId`.** Earlier revisions listed the create and update routes as plain "Instructor / Admin" with no ownership qualifier, which would let any instructor attach a quiz to — or rewrite the passing score of — a competitor's course. Ownership uses the same shared helper as course and lesson mutations (TRD §6.5), and an ownership miss returns `404`, not `403` (§5).

---

### 8.9 Engagement: Resources, Direct Uploads, Bookmarks, Reviews & Certificates — TRD §5.4 & §6.8

#### `POST /api/v1/resources/upload-url`
Generate short-lived S3 / Cloudinary pre-signed PUT upload URL (bypasses the Express process entirely).
* **Auth Guard:** Instructor (**Owner of `courseId`**) / Admin | **TRD Alignment:** §5.4
* **Body:** `{ "fileName": "lecture-video.mp4", "fileType": "video/mp4", "fileSize": 157286400, "courseId": "1b9d..." }`
* **Response `200 OK`:**
```json
{
  "status": "success",
  "message": "Upload URL generated successfully",
  "data": {
    "uploadUrl": "https://edusphere-media-storage.s3.amazonaws.com/staging/file-12345.mp4?AWSAccessKeyId=...",
    "fileKey": "staging/file-12345.mp4",
    "publicUrl": "https://cdn.edusphere.learn/resources/file-12345.mp4",
    "expiresInSeconds": 900
  }
}
```
* **Response `422 Unprocessable`:** `fileSize` exceeds the cap for its type, or `fileType` is outside the allow-list.

> [!IMPORTANT]
> **Limits are enforced when the URL is issued, not when the file arrives.** The API never sees the bytes, so `fileSize` and `fileType` are validated here and then bound into the signature — a client that lies about either produces a signature the storage provider rejects. Caps: **500 MB** for `video/*`, **25 MB** for documents (`application/pdf`, `application/zip`). The URL expires in **900 seconds**. This is a different mechanism from the 5 MB `multer` avatar route in §8.3, which is the only endpoint that streams a file through Node.

---

#### `POST /api/v1/resources/confirm`
Confirm a completed direct upload and persist the metadata record.
* **Auth Guard:** Instructor (**Owner**) / Admin | **TRD Alignment:** §5.4
* **Body:** `{ "fileKey": "staging/file-12345.mp4", "title": "Lecture 1 Video", "category": "Technology", "courseId": "1b9d..." }`
* **Response `201 Created`:** Created resource metadata record with its permanent `fileUrl`.
* **Response `422 Unprocessable`:** The object named by `fileKey` does not exist, or its size/type does not match what was signed.

> [!CAUTION]
> **`confirm` re-verifies the object with `HeadObject` before writing a row.** Trusting the client's word that the upload succeeded produces database rows pointing at objects that were never uploaded — a resource list full of links that 404. The handler issues `HeadObject` on `fileKey`, compares the actual `ContentLength` and `ContentType` against the signed values, then copies the object from `staging/` to its permanent prefix inside the same request.
>
> **Orphan reaping without a worker.** A client that takes an upload URL and never calls `confirm` leaves an unreferenced object behind. There is no job queue in this architecture (TRD §3.3), so the bucket carries a **lifecycle rule expiring anything under `staging/` after 24 hours**. Expiry is storage-side by design — it stays reliable when the API is down.

---

#### `GET /api/v1/resources`
Search downloadable resources.
* **Auth Guard:** Public
* **Query:** `search`, `category`, `fileType`, `page`, `limit`
* **Response `200 OK`:** Paginated resource attachments array.

---

#### `POST /api/v1/resources`
Register metadata for an already-hosted file (no binary transfer).
* **Auth Guard:** Instructor (Owner) / Admin
* **Body:** `{ "title": "Reading List", "fileUrl": "https://cdn...", "fileType": "application/pdf", "category": "Technology", "courseId": "1b9d..." }`
* **Response `201 Created`:** Created resource record.

---

#### `DELETE /api/v1/resources/{id}`
Delete resource attachment.
* **Auth Guard:** Instructor (Owner) / Admin
* **Response `200 OK`:** Deletes resource metadata and triggers cloud storage file removal.

---

#### `POST /api/v1/bookmarks/toggle`
Toggle bookmark on a course or lesson.
* **Auth Guard:** Authenticated
* **Body:** `{ "courseId": "1b9d..." }` **xor** `{ "lessonId": "les-01" }` — exactly one
* **Response `200 OK`:** `{ "bookmarked": true }` or `{ "bookmarked": false }` — the resulting state, so the client never has to guess which way the toggle went.
* **Response `422 Unprocessable`:** Both keys supplied, or neither. Enforced by a Zod `.refine()`; a bookmark pointing at both a course and a lesson has no meaning, and the two **partial** unique indexes backing this table assume the discriminated shape (TRD §4.2).

---

#### `GET /api/v1/bookmarks`
List all saved bookmarks for current user.
* **Auth Guard:** Authenticated
* **Response `200 OK`:** Array of bookmarked courses and lessons.

---

#### `GET /api/v1/courses/{courseId}/reviews`
Get reviews and ratings for a course.
* **Auth Guard:** Public
* **Response `200 OK`:** Average rating, review breakdown, and comments array.

---

#### `POST /api/v1/courses/{courseId}/reviews`
Submit course review and rating.
* **Auth Guard:** Authenticated (Enrolled Student)
* **Body:** `{ "rating": 5, "comment": "Great course structure!" }`
* **Response `201 Created`:** Created review record; `Course.rating` recalculated.
* **Response `409 Conflict`:** The caller already reviewed this course (`@@unique([userId, courseId])`).

---

#### `PUT /api/v1/reviews/{id}`
Edit the caller's own review.
* **Auth Guard:** Authenticated (Review Owner)
* **Body:** `{ "rating": 4, "comment": "Updated thoughts on course content." }`
* **Response `200 OK`:** Updated review record; `Course.rating` recalculated.

---

#### `DELETE /api/v1/reviews/{id}`
Delete a review.
* **Auth Guard:** Authenticated (Review Owner) / **Admin (any review)**
* **Response `200 OK`:** Review deleted; `Course.rating` recalculated. Admin deletions write an `AuditLog` entry (`REVIEW_DELETED`).

> [!WARNING]
> **Reviews are addressed by their own `{id}` on mutation — this changed.** Earlier revisions routed edits and deletions as `PUT|DELETE /courses/{courseId}/reviews`, identifying the target implicitly by `(caller, courseId)` through the unique constraint. That shape works for an owner editing their own review and is **structurally incapable** of expressing admin moderation: an admin calling it could only ever delete *their own* review of that course, which almost certainly does not exist. The documented permission "Admins may remove any review" was therefore unreachable code. One route now serves both cases (TRD §6.8).

---

#### `GET /api/v1/certificates/{certificateNo}`
Public certificate verification endpoint.
* **Auth Guard:** Public
* **Response `200 OK`:** Certificate validity status, recipient name, course title, and issue date. Returns the recipient's name and nothing else about the account — this URL is printed on certificates and is expected to be resolved by strangers.

---

#### `GET /api/v1/certificates/{id}/download`
Download official PDF certificate.
* **Auth Guard:** Authenticated (Certificate Owner)
* **Response `200 OK`:** Binary PDF stream (`Content-Type: application/pdf`).

> [!NOTE]
> **First call renders, later calls stream.** If `certificateUrl` is `null`, this handler generates the PDF with `pdfkit`, stores it, writes the URL back to the row, and then streams it — so the first download is slower than subsequent ones. Rendering is deliberately *not* part of the lesson-completion transaction (§8.7): a PDF failure there would roll back the student's progress. The consequence is that a `Certificate` row can exist with `certificateUrl: null`, and clients must treat that as "not yet rendered," never as "not issued" (TRD §5.1).

---

### 8.10 Notifications (`/api/v1/notifications`) — TRD §6.9

#### `GET /api/v1/notifications`
Get user in-app notifications.
* **Auth Guard:** Authenticated
* **Query:** `isRead` (`true` / `false`), `page`, `limit`
* **Response `200 OK`:** Notifications array plus an `unreadCount` field. Served by `@@index([userId, createdAt])`.

---

#### `PATCH /api/v1/notifications/read-all`
Mark all unread notifications as read.
* **Auth Guard:** Authenticated
* **Response `200 OK`:** All the caller's notifications marked `isRead: true`, with the number affected.

> [!CAUTION]
> **Register this route before `/{id}/read`.** Express 5 matches in registration order, so if the parameterised route is mounted first, `read-all` is captured as an `{id}` value and this endpoint becomes unreachable — surfacing as a `404` on a route that demonstrably exists. Same hazard as `GET /courses/featured` (§8.6); both need an integration test that asserts the literal path resolves.

---

#### `PATCH /api/v1/notifications/{id}/read`
Mark a single notification as read.
* **Auth Guard:** Authenticated (Owner)
* **Response `200 OK`:** Updated notification.
* **Response `404 Not Found`:** The row does not exist **or** belongs to another user — deliberately indistinguishable.

> [!NOTE]
> **Ownership is enforced by the `WHERE` clause, not a post-hoc check.** Every notification read and mutation is scoped `where: { id, userId: req.user.id }` rather than fetching by `id` and comparing afterwards. A miss then naturally yields `404`, which is also the correct disclosure posture: an attacker enumerating notification IDs learns nothing about which ones exist on other accounts (TRD §6.9).

---

### 8.11 Platform Administration & Governance (`/api/v1/admin`) — TRD §5.5, §5.6 & §6.10

#### `GET /api/v1/admin/courses`
Paginated search across all platform courses.
* **Auth Guard:** Admin
* **Query:** `isPublished`, `deleted`, `search`, `sort`, `page`, `limit`
* **Response `200 OK`:** All courses — published, drafts, and **soft-deleted**. This is the only surface that can see `deletedAt IS NOT NULL` rows, and therefore the only way an admin can find a course in order to restore it.

---

#### `PATCH /api/v1/admin/courses/{id}/unpublish`
Unpublish a violating course with a reason.
* **Auth Guard:** Admin | **Rate Limit:** 10 req / 15 min | **TRD Alignment:** §5.5
* **Body:** `{ "reason": "Content policy violation regarding copyright" }`
* **Response `200 OK`:** Sets `isPublished = false`, decrements `subject.courseCount`, invalidates the public catalog cache, emails the instructor with the `reason` verbatim, and writes an `AuditLog` row with `actionType = COURSE_REJECTED` — the `AuditActionType` member that covers takedown (§4.4). There is no `COURSE_UNPUBLISHED` member; writing one raises a Prisma enum error inside the governance transaction and rolls the takedown back.

> [!CAUTION]
> **Catalog invalidation is `SCAN` + `UNLINK`, never `DEL catalog:courses:*`.** Earlier revisions of this document specified the latter. Redis `DEL` accepts **literal keys only** — a glob is treated as a key name that happens to contain `*`, so the command returns `0`, reports success, and deletes nothing. The catalog then serves the taken-down course from cache until the TTL lapses. The correct implementation iterates the keyspace non-blockingly:
> ```js
> let cursor = '0';
> do {
>   const [next, keys] = await redis.scan(cursor, 'MATCH', 'catalog:courses:*', 'COUNT', 100);
>   cursor = next;
>   if (keys.length) await redis.unlink(...keys);
> } while (cursor !== '0');
> ```
> `KEYS` is prohibited in request paths — it is O(N) and blocks the single-threaded server (TRD §7.1).

---

#### `PATCH /api/v1/admin/courses/{id}/republish`
Reverse a takedown.
* **Auth Guard:** Admin | **Rate Limit:** 10 req / 15 min | **TRD Alignment:** §5.5
* **Body:** `{ "reason": "Appeal accepted — content amended" }`
* **Response `200 OK`:** Sets `isPublished = true`, re-increments `subject.courseCount`, invalidates the catalog cache, notifies the instructor, writes `AuditLog` (`COURSE_REPUBLISHED`).

---

#### `DELETE /api/v1/admin/courses/{id}`
Soft-delete an infringing course.
* **Auth Guard:** Admin | **Rate Limit:** 10 req / 15 min | **TRD Alignment:** §5.5
* **Body:** `{ "reason": "Severe policy violation" }`
* **Response `200 OK`:** Sets `deletedAt = now()`, forces `isPublished = false`, decrements `subject.courseCount`, writes `AuditLog` (`COURSE_DELETED`). Enrolled students retain content access (TRD §5.5).

---

#### `PATCH /api/v1/admin/courses/{id}/restore`
Restore a soft-deleted course.
* **Auth Guard:** Admin | **Rate Limit:** 10 req / 15 min | **TRD Alignment:** §5.5
* **Body:** `{ "reason": "Deleted in error" }`
* **Response `200 OK`:** Clears `deletedAt`, returning the course to an **unpublished draft**. Restore never re-publishes implicitly — republishing is a separate, separately-audited decision.

---

#### `GET /api/v1/admin/users`
Search and filter platform users.
* **Auth Guard:** Admin
* **Query:** `role`, `isBanned`, `deleted`, `search`, `page`, `limit`
* **Response `200 OK`:** Paginated user list.

---

#### `PATCH /api/v1/admin/users/{id}/role`
Promote or change a user's role (`STUDENT`, `INSTRUCTOR`, `ADMIN`).
* **Auth Guard:** Admin | **Rate Limit:** 10 req / 15 min
* **Body:** `{ "role": "INSTRUCTOR" }`
* **Response `200 OK`:** Updated role, `AuditLog` written with `actionType = ROLE_CHANGED` (the enum member is `ROLE_CHANGED`, not `USER_ROLE_CHANGED` — see §4.4). Promotion to `INSTRUCTOR` **auto-creates the `Instructor` profile row** in the same transaction — without it the user holds a role whose every endpoint fails on a missing profile.
* **Response `409 Conflict`:** Demoting an instructor who owns published courses. Override with `?force=true`, which unpublishes those courses and audits each one (TRD §5.6).

---

#### `POST /api/v1/admin/users/{id}/ban`
Ban a user account and instantly revoke all active sessions.
* **Auth Guard:** Admin | **Rate Limit:** 10 req / 15 min | **TRD Alignment:** §5.6
* **Body:** `{ "reason": "Terms of service violation" }`
* **Response `200 OK`:** Sets `isBanned = true`, revokes every session via the per-user index set, writes `user:state:<id>`, records `AuditLog` (`USER_BANNED`).

> [!IMPORTANT]
> **Session revocation reads the index set — it does not guess key names.** Sessions are stored as `session:<jti>`, keyed by token ID, so no glob over `session:*` can select one user's sessions. The per-user set `session:index:<userId>` exists for exactly this operation:
> ```js
> const jtis = await redis.smembers(`session:index:${userId}`);
> if (jtis.length) await redis.unlink(...jtis.map(j => `session:${j}`));
> await redis.unlink(`session:index:${userId}`);
> ```
> This is O(sessions-for-this-user), not O(keyspace). Earlier revisions specified `DEL session:<userId>:*` — a glob that Redis does not expand and a key pattern that does not exist, so the ban would leave every one of the banned user's access tokens valid until natural expiry. The `user:state:<id>` write closes the remaining 15-minute window by making the auth middleware's per-request state check fail immediately (TRD §7.1, AC-13).

---

#### `POST /api/v1/admin/users/{id}/unban`
Unban a user account.
* **Auth Guard:** Admin | **Rate Limit:** 10 req / 15 min | **TRD Alignment:** §5.6
* **Body:** `{ "reason": "Appeal accepted" }`
* **Response `200 OK`:** Sets `isBanned = false`, clears `user:state:<id>`, re-enables login, writes `AuditLog` (`USER_UNBANNED`).

---

#### `GET /api/v1/admin/analytics`
Platform-wide metrics.
* **Auth Guard:** Admin
* **Response `200 OK`:** Total users, total instructors, published courses, total enrollments, completions, certificates issued, average quiz pass rate, and `grossMerchandiseValue`.

> [!WARNING]
> **`grossMerchandiseValue`, not `revenue`.** The figure reported is the summed `Course.price` of paid enrollments. The MVP records no transactions, refunds, discounts, or payouts (TRD §6.3), so a field labelled *revenue* would be a number that reconciles against nothing while inviting exactly the finance-grade trust it cannot support. The rename is the control.

---

#### `GET /api/v1/admin/audit-logs`
Query the governance and moderation audit trail.
* **Auth Guard:** Admin | **TRD Alignment:** §5.5 & §5.6
* **Query:** `adminId`, `actionType`, `targetType`, `page`, `limit`
* **Response `200 OK`:** Paginated audit records with admin, action, target, reason, and timestamp.

> [!NOTE]
> **Every moderation action is reversible and audited.** Unpublish/republish, delete/restore, ban/unban, and role changes each have an explicit inverse on this surface, and each writes a row keyed by the `AuditActionType` enum (§7). Earlier revisions specified only the destructive half of each pair, which left a mistaken takedown with no remedy short of a manual `UPDATE` against production. The `reason` string is mandatory on every destructive call, persisted in the audit row, and echoed verbatim to the affected instructor — a takedown is never silent (TRD §6.10).

---

### 8.12 Achievements & Inbound Webhooks — TRD §6.11

#### `GET /api/v1/achievements`
List the achievement catalog.
* **Auth Guard:** Public
* **Response `200 OK`:** Array of achievement definitions (`title`, `description`, `icon`, `criteriaType`, `criteriaValue`).

---

#### `GET /api/v1/users/me/achievements`
The caller's earned achievements.
* **Auth Guard:** Authenticated
* **Response `200 OK`:** Earned achievements with `earnedAt`, plus progress toward unearned ones.
* **Note:** Documented in §8.3 as part of the user surface and listed here for completeness — **one path, not two.**

---

#### `POST /api/v1/admin/achievements`
Create an achievement definition.
* **Auth Guard:** Admin
* **Body:** `{ "title": "Fast Learner", "description": "Complete 10 lessons", "icon": "bolt", "criteriaType": "LESSONS_COMPLETED", "criteriaValue": 10 }`
* **Response `201 Created`:** Created definition.
* **Response `422 Unprocessable`:** `criteriaType` is not a member of `AchievementCriteria` (§7).

---

#### `PUT /api/v1/admin/achievements/{id}`
Update an achievement definition.
* **Auth Guard:** Admin
* **Response `200 OK`:** Updated definition. Raising `criteriaValue` does **not** retroactively revoke `UserAchievement` rows already earned under the old threshold.

---

#### `DELETE /api/v1/admin/achievements/{id}`
Delete an achievement definition.
* **Auth Guard:** Admin
* **Response `200 OK`:** Definition deleted; its `UserAchievement` rows cascade.

> [!IMPORTANT]
> **There is no endpoint that grants an achievement to a user.** Awards are *evaluated*, not assigned: `achievement.service.js` runs at exactly three trigger points — lesson completion, quiz submission, course completion — and tests every catalog row whose `criteriaType` is relevant to that event against the user's current counters. The write is `createMany({ skipDuplicates: true })` under `@@unique([userId, achievementId])`, which makes evaluation idempotent — replaying a trigger cannot double-award, and a newly-seeded achievement is picked up on the user's next qualifying action with no backfill job (TRD §6.11).

---

#### `POST /api/v1/webhooks/email`
Ingest email delivery events from the provider (`delivered`, `bounce`, `spam`, `dropped`).
* **Auth Guard:** **Provider signature** — not public, not JWT
* **Body:** Provider-defined event array (raw)
* **Response `200 OK`:** Events recorded; hard bounces mark the address undeliverable.
* **Response `401 Unauthorized`:** Signature verification failed.

> [!CAUTION]
> **This route needs `express.raw()` mounted before the global `express.json()`.** Signature verification runs over the **raw, unparsed** body — SendGrid's ECDSA `X-Twilio-Email-Event-Webhook-Signature` or Brevo's shared-secret HMAC. Re-serializing a parsed JSON object produces a different byte sequence (key order, whitespace, number formatting), so a signature computed over `JSON.stringify(req.body)` can never match and the endpoint would reject every legitimate call while accepting nothing. It is the one route on the platform authenticated by neither session nor public access (TRD §6.11).