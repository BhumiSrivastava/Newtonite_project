# Engineering Decisions

## Decision 1: Data Model — Separate Activity Events Table (Append-Only Log)

**Context**: Every state, owner, and priority change must be recorded with full history. We need guaranteed consistency between the work item and its history.

**Options considered**:
1. Store history as a JSONB array on the work_items row
2. Use a separate `activity_events` table with an append-only pattern
3. Use database triggers to auto-generate history rows

**Choice**: Option 2 — separate `activity_events` table.

**Trade-off**: More JOINs for timeline views, but the append-only table is simpler to reason about, naturally supports pagination of long histories, and the explicit INSERT in the same transaction makes the atomicity visible and testable. JSONB arrays would become unwieldy with thousands of events per item. Triggers hide logic and make testing harder.

---

## Decision 2: Concurrency Control — Optimistic Locking with Version Column

**Context**: Multiple users may edit the same work item simultaneously. We need to prevent lost updates without holding long database locks.

**Options considered**:
1. Pessimistic locking (`SELECT ... FOR UPDATE`) on every edit
2. Optimistic locking via a `version` integer column
3. Last-write-wins (no concurrency control)

**Choice**: Option 2 — optimistic locking. Every update includes `WHERE version = ?` and increments the version. A 409 Conflict is returned if the version doesn't match.

**Trade-off**: Clients must handle 409 responses and re-fetch, but this avoids holding database locks during network round-trips. For an ops dashboard where conflicts are infrequent but consequential, optimistic locking is the right fit. The `claim` endpoint uses a conditional `WHERE assignee_id IS NULL` for the specific case of concurrent claims.

---

## Decision 3: Authorization — Centralized Permission Check per Request

**Context**: Permissions must be enforced server-side, scoped to teams and roles, not just hidden UI buttons.

**Options considered**:
1. Inline permission checks in each route handler
2. Centralized `checkPermission(user, action, resource)` middleware/service
3. Database-level row-level security (RLS)

**Choice**: Option 2 — a single `checkPermission` function called by every endpoint. It loads the user's memberships, finds the relevant team, checks the role against a permission matrix.

**Trade-off**: Slightly more function calls, but one place to audit and test. RLS would be more secure but much harder to debug and doesn't work well with connection pooling. Inline checks are error-prone and hard to audit.

**Permission Matrix**:
| Action              | Viewer | Member | Lead  | Admin |
|---------------------|--------|--------|-------|-------|
| View items          | ✅      | ✅      | ✅     | ✅     |
| Create items        | ❌      | ✅      | ✅     | ✅     |
| Edit own items      | ❌      | ✅      | ✅     | ✅     |
| Edit any item       | ❌      | ❌      | ✅     | ✅     |
| Claim items         | ❌      | ✅      | ✅     | ✅     |
| Transition items    | ❌      | ✅      | ✅     | ✅     |
| Approve (→Resolved) | ❌      | ❌      | ✅     | ✅     |
| Manage team         | ❌      | ❌      | ❌     | ✅     |

---

## Decision 4: Search and Pagination — Cursor-Based with Server-Side Filtering

**Context**: Tens of thousands of items and growing history. Client-side filtering won't scale.

**Options considered**:
1. Offset-based pagination (`LIMIT/OFFSET`)
2. Cursor-based pagination (keyset pagination using `id` or `created_at`)
3. Load all and filter client-side

**Choice**: Option 2 — cursor-based pagination using the item's `id` as the cursor. All filtering (status, priority, assignee, team, text search) happens via SQL WHERE clauses with proper indexes.

**Trade-off**: Cursor pagination doesn't support "jump to page N", but it's consistent under concurrent inserts/deletes and performs well at any depth. Offset pagination degrades as offset grows. Text search uses PostgreSQL `ILIKE` for simplicity rather than full-text search — acceptable at tens of thousands of rows with a trigram index.

---

## Decision 5: Idempotency — Client-Provided Idempotency Keys

**Context**: Network retries and double-clicks can cause duplicate creates. We need exactly-once semantics for mutations.

**Options considered**:
1. Server-generated deduplication (hash request body)
2. Client-provided `Idempotency-Key` header stored in a dedicated table
3. No idempotency handling

**Choice**: Option 2 — clients send an `Idempotency-Key` header. The server stores the key, HTTP status, and response body in an `idempotency_keys` table within the same transaction. On repeat, the stored response is returned.

**Trade-off**: Requires client cooperation (generating UUIDs), but gives the client control over retry semantics. Keys expire after 24 hours to prevent unbounded table growth. The key is stored in the same transaction as the mutation, so a crash between mutation and key-store can't happen.

---

## Workflow State Diagram

```
Open ──→ In Progress ──→ Awaiting Approval ──→ Resolved ──→ Closed
  │           │                                     │
  │           └──→ Open (revert)                    └──→ In Progress (reopen)
  │
  └──→ Closed (cancel, Admin only)
```

**Allowed transitions**:
- `open` → `in_progress`
- `in_progress` → `awaiting_approval`
- `in_progress` → `open` (revert/unassign)
- `awaiting_approval` → `resolved` (Lead/Admin only)
- `awaiting_approval` → `in_progress` (reject, Lead/Admin only)
- `resolved` → `closed`
- `resolved` → `in_progress` (reopen)
- `open` → `closed` (cancel, Admin only)

---

## Known Limitations

1. **No real-time updates**: The frontend polls/refetches on user action. WebSockets would be the next addition.
2. **No email/notification delivery**: The outbox/job system records notification intents but doesn't send actual emails.
3. **Simple text search**: Uses ILIKE, not PostgreSQL full-text search. Sufficient for tens of thousands of items but would need replacement at higher scale.
4. **No file attachments**: Deliberately skipped per brief.
5. **No SSO/OAuth**: Simple token-based auth with seeded users.
6. **Single PostgreSQL instance**: No read replicas or partitioning. At 10x scale, activity_events would be partitioned by date, and read replicas would serve dashboard queries.
7. **No rate limiting**: Would add in production.
8. **Idempotency key cleanup**: Keys expire after 24 hours via a simple check, not a background cleanup job.
