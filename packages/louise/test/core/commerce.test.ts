import { describe, expect, it } from "vitest";
import {
  centsToMajor,
  currencyDigits,
  formatMoney,
  hmacSha256Base64,
  hmacSha256Hex,
  parseMoney,
  safeEqual,
} from "../../src/core/commerce/index.js";
import { verifyStripeSignature } from "../../src/core/commerce/stripe.js";

// Independent reference HMAC (raw WebCrypto) so the tests pin the algorithm
// rather than checking the module against itself.
async function refHmac(secret: string, message: string, enc: "hex" | "base64"): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)),
  );
  return enc === "hex"
    ? [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")
    : btoa(String.fromCharCode(...bytes));
}

describe("centsToMajor", () => {
  it("converts minor units to major", () => {
    expect(centsToMajor(2500)).toBe(25);
    expect(centsToMajor(99)).toBe(0.99);
  });

  it("takes the currency's minor-unit count", () => {
    expect(centsToMajor(1250, 0)).toBe(1250); // JPY
    expect(centsToMajor(1235, 3)).toBe(1.235); // BHD
  });
});

describe("currencyDigits", () => {
  it("reads the minor-unit count from the currency", () => {
    expect(currencyDigits("USD")).toBe(2);
    expect(currencyDigits("JPY")).toBe(0);
    expect(currencyDigits("BHD")).toBe(3);
  });

  it("refuses a malformed code", () => {
    expect(() => currencyDigits("dollars")).toThrow(RangeError);
  });
});

// Intl separates a symbol from its number with a no-break space in some
// locales; compare with ordinary spaces so the expectations stay readable.
const spaced = (text: string) => text.replace(/[\u00a0\u202f]/g, " ");

describe("formatMoney", () => {
  it("formats in the currency's own minor unit, never an assumed 2", () => {
    expect(formatMoney({ amount: 125000, currency: "USD" }, { locale: "en-US" })).toBe("$1,250.00");
    expect(formatMoney({ amount: 1250, currency: "JPY" }, { locale: "en-US" })).toBe("¥1,250");
    expect(spaced(formatMoney({ amount: 1235, currency: "BHD" }, { locale: "en-US" }))).toBe(
      "BHD 1.235",
    );
  });

  it("keeps a price's full minor unit", () => {
    expect(formatMoney({ amount: 1250, currency: "USD" }, { locale: "en-US" })).toBe("$12.50");
  });

  it("follows the locale", () => {
    expect(spaced(formatMoney({ amount: 120050, currency: "EUR" }, { locale: "de-DE" }))).toBe(
      "1.200,50 €",
    );
  });

  it("passes Intl options through: whole units for a dashboard total", () => {
    const total = { amount: 123456, currency: "USD" };
    expect(formatMoney(total, { locale: "en-US", maximumFractionDigits: 0 })).toBe("$1,235");
  });
});

describe("parseMoney", () => {
  const usd = { locale: "en-US", currency: "USD" };

  it("reads back what formatMoney prints", () => {
    for (const [money, locale] of [
      [{ amount: 120050, currency: "USD" }, "en-US"],
      [{ amount: 120050, currency: "EUR" }, "de-DE"],
      [{ amount: 120050, currency: "EUR" }, "fr-FR"],
      [{ amount: 123456789, currency: "INR" }, "en-IN"],
      [{ amount: 1250, currency: "JPY" }, "ja-JP"],
      [{ amount: 1235, currency: "BHD" }, "en-US"],
    ] as const) {
      const text = formatMoney(money, { locale });
      expect(parseMoney(text, { locale, currency: money.currency }), text).toBe(money.amount);
    }
  });

  it("takes an amount the way a person types it", () => {
    expect(parseMoney("$1,200.50", usd)).toBe(120050);
    expect(parseMoney("1,200.50", usd)).toBe(120050);
    expect(parseMoney("1200.5", usd)).toBe(120050);
    expect(parseMoney(" 12 ", usd)).toBe(1200);
    expect(parseMoney("USD 12.50", usd)).toBe(1250);
    expect(parseMoney("1.200,50 €", { locale: "de-DE", currency: "EUR" })).toBe(120050);
    expect(parseMoney("1 200,50", { locale: "fr-FR", currency: "EUR" })).toBe(120050);
  });

  it("refuses a group separator where the locale doesn't put one", () => {
    expect(parseMoney("12.5", { locale: "de-DE", currency: "EUR" })).toBeNull();
    expect(parseMoney("1,20", usd)).toBeNull();
    expect(parseMoney(",200", usd)).toBeNull();
    expect(parseMoney("1,2345,678", usd)).toBeNull();
  });

  it("stays strict about the amount", () => {
    for (const input of ["", "$", "-12", "1e3", "12.345", "1.2.3", "12,50", "twelve"]) {
      expect(parseMoney(input, usd), input).toBeNull();
    }
    expect(parseMoney("12.5", { locale: "en-US", currency: "JPY" })).toBeNull();
  });
});

describe("safeEqual", () => {
  it("accepts equal strings", () => {
    expect(safeEqual("sig-abc", "sig-abc")).toBe(true);
  });
  it("rejects differing or differing-length strings", () => {
    expect(safeEqual("sig-abc", "sig-abd")).toBe(false);
    expect(safeEqual("sig-abc", "sig-ab")).toBe(false);
  });
});

describe("hmacSha256Hex / hmacSha256Base64", () => {
  it("match an independent WebCrypto reference", async () => {
    expect(await hmacSha256Hex("secret", "message")).toBe(
      await refHmac("secret", "message", "hex"),
    );
    expect(await hmacSha256Base64("secret", "message")).toBe(
      await refHmac("secret", "message", "base64"),
    );
  });
});

describe("verifyStripeSignature", () => {
  const secret = "whsec_test";
  const payload = '{"id":"evt_1","type":"payment_intent.succeeded"}';
  const t = 1_700_000_000;
  const header = async () => `t=${t},v1=${await refHmac(secret, `${t}.${payload}`, "hex")}`;

  it("accepts a valid, fresh signature", async () => {
    expect(await verifyStripeSignature(payload, await header(), secret, t)).toBe(true);
  });

  it("rejects a tampered payload", async () => {
    expect(await verifyStripeSignature('{"id":"evt_2"}', await header(), secret, t)).toBe(false);
  });

  it("rejects a timestamp outside the tolerance window", async () => {
    expect(await verifyStripeSignature(payload, await header(), secret, t + 1000)).toBe(false);
  });

  it("rejects a malformed header", async () => {
    expect(await verifyStripeSignature(payload, "garbage", secret, t)).toBe(false);
  });

  it("accepts when one of several v1 signatures matches (secret rotation)", async () => {
    const good = await refHmac(secret, `${t}.${payload}`, "hex");
    // Stripe dual-signs during a rotation; the matching sig may not be last.
    expect(await verifyStripeSignature(payload, `t=${t},v1=${good},v1=deadbeef`, secret, t)).toBe(
      true,
    );
    expect(await verifyStripeSignature(payload, `t=${t},v1=deadbeef,v1=${good}`, secret, t)).toBe(
      true,
    );
  });

  it("rejects when no v1 signature matches", async () => {
    expect(await verifyStripeSignature(payload, `t=${t},v1=aa,v1=bb`, secret, t)).toBe(false);
  });
});
