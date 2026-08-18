# Contributing to EduSphere Backend

Thank you for contributing to the EduSphere backend platform! This guide outlines the development environment setup, architectural patterns, coding conventions, and pull request workflow.

---

## Getting Started

### 1. Fork and Clone

```bash
git clone https://github.com/<your-username>/edusphere-backend.git
cd edusphere-backend
git remote add upstream https://github.com/EduSphere/edusphere-backend.git

```

### 2. Install Dependencies

```bash
npm install

```

This installs all dependencies and executes `prisma generate` via the `prepare` lifecycle hook.

### 3. Start Infrastructure Services

```bash
cp .env.example .env
docker compose up -d
npm run migrate
npm run dev

```

### 4. Verify Tests and Code Style

```bash
npm run lint
npm run test:run

```

---

## Branch Strategy

EduSphere uses a **feature branch workflow** with `dev` serving as the core integration branch.

| Branch | Purpose |
| --- | --- |
| `main` | Production-ready, deployed application code.

 |
| `dev` | Active development integration branch; all PRs target here.

 |
| `feat/<name>` | New features, modules, or domain endpoints.

 |
| `fix/<name>` | Bug fixes and patch corrections.

 |
| `chore/<name>` | Tooling, database migrations, CI/CD, documentation.

 |

### Branch Creation

```bash
git checkout dev
git pull upstream dev
git checkout -b feat/quiz-assessment-engine

```

---

## Pull Request Workflow

1. **Branch out** from the latest `dev` branch.


2. **Commit changes** in focused, granular increments.


3. **Execute linting and automated tests** locally (`npm run lint && npm run test:run`).


4. **Push your branch** and open a PR against `dev`.


5. **Complete the PR template** describing changes, motivation, and verification steps.


6. **Request reviews** from designated module maintainers.


7. **Address feedback** by pushing commits to the same branch.


8. **Merge** following approval and green CI status.



### PR Title Format

Follow the Conventional Commits specification:

```
feat: implement atomic lesson completion and progress recalculation
fix: prevent quiz answer key leakage on student question fetch
chore: update Prisma schema with certificate model
docs: update OpenAPI swagger documentation for courses

```

---

## Code Conventions

### Module Structure

Every functional module under `src/modules/<module>/` adheres to strict separation of concerns:

```
src/modules/<module>/
├── <module>.controller.js   # HTTP transport, parameter parsing, response dispatch
├── <module>.service.js      # Business logic, Prisma transactions, AppError throws
├── <module>.routes.js       # Express Router, Swagger JSDoc, route middleware
└── <module>.schema.js       # Zod validation schemas for body, query, and params

```

### ES Modules

The project uses ECMAScript Modules (`"type": "module"` in `package.json`). Always use standard `import`/`export` syntax.

```js
// Correct
import { prisma } from "../database/index.js";
export async function getCourseBySlug(slug) { ... }

// Incorrect
const prisma = require("../database/index");
module.exports = { getCourseBySlug };

```

### Relative Path Extensions

Relative imports must always include the `.js` file extension:

```js
import { AppError } from "../utils/app-error.js"; // Correct
import { AppError } from "../utils/app-error";    // Incorrect

```

### Centralized Barrel Imports

Use the barrel export from `config/index.js` for environment variables and system messages:

```js
import { env, logger, systemMessages } from "../config/index.js";

```

### Comments & JSDoc Standards

Place 1–3 line explanatory comments above complex business logic explaining the *intent*. Use JSDoc annotations on all exported service methods:

```js
/**
 * Evaluates submitted quiz answers, records the attempt, and updates lesson progress.
 *
 * 1. Queries authoritative question answer keys from PostgreSQL.
 * 2. Computes percentage score against quiz passingScore.
 * 3. Atomically marks the lesson complete if passed.
 *
 * @param {string} userId - UUID of the authenticated student
 * @param {string} quizId - UUID of the quiz being attempted
 * @param {Array<{questionId: string, selectedIndex: number}>} answers - User submitted options
 * @returns {Promise<Object>} Attempt summary with score and pass/fail boolean
 * @throws {NotFoundError} If the quiz or questions do not exist
 */
export async function submitQuizAttempt(userId, quizId, answers) { ... }

```

### Controller / Service Separation

Controllers handle HTTP concerns (request extraction, response codes). **Services must never reference `req` or `res**`; they throw `AppError` subclasses which controllers forward via `next(err)`.

```js
// Controller: thin handler
export async function completeLesson(req, res, next) {
  try {
    const result = await enrollmentService.markLessonComplete(req.user.id, req.params.id);
    res.status(200).json(success(result, systemMessages.SUCCESS.LESSON.COMPLETED));
  } catch (err) {
    next(err);
  }
}

// Service: pure business logic
export async function markLessonComplete(userId, lessonId) {
  const enrollment = await prisma.enrollment.findFirst({ ... });
  if (!enrollment) throw new NotFoundError("Active enrollment not found");
  // Transactional progress recalculation
  return updatedProgress;
}

```

### Route Middleware Ordering

Protected route handlers must apply middleware in this exact sequence:

```
validate(schema) → requireAuth → requireRole("ROLE") → controller
```

```js
router.post(
  "/courses",
  validate(createCourseSchema),
  requireAuth,
  requireRole("INSTRUCTOR", "ADMIN"),
  courseController.createCourse
);

```

### Standardized Response Formatting

Always format responses using `success()` or `created()` builders from `utils/api-response.js`:

```js
import { success, created } from "../utils/api-response.js";

res.json(success(course, "Course retrieved successfully"));
res.status(201).json(created(newModule, "Module added to curriculum"));

```

### Database & Prisma Conventions

* Mapped table columns use `snake_case` in PostgreSQL via `@map`; application entities use `camelCase`.


* Soft deletes (`deletedAt`) are required on primary content models (`User`, `Course`).


* Indexes must be defined on all foreign keys, lookup slugs, and filtered status columns.



```prisma
model Course {
  id           String    @id @default(uuid()) @db.Uuid
  title        String
  slug         String    @unique
  subjectId    String    @map("subject_id") @db.Uuid
  deletedAt    DateTime? @map("deleted_at")

  @@index([subjectId])
  @@index([slug])
  @@map("courses")
}

```

### Non-Blocking Side Effects

Transactional emails (SendGrid / Brevo), achievement evaluations, and in-app notifications must never block primary HTTP responses. Execute them asynchronously via fire-and-forget patterns:

```js
// Correct: Non-blocking notification dispatch
emailService.sendEnrollmentConfirmation(user.email, course.title).catch(err => {
  logger.error({ err }, "Failed to deliver enrollment email");
});

// Incorrect: Blocking thread execution
await emailService.sendEnrollmentConfirmation(user.email, course.title);

```

### Security Standards

* **Secrets:** Never commit secrets or `.env` files; validate environment schemas via `config/env.js`.


* **Quiz Integrity:** `correctAnswerIndex` must be explicitly excluded from all student-facing quiz responses; evaluate scores server-side only.


* **Role Tampering:** Roles are validated server-side; ignore client-supplied `role` values unless elevated by an Admin.


* **Media Uploads:** Restrict Multer file uploads by MIME-type (`image/jpeg`, `image/png`, `application/pdf`) and enforce size limits (2 MB for avatars, 10 MB for course resources).


* **Parameterized Queries:** Rely on Prisma ORM to escape query variables; never interpolate strings in raw SQL.


* **Generic Client Errors:** Mask internal database errors and stack traces in production responses.



---

## Testing Standards

* Write unit tests alongside modules or inside `src/modules/**/tests/`.


* Integration tests run against isolated PostgreSQL and Redis test containers.


* Use **Vitest** for the test runner and **Supertest** for HTTP endpoint testing.



```bash
npm test                 # Run tests in watch mode
npm run test:run         # Single execution run across full test suite
npm run test:coverage    # Generate code coverage matrix (target >85%)

```

---

## Code Review Checklist

Reviewers must ensure every PR satisfies the following criteria before merging:

* [ ] Route middleware adheres to: `validate(schema) → requireAuth → requireRole → controller`.


* [ ] Controllers delegate to services; no direct `req`/`res` manipulation inside services.


* [ ] Quiz questions strip `correctAnswerIndex` on student-facing routes.


* [ ] Database changes include Prisma migrations and proper index coverage.


* [ ] Side effects (emails, badges, notifications) are non-blocking.


* [ ] User-facing strings originate from `system_messages.js`.


* [ ] Automated unit and integration tests pass cleanly with sufficient coverage.