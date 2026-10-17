import pool from './pool';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

const SALT_ROUNDS = 10;

// Demo users with readable passwords
const USERS = [
  { username: 'alice_admin', email: 'alice@ops.local', displayName: 'Alice Chen', password: 'password123' },
  { username: 'bob_lead', email: 'bob@ops.local', displayName: 'Bob Martinez', password: 'password123' },
  { username: 'carol_member', email: 'carol@ops.local', displayName: 'Carol Singh', password: 'password123' },
  { username: 'dave_member', email: 'dave@ops.local', displayName: 'Dave Kim', password: 'password123' },
  { username: 'eve_viewer', email: 'eve@ops.local', displayName: 'Eve Johnson', password: 'password123' },
  { username: 'frank_lead', email: 'frank@ops.local', displayName: 'Frank O\'Brien', password: 'password123' },
  { username: 'grace_member', email: 'grace@ops.local', displayName: 'Grace Liu', password: 'password123' },
  { username: 'hank_admin', email: 'hank@ops.local', displayName: 'Hank Patel', password: 'password123' },
  { username: 'iris_member', email: 'iris@ops.local', displayName: 'Iris Nakamura', password: 'password123' },
  { username: 'jack_viewer', email: 'jack@ops.local', displayName: 'Jack Thompson', password: 'password123' },
];

const TEAMS = [
  { name: 'Platform Engineering', description: 'Infrastructure and platform services' },
  { name: 'Customer Support', description: 'Customer-facing issue resolution' },
  { name: 'Payments', description: 'Payment processing and billing' },
  { name: 'Compliance', description: 'Regulatory and compliance operations' },
];

// role assignments: [userIndex, teamIndex, role]
const MEMBERSHIPS: [number, number, string][] = [
  [0, 0, 'admin'],   // alice -> Platform Eng (admin)
  [0, 1, 'member'],  // alice -> Customer Support (member)
  [1, 0, 'lead'],    // bob -> Platform Eng (lead)
  [1, 1, 'lead'],    // bob -> Customer Support (lead)
  [2, 0, 'member'],  // carol -> Platform Eng
  [3, 0, 'member'],  // dave -> Platform Eng
  [4, 0, 'viewer'],  // eve -> Platform Eng (viewer)
  [5, 1, 'lead'],    // frank -> Customer Support (lead)
  [5, 2, 'lead'],    // frank -> Payments (lead)
  [6, 1, 'member'],  // grace -> Customer Support
  [6, 2, 'member'],  // grace -> Payments
  [7, 2, 'admin'],   // hank -> Payments (admin)
  [7, 3, 'admin'],   // hank -> Compliance (admin)
  [8, 2, 'member'],  // iris -> Payments
  [8, 3, 'member'],  // iris -> Compliance
  [9, 3, 'viewer'],  // jack -> Compliance (viewer)
];

const ITEM_TYPES = ['incident', 'customer_issue', 'payment', 'compliance', 'task'] as const;
const PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;
const STATUSES = ['open', 'in_progress', 'awaiting_approval', 'resolved', 'closed'] as const;

const SAMPLE_TITLES: Record<string, string[]> = {
  incident: [
    'Database connection pool exhausted',
    'API gateway returning 502 errors',
    'Memory leak in notification service',
    'Disk space alert on production server',
    'SSL certificate expiring in 48 hours',
    'CDN cache invalidation failing',
    'Load balancer health checks failing',
    'Redis cluster node unresponsive',
    'Kubernetes pod crash loop detected',
    'DNS resolution intermittent failures',
  ],
  customer_issue: [
    'Customer unable to access dashboard',
    'Incorrect billing amount displayed',
    'Export feature timing out for large datasets',
    'Two-factor authentication not sending SMS',
    'Account locked after password reset',
    'Search results returning stale data',
    'Mobile app crashes on report generation',
    'Customer data not syncing across devices',
    'Invitation emails landing in spam',
    'API rate limit too restrictive for enterprise',
  ],
  payment: [
    'Failed payment retry not processing',
    'Duplicate charge on customer account',
    'Refund stuck in pending state',
    'Currency conversion error for EUR payments',
    'Invoice generation delayed by 24 hours',
    'Subscription downgrade not reflected in billing',
    'Payment webhook delivery failures',
    'Tax calculation incorrect for Canadian customers',
    'Credit card tokenization timeout',
    'Payout reconciliation discrepancy',
  ],
  compliance: [
    'GDPR data deletion request pending',
    'SOC 2 audit finding remediation',
    'Privacy policy update for new features',
    'Data retention policy violation detected',
    'Third-party vendor security assessment',
    'Access log audit for Q3 review',
    'PCI DSS compliance scan failures',
    'HIPAA training completion tracking',
    'Cookie consent banner update required',
    'Data processing agreement renewal',
  ],
  task: [
    'Upgrade Node.js to latest LTS',
    'Implement rate limiting on public API',
    'Set up monitoring dashboards',
    'Document disaster recovery procedures',
    'Optimize database query performance',
    'Migrate to new CI/CD pipeline',
    'Review and update API documentation',
    'Implement automated backup verification',
    'Add structured logging to microservices',
    'Performance test for Black Friday load',
  ],
};

function randomEl<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomDate(daysBack: number, daysForward: number): Date {
  const now = Date.now();
  const start = now - daysBack * 86400000;
  const end = now + daysForward * 86400000;
  return new Date(start + Math.random() * (end - start));
}

async function seed() {
  console.log('Seeding database...');

  // Check if already seeded
  const existing = await pool.query('SELECT COUNT(*) FROM users');
  if (parseInt(existing.rows[0].count) > 0) {
    console.log('Database already seeded, skipping.');
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Create users
    const userIds: string[] = [];
    for (const user of USERS) {
      const id = uuidv4();
      const hash = await bcrypt.hash(user.password, SALT_ROUNDS);
      await client.query(
        `INSERT INTO users (id, username, email, password_hash, display_name) VALUES ($1, $2, $3, $4, $5)`,
        [id, user.username, user.email, hash, user.displayName]
      );
      userIds.push(id);
    }
    console.log(`Created ${USERS.length} users`);

    // Create teams
    const teamIds: string[] = [];
    for (const team of TEAMS) {
      const id = uuidv4();
      await client.query(
        `INSERT INTO teams (id, name, description) VALUES ($1, $2, $3)`,
        [id, team.name, team.description]
      );
      teamIds.push(id);
    }
    console.log(`Created ${TEAMS.length} teams`);

    // Create memberships
    for (const [userIdx, teamIdx, role] of MEMBERSHIPS) {
      await client.query(
        `INSERT INTO memberships (id, user_id, team_id, role) VALUES ($1, $2, $3, $4)`,
        [uuidv4(), userIds[userIdx], teamIds[teamIdx], role]
      );
    }
    console.log(`Created ${MEMBERSHIPS.length} memberships`);

    // Create work items (3000+ items across teams for pagination testing)
    const TOTAL_ITEMS = 3000;
    let itemCount = 0;

    for (let i = 0; i < TOTAL_ITEMS; i++) {
      const type = randomEl(ITEM_TYPES);
      const titles = SAMPLE_TITLES[type];
      const title = `${titles[i % titles.length]}${i >= titles.length ? ` #${Math.floor(i / titles.length) + 1}` : ''}`;
      const priority = randomEl(PRIORITIES);
      const status = randomEl(STATUSES);
      
      // Assign to a team that handles this type
      let teamIdx: number;
      if (type === 'incident' || type === 'task') teamIdx = 0;
      else if (type === 'customer_issue') teamIdx = 1;
      else if (type === 'payment') teamIdx = 2;
      else teamIdx = 3;

      // Pick a random team sometimes for variety
      if (Math.random() > 0.7) teamIdx = Math.floor(Math.random() * TEAMS.length);

      const teamId = teamIds[teamIdx];

      // Find team members for assignee
      const teamMembers = MEMBERSHIPS
        .filter(([, tIdx]) => tIdx === teamIdx)
        .map(([uIdx]) => userIds[uIdx]);
      
      const creatorId = randomEl(teamMembers);
      const assigneeId = status === 'open' && Math.random() > 0.5
        ? null
        : randomEl(teamMembers);
      
      const createdAt = randomDate(90, 0);
      const dueDate = Math.random() > 0.3 ? randomDate(-5, 30) : null;
      const version = status === 'open' ? 1 : Math.floor(Math.random() * 5) + 1;
      
      const itemId = uuidv4();
      await client.query(
        `INSERT INTO work_items (id, title, description, type, priority, status, team_id, assignee_id, created_by, due_date, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)`,
        [
          itemId,
          title,
          `Auto-generated work item for ${type} on team ${TEAMS[teamIdx].name}. Priority: ${priority}.`,
          type,
          priority,
          status,
          teamId,
          assigneeId,
          creatorId,
          dueDate,
          version,
          createdAt,
        ]
      );

      // Add creation activity event
      await client.query(
        `INSERT INTO activity_events (id, work_item_id, user_id, event_type, new_value, created_at)
         VALUES ($1, $2, $3, 'created', $4, $5)`,
        [uuidv4(), itemId, creatorId, title, createdAt]
      );

      itemCount++;
      if (itemCount % 500 === 0) {
        console.log(`  Created ${itemCount} items...`);
      }
    }

    console.log(`Created ${itemCount} work items with activity events`);

    await client.query('COMMIT');
    console.log('Seed completed successfully!');
    console.log('\n--- Demo Login Credentials ---');
    console.log('All passwords: password123');
    console.log('');
    console.log('Admin:   alice_admin  (Platform Eng admin, Customer Support member)');
    console.log('Lead:    bob_lead     (Platform Eng lead, Customer Support lead)');
    console.log('Member:  carol_member (Platform Eng member)');
    console.log('Member:  dave_member  (Platform Eng member)');
    console.log('Viewer:  eve_viewer   (Platform Eng viewer)');
    console.log('Lead:    frank_lead   (Customer Support lead, Payments lead)');
    console.log('Member:  grace_member (Customer Support member, Payments member)');
    console.log('Admin:   hank_admin   (Payments admin, Compliance admin)');
    console.log('Member:  iris_member  (Payments member, Compliance member)');
    console.log('Viewer:  jack_viewer  (Compliance viewer)');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  await pool.end();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
