// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/commerce/square-web — browser-side companion to
// louise-toolkit/commerce/square. Loads Square's Web Payments SDK from the
// squarecdn host (allow-list it in the site CSP) and mounts a card input that
// tokenizes the card in the browser, so raw PAN never reaches the Worker. The
// resulting token is what the server side charges via /v2/payments. Sandbox vs
// production is chosen by the same SQUARE_ENVIRONMENT the server uses. Runs in
// the browser (DOM globals only) — framework-agnostic, no Solid dependency.

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
  const Square = await loadSquare(environment);
  const payments = Square.payments(appId, locationId);
  const card = await payments.card();
  await card.attach(selector);
  return {
    async tokenize() {
      const result = await card.tokenize();
      if (result.status !== "OK") {
        const detail = result.errors?.[0]?.message ?? "Card was declined";
        throw new Error(detail);
      }
      return result.token as string;
    },
    destroy() {
      card.destroy?.();
    },
  };
}
