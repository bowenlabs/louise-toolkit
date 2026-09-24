import { afterEach, describe, expect, it, vi } from "vitest";
import { createCart, getCollectionProducts } from "../../src/core/commerce/fourthwall.js";
import { listCards, SquareApiError } from "../../src/core/commerce/square.js";
import { createPaymentIntent, retrievePaymentIntent } from "../../src/core/commerce/stripe.js";
import { verifyTurnstileToken } from "../../src/core/forms/turnstile.js";
import {
  readUpstreamBody,
  UpstreamError,
  upstreamFetch,
  upstreamLogLine,
} from "../../src/core/security/index.js";

// ADR 0012 §3: a timeout, no redirects, and an error whose message is safe to
// put in front of a user—with what the provider said kept for logs only.

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function stubFetch(answer: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init: RequestInit = {}) => {
      calls.push({ url: String(input), init });
      return answer(String(input), init);
    }),
  );
  return calls;
}

/** A fetch that never answers until its signal aborts—a hung upstream. */
function hangingFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_: unknown, init: RequestInit = {}) =>
        new Promise<Response>((_, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    ),
  );
}

describe("upstreamFetch", () => {
  it("doesn't follow redirects: a 3xx comes back to the caller", async () => {
    const calls = stubFetch(
      () => new Response(null, { status: 302, headers: { location: "https://evil.example/" } }),
    );
    const res = await upstreamFetch("https://api.example.com/x", { provider: "Acme" });
    expect(calls[0]?.init.redirect).toBe("manual");
    expect(res.status).toBe(302);
  });

  it("times out a hung upstream as a retryable UpstreamError, status 0", async () => {
    hangingFetch();
    const err = await upstreamFetch("https://api.example.com/v1/slow?token=secret", {
      provider: "Acme",
      timeoutMs: 20,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(UpstreamError);
    expect(err).toMatchObject({ status: 0, code: "timeout", retryable: true });
    expect(err.message).toBe("Acme request failed (timed out)");
    // The path, never the query: a query can carry a token.
    expect(err.operation).toBe("GET /v1/slow");
    expect(upstreamLogLine(err)).not.toContain("secret");
  });

  it("names a network failure without the upstream's words in the message", async () => {
    stubFetch(() => Promise.reject(new TypeError("getaddrinfo ENOTFOUND api.internal.corp")));
    const err = await upstreamFetch("https://api.example.com/x", { provider: "Acme" }).catch(
      (e) => e,
    );
    expect(err).toMatchObject({ status: 0, code: "network", retryable: true });
    expect(err.message).toBe("Acme request failed (no response)");
    expect(err.detail).toContain("ENOTFOUND");
  });

  it("hands a caller's own abort back as the caller's, not the provider's", async () => {
    hangingFetch();
    const controller = new AbortController();
    const pending = upstreamFetch("https://api.example.com/x", {
      provider: "Acme",
      signal: controller.signal,
    }).catch((e) => e);
    controller.abort(new Error("user navigated away"));
    const err = await pending;
    expect(err).not.toBeInstanceOf(UpstreamError);
    expect(err.message).toBe("user navigated away");
  });
});

describe("UpstreamError", () => {
  const err = new UpstreamError("Square", 402, {
    code: "CARD_DECLINED",
    detail: "Card declined. Card ending 4242, customer jane@example.com",
    operation: "POST /v2/payments",
  });

  it("keeps the provider's words out of everything that gets serialized", () => {
    expect(err.message).toBe("Square request failed (402 CARD_DECLINED)");
    expect(JSON.stringify(err)).not.toContain("jane@example.com");
    expect(JSON.stringify({ error: err })).not.toContain("4242");
    expect({ ...err }).not.toHaveProperty("detail");
    expect(Object.keys(err)).not.toContain("detail");
    // …but they're there for whoever reads the log.
    expect(err.detail).toContain("jane@example.com");
    expect(upstreamLogLine(err)).toBe(
      "Square POST /v2/payments 402 CARD_DECLINED: Card declined. Card ending 4242, customer jane@example.com",
    );
  });

  it("drops a 'code' that isn't code-shaped rather than showing it", () => {
    const odd = new UpstreamError("Acme", 400, { code: "<script>alert(1)</script>" });
    expect(odd.code).toBeNull();
    expect(odd.message).toBe("Acme request failed (400)");
  });

  it("is retryable for 429, 5xx and no response — never for another 4xx", () => {
    for (const [status, retryable] of [
      [429, true],
      [500, true],
      [503, true],
      [0, true],
      [400, false],
      [404, false],
      [302, false],
    ] as const) {
      expect(new UpstreamError("Acme", status).retryable, String(status)).toBe(retryable);
    }
  });

  it("logs a plain error plainly", () => {
    expect(upstreamLogLine(new TypeError("boom"))).toBe("TypeError: boom");
    expect(upstreamLogLine("just a string")).toBe("just a string");
  });
});

describe("readUpstreamBody", () => {
  it("never throws the SyntaxError that quotes an HTML error page", async () => {
    const page = "<html><body>Internal debug: db=prod-7 user=svc_square</body></html>";
    const { json, text } = await readUpstreamBody(new Response(page, { status: 502 }));
    expect(json).toBeUndefined();
    expect(text).toBe(page);
    expect(await readUpstreamBody(new Response(null, { status: 204 }))).toEqual({
      json: undefined,
      text: "",
    });
  });
});

describe("the provider clients", () => {
  const HTML = "<html>upstream debug page: host=db-7.internal</html>";

  it("Square: an HTML 502 becomes a safe error, not a SyntaxError quoting the page", async () => {
    stubFetch(() => new Response(HTML, { status: 502, headers: { "content-type": "text/html" } }));
    const err = await listCards(
      { accessToken: "sq-token", environment: "sandbox" },
      { customerId: "C1" },
    ).catch((e) => e);
    expect(err).toBeInstanceOf(UpstreamError);
    expect(err.message).toBe("Square request failed (502)");
    expect(err.message).not.toContain("db-7");
    expect(err.detail).toContain("db-7");
  });

  it("Square: a decline is told apart by category, and its words stay in the log", async () => {
    stubFetch(() =>
      Response.json(
        {
          errors: [
            {
              category: "PAYMENT_METHOD_ERROR",
              code: "INSUFFICIENT_FUNDS",
              detail: "Authorization error: 'INSUFFICIENT_FUNDS'",
            },
          ],
        },
        { status: 400 },
      ),
    );
    const err = await listCards(
      { accessToken: "sq-token", environment: "sandbox" },
      { customerId: "C1" },
    ).catch((e) => e);
    expect(err).toBeInstanceOf(SquareApiError);
    expect(err).toMatchObject({ category: "PAYMENT_METHOD_ERROR", code: "INSUFFICIENT_FUNDS" });
    expect(err.message).toBe("Square request failed (400 INSUFFICIENT_FUNDS)");
  });

  it("Fourthwall storefront: the token in the query never reaches the error", async () => {
    stubFetch(() => new Response("token tok_live_secret is invalid", { status: 401 }));
    const err = await getCollectionProducts("tok_live_secret", "all").catch((e) => e);
    expect(err).toBeInstanceOf(UpstreamError);
    expect(err.message).toBe("Fourthwall request failed (401)");
    expect(err.operation).toBe("GET /collections/all/products");
    expect(JSON.stringify(err)).not.toContain("tok_live_secret");
    expect(err.message).not.toContain("tok_live_secret");
  });

  it("Fourthwall storefront: a cart create with no id is a failure, safely named", async () => {
    stubFetch(() => Response.json({}));
    const err = await createCart("tok", [{ variantId: "v1", quantity: 1 }]).catch((e) => e);
    expect(err).toMatchObject({ status: 200, code: "NO_CART_ID" });
  });

  it("Stripe: a decline carries decline_code for the checkout to map, and no customer text", async () => {
    stubFetch(() =>
      Response.json(
        {
          error: {
            type: "card_error",
            code: "card_declined",
            decline_code: "insufficient_funds",
            message: "Your card has insufficient funds.",
          },
        },
        { status: 402 },
      ),
    );
    const err = await createPaymentIntent("sk_test", [
      { slug: "a", name: "A", qty: 1, unitAmountCents: 500 },
    ]).catch((e) => e);
    expect(err).toBeInstanceOf(UpstreamError);
    expect(err.code).toBe("insufficient_funds");
    expect(err.message).toBe("Stripe request failed (402 insufficient_funds)");
    expect(err.detail).toBe("Your card has insufficient funds.");
  });

  it("Stripe: a PaymentIntent id is encoded, so it can't address another resource", async () => {
    const calls = stubFetch(() => Response.json({ id: "pi_1" }));
    await retrievePaymentIntent("sk_test", "pi_1/../../customers");
    expect(calls[0]?.url).toBe(
      "https://api.stripe.com/v1/payment_intents/pi_1%2F..%2F..%2Fcustomers",
    );
  });

  it("Turnstile: the check has a deadline, and failing to reach it fails closed", async () => {
    const calls = stubFetch(() => Promise.reject(new DOMException("timed out", "TimeoutError")));
    expect(await verifyTurnstileToken("secret", "token")).toBe(false);
    // Through upstreamFetch: a deadline on the request, and no redirects.
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
    expect(calls[0]?.init.redirect).toBe("manual");
  });
});
