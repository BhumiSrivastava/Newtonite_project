import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import cors from 'cors';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

// ============================================================
// Test setup: create a test Express app with a test database
// ============================================================

const TEST_DB_URL = process.env.DATABASE_URL || 'postgresql://ops_user:ops_password@localhost:5432/ops_pressure';

let pool: Pool;
let app: express.Express;

// Test user tokens and IDs
let adminToken: string;
let leadToken: string;
let memberToken: string;
let member2Token: string;
let viewerToken: string;
let outsiderToken: string;

let adminId: string;
let leadId: string;
let memberId: string;
let member2Id: string;
let viewerId: string;
let outsiderId: string;

let teamAId: string;
let teamBId: string;

// Helper to make authenticated requests
function authGet(path: string, token: string) {
  return request(app).get(path).set('Authorization', `Bearer ${token}`);
}
function authPost(path: string, token: string) {
  return request(app).post(path).set('Authorization', `Bearer ${token}`);
}
function authPatch(path: string, token: string) {
  return request(app).patch(path).set('Authorization', `Bearer ${token}`);
}

beforeAll(async () => {
  pool = new Pool({ connectionString: TEST_DB_URL, max: 10 });

  // Override the pool import for the app
  // We'll set up env and import app modules
  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.JWT_SECRET = 'test-secret';

  // Build the app inline to use the test pool
  const { authMiddleware, generateToken } = await import('../src/middleware/auth');
  const authRoutes = (await import('../src/routes/auth')).default;
  const itemRoutes = (await import('../src/routes/items')).default;
  const teamRoutes = (await import('../src/routes/teams')).default;

  app = express();
  app.use(cors());
  app.use(express.json());
  app.use('/auth', authRoutes);
  app.use('/items', authMiddleware, itemRoutes);
  app.use('/teams', authMiddleware, teamRoutes);

  // Create test-specific tables (run migration first)
  // Create test users and teams
  const client = await pool.connect();
  try {
    // Clean up test data if exists
    await client.query("DELETE FROM activity_events WHERE work_item_id IN (SELECT id FROM work_items WHERE title LIKE 'TEST_%')");
    await client.query("DELETE FROM comments WHERE work_item_id IN (SELECT id FROM work_items WHERE title LIKE 'TEST_%')");
    await client.query("DELETE FROM jobs WHERE payload::text LIKE '%TEST_%'");
    await client.query("DELETE FROM idempotency_keys WHERE key LIKE 'test-%'");
    await client.query("DELETE FROM work_items WHERE title LIKE 'TEST_%'");

    // Check if test users exist
    const existingUsers = await client.query("SELECT id FROM users WHERE username = 'test_admin'");
    if (existingUsers.rows.length > 0) {
      // Users already exist from a previous run, load their IDs
      const users = await client.query(
        "SELECT id, username FROM users WHERE username LIKE 'test_%' ORDER BY username"
      );
      for (const u of users.rows) {
        if (u.username === 'test_admin') adminId = u.id;
        if (u.username === 'test_lead') leadId = u.id;
        if (u.username === 'test_member') memberId = u.id;
        if (u.username === 'test_member2') member2Id = u.id;
        if (u.username === 'test_viewer') viewerId = u.id;
        if (u.username === 'test_outsider') outsiderId = u.id;
      }
      const teams = await client.query(
        "SELECT id, name FROM teams WHERE name LIKE 'Test Team%' ORDER BY name"
      );
      teamAId = teams.rows.find((t: any) => t.name === 'Test Team A')?.id;
      teamBId = teams.rows.find((t: any) => t.name === 'Test Team B')?.id;
    } else {
      // Create fresh test data
      const hash = await bcrypt.hash('testpass', 10);

      adminId = uuidv4();
      leadId = uuidv4();
      memberId = uuidv4();
      member2Id = uuidv4();
      viewerId = uuidv4();
      outsiderId = uuidv4();
      teamAId = uuidv4();
      teamBId = uuidv4();

      await client.query('BEGIN');

      // Users
      for (const [id, username, name] of [
        [adminId, 'test_admin', 'Test Admin'],
        [leadId, 'test_lead', 'Test Lead'],
        [memberId, 'test_member', 'Test Member'],
        [member2Id, 'test_member2', 'Test Member 2'],
        [viewerId, 'test_viewer', 'Test Viewer'],
        [outsiderId, 'test_outsider', 'Test Outsider'],
      ] as const) {
        await client.query(
          `INSERT INTO users (id, username, email, password_hash, display_name)
           VALUES ($1, $2, $3, $4, $5) ON CONFLICT (username) DO NOTHING`,
          [id, username, `${username}@test.local`, hash, name]
        );
      }

      // Teams
      await client.query(
        `INSERT INTO teams (id, name, description) VALUES ($1, 'Test Team A', 'Test team A') ON CONFLICT (name) DO NOTHING`,
        [teamAId]
      );
      await client.query(
        `INSERT INTO teams (id, name, description) VALUES ($1, 'Test Team B', 'Test team B') ON CONFLICT (name) DO NOTHING`,
        [teamBId]
      );

      // Memberships (admin, lead, member, member2, viewer → Team A; outsider → Team B only)
      const memberships = [
        [adminId, teamAId, 'admin'],
        [leadId, teamAId, 'lead'],
        [memberId, teamAId, 'member'],
        [member2Id, teamAId, 'member'],
        [viewerId, teamAId, 'viewer'],
        [outsiderId, teamBId, 'member'],
      ];
      for (const [uid, tid, role] of memberships) {
        await client.query(
          `INSERT INTO memberships (id, user_id, team_id, role)
           VALUES ($1, $2, $3, $4) ON CONFLICT (user_id, team_id) DO NOTHING`,
          [uuidv4(), uid, tid, role]
        );
      }

      await client.query('COMMIT');
    }
  } finally {
    client.release();
  }

  // Generate tokens
  const jwt = await import('jsonwebtoken');
  const secret = 'test-secret';
  adminToken = jwt.default.sign({ userId: adminId, username: 'test_admin' }, secret, { expiresIn: '1h' });
  leadToken = jwt.default.sign({ userId: leadId, username: 'test_lead' }, secret, { expiresIn: '1h' });
  memberToken = jwt.default.sign({ userId: memberId, username: 'test_member' }, secret, { expiresIn: '1h' });
  member2Token = jwt.default.sign({ userId: member2Id, username: 'test_member2' }, secret, { expiresIn: '1h' });
  viewerToken = jwt.default.sign({ userId: viewerId, username: 'test_viewer' }, secret, { expiresIn: '1h' });
  outsiderToken = jwt.default.sign({ userId: outsiderId, username: 'test_outsider' }, secret, { expiresIn: '1h' });
}, 30000);

afterAll(async () => {
  await pool.end();
});

// ============================================================
// TEST 1: Concurrent Claim — Two users claim the same item
// ============================================================
describe('Concurrent Claim', () => {
  let itemId: string;

  beforeAll(async () => {
    // Create an unassigned item
    const res = await authPost('/items', memberToken)
      .send({
        title: 'TEST_concurrent_claim_item',
        type: 'task',
        priority: 'high',
        team_id: teamAId,
      });
    expect(res.status).toBe(201);
    itemId = res.body.item.id;
  });

  it('should allow exactly one claim when two users claim simultaneously', async () => {
    // Fire two claims in parallel
    const [res1, res2] = await Promise.all([
      authPost(`/items/${itemId}/claim`, memberToken).send(),
      authPost(`/items/${itemId}/claim`, member2Token).send(),
    ]);

    // Exactly one should succeed (200) and one should get 409
    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([200, 409]);

    // The winning response should have the item assigned
    const winner = res1.status === 200 ? res1 : res2;
    expect(winner.body.item.assignee_id).toBeTruthy();

    // The loser should get an error
    const loser = res1.status === 409 ? res1 : res2;
    expect(loser.body.error).toContain('already been claimed');
  });
});

// ============================================================
// TEST 2: Stale Version Edit — Rejected with 409
// ============================================================
describe('Stale Version Edit (Optimistic Locking)', () => {
  let itemId: string;

  beforeAll(async () => {
    const res = await authPost('/items', memberToken)
      .send({
        title: 'TEST_version_conflict_item',
        type: 'incident',
        priority: 'medium',
        team_id: teamAId,
      });
    expect(res.status).toBe(201);
    itemId = res.body.item.id;
  });

  it('should reject update with stale version', async () => {
    // First update succeeds with version 1
    const update1 = await authPatch(`/items/${itemId}`, memberToken)
      .send({ priority: 'high', version: 1 });
    expect(update1.status).toBe(200);
    expect(update1.body.item.version).toBe(2);

    // Second update with old version 1 should fail
    const update2 = await authPatch(`/items/${itemId}`, memberToken)
      .send({ priority: 'critical', version: 1 });
    expect(update2.status).toBe(409);
    expect(update2.body.error).toContain('Version conflict');

    // Verify the item still has priority 'high' (not 'critical')
    const get = await authGet(`/items/${itemId}`, memberToken);
    expect(get.body.item.priority).toBe('high');
    expect(get.body.item.version).toBe(2);
  });
});

// ============================================================
// TEST 3: Idempotency — Same key creates one item
// ============================================================
describe('Idempotency (Duplicate Request)', () => {
  it('should create one item when same idempotency key is sent twice', async () => {
    const key = `test-idem-${uuidv4()}`;

    const res1 = await authPost('/items', memberToken)
      .set('Idempotency-Key', key)
      .send({
        title: 'TEST_idempotent_item',
        type: 'task',
        priority: 'low',
        team_id: teamAId,
      });
    expect(res1.status).toBe(201);
    const firstId = res1.body.item.id;

    // Second request with same key
    const res2 = await authPost('/items', memberToken)
      .set('Idempotency-Key', key)
      .send({
        title: 'TEST_idempotent_item_different_title',
        type: 'task',
        priority: 'low',
        team_id: teamAId,
      });

    // Should return same response
    expect(res2.status).toBe(201);
    expect(res2.body.item.id).toBe(firstId);

    // Verify only one item with this title exists
    const searchRes = await authGet(`/items?q=TEST_idempotent_item`, memberToken);
    const matchingItems = searchRes.body.items.filter(
      (i: any) => i.title === 'TEST_idempotent_item'
    );
    expect(matchingItems.length).toBe(1);
  });
});

// ============================================================
// TEST 4: Workflow Rules — Forbidden transitions rejected
// ============================================================
describe('Workflow Rules', () => {
  let itemId: string;

  beforeAll(async () => {
    const res = await authPost('/items', memberToken)
      .send({
        title: 'TEST_workflow_item',
        type: 'task',
        priority: 'medium',
        team_id: teamAId,
      });
    expect(res.status).toBe(201);
    itemId = res.body.item.id;
  });

  it('should reject invalid transition (open → closed for non-admin)', async () => {
    const res = await authPost(`/items/${itemId}/transition`, memberToken)
      .send({ to_status: 'closed', version: 1 });
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('Only Admin');
  });

  it('should reject invalid jump (open → resolved)', async () => {
    const res = await authPost(`/items/${itemId}/transition`, memberToken)
      .send({ to_status: 'resolved', version: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('not allowed');
  });

  it('should allow valid transition (open → in_progress)', async () => {
    const res = await authPost(`/items/${itemId}/transition`, memberToken)
      .send({ to_status: 'in_progress', version: 1 });
    expect(res.status).toBe(200);
    expect(res.body.item.status).toBe('in_progress');
  });

  it('should allow in_progress → awaiting_approval', async () => {
    const res = await authPost(`/items/${itemId}/transition`, memberToken)
      .send({ to_status: 'awaiting_approval', version: 2 });
    expect(res.status).toBe(200);
    expect(res.body.item.status).toBe('awaiting_approval');
  });

  it('should reject approval by non-lead member', async () => {
    const res = await authPost(`/items/${itemId}/transition`, memberToken)
      .send({ to_status: 'resolved', version: 3 });
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('Only Lead or Admin');
  });

  it('should allow approval by lead', async () => {
    const res = await authPost(`/items/${itemId}/transition`, leadToken)
      .send({ to_status: 'resolved', version: 3 });
    expect(res.status).toBe(200);
    expect(res.body.item.status).toBe('resolved');
  });
});

// ============================================================
// TEST 5: Resource-Level Authorization
// ============================================================
describe('Resource-Level Authorization', () => {
  let itemId: string;

  beforeAll(async () => {
    const res = await authPost('/items', memberToken)
      .send({
        title: 'TEST_auth_item',
        type: 'incident',
        priority: 'high',
        team_id: teamAId,
      });
    expect(res.status).toBe(201);
    itemId = res.body.item.id;
  });

  it('should deny read access to user outside the team', async () => {
    const res = await authGet(`/items/${itemId}`, outsiderToken);
    expect(res.status).toBe(403);
  });

  it('should deny write access to user outside the team', async () => {
    const res = await authPatch(`/items/${itemId}`, outsiderToken)
      .send({ priority: 'low', version: 1 });
    expect(res.status).toBe(403);
  });

  it('should deny claim to user outside the team', async () => {
    // Create an unassigned item first
    const createRes = await authPost('/items', memberToken)
      .send({
        title: 'TEST_auth_claim_item',
        type: 'task',
        priority: 'low',
        team_id: teamAId,
      });
    const newItemId = createRes.body.item.id;

    const claimRes = await authPost(`/items/${newItemId}/claim`, outsiderToken).send();
    expect(claimRes.status).toBe(403);
  });

  it('should deny viewer from creating items', async () => {
    const res = await authPost('/items', viewerToken)
      .send({
        title: 'TEST_viewer_create',
        type: 'task',
        priority: 'low',
        team_id: teamAId,
      });
    expect(res.status).toBe(403);
  });

  it('should deny viewer from editing items', async () => {
    const res = await authPatch(`/items/${itemId}`, viewerToken)
      .send({ priority: 'low', version: 1 });
    expect(res.status).toBe(403);
  });

  it('should allow viewer to read items', async () => {
    const res = await authGet(`/items/${itemId}`, viewerToken);
    expect(res.status).toBe(200);
    expect(res.body.item.id).toBe(itemId);
  });

  it('should return 401 without auth token', async () => {
    const res = await request(app).get(`/items/${itemId}`);
    expect(res.status).toBe(401);
  });
});

// ============================================================
// TEST 6: Activity History Consistency
// ============================================================
describe('Activity History', () => {
  it('should record activity events for every change', async () => {
    // Create an item
    const createRes = await authPost('/items', memberToken)
      .send({
        title: 'TEST_history_item',
        type: 'task',
        priority: 'low',
        team_id: teamAId,
      });
    expect(createRes.status).toBe(201);
    const itemId = createRes.body.item.id;

    // Change priority
    await authPatch(`/items/${itemId}`, memberToken)
      .send({ priority: 'high', version: 1 });

    // Transition
    await authPost(`/items/${itemId}/transition`, memberToken)
      .send({ to_status: 'in_progress', version: 2 });

    // Get activity
    const activityRes = await authGet(`/items/${itemId}/activity`, memberToken);
    expect(activityRes.status).toBe(200);

    const events = activityRes.body.events;
    expect(events.length).toBeGreaterThanOrEqual(3);

    // Should have created, priority_changed, and status_changed events
    const eventTypes = events.map((e: any) => e.event_type);
    expect(eventTypes).toContain('created');
    expect(eventTypes).toContain('priority_changed');
    expect(eventTypes).toContain('status_changed');
  });
});

// ============================================================
// TEST 7: Server-side Pagination
// ============================================================
describe('Server-Side Pagination', () => {
  it('should paginate items with cursor', async () => {
    // First page
    const page1 = await authGet('/items?limit=5', memberToken);
    expect(page1.status).toBe(200);
    expect(page1.body.items.length).toBeLessThanOrEqual(5);
    expect(page1.body.total).toBeGreaterThan(0);

    if (page1.body.nextCursor) {
      // Second page
      const page2 = await authGet(`/items?limit=5&cursor=${page1.body.nextCursor}`, memberToken);
      expect(page2.status).toBe(200);
      expect(page2.body.items.length).toBeLessThanOrEqual(5);

      // Items should be different
      const page1Ids = page1.body.items.map((i: any) => i.id);
      const page2Ids = page2.body.items.map((i: any) => i.id);
      const overlap = page2Ids.filter((id: string) => page1Ids.includes(id));
      expect(overlap.length).toBe(0);
    }
  });

  it('should filter items server-side', async () => {
    const res = await authGet('/items?status=open&priority=high&limit=10', memberToken);
    expect(res.status).toBe(200);
    for (const item of res.body.items) {
      expect(item.status).toBe('open');
      expect(item.priority).toBe('high');
    }
  });
});
