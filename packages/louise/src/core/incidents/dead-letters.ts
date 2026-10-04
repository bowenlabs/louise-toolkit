// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/incidents—the consumer for a dead-letter queue (ADR 0022
// § 7). Re-exported from `index.ts`.
//
// A message that spends its retries moves to the queue's dead-letter queue,
// and with no consumer there it sits unseen until Cloudflare drops it. This
// consumer keeps each one in the site's D1, where its body stays in the
// client's account, reports it as a `queue` incident, and acks it. A runbook
// step replays it with `replayDeadLetter` once the cause is fixed.

import { desc, eq } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { db } from "../db/index.js";
import type { D1Client } from "../db/session.js";
import { loggableError } from "../query-error.js";
import { emitIncident } from "./channel.js";

/** The `dead_letters` columns, to compose into your own schema. */
export const deadLettersColumns = {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** The dead-letter queue the message arrived on. */
  queue: text("queue").notNull(),
  /** Cloudflare's ID for the message. */
  messageId: text("message_id").notNull(),
  /** The message body, as JSON. */
  body: text("body").notNull(),
  /** Deliveries on the dead-letter queue when it was kept. */
  attempts: integer("attempts").notNull(),
  receivedAt: integer("received_at", { mode: "timestamp_ms" }).notNull(),
};

/** The ready-made `dead_letters` table. Add it to the schema drizzle-kit
 *  reads, so the migration creates it. */
export const deadLetters = sqliteTable("dead_letters", deadLettersColumns, (table) => [
  index("dead_letters_queue").on(table.queue),
]);

export type DeadLetterTable = typeof deadLetters;

/** One kept message: a row of the `dead_letters` table. */
export type DeadLetter = typeof deadLetters.$inferSelect;

/**
 * A `queue` handler for a dead-letter queue. Each message is written to the
 * `dead_letters` table, reported as a `queue` incident, and acked. A message
 * that can't be written is retried, so it isn't lost.
 *
 * The incident is named `DeadLetter` and counts every message on that
 * dead-letter queue, so one queue that keeps failing is one incident with a
 * rising count. It reaches `onIncident`'s sinks when the Worker's `queue`
 * handler finishes, like any other queue incident.
 *
 * @example
 * ```ts
 * const keepDeadLetters = deadLetterConsumer((env: Env) => env.DB);
 *
 * export default composeWorker<Env>({
 *   fetch: ssrHandler,
 *   queue: (batch, env, ctx) =>
 *     batch.queue === "side-effects-dlq"
 *       ? keepDeadLetters(batch, env, ctx)
 *       : processBatch(batch, (job) => runJob(job, env)),
 *   onIncident: [d1Incidents((env) => env.DB)],
 * });
 * ```
 */
export function deadLetterConsumer<Env, Body = unknown>(
  database: (env: Env) => D1Client,
  table: DeadLetterTable = deadLetters,
): (batch: MessageBatch<Body>, env: Env, ctx: ExecutionContext) => Promise<void> {
  return async (batch, env) => {
    const d1 = database(env);
    for (const message of batch.messages) {
      try {
        await db(d1)
          .insert(table)
          .values({
            queue: batch.queue,
            messageId: message.id,
            body: bodyJson(message.body),
            attempts: message.attempts,
            receivedAt: new Date(),
          });
      } catch (err) {
        console.error(
          `[louise] couldn't keep dead letter ${message.id} from ${batch.queue}; marking it for retry`,
          loggableError(err),
        );
        message.retry();
        continue;
      }
      emitIncident({
        kind: "queue",
        name: "DeadLetter",
        message: `A message spent its retries and was dead-lettered on ${batch.queue}`,
        path: batch.queue,
      });
      message.ack();
    }
  };
}

/** Kept messages, newest first, from one dead-letter queue or all of them. */
export async function listDeadLetters(
  d1: D1Client,
  options: { queue?: string; limit?: number } = {},
  table: DeadLetterTable = deadLetters,
): Promise<DeadLetter[]> {
  return db(d1)
    .select()
    .from(table)
    .where(options.queue === undefined ? undefined : eq(table.queue, options.queue))
    .orderBy(desc(table.id))
    .limit(options.limit ?? 100);
}

/**
 * Send one kept message back onto a queue, usually the one it first failed
 * on, then delete it. Returns `false` when there's no row with that ID. Fix
 * the cause first, or the message dead-letters again.
 */
export async function replayDeadLetter<Body = unknown>(
  d1: D1Client,
  id: number,
  queue: Queue<Body>,
  table: DeadLetterTable = deadLetters,
): Promise<boolean> {
  const [row] = await db(d1).select().from(table).where(eq(table.id, id)).limit(1);
  if (!row) return false;
  await queue.send(JSON.parse(row.body) as Body);
  await db(d1).delete(table).where(eq(table.id, id));
  return true;
}

/** The body as JSON, or its string form as JSON when it isn't serializable. */
function bodyJson(body: unknown): string {
  try {
    const json = JSON.stringify(body);
    if (json !== undefined) return json;
  } catch {
    // A cycle or a BigInt; fall through to the string form.
  }
  try {
    return JSON.stringify(String(body));
  } catch {
    return JSON.stringify("[unserializable body]");
  }
}
