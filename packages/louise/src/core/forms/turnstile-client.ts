// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/forms—Cloudflare Turnstile, the browser half. The server half
// is `verifyTurnstileToken`; whether captcha is on at all is `activeCaptcha`
// (louise-toolkit/auth), which decides the widget and the check together.
//
// Every site rendered the widget by hand, and the same three things went wrong:
//
//   1. The load race. Turnstile's automatic mode scans for `.cf-turnstile` once,
//      when `api.js` runs. A widget created by a component that hydrates later
//      is never found: no widget, on a form the server demands a token for.
//      This renders explicitly, after the script is ready, whichever lands first.
//   2. The spent token. A token is single-use, and siteverify consumes it even
//      when the submit fails for another reason (validation, a 429). Retrying
//      without a reset posts the spent token and fails forever. `reset()` after
//      ANY failed submit.
//   3. Appearance per site key. The Cloudflare dashboard's invisible MODE belongs
//      to the site key, so flipping it for one form silently changes every other
//      form on that key. `appearance` here applies to this widget only.
//
// Only touches the DOM when called, so importing it server-side is harmless.

/** Turnstile's script, in explicit-render mode. */
export const TURNSTILE_SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/** The subset of `window.turnstile` this module uses. */
interface TurnstileApi {
  render(el: HTMLElement, options: Record<string, unknown>): string;
  reset(widgetId?: string): void;
  remove(widgetId?: string): void;
  getResponse(widgetId?: string): string | undefined;
}

const api = () => (globalThis as { turnstile?: TurnstileApi }).turnstile;

let loading: Promise<TurnstileApi> | null = null;

/**
 * Load `api.js` once and resolve with `window.turnstile`. Reuses a script tag
 * already on the page. Polls briefly after the script's `load`, because the
 * global can attach a tick after it fires. Rejects after `timeoutMs`.
 */
export function loadTurnstile(options: { timeoutMs?: number } = {}): Promise<TurnstileApi> {
  const ready = api();
  if (ready) return Promise.resolve(ready);
  if (loading) return loading;
  const timeoutMs = options.timeoutMs ?? 10_000;
  loading = new Promise<TurnstileApi>((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      const t = api();
      if (t) return resolve(t);
      if (Date.now() - started > timeoutMs) {
        return reject(new Error(`Turnstile did not load within ${timeoutMs}ms`));
      }
      setTimeout(poll, 50);
    };
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src^="https://challenges.cloudflare.com/turnstile/"]',
    );
    const script = existing ?? document.createElement("script");
    script.addEventListener("error", () => reject(new Error("Turnstile script failed to load")));
    if (!existing) {
      script.src = TURNSTILE_SCRIPT_SRC;
      script.async = true;
      document.head.appendChild(script);
    }
    // Poll regardless of `load`: an existing tag may have loaded already.
    poll();
  }).catch((err) => {
    loading = null; // let a later call retry
    throw err;
  });
  return loading;
}

export interface RenderTurnstileOptions {
  siteKey: string;
  /**
   * `"always"`, `"execute"` or `"interaction-only"`—for THIS widget only (see
   * the header). Omitted, Turnstile's default applies.
   */
  appearance?: "always" | "execute" | "interaction-only";
  size?: "normal" | "flexible" | "compact";
  theme?: "auto" | "light" | "dark";
  /** Tags the token so the server can tell forms apart in analytics. */
  action?: string;
  /** Any other Turnstile render option, passed through as-is. */
  extra?: Record<string, unknown>;
  onToken?: (token: string) => void;
  /** The token expired before submit; the widget refreshes on its own. */
  onExpire?: () => void;
  onError?: (code: string) => void;
  timeoutMs?: number;
}

export interface TurnstileWidget {
  /** The current token, or `null` before one is issued. Also injected into the
   *  enclosing form as `cf-turnstile-response`. */
  token(): string | null;
  /** Get a fresh token. Call after ANY failed submit—the old one is spent. */
  reset(): void;
  /** Remove the widget (for example, on component unmount). */
  remove(): void;
}

/**
 * Render a Turnstile widget into `el`, loading the script if needed. Resolves
 * once rendered; rejects if the script can't load, so the caller can show a
 * real error instead of a form that will be refused.
 */
export async function renderTurnstile(
  el: HTMLElement,
  options: RenderTurnstileOptions,
): Promise<TurnstileWidget> {
  const turnstile = await loadTurnstile({ timeoutMs: options.timeoutMs });
  let current: string | null = null;
  const id = turnstile.render(el, {
    ...options.extra,
    sitekey: options.siteKey,
    ...(options.appearance ? { appearance: options.appearance } : {}),
    ...(options.size ? { size: options.size } : {}),
    ...(options.theme ? { theme: options.theme } : {}),
    ...(options.action ? { action: options.action } : {}),
    callback: (token: string) => {
      current = token;
      options.onToken?.(token);
    },
    "expired-callback": () => {
      current = null;
      options.onExpire?.();
    },
    "error-callback": (code: string) => {
      current = null;
      options.onError?.(code);
    },
  });
  return {
    token: () => current ?? turnstile.getResponse(id) ?? null,
    reset() {
      current = null;
      turnstile.reset(id);
    },
    remove() {
      current = null;
      turnstile.remove(id);
    },
  };
}

/**
 * The CSP origins Turnstile needs, per directive—merge into the site's
 * policy. Its script, its challenge iframe, and the challenge's own requests all
 * come from one host.
 */
export function turnstileCsp(): { script: string[]; frame: string[]; connect: string[] } {
  const host = "https://challenges.cloudflare.com";
  return { script: [host], frame: [host], connect: [host] };
}
