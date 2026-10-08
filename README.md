# TaskFlow

An Asana-inspired project and task management platform, built as a production-style
full-stack application: React + TypeScript frontend, Node.js + TypeScript REST API,
PostgreSQL.

The application is intentionally **Kubernetes-ready but Kubernetes-free** — it is
stateless, configured entirely through environment variables, logs JSON to stdout,
exposes separate liveness/readiness probes and Prometheus metrics, is instrumented
with OpenTelemetry, and shuts down gracefully on `SIGTERM`. All infrastructure
(K8s manifests, Helm, Argo CD, CI/CD, Vault, Prometheus/Grafana/Loki/Tempo) is
deliberately **not** included — it is meant to be built separately against this app.

> **Deploying this?** The platform side — published images, the kubeadm cluster build,
> tooling and commands, and the contract your manifests must satisfy — lives in
> **[`docs/INFRASTRUCTURE.md`](docs/INFRASTRUCTURE.md)**.

---

## Table of contents

- [Architecture](#architecture)
- [Database design](#database-design)
- [Backend architecture](#backend-architecture)
- [Frontend architecture](#frontend-architecture)
- [Quick start (Docker Compose)](#quick-start-docker-compose)
- [Local development (without Docker)](#local-development-without-docker)
- [Environment variables](#environment-variables)
- [API reference](#api-reference)
- [Health checks](#health-checks)
- [Metrics](#metrics)
- [Observability: logging, request IDs, tracing](#observability-logging-request-ids-tracing)
- [Debug endpoints](#debug-endpoints)
- [Graceful shutdown](#graceful-shutdown)
- [Docker](#docker)
- [Testing, linting, building](#testing-linting-building)
- [Security notes](#security-notes)
- [Troubleshooting](#troubleshooting)

---

## Architecture

```
                    USER (browser)
                          │
                          ▼
                 FRONTEND CONTAINER
             React + TypeScript + Vite
             served by nginx-unprivileged :8080
                          │
                          │ REST + JWT (CORS)
                          ▼
                 BACKEND CONTAINER
             Node.js + TypeScript + Express :3000
                          │
                          │ SQL (pg pool)
                          ▼
                     POSTGRESQL :5432
```

**Why this shape.** The three tiers are independently deployable processes that only
talk over the network — no shared filesystem, no in-process coupling. The frontend is
a static bundle plus a tiny runtime-config file, so the same image works against any
backend URL. The backend holds no session state (JWT is self-contained), so it scales
horizontally and any replica can serve any request. That is what makes the eventual
Kubernetes deployment straightforward: `Deployment` + `Service` for the two stateless
tiers, `StatefulSet` + `PVC` for Postgres.

**Configuration flow.** Nothing is hardcoded:

```
env vars ──▶ backend/src/config/index.ts ──▶ rest of the backend
API_URL  ──▶ entrypoint writes /config.js ──▶ frontend at runtime
```

The backend reads `process.env` in exactly one module (`src/config`). Everything else
imports the typed `config` object. The frontend never bakes an API URL into its bundle
in production — see [Frontend architecture](#frontend-architecture).

---

## Database design

```
users ──────┬──────────────┬─────────────────┬──────────────┐
            │ owner_id     │ user_id         │ assignee_id  │ user_id
            ▼              ▼                 ▼              ▼
       workspaces ──▶ workspace_members    tasks ──▶ comments
            │                                ▲
            │ workspace_id                   │ project_id
            ▼                                │
         projects ───────────────────────────┘
```

| Table | Purpose | Key constraints |
|---|---|---|
| `users` | Accounts | `email` unique (lowercased), `password_hash` bcrypt |
| `workspaces` | Top-level container | `owner_id → users` (RESTRICT: can't delete a user who owns one) |
| `workspace_members` | Membership + role | PK `(workspace_id, user_id)`, role `OWNER`/`ADMIN`/`MEMBER` |
| `projects` | Inside a workspace | `workspace_id → workspaces` ON DELETE CASCADE |
| `tasks` | Inside a project | `project_id → projects` CASCADE; `assignee_id → users` SET NULL |
| `comments` | On a task | `task_id → tasks` CASCADE; `user_id → users` CASCADE |

**Delete semantics are encoded in the schema**, not in application code: deleting a
workspace cascades to its projects, tasks and comments; deleting a *user* nulls out
their task assignments rather than destroying the tasks.

**Enums** (`task_status`, `task_priority`, `workspace_role`) are real PostgreSQL types,
so invalid values are rejected by the database even if application validation were
bypassed.

**Indexes** cover the actual query patterns: `tasks(project_id)`, `tasks(project_id, status)`
for the Kanban board, `tasks(assignee_id)` and `tasks(due_date)` for the dashboard,
`comments(task_id)`, `workspace_members(user_id)`.

`updated_at` is maintained by a trigger (`set_updated_at()`), so it is correct no matter
which code path performs the update.

### Migrations

Forward-only SQL files in `backend/migrations/`, applied in filename order by
`backend/src/db/migrate.ts`. Applied files are recorded in a `schema_migrations` table,
each runs inside a transaction, and the runner retries the initial connection for ~60s
so it works as an init container / Kubernetes `Job` while Postgres is still starting.

```bash
npm run migrate     # apply pending migrations
npm run seed        # insert demo data (idempotent)
```

To add a migration, create `backend/migrations/002_your_change.sql`. Never edit an
already-applied file.

### Seed data

`npm run seed` creates two users, one workspace, four projects, nine tasks (including
overdue and upcoming ones so the dashboard is populated) and three comments.

```
demo@taskflow.dev  / DemoPass123
alice@taskflow.dev / DemoPass123
```

---

## Backend architecture

```
backend/src/
├── config/          # ALL process.env reads happen here, exported as a typed object
├── routes/          # URL → middleware chain → controller (also /health, /ready, /debug)
├── controllers/     # HTTP in/out only: read validated input, call service, send response
├── services/        # Business rules + authorization. No SQL, no req/res.
├── repositories/    # ALL SQL. Parameterized queries only. No business rules.
├── middleware/      # requestContext, requestLogger, metrics, auth, validate, errorHandler
├── models/          # Domain types + zod validation schemas
├── observability/   # logger (pino), metrics (prom-client), telemetry (OpenTelemetry)
├── db/              # pg pool, migration runner, seed script
├── utils/           # errors, password hashing, JWT, lifecycle flag
├── app.ts           # Express assembly (no listening socket — testable with supertest)
└── server.ts        # Process entrypoint: listen + graceful shutdown
```

**The layering rule:** a request flows *down* and data flows *up*.

```
request → middleware → controller → service → repository → PostgreSQL
                          ▲            ▲           ▲
                       HTTP only   rules only   SQL only
```

A controller never writes SQL. A service never touches `req`/`res`. A repository never
decides who is allowed to do something. This is what makes the authorization model
auditable: every rule lives in `services/`, and there is exactly one place to look.

**Middleware order** in `app.ts` matters and is deliberate:

```
requestContext  → assigns/echoes X-Request-ID, builds req.log
requestLogger   → one structured line per completed response
metrics         → RED metrics, labeled by route PATTERN (not raw URL)
helmet          → security headers
cors            → configurable allowed origins
express.json    → body parsing with a size limit
routes          → /health /ready /metrics [/debug] /api
notFoundHandler → consistent 404 envelope
errorHandler    → the ONLY place errors become responses
```

Correlation comes first so that *every* subsequent log line — including errors thrown by
body parsing — carries a request ID.

### Authorization model

Access is always derived through the workspace, never assumed:

```
comment → task → project → workspace → workspace_members(user_id) → role
```

- **Non-members get `404`, not `403`**, for workspaces/projects/tasks they cannot see.
  A `403` would confirm the resource exists, letting someone enumerate IDs.
- `OWNER` — everything; cannot be removed from their own workspace; only they can delete it.
- `ADMIN` — manage workspace settings and members.
- `MEMBER` — read the workspace, manage projects and tasks, leave voluntarily.
- **Comments**: only the author may edit; the author *or* a workspace `OWNER`/`ADMIN` may delete.
- **Assignees must be workspace members** — enforced in `taskService`, returning
  `ASSIGNEE_NOT_MEMBER` (400) otherwise.

### Error handling

Services throw `AppError(status, code, message)`. The central handler converts it to:

```json
{ "error": { "code": "TASK_NOT_FOUND", "message": "Task not found" } }
```

Validation failures add per-field details:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Request validation failed",
  "details": [{ "field": "title", "message": "String must contain at least 1 character(s)" }] } }
```

Anything that is *not* an `AppError` is an unexpected failure: it is logged at `error`
level **with the stack trace**, and the client receives only a generic
`INTERNAL_SERVER_ERROR` envelope. Internals never leak to API consumers.

Status codes used: `400` validation, `401` unauthenticated, `403` authenticated but not
permitted, `404` missing or invisible, `409` conflict (duplicate email/member),
`413` body too large, `500` unexpected.

### Input validation

Every request body, query string and path parameter is validated with **zod** before it
reaches a controller (`middleware/validate.ts`). Parsed results land on `req.validated`
because Express 5 exposes `req.query`/`req.params` as read-only getters. Emails are
trimmed and lowercased; passwords require ≥8 chars with at least one letter and one
digit; UUIDs, enum values and `YYYY-MM-DD` dates are checked structurally.

---

## Frontend architecture

```
frontend/src/
├── api/
│   ├── client.ts      # fetch wrapper: base URL resolution, JWT header, ApiError, 401 handling
│   ├── endpoints.ts   # one typed function per API endpoint
│   └── types.ts       # types mirroring the backend contracts
├── context/AuthContext.tsx   # session state, token persistence, boot-time validation
├── components/        # Layout (app shell), TaskFormModal, shared UI primitives
├── pages/             # Login, Register, Dashboard, Workspaces, WorkspaceDetail,
│                      # ProjectDetail (list + Kanban), TaskDetail
├── App.tsx            # routes + <Protected> guard
├── main.tsx           # entrypoint
└── styles.css         # design tokens + component styles, responsive
```

**Runtime configuration (important for Kubernetes).** A Vite build normally *bakes*
`VITE_API_URL` into the JS bundle, which would mean rebuilding the image per environment.
Instead, `index.html` loads `/config.js` before the app, and the container entrypoint
generates that file from the `API_URL` env var at startup:

```
API_URL env var ──▶ 50-runtime-config.sh ──▶ /tmp/taskflow-runtime-config.js
                                                     │ served as /config.js
                                                     ▼
                              window.__TASKFLOW_CONFIG__.apiUrl
```

Resolution order in `api/client.ts`: `window.__TASKFLOW_CONFIG__.apiUrl` →
`import.meta.env.VITE_API_URL` (dev convenience) → `''` (same origin, when frontend and
backend sit behind one Ingress). **Build once, run anywhere.**

**Session handling.** The JWT lives in `localStorage`. On boot, `AuthContext` validates
it against `GET /api/auth/me` before rendering protected routes. Any `401` from any call
(expired token) clears the session and bounces the user to `/login`.

**Views.** The project page offers a **List** view and a **Board (Kanban)** view with
drag-and-drop between the four status columns; a drop issues a `PATCH` with an optimistic
update that rolls back if the server rejects it. Filtering by status/priority and text
search are **server-side** (query parameters), not client-side array filtering, so they
still work when a project has thousands of tasks. The layout is responsive: the sidebar
becomes a top bar below 900px and the board scrolls horizontally.

---

## Quick start (Docker Compose)

Compose is for **local development and validation only** — the production target is
Kubernetes.

```bash
cd taskflow
cp .env.example .env        # optional; sensible defaults are built in

docker compose up --build -d
docker compose run --rm backend node dist/db/seed.js   # demo data
```

| Service | URL |
|---|---|
| Frontend | http://localhost:8080 |
| Backend API | http://localhost:3000 |
| Postgres | localhost:5432 |

Sign in with `demo@taskflow.dev` / `DemoPass123`, or register a new account.

```bash
docker compose logs -f backend    # structured JSON logs
docker compose ps                 # health status
docker compose down               # stop (add -v to also wipe the database volume)
```

**Startup order is enforced, not guessed.** `postgres` has a `pg_isready` healthcheck;
the one-shot `migrate` service waits for it to be healthy, applies migrations and exits;
`backend` waits for `migrate` to complete successfully; `frontend` waits for `backend` to
be healthy. This mirrors the migration-Job pattern you will use in Kubernetes.

---

## Local development (without Docker)

You still need a PostgreSQL — the easiest is the Compose one:

```bash
docker compose up -d postgres
```

**Backend** (hot reload via tsx):

```bash
cd backend
cp .env.example .env         # then set DATABASE_PASSWORD=change-me
npm install
npm run migrate
npm run seed
npm run dev                  # http://localhost:3000
```

**Frontend** (Vite dev server, hot module replacement):

```bash
cd frontend
cp .env.example .env         # VITE_API_URL=http://localhost:3000
npm install
npm run dev                  # http://localhost:5173
```

---

## Environment variables

### Backend (`backend/.env.example`)

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `development` | `development` \| `test` \| `production`. Production **requires** `JWT_SECRET`. |
| `PORT` | `3000` | HTTP listen port. |
| `HOST` | `0.0.0.0` | Bind interface. Must stay `0.0.0.0` in containers, or nothing outside the container can reach it. |
| `DATABASE_HOST` | `localhost` | PostgreSQL hostname (`postgres` in Compose, a Service name in K8s). |
| `DATABASE_PORT` | `5432` | PostgreSQL port. |
| `DATABASE_NAME` | `taskflow` | Database name. |
| `DATABASE_USER` | `taskflow` | Database user. |
| `DATABASE_PASSWORD` | *(empty)* | Database password. Inject from a Secret / Vault — never commit it. |
| `DATABASE_POOL_MAX` | `10` | Max pooled connections **per replica**. Replicas × this must stay under Postgres `max_connections`. |
| `JWT_SECRET` | *(dev fallback)* | Signing key. **Startup fails** in production if unset. Use a long random value. |
| `JWT_EXPIRATION` | `1d` | Token lifetime (`15m`, `1h`, `1d`, …). |
| `CORS_ORIGIN` | `*` | Comma-separated allowed origins. Set to your real frontend origin in production. |
| `BODY_LIMIT` | `100kb` | Max JSON body size; larger bodies get `413`. |
| `LOG_LEVEL` | `info` | `trace`\|`debug`\|`info`\|`warn`\|`error`\|`fatal`. |
| `OTEL_SERVICE_NAME` | `taskflow-backend` | Service name on logs, metrics and traces. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | *(empty)* | OTLP/HTTP collector URL. **Empty disables tracing entirely.** |
| `OTEL_TRACES_EXPORTER` | auto | `otlp` \| `none`. Defaults to `otlp` when an endpoint is set. |
| `ENABLE_DEBUG_ENDPOINTS` | `false` | Mounts `/debug/*` failure injection. Never `true` in production. |
| `SHUTDOWN_TIMEOUT_MS` | `10000` | Grace period for in-flight requests before a forced exit. Keep below the K8s `terminationGracePeriodSeconds`. |

### Frontend

| Variable | When | Description |
|---|---|---|
| `API_URL` | **runtime** (container) | Backend URL the *browser* uses. Injected into `/config.js` at startup. |
| `VITE_API_URL` | build/dev only | Fallback used by `npm run dev` and `npm run build`. |

`API_URL` must be reachable **from the user's browser**, not from inside the cluster —
`http://backend:3000` would work container-to-container but fails in the browser.

---

## API reference

Base URL `http://localhost:3000`. All `/api/*` routes except register/login require
`Authorization: Bearer <token>`. All bodies are JSON.

### Auth

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/auth/register` | `{email, name, password}` | `201 {token, user}` |
| POST | `/api/auth/login` | `{email, password}` | `200 {token, user}` |
| POST | `/api/auth/logout` | — | `204` |
| GET | `/api/auth/me` | — | `200 {user}` |

`logout` is a no-op server-side by design: JWTs are stateless, so the client discards the
token. The endpoint exists to give clients a consistent call and a future home for a
refresh-token denylist.

### Users

| Method | Path | Query | Returns |
|---|---|---|---|
| GET | `/api/users` | `search=` (≥2 chars) | `200 {users}` — email search for adding members |

### Workspaces & members

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/workspaces` | — | `200 {workspaces}` (with your `role`) |
| POST | `/api/workspaces` | `{name, description?}` | `201 {workspace}` — you become `OWNER` |
| GET | `/api/workspaces/:workspaceId` | — | `200 {workspace}` |
| PATCH | `/api/workspaces/:workspaceId` | `{name?, description?}` | `200 {workspace}` — admin only |
| DELETE | `/api/workspaces/:workspaceId` | — | `204` — owner only, cascades |
| GET | `/api/workspaces/:workspaceId/members` | — | `200 {members}` |
| POST | `/api/workspaces/:workspaceId/members` | `{email, role?}` | `201 {members}` — admin only |
| DELETE | `/api/workspaces/:workspaceId/members/:userId` | — | `204` — admin, or yourself |

### Projects

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/workspaces/:workspaceId/projects` | — | `200 {projects}` |
| POST | `/api/workspaces/:workspaceId/projects` | `{name, description?, color?}` | `201 {project}` |
| GET | `/api/projects/:projectId` | — | `200 {project}` |
| PATCH | `/api/projects/:projectId` | `{name?, description?, color?}` | `200 {project}` |
| DELETE | `/api/projects/:projectId` | — | `204` — cascades to tasks |

### Tasks

| Method | Path | Body / Query | Returns |
|---|---|---|---|
| GET | `/api/projects/:projectId/tasks` | `?status=&priority=&assigneeId=&search=` | `200 {tasks}` |
| POST | `/api/projects/:projectId/tasks` | `{title, description?, status?, priority?, assigneeId?, dueDate?}` | `201 {task}` |
| GET | `/api/tasks/:taskId` | — | `200 {task}` |
| PATCH | `/api/tasks/:taskId` | any subset of the above | `200 {task}` |
| DELETE | `/api/tasks/:taskId` | — | `204` |

`status`: `TODO` \| `IN_PROGRESS` \| `IN_REVIEW` \| `DONE` (default `TODO`)
`priority`: `LOW` \| `MEDIUM` \| `HIGH` \| `URGENT` (default `MEDIUM`)
`dueDate`: `YYYY-MM-DD` or `null`. `assigneeId`: a member's UUID or `null` to unassign.
`search` matches title *or* description, case-insensitively.

### Comments

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/tasks/:taskId/comments` | — | `200 {comments}` |
| POST | `/api/tasks/:taskId/comments` | `{content}` | `201 {comment}` |
| PATCH | `/api/comments/:commentId` | `{content}` | `200 {comment}` — author only |
| DELETE | `/api/comments/:commentId` | — | `204` — author or workspace admin |

### Dashboard

`GET /api/dashboard` returns everything the dashboard renders in one round trip:

```json
{
  "stats": { "assignedToMe": 5, "completed": 1, "overdue": 1, "dueSoon": 4,
             "byStatus": { "TODO": 4, "IN_PROGRESS": 4, "IN_REVIEW": 1, "DONE": 1 } },
  "myTasks": [...], "overdueTasks": [...], "upcomingTasks": [...], "recentProjects": [...]
}
```

Scope is every workspace you belong to. "Upcoming" means due within 7 days and not `DONE`.

### Try it

```bash
TOKEN=$(curl -s -X POST localhost:3000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"demo@taskflow.dev","password":"DemoPass123"}' | jq -r .token)

curl -s localhost:3000/api/dashboard -H "Authorization: Bearer $TOKEN" | jq .stats
```

---

## Health checks

Two endpoints with **deliberately different semantics** — this distinction is the whole
point, and getting it wrong causes outages.

### `GET /health` — liveness: "is this process alive?"

```json
{ "status": "ok" }
```

Always `200` while the event loop is responsive. **It does not check the database.**
If liveness checked the DB, a brief Postgres blip would make Kubernetes *restart every
healthy backend pod at once* — turning a recoverable dependency outage into a
self-inflicted cascading failure.

### `GET /ready` — readiness: "should this instance receive traffic?"

```json
{ "status": "ready", "database": "connected" }
```

Returns `503` when the database is unreachable **or** the process is draining after
`SIGTERM`:

```json
{ "status": "not_ready", "database": "disconnected" }
```

A failing readiness probe removes the pod from Service endpoints without killing it, so
it can rejoin the moment the dependency returns.

**Verified behavior** (`docker compose stop postgres`):

| | `/health` | `/ready` | Container |
|---|---|---|---|
| Postgres down | `200 ok` | `503 not_ready` | still running, never restarted |
| Postgres back | `200 ok` | `200 ready` | recovered automatically |

Map these to `livenessProbe` → `/health`, `readinessProbe` → `/ready`,
`startupProbe` → `/health` when you write your manifests.

---

## Metrics

`GET /metrics` — Prometheus text format, no authentication (restrict at the network layer).

| Metric | Type | Labels | Use |
|---|---|---|---|
| `http_requests_total` | counter | `method`, `route`, `status_code` | Request rate, error rate |
| `http_request_duration_seconds` | histogram | `method`, `route`, `status_code` | Latency percentiles, SLOs |
| `http_requests_in_flight` | gauge | — | Concurrency / saturation |
| `nodejs_*`, `process_*` | various | — | Heap, event loop lag, GC, CPU, file descriptors |

Plus a `service` label on everything.

**Cardinality is controlled on purpose.** The `route` label uses the Express *route
pattern* (`/api/tasks/:taskId`), never the raw URL. Raw URLs contain UUIDs, which would
create a new time series per task and eventually take down Prometheus. Unmatched
requests collapse into `route="unmatched"`.

The histogram buckets (5ms → 10s) are chosen to span both normal API calls and the
deliberately slow `/debug/slow` responses.

Useful starting queries:

```promql
sum(rate(http_requests_total[5m])) by (route)
sum(rate(http_requests_total{status_code=~"5.."}[5m])) / sum(rate(http_requests_total[5m]))
histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, route))
```

---

## Observability: logging, request IDs, tracing

### Structured logging

JSON to **stdout only** — never to files, because container runtimes collect stdout/stderr
and a log file inside a pod disappears with the pod (and fills the node's disk on the way).

```json
{"level":"info","time":"2026-08-31T18:15:13.374Z","service":"taskflow-backend",
 "requestId":"779cbeb1-3653-43a1-a619-8ac2924e0552","traceId":"83afd85f50d3efce1a475392ca8ac300",
 "method":"GET","path":"/api/tasks","statusCode":200,"duration":12.4,"msg":"HTTP request completed"}
```

Errors add the message and stack:

```json
{"level":"error","service":"taskflow-backend","requestId":"...",
 "error":"Connection refused","stack":"Error: ...","msg":"Unhandled error"}
```

`/health`, `/ready` and `/metrics` log at `debug`, so probe and scrape traffic (every few
seconds, forever) does not drown out real requests. Raise `LOG_LEVEL=debug` to see them.

### Request correlation

Every request gets an ID: the incoming `X-Request-ID` if present (from an ingress or an
upstream service), otherwise a generated UUID. It is echoed in the `X-Request-ID`
**response header** and attached to a per-request child logger, so one user action can be
traced across every log line it produced.

```bash
curl -si localhost:3000/health -H 'X-Request-ID: my-trace-99' | grep -i x-request-id
# X-Request-ID: my-trace-99
```

### OpenTelemetry tracing

`observability/telemetry.ts` is imported **first** in `server.ts` so auto-instrumentation
can patch `http`, `express` and `pg` before they load. Configure with the standard
variables; leaving `OTEL_EXPORTER_OTLP_ENDPOINT` empty disables tracing entirely with
zero overhead.

```
Backend ──▶ OTel SDK ──▶ (OTLP/HTTP) ──▶ Collector ──▶ Tempo ──▶ Grafana
```

**Tracing is strictly best-effort.** With a configured-but-unreachable collector the app
keeps serving normally — verified: every request still returned `200` while pointed at a
nonexistent host. Export failures never touch request handling.

**Logs and traces are correlated automatically**: when a span is active, the pino `mixin`
injects `traceId` and `spanId` into every log line, so a trace in Tempo links to its logs
in Loki.

---

## Debug endpoints

Failure-injection endpoints for practicing alerting, autoscaling and incident response.
**Disabled by default**; mounted only when `ENABLE_DEBUG_ENDPOINTS=true`. The module is
lazily required, so the code is not even loaded when the flag is off.

```bash
ENABLE_DEBUG_ENDPOINTS=true docker compose up -d --force-recreate backend
```

| Endpoint | Query | Effect | Practice |
|---|---|---|---|
| `GET /debug/error` | — | Throws → `500` + stack in logs | Error-rate alerts, log queries |
| `GET /debug/slow` | `delayMs` (≤30000, default 2000) | Slow response | Latency SLOs, p95 alerts, timeouts |
| `GET /debug/cpu` | `durationMs` (≤30000, default 5000) | Busy-loop CPU burn | CPU limits/throttling, HPA scale-up |
| `GET /debug/memory` | `mb` (≤1024, default 50), `release=true` | Holds allocations across calls | Memory limits, **OOMKilled**, VPA |

```bash
curl "localhost:3000/debug/slow?delayMs=1500"
curl "localhost:3000/debug/cpu?durationMs=1200"
curl "localhost:3000/debug/memory?mb=64"      # repeat to climb toward a memory limit
curl "localhost:3000/debug/memory?release=true"
```

Note that `/debug/error` returns only the generic envelope to the client while the full
stack goes to the logs — the same split every real error follows.

---

## Graceful shutdown

On `SIGTERM` (Kubernetes pod termination, `docker stop`) or `SIGINT` (Ctrl-C):

```
SIGTERM
   │
   ▼  mark not-ready  → /ready starts returning 503, load balancer drains this instance
   ▼  server.close()  → stop accepting new connections
   ▼  in-flight requests finish (idle keep-alive connections closed immediately)
   ▼  close the DB pool, flush pending traces
   ▼  exit 0     (or exit 1 if SHUTDOWN_TIMEOUT_MS elapses first)
```

Marking not-ready *before* closing the server is what makes rolling updates
zero-downtime: the load balancer stops sending new work while existing requests still
complete. Verified output:

```json
{"level":"info","signal":"SIGTERM","msg":"Graceful shutdown initiated"}
{"level":"info","msg":"Database pool closed"}
{"level":"info","msg":"Graceful shutdown complete"}
```

The container runs `node` directly in exec form, so it is PID 1 and receives signals —
no shell wrapper swallowing them. Keep `SHUTDOWN_TIMEOUT_MS` **below** your Kubernetes
`terminationGracePeriodSeconds` so the app exits cleanly before `SIGKILL`.

---

## Docker

Both images are multi-stage, run as **non-root**, and contain no build tooling.

**Backend** (`backend/Dockerfile`) — three stages: `build` compiles TypeScript, `deps`
installs production-only modules, `runtime` copies just `node_modules` + `dist` +
`migrations`. Runs as `node` (uid 1000).

**Frontend** (`frontend/Dockerfile`) — Vite build, then `nginx-unprivileged` serving on
**8080** as uid 101. The runtime config file is written to `/tmp` so the container
filesystem can be mounted read-only. nginx is configured with SPA fallback
(`try_files … /index.html`), immutable caching for hashed assets, `no-store` for
`/config.js`, and a `/healthz` endpoint for the web tier.

```bash
docker build -t taskflow-backend:local ./backend
docker build -t taskflow-frontend:local ./frontend

docker run --rm -p 3000:3000 \
  -e DATABASE_HOST=host.docker.internal -e DATABASE_PASSWORD=change-me \
  -e JWT_SECRET=$(openssl rand -hex 32) taskflow-backend:local

docker run --rm -p 8080:8080 -e API_URL=http://localhost:3000 taskflow-frontend:local
```

Verified: backend `uid=1000(node)`, frontend `uid=101(nginx)`. Images ≈321MB (backend)
and ≈74MB (frontend).

When you write Kubernetes manifests, this maps to a `securityContext` with
`runAsNonRoot: true`, `runAsUser: 1000` (backend) / `101` (frontend),
`allowPrivilegeEscalation: false`, `readOnlyRootFilesystem: true` and a dropped
capability set.

---

## Testing, linting, building

```bash
cd backend
npm test              # 55 tests: 24 unit + 31 integration
npm run test:unit     # unit only — no database needed
npm run test:integration   # needs PostgreSQL
npm run lint
npm run build

cd ../frontend
npm run lint
npm run build         # tsc --noEmit && vite build
```

**Unit tests** (`tests/unit/`) mock the repository layer: password hashing (salting,
verification), JWT round-trip/forgery/expiry, every zod schema, and `authService`
including the guarantee that a wrong password and an unknown email produce *identical*
errors.

**Integration tests** (`tests/integration/api.test.ts`) drive the real Express app with
supertest against a real PostgreSQL — no mocks. They cover the operational endpoints,
the full auth flow, workspace/member/project/task/comment CRUD, search and filtering, the
dashboard aggregation, and the authorization boundaries (non-members get 404, plain
members can't change workspace settings, non-authors can't edit comments, assignees must
be members). Each run uses unique emails, so re-runs against the same database work.

```bash
docker compose up -d postgres
cd backend && DATABASE_PASSWORD=change-me npm run test:integration
```

Current status: **lint clean, both builds succeed, 55/55 tests passing.**

---

## Security notes

Implemented at the application level:

- **Passwords**: bcrypt (10 rounds), never logged, never returned by any endpoint.
- **JWT**: `HS256`; production startup **fails** without `JWT_SECRET`.
- **Login responses are indistinguishable** for unknown email vs. wrong password.
- **Resource hiding**: non-members receive `404`, preventing ID enumeration.
- **SQL injection**: every query is parameterized; dynamic filters build placeholder
  positions, never string-concatenated values.
- **Headers**: `helmet` defaults; `X-Powered-By` disabled.
- **CORS**: explicit allowlist via `CORS_ORIGIN` (tighten from `*` in production).
- **Body limits**: `BODY_LIMIT` (default 100kb) → `413`.
- **Validation**: every input validated at the boundary.
- **Containers**: non-root, no build tools, production dependencies only.
- **Secrets**: nothing committed; `.env` is gitignored; `.env.example` holds placeholders only.

Deliberately left for the infrastructure layer: TLS termination, rate limiting / WAF,
network policies, secret injection (Vault), image scanning, refresh-token rotation.

---

## Troubleshooting

**`/ready` returns 503 `database: disconnected`.** Postgres isn't reachable. Check
`docker compose ps postgres` and the `DATABASE_*` variables. This is expected and healthy
behavior during an outage — the app stays alive and recovers on its own.

**Frontend loads but every API call fails.** `API_URL` must be reachable *from the
browser*. Check `curl localhost:8080/config.js` — it should show your host-visible
backend URL, not an internal service name.

**`401` on every request after some time.** The token expired (`JWT_EXPIRATION`, default
`1d`). The app clears the session and redirects to login automatically.

**Integration tests fail immediately.** They need PostgreSQL:
`docker compose up -d postgres`, then `DATABASE_PASSWORD=change-me npm run test:integration`.

**Docker build fails on `failed to resolve source metadata`.** BuildKit couldn't reach
Docker Hub (DNS). Pull the bases with the daemon first, then rebuild:
```bash
docker pull node:22-alpine && docker pull nginxinc/nginx-unprivileged:1.27-alpine
docker compose build
```

**Migrations "hang" at startup.** The runner intentionally retries the connection for
~60 seconds so it can start before Postgres is ready. If it exhausts the retries, the
credentials or host are wrong — check `docker compose logs migrate`.

---

## What is intentionally not here

No Kubernetes manifests, Helm charts, Argo CD applications, CI/CD pipelines, or
Prometheus/Grafana/Loki/Tempo/OTel-Collector/Vault deployments. The application exposes
every hook those need — probes, metrics, JSON logs on stdout, OTLP tracing, env-var
config, graceful shutdown, non-root images — and stops exactly there.
