import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  connectRealtime,
  type RealtimeLocks,
  type RealtimePeer,
  type WebSocketLike,
} from "../../src/client/realtime.js";

/** A fake WebSocket the tests drive by hand (open / emit / close). */
class FakeSocket implements WebSocketLike {
  readyState = 0; // CONNECTING
  sent: string[] = [];
  closes: [number?, string?][] = [];
  onopen: ((ev?: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev?: unknown) => void) | null = null;
  onerror: ((ev?: unknown) => void) | null = null;

  send(data: string) {
    this.sent.push(data);
  }
  close(code?: number, reason?: string) {
    this.closes.push([code, reason]);
    this.readyState = 3; // CLOSED
    this.onclose?.();
  }
  // ── test helpers ──
  open() {
    this.readyState = 1; // OPEN
    this.onopen?.();
  }
  emit(obj: unknown) {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
  parsed() {
    return this.sent.map((s) => JSON.parse(s) as Record<string, unknown>);
  }
}

/** A factory recording every socket it hands out (index 0 is the first). */
function factory() {
  const sockets: FakeSocket[] = [];
  const make = (_url: string) => {
    const s = new FakeSocket();
    sockets.push(s);
    return s;
  };
  return { make, sockets, last: () => sockets[sockets.length - 1] };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("connectRealtime", () => {
  it("sends hello, starts the heartbeat, and reports connected on open", () => {
    const f = factory();
    const onStatus = vi.fn();
    const session = connectRealtime({ slug: "pages", id: 1, socketFactory: f.make, onStatus });

    expect(session.connected()).toBe(false); // still CONNECTING
    f.last().open();

    expect(session.connected()).toBe(true);
    expect(onStatus).toHaveBeenCalledWith(true);
    expect(f.last().parsed()).toEqual([{ v: 1, t: "hello" }]);

    // heartbeat pings on the interval
    vi.advanceTimersByTime(25_000);
    expect(f.last().parsed().at(-1)).toEqual({ v: 1, t: "ping" });
    session.close();
  });

  it("dispatches welcome → you + presence + locks + snapshot", () => {
    const f = factory();
    const onPresence = vi.fn<(p: RealtimePeer[]) => void>();
    const onLocks = vi.fn<(l: RealtimeLocks) => void>();
    const onSnapshot = vi.fn();
    const session = connectRealtime({
      slug: "pages",
      id: 1,
      socketFactory: f.make,
      onPresence,
      onLocks,
      onSnapshot,
    });
    f.last().open();

    const peers = [
      { id: "u1", name: "Ada" },
      { id: "u2", name: "Bo" },
    ];
    f.last().emit({
      v: 1,
      t: "welcome",
      you: peers[0],
      peers,
      snapshot: { title: "Hi" },
      locks: { body: "u2" },
    });

    expect(session.you()).toEqual({ id: "u1", name: "Ada" });
    expect(onPresence).toHaveBeenCalledWith(peers);
    expect(onLocks).toHaveBeenCalledWith({ body: "u2" });
    expect(onSnapshot).toHaveBeenCalledWith({ title: "Hi" });
    session.close();
  });

  it("routes presence / change / locks messages to their handlers", () => {
    const f = factory();
    const onPresence = vi.fn();
    const onRemoteChange = vi.fn();
    const onLocks = vi.fn();
    const session = connectRealtime({
      slug: "pages",
      id: 1,
      socketFactory: f.make,
      onPresence,
      onRemoteChange,
      onLocks,
    });
    f.last().open();

    f.last().emit({ v: 1, t: "presence", peers: [{ id: "u1", name: "Ada" }] });
    f.last().emit({ v: 1, t: "change", field: "title", value: "New", rev: 4, from: "u2" });
    f.last().emit({ v: 1, t: "locks", locks: { body: "u1" } });

    expect(onPresence).toHaveBeenCalledWith([{ id: "u1", name: "Ada" }]);
    expect(onRemoteChange).toHaveBeenCalledWith("title", "New");
    expect(onLocks).toHaveBeenCalledWith({ body: "u1" });
    session.close();
  });

  it("trailing-throttles publishes, coalescing to the latest value per field", () => {
    const f = factory();
    const session = connectRealtime({
      slug: "pages",
      id: 1,
      socketFactory: f.make,
      throttleMs: 150,
    });
    f.last().open();
    f.last().sent.length = 0; // drop the hello

    session.publish("title", "a");
    session.publish("title", "ab");
    session.publish("seoTitle", "x");
    expect(f.last().sent).toHaveLength(0); // nothing sent yet (within the window)

    vi.advanceTimersByTime(150);
    expect(f.last().parsed()).toEqual([
      { v: 1, t: "change", field: "title", value: "ab" }, // only the latest title
      { v: 1, t: "change", field: "seoTitle", value: "x" },
    ]);
    session.close();
  });

  it("drops a publish while disconnected (the surface's fetch fallback owns it)", () => {
    const f = factory();
    const session = connectRealtime({ slug: "pages", id: 1, socketFactory: f.make });
    // never opened → CONNECTING
    session.publish("title", "a");
    vi.advanceTimersByTime(1_000);
    expect(f.last().sent).toHaveLength(0);
    session.close();
  });

  it("sends claim/release immediately", () => {
    const f = factory();
    const session = connectRealtime({ slug: "pages", id: 1, socketFactory: f.make });
    f.last().open();
    f.last().sent.length = 0;

    session.claim("body");
    session.release("body");
    expect(f.last().parsed()).toEqual([
      { v: 1, t: "claim", field: "body" },
      { v: 1, t: "release", field: "body" },
    ]);
    session.close();
  });

  it("flushes a pending change before releasing, so the final edit isn't dropped", () => {
    const f = factory();
    const session = connectRealtime({
      slug: "pages",
      id: 1,
      socketFactory: f.make,
      throttleMs: 150,
    });
    f.last().open();
    f.last().sent.length = 0;

    session.publish("body", "<p>hi</p>"); // throttled, not yet on the wire
    session.release("body");

    // the change is flushed FIRST (still holding the lock), then the release
    expect(f.last().parsed()).toEqual([
      { v: 1, t: "change", field: "body", value: "<p>hi</p>" },
      { v: 1, t: "release", field: "body" },
    ]);
    session.close();
  });

  it("reconnects with backoff after an unexpected close, then re-handshakes", () => {
    const f = factory();
    const onStatus = vi.fn();
    const session = connectRealtime({ slug: "pages", id: 1, socketFactory: f.make, onStatus });
    f.last().open();
    expect(f.sockets).toHaveLength(1);

    // simulate the server dropping the socket
    f.last().onclose?.();
    expect(onStatus).toHaveBeenLastCalledWith(false);

    // first backoff is 1s → a fresh socket is constructed and re-handshakes
    vi.advanceTimersByTime(1_000);
    expect(f.sockets).toHaveLength(2);
    f.last().open();
    expect(f.last().parsed()).toContainEqual({ v: 1, t: "hello" });
    session.close();
  });

  it("does not reconnect after an intentional close", () => {
    const f = factory();
    const session = connectRealtime({ slug: "pages", id: 1, socketFactory: f.make });
    f.last().open();
    session.close();

    expect(f.last().closes.at(-1)).toEqual([1000, "bye"]);
    vi.advanceTimersByTime(60_000);
    expect(f.sockets).toHaveLength(1); // no reconnect attempt
  });
});
