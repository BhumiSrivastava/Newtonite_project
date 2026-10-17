# Operations Under Pressure

An internal web application for teams to create, assign, track and resolve operational work items — built as the Newtonite Software Engineering Challenge.

## What It Does

Teams can create and track work items (incidents, customer issues, payments, compliance tasks) through a defined workflow. The system enforces authorization per team/role, guarantees concurrency safety via optimistic locking and atomic claims, maintains a complete audit log in the same transaction as every change, and uses a transactional outbox for reliable async processing.

## Architecture

```
Browser → React + TanStack Query → Express API → PostgreSQL
                                              ↘ Outbox Worker (polling)
```

## Prerequisites

- **Docker** and **Docker Compose** (v2+)
- OR: Node.js 20+, PostgreSQL 16

## Quick Start (Docker — Recommended)

```bash
git clone <repo-url>
cd newtonite-ops-<rollno>

# Copy env example (no secrets needed for Docker)
cp .env.example .env

# One command to start everything
docker compose up --build

# App is ready at:
#   Frontend:  http://localhost:5173
#   Backend:   http://localhost:3001
#   API Health: http://localhost:3001/health
```

The backend automatically runs migrations and seeds demo data on first start.

## Local Development (Without Docker)

```bash
# Start PostgreSQL locally (or use Docker just for the DB)
docker compose up db -d

# Backend
cd backend
cp ../.env.example .env   # edit DATABASE_URL if needed
npm install
npm run db:migrate
npm run db:seed
npm run dev               # runs on :3001

# Frontend (new terminal)
cd frontend
npm install
npm run dev               # runs on :5173 with proxy to :3001
```

## Demo Login Credentials

All passwords: **`password123`**

| Username | Role | Teams |
|---|---|---|
| `alice_admin` | Admin | Platform Engineering (admin), Customer Support (member) |
| `bob_lead` | Lead | Platform Engineering (lead), Customer Support (lead) |
| `carol_member` | Member | Platform Engineering |
| `dave_member` | Member | Platform Engineering |
| `eve_viewer` | Viewer | Platform Engineering |
| `frank_lead` | Lead | Customer Support (lead), Payments (lead) |
| `grace_member` | Member | Customer Support, Payments |
| `hank_admin` | Admin | Payments (admin), Compliance (admin) |
| `iris_member` | Member | Payments, Compliance |
| `jack_viewer` | Viewer | Compliance |

## Running Tests

Tests require a running PostgreSQL instance (uses the same DB as development, with test-prefixed data isolated):

```bash
# Start DB if not running
docker compose up db -d

# Run all tests
cd backend
npm test
```

All 7 critical behavior tests run in one command:
1. **Concurrent claim** — two users claim the same item, exactly one succeeds
2. **Stale version edit** — 409 returned, data unchanged
3. **Idempotency** — same key sent twice creates one item, returns same response
4. **Workflow rules** — invalid transitions and non-Lead approvals rejected
5. **Resource-level auth** — outside-team user gets 403, viewer can't write
6. **Activity history** — every change generates an activity event
7. **Pagination** — cursor-based, server-side only

## API Endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/auth/login` | Login, returns JWT |
| GET | `/items` | List with filters, cursor pagination |
| POST | `/items` | Create item (supports Idempotency-Key) |
| GET | `/items/:id` | Get item detail |
| PATCH | `/items/:id` | Update item (requires version for optimistic lock) |
| POST | `/items/:id/claim` | Atomic claim |
| POST | `/items/:id/transition` | Workflow transition (requires version) |
| GET | `/items/:id/activity` | Activity timeline |
| GET | `/items/:id/comments` | Comments |
| POST | `/items/:id/comments` | Add comment |
| GET | `/teams` | User's teams |
| GET | `/teams/:id/members` | Team members |
| GET | `/dashboard/stats` | Dashboard counts |

## Critical Behaviours Implemented

- ✅ **Concurrent claim** — `UPDATE ... WHERE assignee_id IS NULL`, 409 if 0 rows updated
- ✅ **Stale version edit** — optimistic locking with `WHERE version = ?`, 409 with current item on mismatch
- ✅ **Idempotency** — `Idempotency-Key` header, response stored in DB within same transaction
- ✅ **Workflow rules** — allowed-transitions map enforced server-side; Lead/Admin only for approval
- ✅ **Resource-level authorization** — every query scoped to user's teams; single `checkPermission()` function
- ✅ **Reliable async jobs** — transactional outbox, `FOR UPDATE SKIP LOCKED`, exponential backoff, idempotent handlers
- ✅ **Optimistic UI reconciliation** — 409/403 rolls back UI state and shows server's reason via toast

## Known Limitations

See [ENGINEERING_DECISIONS.md](./ENGINEERING_DECISIONS.md#known-limitations).

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite, TanStack Query
- **Backend**: Node.js 20, Express, TypeScript
- **Database**: PostgreSQL 16
- **Auth**: JWT (jsonwebtoken + bcrypt)
- **Testing**: Vitest + Supertest
- **Infrastructure**: Docker Compose

## What I'd Build Next

- WebSocket / SSE for real-time updates
- Full-text search using PostgreSQL `tsvector` + `pg_trgm`
- Read replica for dashboard queries
- Email delivery for outbox notifications
- Partition the `activity_events` table by month for scale
- Rate limiting middleware
