import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import pool from '../db/pool';
import { AuthUser, JwtPayload } from '../types';

// Extend Express Request to include user
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

const JWT_SECRET = process.env.JWT_SECRET || 'newtonite-ops-secret-key-change-in-production';

export function generateToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}

/**
 * Authentication middleware: validates JWT and loads user with all team memberships.
 * This is the single entry point for auth — every protected route uses this.
 */
export async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid authorization header' });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const payload = verifyToken(token);

    // Load user and memberships in a single query
    const result = await pool.query(
      `SELECT u.id, u.username, u.display_name,
              m.id as membership_id, m.team_id, m.role, t.name as team_name
       FROM users u
       LEFT JOIN memberships m ON m.user_id = u.id
       LEFT JOIN teams t ON t.id = m.team_id
       WHERE u.id = $1`,
      [payload.userId]
    );

    if (result.rows.length === 0) {
      res.status(401).json({ error: 'User not found' });
      return;
    }

    const firstRow = result.rows[0];
    const memberships = result.rows
      .filter(r => r.membership_id)
      .map(r => ({
        id: r.membership_id,
        user_id: firstRow.id,
        team_id: r.team_id,
        role: r.role,
        team_name: r.team_name,
      }));

    req.user = {
      id: firstRow.id,
      username: firstRow.username,
      display_name: firstRow.display_name,
      memberships,
    };

    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
