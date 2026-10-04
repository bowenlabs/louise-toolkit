// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/worker—incident capture at the edges `composeWorker` owns
// (ADR 0022 § 3).
//
// A throw from `fetch`, `queue`, or `scheduled` becomes an `IncidentReport`,
// goes to the site's sinks through `ctx.waitUntil`, and is re-thrown, so
// Cloudflare answers exactly as it would have. An error whose chain holds a
// failed query is re-thrown as a copy of the same class without its bound
// values, since the runtime records an uncaught exception's message and stack
// in Workers Logs. A `reportDegraded` call has no
// `ctx` of its own, and neither does an incident a kit module emits (a queue
// message's last attempt, a dead letter), so each one waits in a small buffer
// until the next handler in this isolate finishes and flushes it.
//
// Nothing here may fail the work it reports on. A sink that throws is logged
// with `console.error`, not `reportDegraded`: a degrade from a failing sink
// would feed the next flush, which would fail the same way, forever.

import { onDegraded } from "../degraded.js";
import { loggableError } from "../query-error.js";
import { emitIncident, onIncidentEmitted, wasReported } from "../incidents/channel.js";
import {
  buildIncidentReport,
  incidentFromDegraded,
  isCriticalIncident,
  type IncidentInput,
  type IncidentReport,
  type IncidentSink,
} from "../incidents/report.js";

/** How `onIncident` is configured, in full. */
export interface IncidentCaptureOptions<Env = unknown> {
  /** One sink or several. Each gets every report. */
  readonly sinks: IncidentSink<Env> | readonly IncidentSink<Env>[];
  /**
   * The failures that should alert: dotted names (`commerce.checkout`) and
   * path prefixes (`/cart`). See `isCriticalIncident`. Everything else is
   * counted and alerts no one.
   */
  readonly critical?: readonly string[];
  /**
   * The deployed version, read from the Worker's bindings, for example, a
   * version metadata binding's `id`. Omitted, reports carry no release.
   */
  readonly release?: (env: Env) => string | undefined;
}

/** What `onIncident` takes: one sink, a list, or the full options. */
export type IncidentCapture<Env = unknown> =
  | IncidentSink<Env>
  | readonly IncidentSink<Env>[]
  | IncidentCaptureOptions<Env>;

/** A report and the value behind it, which only in-memory sinks see. */
interface Captured {
  report: IncidentReport;
  cause: unknown;
}

/** Reports a buffer holds before it drops the rest until the next flush. */
const MAX_PENDING = 100;

/**
 * Wrap a Worker's handlers so every failure they see becomes an incident.
 * `composeWorker` does this for you when you pass `onIncident`; call it
 * directly only for a handler you compose by hand. Call it once per Worker,
 * at module scope: each call listens for degrades and emitted incidents in
 * this isolate.
 *
 * `fetch`, `queue`, and `scheduled` keep their behavior. A throw is reported,
 * then re-thrown. An error whose `cause` chain holds a failed query, the query
 * error itself or an error that wraps one, is re-thrown as `loggableError`'s
 * copy, so the runtime's exception record doesn't keep its bound values. The
 * copy has the original's class, `name`, `code`, and other own fields, so an
 * `instanceof` check or a `code` mapping above it still matches; only the
 * query error's message and stack change, and its `query` and `params` are
 * left out. Any other thrown value is re-thrown as it was. A handler that
 * isn't there stays absent.
 */
export function withIncidentCapture<Env, QMessage>(
  handler: ExportedHandler<Env, QMessage>,
  capture: IncidentCapture<Env>,
): ExportedHandler<Env, QMessage> {
  const { sinks, critical, release } = normalize(capture);
  // Each entry builds its report at flush time, when the release is known.
  const pending: ((release: string | undefined) => Captured)[] = [];
  let dropped = 0;
  const hold = (build: (release: string | undefined) => Captured): void => {
    if (pending.length < MAX_PENDING) pending.push(build);
    else dropped++;
  };
  onDegraded((event) => {
    const now = Date.now();
    hold((release) => ({
      report: incidentFromDegraded(event, { release, now }),
      cause: event.cause,
    }));
  });
  onIncidentEmitted((input) => {
    const now = input.now ?? Date.now();
    hold((release) => ({
      report: buildIncidentReport({ ...input, release, now }),
      cause: input.cause,
    }));
  });

  const releaseOf = (env: Env): string | undefined => {
    try {
      return release?.(env) || undefined;
    } catch {
      return undefined;
    }
  };

  const dispatch = (captured: Captured[], env: Env, ctx: ExecutionContext): void => {
    if (captured.length === 0) return;
    const work = captured.flatMap(({ report, cause }) => {
      const marked = critical.length
        ? { ...report, critical: isCriticalIncident(report, critical) }
        : report;
      // A failed query's error carries its bound values in its message and
      // stack. A sink gets a copy without them, as the log does.
      const safeCause = loggableError(cause);
      return sinks.map((sink) =>
        Promise.resolve()
          .then(() => sink(marked, { env, cause: safeCause }))
          .catch((err: unknown) => {
            console.error(
              `[louise] incident sink failed for ${marked.name} (${marked.fingerprint})`,
              loggableError(err),
            );
          }),
      );
    });
    try {
      ctx.waitUntil(Promise.all(work));
    } catch (err) {
      console.error("[louise] incident capture couldn't schedule its sinks", loggableError(err));
    }
  };

  // Called in a `finally`, so it must not throw either.
  const flush = (env: Env, ctx: ExecutionContext, thrown?: IncidentInput): void => {
    try {
      const releaseValue = releaseOf(env);
      const captured: Captured[] = [];
      if (thrown) {
        captured.push({
          report: buildIncidentReport({ ...thrown, release: releaseValue }),
          cause: thrown.cause,
        });
      }
      for (const build of pending.splice(0)) captured.push(build(releaseValue));
      if (dropped > 0) {
        console.error(`[louise] incident capture dropped ${dropped} reports; its buffer was full`);
        dropped = 0;
      }
      dispatch(captured, env, ctx);
    } catch (err) {
      console.error("[louise] incident capture failed", loggableError(err));
    }
  };

  const wrapped: ExportedHandler<Env, QMessage> = { ...handler };
  const { fetch, queue, scheduled } = handler;
  if (fetch) {
    wrapped.fetch = async (request, env, ctx) => {
      let thrown: IncidentInput | undefined;
      try {
        return await fetch(request, env, ctx);
      } catch (err) {
        const safe = loggableError(err);
        if (!wasReported(err)) {
          thrown = { kind: "fetch", cause: safe, request: request as unknown as Request };
        }
        throw safe;
      } finally {
        flush(env, ctx, thrown);
      }
    };
  }
  if (queue) {
    wrapped.queue = async (batch, env, ctx) => {
      let thrown: IncidentInput | undefined;
      try {
        await queue(batch, env, ctx);
      } catch (err) {
        const safe = loggableError(err);
        if (!wasReported(err)) thrown = { kind: "queue", cause: safe, path: batch.queue };
        throw safe;
      } finally {
        flush(env, ctx, thrown);
      }
    };
  }
  if (scheduled) {
    wrapped.scheduled = async (controller, env, ctx) => {
      let thrown: IncidentInput | undefined;
      try {
        await scheduled(controller, env, ctx);
      } catch (err) {
        const safe = loggableError(err);
        if (!wasReported(err)) {
          thrown = { kind: "scheduled", cause: safe, path: controller.cron };
        }
        throw safe;
      } finally {
        flush(env, ctx, thrown);
      }
    };
  }
  return wrapped;
}

/**
 * Report a failure you caught, as an incident, from code that has no `env` or
 * `ctx` of its own: framework middleware, a library callback. It joins the
 * degrades waiting for the next handler in this isolate to finish, and
 * reaches `composeWorker`'s `onIncident` sinks then. Without `onIncident`,
 * nothing listens, and it does nothing. It never throws.
 *
 * A cause reported here isn't reported again if it's re-thrown and reaches
 * `composeWorker`, so re-throwing after reporting is safe.
 *
 * @example
 * ```ts
 * try {
 *   return await next();
 * } catch (err) {
 *   reportIncident({ kind: "fetch", cause: err, request });
 *   throw err;
 * }
 * ```
 */
export function reportIncident(input: IncidentInput): void {
  emitIncident(input);
}

function normalize<Env>(capture: IncidentCapture<Env>): {
  sinks: readonly IncidentSink<Env>[];
  critical: readonly string[];
  release: ((env: Env) => string | undefined) | undefined;
} {
  if (typeof capture === "function") return { sinks: [capture], critical: [], release: undefined };
  if (Array.isArray(capture)) return { sinks: capture, critical: [], release: undefined };
  const options = capture as IncidentCaptureOptions<Env>;
  const sinks = typeof options.sinks === "function" ? [options.sinks] : options.sinks;
  return { sinks, critical: options.critical ?? [], release: options.release };
}
