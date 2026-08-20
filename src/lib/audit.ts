import type { Env } from '../env';
import { randomId } from './crypto';
import { nowIso } from './time';

export type ActorType = 'user' | 'admin' | 'therapist' | 'support' | 'system' | 'anonymous';

export interface AuditInput {
  actorType: ActorType;
  actorId?: string | null;
  action: string;
  subjectType: string;
  subjectId?: string | null;
  /**
   * Low-cardinality machine facts only. Never free text from a user, never
   * health data, never tokens or contact details.
   */
  meta?: Record<string, string | number | boolean>;
}

const META_ALLOWED = new Set([
  'reason_code',
  'status',
  'from_status',
  'to_status',
  'scope',
  'field',
  'count',
  'price_minor',
  'currency',
  'idempotent_replay',
  'source',
  'role',
  'environment',
]);

/**
 * Appends a minimal audit row. Auditing must never break the operation it
 * records, so failures are swallowed after being surfaced to the log.
 */
export async function audit(env: Env, input: AuditInput): Promise<void> {
  const meta: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(input.meta ?? {})) {
    if (META_ALLOWED.has(key)) meta[key] = value;
  }

  await env.DB.prepare(
    `INSERT INTO audit_events (id, at, actor_type, actor_id, action, subject_type, subject_id, meta_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      randomId('ae'),
      nowIso(),
      input.actorType,
      input.actorId ?? null,
      input.action,
      input.subjectType,
      input.subjectId ?? null,
      JSON.stringify(meta),
    )
    .run();
}
