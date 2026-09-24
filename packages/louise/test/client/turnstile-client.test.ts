import { afterEach, describe, expect, it, vi } from "vitest";

// Each test gets a fresh module (the loader memoises its promise) and a fake
// `window.turnstile`, installed either up front or "later" to model api.js
// landing after hydration.

type Opts = Record<string, unknown> & {
  callback: (t: string) => void;
  "expired-callback": () => void;
  "error-callback": (c: string) => void;
};

function fakeTurnstile() {
  const widgets = new Map<string, Opts>();
  let n = 0;
  const t = {
    render: vi.fn((_el: HTMLElement, opts: Opts) => {
      const id = `w${++n}`;
      widgets.set(id, opts);
      return id;
    }),
    reset: vi.fn(),
    remove: vi.fn(),
    getResponse: vi.fn(() => undefined as string | undefined),
    /** Test helper: have Turnstile issue a token to a widget. */
    issue(id: string, token: string) {
      widgets.get(id)?.callback(token);
    },
    expire(id: string) {
      widgets.get(id)?.["expired-callback"]();
    },
  };
  return t;
}

async function load() {
  vi.resetModules();
  return import("../../src/core/forms/turnstile-client.js");
}

const setGlobal = (value: unknown) => {
  (globalThis as { turnstile?: unknown }).turnstile = value;
};

/**
 * Catch the injected <script> without letting happy-dom "load" it—it refuses
 * to fetch scripts and fires `error` at once, which is the test environment's
 * policy, not the race these tests are about. Returns the captured tags.
 */
function interceptScripts(): HTMLScriptElement[] {
  const captured: HTMLScriptElement[] = [];
  vi.spyOn(document.head, "appendChild").mockImplementation(<T extends Node>(node: T): T => {
    captured.push(node as unknown as HTMLScriptElement);
    return node;
  });
  return captured;
}

afterEach(() => {
  vi.restoreAllMocks();
  setGlobal(undefined);
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("renderTurnstile", () => {
  it("renders explicitly with only the options the caller set", async () => {
    const t = fakeTurnstile();
    setGlobal(t);
    const { renderTurnstile } = await load();
    const el = document.createElement("div");
    await renderTurnstile(el, { siteKey: "0xKEY", appearance: "interaction-only" });
    const opts = t.render.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(t.render.mock.calls[0]?.[0]).toBe(el);
    expect(opts).toMatchObject({ sitekey: "0xKEY", appearance: "interaction-only" });
    // Nothing imposed: no size/theme/action unless asked for.
    expect(opts).not.toHaveProperty("size");
    expect(opts).not.toHaveProperty("theme");
  });

  it("does not add an appearance the caller didn't choose", async () => {
    const t = fakeTurnstile();
    setGlobal(t);
    const { renderTurnstile } = await load();
    await renderTurnstile(document.createElement("div"), { siteKey: "0xKEY" });
    expect(t.render.mock.calls[0]?.[1]).not.toHaveProperty("appearance");
  });

  it("wins the load race: renders when api.js lands AFTER the call", async () => {
    // The bug this exists for—the automatic scan runs once, before a
    // later-hydrating widget exists, and it's never rendered.
    vi.useFakeTimers();
    const scripts = interceptScripts();
    const { renderTurnstile } = await load();
    const pending = renderTurnstile(document.createElement("div"), { siteKey: "0xKEY" });
    expect(scripts).toHaveLength(1);
    expect(scripts[0]?.src).toContain("render=explicit");
    const t = fakeTurnstile();
    setGlobal(t);
    await vi.advanceTimersByTimeAsync(100);
    await pending;
    expect(t.render).toHaveBeenCalledTimes(1);
  });

  it("reuses a script tag already on the page instead of adding a second", async () => {
    const existing = document.createElement("script");
    existing.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    document.head.appendChild(existing);
    setGlobal(fakeTurnstile());
    const { loadTurnstile } = await load();
    await loadTurnstile();
    expect(document.head.querySelectorAll("script")).toHaveLength(1);
  });

  it("rejects after the timeout, so the form can say so", async () => {
    vi.useFakeTimers();
    interceptScripts();
    const { renderTurnstile } = await load();
    const pending = renderTurnstile(document.createElement("div"), {
      siteKey: "0xKEY",
      timeoutMs: 500,
    });
    const assertion = expect(pending).rejects.toThrow(/did not load within 500ms/);
    await vi.advanceTimersByTimeAsync(600);
    await assertion;
  });

  it("tracks the token through issue, expiry and reset", async () => {
    const t = fakeTurnstile();
    setGlobal(t);
    const { renderTurnstile } = await load();
    const onToken = vi.fn();
    const widget = await renderTurnstile(document.createElement("div"), {
      siteKey: "0xKEY",
      onToken,
    });
    expect(widget.token()).toBeNull();
    t.issue("w1", "tok-1");
    expect(widget.token()).toBe("tok-1");
    expect(onToken).toHaveBeenCalledWith("tok-1");
    t.expire("w1");
    expect(widget.token()).toBeNull();
    t.issue("w1", "tok-2");
    // After a failed submit: the token is spent, so reset must drop it.
    widget.reset();
    expect(t.reset).toHaveBeenCalledWith("w1");
    expect(widget.token()).toBeNull();
  });

  it("keeps two widgets on one page independent", async () => {
    const t = fakeTurnstile();
    setGlobal(t);
    const { renderTurnstile } = await load();
    const a = await renderTurnstile(document.createElement("div"), { siteKey: "0xKEY" });
    const b = await renderTurnstile(document.createElement("div"), {
      siteKey: "0xKEY",
      appearance: "interaction-only",
    });
    t.issue("w1", "for-a");
    b.reset();
    expect(a.token()).toBe("for-a");
    expect(t.reset).toHaveBeenCalledWith("w2");
    a.remove();
    expect(t.remove).toHaveBeenCalledWith("w1");
  });
});

describe("turnstileCsp", () => {
  it("lists Turnstile's one host for script, frame and connect", async () => {
    const { turnstileCsp } = await load();
    const host = "https://challenges.cloudflare.com";
    expect(turnstileCsp()).toEqual({ script: [host], frame: [host], connect: [host] });
  });
});

describe("louise-toolkit/forms/turnstile — the dependency-free entry", () => {
  it("exports both halves, the same functions as the forms barrel", async () => {
    // Same identities, not copies: a page importing the light entry and a
    // server importing the barrel share one module, one memoised loader.
    const entry = await import("../../src/core/forms/turnstile-entry.js");
    const barrel = await import("../../src/core/forms/index.js");
    expect(entry.renderTurnstile).toBe(barrel.renderTurnstile);
    expect(entry.loadTurnstile).toBe(barrel.loadTurnstile);
    expect(entry.turnstileCsp).toBe(barrel.turnstileCsp);
    expect(entry.verifyTurnstileToken).toBe(barrel.verifyTurnstileToken);
    expect(entry.TURNSTILE_SCRIPT_SRC).toBe(barrel.TURNSTILE_SCRIPT_SRC);
  });
});
