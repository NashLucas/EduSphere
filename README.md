# EduSphere Backend

**EduSphere** is an advanced E-Learning and Assessment Platform backend powered by Node.js, Express, and PostgreSQL. It delivers a robust, secure, and highly scalable foundation designed strictly around OpenAPI specifications, featuring atomic progress tracking, automated PDF certificate generation, Redis-backed session management, and RBAC governance.

## ✨ Features
* **Role-Based Access Control (RBAC):** Granular permissions separating `STUDENT`, `INSTRUCTOR`, and `ADMIN` actions, strictly guarding publication lifecycles.
* **Secure JWT Rotation & Session Management:** Access/refresh token flows with Redis-tracked `jti` blocklists allowing absolute revocation of compromised sessions.
* **Atomic Progress Engine:** Transactions guaranteeing absolute data integrity for learning progression and real-time gamified streak updates.
* **Direct Cloud Media Uploads:** Bypasses API server memory for large video and resource uploads using pre-signed AWS S3 or Cloudinary URLs.
* **Automated PDF Certificate Issuance:** On-demand PDF generation (`pdfkit`) upon 100% course completion featuring unique verifiable certificate numbers (`EDU-YYYY-XXXXX`).
* **Gamification & Learning Streaks:** Daily learning streak counters and automated achievement badge unlocking.
* **Admin Governance & Content Moderation:** Administrative dashboard for role elevation, course unpublishing, soft-deletion, and immutable audit logs.
* **Transactional Email Engine:** Provider-neutral (SendGrid / Brevo) REST API integration for async email dispatch.
* **Automated CI/CD Pipelines:** GitHub Actions workflows for continuous integration, coverage gating, and zero-downtime production deployments.

---

## 🛠️ Technology Stack

| Layer | Technology Specification |
| :--- | :--- |
| **Runtime Environment** | Node.js 22 LTS (ES Modules) |
| **API Framework** | Express 5 |
| **Database & ORM** | PostgreSQL 15 via Prisma ORM 6 |
| **Caching & Sessions** | Redis 7 (`ioredis` client) |
| **Schema Validation** | Zod 3 |
| **Authentication** | `jsonwebtoken` + `bcryptjs` (12 salt rounds) |
| **Media & File Storage** | AWS S3 / Cloudinary |
| **Document Generation** | `pdfkit` (Automated certificate generation) |
| **Email Delivery** | SendGrid / Brevo REST API (`axios`) |
| **Logging & Hardening** | `pino`, `pino-http`, `helmet`, `express-rate-limit` |
| **Testing Suite** | Vitest 4 + Supertest 7 (Strict >85% Coverage Gate) |
| **API Documentation** | OpenAPI 3.0 (`swagger-ui-express` at `/api-docs`) |

---

## 🚀 Quick Start Guide

### Prerequisites
* **Node.js:** `v22.0.0` or higher
* **Docker & Docker Compose:** For running local PostgreSQL 15 and Redis 7 containers

### 1. Clone & Install
```bash
git clone https://github.com/NashLucas/EduSphere.git
cd EduSphere
npm install
```

### 2. Environment Configuration
```bash
cp .env.example .env
```
*(Configure database credentials, JWT secrets, and API keys in `.env`)*

### 3. Launch Local Infrastructure
```bash
docker compose up -d       # Starts PostgreSQL 15 (Port 5432) & Redis 7 (Port 6379)
npm run db:migrate         # Applies database migrations
npm run db:seed            # Seeds initial subjects, courses, and achievement badges
npm run dev                # Starts API dev server with live reload at http://localhost:3000
```

### 4. Verify System Health
```bash
curl http://localhost:3000/health
# Response: { "status": "ok", "database": "connected", "redis": "connected", "uptime": 14250 }
```

* **Interactive Swagger UI:** `http://localhost:3000/api-docs`

---

## ⚙️ Environment Variables Reference

Validated on server boot using Zod (`src/config/env.js`). Missing or invalid configuration halts process startup.

```env
# Server Runtime
NODE_ENV=development
PORT=3000
LOG_LEVEL=info
CORS_ORIGIN=http://localhost:3000
FRONTEND_URL=http://localhost:3000
SWAGGER_ENABLED=true

# Database (PostgreSQL)
DATABASE_URL="postgresql://edusphere:secret@localhost:5432/edusphere_db?schema=public"

# Redis Cache & Sessions
REDIS_URL="redis://localhost:6379"

# Security
JWT_SECRET="super-secret-jwt-key-replace-in-production"
JWT_REFRESH_SECRET="super-secret-refresh-key-replace-in-production"
JWT_ACCESS_EXPIRES_IN="15m"
JWT_REFRESH_EXPIRES_IN="7d"

# Storage Integration
STORAGE_PROVIDER="cloudinary"
CLOUDINARY_URL="cloudinary://api_key:api_secret@cloud_name"

# Email Integration
EMAIL_PROVIDER="brevo"
EMAIL_API_KEY="your-email-api-key"
EMAIL_FROM="noreply@edusphere.example.com"
EMAIL_FROM_NAME="EduSphere"
EMAIL_WEBHOOK_SECRET="local-dev-webhook-secret-replace-in-production"

# Test Environment
DATABASE_URL_TEST="postgresql://edusphere:secret@localhost:5432/edusphere_test?schema=public"
REDIS_URL_TEST="redis://localhost:6379/1"
```

---

## 📜 Available CLI Scripts

| Command | Description |
| :--- | :--- |
| `npm run dev` | Launch API server in development mode with live reload (`--watch`) |
| `npm start` | Launch production HTTP server runtime |
| `npm run db:migrate` | Apply development database schema migrations |
| `npm run db:deploy` | Deploy pending Prisma migrations in CI / production |
| `npm run db:generate` | Generate Prisma client bindings |
| `npm run db:seed` | Seed database with subjects, default courses, and badges |
| `npm run db:reconcile` | Reconcile missing derived counters/metrics on existing tables |
| `npm run test` | Run Vitest test runner |
| `npm run test:unit` | Execute unit test suite |
| `npm run test:integration` | Execute integration test suite sequentially (avoids DB locks) |
| `npm run test:coverage` | Generate code coverage report (Enforced target: >85%) |
| `npm run lint` | Execute ESLint static analysis |
| `npm run format` | Automatically resolve formatting issues with Prettier |

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

A multi-stage `Dockerfile` and `docker-compose.prod.yml` are provided for containerized deployments:

```bash
# Start Production Stack (Network Isolated)
docker compose -f docker-compose.prod.yml up -d
```

---

## 📄 License

This project is licensed under the **ISC License**.