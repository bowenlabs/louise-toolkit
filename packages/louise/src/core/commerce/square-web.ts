// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/commerce/square-web—browser-side companion to
// louise-toolkit/commerce/square. Loads Square's Web Payments SDK from the
// squarecdn host (allow-list it in the site CSP) and mounts a card input that
// tokenizes the card in the browser, so raw PAN never reaches the Worker. The
// resulting token is what the server side charges via /v2/payments. Sandbox vs
// production is chosen by the same SQUARE_ENVIRONMENT the server uses. Runs in
// the browser (DOM globals only)—framework-agnostic, no Solid dependency.
//
// Apple Pay and Google Pay tokenize through the same SDK and produce the same
// kind of token, so the server side does not know which button was pressed.
// They need more CSP origins than the card form (Google Pay's script and
// frame, Square's font host); see #453.

// biome-ignore-all lint/suspicious/noExplicitAny: Square's Web Payments SDK is loaded from their CDN at runtime and ships no types
declare global {
  interface Window {
    Square?: any;
  }
}

let loading: Promise<any> | null = null;

export function loadSquare(environment: string): Promise<any> {
  if (window.Square) return Promise.resolve(window.Square);
  if (loading) return loading;
  const src =
    environment === "production"
      ? "https://web.squarecdn.com/v1/square.js"
      : "https://sandbox.web.squarecdn.com/v1/square.js";
  loading = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = () =>
      window.Square ? resolve(window.Square) : reject(new Error("Square SDK unavailable"));
    s.onerror = () => reject(new Error("Failed to load Square SDK"));
    document.head.appendChild(s);
  });
  return loading;
}

// One payments instance per app + location. The card form and the wallet
// buttons on the same page must share it—Square's SDK ties a payment request
// to the instance that created it, and a second instance is a second SDK
// session with its own iframe bootstrap.
const instances = new Map<string, Promise<any>>();

/**
 * The shared `Square.payments()` instance for an app + location, created on
 * first use. {@link mountCard} and {@link mountWallets} both go through here;
 * a caller only needs it directly to reach an SDK method this module does not
 * wrap (ACH, gift cards, `verifyBuyer`).
 */
export function getPayments(appId: string, locationId: string, environment: string): Promise<any> {
  const key = `${appId}:${locationId}`;
  let p = instances.get(key);
  if (!p) {
    p = loadSquare(environment).then((Square) => Square.payments(appId, locationId));
    instances.set(key, p);
  }
  return p;
}

async function tokenOf(method: any, fallback: string): Promise<string> {
  const result = await method.tokenize();
  if (result.status !== "OK") {
    throw new Error(result.errors?.[0]?.message ?? fallback);
  }
  return result.token as string;
}

export interface SquareCardHandle {
  tokenize: () => Promise<string>;
  destroy: () => void;
}

/**
 * Initialize a Square card input attached to `selector` and return a handle
 * that tokenizes on demand. Throws with the Square error detail on failure.
 */
export async function mountCard(
  appId: string,
  locationId: string,
  environment: string,
  selector: string,
): Promise<SquareCardHandle> {
  const payments = await getPayments(appId, locationId, environment);
  const card = await payments.card();
  await card.attach(selector);
  return {
    tokenize: () => tokenOf(card, "Card was declined"),
    destroy() {
      card.destroy?.();
    },
  };
}

export type SquareWallet = "applePay" | "googlePay";

export interface SquareWalletsOptions {
  /** The amount the sheet shows, in minor units (cents). */
  totalCents: number;
  /** ISO 3166-1 alpha-2 of the merchant, for example, "US". */
  countryCode: string;
  /** ISO 4217, for example, "USD". */
  currencyCode: string;
  /** Minor-unit digits of `currencyCode`—2 for USD, 0 for JPY. Default 2. */
  fractionDigits?: number;
  /** The line the sheet shows next to the amount. Default "Total". */
  label?: string;
  /**
   * Where Square renders its Google Pay button. Google Pay is skipped when
   * absent—unlike Apple Pay, whose button is the caller's own markup.
   */
  googlePayEl?: HTMLElement | null;
  /** Passed to Square's `googlePay.attach`. Defaults to a black, fill-width "Pay" button. */
  googlePayButton?: { buttonColor?: string; buttonSizeMode?: string; buttonType?: string };
  /**
   * Called for each wallet Square could not initialize, with the reason.
   * Wallets are optional so a refusal only hides a button—but without the
   * reason, "no Apple Pay button" is undiagnosable (browser without Apple Pay,
   * no card in Wallet, domain not verified in the Square Dashboard, …).
   */
  onUnavailable?: (wallet: SquareWallet, reason: string) => void;
}

/** Apple Pay / Google Pay, whichever this browser + merchant support. */
export interface SquareWalletsHandle {
  /**
   * Tokenizes via the Apple Pay sheet. Call it synchronously from the click
   * handler—Safari refuses to open the sheet after an `await`. Absent when
   * unavailable.
   */
  applePay?: () => Promise<string>;
  /** Tokenizes via Google Pay (its button is attached to `googlePayEl`). Absent when unavailable. */
  googlePay?: () => Promise<string>;
  /** Keep the sheet's total in step with the checkout's (a tip, a re-quote). */
  setTotal: (cents: number) => void;
  /** Why each absent wallet is absent—the same text `onUnavailable` received. */
  unavailable: Partial<Record<SquareWallet, string>>;
}

/**
 * Set up Apple Pay and Google Pay for a charge of `totalCents`. Each is
 * optional: Apple Pay needs Safari on an Apple device AND the domain
 * registered with Square; Google Pay needs a supporting browser and an
 * element to draw its button into. Whatever Square can't initialize is left
 * out and reported through `unavailable`—the card form always remains.
 */
export async function mountWallets(
  appId: string,
  locationId: string,
  environment: string,
  options: SquareWalletsOptions,
): Promise<SquareWalletsHandle> {
  const digits = options.fractionDigits ?? 2;
  const label = options.label ?? "Total";
  const total = (cents: number) => ({ amount: (cents / 10 ** digits).toFixed(digits), label });

  const payments = await getPayments(appId, locationId, environment);
  const request = payments.paymentRequest({
    countryCode: options.countryCode,
    currencyCode: options.currencyCode,
    total: total(options.totalCents),
  });
  const handle: SquareWalletsHandle = {
    setTotal: (cents) => request.update({ total: total(cents) }),
    unavailable: {},
  };
  const refuse = (wallet: SquareWallet, e: unknown) => {
    const reason = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    handle.unavailable[wallet] = reason;
    options.onUnavailable?.(wallet, reason);
  };

  try {
    const applePay = await payments.applePay(request);
    handle.applePay = () => tokenOf(applePay, "Apple Pay was cancelled");
  } catch (e) {
    refuse("applePay", e);
  }

  if (options.googlePayEl) {
    try {
      const googlePay = await payments.googlePay(request);
      await googlePay.attach(options.googlePayEl, {
        buttonColor: "black",
        buttonSizeMode: "fill",
        buttonType: "pay",
        ...options.googlePayButton,
      });
      handle.googlePay = () => tokenOf(googlePay, "Google Pay was cancelled");
    } catch (e) {
      refuse("googlePay", e);
    }
  } else {
    refuse("googlePay", new Error("no googlePayEl to attach the button to"));
  }
  return handle;
}

// ── Content-Security-Policy origins ───────────────────────────────────────────

/**
 * Per-directive origin lists, keyed like a CSP builder's input: `script` →
 * `script-src`, and so on. Plain data—merge it into whatever assembles the
 * site's policy.
 */
export interface SquareCspOrigins {
  script: string[];
  style: string[];
  frame: string[];
  connect: string[];
  font: string[];
}

export interface SquareCspOptions {
  /**
   * Which Square environments to allow. Both by default, so ONE build serves
   * either—the environment is a runtime secret, while a CSP is usually baked
   * at build time. Narrow it only when the policy is computed per request.
   */
  environments?: ("sandbox" | "production")[];
  /**
   * Add Google Pay's origins, for {@link mountWallets}. Apple Pay needs none:
   * its sheet is Safari's own UI, not a page resource.
   */
  wallets?: boolean;
}

/**
 * The origins Square's Web Payments SDK needs, for {@link mountCard} and
 * optionally {@link mountWallets}. Every host is here because leaving it out
 * broke something observable; the comments say what, so none of them reads as
 * a mystery origin to be tidied away.
 */
export function squareWebPaymentsCsp(options: SquareCspOptions = {}): SquareCspOrigins {
  const envs = options.environments ?? ["sandbox", "production"];
  const sandbox = envs.includes("sandbox");
  const production = envs.includes("production");
  const pick = (sandboxHost: string, productionHost: string) => [
    ...(sandbox ? [sandboxHost] : []),
    ...(production ? [productionHost] : []),
  ];

  // The SDK script, and the host its card iframe is served from.
  const cdn = pick("https://sandbox.web.squarecdn.com", "https://web.squarecdn.com");

  const origins: SquareCspOrigins = {
    script: [...cdn],
    // SDK 1.85+ attaches `card-wrapper.css` to the HOST page, not just inside
    // the iframe. Block it and `card.attach()` rejects—no card form at all.
    style: [...cdn],
    frame: [...cdn, ...pick("https://connect.squareupsandbox.com", "https://connect.squareup.com")],
    connect: [
      ...cdn,
      // Tokenization. Without it the form renders and every card "fails".
      ...pick("https://pci-connect.squareupsandbox.com", "https://pci-connect.squareup.com"),
      // The SDK reports its own errors to Square's Sentry from inside the card
      // iframe. Blocking it does not break payment, but it puts a CSP violation
      // on the console of every checkout.
      "https://o160250.ingest.sentry.io",
    ],
    font: [
      "https://square-fonts-production-f.squarecdn.com",
      "https://d1g145x70srn7h.cloudfront.net",
      // Cash Sans, which `card-wrapper.css` loads.
      "https://cash-f.squarecdn.com",
    ],
  };

  if (options.wallets) {
    // Google Pay: pay.js, its button and sheet frame, its API, and the
    // stylesheet + font its button renders with.
    origins.script.push("https://pay.google.com");
    origins.frame.push("https://pay.google.com");
    origins.connect.push("https://pay.google.com", "https://google.com/pay");
    origins.style.push("https://fonts.googleapis.com");
    origins.font.push("https://fonts.gstatic.com");
  }
  return origins;
}
