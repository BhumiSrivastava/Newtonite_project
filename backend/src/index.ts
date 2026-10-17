import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { authMiddleware } from './middleware/auth';
import authRoutes from './routes/auth';
import itemRoutes from './routes/items';
import teamRoutes from './routes/teams';
import { startWorker } from './worker/jobWorker';

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || '3001');

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (_, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Public routes
app.use('/auth', authRoutes);

// Protected routes - auth middleware applied once
app.use('/auth/me', authMiddleware);
app.use('/items', authMiddleware, itemRoutes);
app.use('/teams', authMiddleware, teamRoutes);

// Dashboard endpoint
app.get('/dashboard/stats', authMiddleware, async (req, res) => {
  try {
    const user = req.user!;
    const teamIds = user.memberships.map(m => m.team_id);

    if (teamIds.length === 0) {
      res.json({ assigned: 0, unassigned_urgent: 0, awaiting_approval: 0, total: 0 });
      return;
    }

    const [assigned, unassigned, awaiting, total] = await Promise.all([
      // Assigned to me
      (await import('./db/pool')).default.query(
        `SELECT COUNT(*) FROM work_items WHERE assignee_id = $1 AND status NOT IN ('closed', 'resolved')`,
        [user.id]
      ),
      // Unassigned urgent
      (await import('./db/pool')).default.query(
        `SELECT COUNT(*) FROM work_items WHERE assignee_id IS NULL AND priority IN ('critical', 'high') AND status = 'open' AND team_id = ANY($1)`,
        [teamIds]
      ),
      // Awaiting my approval (only for leads/admins)
      (await import('./db/pool')).default.query(
        `SELECT COUNT(*) FROM work_items WHERE status = 'awaiting_approval' AND team_id = ANY($1)`,
        [user.memberships.filter(m => m.role === 'lead' || m.role === 'admin').map(m => m.team_id)]
      ),
      // Total across my teams
      (await import('./db/pool')).default.query(
        `SELECT COUNT(*) FROM work_items WHERE team_id = ANY($1)`,
        [teamIds]
      ),
    ]);

    res.json({
      assigned: parseInt(assigned.rows[0].count),
      unassigned_urgent: parseInt(unassigned.rows[0].count),
      awaiting_approval: parseInt(awaiting.rows[0].count),
      total: parseInt(total.rows[0].count),
    });
  } catch (err: any) {
    console.error('Dashboard stats error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start server
export const server = app.listen(PORT, () => {
  console.log(`🚀 Operations Under Pressure API running on port ${PORT}`);
  // Start the outbox worker
  startWorker();
});

export default app;
