import { Request, Response, NextFunction } from 'express';
import pool from '../db/pool';

/**
 * Idempotency middleware for POST/PATCH requests.
 * If an Idempotency-Key header is provided:
 * 1. Check if the key already exists for this user → return stored response
 * 2. Otherwise, let the request proceed and store the response
 * 
 * Keys expire after 24 hours (checked on lookup, cleaned periodically).
 */
export function idempotencyMiddleware(req: Request, res: Response, next: NextFunction): void {
  const idempotencyKey = req.headers['idempotency-key'] as string | undefined;

  if (!idempotencyKey || !['POST', 'PATCH'].includes(req.method)) {
    next();
    return;
  }

  const userId = req.user?.id;
  if (!userId) {
    next();
    return;
  }

  // Check for existing key
  pool.query(
    `SELECT status_code, response_body, created_at FROM idempotency_keys
     WHERE key = $1 AND user_id = $2`,
    [idempotencyKey, userId]
  ).then(result => {
    if (result.rows.length > 0) {
      const row = result.rows[0];
      // Check if key is expired (24 hours)
      const age = Date.now() - new Date(row.created_at).getTime();
      if (age > 24 * 60 * 60 * 1000) {
        // Key expired, delete and proceed
        pool.query('DELETE FROM idempotency_keys WHERE key = $1', [idempotencyKey])
          .then(() => {
            // Store key and response after handler completes
            attachResponseCapture(res, idempotencyKey, userId, req.method, req.path);
            next();
          })
          .catch(next);
        return;
      }

      // Return stored response
      res.status(row.status_code).json(row.response_body);
      return;
    }

    // No existing key — attach response capture and proceed
    attachResponseCapture(res, idempotencyKey, userId, req.method, req.path);
    next();
  }).catch(next);
}

/**
 * Monkey-patches res.json() to capture and store the response for idempotency.
 */
function attachResponseCapture(
  res: Response,
  key: string,
  userId: string,
  method: string,
  path: string
): void {
  const originalJson = res.json.bind(res);

  res.json = function (body: any) {
    // Store the response (fire-and-forget; if this fails, worst case is
    // the next identical request re-executes)
    pool.query(
      `INSERT INTO idempotency_keys (key, user_id, method, path, status_code, response_body)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (key) DO NOTHING`,
      [key, userId, method, path, res.statusCode, body]
    ).catch(err => {
      console.error('Failed to store idempotency key:', err.message);
    });

    return originalJson(body);
  };
}
