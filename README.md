# EduSphere Backend Service

> **Modern E-Learning, Curriculum Management & Automated Assessment Platform**

EduSphere is a multi-tenant backend engine built with **Node.js 22 LTS**, **Express 5**, **PostgreSQL 15**, **Prisma ORM 6**, and **Redis 7**. 

It enables instructors to author and publish multi-module courses, provides learners with real-time atomic progress tracking, evaluates assessments via a secure server-side quiz engine, and automatically generates verified PDF completion certificates (`pdfkit`) and gamified achievement badges.

---

## 📚 Core System Documentation

| Document | Description | Link |
| :--- | :--- | :--- |
| **Technical Requirements (TRD)** | Master architecture specs, operational workflows, and acceptance criteria | [EduTRD.md](./EduTRD.md) |
| **API Reference (OpenAPI)** | Comprehensive REST endpoint specification (52+ operations) | [apidoc.md](./apidoc.md) |
| **System Architecture** | Component topology, request lifecycle, security matrix, and containerization | [architecture.md](./architecture.md) |
| **Entity-Relationship Diagram** | PostgreSQL relational database schema (20 Entities, 6 Enums) | [erd.dbml](./erd.dbml) |
| **Developer Contributing Guide** | Setup guide, git branch strategy, code standards, and PR requirements | [contributing.md](./contributing.md) |

---

## 🌟 Key Platform Features

* **Stateless JWT Authentication & Session Purging:** Dual-token security (15m Access Token + 7d `HttpOnly` Refresh Cookie) with automatic rotation. Account bans immediately purge active Redis sessions (`DEL session:<userId>:*`).
* **Curriculum Authoring Engine:** Hierarchical content structure (Subjects → Courses → Modules → Lessons). Lessons support video streams, markdown content, code snippets, and attached quizzes.
* **Atomic Progress Calculation:** Server tracks lesson completions and updates progress percentage atomically inside PostgreSQL transactions with zero-division protection (`totalLessons > 0`).
* **Secure Server-Side Quiz Grading:** Quiz answer keys (`correctAnswerIndex`) are strictly stripped from student payloads. Answer submissions are evaluated in server memory with full attempt history tracking.
* **Direct Cloud Media Uploads:** Bypasses API server memory for large video and resource uploads using 15-minute pre-signed AWS S3 / Cloudinary `PUT` URLs.
* **Automated PDF Certificate Issuance:** On-demand PDF generation (`pdfkit`) upon 100% course completion featuring unique verifiable certificate numbers (`EDU-YYYY-XXXXX`).
* **Gamification & Learning Streaks:** Daily learning streak counters and automated achievement badge unlocking.
* **Admin Governance & Content Moderation:** Administrative dashboard for role elevation, post-publication course unpublishing, soft-deletion, and immutable audit logs (`AuditLog`).
* **Transactional Email Engine:** SendGrid / Brevo REST API integration (`axios`) for async, non-blocking email dispatch (email verification, password resets, enrollment alerts).

---

## 🛠️ Technology Stack

| Layer | Technology Specification |
| :--- | :--- |
| **Runtime Environment** | Node.js 22 LTS (ES Modules) |
| **API Framework** | Express 5 |
| **Database & ORM** | PostgreSQL 15 via Prisma ORM 6 |
| **Caching & Sessions** | Redis 7 (`ioredis` client) |
| **Schema Validation** | Zod 3 (Runtime request body, query, and parameter validation) |
| **Authentication** | `jsonwebtoken` + `bcryptjs` (12 salt rounds) |
| **Media & File Storage** | AWS S3 SDK / Cloudinary |
| **Document Generation** | `pdfkit` (Automated certificate generation) |
| **Email Delivery** | SendGrid / Brevo REST API (`axios`) |
| **Logging & Hardening** | `pino`, `pino-http`, `helmet`, `express-rate-limit` |
| **Testing Suite** | Vitest 4 + Supertest 7 |
| **API Documentation** | OpenAPI 3.0 (`swagger-ui-express` at `/api-docs`) |

---

## ⚡ Quick Start Guide

### Prerequisites
* **Node.js:** `v22.0.0` or higher
* **Docker & Docker Compose:** For running local PostgreSQL 15 and Redis 7 containers

### 1. Clone & Install
```bash
git clone https://github.com/EduSphere/edusphere-backend.git
cd edusphere-backend
npm install
```
> `npm install` automatically triggers `npx prisma generate` via the `prepare` lifecycle hook.

### 2. Environment Configuration
```bash
cp .env.example .env
```
*(Configure database credentials, JWT secrets, and API keys in `.env`)*

### 3. Launch Local Infrastructure
```bash
docker compose up -d    # Starts PostgreSQL 15 (Port 5432) & Redis 7 (Port 6379)
npm run migrate         # Applies database migrations
npm run seed            # Seeds initial subjects, courses, and achievement badges
npm run dev             # Starts API dev server with live reload at http://localhost:5000
```

### 4. Verify System Health
```bash
curl http://localhost:5000/health
# Response: { "status": "success", "data": { "status": "healthy", "checks": { "database": "connected", "redis": "connected" } } }
```

* **Interactive Swagger UI:** `http://localhost:5000/api-docs`

---

## 🔑 Environment Variables Reference

Validated on server boot using Zod (`src/config/env.js`). Missing or invalid configuration halts process startup.

```env
# Server Runtime
NODE_ENV=development
PORT=5000
LOG_LEVEL=info
CORS_ORIGIN=http://localhost:3000
SWAGGER_ENABLED=true

# PostgreSQL Primary Database
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/edusphere_db?schema=public"

# Redis Cache & Sessions
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DATABASE=0

# Authentication & JWT
JWT_SECRET=your_super_secret_access_key_min_32_chars
JWT_EXPIRES_IN=15m
JWT_REFRESH_SECRET=your_super_secret_refresh_key_min_32_chars
JWT_REFRESH_EXPIRES_IN=7d

# AWS S3 / Cloudinary Storage
AWS_ACCESS_KEY_ID=your_aws_key
AWS_SECRET_ACCESS_KEY=your_aws_secret
AWS_REGION=us-east-1
AWS_S3_BUCKET=edusphere-media-storage

# Transactional Email (SendGrid / Brevo REST API)
BREVO_API_KEY=your_brevo_api_key
BREVO_SENDER_EMAIL=noreply@edusphere.learn
BREVO_SENDER_NAME=EduSphere

# Client Application
FRONTEND_URL=http://localhost:3000
```

---

## 📋 Available CLI Scripts

| Command | Description |
| :--- | :--- |
| `npm run dev` | Launch API server in development mode with live reload (`nodemon`) |
| `npm start` | Launch production HTTP server runtime |
| `npm run migrate` | Apply development database schema migrations |
| `npm run migrate:prod` | Deploy pending Prisma migrations in production |
| `npm run migrate:reset` | Reset database and re-run all seed scripts |
| `npm run seed` | Seed database with subjects, default courses, and badges |
| `npm run studio` | Launch visual Prisma Studio web inspector |
| `npm test` | Run Vitest test runner in interactive watch mode |
| `npm run test:run` | Execute full unit and integration test suite |
| `npm run test:coverage` | Generate code coverage report (Enforced target: >85%) |
| `npm run lint` | Execute ESLint static analysis |
| `npm run lint:fix` | Automatically resolve lint formatting issues |

---

## 🗺️ Project File Structure

```text
src/
├── app.js                  # Express application setup (Helmet, CORS, rate-limiting, error handler)
├── server.js               # Server bootstrap, DB & Redis init, graceful shutdown handlers
├── config/                 # Environment validation, constants, system messages, Redis client
├── database/               # Prisma schema (20 models), seed script, migration history
├── middlewares/            # Auth guard, RBAC middleware, Zod validator, Pino logger, Multer
├── modules/                # 16 Domain Modules (Controller → Service → Routes → Schema)
│   ├── auth/               # Register, login, token refresh rotation, logout, password recovery
│   ├── users/              # Profiles, avatar uploads, student dashboard metrics
│   ├── instructors/        # Instructor profiles, teaching metrics, portfolio
│   ├── subjects/           # Subject categories and course counts
│   ├── courses/            # Catalog search, filtering, course publishing lifecycle
│   ├── modules/            # Curriculum module sequencing
│   ├── lessons/            # Lesson content player, video/code integration
│   ├── enrollments/        # Enrollments and atomic progress engine
│   ├── quizzes/            # Quiz authoring and secure server-side assessment engine
│   ├── resources/          # Downloadable file attachments library & direct S3 uploads
│   ├── bookmarks/          # Course and lesson favoriting
│   ├── reviews/            # Star ratings and student reviews
│   ├── achievements/       # Streaks, badges, and gamification rules
│   ├── certificates/       # PDF certificate generation and public verification
│   ├── notifications/      # In-app alerts and transactional email triggers
│   └── admin/              # User management, course approvals, audit logs, analytics
├── integrations/           # Third-party clients (AWS S3, Cloudinary, SendGrid / Brevo REST API)
├── routes/                 # Root router mounting (/health, /api/v1, /api-docs)
└── utils/                  # Custom error hierarchy, API response builders, PDFKit engine
```

---

## 🧪 Testing & Quality Assurance

```bash
# Run complete test suite (Unit & Integration)
npm run test:run

# Run unit tests only
npm run test:unit

# Generate coverage matrix
npm run test:coverage
```

---

## 🐳 Docker Deployment

A multi-stage `Dockerfile` and `docker-compose.yml` are provided for containerized deployments:

```bash
# Start PostgreSQL & Redis services locally
docker compose up -d

# Build and start full containerized application stack
docker compose up --build -d

# Stop container services
docker compose down
```

---

## 📄 License

This project is licensed under the **ISC License**.