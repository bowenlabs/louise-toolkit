import { describe, expect, it } from "vitest";
import {
  centsToMajor,
  hmacSha256Base64,
  hmacSha256Hex,
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
