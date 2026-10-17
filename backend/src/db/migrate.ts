import pool from './pool';

const MIGRATION_SQL = `
-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(50) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Teams table
CREATE TABLE IF NOT EXISTS teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) UNIQUE NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Memberships (user <-> team with role)
CREATE TYPE team_role AS ENUM ('viewer', 'member', 'lead', 'admin');

CREATE TABLE IF NOT EXISTS memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  role team_role NOT NULL DEFAULT 'member',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, team_id)
);

-- Work item enums
CREATE TYPE item_type AS ENUM ('incident', 'customer_issue', 'payment', 'compliance', 'task');
CREATE TYPE item_priority AS ENUM ('critical', 'high', 'medium', 'low');
CREATE TYPE item_status AS ENUM ('open', 'in_progress', 'awaiting_approval', 'resolved', 'closed');

-- Work items table
CREATE TABLE IF NOT EXISTS work_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(300) NOT NULL,
  description TEXT,
  type item_type NOT NULL DEFAULT 'task',
  priority item_priority NOT NULL DEFAULT 'medium',
  status item_status NOT NULL DEFAULT 'open',
  team_id UUID NOT NULL REFERENCES teams(id),
  assignee_id UUID REFERENCES users(id),
  created_by UUID NOT NULL REFERENCES users(id),
  due_date TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_work_items_team ON work_items(team_id);
CREATE INDEX IF NOT EXISTS idx_work_items_assignee ON work_items(assignee_id);
CREATE INDEX IF NOT EXISTS idx_work_items_status ON work_items(status);
CREATE INDEX IF NOT EXISTS idx_work_items_priority ON work_items(priority);
CREATE INDEX IF NOT EXISTS idx_work_items_created_at ON work_items(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_work_items_due_date ON work_items(due_date);
CREATE INDEX IF NOT EXISTS idx_work_items_title_trgm ON work_items USING gin (title gin_trgm_ops);

-- Activity events (append-only history)
CREATE TYPE event_type AS ENUM (
  'created', 'status_changed', 'assignee_changed', 'priority_changed',
  'field_updated', 'comment_added', 'claimed', 'transition'
);

CREATE TABLE IF NOT EXISTS activity_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id UUID NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  event_type event_type NOT NULL,
  old_value TEXT,
  new_value TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_events_work_item ON activity_events(work_item_id, created_at DESC);

-- Comments
CREATE TABLE IF NOT EXISTS comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id UUID NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comments_work_item ON comments(work_item_id, created_at DESC);

-- Idempotency keys
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key VARCHAR(255) PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  method VARCHAR(10) NOT NULL,
  path VARCHAR(500) NOT NULL,
  status_code INTEGER NOT NULL,
  response_body JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_idempotency_keys_created ON idempotency_keys(created_at);

-- Jobs / Outbox table (transactional outbox pattern)
CREATE TYPE job_status AS ENUM ('pending', 'processing', 'completed', 'failed');

CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL,
  status job_status NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  scheduled_for TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jobs_pending ON jobs(status, scheduled_for) WHERE status = 'pending';
`;

async function migrate() {
  console.log('Running database migrations...');
  
  // Create trigram extension first (may need superuser, ignore if fails)
  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS pg_trgm;');
  } catch (e) {
    console.warn('Could not create pg_trgm extension, text search index will be skipped');
  }
  
  // Run migrations in parts to handle the trigram index separately
  const parts = MIGRATION_SQL.split('idx_work_items_title_trgm');
  
  try {
    // Try running the full migration
    await pool.query(MIGRATION_SQL);
    console.log('Migrations completed successfully.');
  } catch (e: any) {
    // If trigram index fails, run without it
    if (e.message?.includes('trgm') || e.message?.includes('operator class')) {
      const sqlWithoutTrgm = MIGRATION_SQL
        .split('\n')
        .filter(line => !line.includes('trgm'))
        .join('\n');
      await pool.query(sqlWithoutTrgm);
      console.log('Migrations completed (without trigram index).');
    } else {
      throw e;
    }
  }
  
  await pool.end();
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
