// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// The isolate channel a kit module reports an incident through when it has no
// `env` or `ctx` to run sinks with: `processBatch` on a message's last attempt,
// and the dead-letter consumer. Capture in `louise-toolkit/worker` listens,
// buffers each input the way it buffers a degrade, and sends it to the sinks
// when the handler it's running inside finishes.
//
// Internal: on no subpath. With no capture installed, nothing listens, and
// the caller's own log line is the only trace, as before.

import type { IncidentInput } from "./report.js";

type Listener = (input: IncidentInput) => void;

const listeners = new Set<Listener>();

/** Hand an incident to every listener in this isolate. Never throws. */
export function emitIncident(input: IncidentInput): void {
  for (const listener of listeners) {
    try {
      listener(input);
    } catch {
      // A listener's failure is its own; it can't reach the caller.
    }
  }
}

/** Listen for {@link emitIncident}. Returns a function that stops listening. */
export function onIncidentEmitted(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
