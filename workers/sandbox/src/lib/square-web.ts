// Client-side Square Web Payments SDK loader — adapted from the pattern the
// production shops use. The SDK is served as an iframe from the squarecdn host
// and tokenizes the card in the browser, so raw card data never reaches the
// Worker. This module is *dynamically imported* on first interaction (see
// pages/index.astro) so its code isn't downloaded until someone actually pays.

// biome-ignore lint/suspicious/noExplicitAny: Square's SDK loads from their CDN at runtime and ships no types
declare global {
  interface Window {
    Square?: any;
  }
}

let loading: Promise<any> | null = null;

function loadSquare(environment: string): Promise<any> {
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

export interface CardHandle {
  tokenize: () => Promise<string>;
}

/** Mount a Square card input into `selector` and return a tokenize() handle. */
export async function mountCard(
  appId: string,
  locationId: string,
  environment: string,
  selector: string,
): Promise<CardHandle> {
  const Square = await loadSquare(environment);
  const payments = Square.payments(appId, locationId);
  const card = await payments.card();
  await card.attach(selector);
  return {
    tokenize: async () => {
      const result = await card.tokenize();
      if (result.status !== "OK") {
        const detail = result.errors?.[0]?.message ?? "Card was declined";
        throw new Error(detail);
      }
      return result.token as string;
    },
  };
}
