# Stage 1: Production dependencies only
# Kept separate so the runtime image never receives Vitest, Supertest, ESLint,
# or Prettier (TRD §10.1, defect 4). Pruning after the fact is avoided because
# `npm prune` and Prisma's generated client under node_modules/.prisma have a
# history of interacting badly; a clean production install cannot.
FROM node:22-alpine AS deps

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

# Stage 2: Build & Prisma generation
# The full dependency tree lives only here, because `prisma generate` needs the
# prisma CLI, which is a devDependency.
FROM node:22-alpine AS builder

WORKDIR /app

# npm ci runs before the schema is copied so that editing the schema does not
# invalidate the dependency layer and reinstall the whole tree.
COPY package*.json ./
RUN npm ci

# The schema lives at src/database/schema.prisma, not the Prisma default
# prisma/schema.prisma. No --schema flag is needed: `prisma generate` reads the
# path from the "prisma" key in package.json (TRD §3.4).
COPY src/database/schema.prisma ./src/database/schema.prisma
RUN npx prisma generate

COPY . .

# Stage 3: Production runtime
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

RUN addgroup -S nodejs && adduser -S nodeapp -G nodejs

# Production dependencies from the deps stage, then the generated Prisma client
# from the builder. The schema declares no `output` or `binaryTargets`, so
# `prisma generate` writes the schema-specific client and its query engine to
# node_modules/.prisma/client — @prisma/client itself holds no schema-specific
# code and only re-exports from there, which is why both halves are required.
# The engine is compiled for whatever platform generate ran on, so all three
# stages must stay on the same base image; changing one FROM breaks the runtime
# with a missing-engine error that the build will not catch.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/package*.json ./

# src/ carries the schema and src/database/migrations/, so the runtime needs no
# separate schema copy — and no top-level prisma/ directory exists to copy.
COPY --from=builder /app/src ./src

# Copied files are root-owned and world-readable, which is all this process
# needs: uploads stream to S3/Cloudinary rather than to the container filesystem.
# A writable local path would require explicit --chown here.
USER nodeapp

EXPOSE 3000

# Port must stay 3000 to match .env.example, docker-compose.yml, and EXPOSE.
# A probe against the wrong port marks a healthy container permanently
# unhealthy, which in an orchestrator means killed and restarted forever.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# node directly, not `npm start`: npm as PID 1 does not forward SIGTERM to the
# server, so graceful shutdown never runs and the runtime SIGKILLs the container
# once the termination grace period expires.
#
# Migrations are deliberately NOT run here. `prisma migrate deploy` is a
# separate pre-deploy step so N replicas starting at once cannot race the same
# migration, and a failed migration fails the deploy instead of crash-looping
# the service (TRD §10.1).
CMD ["node", "src/server.js"]
