import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import pool, { withTransaction } from '../db/pool';
import { checkPermission, getUserTeamIds, hasMinimumRole } from '../services/permissions';
import {
  ALLOWED_TRANSITIONS,
  LEAD_ONLY_TRANSITIONS,
  ADMIN_ONLY_TRANSITIONS,
  ItemStatus,
  ItemPriority,
  ItemType,
} from '../types';
import { idempotencyMiddleware } from '../middleware/idempotency';

const router = Router();

// Apply idempotency middleware to all routes
router.use(idempotencyMiddleware);

/**
 * GET /items
 * Server-side filtered, cursor-paginated list of work items.
 * Only returns items from teams the user belongs to (resource-level auth).
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const teamIds = getUserTeamIds(user);

    if (teamIds.length === 0) {
      res.json({ items: [], nextCursor: null, total: 0 });
      return;
    }

    // Parse query params
    const {
      status,
      priority,
      type,
      assignee,
      team,
      q,
      cursor,
      limit: limitStr,
      sort = 'created_at',
      order = 'desc',
      view, // 'assigned_to_me', 'unassigned_urgent', 'awaiting_approval'
    } = req.query as Record<string, string | undefined>;

    const limit = Math.min(parseInt(limitStr || '20'), 100);

    // Build WHERE clauses
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIdx = 1;

    // ALWAYS scope to user's teams (resource-level authorization)
    conditions.push(`wi.team_id = ANY($${paramIdx})`);
    params.push(teamIds);
    paramIdx++;

    // Dashboard views
    if (view === 'assigned_to_me') {
      conditions.push(`wi.assignee_id = $${paramIdx}`);
      params.push(user.id);
      paramIdx++;
    } else if (view === 'unassigned_urgent') {
      conditions.push(`wi.assignee_id IS NULL`);
      conditions.push(`wi.priority IN ('critical', 'high')`);
      conditions.push(`wi.status = 'open'`);
    } else if (view === 'awaiting_approval') {
      conditions.push(`wi.status = 'awaiting_approval'`);
      // Only show items from teams where user is lead or admin
      const leadTeamIds = user.memberships
        .filter(m => m.role === 'lead' || m.role === 'admin')
        .map(m => m.team_id);
      if (leadTeamIds.length === 0) {
        res.json({ items: [], nextCursor: null, total: 0 });
        return;
      }
      // Override team filter for this view
      conditions[0] = `wi.team_id = ANY($${paramIdx})`;
      params.push(leadTeamIds);
      paramIdx++;
    }

    // Filters
    if (status) {
      conditions.push(`wi.status = $${paramIdx}`);
      params.push(status);
      paramIdx++;
    }
    if (priority) {
      conditions.push(`wi.priority = $${paramIdx}`);
      params.push(priority);
      paramIdx++;
    }
    if (type) {
      conditions.push(`wi.type = $${paramIdx}`);
      params.push(type);
      paramIdx++;
    }
    if (assignee) {
      if (assignee === 'unassigned') {
        conditions.push(`wi.assignee_id IS NULL`);
      } else {
        conditions.push(`wi.assignee_id = $${paramIdx}`);
        params.push(assignee);
        paramIdx++;
      }
    }
    if (team) {
      conditions.push(`wi.team_id = $${paramIdx}`);
      params.push(team);
      paramIdx++;
    }

    // Text search
    if (q) {
      conditions.push(`(wi.title ILIKE $${paramIdx} OR wi.description ILIKE $${paramIdx})`);
      params.push(`%${q}%`);
      paramIdx++;
    }

    // Cursor pagination
    if (cursor) {
      conditions.push(`wi.created_at < (SELECT created_at FROM work_items WHERE id = $${paramIdx})`);
      params.push(cursor);
      paramIdx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Validate sort column
    const allowedSorts = ['created_at', 'updated_at', 'priority', 'due_date', 'title'];
    const sortCol = allowedSorts.includes(sort) ? sort : 'created_at';
    const sortOrder = order === 'asc' ? 'ASC' : 'DESC';

    // Count total (for display, not for pagination logic)
    const countQuery = `SELECT COUNT(*) FROM work_items wi ${whereClause}`;
    const countResult = await pool.query(countQuery, params);
    const total = parseInt(countResult.rows[0].count);

    // Fetch items
    const query = `
      SELECT wi.*,
             u_assignee.display_name as assignee_name,
             u_creator.display_name as creator_name,
             t.name as team_name
      FROM work_items wi
      LEFT JOIN users u_assignee ON u_assignee.id = wi.assignee_id
      LEFT JOIN users u_creator ON u_creator.id = wi.created_by
      LEFT JOIN teams t ON t.id = wi.team_id
      ${whereClause}
      ORDER BY wi.${sortCol} ${sortOrder}
      LIMIT $${paramIdx}
    `;
    params.push(limit + 1); // Fetch one extra to determine if there's a next page

    const result = await pool.query(query, params);

    const hasMore = result.rows.length > limit;
    const items = result.rows.slice(0, limit);
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    res.json({ items, nextCursor, total });
  } catch (err: any) {
    console.error('List items error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /items/:id
 * Get a single work item (with auth check).
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { id } = req.params;

    const result = await pool.query(
      `SELECT wi.*,
              u_assignee.display_name as assignee_name,
              u_creator.display_name as creator_name,
              t.name as team_name
       FROM work_items wi
       LEFT JOIN users u_assignee ON u_assignee.id = wi.assignee_id
       LEFT JOIN users u_creator ON u_creator.id = wi.created_by
       LEFT JOIN teams t ON t.id = wi.team_id
       WHERE wi.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Work item not found' });
      return;
    }

    const item = result.rows[0];

    // Resource-level auth: must be member of item's team
    const perm = checkPermission(user, 'view_items', item.team_id);
    if (!perm.allowed) {
      res.status(403).json({ error: 'Access denied', reason: perm.reason });
      return;
    }

    res.json({ item });
  } catch (err: any) {
    console.error('Get item error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /items
 * Create a new work item. Activity event written in the SAME transaction.
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { title, description, type, priority, team_id, assignee_id, due_date } = req.body;

    if (!title || !team_id) {
      res.status(400).json({ error: 'title and team_id are required' });
      return;
    }

    // Auth check
    const perm = checkPermission(user, 'create_items', team_id);
    if (!perm.allowed) {
      res.status(403).json({ error: 'Access denied', reason: perm.reason });
      return;
    }

    // Validate assignee is member of the team
    if (assignee_id) {
      const assigneeCheck = await pool.query(
        'SELECT 1 FROM memberships WHERE user_id = $1 AND team_id = $2',
        [assignee_id, team_id]
      );
      if (assigneeCheck.rows.length === 0) {
        res.status(400).json({ error: 'Assignee is not a member of the specified team' });
        return;
      }
    }

    const item = await withTransaction(async (client) => {
      const itemId = uuidv4();
      const result = await client.query(
        `INSERT INTO work_items (id, title, description, type, priority, status, team_id, assignee_id, created_by, due_date, version)
         VALUES ($1, $2, $3, $4, $5, 'open', $6, $7, $8, $9, 1)
         RETURNING *`,
        [
          itemId,
          title,
          description || null,
          type || 'task',
          priority || 'medium',
          team_id,
          assignee_id || null,
          user.id,
          due_date || null,
        ]
      );

      // Activity event in SAME transaction
      await client.query(
        `INSERT INTO activity_events (id, work_item_id, user_id, event_type, new_value, metadata)
         VALUES ($1, $2, $3, 'created', $4, $5)`,
        [
          uuidv4(),
          itemId,
          user.id,
          title,
          JSON.stringify({ type: type || 'task', priority: priority || 'medium', team_id }),
        ]
      );

      // Outbox job: notify team about new item
      await client.query(
        `INSERT INTO jobs (id, type, payload) VALUES ($1, $2, $3)`,
        [
          uuidv4(),
          'notify_new_item',
          JSON.stringify({ item_id: itemId, team_id, created_by: user.id }),
        ]
      );

      return result.rows[0];
    });

    res.status(201).json({ item });
  } catch (err: any) {
    console.error('Create item error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PATCH /items/:id
 * Update a work item with optimistic locking (version check).
 * Activity events for every changed field in the SAME transaction.
 */
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { id } = req.params;
    const { title, description, priority, type, assignee_id, due_date, version } = req.body;

    if (version === undefined || version === null) {
      res.status(400).json({ error: 'version is required for updates (optimistic locking)' });
      return;
    }

    const item = await withTransaction(async (client) => {
      // Get current item with FOR UPDATE to prevent race within transaction
      const current = await client.query(
        'SELECT * FROM work_items WHERE id = $1 FOR UPDATE',
        [id]
      );

      if (current.rows.length === 0) {
        throw { status: 404, message: 'Work item not found' };
      }

      const currentItem = current.rows[0];

      // Resource-level auth
      const action = currentItem.created_by === user.id || currentItem.assignee_id === user.id
        ? 'edit_own_items'
        : 'edit_any_item';
      const perm = checkPermission(user, action, currentItem.team_id, currentItem.created_by);
      if (!perm.allowed) {
        throw { status: 403, message: perm.reason };
      }

      // Optimistic locking: check version
      if (currentItem.version !== version) {
        // Return current item so client can reconcile
        throw {
          status: 409,
          message: 'Version conflict: item has been modified',
          currentItem: currentItem,
        };
      }

      // Build update fields and track changes for activity events
      const updates: string[] = [];
      const values: any[] = [];
      const events: Array<{ type: string; old: string; new_val: string }> = [];
      let vIdx = 1;

      if (title !== undefined && title !== currentItem.title) {
        updates.push(`title = $${vIdx++}`);
        values.push(title);
        events.push({ type: 'field_updated', old: currentItem.title, new_val: title });
      }
      if (description !== undefined && description !== currentItem.description) {
        updates.push(`description = $${vIdx++}`);
        values.push(description);
      }
      if (priority !== undefined && priority !== currentItem.priority) {
        updates.push(`priority = $${vIdx++}`);
        values.push(priority);
        events.push({ type: 'priority_changed', old: currentItem.priority, new_val: priority });
      }
      if (type !== undefined && type !== currentItem.type) {
        updates.push(`type = $${vIdx++}`);
        values.push(type);
        events.push({ type: 'field_updated', old: currentItem.type, new_val: type });
      }
      if (assignee_id !== undefined && assignee_id !== currentItem.assignee_id) {
        updates.push(`assignee_id = $${vIdx++}`);
        values.push(assignee_id || null);
        events.push({
          type: 'assignee_changed',
          old: currentItem.assignee_id || 'unassigned',
          new_val: assignee_id || 'unassigned',
        });
      }
      if (due_date !== undefined) {
        updates.push(`due_date = $${vIdx++}`);
        values.push(due_date || null);
      }

      if (updates.length === 0) {
        return currentItem; // Nothing to update
      }

      // Increment version and update timestamp
      updates.push(`version = version + 1`);
      updates.push(`updated_at = NOW()`);

      // WHERE includes version check (belt and suspenders with FOR UPDATE)
      values.push(id);
      values.push(version);
      const updateQuery = `
        UPDATE work_items SET ${updates.join(', ')}
        WHERE id = $${vIdx++} AND version = $${vIdx++}
        RETURNING *
      `;

      const result = await client.query(updateQuery, values);

      if (result.rows.length === 0) {
        throw { status: 409, message: 'Version conflict during update' };
      }

      // Write activity events in SAME transaction
      for (const event of events) {
        await client.query(
          `INSERT INTO activity_events (id, work_item_id, user_id, event_type, old_value, new_value)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [uuidv4(), id, user.id, event.type, event.old, event.new_val]
        );
      }

      // If assignee changed, create job for notification
      if (assignee_id !== undefined && assignee_id !== currentItem.assignee_id && assignee_id) {
        await client.query(
          `INSERT INTO jobs (id, type, payload) VALUES ($1, $2, $3)`,
          [
            uuidv4(),
            'notify_assignee_changed',
            JSON.stringify({ item_id: id, new_assignee: assignee_id, changed_by: user.id }),
          ]
        );
      }

      return result.rows[0];
    });

    res.json({ item });
  } catch (err: any) {
    if (err.status) {
      const response: any = { error: err.message };
      if (err.currentItem) response.currentItem = err.currentItem;
      res.status(err.status).json(response);
      return;
    }
    console.error('Update item error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /items/:id/claim
 * Atomic claim: UPDATE ... WHERE assignee_id IS NULL
 * Returns 409 if already claimed.
 */
router.post('/:id/claim', async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { id } = req.params;

    const item = await withTransaction(async (client) => {
      // Get the item first for auth check
      const current = await client.query(
        'SELECT * FROM work_items WHERE id = $1',
        [id]
      );

      if (current.rows.length === 0) {
        throw { status: 404, message: 'Work item not found' };
      }

      const currentItem = current.rows[0];

      // Auth check: must be member of team with claim permission
      const perm = checkPermission(user, 'claim_items', currentItem.team_id);
      if (!perm.allowed) {
        throw { status: 403, message: perm.reason };
      }

      // Atomic conditional update — the core concurrency primitive
      const result = await client.query(
        `UPDATE work_items
         SET assignee_id = $1, version = version + 1, updated_at = NOW(),
             status = CASE WHEN status = 'open' THEN 'in_progress'::item_status ELSE status END
         WHERE id = $2 AND assignee_id IS NULL
         RETURNING *`,
        [user.id, id]
      );

      if (result.rows.length === 0) {
        // Already claimed — return 409 with current item
        const latest = await client.query('SELECT * FROM work_items WHERE id = $1', [id]);
        throw {
          status: 409,
          message: 'Item has already been claimed',
          currentItem: latest.rows[0],
        };
      }

      // Activity event in SAME transaction
      await client.query(
        `INSERT INTO activity_events (id, work_item_id, user_id, event_type, old_value, new_value)
         VALUES ($1, $2, $3, 'claimed', 'unassigned', $4)`,
        [uuidv4(), id, user.id, user.display_name]
      );

      // Also record status change if it happened
      if (currentItem.status === 'open') {
        await client.query(
          `INSERT INTO activity_events (id, work_item_id, user_id, event_type, old_value, new_value)
           VALUES ($1, $2, $3, 'status_changed', 'open', 'in_progress')`,
          [uuidv4(), id, user.id]
        );
      }

      // Outbox: notify about claim
      await client.query(
        `INSERT INTO jobs (id, type, payload) VALUES ($1, $2, $3)`,
        [
          uuidv4(),
          'notify_item_claimed',
          JSON.stringify({ item_id: id, claimed_by: user.id }),
        ]
      );

      return result.rows[0];
    });

    res.json({ item });
  } catch (err: any) {
    if (err.status) {
      const response: any = { error: err.message };
      if (err.currentItem) response.currentItem = err.currentItem;
      res.status(err.status).json(response);
      return;
    }
    console.error('Claim item error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /items/:id/transition
 * Workflow state transition with server-side rule enforcement.
 * - Validates transition is allowed per state diagram
 * - Lead/Admin only for approval transitions
 * - Activity event in same transaction
 */
router.post('/:id/transition', async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { id } = req.params;
    const { to_status, version } = req.body;

    if (!to_status) {
      res.status(400).json({ error: 'to_status is required' });
      return;
    }

    if (version === undefined) {
      res.status(400).json({ error: 'version is required for transitions' });
      return;
    }

    const item = await withTransaction(async (client) => {
      // Lock the row
      const current = await client.query(
        'SELECT * FROM work_items WHERE id = $1 FOR UPDATE',
        [id]
      );

      if (current.rows.length === 0) {
        throw { status: 404, message: 'Work item not found' };
      }

      const currentItem = current.rows[0];

      // Auth check: must be member of team
      const perm = checkPermission(user, 'transition_items', currentItem.team_id);
      if (!perm.allowed) {
        throw { status: 403, message: perm.reason };
      }

      // Version check
      if (currentItem.version !== version) {
        throw {
          status: 409,
          message: 'Version conflict: item has been modified',
          currentItem,
        };
      }

      const fromStatus: ItemStatus = currentItem.status;
      const toStatus: ItemStatus = to_status;

      // Check if transition is allowed
      const allowedNext = ALLOWED_TRANSITIONS[fromStatus];
      if (!allowedNext || !allowedNext.includes(toStatus)) {
        throw {
          status: 400,
          message: `Transition from '${fromStatus}' to '${toStatus}' is not allowed. Allowed: ${allowedNext?.join(', ') || 'none'}`,
        };
      }

      // Check Lead-only transitions
      const isLeadTransition = LEAD_ONLY_TRANSITIONS.some(
        ([from, to]) => from === fromStatus && to === toStatus
      );
      if (isLeadTransition && !hasMinimumRole(user, currentItem.team_id, 'lead')) {
        throw {
          status: 403,
          message: `Only Lead or Admin can transition from '${fromStatus}' to '${toStatus}'`,
        };
      }

      // Check Admin-only transitions
      const isAdminTransition = ADMIN_ONLY_TRANSITIONS.some(
        ([from, to]) => from === fromStatus && to === toStatus
      );
      if (isAdminTransition && !hasMinimumRole(user, currentItem.team_id, 'admin')) {
        throw {
          status: 403,
          message: `Only Admin can transition from '${fromStatus}' to '${toStatus}'`,
        };
      }

      // Perform transition
      const result = await client.query(
        `UPDATE work_items SET status = $1, version = version + 1, updated_at = NOW()
         WHERE id = $2 AND version = $3
         RETURNING *`,
        [toStatus, id, version]
      );

      if (result.rows.length === 0) {
        throw { status: 409, message: 'Version conflict during transition' };
      }

      // Activity event in SAME transaction
      await client.query(
        `INSERT INTO activity_events (id, work_item_id, user_id, event_type, old_value, new_value)
         VALUES ($1, $2, $3, 'status_changed', $4, $5)`,
        [uuidv4(), id, user.id, fromStatus, toStatus]
      );

      // Outbox: notify about transition
      await client.query(
        `INSERT INTO jobs (id, type, payload) VALUES ($1, $2, $3)`,
        [
          uuidv4(),
          'notify_status_changed',
          JSON.stringify({
            item_id: id,
            from_status: fromStatus,
            to_status: toStatus,
            changed_by: user.id,
          }),
        ]
      );

      return result.rows[0];
    });

    res.json({ item });
  } catch (err: any) {
    if (err.status) {
      const response: any = { error: err.message };
      if (err.currentItem) response.currentItem = err.currentItem;
      res.status(err.status).json(response);
      return;
    }
    console.error('Transition error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /items/:id/activity
 * Get activity timeline for a work item (paginated).
 */
router.get('/:id/activity', async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { id } = req.params;
    const { cursor, limit: limitStr } = req.query as Record<string, string | undefined>;
    const limit = Math.min(parseInt(limitStr || '50'), 100);

    // Check item exists and user has access
    const item = await pool.query('SELECT team_id FROM work_items WHERE id = $1', [id]);
    if (item.rows.length === 0) {
      res.status(404).json({ error: 'Work item not found' });
      return;
    }

    const perm = checkPermission(user, 'view_items', item.rows[0].team_id);
    if (!perm.allowed) {
      res.status(403).json({ error: 'Access denied', reason: perm.reason });
      return;
    }

    let query = `
      SELECT ae.*, u.display_name as user_name
      FROM activity_events ae
      JOIN users u ON u.id = ae.user_id
      WHERE ae.work_item_id = $1
    `;
    const params: any[] = [id];

    if (cursor) {
      query += ` AND ae.created_at < (SELECT created_at FROM activity_events WHERE id = $2)`;
      params.push(cursor);
    }

    query += ` ORDER BY ae.created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit + 1);

    const result = await pool.query(query, params);

    const hasMore = result.rows.length > limit;
    const events = result.rows.slice(0, limit);
    const nextCursor = hasMore ? events[events.length - 1].id : null;

    res.json({ events, nextCursor });
  } catch (err: any) {
    console.error('Activity error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /items/:id/comments
 * Add a comment. Event recorded in the same transaction.
 */
router.post('/:id/comments', async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { id } = req.params;
    const { body } = req.body;

    if (!body || !body.trim()) {
      res.status(400).json({ error: 'Comment body is required' });
      return;
    }

    const comment = await withTransaction(async (client) => {
      // Check item exists and user has access
      const item = await client.query('SELECT team_id FROM work_items WHERE id = $1', [id]);
      if (item.rows.length === 0) {
        throw { status: 404, message: 'Work item not found' };
      }

      const perm = checkPermission(user, 'view_items', item.rows[0].team_id);
      if (!perm.allowed) {
        throw { status: 403, message: perm.reason };
      }

      const commentId = uuidv4();
      const result = await client.query(
        `INSERT INTO comments (id, work_item_id, user_id, body)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [commentId, id, user.id, body.trim()]
      );

      // Activity event in SAME transaction
      await client.query(
        `INSERT INTO activity_events (id, work_item_id, user_id, event_type, new_value)
         VALUES ($1, $2, $3, 'comment_added', $4)`,
        [uuidv4(), id, user.id, body.trim().substring(0, 200)]
      );

      return result.rows[0];
    });

    res.status(201).json({ comment });
  } catch (err: any) {
    if (err.status) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error('Comment error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /items/:id/comments
 * Get comments for a work item (paginated).
 */
router.get('/:id/comments', async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { id } = req.params;
    const { cursor, limit: limitStr } = req.query as Record<string, string | undefined>;
    const limit = Math.min(parseInt(limitStr || '50'), 100);

    // Check item exists and user has access
    const item = await pool.query('SELECT team_id FROM work_items WHERE id = $1', [id]);
    if (item.rows.length === 0) {
      res.status(404).json({ error: 'Work item not found' });
      return;
    }

    const perm = checkPermission(user, 'view_items', item.rows[0].team_id);
    if (!perm.allowed) {
      res.status(403).json({ error: 'Access denied', reason: perm.reason });
      return;
    }

    let query = `
      SELECT c.*, u.display_name as user_name
      FROM comments c
      JOIN users u ON u.id = c.user_id
      WHERE c.work_item_id = $1
    `;
    const params: any[] = [id];

    if (cursor) {
      query += ` AND c.created_at > (SELECT created_at FROM comments WHERE id = $2)`;
      params.push(cursor);
    }

    query += ` ORDER BY c.created_at ASC LIMIT $${params.length + 1}`;
    params.push(limit + 1);

    const result = await pool.query(query, params);

    const hasMore = result.rows.length > limit;
    const comments = result.rows.slice(0, limit);
    const nextCursor = hasMore ? comments[comments.length - 1].id : null;

    res.json({ comments, nextCursor });
  } catch (err: any) {
    console.error('Comments error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
