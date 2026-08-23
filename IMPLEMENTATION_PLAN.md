# EduSphere Backend — Implementation Plan

| Field | Value |
| :--- | :--- |
| **Project** | EduSphere E-Learning & Assessment Platform Backend |
| **Timeline** | 16 Working Days (4 Phases × 4 Days) |
| **Team Model** | Solo / Small-Team Backend Development |
| **Source of Truth** | [EduTRD.md](./EduTRD.md) governs. [apidoc.md](./docs/apidoc.md) is the endpoint contract; [ARCHITECTURE.md](./ARCHITECTURE.md) is the structural reference. Where this plan and the TRD disagree, the TRD wins and this file is the defect. |
| **Branch Strategy** | Feature branches (`feat/<name>`) off `dev`; PRs into `dev`; `main` is production ([CONTRIBUTING.md](./CONTRIBUTING.md)) |
| **Date** | August 2026 |

---

## Executive Overview

This document expands the four-phase roadmap in [TRD §8](./EduTRD.md) into a daily engineering plan: explicit deliverables, dependency chains, verification checkpoints, and the specific defects each task exists to prevent.

The plan follows a **bottom-up construction** approach: infrastructure and security primitives first (Phase 1), domain-critical business logic on top (Phases 2–3), then administrative tooling, automated testing, and production hardening (Phase 4).

> [!NOTE]
> **Guiding Principle:** Every phase ends with a functional, testable vertical slice. No phase leaves behind dead code, unconnected routes, or migrations that haven't been verified against seed data.

> [!IMPORTANT]
> **Task detail is calibrated to failure cost, not to task size.** Tasks carrying a documented failure mode — atomicity, answer-key isolation, session revocation, counter drift — state the mechanism and the consequence of getting it wrong. Routine CRUD is left terse deliberately. A uniform level of detail would bury the four or five decisions that actually determine whether this system is correct.

---

## Day 0 — Specification Reconciliation (Preflight, ~2 hours)

The repository already contains a scaffold: `src/database/schema.prisma` (20 models), `package.json`, `Dockerfile`, `docker-compose.yml`, `vitest.config.js`, and a `src/` tree of empty module files. That scaffold predates the current TRD and disagrees with it in **fourteen** measurable places, and the specification itself carries two internal conflicts that must be settled before any code depends on either reading (0.12–0.13). **Reconcile before writing any feature code** — every one of these is cheap now and expensive after the code that depends on it exists.

> [!NOTE]
> **Status: every row is applied.** The configuration rows landed first — 0.1, 0.2, 0.7, 0.8, 0.8a, 0.8b, 0.9, 0.10, 0.11, 0.11a, and both spec conflicts (0.12 in the TRD and apidoc, 0.13 in TRD §4.2). The schema rows — **0.3, 0.4, 0.5, 0.6, and the schema half of 0.13** — were deliberately deferred to task **1.4**, which has since landed them in the initial migration.
>
> That overlap was deliberate and 1.4 was the right place for it. Applying them here would have meant editing `schema.prisma` twice and running `migrate dev` against a schema Day 1 then rewrites, and the four hand-written statements of 1.4a have to land in the *same* migration as the columns they constrain — 0.3–0.6 in isolation produce a migration that 1.4 cannot cleanly extend. Read 0.3–0.6 as the acceptance criteria for 1.4, not as work preceding it. The one thing the two rows must not do is disagree: 1.4 says 20 models and 9 enums, and so does 0.3.
>
> Three of the rows above (**0.8a, 0.8b, 0.11a**) were **not** in the original table and were found by applying it. All three are the same class — a repository-level defect that breaks the CI gate or pollutes the tree, with no feature code to blame it on later. Two of them, 0.8a and 0.8b, are consecutive `ci.yml` gates: on the current `HEAD` the lint step and the test step both fail, in that order, on a push containing no application code at all.

| # | Artifact | Current state | Required by TRD | Consequence if skipped |
| :--- | :--- | :--- | :--- | :--- |
| 0.1 | `package.json` `"prisma"` key | Absent | `{ "schema": "src/database/schema.prisma", "seed": "node src/database/seed.js" }` — **both** keys, per the block in [TRD §3.4](./EduTRD.md) | Without `schema`, every `prisma` CLI call — validate, generate, migrate, CI `migrate deploy` — exits 1 with "Could not find Prisma Schema", having checked only `./schema.prisma` and `./prisma/schema.prisma` (§3.4). Without `seed`, nothing errors: `prisma db seed` exits **0** printing nothing, and `prisma migrate reset` drops and re-migrates the database and then seeds nothing — an empty schema that looks successfully migrated |
| 0.2 | `Dockerfile` | Diverges from [TRD §10.1](./EduTRD.md) in **six** places — see the reconciliation table below | Rewrite against the §10.1 three-stage block | The image cannot be built at all (two `COPY` calls name a nonexistent `prisma/` directory), and the image is built **only** by `cd.yml` after CI passes on `main` — so all six defects sit invisible behind a green CI and surface in the deploy pipeline (§10.1) |
| 0.3 | Enums in `schema.prisma` | 6 | 9 — add `AchievementCriteria`, `AuditActionType`, `AuditTargetType` | Achievement dispatch and audit rows fall back to free-text that silently fails to match (§4.2) |
| 0.4 | `Lesson` model | No `isFreePreview` | `isFreePreview Boolean @default(false)` | Course preview (§2.3) and the public branch of `GET /lessons/:id` are unimplementable |
| 0.5 | `Lesson` / `Course` | No `durationMinutes` | `durationMinutes Int` on both | Dashboard "total learning hours" (§4.2) is not computable |
| 0.6 | `Quiz` model | No `maxAttempts` | `maxAttempts Int?` — **nullable**, exactly as [TRD §4.2](./EduTRD.md) declares it. `NULL` means unlimited and is permitted only for ungraded practice quizzes not linked to a lesson (§4.2). The default of **3** is a *seed* value (task 1.5), not a column `@default()` | The anti-oracle attempt cap (§5.2) has nowhere to live. A non-nullable `Int @default(3)` is worse than absent: it silently caps the practice quizzes the TRD exempts, and it makes "unlimited" unrepresentable |
| 0.7 | Dependencies | Missing 6 | `cookie-parser`, `axios`, `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `cloudinary`, `@vitest/coverage-v8` | Cookie refresh, email, pre-signed uploads, and the coverage gate are all unimplementable (§3.3) |
| 0.8 | `package.json` scripts | `test`, `test:watch` | Add the four named in [TRD §9.1](./EduTRD.md) — `test:unit`, `test:integration`, `test:coverage`, `db:reconcile` — plus `test:run` and `db:deploy` | `.github/workflows/ci.yml` invokes `npm run test:run`, which does not exist; the test job fails on an npm resolution error before a single assertion runs |
| 0.8a | `package.json` `lint` script | `eslint src/ --ext .js` | `eslint src/ tests/` | **Not drift — the script does not run at all.** ESLint 8.57.1 auto-detects the flat `eslint.config.js` this repo ships, and under flat config `--ext` is not a valid flag: the command exits with `Invalid option '--ext' - perhaps you meant '-c'?` and lints nothing. `ci.yml` runs `npm run lint` as a gate *before* the test step, so the first push to `dev` goes red on lint with zero feature code in the repository — and the message names an ESLint flag, which reads like a rule misconfiguration rather than a config-format one. Flat config makes file selection the config's job, so the flag is removed rather than corrected. `tests/` is added to the target list because 0.8b puts linted code there and Day 15 fills it — a gate that skips the test tree has a hole from the first day it exists |
| 0.8b | Test suite population | Zero `*.test.js` files anywhere | At least one real spec | **`ci.yml`'s test step fails today.** An empty Vitest 4 run exits **1** (`No test files found, exiting with code 1`), and `ci.yml` gates on `npm run test:run` — so the first push is red for a reason unrelated to the code being pushed. The fix is not `--passWithNoTests`: that flag would permanently delete the exact guard the risk register asks for (see the CAUTION under Verification). Landed instead as `tests/unit/swagger-health-contract.test.js`, which asserts 0.11's contract — set-equality on the four keys across both `200` and `503`, `security: []`, and the server override — so the suite is non-empty because something real is being checked |
| 0.9 | `vitest.config.js` | `include: ['src/**/*.test.js']` | `include: ['src/**/*.test.js', 'tests/{unit,integration}/**/*.test.js']` | The entire `tests/` tree is never collected; the suite reports green having run nothing from it (§9.1) |
| 0.10 | `.env.example` **and** `ci.yml` env block | Two files, disagreeing on names **and** on shape | Both reconciled to the [TRD §10.2](./EduTRD.md) matrix — see the table below | `src/config/env.js` (Day 2) validates one set of names through Zod. Whichever file it is written against, the other environment fails `process.exit(1)` at boot — and the CI failure looks like a code defect, not a config one |
| 0.11 | `swagger.json` health schema | `{ status, uptime }`; `bearerAuth` inherited from the root `security`; path resolved against the `/api/v1` server | `{ status, database, redis, uptime }` on **`200` and `503`**, `security: []` on the operation, and a path-level `servers` override at `http://localhost:3000` | Three defects past the two missing keys. The inherited root `security` publishes a rate-limit-exempt public probe as an authenticated endpoint; `/health` is deliberately *outside* the `/api/v1` prefix (apidoc §8.1), so under the root server the documented URL is `/api/v1/health`, which is not the path the `Dockerfile` `HEALTHCHECK` or any orchestrator probes; and with no `503` documented, the response that matters operationally — which dependency died — is undocumented |
| 0.11a | `.gitignore` | No `coverage/` entry | Add `coverage/` | `npm run test:coverage` — a script this plan mandates (0.8) and the Day 16 gate runs — writes the v8 html/json reporters to `./coverage`, a dozen untracked files in the repository root. Nothing fails; they simply get committed by the first `git add .` after the coverage gate lands |
| 0.12 | Catalog cache prefix | The specification says both: `cache:courses:*` in [TRD §7.1](./EduTRD.md), AC-11, and §9.1; `catalog:courses:*` in TRD §5.3, §5.5, and apidoc §8.11 | **`cache:`** wins — §7.1 is the declared owner of the Redis namespace, and the other three sites have been corrected to match | The two prefixes are not synonyms to Redis. Writes land under one and `SCAN`-based invalidation sweeps the other, so a taken-down course is served from cache for its full TTL while the invalidation reports success (§7.1) |
| 0.13 | `Notification` delivery state | Model declared no column for it, while §6.11 requires the webhook to record delivery events and flag dead mailboxes | `Notification.deliveryState String?` + `deliveredAt DateTime?`, and `User.emailBounced Boolean @default(false)` — now added to [TRD §4.2](./EduTRD.md) | Task 11.6 is unimplementable: the webhook verifies a signature, parses an event, and has nowhere to write it. The §2.4 success metric ("≥ 95% verification delivery") stays unmeasurable and hard-bounced addresses are retried forever |

**Task 0.1 — what the `"prisma"` key does and does not prove:**

The two keys are both declarative path registrations, and they fail in completely different ways. `schema` fails **loudly**: remove it and `prisma validate` exits 1 with `Could not find Prisma Schema`, naming the two default locations it checked. `seed` fails **silently**: remove it and `prisma db seed` exits 0 having printed nothing whatsoever — no warning, no "no seed command configured", no non-zero status. Only `schema` has a real proof available on Day 0, and `prisma validate` is it: a green validate loads, parses, and type-checks 20 models, so the path resolved.

> [!CAUTION]
> **Neither state of the `seed` key produces an error, so neither can be detected by exit code.** Absent, `prisma db seed` exits 0 silently. Present but pointing at the current 0-byte `src/database/seed.js`, it exits 0 printing `The seed command has been executed` — the CLI spawns the configured command and propagates its status without inspecting what happened. That message is a statement about process spawning, not about data. Three consequences: the `seed` key can be verified as *wired* on Day 0 only by reading that message, never by a status check; it cannot be verified as *working* until task 1.5 writes the script; and once 1.5 exists, `seed.js` must let failures **throw**, because a caught-and-logged error also exits 0 and `migrate reset` will then report a fully seeded reset of an empty database.

> [!NOTE]
> **CI reaches the seed by a second path that bypasses this key entirely.** `ci.yml` runs `npm run db:seed`, which invokes `node src/database/seed.js` directly and never consults `"prisma"` — so that step passes identically with or without 0.1 and is not a check on it. `prisma migrate reset` is the consumer that depends on the key, it is not run in CI, and its skip is the silent one. Do not read a green CI seed step as evidence that 0.1 landed.

**Task 0.2 — Dockerfile reconciliation:**
| # | Committed `Dockerfile` | Required | Effect if left |
| :--- | :--- | :--- | :--- |
| 1 | `:8` `COPY prisma ./prisma/` | `COPY src/database/schema.prisma ./src/database/schema.prisma` | `COPY` of a path absent from the build context is a **hard build failure**, not a warning |
| 2 | `:28` `COPY --from=builder /app/prisma ./prisma` | Delete the line | The same nonexistent path a second time — fixing `:8` alone still fails. Deletion, not correction: `:27` already copies `/app/src`, which now holds both the schema and `src/database/migrations/` |
| 3 | No user directive | `addgroup -S nodejs && adduser -S nodeapp -G nodejs` + `USER nodeapp` | The container runs as **root** |
| 4 | No healthcheck | `HEALTHCHECK` against `http://localhost:3000/health` | No liveness signal, and `/health` (AC-10) goes unprobed by the thing meant to consume it. Port **3000** throughout — a probe on the wrong port marks a working container permanently `unhealthy`, which an orchestrator resolves by killing and restarting it forever |
| 5 | `:34` `CMD ["npm", "start"]` | `CMD ["node", "src/server.js"]` | npm as PID 1 does not forward `SIGTERM`, so graceful shutdown never runs and the runtime `SIGKILL`s the container after the grace period |
| 6 | `:25` copies the full `node_modules` | `npm ci --omit=dev` in a dedicated deps stage | Vitest, Supertest, ESLint, and Prettier ship to production |

Also reorder: run `npm ci` **before** copying the schema. Copying first invalidates the dependency layer on every schema edit — and Days 1–2 edit the schema constantly.

> [!NOTE]
> **Six here, four in TRD §10.1 — the two lists have different baselines and both are right.** §10.1's CAUTION enumerates defects in the *previous* revision of the file, which is why it names a healthcheck probing port 5000 and a `RUN npm run build --if-present` line. Neither appears in the currently committed `Dockerfile`: it has no healthcheck at all and no build step. The table above is against `HEAD`, line numbers included. Reconcile by count and you will go looking for a `build --if-present` that is not there; reconcile against the §10.1 three-stage block, which is the authority both lists point at.

> [!NOTE]
> **Three stages, and `node_modules` assembled from two of them.** The `deps` stage produces a tree that never contained a devDependency (row 6); `prisma generate` cannot run there because the prisma CLI *is* a devDependency, so generation happens in `builder` and only its output is carried forward. That output is **`node_modules/.prisma/client`** — not `node_modules/@prisma/client`, despite what the CLI prints on success. `@prisma/client` is the stock package holding no schema-specific code; its `default.js` does `require('.prisma/client/default')`. The runtime needs the package from `deps` and the generated client from `builder`, and because the schema declares no `binaryTargets` the query engine is compiled for whatever platform `generate` ran on — so all three stages must stay on the **same base image** ([TRD §10.1](./EduTRD.md)).

> [!CAUTION]
> **`docker build` succeeding does not prove the runtime stage works.** A three-stage build assembles `node_modules` from two different stages, and a missing generated client or a devDependency-only import fails at **import** time, not at build time — the image builds clean and the container exits on its first request. The gate added to `pr-validation.yml` therefore runs the built image and asserts three things the build cannot: `@prisma/client` imports and exposes `PrismaClient`, `id -un` is `nodeapp`, and none of `vitest`/`supertest`/`eslint`/`prettier` exist under `/app/node_modules`.

**Task 0.10 — Environment contract reconciliation:**

[TRD §10.2](./EduTRD.md) is the single source of truth; `.env.example` and `ci.yml` are both consumers and neither is authoritative. They fail in opposite ways — `.env.example` carries 12 of the matrix's 25 variables under the right names, `ci.yml` carries nearly all of them under the wrong ones.

`.env.example` — **add thirteen**, change nothing:

| Add | Why |
| :--- | :--- |
| `JWT_REFRESH_SECRET` | Without it the refresh token gets signed with the access key, collapsing the two-key design (§7) |
| `LOG_LEVEL`, `CORS_ORIGIN`, `FRONTEND_URL`, `SWAGGER_ENABLED` | Defined in §10.2; `FRONTEND_URL` and `SWAGGER_ENABLED` newly promoted there from `ci.yml` |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_S3_BUCKET` | The file offers only the Cloudinary branch, so `STORAGE_PROVIDER=s3` has no credentials to read |
| `EMAIL_FROM_NAME`, `EMAIL_WEBHOOK_SECRET` | Sender display name (§10.2) and webhook HMAC key (§6.11) |
| `DATABASE_URL_TEST`, `REDIS_URL_TEST` | Read by the Day 15 test setup |

`ci.yml` env block — **four renames, four drops, six additions** (`PORT` excluded; already applied):

| # | Current | Canonical | Note |
| :--- | :--- | :--- | :--- |
| 1 | `REDIS_HOST` + `REDIS_PORT` + `REDIS_PASSWORD` + `REDIS_DATABASE` | `REDIS_URL: redis://localhost:6379` | Four variables collapse to one. `ioredis` takes the URL natively and it carries auth, TLS, and logical DB |
| 2 | `JWT_EXPIRES_IN` | `JWT_ACCESS_EXPIRES_IN` | The name §10.2 resolved to |
| 3 | `BREVO_API_KEY` | `EMAIL_API_KEY` | A `BREVO_`-prefixed name defeats the `EMAIL_PROVIDER` switch it sits next to |
| 4 | `BREVO_SENDER_EMAIL` | `EMAIL_FROM` | " |
| 5 | `BREVO_SENDER_NAME` | `EMAIL_FROM_NAME` | " |
| 6 | *absent* | `EMAIL_PROVIDER`, `STORAGE_PROVIDER` | The provider switches themselves, so the CI run exercises a declared branch rather than a default |
| 7 | *absent* | `EMAIL_WEBHOOK_SECRET` | The Day 11 webhook signature test cannot construct an HMAC without it |
| 8 | *absent* | `DATABASE_URL_TEST`, `REDIS_URL_TEST` | **Sharpest of these.** Day 15 test setup reads these names; CI supplies only `DATABASE_URL`, so integration tests resolve `undefined` |
| 9 | `PORT: 5000` | `PORT: 3000` | Already applied during the §10.1 port reconciliation |
| 10 | *absent* | `CLOUDINARY_URL` — **deliberately still absent** | The one matrix variable CI should not carry. It is conditionally required: `STORAGE_PROVIDER=s3` needs the `AWS_*` four and `STORAGE_PROVIDER=cloudinary` needs this one, and no environment needs both. Recorded here so its absence reads as a decision rather than one more oversight |

> [!IMPORTANT]
> **The conditional pair is a `src/config/env.js` requirement, not a documentation footnote.** A Zod schema that marks `CLOUDINARY_URL` and the four `AWS_*` keys all required cannot validate any real environment; one that marks all five optional accepts a deployment whose selected provider has no credentials and fails on the first upload. It must branch on `STORAGE_PROVIDER` — `z.discriminatedUnion` or a `.superRefine` — so the CI environment above passes with the `s3` branch populated and a `cloudinary` deployment missing `CLOUDINARY_URL` dies at boot ([TRD §10.2](./EduTRD.md)).

> [!CAUTION]
> **`DATABASE_URL_TEST` resolving to `undefined` is worse than a crash.** A test setup that reads it and falls back to `DATABASE_URL` — the ordinary, forgiving pattern — points the suite at whatever database the surrounding environment named, then truncates tables between suites. In CI that is the throwaway service container and no harm is visible. Run the same suite on a developer machine with a populated `.env` and it truncates the development database. Prefer an explicit failure when the `*_TEST` variables are absent over a fallback that is correct in exactly one environment.

> [!NOTE]
> **`CORS_ORIGIN` and `FRONTEND_URL` are the same value here and still two variables.** `CORS_ORIGIN` lists origins permitted to call the API and becomes comma-separated the moment staging appears; `FRONTEND_URL` is the single base every email link is built from. Collapsing them works until the first list value is added, at which point live verification links point at a concatenated string ([TRD §10.2](./EduTRD.md)).

**Verification:**
```bash
cp .env.example .env         # prisma auto-loads .env; placeholder values suffice below
npx prisma validate          # 0.1 schema key — must print "is valid", exits 1 if absent
npx prisma db seed 2>&1 | grep -q "seed command has been executed"   # 0.1 seed key — exit code alone proves nothing
npm ci && npm run lint       # 0.7, 0.8a — lint must exit 0, not "Invalid option '--ext'"
npm run test:run && npm run test:unit    # 0.8, 0.8b, 0.9 — both exit 0 on the contract spec
npm run test:integration                 # expected: exit 1, "No test files found", until Day 15.1
node -e "JSON.parse(require('fs').readFileSync('swagger.json'))"     # 0.11 — a malformed spec throws at /api-docs boot
git status --short --untracked-files=all | grep -q coverage/ && echo "0.11a NOT applied"   # expect no output
docker compose config        # parses, ports 3000/5432/6379
docker build -t edusphere:preflight .        # 0.2 — must succeed, not just warn
docker run --rm --entrypoint id edusphere:preflight -un   # expect: nodeapp
```

> [!CAUTION]
> **An empty Vitest suite exits `1`, so CI is red until the first spec exists — and that is the guard from the risk register, working.** Vitest 4.1.11 prints `No test files found, exiting with code 1`; there is no tolerance for an empty match set unless `--passWithNoTests` is passed. `ci.yml` runs `npm run test:run` as a gate, so a repository with zero specs fails CI on a message that says nothing about which of the two `include` patterns matched nothing.
>
> **Do not "fix" that with `--passWithNoTests`.** The risk register names *a green suite that collected nothing* as the one Critical-impact risk in this project, and asks for a non-zero collected count to be asserted in CI. Vitest's default exit code already is that assertion. Adding the flag deletes the guard permanently in exchange for one green build, and the day it matters is Day 15 — when a mistyped `include` would report green over an unexecuted integration tree.
>
> Resolved instead by task **0.8b**: land a real spec so the suite is non-empty for a real reason.

> [!NOTE]
> **`npm run test:integration` still exits 1, and should.** It is scoped to `--dir tests/integration`, which stays empty until Day 15.1. CI does not invoke it — `ci.yml` runs `test:run` only — so this does not gate anything, and a passing `test:integration` before Day 15 could only mean the directory scoping is wrong. `test:run` and `test:unit` both pass on 0.8b's spec.
>
> That spec also **half-proves 0.9**. It lives at `tests/unit/swagger-health-contract.test.js`, so `test:run` collecting it is direct evidence that the added `tests/{unit,integration}/**/*.test.js` pattern resolves — under the scaffolded `include` it would have been skipped in silence. The `integration` half of the brace expansion is still unproven and stays that way until a file exists under `tests/integration/`; brace expansion either works for both alternatives or neither, but that is an inference, not a measurement.

> [!NOTE]
> **The `grep` on line 3 is the assertion, not decoration.** `prisma db seed` exits 0 whether the `seed` key is configured or missing, so `&&`-chaining it proves nothing; the presence of the message is the only observable difference between the two states. It still does not prove the script *does* anything — see the CAUTION under task 0.1.

> [!NOTE]
> **No command above needs a running database, which is the point.** `prisma validate` reads `DATABASE_URL` but never dials it, and `db seed` against the current 0-byte stub opens no connection either, so `.env.example`'s placeholder credentials are sufficient and no Postgres is required for Day 0. (`npm ci` and `docker build` do reach the network for packages and the base image — "no database", not "no network".) Anything that connects to Postgres or Redis — `migrate dev`, `migrate deploy`, `db seed` against a real script — belongs to Day 1 after `docker compose up`. Attempting `migrate deploy` here exits 1 with `P1001 Can't reach database server`, which is the environment answering correctly, not a Day 0 failure.

> [!NOTE]
> **Run the `cp` first — `prisma validate` needs `DATABASE_URL` before it will look at the schema at all.** On a fresh clone the repository ships `.env.example` and no `.env`, so the command exits `P1012 Environment variable not found: DATABASE_URL`. That error arrives immediately after task 0.1 and reads like the schema path is still broken, when in fact 0.1 succeeded — the line above it already says `Prisma schema loaded from src/database/schema.prisma`. Read that line, not just the exit code. A correct 0.1 with a populated `.env` prints `The schema at src/database/schema.prisma is valid`.

> [!CAUTION]
> **`prisma validate` passing is not evidence the schema is correct.** It validates syntax and referential shape, not intent. A 1-1 relation with `fields:`/`references:` declared on *both* sides is accepted by the CLI and then generates a client that cannot write either side — the failure surfaces at runtime, not at validate time (§4.2). Read the four defects called out in TRD §4.2 explicitly rather than trusting a green validate.

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

> [!NOTE]
> **Day 1 ordering is load-bearing** ([TRD §8](./EduTRD.md)). The `package.json` `"prisma"` key (Day 0.1) must land before `schema.prisma` is written, or every CLI invocation silently targets the wrong path. The Redis key-namespace module (1.7) must land before the auth module (Day 3), because sessions, the user-state fast path, and cache invalidation all read their key shapes from it — retrofitting a namespace after three modules have hardcoded string literals is a cross-module refactor.

| # | Task | Details |
| :--- | :--- | :--- |
| 1.1 | **Project Initialization** | Confirm `package.json` ES Module support (`"type": "module"`) and the **two-key** `"prisma": { "schema": ..., "seed": ... }` block from Day 0.1 — confirming only `schema` leaves the half of 0.1 that `prisma db seed` and `migrate reset` depend on unverified. Install the full dependency set: **runtime** — `express@5`, `@prisma/client@6`, `ioredis`, `jsonwebtoken`, `bcryptjs`, `zod`, `helmet`, `cors`, `cookie-parser`, `pino`, `pino-http`, `express-rate-limit`, `multer`, `pdfkit`, `axios`, `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `cloudinary`, `swagger-jsdoc`, `swagger-ui-express`; **dev** — `prisma@6`, `vitest@4`, `@vitest/coverage-v8`, `supertest`, `eslint`, `prettier`. Add the six missing scripts (Day 0.8). |
| 1.2 | **Environment Configuration** | Create `src/config/env.js` with Zod schema validation for all environment variables. Invalid or missing values halt startup with descriptive error messages. Update `.env.example`: it must include **both** JWT keys (`JWT_SECRET` and the distinct `JWT_REFRESH_SECRET`), `EMAIL_WEBHOOK_SECRET`, and the `DATABASE_URL_TEST` / `REDIS_URL_TEST` pair ([TRD §10.2](./EduTRD.md)). |
| 1.3 | **Docker Compose Setup** | Author `docker-compose.yml` provisioning PostgreSQL 15 (5432) and Redis 7 (6379) with persistent volumes and health checks. The API service publishes **3000**, matching `PORT` in `.env.example` and the `Dockerfile` `EXPOSE`. The api service loads `.env` through `env_file` and overrides only the values that must differ inside the Compose network (`DATABASE_URL`, `REDIS_URL`, plus `NODE_ENV`/`PORT` pinned against a stray `.env`) — a handful of inline variables is no longer a working environment now that 1.2 validates all 25 and exits 1. `.env.example` must name the credentials this file provisions, because `prisma` is a devDependency absent from the runtime image: **migrations run from the host** against the published 5432, so a generic `user:password` there fails the second line of the verification block below. |
| 1.4 | **Prisma Schema & Migration** | Write `src/database/schema.prisma`: **20 models and 9 enums** — the six already scaffolded plus `AchievementCriteria`, `AuditActionType`, and `AuditTargetType` (Day 0.3) — with indexes, unique constraints, and cascade rules. Add the fields the scaffold is missing: `Lesson.isFreePreview`, `Lesson.durationMinutes`, `Course.durationMinutes`, `Quiz.maxAttempts`. Run `prisma migrate dev --name init`. |
| 1.4a | **Hand-Written Migration SQL** | **Four** statements — three indexes and one CHECK — express the constraints Prisma's schema language cannot, and must be appended to the generated migration by hand ([TRD §4.2](./EduTRD.md)). Prisma will not re-emit them; they live in the migration file permanently. |
| 1.5 | **Database Seed Script** | Implement `src/database/seed.js` populating: 10 subject categories with icons and colors; the achievement catalog keyed to the four `AchievementCriteria` members — `COURSES_COMPLETED`, `QUIZ_PERFECT_SCORE`, `STREAK_DAYS`, `LESSONS_COMPLETED` ([TRD §4.2](./EduTRD.md)) — each row carrying `title`, `description`, `icon`, `criteriaType` (the enum member) and `criteriaValue` (the numeric threshold). Those are the field names the schema declares; `criteria` and `threshold` do not exist. Also seed 1 admin user. Seeding must be **idempotent** (`upsert` on `slug` / `code` / achievement `title`) so it can run against an already-populated database without erroring. It must also **fail loudly**: no top-level `catch` that logs and returns — see the CAUTION below. |
| 1.6 | **Prisma Client Singleton** | Create `src/database/index.js` exporting a lazy-initialized Prisma Client with connection logging and graceful disconnect on `SIGTERM`. |
| 1.7 | **Redis Client & Key Namespace** | Two files, as [TRD §3.4](./EduTRD.md) and [§7.1](./EduTRD.md) declare them separately. `src/config/redis.js` holds the `ioredis` client only: connection, reconnection strategy, error logging. `src/utils/cache-keys.js` owns the **entire** key namespace and is the single module any other file imports a key from — `session(jti)`, `sessionIndex(userId)`, `userState(userId)`, `emailVerify(token)`, `passwordReset(token)`, `cache(resource, params)`. The two token builders **hash their argument**: the stored key is `verify:email:<sha256(token)>` / `reset:pw:<sha256(token)>`, never the raw token (§7.1). Helpers: `setWithTTL`, `getJSON`, and `deleteByPattern` implemented with **`SCAN` + `UNLINK`**. |

> [!CAUTION]
> **`DEL` does not accept glob patterns.** `redis.del('session:42:*')` is not an error — it looks for a key whose literal name contains an asterisk, deletes nothing, and returns `0`. Every call site reads that `0` as "no sessions to revoke" and continues. This is why `deleteByPattern` must be built on `SCAN` + `UNLINK` (non-blocking) and why `KEYS` is prohibited in any request path — it is O(N) over the entire keyspace and blocks the single-threaded server ([TRD §7.1](./EduTRD.md)).

**Migration SQL to append (Task 1.4a):**

These are the four statements [TRD §4.2](./EduTRD.md) requires by name — the constraints Prisma's schema language cannot express. Write them into the generated migration directory as a hand-edited step of `migrate dev`, not as a later ad-hoc `psql` session.

```sql
-- 1. Bookmark uniqueness splits in two, because one table serves two kinds of
--    row: a course-level bookmark (lesson_id NULL) and a lesson-level one.
--    A single unique index cannot express both — NULLs are distinct in SQL, so
--    @@unique([userId, courseId, lessonId]) permits unlimited duplicate
--    course-level bookmarks and POST /bookmarks/toggle inserts instead of
--    toggling (apidoc §8.9).
CREATE UNIQUE INDEX bookmarks_user_course_uniq
  ON bookmarks (user_id, course_id)
  WHERE lesson_id IS NULL;

CREATE UNIQUE INDEX bookmarks_user_lesson_uniq
  ON bookmarks (user_id, lesson_id)
  WHERE lesson_id IS NOT NULL;

-- 2. Slug uniqueness applies to the live set only. A plain @@unique would let a
--    soft-deleted course reserve its slug forever, so a course cannot be
--    recreated under the name it was deleted under. This index is therefore the
--    ONLY uniqueness on courses.slug — the column carries no @unique, because
--    the unconditional index @unique creates rejects the reuse before this one
--    is consulted, and lookups become findFirst({ slug, deletedAt: null }).
CREATE UNIQUE INDEX courses_slug_live_uniq
  ON courses (slug)
  WHERE deleted_at IS NULL;

-- 3. Rating domain enforced at the database boundary, not only in Zod.
--    Zod guards the HTTP path; this guards seeds, scripts, and psql.
ALTER TABLE reviews
  ADD CONSTRAINT reviews_rating_range CHECK (rating BETWEEN 1 AND 5);
```

> [!CAUTION]
> **Hand-written SQL addresses the *physical* names, and every one of them is snake_case.** The models declare `@@map("bookmarks")`, `@@map("courses")`, `@@map("reviews")` and `@map("user_id")`, `@map("lesson_id")`, `@map("deleted_at")`, so the Prisma-side identifiers `Bookmark`, `userId`, `deletedAt` do not exist in PostgreSQL. `CREATE UNIQUE INDEX … ON "Course" ("deletedAt")` fails with `relation "Course" does not exist` — and it fails during `migrate dev`, which leaves the migration recorded as failed and the shadow database mid-state. Unquoted lowercase, as written above, is correct because Postgres folds it to the same names `@map` produced.

> [!WARNING]
> **Enrollment uniqueness is the plain composite `@@unique([userId, courseId])`, and re-enrollment is an `upsert` — not a second row.** A partial index scoped to `status = 'ACTIVE'` looks like the way to allow re-enrollment, and it is the wrong shape: it permits an unbounded set of historical rows per (user, course), which defeats the `DROPPED` → `ACTIVE` reactivation guard on `Course.studentCount` and `Instructor.studentCount` ([TRD §4.2](./EduTRD.md)). Those are lifetime counters that must not increment on reactivation, and the guard is written as "this row already existed" — which is only decidable if there is exactly one row. With one row enforced, `DROPPED` → `ACTIVE` is an update to the existing enrollment and the counters are untouched; apidoc §8.7 states this directly ("`@@unique([userId, courseId])` makes a second row impossible, so an `upsert`-style reactivation is the only correct implementation"). Progress rows survive because they hang off the enrollment that was never deleted.

> [!NOTE]
> **`Review` has no `deletedAt`, so review deletion is a hard delete.** [TRD §4.2](./EduTRD.md) puts `deletedAt` on `User` and `Course` only, and its `@@unique([userId, courseId])` on `Review` is therefore unconditional: deleting a review frees the slot and the author may write a new one. Do not add a `WHERE deleted_at IS NULL` partial index here — it would reference a column that does not exist. Admin moderation still leaves a trail: `DELETE /reviews/:id` by an admin writes `AuditLog (REVIEW_DELETED)` in the same transaction (§6.8), which is where the moderation history lives.

**Deliverables:**
- 20 tables and 9 enum types created via migration, plus the **four** hand-written constraints from §4.2
- Running Redis with a single authoritative key-namespace module
- Idempotent seed: subjects, achievement catalog with `criteriaType` / `criteriaValue`, admin user
- Zod-validated environment boot that fails loudly on a missing `JWT_REFRESH_SECRET`

**Verification:**
```bash
docker compose up -d
npm run db:migrate && npm run db:seed
npm run db:seed          # must succeed a second time — proves idempotency

# Prove the four hand-written constraints landed under their physical names:
psql "$DATABASE_URL" -c "\d+ bookmarks"   # expect both partial unique indexes
psql "$DATABASE_URL" -c "\d+ courses"     # expect courses_slug_live_uniq WHERE deleted_at IS NULL
psql "$DATABASE_URL" -c "\d+ reviews"     # expect reviews_rating_range and the plain composite unique
psql "$DATABASE_URL" -c "\d+ enrollments" # expect ONE unique on (user_id, course_id), unconditional
```

---

### Day 2 — Express Application Shell & Middleware Pipeline

**Goal:** Build the Express 5 application skeleton with the complete security middleware stack, global error handler, health check endpoint, and structured logging.

| # | Task | Details |
| :--- | :--- | :--- |
| 2.1 | **Express App Factory** | Create `src/app.js` wiring middleware in the exact order below. Two orderings are correctness requirements, not style: the webhook `express.raw()` mount must precede `express.json()`, and `cookie-parser` must precede any route that reads the refresh cookie. |
| 2.2 | **Constants & System Messages** | Populate `src/config/constants.js` (role enums, course levels, pagination defaults — **`DEFAULT_LIMIT = 10`, `MAX_LIMIT = 100`**, rate limit tiers) and `src/config/system_messages.js` (user-facing message strings). |
| 2.3 | **Utility Classes** | Implement `src/utils/app-error.js` (`AppError` with `statusCode`, `isOperational`, error-code taxonomy) and `src/utils/api-response.js` (`success()`, `created()`, `paginated()`). Every builder emits the canonical envelope: `{ status: "success" \| "error", message, data \| errors }` — `status` is a **string**, never a boolean, and the payload key is always `data`, never a resource-specific name like `resource` or `course` ([TRD §6](./EduTRD.md)). |
| 2.4 | **Rate Limiting** | Configure `src/middlewares/rate-limit.middleware.js`: Global API (100 req / 15 min), Auth endpoints (5 req / 15 min), Admin destructive actions (10 req / 15 min). Health probe bypassed. Keyed on **`req.ip`**, which requires `app.set('trust proxy', 1)` in `app.js` — without it every request reports the load balancer's address and the global limiter throttles the entire platform as one client ([TRD §7](./EduTRD.md), [apidoc.md §4](./docs/apidoc.md)). Authenticated tiers may additionally partition by `req.user.id` so a shared NAT egress is not one bucket, but `req.ip` remains the base key the spec defines. |
| 2.5 | **Structured Logging** | Implement `src/middlewares/logging.middleware.js` using `pino-http` with request ID generation, response time tracking, and log-level filtering by `NODE_ENV`. Redact `req.body.password`, `req.headers.authorization`, and `req.headers.cookie` at the serializer level. |
| 2.6 | **Zod Validation Middleware** | Create `src/middlewares/validate.middleware.js` accepting a schema object with optional `body`, `params`, `query` keys. Returns **422** with field-level `errors[]` on failure. Pagination is **clamped, not rejected**: `?limit=500` serves 100 rather than erroring ([apidoc.md §6](./docs/apidoc.md)). |
| 2.7 | **Health Check Endpoint** | Implement `GET /health` executing a live database ping (`SELECT 1` via `$queryRaw`) and Redis `PING`. Returns `200` with `{ status, database, redis, uptime }` or **`503`** if either dependency is down. Update `swagger.json`'s health schema to match — the committed stub declares only `{ status, uptime }` (Day 0.11). |
| 2.8 | **Server Bootstrap** | Create `src/server.js` initializing database, Redis, and the HTTP listener on **`PORT=3000`**. Graceful shutdown on `SIGTERM`/`SIGINT` with a 10-second drain timeout. |

**Middleware order (Task 2.1):**
```js
app.set('trust proxy', 1);               // before any req.ip reader — see 2.4

app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
app.use(pinoHttp(loggerOptions));

// Webhooks FIRST — signature verification needs the raw, unparsed body.
app.use('/api/v1/webhooks', express.raw({ type: 'application/json', limit: '100kb' }));

app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());                 // before any refresh-cookie reader
app.use(globalRateLimiter);
app.use('/api/v1', apiRouter);
app.use(notFoundHandler);
app.use(globalErrorHandler);             // last, and must take 4 args
```

> [!WARNING]
> **`trust proxy` is not cosmetic and its absence is invisible in development.** Behind a load balancer or ingress, `req.ip` is the proxy's address on every request unless Express is told to read `X-Forwarded-For`. The global 100 req / 15 min tier then applies to the platform as a whole: the hundred-and-first request from any user anywhere is rejected, and the logs show a single IP hammering the API. Locally there is no proxy, `req.ip` is already the client, and every test passes. Set it once in `app.js` before any middleware that reads `req.ip` ([TRD §7](./EduTRD.md), [apidoc.md §4](./docs/apidoc.md)).

> [!CAUTION]
> **`express.json()` before the webhook mount destroys signature verification.** Once the JSON parser consumes the stream, `req.body` is a parsed object and the original byte sequence is gone. Re-serializing it produces different bytes — key order, whitespace, unicode escaping — so the HMAC never matches and every legitimate webhook is rejected as a forgery. Reaching for `verify: (req, res, buf) => { req.rawBody = buf }` as a workaround means every request in the application carries a second full copy of its body in memory ([TRD §6.11](./EduTRD.md)).

> [!IMPORTANT]
> **The body limit is `100kb`, not `10mb`.** All large media moves through pre-signed direct-to-S3 uploads (Day 8) and never transits this parser. The single exception is the 5 MB avatar route, where `multer` applies its own limit downstream of `express.json()` and is unaffected by it. A 10 MB JSON limit buys nothing and hands an unauthenticated caller a 10 MB allocation per request ([TRD §7](./EduTRD.md)).

**Deliverables:**
- `GET /health` returning `{ status: "ok", database: "connected", redis: "connected", uptime: <s> }`, and `503` when either dependency is down
- `swagger.json` health schema matching that shape
- Structured JSON request logs with credentials redacted
- Rate limiting active; global error handler formatting `AppError` into the canonical envelope

**Verification:**
```bash
npm run dev
curl -i http://localhost:3000/health          # 200, all four keys present

docker compose stop redis
curl -i http://localhost:3000/health          # must be 503, not 200-with-a-warning
docker compose start redis
```

---

### Day 3 — Authentication Module & RBAC Guards

**Goal:** Implement the complete authentication lifecycle (register, login, logout, token refresh, email verification, password reset) and RBAC middleware.

| # | Task | Details |
| :--- | :--- | :--- |
| 3.1 | **Auth Zod Schemas** | Define `src/modules/auth/auth.schema.js` with strict schemas: `registerSchema` (fullName 2–100 chars, email, password 8+ chars with complexity rules, optional role), `loginSchema`, `refreshSchema`, `verifyEmailSchema`, `forgotPasswordSchema`, `resetPasswordSchema`. `role` accepts `STUDENT` and `INSTRUCTOR` only — `ADMIN` must be rejected at the schema boundary so self-registration can never mint an admin. |
| 3.2 | **Email Stub Service** | Create `src/integrations/email/index.js` as a lightweight stub that **logs email content to the console** via `pino` instead of making real API calls. Exports the same interface (`sendVerificationEmail`, `sendPasswordResetEmail`, etc.) that will be replaced with the real Brevo/SendGrid client on Day 11. This unblocks auth email flows without front-loading the full integration. |
| 3.3 | **Auth Service — Registration** | Implement `register()`: check email uniqueness → hash password (bcrypt, 12 rounds) → create user record → generate a random verification token → store it under `verify:email:<sha256(token)>` with a 24h TTL, the **raw token going only into the email** → dispatch verification email via stub → return sanitized user object (no `passwordHash`). |
| 3.4 | **Auth Service — Login** | Implement `login()`: find user by email → verify password hash → check `isBanned` → check `deletedAt` → mint an access token (15m, `JWT_SECRET`) and a refresh token (7d, **`JWT_REFRESH_SECRET`**) each carrying a unique `jti` → write the session under `session:<jti>` and add that `jti` to the per-user index set `session:index:<userId>` → write the `user:state:<id>` fast-path record → return the pair. |
| 3.5 | **Auth Service — Token Refresh** | Implement `refresh()`: read the token from the `HttpOnly` cookie → verify against `JWT_REFRESH_SECRET` → confirm `session:<jti>` exists in Redis → rotate: `UNLINK` the old key, remove the old `jti` from the index set, mint a new pair, write the new session and index entry. Set the cookie `HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth`. Reject on `Origin`/`Referer` mismatch. **Fail closed with 503** if Redis is unreachable. |
| 3.6 | **Auth Service — Logout** | Implement `logout()`: `UNLINK session:<jti>` → `SREM` that `jti` from `session:index:<userId>` → clear the refresh cookie with the **same** `Path=/api/v1/auth` attribute it was set with. |
| 3.7 | **Auth Service — Password Recovery** | Implement `forgotPassword()` (generate a reset token, store it under `reset:pw:<sha256(token)>` with a 15m TTL, send the raw token by email via the stub — respond **200 whether or not the email exists**, so the endpoint is not an account-enumeration oracle) and `resetPassword()` (hash the submitted token, look the key up, `UNLINK` it **before** accepting the new password so the token is single-use, hash the new password, update the user, then revoke **every** session via the index set). |
| 3.8 | **Auth Service — Email Verification** | Implement `verifyEmail()`: hash the submitted token → `GET verify:email:<sha256(token)>` → set `isEmailVerified = true` → `UNLINK` the key in the same step that consumes it → rewrite `user:state:<id>` so the new flag is visible to `requireVerifiedEmail` immediately rather than after the 15-minute TTL. |
| 3.9 | **Auth Controller & Routes** | Wire all 8 auth endpoints with Zod validation, the 5 req / 15 min limiter on sensitive endpoints, and canonical envelope formatting. |
| 3.10 | **requireAuth Middleware** | Create `src/middlewares/auth.middleware.js`: extract Bearer token → verify JWT → read `user:state:<id>` from **Redis, not PostgreSQL** → reject banned or soft-deleted users → attach `req.user` as `{ id, email, role }`. Also implement `optionalAuth`, which attaches `req.user` when a valid token is present and otherwise proceeds anonymously — never 401s. |
| 3.11 | **requireRole Middleware** | Create `src/middlewares/rbac.middleware.js`: accepts an array of allowed roles → compares against `req.user.role` → 403 if unauthorized. Add a `requireVerifiedEmail` guard and mount it on exactly the three surfaces the contract names — `POST /enrollments`, `POST /courses`, and every quiz submission ([apidoc.md §3](./docs/apidoc.md)). Review creation is **not** one of them: its guard is enrollment ([TRD §6.8](./EduTRD.md)). |

**Session key layout (Tasks 3.4–3.6)** — types and TTLs exactly as [TRD §7.1](./EduTRD.md) declares them:
```
session:<jti>                  → String (JSON)  { userId, role, issuedAt, ip, userAgent }        TTL 7d
session:index:<userId>         → Set            { jti, jti, ... }                               no TTL
user:state:<userId>            → String (JSON)  { role, isBanned, isEmailVerified, deletedAt }   TTL 15m
verify:email:<sha256(token)>   → String         userId                                          TTL 24h, single-use
reset:pw:<sha256(token)>       → String         userId                                          TTL 15m, single-use
```

> [!CAUTION]
> **These are Strings, not hashes, and the difference is not stylistic.** `HGETALL` returns every field as a string, so `isBanned` comes back as `'false'` — which is truthy. A `requireAuth` guard written as `if (state.isBanned)` then rejects every user on the platform, and one written as `if (state.isBanned === true)` admits every banned one. A JSON String round-trips booleans and `null` correctly through the `getJSON` / `setWithTTL` helpers from 1.7, and per-key TTL is the only TTL either shape supports anyway.

> [!IMPORTANT]
> **`session:index:<userId>` carries no TTL, and that is deliberate — but it makes the set a superset, not a mirror.** Member `jti`s are removed by `SREM` on logout and on refresh rotation, and the whole key is `UNLINK`ed on ban. Nothing removes a `jti` whose `session:<jti>` simply expired, so the set accumulates dead members. Two consequences for Day 13: `UNLINK` on a dead `jti` is harmless, and `revokedSessions` must report **`UNLINK`'s return value** — the number of keys actually removed — not `jtis.length`, which counts expired sessions as revoked and hands the operator an inflated number.

> [!WARNING]
> **`user:state:<userId>` is 15 minutes because that is the access-token lifetime.** The two TTLs are the same number on purpose: the ban window is then bounded by the token, and lengthening the cache TTL silently lengthens the window in which a banned user's live token still reads as active. A 1-hour cache turns a 15-minute exposure into an hour of it, which is precisely the failure the fast path exists to prevent.

> [!IMPORTANT]
> **The index set is what makes revocation O(1) instead of O(keyspace).** Banning a user (Day 13) needs every session for that user, and `session:<jti>` alone cannot be searched by user without scanning. `SMEMBERS session:index:<userId>` → `UNLINK` each → `UNLINK` the set itself. Without the index the only options are a full `SCAN` on every ban or `KEYS`, which blocks the server ([TRD §7.1](./EduTRD.md)).

> [!CAUTION]
> **`requireAuth` must not query PostgreSQL per request.** A 15-minute access token is valid for 15 minutes after a ban unless something is checked on every request, but checking the *database* every request puts a synchronous round-trip in front of every authenticated call and makes the connection pool the throughput ceiling. `user:state:<id>` is written on login, on ban/unban, and on role change, and read on every request. Ban latency becomes the write, not the token TTL.

> [!WARNING]
> **Redis unavailability during a security read must fail closed with 503, never fall through to "allow".** If `user:state:<id>` cannot be read, the request cannot be authorized — a banned user's token is still cryptographically valid, so a fail-open path admits exactly the users the ban exists to exclude. This is the opposite of the *cache* policy: a missed catalog cache falls through to PostgreSQL and serves the request. Security reads fail closed; cache reads fail open ([TRD §7.1](./EduTRD.md)).

**Deliverables:**
- Full flow: register → verify email → login → protected route → refresh → logout
- Refresh rotation invalidates the previous token; the cookie is scoped to `/api/v1/auth`
- Access and refresh tokens signed with **different** keys; a refresh token presented as a Bearer token fails signature verification
- Banned users rejected within one `user:state` TTL, not one access-token TTL
- Redis down ⇒ 503 on authenticated routes, never a silent bypass

**Verification:**
- Register, verify, login, call `GET /api/v1/auth/me` with the Bearer token
- Refresh, then replay the **old** refresh token → expect 401 and confirm the old `jti` is gone from the index set
- Present the refresh token in the `Authorization` header → expect 401 (proves two distinct keys)
- Ban the seeded test user, then reuse their still-unexpired access token → expect 403
- `docker compose stop redis`, then call any authenticated route → expect **503**, and confirm no request is authorized

---

### Day 4 — Subjects, Course Catalog & Notification Foundation

**Goal:** Build the first public-facing content modules (Subjects and Courses) and lay the groundwork for the notification system.

| # | Task | Details |
| :--- | :--- | :--- |
| 4.1 | **Subjects Module** | Implement `GET /subjects` (public, Redis-cached, 1h TTL), `GET /subjects/:slug/courses` (paginated, filtered by subject), `POST /subjects` (Admin), `PUT /subjects/:id` (Admin — renaming regenerates the slug and must invalidate every cached key built from the old one), `DELETE /subjects/:id` (Admin). |
| 4.2 | **Subject Deletion Conflict** | `Course.subjectId` is `onDelete: Restrict` ([TRD §4.2](./EduTRD.md)), so deleting a populated subject raises a Prisma `P2003` foreign-key error. Catch it and return **409 Conflict** with a message naming the blocking course count. Left uncaught it surfaces as a 500 and reads as a server fault rather than an operator error. |
| 4.3 | **Courses Module — Read Operations** | Implement `GET /courses` with multi-parameter filtering (`?subject=&level=&priceMax=&search=&sort=&page=&limit=` — the names [TRD §6.5](./EduTRD.md) and [apidoc.md §8.6](./docs/apidoc.md) define; `subject` filters on the FK, and `priceMax` is an upper bound, not an exact match), `GET /courses/featured` (cached), `GET /courses/:slug` (full detail with instructor, curriculum outline, review summary). |
| 4.4 | **Route Registration Order** | Register `/courses/featured` **before** `/courses/:slug`. Express 5 matches in registration order, so the parameterised route registered first swallows the literal one and `featured` arrives at the handler as a slug — producing a 404 for a course that was never missing. The same rule applies to `/notifications/read-all` before `/notifications/:id/read` (Day 12). |
| 4.5 | **Courses Module — Write Operations** | Implement `POST /courses` (Instructor creates draft), `PUT /courses/:id` (update metadata, publish/unpublish), `DELETE /courses/:id` (soft-delete via `deletedAt` — and if the course was published, **decrement `subject.courseCount`** in the same transaction, since the course leaves the live published set). Enforce ownership: `course.instructorId === req.user.instructorProfile.id`, Admin bypassing. |
| 4.6 | **Course Publishing Validation** | On `PUT /courses/:id { isPublished: true }`: validate ≥ 1 module with ≥ 1 lesson, else 422. Atomically flip `isPublished` and adjust `subject.courseCount` inside `prisma.$transaction`, then invalidate the catalog cache. |
| 4.7 | **Publish Transition Guard** | `subject.courseCount` counts courses that are `isPublished = true AND deletedAt IS NULL`, so it must move **only on an actual transition into or out of that set** — increment on `false → true`, decrement on `true → false`, and do nothing when the incoming value equals the stored one. A `PUT` setting `isPublished: true` on an already-published course is a legal idempotent update, and an unguarded increment makes the counter climb on every metadata save. Three paths decrement: admin unpublish, admin soft-delete of a published course, and instructor `DELETE /courses/:id` on a published course ([TRD §4.2](./EduTRD.md)). |
| 4.8 | **Swagger/OpenAPI Configuration** | Set up `src/config/swagger.js` using `swagger-jsdoc` to assemble the spec from route-level JSDoc annotations, and mount `swagger-ui-express` at **`/api-docs`**. This replaces the hand-maintained `/health`-only `swagger.json` stub with a generated document ([TRD §3.3](./EduTRD.md)). |
| 4.9 | **Notification Model & Service** | Implement `src/modules/notifications/notifications.service.js` exposing `createNotification(userId, type, title, message)` as a reusable internal utility, consumed by enrollments, achievements, and admin in later phases. |
| 4.10 | **Instructor Profile Auto-Creation** | When a user registers as `INSTRUCTOR` or is elevated by an admin, create the `Instructor` profile in the same transaction. Both call sites must use the same helper — a user with `role = INSTRUCTOR` and no profile row cannot author anything, and the failure surfaces much later as a null dereference in an ownership check. |

**Deliverables:**
- Public catalog with search, filtering, and clamped pagination
- Subject CRUD, with 409 rather than 500 on a populated delete
- Instructor authoring: create draft, update, soft-delete
- Publishing gated on curriculum, with a transition-guarded counter
- `swagger-jsdoc` generating the spec, served at `/api-docs`

**Verification:**
- `GET /courses?search=javascript&level=BEGINNER&page=1&limit=10`
- Create a draft as Instructor → confirm it is absent from the public catalog
- Publish with no modules → expect 422
- `GET /courses/featured` → expect the featured list, **not** a 404 (proves registration order)
- `PUT /courses/:id { isPublished: true }` **twice** → `subject.courseCount` increments exactly once
- `DELETE /courses/:id` on a **published** course → `subject.courseCount` decrements; repeat on a **draft** → unchanged
- `DELETE /subjects/:id` on a subject holding courses → expect 409 with the blocking count
- `GET /courses?limit=500` → serves 100, HTTP 200 (clamped, not rejected)

---

### Phase 1 Exit Criteria

| Criteria | Status |
| :--- | :--- |
| `GET /health` returns 200 with `{ status, database, redis, uptime }`, and 503 when a dependency is down | ☐ |
| Registration, login, refresh rotation, and logout work end-to-end | ☐ |
| Access and refresh tokens are signed with **different** secrets | ☐ |
| Redis unavailability produces 503 on authenticated routes — never a bypass | ☐ |
| Role-based access control blocks unauthorized operations | ☐ |
| Banned users are rejected on all authenticated routes via `user:state:<id>` | ☐ |
| Public course catalog supports search, filter, and clamped pagination (default 10, max 100) | ☐ |
| `GET /courses/featured` resolves to the literal route, not `:slug` | ☐ |
| Course publishing validates minimum curriculum and moves `subject.courseCount` only on transition | ☐ |
| Instructor soft-delete of a **published** course decrements `subject.courseCount`; of a draft, does not | ☐ |
| Deleting a populated subject returns 409, not 500 | ☐ |
| `swagger-jsdoc` generates the spec from route annotations; `/api-docs` renders all Phase 1 endpoints | ☐ |

---

## Phase 2: Curriculum Engine & Assessment System (Days 5–8)

**Objective:** Build the hierarchical curriculum authoring system (Modules → Lessons), the enrollment and atomic progress tracking engine, the secure server-side quiz assessment system, and the cloud media upload integration. By the end of Phase 2, a student should be able to enroll in a course, consume lessons, take quizzes, and have their progress tracked atomically.

---

### Day 5 — Curriculum Hierarchy (Modules & Lessons)

**Goal:** Implement the Module and Lesson CRUD endpoints that form the backbone of course content structure.

| # | Task | Details |
| :--- | :--- | :--- |
| 5.1 | **Modules Module** | Implement `POST /courses/:courseId/modules` (create with `orderIndex`), `PUT /modules/:id` (rename, reorder), `DELETE /modules/:id` (cascades to child lessons). Instructor ownership enforced on every mutation. |
| 5.2 | **Lessons Module** | Implement `POST /modules/:moduleId/lessons` (type `VIDEO`/`TEXT`/`CODE`/`QUIZ`, content, `videoUrl`, `codeSnippet`, `durationMinutes`, `isFreePreview`, `orderIndex`), `GET /lessons/:id`, `PUT /lessons/:id`, `DELETE /lessons/:id`. |
| 5.3 | **Lesson Access Resolution** | `GET /lessons/:id` resolves access in a fixed order: `isFreePreview` → **200 to anyone, no token required**; course owner or Admin → 200; no valid token → **401**; enrolled but the lesson is not yet unlocked → **423 Locked**; otherwise 200. The 423 body carries `nextAccessibleLessonId` so the client can redirect rather than guess ([apidoc.md §8.6](./docs/apidoc.md)). |
| 5.4 | **Sequential Unlocking Rule** | A lesson is accessible when every lesson ordered before it is complete, where order is the composite `(module.orderIndex, lesson.orderIndex)` — **not** `lesson.orderIndex` alone, which restarts at 0 in each module and would unlock the first lesson of all modules at once. A lesson whose linked quiz has exhausted `maxAttempts` counts as passed for unlocking purposes; otherwise a failing student is permanently walled out of the rest of the course. `maxAttempts` is nullable and `NULL` means unlimited, so an exhaustion test must read `quiz.maxAttempts !== null && attemptsUsed >= quiz.maxAttempts` — `attemptsUsed >= null` is `false` for every value and turns the escape hatch off silently ([TRD §5.2](./EduTRD.md), AC-5). |
| 5.5 | **Ownership Verification Helper** | Extract `verifyCourseOwnership(courseId, userId)`, shared by courses, modules, lessons, quizzes, and resources. Module- and lesson-scoped checks resolve upward to the owning course. Admin bypasses. |
| 5.6 | **Duration Rollup** | `Course.durationMinutes` is the sum of its lessons' `durationMinutes`, recalculated inside the same transaction as any lesson create, update-of-duration, or delete. Computing it on read instead would put an aggregate over every lesson behind every catalog card ([TRD §4.2](./EduTRD.md)). |
| 5.7 | **Nested Curriculum Response** | Extend `GET /courses/:slug` to return `course.modules[].lessons[]` with metadata (title, type, `durationMinutes`, `isFreePreview`, lock state) and **no** `content`, `videoUrl`, or `codeSnippet` for non-enrolled visitors — **except** where `isFreePreview = true`, where the body fields **are** included on this response. That exception is the whole purpose of the flag: the preview is the conversion surface, and withholding it here forces an anonymous visitor to discover a second endpoint before they can see anything ([TRD §6.5](./EduTRD.md), [apidoc.md §8.6](./docs/apidoc.md)). |

> [!WARNING]
> **Curriculum edits move the progress denominator.** `progressPercent` is `completed / total`, so adding or deleting a lesson silently changes every enrolled student's percentage. The rule ([TRD §5.1](./EduTRD.md)): `ACTIVE` enrollments are **recalculated** against the new total in the same transaction as the curriculum change, while `COMPLETED` enrollments are **pinned at 100.0** and never recalculated. Without the pin, an instructor adding one lesson retroactively un-completes every graduate — invalidating certificates already issued and downloaded. Adding a lesson to a course with completions is therefore a transaction over `Lesson`, `Course.durationMinutes`, and every `ACTIVE` enrollment row, not a single insert.

**Deliverables:**
- Instructors build a full curriculum: Course → Modules → Lessons
- Composite `(module.orderIndex, lesson.orderIndex)` ordering with 423 gating and `nextAccessibleLessonId`
- Free-preview lessons readable by anonymous visitors
- `Course.durationMinutes` maintained on write
- Curriculum edits recalculate `ACTIVE` progress and leave `COMPLETED` at 100.0

**Verification:**
- As an anonymous client, `GET /lessons/:id` on an `isFreePreview` lesson → 200 with full content
- Same call on a non-preview lesson → 401 (not 403 — there is no identity to deny)
- Enrolled student requests lesson 3 with lesson 1 incomplete → 423 with `nextAccessibleLessonId` pointing at lesson 1
- Exhaust `maxAttempts` on a failing quiz → the next lesson unlocks
- Add a lesson to a course holding one `ACTIVE` (50%) and one `COMPLETED` enrollment → active recalculates, completed stays 100.0

---

### Day 6 — Enrollment & Atomic Progress Engine

**Goal:** Implement the enrollment lifecycle and the atomic progress calculation engine that tracks lesson completions.

| # | Task | Details |
| :--- | :--- | :--- |
| 6.1 | **Enrollments Module — Enroll** | Implement `POST /enrollments { courseId }`: require a **verified email** (403 otherwise) → verify the course exists, is published, and is not soft-deleted (404) → reject self-enrollment by the course's own instructor (422) → check for an existing enrollment (409 if `ACTIVE`, reactivate if `DROPPED`) → create the row and increment `course.studentCount` and `instructor.studentCount` inside `prisma.$transaction` → notify. |
| 6.2 | **Reactivation Guard** | A `DROPPED` → `ACTIVE` re-enrollment must **skip** both increments. The counters were incremented on the original enrollment and never decremented on drop, so incrementing again double-counts a student who was already counted. This is the mirror image of task 6.6 and the two must be read together ([TRD §4.2](./EduTRD.md), AC-15). |
| 6.3 | **Enrollments Module — My Enrollments** | Implement `GET /enrollments/me`: enrolled courses with `progressPercent`, `status`, title, thumbnail, instructor name. Supports `?status=ACTIVE&page=1&limit=10`. |
| 6.4 | **Enrollments Module — Progress Detail** | Implement `GET /enrollments/:courseId/progress`: lesson-by-lesson checklist with `isCompleted`, `completedAt`, and lock state, grouped by module. |
| 6.5 | **Lesson Completion Endpoint** | Implement `POST /lessons/:id/complete`: verify an `ACTIVE` enrollment → verify the lesson is unlocked (423 if not) → upsert `LessonProgress` (idempotent on `[enrollmentId, lessonId]`) → recount completed vs. total with a division-by-zero guard → write `enrollment.progressPercent` → update the streak → on 100%, flip `status = COMPLETED` and set `completedAt`. One `prisma.$transaction`. |
| 6.6 | **Row-Level Lock on Progress Writes** | The completion transaction must take `SELECT ... FOR UPDATE` on the enrollment row before recounting ([TRD §5.3](./EduTRD.md)). Two concurrent completions — a double-clicked button, or a video player firing its end event twice — otherwise both read the same pre-write count and both write the same percentage, losing one lesson permanently. The unique constraint stops duplicate `LessonProgress` rows but does nothing about the lost update on the denormalized percentage, because both writers are updating a different row than the one the constraint protects. |
| 6.7 | **User Streak Engine** | On completion, update `UserStreak`: `lastActiveDate` was yesterday → increment `currentStreak` and raise `longestStreak` if it is a new record; today → no-op; any older or null → reset to 1. Compare **calendar dates in UTC** — the boundary [TRD §5.1](./EduTRD.md) step 5 and §9.1 both name — not elapsed hours: 23:00 to 01:00 is two days and must count as consecutive. UTC is a decision, not a default: deriving the day from the server's local zone makes the streak depend on where the container runs, and a redeploy to another region silently breaks or extends every user's streak at once. |
| 6.8 | **Drop Enrollment** | Implement `PATCH /enrollments/:courseId/drop`: set `status = DROPPED`, preserve all `LessonProgress`. **Decrement nothing.** |

> [!IMPORTANT]
> **`studentCount` is a lifetime metric on both `Course` and `Instructor`, never decremented.** It answers "how many students has this course ever taught," which is what the instructor dashboard and the catalog's social-proof figure report. Dropping does not decrement, and neither does a ban or a soft-delete. `Subject.courseCount` behaves the opposite way — it is a *live* count of currently-published courses and decrements on unpublish and on soft-delete of a published course. The two counters are governed by different rules on purpose; treating them alike breaks one of them ([TRD §4.2](./EduTRD.md), AC-15).

**Deliverables:**
- Verified-email students enroll in published courses; instructors cannot enroll in their own
- Completion atomically recalculates progress under a row lock
- Division-by-zero guard returns 0.0% for a course with no lessons
- Re-enrollment reactivates without data loss **and without double-counting**
- Streaks track calendar days

**Unit tests (same day, `src/modules/enrollments/tests/`):**
- Progress formula: 3/10 → 30.0%
- Zero-lesson course → 0.0%, no throw
- Streak: yesterday → +1; today → no-op; two-day gap → reset to 1; 23:00→01:00 → consecutive
- `DROPPED` → `ACTIVE` transition leaves both `studentCount` values unchanged
- Two concurrent `POST /lessons/:id/complete` calls for different lessons → final `progressPercent` reflects **both**

---

### Day 7 — Server-Side Quiz Assessment Engine

**Goal:** Build the complete quiz system: authoring, question management, secure answer isolation, server-side grading, and automatic lesson completion linkage.

| # | Task | Details |
| :--- | :--- | :--- |
| 7.1 | **Quiz CRUD** | Implement `POST /quizzes` (linked to a course, optionally to a lesson — when `lessonId` is present and `maxAttempts` is omitted, default it to **3**; when `lessonId` is null it may stay `NULL`, meaning unlimited, per [TRD §5.2](./EduTRD.md)), `PUT /quizzes/:id` (title, `passingScore`, `maxAttempts`), `DELETE /quizzes/:id` (**409 Conflict** if any `QuizAttempt` rows exist, overridable with `?force=true`, which cascades questions and attempts and is audited — [TRD §6.7](./EduTRD.md), [apidoc.md §8.8](./docs/apidoc.md)). |
| 7.2 | **Mutation Lock Once Attempts Exist** | Any change to `passingScore`, to a question's `correctAnswerIndex`, or to the question set returns **409 Conflict** once a single `QuizAttempt` row exists. Stored attempts hold a score computed against the old answer key; re-keying the quiz silently invalidates every historical score and can retroactively fail a student who already passed and had a lesson unlocked on the strength of it. Editing purely cosmetic fields — `questionText` wording, quiz title — stays permitted ([apidoc.md §8.8](./docs/apidoc.md)). |
| 7.3 | **Question Management** | Implement `POST /quizzes/:id/questions` (batch create: `questionText`, `type`, `options[]`, `correctAnswerIndex`, `orderIndex`), `PUT /quizzes/:id/questions/:questionId`, `DELETE /quizzes/:id/questions/:questionId`. Validate `correctAnswerIndex` is within `options[]` bounds — an out-of-range index makes the question unanswerable and every attempt fails it. |
| 7.4 | **Quiz Retrieval (Answer Isolation)** | `GET /quizzes/:id` returns metadata and questions with options. `correctAnswerIndex` is excluded by an explicit Prisma **`select`**, not by deleting keys from a fetched object — a `select` cannot be defeated by a later refactor that adds a nested include or spreads the record into a response. Instructor-owner and Admin requests include the key. Also return `attemptsUsed`, `maxAttempts`, and `attemptsRemaining` — where `maxAttempts` is `NULL`, `attemptsRemaining` is `null` (unlimited), not `0`, which the client would render as "no attempts left". |
| 7.5 | **Attempt Cap Enforcement** | Reject submissions beyond `quiz.maxAttempts` with **429**, and **no `Retry-After` header** — the budget is per-quiz and permanent, not a time window, so a `Retry-After` would tell the client to retry at a time when it will still be refused ([apidoc.md §8.8](./docs/apidoc.md)). Guard the null case explicitly: `quiz.maxAttempts !== null && attemptsUsed >= quiz.maxAttempts`. Written as a bare `attemptsUsed >= quiz.maxAttempts`, an unlimited quiz compares against `null`, evaluates `false` forever, and the cap appears to work in every test that uses a capped quiz. |
| 7.6 | **Quiz Submission & Grading** | Implement `POST /quizzes/:id/submit` with body `{ answers: [{ questionId, selectedIndex }] }`: verify enrollment → check the attempt budget → fetch questions **with** answer keys server-side → grade → compare against `passingScore` → store the `QuizAttempt` → if passed and the quiz is linked to a lesson, run the Day 6 completion flow. |
| 7.7 | **Graduated Answer Disclosure** | The per-question `breakdown` in the submit response is disclosed on a sliding scale, because the response is the one place the answer key can legitimately leak ([TRD §5.2](./EduTRD.md)). |
| 7.8 | **Attempt History** | Implement `GET /quizzes/:id/attempts`: the caller's own attempts by default. `?userId=` is honoured **only** for the quiz's owning instructor or an Admin; any other caller passing it gets 403. Ownership resolves through `quiz.course.instructorId` — `Quiz` has no direct instructor column, so the check requires the nested relation ([apidoc.md §8.8](./docs/apidoc.md)). |

**Submission payload (Task 7.6):**
```jsonc
// Correct — each answer names its question.
{ "answers": [ { "questionId": "clx...a1", "selectedIndex": 2 },
               { "questionId": "clx...b7", "selectedIndex": 0 } ] }

// Wrong — a bare positional array.
{ "answers": [2, 0, 1] }
```

> [!CAUTION]
> **A positional answer array is a silent-miscoring bug.** It binds the submission to the server's current question ordering. Reorder a question, delete one, or serve a shuffled question set, and every answer shifts by one — the server grades confidently and reports a wrong score with no error anywhere. Naming `questionId` explicitly makes an unknown or missing id a 422 instead of a wrong grade.

**Graduated `breakdown` disclosure (Task 7.7):**

| Condition | `breakdown` contents |
| :--- | :--- |
| Passed | Full: `isCorrect` **and** `correctAnswerIndex` per question |
| Failed, attempts remaining | `isCorrect` only — never `correctAnswerIndex` |
| Failed, attempts exhausted | Full, including `correctAnswerIndex` (remediation; no further attempt can exploit it) |

> [!IMPORTANT]
> **The attempt cap is an anti-oracle control, not a fairness rule.** Returning `correctAnswerIndex` to a student who still has attempts left turns the submit endpoint into an answer-key oracle: submit all-zeros, read the key from the breakdown, resubmit with a perfect score. The cap is what bounds that loop, which is why 7.5 and 7.7 have to be implemented together — either one alone leaves the hole open ([TRD §5.2](./EduTRD.md)).

**Deliverables:**
- Instructors author multiple-choice and true/false quizzes with a per-quiz attempt budget
- Answer keys never reachable by a student through any endpoint or any response path
- Grading is entirely server-side, keyed on `questionId`
- Attempt budget enforced with 429 and no `Retry-After`
- Passing completes the linked lesson; exhausting attempts unblocks progression
- Attempts are owner-scoped; `?userId=` is instructor/admin-only

**Unit tests (same day, `src/modules/quizzes/tests/`):**
- Score math: 7/10 → 70.0%
- Pass/fail against `passingScore`, including exact-boundary equality
- `correctAnswerIndex` absent from the student serialization of `GET /quizzes/:id`
- `breakdown` omits `correctAnswerIndex` on a failed attempt with budget remaining, includes it once exhausted
- Fewer, more, duplicated, and unknown `questionId` values → 422, never a partial grade
- Submission at `maxAttempts + 1` → 429 with no `Retry-After`
- `PUT /quizzes/:id { passingScore }` after one attempt exists → 409

---

### Day 8 — Cloud Storage Integration & Resource Management

**Goal:** Integrate AWS S3 / Cloudinary for media uploads and implement the resource management module.

| # | Task | Details |
| :--- | :--- | :--- |
| 8.1 | **Storage Integration** | Implement `src/integrations/storage/index.js` with `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`: pre-signed `PUT` generation (**900s TTL**), `HeadObject` metadata lookup, deletion, and public-URL construction. Cloudinary supported as an alternative provider behind an environment flag. |
| 8.2 | **Bucket Lifecycle Rule** | All pre-signed uploads land under a **`staging/`** key prefix carrying a **24-hour expiration lifecycle rule**. Confirmation moves the object to its permanent prefix. Uploads that are never confirmed — the browser tab closed mid-upload, the client crashed — are reaped by the bucket itself rather than accumulating as unreferenced objects nothing in the database knows to delete ([TRD §5.4](./EduTRD.md)). |
| 8.3 | **Upload URL Endpoint** | Implement `POST /resources/upload-url { fileName, fileType, fileSize, courseId }`: RBAC guard (Instructor + course ownership) → validate MIME against the whitelist (`video/*`, `application/pdf`, `image/*`, `application/zip`) and size against **500 MB for video, 25 MB for documents** → return `{ uploadUrl, fileKey, publicUrl, expiresInSeconds }`. |
| 8.4 | **Signature-Bound Constraints** | `Content-Type` and `Content-Length` must be baked into the **signature** via a signed policy, not merely validated in the request body. `fileSize` and `fileType` in the request are client claims about a file the API never sees; if only the claim is checked, a caller declares a 1 MB PDF, receives the URL, and uploads a 4 GB file — S3 accepts it because nothing in the signature forbids it. With the values signed, S3 itself rejects the mismatch ([TRD §5.4](./EduTRD.md)). |
| 8.5 | **Upload Confirmation** | Implement `POST /resources/confirm { fileKey, title, description, category, courseId }`: **`HeadObject` the key** to verify the object exists and that its actual size and content type match what was signed → move it out of `staging/` → create the `Resource` row → return the record. |
| 8.6 | **Resource Listing, Direct Create & Deletion** | Implement `GET /resources?category=&courseId=&page=&limit=` (public browsing), `POST /resources` (Instructor/Admin — metadata for an already-hosted external URL, no upload flow), `DELETE /resources/:id` (owner or Admin — removes the row and the stored object). |
| 8.7 | **Avatar Upload** | Implement `POST /users/me/avatar` with `multer` in memory storage: **max 5 MB**, `image/*` only, verified against the file's magic bytes rather than the client-supplied `Content-Type` header → upload → write `user.avatarUrl`. Avatars are the **only** server-proxied upload path; everything larger goes direct-to-S3. |

> [!CAUTION]
> **Without `HeadObject`, confirmation trusts a request the client fully controls.** `POST /resources/confirm` names a `fileKey` — but nothing in that request proves an upload ever happened. A caller can request a pre-signed URL, never use it, then post the confirmation and create a `Resource` row pointing at a key with no object behind it. Students hit a 404 on a lesson resource that the instructor dashboard shows as successfully uploaded. `HeadObject` is the only thing in this flow that verifies the object's existence, size, and type against what was signed ([TRD §5.4](./EduTRD.md)).

**Size limits, consolidated:**

| Path | Limit | Mechanism |
| :--- | :--- | :--- |
| Video (pre-signed) | 500 MB | Signed policy, enforced by S3 |
| Documents (pre-signed) | 25 MB | Signed policy, enforced by S3 |
| Avatar (server-proxied) | 5 MB | `multer` limit |
| JSON request bodies | 100 kb | `express.json({ limit })` |

**Deliverables:**
- Pre-signed upload flow functional for video and documents, with limits bound into the signature
- `staging/` prefix plus a 24h lifecycle rule reaping unconfirmed uploads
- Confirmation re-verifies via `HeadObject` before any row is written
- Avatar upload validated by magic bytes at 5 MB
- Deletion removes both the row and the stored object

**Verification:**
- Request a URL declaring a 1 MB PDF, then attempt a 30 MB upload against it → S3 rejects it (proves the limit is signed, not merely validated)
- `POST /resources/confirm` with a `fileKey` that was never uploaded → 422, and no `Resource` row created
- Upload a `.exe` renamed to `.png` to the avatar route → 422 from the magic-byte check
- Confirm the bucket reports the 24h expiration rule on the `staging/` prefix

---

### Phase 2 Exit Criteria

| Criteria | Status |
| :--- | :--- |
| Full curriculum hierarchy: Course → Module → Lesson CRUD | ☐ |
| Sequential unlocking by composite `(module.orderIndex, lesson.orderIndex)`, 423 with `nextAccessibleLessonId` | ☐ |
| `isFreePreview` lessons readable without a token | ☐ |
| `Course.durationMinutes` maintained on lesson writes | ☐ |
| Curriculum edits recalculate `ACTIVE` progress; `COMPLETED` stays pinned at 100.0 | ☐ |
| Enrollment requires a verified email; instructors cannot enroll in their own course | ☐ |
| Completion recalculates progress under `FOR UPDATE`, with a zero-division guard | ☐ |
| Re-enrollment reactivates without double-counting `studentCount` | ☐ |
| Quiz submission grades server-side keyed on `questionId`, with no answer leakage | ☐ |
| `maxAttempts` enforced with 429 and no `Retry-After` | ☐ |
| `breakdown` disclosure follows the three-row graduated rule | ☐ |
| Quiz mutation returns 409 once any attempt exists | ☐ |
| Passing a quiz completes the linked lesson; exhausting attempts unblocks progression | ☐ |
| Pre-signed uploads enforce 500 MB / 25 MB **in the signature**, land in `staging/`, and are `HeadObject`-verified on confirm | ☐ |
| Avatar upload works at 5 MB with magic-byte validation | ☐ |

---

## Phase 3: Gamification, Dashboards & Communication (Days 9–12)

**Objective:** Build the gamification engine (achievements, badges, streaks), PDF certificate generation pipeline, aggregated dashboard analytics for students and instructors, transactional email integration, and the remaining engagement modules (bookmarks, reviews, notifications). By the end of Phase 3, the platform feels complete from a user-experience perspective.

---

### Day 9 — Achievement Engine & Certificate Generation

**Goal:** Implement the gamification rules engine and the automated PDF certificate issuance pipeline.

| # | Task | Details |
| :--- | :--- | :--- |
| 9.1 | **Achievement Evaluation Engine** | Implement `src/modules/achievements/achievements.service.js` with `evaluateAchievements(userId)`: gather the four metrics the `AchievementCriteria` enum names — completed courses, perfect quiz scores (`QuizAttempt.score = 100`), streak days (`UserStreak.currentStreak`), completed lessons — then compare each against the seeded `Achievement` rows, dispatching on **`criteriaType`** and comparing against **`criteriaValue`** → insert newly unlocked rows → notify per badge. The dispatch is a `switch` over enum members, never a string match on a free-text column: `criteria` and `threshold` are not fields on this model ([TRD §4.2](./EduTRD.md), §6.11). Achievements are **evaluated, never assigned**: there is no endpoint that grants a badge to a user, and none should exist ([apidoc.md §8.12](./docs/apidoc.md)). |
| 9.2 | **Idempotent Award** | Awards use `createMany({ data, skipDuplicates: true })` against the `@@unique([userId, achievementId])` constraint. The evaluator runs on every completion event and will re-derive already-earned badges every time; `skipDuplicates` turns that into a no-op instead of a constraint violation, without a read-then-write race between the check and the insert. |
| 9.3 | **Achievement Trigger Points** | Hook `evaluateAchievements()` into all **three** trigger points [TRD §6.11](./EduTRD.md) and [apidoc.md §8.12](./docs/apidoc.md) name: lesson completion, quiz submission, **and course completion**. Omitting the third is not a gap in coverage of a rare event — `COURSES_COMPLETED` is one of the four seeded criteria kinds, and course completion is the only event that can satisfy it, so those badges would never be awarded by any path. |
| 9.4 | **Achievement Endpoints** | Implement `GET /achievements` (public catalog of all definitions with `title`, `description`, `icon`, `criteriaType`, `criteriaValue`) and `GET /users/me/achievements` (earned badges plus progress toward unearned ones). Admin CRUD over the catalog lands on Day 13. |
| 9.5 | **PDF Certificate Generator** | Implement `src/utils/certificate-generator.js` with `pdfkit`: student name, course title, completion date, certificate number `EDU-YYYY-XXXXX`, and a verification URL. Returns a stream. |
| 9.6 | **Certificate Issuance (Record Only)** | On 100% completion, inside the completion transaction: generate the certificate number and create the `Certificate` row with **`certificateUrl = null`**. **Render no PDF here.** Notify the student and dispatch the congratulatory email with a link, not an attachment. |
| 9.7 | **Lazy PDF Rendering** | `GET /certificates/:id/download` renders on first request: if `certificateUrl` is null → render → upload → persist the URL → stream; otherwise redirect to the stored URL. Rendering is idempotent — a second concurrent first-download may render twice, which is wasteful but harmless, since the certificate number is already fixed in the row. |
| 9.8 | **Certificate Endpoints** | Implement `GET /certificates/:certificateNo` (public verification — no auth, returns holder name, course title, issue date, and nothing else), `GET /certificates/:id/download` (**owner only** — [TRD §6.8](./EduTRD.md) and [apidoc.md §8.9](./docs/apidoc.md) both scope this to the certificate holder, and an admin has no stated need for the rendered PDF that the public verification endpoint does not already serve), `GET /users/me/certificates`. |

> [!IMPORTANT]
> **Evaluation runs *inside* the completion transaction; only the outbound email leaves it.** [TRD §5.1](./EduTRD.md) numbers "evaluate & award achievements" and "insert `Notification` rows" as steps 8 and 9 of the single synchronous `$transaction`, and that placement is what makes 9.2's idempotency claim true: a `createMany({ skipDuplicates: true })` that commits with the progress write can be replayed safely, while one that commits separately can leave a badge awarded for a completion that rolled back — or, in the other order, a completion with no badge and no record that evaluation was ever owed. Both halves are cheap: counter reads and one insert, no external I/O. What must **not** be in the transaction is the send — `sendAchievementEmail()` and any push dispatch run after commit, because a provider timeout inside the transaction rolls back the lesson the student just finished.

> [!CAUTION]
> **Certificate generation must not be eager.** Rendering a PDF and uploading it to S3 inside the completion transaction puts a CPU-bound render and a network round-trip on the critical path of a student clicking "mark complete" on their last lesson — the request that is most likely to be retried impatiently. Worse, if the upload fails the transaction rolls back and the student's final lesson completion is lost, so the course reverts to 99% and the certificate is never issued at all. Deferring the render decouples the two: the row is cheap and transactional, the PDF is expensive and retryable ([TRD §5.1](./EduTRD.md)).

> [!NOTE]
> **`certificateUrl` is null between issuance and first download.** Any client reading it must treat null as "not yet rendered," not as "no certificate" — the `Certificate` row is the authoritative proof of completion, and the URL is a cache of one rendering of it. This is stated in [apidoc.md §8.9](./docs/apidoc.md) and is the one externally visible consequence of the lazy design.

**Deliverables:**
- Badges unlock on all three trigger events, idempotently, inside the completion transaction — the email dispatch alone runs after commit
- Public achievement catalog and per-user earned/progress view
- Certificate rows created transactionally on completion with a null URL
- PDF rendered on first download, then cached
- Public verification by certificate number, exposing no more than the credential itself

**Unit tests (same day, `src/modules/achievements/tests/`, `src/modules/certificates/tests/`):**
- Criteria matching for each of the four `AchievementCriteria` variants, tested at `criteriaValue` and one below
- A `COURSES_COMPLETED` badge is awarded by the course-completion trigger, not only by a later unrelated event
- Re-running the evaluator awards nothing new and raises no constraint error
- Certificate number matches `EDU-\d{4}-[A-Z0-9]{5}`
- Re-completing a course does not issue a second certificate
- First download populates `certificateUrl`; the second does not re-render
- `GET /certificates/:id/download` as a non-owner Admin → 403

---

### Day 10 — Student & Instructor Dashboards

**Goal:** Build the aggregated analytics dashboard endpoints that power the frontend dashboard views for both students and instructors.

| # | Task | Details |
| :--- | :--- | :--- |
| 10.1 | **Student Dashboard** | Implement `GET /users/me/dashboard` aggregating: total enrolled, active, and completed courses; overall completion rate; current and longest streak; **total learning hours summed from `Course.durationMinutes` across completed courses** (the field added on Day 0.5 — this metric is not computable without it); recent activity (last 5 lesson completions); next accessible lesson per active course. |
| 10.2 | **Instructor Dashboard** | Implement `GET /instructors/me/dashboard` aggregating: published course count, **total lifetime students** (`instructor.studentCount` — a lifetime figure, so it will exceed the sum of currently-active enrollments, and that is correct), average rating across courses, total reviews, enrollment trend for the last 30 days grouped by date, top course by `studentCount`, and recent enrollments. |
| 10.3 | **Instructor Course Management** | Implement `GET /instructors/me/courses`: every owned course with draft/published state, `studentCount`, average rating, and review count. Sortable by `createdAt`, `studentCount`, `rating`. |
| 10.4 | **No Monetary Figures on the Instructor Surface** | The instructor dashboard and course list report **no revenue, earnings, or payout figure of any kind**. `Course.price` exists and is displayed in the catalog, but the platform has no payment integration, no transaction ledger, and no fee or refund model — any "revenue" number would be `price × studentCount`, an invented figure attached to money that was never collected and shown to the person who would act on it. The single platform-wide aggregate lives on the admin analytics endpoint under the deliberately non-committal name `grossMerchandiseValue` (Day 14) ([TRD §6.9](./EduTRD.md)). |
| 10.5 | **Public Instructor Profile** | Implement `GET /instructors/:id`: bio, avatar, rating, `studentCount`, course count, and published courses only. Unpublished and soft-deleted courses must not leak here. |
| 10.6 | **User Profile Module** | Implement `GET /users/:id` (public profile), `PUT /users/me` (fullName, bio, social links). `passwordHash` is excluded by an explicit Prisma `select` on every path that returns a user, including nested includes such as a review author or an instructor's `user` relation — the nested cases are where it actually leaks. |

**Deliverables:**
- Student dashboard with learning metrics including total hours
- Instructor dashboard with teaching analytics and 30-day enrollment trend, and no monetary figure
- Public instructor profiles exposing published courses only
- Profile updates with `passwordHash` excluded on nested paths as well as top-level

**Verification:**
- `GET /instructors/me/dashboard` → assert the response contains no key matching `/revenue|earning|payout|income/i`
- `GET /instructors/:id` for an instructor holding one draft course → the draft is absent
- `GET /courses/:slug` with reviews included → no `passwordHash` anywhere in the tree

---

### Day 11 — Bookmarks, Reviews & Email Integration

**Goal:** Implement the remaining engagement modules and integrate the transactional email service.

| # | Task | Details |
| :--- | :--- | :--- |
| 11.1 | **Bookmarks Module** | Implement `POST /bookmarks/toggle { courseId? , lessonId? }` (idempotent — creates if absent, deletes if present) and `GET /bookmarks` (paginated, with course/lesson detail). Exactly one of `courseId` / `lessonId` must be present: **both** or **neither** is a 422. A polymorphic bookmark with both set has no defined meaning and no unique constraint that can express it. |
| 11.2 | **Reviews Module** | Implement `POST /courses/:courseId/reviews { rating, comment }` (**enrolled** students — enrollment is the only gate; [TRD §6.8](./EduTRD.md) does not require a verified email here, and `@@unique([userId, courseId])` enforces one review per student per course), `GET /courses/:courseId/reviews` (paginated, with author name and avatar), `PUT /reviews/:id` (author only), `DELETE /reviews/:id` (author, or Admin moderating — an **admin** deletion writes `AuditLog (REVIEW_DELETED)` in the same transaction as the delete, per [TRD §6.8](./EduTRD.md); an author deleting their own review does not). |
| 11.3 | **Review Route Addressing** | Mutations address the review by **its own id** — `PUT /reviews/:id`, not `PUT /courses/:courseId/reviews`. Addressing by course implies "the review belonging to the caller for this course," which makes admin moderation unreachable: an admin deleting another student's review has no way to name it, since the caller's identity is the only selector in the path. Review id in the path makes the same route serve both the author and the moderator, with authorization deciding which ([apidoc.md §8.9](./docs/apidoc.md)). |
| 11.4 | **Review Aggregation** | On review create, update, and delete: recalculate `course.rating` as the mean of that course's reviews and update `reviewCount`, inside the same `prisma.$transaction` as the review write. `Review` carries no `deletedAt` ([TRD §4.2](./EduTRD.md)), so deletion is a hard delete and the aggregate is over all remaining rows — there is no live-vs-deleted filter to apply here, and adding one means filtering on a column that does not exist. **In the same transaction, recompute `instructor.rating`** as the enrollment-weighted average of that instructor's published courses' ratings ([TRD §4.2](./EduTRD.md)) — weighting by `studentCount` so a 5.0 on a course with two students cannot outrank a 4.6 on a course with two thousand. |
| 11.4a | **Update Changes the Average, Not the Count** | All three write paths recompute `rating`, but only create and delete move `reviewCount`. An edit from 2★ to 5★ changes the mean while the count is unchanged, so a handler that recomputes the average only when the count changes leaves the rating permanently stale ([TRD §4.2](./EduTRD.md)). Recompute `rating` with `AVG()` over the current rows rather than adjusting the stored value arithmetically — incremental adjustment needs the review's *previous* rating, which the update has already overwritten by the time the aggregate runs. |
| 11.5 | **Email Integration (Replace Stub)** | Replace the Day 3 console stub in `src/integrations/email/index.js` with the real SendGrid / Brevo REST client (`axios`). The exported interface (`sendVerificationEmail`, `sendPasswordResetEmail`, `sendEnrollmentConfirmation`, `sendCourseCompletionEmail`, `sendTakedownNotice`, `sendAccountStatusEmail`) is unchanged — only `logger.info()` becomes `axios.post()`. Add HTML templates for all six types. |
| 11.6 | **Email Delivery Webhook** | Implement `POST /webhooks/email` ([TRD §6.11](./EduTRD.md)): verify the provider's HMAC signature over the **raw** body against `EMAIL_WEBHOOK_SECRET` → write the event onto the matching row as `Notification.deliveryState` + `deliveredAt` → on `bounce` or `spam`, set `User.emailBounced = true` so the platform stops sending to a dead mailbox. Those three columns were added to §4.2 in Day 0.13; without them this task has nowhere to write. `deliveryState` is a free-text String on purpose — an unrecognised provider event must be stored, not throw, because a 500 here makes the provider redeliver the same payload indefinitely. Unauthenticated by design (no user session exists), so the signature **is** the authentication. Depends on the `express.raw()` mount from Day 2. |
| 11.7 | **Email Dispatch Verification** | Confirm every existing dispatch point (registration, forgot-password, enrollment, course completion, admin unpublish, admin ban/unban) now sends through the real client. No call site changes, since the stub interface was designed to match. |
| 11.8 | **Email Resilience** | Dispatch happens **after** the database transaction commits, never inside it. Failures are logged via `pino` and never roll back a user-facing operation. Retry up to 3 times with exponential backoff; a hard bounce is not retried. |

> [!CAUTION]
> **The webhook route must be mounted before `express.json()`** (Day 2, task 2.1). Signature verification runs over the exact bytes the provider signed. Once the JSON parser has consumed the stream, those bytes are gone and re-serializing `req.body` produces a different sequence — different key order, different whitespace, different unicode escaping — so the HMAC never matches and every legitimate webhook is rejected as a forgery ([TRD §6.11](./EduTRD.md)).

> [!IMPORTANT]
> **An email send inside a transaction converts a delivery failure into data loss.** If the provider is slow, the transaction holds its locks for the duration of an HTTP call to a third party; if the provider errors, the transaction rolls back and the enrollment that triggered the email is discarded. The user sees a failed enrollment because a mail server was down. Commit first, then dispatch.

**Deliverables:**
- Bookmark toggle for courses and lessons, with the xor constraint enforced
- Reviews addressed by review id, so admin moderation is reachable
- `course.rating` and `reviewCount` recalculated transactionally, with `instructor.rating` recomputed alongside
- Real transactional email for all six event types
- `POST /webhooks/email` verifying HMAC over the raw body, with bounce suppression
- Email failures non-blocking and logged

**Verification:**
- `POST /bookmarks/toggle` with both `courseId` and `lessonId` → 422; with neither → 422
- Author edits their review via `PUT /reviews/:id` → 200; a different student on the same id → 403; an Admin → 200
- Post two reviews, delete one → `course.rating` reflects only the surviving review
- Edit a review from 2★ to 5★ → `course.rating` moves, `reviewCount` does **not**, and `instructor.rating` moves with it
- Replay a captured webhook body with one byte altered → rejected; unaltered → accepted
- Stop the email provider (point `EMAIL_API_URL` at a closed port) → enrollment still returns 201, failure appears in the logs

---

### Day 12 — Notification Endpoints & Polish

**Goal:** Complete the notification system with user-facing endpoints and polish all Phase 3 deliverables.

| # | Task | Details |
| :--- | :--- | :--- |
| 12.1 | **Notification Endpoints** | Implement `GET /notifications?page=&limit=` (paginated, with `unreadCount` in the response metadata), `PATCH /notifications/:id/read`, and `PATCH /notifications/read-all`. |
| 12.2 | **Route Registration Order** | Register `/notifications/read-all` **before** `/notifications/:id/read`. Registered the other way, Express 5 matches the parameterised route first and `read-all` arrives as an `:id` — producing a 404 for a notification that never existed, on the one route a user hits when their list is full. Same rule as Day 4 task 4.4. |
| 12.3 | **Owner Scoping** | Marking a notification that belongs to another user returns **404, not 403**. A 403 confirms the notification exists, which turns the endpoint into an existence oracle over other users' notification ids; 404 is indistinguishable from a bad id ([apidoc.md §8.10](./docs/apidoc.md)). |
| 12.4 | **Notification Triggers Audit** | Verify notifications fire for: new enrollment, course completion, certificate issued, achievement unlocked, role change, account ban, account unban, and course takedown. |
| 12.5 | **Redis Caching Review** | Confirm catalog reads (`GET /courses`, `/courses/featured`, `/subjects`) are cached at the right TTLs, and that invalidation fires on publish, unpublish, soft-delete, restore, and review changes. Verify every invalidation path uses **`SCAN` + `UNLINK`**, never `DEL` with a glob and never `KEYS`. |
| 12.6 | **Cache Failure Policy** | Cache reads **fail open**: a Redis error on a catalog read falls through to PostgreSQL and serves the request. This is the deliberate opposite of the security-read policy from Day 3, where an unreadable `user:state:<id>` fails closed with 503. Both policies must be present in the codebase simultaneously and neither should be "simplified" into the other ([TRD §7.1](./EduTRD.md)). |
| 12.7 | **Response Sanitization Audit** | Sweep every endpoint: `passwordHash` absent including in nested relations; `correctAnswerIndex` absent for students; `deletedAt` rows excluded from public queries; banned users' authored content handled without a null dereference. |
| 12.8 | **Swagger Annotation Sweep** | Ensure every Phase 2 and Phase 3 route carries `swagger-jsdoc` annotations, so the generated spec covers them. Verify against the live `/api-docs` render, not against the source annotations. |

**Deliverables:**
- Notifications with unread counts, correct route ordering, and owner-scoped 404s
- All trigger points verified
- Cache invalidation via `SCAN` + `UNLINK`, with reads failing open
- No sensitive data leakage on any path
- `/api-docs` covering every implemented endpoint

**Verification:**
- `PATCH /notifications/read-all` → marks all read (proves registration order); a 404 here means the ordering is wrong
- `PATCH /notifications/:id/read` against another user's notification → 404
- `docker compose stop redis`, then `GET /courses` → **200** served from PostgreSQL; `GET /users/me` → **503**. Both behaviours, same outage.

---

### Phase 3 Exit Criteria

| Criteria | Status |
| :--- | :--- |
| Achievements auto-unlock idempotently at all **three** triggers — lesson completion, quiz submission, and course completion | ☐ |
| Achievement catalog readable at `GET /achievements`; no endpoint assigns a badge directly | ☐ |
| `Certificate` row created transactionally with `certificateUrl = null` — **no PDF rendered on completion** | ☐ |
| PDF renders on first download, then serves from the stored URL | ☐ |
| Public certificate verification works without authentication | ☐ |
| Student dashboard reports total learning hours from `durationMinutes` | ☐ |
| Instructor dashboard reports **no** revenue, earnings, or payout figure | ☐ |
| Bookmarks enforce the `courseId` xor `lessonId` constraint | ☐ |
| Reviews addressed as `PUT\|DELETE /reviews/:id`; admin moderation reachable | ☐ |
| `course.rating`, `reviewCount`, and `instructor.rating` recalculated in one transaction on create, update, **and** delete | ☐ |
| Transactional email dispatched after commit, never inside the transaction | ☐ |
| `POST /webhooks/email` verifies HMAC over the raw body, writes `Notification.deliveryState` / `deliveredAt`, and sets `User.emailBounced` on a hard bounce | ☐ |
| `/notifications/read-all` resolves before `/:id/read`; cross-user access returns 404 | ☐ |
| Redis down ⇒ catalog reads 200 (fail open) while authenticated routes 503 (fail closed) | ☐ |

---

## Phase 4: Administration, Testing & Production Deployment (Days 13–16)

**Objective:** Build the administrative governance suite (content moderation, user management, analytics, audit logs), write comprehensive integration and end-to-end tests, and prepare the application for production deployment with Docker and CI/CD pipelines.

---

### Day 13 — Admin Module: Course Moderation & User Governance

**Goal:** Implement the full admin moderation toolkit for content oversight and user account management.

| # | Task | Details |
| :--- | :--- | :--- |
| 13.1 | **Admin Course Listing** | Implement `GET /admin/courses?isPublished=&deleted=&search=&sort=&page=&limit=`: every course including unpublished and soft-deleted, with instructor detail and `studentCount`. `?deleted=true` returns only soft-deleted rows, `?deleted=false` only live ones, and omitting it returns both — without the filter, admins have no way to find a soft-deleted course in order to restore it ([apidoc.md §8.11](./docs/apidoc.md)). |
| 13.2 | **Course Unpublish (Takedown)** | Implement `PATCH /admin/courses/:id/unpublish { reason }`: `isPublished = false` → **decrement `subject.courseCount`** (live counter — the transition guard from Day 4 applies here too, so a second unpublish of an already-unpublished course decrements nothing) → write `AuditLog` with `actionType = COURSE_REJECTED` → invalidate the catalog cache → email the instructor with the reason. One `prisma.$transaction`. |
| 13.3 | **Course Republish** | Implement `PATCH /admin/courses/:id/republish { reason }`: the inverse — `isPublished = true`, increment `subject.courseCount`, write `AuditLog (COURSE_REPUBLISHED)`, invalidate, notify. Without it, a takedown made in error is unrecoverable through the API and the only remedy is a manual `UPDATE` against production ([TRD §6.10](./EduTRD.md)). |
| 13.4 | **Course Soft-Delete** | Implement `DELETE /admin/courses/:id { reason }`: `deletedAt = now()` **and `isPublished = false` in the same update** → if the course was published, **also decrement `subject.courseCount`** → `AuditLog (COURSE_DELETED)` → invalidate → notify. Forcing `isPublished` is not redundant with the `deletedAt` filter ([TRD §5.5](./EduTRD.md), [apidoc.md §8.6](./docs/apidoc.md)): leaving it `true` makes the row simultaneously deleted and published, so restore (13.5) cannot tell a taken-down course from a draft, and `subject.courseCount` reconciliation — which counts `isPublished = true AND deletedAt IS NULL` — reports the row as drift on every run. Enrollment, progress, and certificate rows are preserved: a student who completed the course keeps a valid, verifiable certificate. |
| 13.5 | **Course Restore** | Implement `PATCH /admin/courses/:id/restore { reason }`: `deletedAt = null`, `AuditLog (COURSE_RESTORED)`, invalidate. Restore returns the course to **draft** — it does not silently republish, and it does not increment `courseCount`; republishing is a separate, separately-audited decision. |
| 13.6 | **Admin User Listing** | Implement `GET /admin/users?role=&isBanned=&deleted=&search=&sort=&page=&limit=`: role, banned state, email-verification state, creation date. `?deleted=` behaves as in 13.1. |
| 13.7 | **Role Management** | Implement `PATCH /admin/users/:id/role { role }`: update the role → if elevating to `INSTRUCTOR`, create the `Instructor` profile through the same Day 4 helper → `AuditLog (ROLE_CHANGED)` → **rewrite `user:state:<id>` in Redis** → notify. Without the Redis write the change is invisible for up to the `user:state` TTL, so a freshly promoted instructor is still refused by RBAC. |
| 13.8 | **Role Demotion Conflict** | Demoting an `INSTRUCTOR` who owns **published courses** returns **409 Conflict**, listing the blocking courses. Ownership of a published course is the whole test — enrollment count is not part of it ([apidoc.md §8.11](./docs/apidoc.md), [TRD §5.6](./EduTRD.md)): a published course with zero enrollments is still publicly listed and still enrollable, so gating on active enrollments would let a demotion leave a live catalog entry behind. `?force=true` proceeds, unpublishing every owned course in the same transaction and auditing each one. A silent demotion would leave published courses whose owner can no longer administer them — students remain enrolled in a course nobody can edit, and no error is raised anywhere. |
| 13.9 | **User Ban** | Implement `POST /admin/users/:id/ban { reason }`: `isBanned = true` → `AuditLog (USER_BANNED)` → revoke every session via the index set → **write `isBanned` into `user:state:<id>`** → return `revokedSessions` count → email the user. |
| 13.10 | **User Unban** | Implement `POST /admin/users/:id/unban { reason }`: `isBanned = false` → `AuditLog (USER_UNBANNED)` → rewrite `user:state:<id>` → notify. Sessions are **not** restored; the user logs in again. |
| 13.11 | **Achievement Catalog Admin** | Implement `POST /admin/achievements`, `PUT /admin/achievements/:id`, `DELETE /admin/achievements/:id` over the badge catalog (`title`, `description`, `icon`, `criteriaType`, `criteriaValue` — the §4.2 column names; `criteria` and `threshold` do not exist). `criteriaType` validates against the `AchievementCriteria` enum, so an unknown value is a 422. Deleting a definition **cascades its `UserAchievement` rows** ([TRD §6.11](./EduTRD.md), [apidoc.md §8.12](./docs/apidoc.md)) — it does not 409. The badge is withdrawn from the catalog, so nothing is left to display; a 409 would make an achievement created by mistake permanently undeletable the moment one user earns it. Raising `criteriaValue` on an existing definition does **not** retroactively revoke rows already earned under the old threshold. |

**Session revocation (Tasks 13.9–13.10):**
```js
// Correct — the index set names every session for this user.
const jtis = await redis.smembers(keys.sessionIndex(userId));
const revokedSessions = jtis.length
  ? await redis.unlink(...jtis.map(keys.session))   // count the keys that actually existed
  : 0;
await redis.unlink(keys.sessionIndex(userId));

// user:state is a String holding the whole state object, not a hash of fields.
await redis.set(
  keys.userState(userId),
  JSON.stringify({ role: user.role, isBanned: true, isEmailVerified: user.isEmailVerified, deletedAt: null }),
  'EX', 900,                                         // closes the access-token window
);
return { revokedSessions };

// Wrong — deletes nothing and reports success.
await redis.del(`session:${userId}:*`);   // returns 0; the ban has no effect until every token expires
```

> [!WARNING]
> **Two ways this snippet goes wrong in the obvious rewrite.** First, `redis.hset(keys.userState(id), { isBanned: 'true' })` type-collides with the `SET`/`GET` reads from Day 1.7 — `HSET` against a key `SET` created raises `WRONGTYPE`, and if the ban happens to land on a cache miss the hash *is* created, after which every `requireAuth` read of that key throws instead of returning state. A partial field write is wrong even in a hash: `user:state` carries `role`, `isBanned`, `isEmailVerified`, and `deletedAt` together, so writing one field alone leaves the guard with no role to check. Rewrite the whole object, with the 15-minute TTL reapplied — a `SET` without `EX` makes the key immortal.
>
> Second, `revokedSessions: jtis.length` over-reports. The index set has no TTL while the session keys expire at 7 days, so it accumulates `jti`s whose sessions are already gone; `UNLINK`'s return value is the number of keys that actually existed, which is the number of sessions genuinely revoked. AC-13's assertion ("two sessions → `revokedSessions: 2`") passes either way on a fresh account and diverges silently on a long-lived one.

> [!CAUTION]
> **`AuditActionType` values are enum members, not free text, and the plausible name is not always the real one.** The nine members declared in [TRD §4.2](./EduTRD.md) are `COURSE_APPROVED`, `COURSE_REJECTED`, `COURSE_DELETED`, `COURSE_RESTORED`, `COURSE_REPUBLISHED`, `USER_BANNED`, `USER_UNBANNED`, `ROLE_CHANGED`, `REVIEW_DELETED`. Note the two that read as if they should exist and do not: the takedown action writes **`COURSE_REJECTED`**, not `COURSE_UNPUBLISHED`, and the role action writes **`ROLE_CHANGED`**, not `USER_ROLE_CHANGED`. Prisma rejects a non-member at write time, so the audit insert throws inside the governance transaction and rolls back the moderation action itself — the takedown appears to fail for no visible reason, and the operator sees a 500 on a request that was entirely valid.

> [!IMPORTANT]
> **Every destructive admin action is reversible and separately audited.** Unpublish ↔ republish, soft-delete ↔ restore, ban ↔ unban. The audit row records `adminId`, `actionType`, `targetType`, `targetId`, `reason`, and timestamp, and is written **inside the same transaction** as the action — an action that commits without its audit row, or an audit row for an action that rolled back, both make the log untrustworthy as a governance record.

**Deliverables:**
- Admin browses, unpublishes, republishes, soft-deletes, and restores courses, each with a reason and an audit row
- `subject.courseCount` decrements on unpublish and on soft-delete of a published course, transition-guarded
- Role changes and bans rewrite `user:state:<id>` so RBAC sees them immediately
- Role demotion blocked by 409 when published courses are owned, with an explicit `?force=true` override
- Bans revoke every session through the index set and report a count taken from `UNLINK`, not from the index length
- Achievement catalog CRUD on `criteriaType` / `criteriaValue`, with deletion cascading `UserAchievement`

**Verification:**
- Log in twice as one user (two sessions) → ban → `revokedSessions: 2`, and **both** access tokens are refused
- Unpublish then republish → `subject.courseCount` returns to its original value
- Soft-delete a published course → `courseCount` decrements **and `isPublished` is now `false`**; restore → the course is a **draft** and `courseCount` does not change
- Demote an instructor owning a published course with **no** enrollments → 409 naming the course; retry with `?force=true` → 200 and the course is unpublished
- `DELETE /admin/achievements/:id` for an awarded badge → 200, and the holder's `UserAchievement` row is gone

---

### Day 14 — Admin Analytics, Audit Logs & Edge Cases

**Goal:** Build platform-wide analytics, the audit log query system, and handle remaining edge cases across all modules.

| # | Task | Details |
| :--- | :--- | :--- |
| 14.1 | **Platform Analytics** | Implement `GET /admin/analytics`: users by role; courses by published/draft/deleted; enrollments by active/completed/dropped; total quiz attempts; completion rate; average rating; new users this month; 30-day enrollment trend; and **`grossMerchandiseValue`** — the summed `Course.price` of paid enrollments ([TRD §6.10](./EduTRD.md); the rename and its rationale are in [§6.3](./EduTRD.md)). |
| 14.2 | **What `grossMerchandiseValue` Is Not** | It is **not revenue**, and must be labelled *indicative, pre-monetization* in the response. No payment was processed, no fee deducted, no refund or discount modelled, nothing collected — the MVP has no `Transaction` model to reconcile against, so a field named `revenue` would be a figure that reconciles against nothing while attracting exactly the finance-grade trust it cannot support. The rename is the control, not a cosmetic choice. It appears **only** here, on the admin surface, never on an instructor-facing endpoint (Day 10 task 10.4) — an instructor reading "revenue" would reasonably expect a payout to follow ([TRD §6.3](./EduTRD.md)). |
| 14.3 | **Audit Log Query** | Implement `GET /admin/audit-logs?actionType=&targetType=&adminId=&startDate=&endDate=&page=&limit=`: filterable trail with admin detail, target detail, reason, and timestamp. `actionType` and `targetType` validate against the `AuditActionType` / `AuditTargetType` enums, so an unknown value is a 422 rather than a silently empty result set. Audit rows are **append-only** — no update or delete endpoint exists, and none should. |
| 14.4 | **Account Self-Deletion** | Implement `DELETE /users/me` ([TRD §6.2](./EduTRD.md), AC-16): stamp `deletedAt`, then **anonymize in place** — `email` → `deleted-<uuid>@invalid`, `fullName` → `"Deleted User"`, `avatarUrl` and `bio` cleared — revoke every session via the index set, and delete `user:state:<id>`. A subsequent request bearing the still-valid JWT must return **403**, which AC-16 asserts explicitly. Enrollments, quiz attempts, and certificates are retained; authored reviews survive, rendered as by "Deleted User". |
| 14.5 | **Why Anonymize Instead of Cascade** | A hard delete would cascade into `Enrollment`, `LessonProgress`, and `Certificate`, destroying the completion record behind certificates already issued, downloaded, and shown to employers — public verification of a genuine credential would begin returning 404 — and it would corrupt the instructor analytics those enrollments feed. Rewriting the email rather than nulling it is deliberate on two counts: it preserves the `@unique` constraint, and it frees the original address for reuse, which retaining it would prevent and which is what makes the anonymization actually effective. |
| 14.6 | **Counter Reconciliation Script** | Implement `npm run db:reconcile` (AC-18): recompute all **six** denormalized aggregates from their source tables — `Subject.courseCount`, `Course.studentCount`, `Instructor.studentCount`, `Course.rating`, `Course.reviewCount`, and `Instructor.rating` ([TRD §4.2](./EduTRD.md)) — report every divergence, and repair with `--fix`. The TRD's table counts **five rows** because `Course.rating` and `Course.reviewCount` share one; they are six distinct columns to recompute. Because all six are derivable by `COUNT`/`AVG`, drift is always recoverable but never self-announcing: an aborted transaction, a hotfix bypassing a guard, or a manual `UPDATE` leaves a wrong number that no query errors on. Default to **report-only**; `--fix` must be explicit. [TRD §9.1](./EduTRD.md) also runs this in CI against the seeded database as a drift assertion. |
| 14.7 | **Edge Case Hardening** | Delete a subject holding courses → 409 (Day 4). Instructor enrolling in their own course → 422. Reviewing without completing lessons → **allowed** (students may review early; the constraint is enrollment, not completion). Rapid duplicate quiz submissions → each consumes an attempt, since a resubmission is a legitimate second attempt and cannot be deduplicated without discarding real ones. Concurrent enrollments → the plain composite `@@unique([userId, courseId])` on `Enrollment` raises `P2002`, mapped to 409. That constraint is a Prisma-declared unique in the schema (task 1.4), **not** one of the hand-written partial indexes from 1.4a — enrollment uniqueness is deliberately unscoped so a `DROPPED` row still occupies the slot and re-enrollment goes through the upsert reactivation path ([TRD §4.2](./EduTRD.md)). |
| 14.8 | **Soft-Delete Query Guards** | Audit every query across every module for a consistent `deletedAt IS NULL` filter on the **two** models that carry the column — `User` and `Course` ([TRD §4.2](./EduTRD.md)) — including **nested** includes, which is where the omissions actually are: a live course's review list including a soft-deleted author, or an instructor profile including soft-deleted courses. `Review` has no `deletedAt` and must not be filtered on one; a `where: { deletedAt: null }` against it is a Prisma validation error at query-build time, not a silently empty result. |
| 14.9 | **Error Response Standardization** | Final sweep: every error is `{ status: "error", message, errors? }` with `status` as a **string**. No `{ success: false }`, no bespoke payload keys. Production masks stack traces and internal messages; a 500 returns a generic message with the request id for log correlation. |

**Deliverables:**
- Platform analytics including `grossMerchandiseValue`, admin-only
- Append-only audit log with enum-validated filters
- `DELETE /users/me` anonymizing in place, leaving certificates verifiable
- `npm run db:reconcile` reporting drift, repairing only under `--fix`
- Consistent soft-delete filters including nested includes
- Uniform error envelope with `status` as a string

**Verification:**
- `GET /admin/analytics` → `grossMerchandiseValue` present; `GET /instructors/me/dashboard` → no monetary key at all
- `GET /admin/audit-logs?actionType=NONSENSE` → 422, not an empty page
- Complete a course, download the certificate, then `DELETE /users/me` → `GET /certificates/:certificateNo` still resolves, holder shown as "Deleted User"
- Manually `UPDATE "Course" SET "studentCount" = 999`, run `npm run db:reconcile` → drift reported and **not** repaired; rerun with `--fix` → repaired
- Fire two concurrent `POST /enrollments` for the same course → one 201, one 409, exactly one `ACTIVE` row

---

### Day 15 — Integration & End-to-End Testing

**Goal:** Write comprehensive test suites covering critical paths, security boundaries, and business logic.

| # | Task | Details |
| :--- | :--- | :--- |
| 15.1 | **Fix Test Collection** | `vitest.config.js` currently sets `include: ['src/**/*.test.js']`, which never matches the `tests/` tree that every integration suite lives in. Widen it to `['src/**/*.test.js', 'tests/{unit,integration}/**/*.test.js']`. Until this is fixed the suite reports green having collected **zero** integration tests — the most dangerous possible failure mode, because it looks exactly like success (Day 0.9). |
| 15.2 | **Test Infrastructure** | Point setup at `DATABASE_URL_TEST` / `REDIS_URL_TEST`; run `prisma migrate deploy` plus seed on setup and truncate between suites; add factories (`makeUser`, `makeCourse`, `makeEnrollment`, `makeQuiz`) and an auth helper that mints real tokens through the auth service rather than hand-signing them, so token shape can never drift from production. Add the missing npm scripts (Day 0.8) — CI invokes `npm run test:run`. |
| 15.3 | **Auth Flow Tests** | Registration → verification → login → protected route → refresh → logout. Assert: bad credentials 401; banned 403; expired token 401; replayed refresh token 401; refresh token used as a Bearer token 401; **Redis down → 503 on authenticated routes, never 200**. |
| 15.4 | **RBAC & Access Boundary Tests** | Students cannot create courses (403). Instructors cannot modify another instructor's course (403). Admin can perform every operation. Lesson access resolves to the full matrix, not a single status. |
| 15.5 | **Progress Engine Tests** | Completion recalculates correctly; 100% issues a certificate row **with a null URL** and evaluates achievements; re-completion is idempotent; zero-lesson course returns 0.0%; concurrent completions of different lessons both land (the Day 6 row lock); adding a lesson recalculates `ACTIVE` and leaves `COMPLETED` at 100.0. |
| 15.6 | **Quiz Assessment Tests** | Answer keys absent for students; grading keyed on `questionId`; unknown or duplicate ids → 422; `maxAttempts + 1` → 429 with **no** `Retry-After`; `breakdown` withholds `correctAnswerIndex` while attempts remain and discloses it once exhausted; mutation after an attempt → 409; `?userId=` on attempts → 403 for a non-owner. |
| 15.7 | **Admin Governance Tests** | Unpublish decrements `subject.courseCount` and invalidates cache; republish restores it; ban revokes **all** sessions and returns a `revokedSessions` count matching the sessions that existed; audit rows are written for every governance action with the correct enum member; demoting an instructor who owns a published course → 409 **even with zero enrollments on it**, and `?force=true` unpublishes; soft-delete forces `isPublished = false`; deleting an awarded achievement definition cascades its `UserAchievement` rows; unbanned users can log in again. |
| 15.8 | **Enrollment Edge Case Tests** | Re-enrollment reactivates **without incrementing** `studentCount`; duplicate active enrollment → 409; unpublished or soft-deleted course → 404; unverified email → 403; self-enrollment by the instructor → 422; dropping preserves progress and decrements nothing. |
| 15.9 | **Upload & Webhook Tests** | Pre-signed URL rejects an over-limit or wrong-MIME request; confirm without a real object → 422 and no `Resource` row; avatar over 5 MB → 422; a webhook with a tampered signature → 401 while the untampered body → 200. |
| 15.9a | **Aggregate Integrity Tests** | Drive each counter through its full trigger set and assert the stored value against a recomputation from base tables: review create/update/delete moves `course.rating` and `instructor.rating` while an update leaves `reviewCount` fixed; publish → publish → unpublish leaves `subject.courseCount` net zero; instructor soft-delete of a published course decrements it, of a draft does not. Then run `npm run db:reconcile` at the end of the suite and assert **zero** drift — a single assertion that catches every trigger point the tests above forgot to exercise. |
| 15.10 | **Code Coverage Report** | Generate via `@vitest/coverage-v8` and hold **>85%** across service files. Document intentional gaps (the email transport in test mode, the S3 client) rather than leaving them unexplained. |

**Lesson access matrix (Task 15.4):**

| Caller | Lesson state | Expected |
| :--- | :--- | :--- |
| Anonymous | `isFreePreview = true` | **200** with full content |
| Anonymous | normal lesson | **401** — no identity to deny |
| Authenticated, not enrolled | normal lesson | **403** |
| Enrolled | prior lessons incomplete | **423** with `nextAccessibleLessonId` |
| Enrolled | unlocked | **200** |
| Course owner / Admin | any | **200** |

> [!CAUTION]
> **"Non-enrolled students cannot access lesson content (403)" is not a sufficient assertion.** It collapses six distinct outcomes into one and would pass against an implementation that returns 403 for anonymous callers (wrong — should be 401), 403 for locked lessons (wrong — should be 423, which carries `nextAccessibleLessonId`), and 403 for free-preview lessons (wrong — should be 200, breaking the entire course-preview feature with a test suite reporting green). Assert the matrix row by row.

**Deliverables:**
- `vitest.config.js` collecting both `src/` unit tests and the `tests/` tree
- All six npm test scripts present and invoked by CI
- 60+ integration tests across auth, RBAC, progress, quizzes, uploads, governance, and webhooks
- The lesson access matrix asserted row by row
- Coverage >85% with documented gaps

**Verification:**
```bash
npm run test:run -- --reporter=verbose | tail -5   # confirm the collected count is non-zero
npm run test:coverage                              # must fail the run below 85%, not just warn
```

---

### Day 16 — Production Hardening & Deployment

**Goal:** Finalize Docker configuration, CI/CD pipelines, production environment hardening, and deployment.

| # | Task | Details |
| :--- | :--- | :--- |
| 16.1 | **Multi-Stage Dockerfile** | Finalize the production `Dockerfile`: Node 22 Alpine, non-root `nodeapp` user, `npm ci --omit=dev`, `prisma generate`, `EXPOSE 3000`, health check directive. The Prisma copy step must reference **`src/database/schema.prisma`**, not `prisma/` (Day 0.2) — with the wrong path the image build fails on a directory that does not exist. |
| 16.2 | **Docker Compose Production** | Create `docker-compose.prod.yml` with production PostgreSQL and Redis settings, restart policies, resource limits, and network isolation. Only the API port is published; the database and Redis stay on the internal network. |
| 16.3 | **CI Pipeline** | Finalize `.github/workflows/ci.yml`: checkout → `npm ci` → **lint as a gate, not a warning** → `prisma migrate deploy` against the service container → `npm run test:run` with PostgreSQL and Redis services → `npm run test:coverage` → fail below 85%. Every `*_TEST` env var must be present in the workflow env, or the suite fails on connection rather than on assertions. |
| 16.4 | **CD Pipeline** | Finalize `.github/workflows/cd.yml`: on push to `main` → build image → push to the registry → **run `prisma migrate deploy` before the new image serves traffic** → deploy → smoke-test the health endpoint. Deployment is gated on CI passing on the same commit; a red build must not be deployable. |
| 16.5 | **PR Validation** | Finalize `.github/workflows/pr-validation.yml`: lint, test, and coverage on every pull request, all as required checks. |
| 16.6 | **Production Logging** | Verify `pino` emits JSON in production, stack traces are suppressed in responses, and `passwordHash`, `Authorization`, `Cookie`, `JWT_SECRET`, and `JWT_REFRESH_SECRET` never reach a log line. |
| 16.7 | **Security Hardening Checklist** | Final audit: CORS locked to the production origin; rate limits active; `helmet` headers set; refresh cookie carries `HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth`; the two JWT secrets are **distinct** and neither is a default; every production env var required by `env.js`; `KEYS` absent from every request path. |
| 16.8 | **Swagger & README Finalization** | Regenerate the spec from route annotations so it covers every routed endpoint (~84 by the appendix schedule), and bring the committed `swagger.json` in line — it is currently a `/health`-only stub whose health schema omits `database` and `redis` (Day 0.11). Update `README.md` with the real clone URL, setup steps, and current feature list. |
| 16.9 | **Deployment Verification** | Deploy to staging → run the smoke suite against live endpoints → verify health, auth round-trip, catalog, enrollment, quiz submission, and certificate download. |

> [!IMPORTANT]
> **Reconcile the endpoint count against the appendix, not against memory.** An earlier draft of this plan cited "52+ endpoints" while its own appendix schedule already totalled ~70, and the expanded scope below now reaches ~84. Whichever number ships in the README and the spec must be derived by counting the routed paths on the day, cross-checked against the appendix table — a documented count that disagrees with the routed reality is a defect a reader has no way to detect.

**Deliverables:**
- Production image with a non-root user and the correct Prisma schema path
- CI/CD green, with lint as a gate and migrations applied before traffic
- All security hardening verified, including two distinct JWT secrets
- Generated spec covering every routed endpoint; `swagger.json` no longer a stub
- Staging deployment passing the smoke suite

---

### Phase 4 Exit Criteria

| Criteria | Status |
| :--- | :--- |
| Admin can unpublish, republish, soft-delete, and restore courses, each audited with a reason | ☐ |
| `AuditLog` writes use real `AuditActionType` members (`COURSE_REJECTED`, `ROLE_CHANGED`, …) — not the plausible-sounding non-members | ☐ |
| Ban revokes every session via the index set and rewrites `user:state:<id>` | ☐ |
| Role demotion of an instructor owning a published course returns 409; `?force=true` unpublishes | ☐ |
| `?deleted=` filter lets admins find soft-deleted courses and users | ☐ |
| Analytics reports `grossMerchandiseValue`; no instructor-facing endpoint reports money | ☐ |
| Audit log is append-only and filters validate against the enums | ☐ |
| `DELETE /users/me` anonymizes in place; issued certificates stay verifiable | ☐ |
| `npm run db:reconcile` reports counter drift and repairs only under `--fix` | ☐ |
| `vitest.config.js` collects the `tests/` tree — collected count is non-zero | ☐ |
| Lesson access matrix asserted row by row (401 / 403 / 423 / 200) | ☐ |
| Integration suite passes with >85% coverage, enforced as a gate | ☐ |
| CI runs lint as a gate and applies migrations before tests | ☐ |
| Docker image builds with `src/database/schema.prisma` and runs as a non-root user | ☐ |
| Generated spec covers every routed endpoint; count reconciled against the appendix | ☐ |
| Staging deployment passes health and smoke tests | ☐ |

---

## Cross-Cutting Concerns (Applied Across All Phases)

These concerns are not isolated to a single phase but must be maintained continuously throughout development.

| Concern | Implementation |
| :--- | :--- |
| **Response Envelope** | Every response — success and error — is `{ status: "success" \| "error", message, data \| errors }`. `status` is a **string**, never a boolean; the payload key is always `data`, never a resource-specific name. Enforced by routing all responses through `api-response.js` and never calling `res.json()` directly ([TRD §6](./EduTRD.md)). |
| **Consistent Error Handling** | All services throw `AppError` subclasses. The global handler in `app.js` catches and formats them, and must declare four parameters or Express will not recognise it as an error handler. Unhandled rejections and uncaught exceptions trigger graceful shutdown. |
| **Input Validation** | Every route has a Zod schema; `validate()` runs before any controller logic. No raw `req.body` access without prior validation. Validation failures are **422** with field-level `errors[]`. |
| **Pagination** | All list endpoints accept `?page=&limit=` with `page=1`, **`limit=10`**, `max=100`. Out-of-range limits are **clamped, not rejected** — `?limit=500` returns 100 with HTTP 200. Responses carry `pagination` metadata with `hasNextPage` / `hasPrevPage` ([apidoc.md §6](./docs/apidoc.md)). |
| **Route Registration Order** | Express 5 matches in registration order, so literal routes must precede parameterised siblings: `/courses/featured` before `/courses/:slug`, `/notifications/read-all` before `/notifications/:id/read`. Reversing either yields a 404 on a resource that exists. |
| **Fail-Closed vs. Fail-Open** | **Security reads fail closed:** an unreadable `user:state:<id>` returns 503, because a banned user's token remains cryptographically valid and a fail-open path admits exactly whom the ban excludes. **Cache reads fail open:** a missed catalog cache falls through to PostgreSQL and serves the request. Both policies coexist deliberately ([TRD §7.1](./EduTRD.md)). |
| **Redis Key Discipline** | Every key comes from the `src/utils/cache-keys.js` namespace module — no module concatenates a key literal, and `src/config/redis.js` holds the client only (Day 1.7). Pattern deletion uses **`SCAN` + `UNLINK`**; `DEL` with a glob deletes nothing and returns `0`, and `KEYS` is prohibited in any request path (O(N) over the keyspace, blocking the single-threaded server). |
| **Counter Semantics** | `Course.studentCount` and `Instructor.studentCount` are **lifetime** metrics, never decremented — not on drop, ban, or soft-delete — with a reactivation guard so `DROPPED` → `ACTIVE` does not double-count. `Subject.courseCount` is a **live** count: transition-guarded, decremented on unpublish and on soft-delete of a published course by **either** the admin takedown path or the instructor's own `DELETE /courses/:id`. `Course.rating` and `Instructor.rating` are recomputed together in one transaction on every review write. The families behave differently on purpose. `npm run db:reconcile` audits all of them. |
| **Denormalized Field Maintenance** | `progressPercent`, `Course.rating`, `Course.reviewCount`, `Instructor.rating`, and `Course.durationMinutes` are written inside the same transaction as the source change, never computed on read. Progress writes additionally take `SELECT ... FOR UPDATE` on the enrollment row. |
| **Soft Deletes** | `User` and `Course` carry `deletedAt` — those two only ([TRD §4.2](./EduTRD.md)). Public queries filter `deletedAt IS NULL` — **including nested includes**, which is where omissions concentrate. Admin queries opt in via `?deleted=`. `Review` is **hard**-deleted: it has no `deletedAt`, so review aggregates need no live filter and admin moderation history is preserved in `AuditLog (REVIEW_DELETED)` instead of on the row. |
| **Audit Trail** | Every admin governance action writes an `AuditLog` row inside the same transaction as the action, using an `AuditActionType` enum member. The log is append-only: no update or delete endpoint exists. |
| **Idempotency** | Lesson completion, bookmark toggle, and achievement award are idempotent — the last via `createMany({ skipDuplicates: true })` against `@@unique([userId, achievementId])`. Re-completing a course does not re-issue a certificate. Quiz submissions are **deliberately not** idempotent: a resubmission is a real second attempt and consumes budget. |
| **Continuous Unit Testing** | Service-layer unit tests (scoring, progress, streaks, criteria matching) are written in the module's `tests/` folder the same day the service lands. Day 15 covers cross-module integration and the coverage sweep. |
| **Swagger Documentation** | Routes carry `swagger-jsdoc` annotations as they are built, not retroactively; `swagger-ui-express` serves the assembled spec at `/api-docs`. Verify against the rendered spec, not the annotation source. |

---

## Risk Register & Mitigation Strategies

| Risk | Likelihood | Impact | Mitigation |
| :--- | :--- | :--- | :--- |
| **Redis unavailability becomes an authentication outage** | Medium | High | This is the accepted cost of the `user:state:<id>` fast path: authenticated routes **fail closed with 503** while Redis is down, because a fail-open fallback would admit banned users holding still-valid tokens. Mitigated in depth rather than in policy — `ioredis` auto-reconnect with backoff, Redis reported in `/health` so orchestrators pull the instance, and catalog reads that fail open so anonymous browsing survives the outage. |
| **Quiz answer leakage via response serialization** | Low | Critical | `correctAnswerIndex` excluded by explicit Prisma `select`, not by post-fetch key deletion — a `select` survives refactors that add includes or spread records. Tests assert absence in student responses. |
| **Answer-key harvesting through repeated submissions** | Medium | High | Two controls that only work together: `maxAttempts` (429, no `Retry-After`) bounds the loop, and graduated `breakdown` disclosure withholds `correctAnswerIndex` while attempts remain. Either alone leaves the oracle open. |
| **`DEL` with a glob silently revoking nothing** | Medium | Critical | `redis.del('session:<id>:*')` returns `0` and every caller reads that as "no sessions." Structurally prevented by the `session:index:<userId>` set (`SMEMBERS` → `UNLINK`) and by centralizing pattern deletion in one `SCAN`-based helper. A ban test asserting `revokedSessions` catches a regression. |
| **Denormalized counter drift** | High | Medium | Drift is expected over a system's life — aborted transactions, hotfixes, manual `UPDATE`s. `npm run db:reconcile` recomputes from source tables and reports divergence; `--fix` repairs. Report-only by default, so a reconciliation run can never itself corrupt data. |
| **Lost update on concurrent progress writes** | Medium | Medium | `SELECT ... FOR UPDATE` on the enrollment row inside the completion transaction. The `[enrollmentId, lessonId]` unique constraint prevents duplicate progress rows but does **not** prevent the lost update on `progressPercent`, since the contended row is a different one. |
| **Curriculum edits retroactively un-completing graduates** | Medium | High | `ACTIVE` enrollments are recalculated against the new lesson total in the same transaction as the curriculum change; `COMPLETED` enrollments are pinned at 100.0 and never recalculated. Without the pin, adding one lesson invalidates certificates already issued and downloaded. |
| **Unconfirmed uploads accumulating as orphans** | Medium | Low | `staging/` prefix with a 24-hour expiration lifecycle rule, so the bucket reaps what the API never learned about. Confirmation `HeadObject`-verifies before writing a row, so no `Resource` ever points at a missing object. |
| **Over-limit uploads bypassing validation** | Medium | Medium | Size and content type are bound into the pre-signed **signature**, not merely validated in the request body. A client's declared `fileSize` is a claim about a file the API never sees; only S3 can enforce it. |
| **Webhook signature verification broken by body parsing** | Medium | High | `express.raw()` mounted on `/api/v1/webhooks` before `express.json()`. A test replays a captured body with one byte altered and asserts rejection, so a middleware reorder fails CI rather than production. |
| **Hard account deletion destroying issued credentials** | Low | High | `DELETE /users/me` anonymizes in place instead of cascading. A hard delete would cascade into `Enrollment` and `Certificate`, making public verification of a genuine credential return 404. |
| **Schema migration conflicts during parallel development** | Medium | High | A single developer owns migration files; generated migrations are never hand-edited **except** for the four documented constraints in Day 1.4a, which Prisma cannot express and will not re-emit. `prisma migrate reset` on conflict, against the test database only. |
| **Prisma 7 removing the `package.json#prisma` key** | Medium | High | The whole schema-path resolution from Day 0.1 lives in that key, and Prisma 6.19 already warns it is *"deprecated and will be removed in Prisma 7."* Upgrading breaks every `prisma` invocation with **"Could not find a schema"** — an error that points at the schema, not at the config that stopped being read, so it misdirects the diagnosis. Likelihood is not hypothetical: the 6.19 CLI prints an upgrade banner telling the developer to run `npm i --save-dev prisma@latest`, which now resolves to 7.x. Mitigated by pinning **both** `prisma` and `@prisma/client` to `~6.19` (they must move in lockstep), so v7 can only arrive through a deliberate range bump rather than a lockfile refresh. The migration path when that bump happens is a `prisma.config.ts` file — the 6.19 CLI recognizes only the `.ts` filename, so it also means admitting one TypeScript file into an otherwise plain-ESM project. Do it as its own scoped change, never bundled with feature work. |
| **Email service outage blocking user operations** | Medium | Medium | Dispatch happens after commit, never inside the transaction — an email inside a transaction holds locks across a third-party HTTP call and converts a delivery failure into a rolled-back enrollment. Failures logged; 3 retries with backoff; hard bounces suppressed via the webhook rather than retried. |
| **A green test suite that collected nothing** | Medium | Critical | The scaffolded `vitest.config.js` `include` never matches `tests/`. Fixed on Day 0.9 and Day 15.1. The primary guard is Vitest's own default: an empty match set exits **1**, so a suite that collects nothing cannot report green — which is why `--passWithNoTests` must never be added to `test:run` (Day 0.8b). That default does not cover the partial case, where one of the two `include` patterns matches and the other silently does not, so Day 15.1 additionally asserts a non-zero collected count from `tests/integration/` specifically. An empty suite is indistinguishable from a passing one in every signal except the count. |
| **Documented endpoint count diverging from routed reality** | High | Low | The appendix schedule below is the single source for the count that appears in the README and the spec. Derive it by counting rows; never restate it from memory. |

---

## Appendix: Endpoint Delivery Schedule

| Phase | Endpoints Delivered | Running Total |
| :--- | :--- | :--- |
| **Phase 1** (Days 1–4) | Health (1), Auth (8), Subjects (5), Courses (6) | ~20 |
| **Phase 2** (Days 5–8) | Modules (3), Lessons (5 incl. complete), Enrollments (5), Quizzes (9), Resources (5), Avatar (1) | ~48 |
| **Phase 3** (Days 9–12) | Achievements (2), Certificates (3), Dashboards (5), Bookmarks (2), Reviews (4), Notifications (3), Webhooks (1) | ~68 |
| **Phase 4** (Days 13–16) | Admin Courses (5), Admin Users (5), Admin Achievements (3), Analytics (1), Audit Logs (1), Account Deletion (1) | **~84** |

> [!NOTE]
> Counts are per routed path-and-method pair and are approximate at the margins — a few endpoints (`GET /achievements` vs. `GET /users/me/achievements`, the two `?deleted=` admin filters) can reasonably be counted as one or two. The figure that ships in the README and the generated spec must be counted from the routed reality on Day 16, using this table as the cross-check rather than as the authority.
