import pool from '../db/pool';

/**
 * Transactional outbox worker.
 * Picks up pending jobs with FOR UPDATE SKIP LOCKED to allow multiple workers.
 * Retries with exponential backoff, caps attempts, handler is idempotent.
 */

interface JobHandler {
  (payload: any): Promise<void>;
}

// Job handlers registry
const handlers: Record<string, JobHandler> = {
  notify_new_item: async (payload) => {
    // In production, this would send an email or push notification.
    // For this demo, we log it (the outbox pattern guarantees delivery).
    console.log(`[JOB] New item notification: item=${payload.item_id}, team=${payload.team_id}`);
  },

  notify_assignee_changed: async (payload) => {
    console.log(`[JOB] Assignee changed: item=${payload.item_id}, new_assignee=${payload.new_assignee}`);
  },

  notify_item_claimed: async (payload) => {
    console.log(`[JOB] Item claimed: item=${payload.item_id}, claimed_by=${payload.claimed_by}`);
  },

  notify_status_changed: async (payload) => {
    console.log(`[JOB] Status changed: item=${payload.item_id}, ${payload.from_status} → ${payload.to_status}`);
  },
};

// Track processed job IDs for idempotency within the worker's lifetime
const processedJobs = new Set<string>();

/**
 * Process a single job. Idempotent: if the same job is processed twice,
 * it produces one effect (checked via processedJobs set + DB status).
 */
async function processJob(): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Pick one pending job with SKIP LOCKED to avoid contention
    const result = await client.query(
      `SELECT * FROM jobs
       WHERE status = 'pending' AND scheduled_for <= NOW()
       ORDER BY created_at
       LIMIT 1
       FOR UPDATE SKIP LOCKED`
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return false; // No jobs to process
    }

    const job = result.rows[0];

    // Idempotency check
    if (processedJobs.has(job.id)) {
      await client.query(
        `UPDATE jobs SET status = 'completed', updated_at = NOW() WHERE id = $1`,
        [job.id]
      );
      await client.query('COMMIT');
      return true;
    }

    // Mark as processing
    await client.query(
      `UPDATE jobs SET status = 'processing', attempts = attempts + 1, updated_at = NOW() WHERE id = $1`,
      [job.id]
    );

    const handler = handlers[job.type];
    if (!handler) {
      await client.query(
        `UPDATE jobs SET status = 'failed', last_error = 'Unknown job type', updated_at = NOW() WHERE id = $1`,
        [job.id]
      );
      await client.query('COMMIT');
      return true;
    }

    try {
      await handler(job.payload);
      await client.query(
        `UPDATE jobs SET status = 'completed', updated_at = NOW() WHERE id = $1`,
        [job.id]
      );
      processedJobs.add(job.id);
      await client.query('COMMIT');
    } catch (err: any) {
      await client.query('ROLLBACK');

      // Retry logic with exponential backoff
      const attempts = job.attempts + 1;
      if (attempts >= job.max_attempts) {
        await pool.query(
          `UPDATE jobs SET status = 'failed', attempts = $1, last_error = $2, updated_at = NOW() WHERE id = $3`,
          [attempts, err.message || 'Unknown error', job.id]
        );
      } else {
        // Exponential backoff: 2^attempts seconds
        const backoffSeconds = Math.pow(2, attempts);
        await pool.query(
          `UPDATE jobs SET status = 'pending', attempts = $1, last_error = $2,
           scheduled_for = NOW() + INTERVAL '${backoffSeconds} seconds', updated_at = NOW()
           WHERE id = $3`,
          [attempts, err.message || 'Unknown error', job.id]
        );
      }
    }

    return true;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

let workerInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start the worker loop. Polls for jobs every 2 seconds.
 */
export function startWorker(): void {
  console.log('[Worker] Starting outbox worker...');

  workerInterval = setInterval(async () => {
    try {
      let processed = true;
      while (processed) {
        processed = await processJob();
      }
    } catch (err: any) {
      console.error('[Worker] Error processing job:', err.message);
    }
  }, 2000);
}

export function stopWorker(): void {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
  }
}
