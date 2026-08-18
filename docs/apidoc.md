# EduSphere API Documentation & Reference

* **Base URL:** `http://localhost:5000`
* **API Version:** `v1` (Prefix: `/api/v1`)
* **Protocol:** HTTPS (HTTP/1.1 & HTTP/2 supported)
* **TRD Alignment:** 100% Synchronized with [EduTRD.md](file:///c:/Users/DELL/Desktop/myfol/software_devops_ibm/08_Docker_Kubernetes/lab/02_IntroKubernetes/EduTRD.md)
* **Interactive OpenAPI Specs:** Swagger UI available at `http://localhost:5000/api-docs`

---

## Table of Contents

- [1. Overview & Standard Envelopes](#1-overview--standard-envelopes)
- [2. Authentication & Dual-Token Security](#2-authentication--dual-token-security)
- [3. Role-Based Access Control (RBAC)](#3-role-based-access-control-rbac)
- [4. Rate Limiting & Security Policy](#4-rate-limiting--security-policy)
- [5. Error Handling & HTTP Status Catalog](#5-error-handling--http-status-catalog)
- [6. Pagination & Filtering Standard](#6-pagination--filtering-standard)
- [7. System Enums Reference](#7-system-enums-reference)
- [8. API Endpoints Reference](#8-api-endpoints-reference)
  - [8.1 Health Check](#81-health-check)
  - [8.2 Authentication (`/api/v1/auth`)](#82-authentication-apiv1auth) — TRD §6.1
  - [8.3 Users & Learner Dashboard (`/api/v1/users`)](#83-users--learner-dashboard-apiv1users) — TRD §6.2
  - [8.4 Instructors & Teaching Portfolio (`/api/v1/instructors`)](#84-instructors--teaching-portfolio-apiv1instructors) — TRD §6.3
  - [8.5 Subjects & Categories (`/api/v1/subjects`)](#85-subjects--categories-apiv1subjects) — TRD §6.4
  - [8.6 Courses, Modules & Lessons (`/api/v1/courses`, `/api/v1/modules`, `/api/v1/lessons`)](#86-courses-modules--lessons-apiv1courses-apiv1modules-apiv1lessons) — TRD §6.5
  - [8.7 Enrollments & Progress Engine (`/api/v1/enrollments`, `/api/v1/lessons`)](#87-enrollments--progress-engine-apiv1enrollments-apiv1lessons) — TRD §6.6
  - [8.8 Quizzes & Server-Side Assessment Engine (`/api/v1/quizzes`)](#88-quizzes--server-side-assessment-engine-apiv1quizzes) — TRD §6.7
  - [8.9 Engagement: Resources, Direct Uploads, Bookmarks, Reviews & Certificates](#89-engagement-resources-direct-uploads-bookmarks-reviews--certificates) — TRD §5.4 & §6.8
  - [8.10 Notifications (`/api/v1/notifications`)](#810-notifications-apiv1notifications) — TRD §6.9
  - [8.11 Platform Administration & Governance (`/api/v1/admin`)](#811-platform-administration--governance-apiv1admin) — TRD §6.10

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
    "limit": 20,
    "totalItems": 156,
    "totalPages": 8,
    "hasNextPage": true,
    "hasPrevPage": false
  }
}
```

> [!NOTE]
> Binary file downloads (PDF Certificates and raw downloadable resources) bypass the JSON envelope and stream content directly with appropriate `Content-Type` headers (`application/pdf`, `application/octet-stream`).

---

## 2. Authentication & Dual-Token Security

EduSphere implements stateless dual-token JWT authentication as specified in **TRD Section 7**:

1. **Access Tokens:** Short-lived JWTs (TTL: **15 minutes**) passed in the `Authorization` HTTP header:
   ```http
   Authorization: Bearer <accessToken>
   ```
2. **Refresh Tokens:** Long-lived JWTs (TTL: **7 days**) delivered in a secure, `HttpOnly`, `SameSite=Strict` cookie during login/registration.
3. **Session Revocation:** Logout and account suspension (`isBanned = true`) instantly purge and blacklist active Redis session keys (`session:<userId>:*`).

---

## 3. Role-Based Access Control (RBAC)

The system defines 3 persistent database roles (`UserRole`) aligned with **TRD Section 2.3 & Section 4.2**:

| Role | Access Scope & System Capabilities |
| :--- | :--- |
| **`STUDENT`** | Catalog discovery, course enrollment, lesson consumption, quiz submission, badge earning, review authoring, and profile management. |
| **`INSTRUCTOR`** | All `STUDENT` permissions plus course drafting, module/lesson authoring, quiz creation, student enrollment analytics, and review management. |
| **`ADMIN`** | System-wide administrative oversight, role elevation, user banning, post-publication course moderation/unpublishing, soft-deletion, analytics dashboard access, and audit log inspection. |

> [!NOTE]
> **Guest Access:** Unauthenticated users (visitors without a JWT token) have full access to public catalog endpoints (`GET /courses`, `GET /subjects`, `GET /instructors/:id`, `GET /certificates/:certificateNo`).

---

## 4. Rate Limiting & Security Policy

Tiered rate limiting is enforced per client IP address via `express-rate-limit` (matching **TRD Section 7**):

* **Global API Limit:** 100 requests per 15-minute window across general API endpoints.
* **Authentication Endpoints:** 5 requests per 15-minute window (`register`, `login`, `refresh`, `forgot-password`, `reset-password`, `verify-email`).
* **Admin Destructive Operations:** 10 requests per 15-minute window (`unpublish`, `ban`, `unban`, `soft-delete`).
* **Health Probes:** Bypassed for load balancers and container orchestrators (`GET /health`).

Requests exceeding limits return HTTP `429 Too Many Requests` with a `Retry-After` header.

---

## 5. Error Handling & HTTP Status Catalog

| Status Code | Meaning | Cause & Trigger |
| :--- | :--- | :--- |
| **`200 OK`** | Success | Request succeeded and data payload returned. |
| **`201 Created`** | Resource Created | Entity successfully created (User, Course, Module, Enrollment, Attempt). |
| **`400 Bad Request`** | Malformed Payload | Invalid JSON formatting or missing mandatory request headers. |
| **`401 Unauthorized`** | Authentication Failure | Missing, invalid, or expired JWT access token. |
| **`403 Forbidden`** | Permission Denied | Banned user access attempt, insufficient role, or non-owner resource edit attempt. |
| **`404 Not Found`** | Entity Not Found | Target record does not exist in database or has been soft-deleted. |
| **`409 Conflict`** | Unique Constraint Conflict | Email already registered, duplicate enrollment, or duplicate review submission. |
| **`413 Payload Too Large`** | Size Threshold Exceeded | Multipart file upload exceeds maximum size limit (2MB avatar, 10MB file). |
| **`422 Unprocessable`** | Schema Validation Error | Payload failed Zod schema constraints (e.g. course title missing or password weak). |
| **`429 Too Many Requests`** | Rate Limit Quota Exceeded | Client exceeded requests quota for window. |
| **`500 Internal Error`** | Server Operational Error | Unhandled server exception. |

---

## 6. Pagination & Filtering Standard

All catalog and list queries support standardized URL query parameters:

* `page` (integer, default: `1`): Target page number.
* `limit` (integer, default: `20`, max: `100`): Results count per page.
* `search` (string): Case-insensitive text search across titles and descriptions.
* `sort` (string): Field sort modifier (e.g. `newest`, `popular`, `rating`, `price-low`, `price-high`).

---

## 7. System Enums Reference

Exact enum mapping matching **Prisma Data Model (TRD Section 4.2)**:

| Enum Name | Supported Values | Context / Model Usage |
| :--- | :--- | :--- |
| `UserRole` | `STUDENT`, `INSTRUCTOR`, `ADMIN` | User authorization & access tier |
| `CourseLevel` | `BEGINNER`, `INTERMEDIATE`, `ADVANCED`, `ALL_LEVELS` | Course taxonomy & difficulty |
| `LessonType` | `VIDEO`, `TEXT`, `CODE`, `QUIZ` | Lesson content player rendering |
| `EnrollmentStatus` | `ACTIVE`, `COMPLETED`, `DROPPED` | Student course participation lifecycle |
| `QuizQuestionType` | `MULTIPLE_CHOICE`, `TRUE_FALSE` | Assessment question grading logic |
| `NotificationType` | `SYSTEM`, `ENROLLMENT`, `COURSE_UPDATE`, `ACHIEVEMENT`, `CERTIFICATE` | In-app notification categorization |

---

## 8. API Endpoints Reference

### 8.1 Health Check

#### `GET /health`
Check backend server, PostgreSQL database, and Redis cache connectivity.
* **Auth Guard:** Public (Rate limit bypassed)
* **TRD Alignment:** Section 6 & Acceptance Criteria AC-8
* **Response `200 OK`:**
```json
{
  "status": "success",
  "message": "Health check successful",
  "data": {
    "status": "healthy",
    "uptime": 14250,
    "checks": {
      "database": "connected",
      "redis": "connected"
    }
  }
}
```

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
* **Response `200 OK`:** Same structure as register (`data.user` + `data.accessToken`; refresh token delivered in secure `HttpOnly` cookie).
* **Response `401 Unauthorized`:** Invalid credentials or account banned.

---

#### `POST /api/v1/auth/refresh`
Rotate refresh token cookie and issue a fresh access token.
* **Auth Guard:** Public (Valid `refreshToken` Cookie Required)
* **Response `200 OK`:** `{ "status": "success", "data": { "accessToken": "eyJhbG..." } }`

---

#### `POST /api/v1/auth/logout`
Revoke active refresh token session in Redis and clear cookies.
* **Auth Guard:** Authenticated
* **Response `200 OK`:** `{ "status": "success", "message": "Logged out successfully", "data": null }`

---

#### `POST /api/v1/auth/verify-email`
Validate email verification token.
* **Auth Guard:** Public | **Rate Limit:** 5 req / 15 min
* **Body:** `{ "token": "4f9c8d2e-6712-4c91-b3b2-990a8e1b12f4" }`
* **Response `200 OK`:** Email address marked verified (`isEmailVerified = true`).

---

#### `POST /api/v1/auth/forgot-password`
Request password reset token email.
* **Auth Guard:** Public | **Rate Limit:** 5 req / 15 min
* **Body:** `{ "email": "alex@example.com" }`
* **Response `200 OK`:** Reset email dispatched if account exists.

---

#### `POST /api/v1/auth/reset-password`
Reset account password using reset token.
* **Auth Guard:** Public | **Rate Limit:** 5 req / 15 min
* **Body:** `{ "token": "a1b2c3d4...", "newPassword": "BrandNewPassword2026!" }`
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
* **Body:** `file` (image/png, image/jpeg; max size 2MB)
* **Response `200 OK`:** Returns uploaded `avatarUrl`.

---

#### `GET /api/v1/users/me/dashboard`
Aggregated student learning dashboard statistics.
* **Auth Guard:** Authenticated
* **Response `200 OK`:** Enrolled courses, streak days, active progress, and recent achievements.

---

#### `GET /api/v1/users/me/achievements`
List earned and in-progress achievement badges.
* **Auth Guard:** Authenticated
* **Response `200 OK`:** Array of user achievements and earned timestamps.

---

#### `GET /api/v1/users/me/certificates`
List all earned certificates for the authenticated user.
* **Auth Guard:** Authenticated
* **Response `200 OK`:** Array of certificate records with numbers and PDF download links.

---

### 8.4 Instructors & Teaching Portfolio (`/api/v1/instructors`) — TRD §6.3

#### `GET /api/v1/instructors/me/dashboard`
Aggregated instructor metrics dashboard.
* **Auth Guard:** Instructor
* **Response `200 OK`:** Total students taught, active course count, rating, and enrollment trends.

---

#### `GET /api/v1/instructors/me/courses`
Retrieve all courses owned by the authenticated instructor.
* **Auth Guard:** Instructor
* **Response `200 OK`:** Array of course records with `isPublished` draft status and student counts.

---

#### `GET /api/v1/instructors/{id}`
Public instructor profile and published course portfolio.
* **Auth Guard:** Public
* **Response `200 OK`:** Instructor biography, title, rating, student total count, and published courses.

---

### 8.5 Subjects & Categories (`/api/v1/subjects`) — TRD §6.4

#### `GET /api/v1/subjects`
List all subjects with course count metrics.
* **Auth Guard:** Public
* **Response `200 OK`:** Array of 10 subject taxonomies with name, slug, icon, theme color, and active course count.

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

### 8.6 Courses, Modules & Lessons (`/api/v1/courses`, `/api/v1/modules`, `/api/v1/lessons`) — TRD §6.5

#### `GET /api/v1/courses`
Filterable and searchable public course catalog.
* **Auth Guard:** Public
* **Query:** `search`, `category`, `level`, `price`, `sort`, `page`, `limit`
* **Response `200 OK`:** Paginated course list matching query filters.

---

#### `GET /api/v1/courses/featured`
Curated featured courses for home page carousel.
* **Auth Guard:** Public
* **Response `200 OK`:** Array of featured course cards.

---

#### `GET /api/v1/courses/{slug}`
Full course details including curriculum module/lesson hierarchy.
* **Auth Guard:** Public
* **Response `200 OK`:** Course object with nested curriculum structure.

---

#### `POST /api/v1/courses`
Create a new course draft.
* **Auth Guard:** Instructor / Admin
* **Body:** `{ "title": "Modern TypeScript", "subjectId": "sub-101", "description": "Patterns", "level": "INTERMEDIATE", "duration": "6 weeks", "price": "0.00" }`
* **Response `201 Created`:** Created course draft with `isPublished: false`.

---

#### `PUT /api/v1/courses/{id}`
Update course metadata, pricing, or publishing status.
* **Auth Guard:** Instructor (Owner) / Admin
* **Body:** `{ "title": "Updated Title", "price": "19.99", "isPublished": true }`
* **Response `200 OK`:** Updated course object. Self-publishing validates course has ≥1 module & ≥1 lesson.

---

#### `DELETE /api/v1/courses/{id}`
Soft-delete a course (`deletedAt`).
* **Auth Guard:** Instructor (Owner) / Admin
* **Response `200 OK`:** Course soft-deleted (`deletedAt = now()`).

---

#### `POST /api/v1/courses/{id}/modules`
Add a module to course curriculum.
* **Auth Guard:** Instructor (Owner) / Admin
* **Body:** `{ "title": "Module 1: Language Fundamentals", "orderIndex": 1 }`
* **Response `201 Created`:** Created module object.

---

#### `PUT /api/v1/modules/{id}`
Update module title or ordering.
* **Auth Guard:** Instructor (Owner) / Admin
* **Body:** `{ "title": "Module 1: ES6+ Essentials", "orderIndex": 1 }`
* **Response `200 OK`:** Updated module object.

---

#### `DELETE /api/v1/modules/{id}`
Remove a module and cascade deletion to all its lessons.
* **Auth Guard:** Instructor (Owner) / Admin
* **Response `200 OK`:** Module and child lessons deleted.

---

#### `POST /api/v1/modules/{id}/lessons`
Add a lesson to a module.
* **Auth Guard:** Instructor (Owner) / Admin
* **Body:** `{ "title": "Promises & Async", "type": "VIDEO", "duration": "15 min", "content": "Markdown text", "videoUrl": "https://cdn...", "orderIndex": 1 }`
* **Response `201 Created`:** Created lesson record.

---

#### `GET /api/v1/lessons/{id}`
Retrieve full lesson viewer content.
* **Auth Guard:** Authenticated (Enrolled Student, Course Instructor, or Admin)
* **Response `200 OK`:** Lesson content, video URL, code snippets, and navigation pointers.

---

#### `PUT /api/v1/lessons/{id}`
Update lesson content or metadata.
* **Auth Guard:** Instructor (Owner) / Admin
* **Body:** Lesson fields to update.
* **Response `200 OK`:** Updated lesson object.

---

#### `DELETE /api/v1/lessons/{id}`
Remove a lesson from curriculum.
* **Auth Guard:** Instructor (Owner) / Admin
* **Response `200 OK`:** Lesson deleted.

---

### 8.7 Enrollments & Progress Engine (`/api/v1/enrollments`, `/api/v1/lessons`) — TRD §5.1 & §6.6

#### `POST /api/v1/enrollments`
Enroll current student into a course.
* **Auth Guard:** Student
* **Body:** `{ "courseId": "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed" }`
* **Response `201 Created`:** New active enrollment created (`progressPercent: 0.0`).
* **TRD Policy:** On re-enrollment after `DROPPED`, the service reactivates the existing record (`status = ACTIVE`) and restores prior progress history without creating a duplicate record.

---

#### `GET /api/v1/enrollments/me`
List student's active and completed enrollments.
* **Auth Guard:** Authenticated
* **Response `200 OK`:** Array of student enrollments with progress percentages.

---

#### `GET /api/v1/enrollments/{courseId}/progress`
Get granular lesson completion checklist for a course.
* **Auth Guard:** Authenticated (Enrolled Student)
* **Response `200 OK`:** Completed lesson IDs list and calculated progress percentage.

---

#### `POST /api/v1/lessons/{id}/complete`
Mark lesson complete and atomically update course progress percentage.
* **Auth Guard:** Authenticated (Enrolled Student)
* **TRD Guard:** Guards against `totalLessons = 0` (division-by-zero protection).
* **Response `200 OK`:** Recalculated progress percentage and automatic PDF certificate payload if progress reaches 100%.

---

#### `PATCH /api/v1/enrollments/{courseId}/drop`
Drop active course enrollment.
* **Auth Guard:** Authenticated (Enrolled Student)
* **Response `200 OK`:** Sets enrollment status to `DROPPED`. Preserves lesson progress records for future re-enrollment.

---

### 8.8 Quizzes & Server-Side Assessment Engine (`/api/v1/quizzes`) — TRD §5.2 & §6.7

#### `GET /api/v1/quizzes/{id}`
Fetch quiz questions for assessment.
* **Auth Guard:** Authenticated (Enrolled Student, Instructor, or Admin)
* **TRD Protection:** Answer keys (`correctAnswerIndex`) are strictly filtered out and never sent to clients.
* **Response `200 OK`:** Quiz details and questions array with options.

---

#### `POST /api/v1/quizzes/{id}/submit`
Submit student quiz answers for server-side evaluation.
* **Auth Guard:** Authenticated (Enrolled Student)
* **Body:** `{ "answers": [{ "questionId": "q-1", "selectedIndex": 1 }] }`
* **Response `200 OK`:** Calculated score, pass/fail status, passing threshold, and attempt summary.

---

#### `GET /api/v1/quizzes/{id}/attempts`
Retrieve student historical attempts for a quiz.
* **Auth Guard:** Authenticated
* **Response `200 OK`:** Historical attempt scores and pass/fail records.

---

#### `POST /api/v1/quizzes`
Create a quiz linked to a course or lesson.
* **Auth Guard:** Instructor / Admin
* **Body:** `{ "courseId": "1b9d6bcd...", "lessonId": "les-02", "title": "ES6 Quiz", "passingScore": 70 }`
* **Response `201 Created`:** Created quiz object.

---

#### `PUT /api/v1/quizzes/{id}`
Update quiz title or passing score threshold.
* **Auth Guard:** Instructor (Owner) / Admin
* **Body:** `{ "title": "Updated Quiz Title", "passingScore": 80 }`
* **Response `200 OK`:** Updated quiz record.

---

#### `DELETE /api/v1/quizzes/{id}`
Delete a quiz and its questions.
* **Auth Guard:** Instructor (Owner) / Admin
* **Response `200 OK`:** Quiz deleted.

---

#### `POST /api/v1/quizzes/{id}/questions`
Add multiple-choice or true/false questions with answer indexes.
* **Auth Guard:** Instructor / Admin
* **Body:** Questions array with options and `correctAnswerIndex`.
* **Response `201 Created`:** Array of created quiz questions.

---

#### `PUT /api/v1/quizzes/{id}/questions/{questionId}`
Update a specific question text, options, or answer key.
* **Auth Guard:** Instructor (Owner) / Admin
* **Body:** Question update fields.
* **Response `200 OK`:** Updated question record.

---

#### `DELETE /api/v1/quizzes/{id}/questions/{questionId}`
Remove a question from a quiz.
* **Auth Guard:** Instructor (Owner) / Admin
* **Response `200 OK`:** Question removed.

---

### 8.9 Engagement: Resources, Direct Uploads, Bookmarks, Reviews & Certificates — TRD §5.4 & §6.8

#### `POST /api/v1/resources/upload-url`
Generate short-lived S3 / Cloudinary pre-signed PUT upload URL (Bypasses Express API Server memory).
* **Auth Guard:** Instructor / Admin | **TRD Alignment:** Section 5.4
* **Body:** `{ "fileName": "lecture-video.mp4", "fileType": "video/mp4", "fileSize": 157286400, "courseId": "1b9d..." }`
* **Response `200 OK`:**
```json
{
  "status": "success",
  "message": "Upload URL generated successfully",
  "data": {
    "uploadUrl": "https://edusphere-media-storage.s3.amazonaws.com/resources/file-12345.mp4?AWSAccessKeyId=...",
    "fileKey": "resources/file-12345.mp4",
    "publicUrl": "https://cdn.edusphere.learn/resources/file-12345.mp4",
    "expiresInSeconds": 900
  }
}
```

---

#### `POST /api/v1/resources/confirm`
Confirm direct cloud upload and create PostgreSQL resource metadata record.
* **Auth Guard:** Instructor / Admin | **TRD Alignment:** Section 5.4
* **Body:** `{ "fileKey": "resources/file-12345.mp4", "title": "Lecture 1 Video", "category": "Technology", "courseId": "1b9d..." }`
* **Response `201 Created`:** Created resource metadata record.

---

#### `GET /api/v1/resources`
Search downloadable resources.
* **Auth Guard:** Public
* **Query:** `search`, `category`, `fileType`, `page`, `limit`
* **Response `200 OK`:** Paginated resource attachments array.

---

#### `POST /api/v1/resources`
Upload resource attachment metadata directly.
* **Auth Guard:** Instructor / Admin
* **Body:** Resource details payload.
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
* **Body:** `{ "courseId": "1b9d..." }` OR `{ "lessonId": "les-01" }`
* **Response `200 OK`:** `{ "bookmarked": true }` or `{ "bookmarked": false }`.

---

#### `GET /api/v1/bookmarks`
List all saved bookmarks for current user.
* **Auth Guard:** Authenticated
* **Response `200 OK`:** Array of bookmarked courses and lessons.

---

#### `GET /api/v1/courses/{id}/reviews`
Get reviews and ratings for a course.
* **Auth Guard:** Public
* **Response `200 OK`:** Average rating, review breakdown, and comments array.

---

#### `POST /api/v1/courses/{id}/reviews`
Submit course review and rating.
* **Auth Guard:** Authenticated (Enrolled Student)
* **Body:** `{ "rating": 5, "comment": "Great course structure!" }`
* **Response `201 Created`:** Created review record. One review per student per course.

---

#### `PUT /api/v1/courses/{courseId}/reviews`
Edit student's existing review.
* **Auth Guard:** Authenticated (Review Owner)
* **Body:** `{ "rating": 4, "comment": "Updated thoughts on course content." }`
* **Response `200 OK`:** Updated review record.

---

#### `DELETE /api/v1/courses/{courseId}/reviews`
Delete a course review.
* **Auth Guard:** Authenticated (Review Owner) / Admin
* **Response `200 OK`:** Review deleted.

---

#### `GET /api/v1/certificates/{certificateNo}`
Public certificate verification endpoint.
* **Auth Guard:** Public
* **Response `200 OK`:** Certificate validity status, recipient name, course title, and issue date.

---

#### `GET /api/v1/certificates/{id}/download`
Download official PDF certificate.
* **Auth Guard:** Authenticated (Certificate Owner or Admin)
* **Response `200 OK`:** Binary PDF file stream (`Content-Type: application/pdf`).

---

### 8.10 Notifications (`/api/v1/notifications`) — TRD §6.9

#### `GET /api/v1/notifications`
Get user in-app notifications.
* **Auth Guard:** Authenticated
* **Response `200 OK`:** Notifications array with unread count indicator.

---

#### `PATCH /api/v1/notifications/{id}/read`
Mark notification as read.
* **Auth Guard:** Authenticated
* **Response `200 OK`:** Updated notification status.

---

#### `PATCH /api/v1/notifications/read-all`
Mark all unread notifications as read.
* **Auth Guard:** Authenticated
* **Response `200 OK`:** All user notifications marked `isRead: true`.

---

### 8.11 Platform Administration & Governance (`/api/v1/admin`) — TRD §5.5, §5.6 & §6.10

#### `GET /api/v1/admin/courses`
Paginated search across all platform courses.
* **Auth Guard:** Admin
* **Query:** `isPublished`, `search`, `sort`, `page`, `limit`
* **Response `200 OK`:** List of all courses (published, drafts, unlisted).

---

#### `PATCH /api/v1/admin/courses/{id}/unpublish`
Unpublish violating course with reason.
* **Auth Guard:** Admin | **Rate Limit:** 10 req / 15 min | **TRD Alignment:** Section 5.5
* **Body:** `{ "reason": "Content policy violation regarding copyright" }`
* **Response `200 OK`:** Sets `isPublished = false`, invalidates public catalog cache (`DEL catalog:courses:*`), emails instructor, and records `AuditLog` entry.

---

#### `DELETE /api/v1/admin/courses/{id}`
Soft-delete an infringing course.
* **Auth Guard:** Admin | **Rate Limit:** 10 req / 15 min | **TRD Alignment:** Section 5.5
* **Body:** `{ "reason": "Severe policy violation" }`
* **Response `200 OK`:** Soft-deletes course (`deletedAt = now()`) and records `AuditLog`.

---

#### `GET /api/v1/admin/users`
Search and filter platform users.
* **Auth Guard:** Admin
* **Query:** `role`, `isBanned`, `search`, `page`, `limit`
* **Response `200 OK`:** Paginated user list.

---

#### `PATCH /api/v1/admin/users/{id}/role`
Promote or change user role (`STUDENT`, `INSTRUCTOR`, `ADMIN`).
* **Auth Guard:** Admin | **Rate Limit:** 10 req / 15 min
* **Body:** `{ "role": "INSTRUCTOR" }`
* **Response `200 OK`:** Updated user role and `AuditLog` recorded.

---

#### `POST /api/v1/admin/users/{id}/ban`
Ban user account and instantly revoke all active sessions.
* **Auth Guard:** Admin | **Rate Limit:** 10 req / 15 min | **TRD Alignment:** Section 5.6
* **Body:** `{ "reason": "Terms of service violation" }`
* **Response `200 OK`:** Sets `isBanned = true`, purges all Redis session keys (`DEL session:<userId>:*`), and records `AuditLog`.

---

#### `POST /api/v1/admin/users/{id}/unban`
Unban user account.
* **Auth Guard:** Admin | **Rate Limit:** 10 req / 15 min | **TRD Alignment:** Section 5.6
* **Body:** `{ "reason": "Appeal accepted" }`
* **Response `200 OK`:** Sets `isBanned = false` and records `AuditLog`.

---

#### `GET /api/v1/admin/analytics`
System-wide metrics and performance indicators.
* **Auth Guard:** Admin
* **Response `200 OK`:** Total users, total instructors, published courses, total enrollments, certificates issued, and average quiz pass rate.

---

#### `GET /api/v1/admin/audit-logs`
Query governance and moderation audit trail.
* **Auth Guard:** Admin | **TRD Alignment:** Section 5.5 & 5.6
* **Query:** `adminId`, `actionType`, `targetType`, `page`, `limit`
* **Response `200 OK`:** Paginated audit log records containing administrative actions, targets, reasons, and timestamps.