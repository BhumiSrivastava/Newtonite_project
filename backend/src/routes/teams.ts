import { Router, Request, Response } from 'express';
import pool from '../db/pool';
import { getUserTeamIds } from '../services/permissions';

const router = Router();

/**
 * GET /teams
 * List teams the authenticated user belongs to.
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const teamIds = getUserTeamIds(user);

    if (teamIds.length === 0) {
      res.json({ teams: [] });
      return;
    }

    const result = await pool.query(
      `SELECT t.*, m.role as user_role,
              (SELECT COUNT(*) FROM memberships WHERE team_id = t.id) as member_count,
              (SELECT COUNT(*) FROM work_items WHERE team_id = t.id) as item_count
       FROM teams t
       JOIN memberships m ON m.team_id = t.id AND m.user_id = $1
       WHERE t.id = ANY($2)
       ORDER BY t.name`,
      [user.id, teamIds]
    );

    res.json({ teams: result.rows });
  } catch (err: any) {
    console.error('List teams error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /teams/:id/members
 * List members of a team (for assignee dropdowns etc).
 */
router.get('/:id/members', async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { id } = req.params;
    const teamIds = getUserTeamIds(user);

    if (!teamIds.includes(id)) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const result = await pool.query(
      `SELECT u.id, u.username, u.display_name, u.email, m.role
       FROM memberships m
       JOIN users u ON u.id = m.user_id
       WHERE m.team_id = $1
       ORDER BY m.role DESC, u.display_name`,
      [id]
    );

    res.json({ members: result.rows });
  } catch (err: any) {
    console.error('List members error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
