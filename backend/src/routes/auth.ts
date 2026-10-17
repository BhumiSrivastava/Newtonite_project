import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import pool from '../db/pool';
import { generateToken } from '../middleware/auth';

const router = Router();

/**
 * POST /auth/login
 * Simple login returning a JWT token. No sign-up flow (seeded users only).
 */
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      res.status(400).json({ error: 'Username and password are required' });
      return;
    }

    const result = await pool.query(
      `SELECT id, username, email, password_hash, display_name FROM users WHERE username = $1`,
      [username]
    );

    if (result.rows.length === 0) {
      res.status(401).json({ error: 'Invalid username or password' });
      return;
    }

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      res.status(401).json({ error: 'Invalid username or password' });
      return;
    }

    // Load memberships
    const memberships = await pool.query(
      `SELECT m.team_id, m.role, t.name as team_name
       FROM memberships m
       JOIN teams t ON t.id = m.team_id
       WHERE m.user_id = $1`,
      [user.id]
    );

    const token = generateToken({ userId: user.id, username: user.username });

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        display_name: user.display_name,
        memberships: memberships.rows,
      },
    });
  } catch (err: any) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /auth/me
 * Returns the currently authenticated user's info.
 */
router.get('/me', async (req: Request, res: Response) => {
  // This route requires auth middleware applied at the app level or inline
  if (!req.user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  res.json({ user: req.user });
});

export default router;
