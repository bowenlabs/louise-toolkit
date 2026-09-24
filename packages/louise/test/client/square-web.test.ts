import { afterEach, describe, expect, it, vi } from "vitest";

// The module memoises the payments instance per app + location, so each test
// gets a fresh copy of it — and a fresh fake SDK on `window.Square`, which
// `loadSquare` short-circuits on instead of injecting a <script>.

interface FakeSdk {
  payments: ReturnType<typeof vi.fn>;
  instance: {
    card: ReturnType<typeof vi.fn>;
    paymentRequest: ReturnType<typeof vi.fn>;
    applePay: ReturnType<typeof vi.fn>;
    googlePay: ReturnType<typeof vi.fn>;
  };
  request: { update: ReturnType<typeof vi.fn> };
  card: { attach: ReturnType<typeof vi.fn>; tokenize: ReturnType<typeof vi.fn> };
  applePay: { tokenize: ReturnType<typeof vi.fn> };
  googlePay: { attach: ReturnType<typeof vi.fn>; tokenize: ReturnType<typeof vi.fn> };
}

function fakeSdk(): FakeSdk {
  const request = { update: vi.fn() };
  const card = {
    attach: vi.fn(async () => {}),
    tokenize: vi.fn(async () => ({ status: "OK", token: "cnon:card" })),
  };
  const applePay = { tokenize: vi.fn(async () => ({ status: "OK", token: "cnon:apple" })) };
  const googlePay = {
    attach: vi.fn(async () => {}),
    tokenize: vi.fn(async () => ({ status: "OK", token: "cnon:google" })),
  };
  const instance = {
    card: vi.fn(async () => card),
    paymentRequest: vi.fn(() => request),
    applePay: vi.fn(async () => applePay),
    googlePay: vi.fn(async () => googlePay),
  };
  const sdk: FakeSdk = {
    payments: vi.fn(() => instance),
    instance,
    request,
    card,
    applePay,
    googlePay,
  };
  window.Square = { payments: sdk.payments };
  return sdk;
}

async function load() {
  vi.resetModules();
  return import("../../src/core/commerce/square-web.js");
}

const APP = ["app-id", "loc-id", "sandbox"] as const;
const WALLET = { totalCents: 1250, countryCode: "US", currencyCode: "USD" };

describe("getPayments", () => {
  afterEach(() => {
    window.Square = undefined;
  });

  it("creates ONE payments instance per app + location, shared by card and wallets", async () => {
    // Square ties a payment request to the instance that made it; a second
    // instance is a second SDK session. This is what blocked wallets before.
    const sdk = fakeSdk();
    const { mountCard, mountWallets, getPayments } = await load();
    document.body.innerHTML = '<div id="card"></div><div id="gpay"></div>';

    await mountCard(...APP, "#card");
    await mountWallets(...APP, { ...WALLET, googlePayEl: document.getElementById("gpay") });
    await getPayments(...APP);

    expect(sdk.payments).toHaveBeenCalledTimes(1);
    expect(sdk.payments).toHaveBeenCalledWith("app-id", "loc-id");
  });

  it("keys on app + location, so a second location is a second instance", async () => {
    const sdk = fakeSdk();
    const { getPayments } = await load();
    await getPayments("app-id", "loc-1", "sandbox");
    await getPayments("app-id", "loc-2", "sandbox");
    expect(sdk.payments).toHaveBeenCalledTimes(2);
  });
});

describe("mountWallets", () => {
  afterEach(() => {
    window.Square = undefined;
    document.body.innerHTML = "";
  });

  it("builds the payment request from the caller's country, currency and total", async () => {
    const sdk = fakeSdk();
    const { mountWallets } = await load();
    await mountWallets(...APP, { totalCents: 1250, countryCode: "GB", currencyCode: "GBP" });
    expect(sdk.instance.paymentRequest).toHaveBeenCalledWith({
      countryCode: "GB",
      currencyCode: "GBP",
      total: { amount: "12.50", label: "Total" },
    });
  });

  it("formats a zero-decimal currency without a fraction", async () => {
    const sdk = fakeSdk();
    const { mountWallets } = await load();
    await mountWallets(...APP, {
      totalCents: 1250,
      countryCode: "JP",
      currencyCode: "JPY",
      fractionDigits: 0,
      label: "合計",
    });
    expect(sdk.instance.paymentRequest.mock.calls[0]?.[0]).toMatchObject({
      total: { amount: "1250", label: "合計" },
    });
  });

  it("setTotal updates the sheet's total in place", async () => {
    const sdk = fakeSdk();
    const { mountWallets } = await load();
    const handle = await mountWallets(...APP, WALLET);
    handle.setTotal(1550);
    expect(sdk.request.update).toHaveBeenCalledWith({ total: { amount: "15.50", label: "Total" } });
  });

  it("exposes Apple Pay and Google Pay tokenizers when Square initializes both", async () => {
    const sdk = fakeSdk();
    const { mountWallets } = await load();
    document.body.innerHTML = '<div id="gpay"></div>';
    const el = document.getElementById("gpay");
    const handle = await mountWallets(...APP, { ...WALLET, googlePayEl: el });

    expect(sdk.instance.applePay).toHaveBeenCalledWith(sdk.request);
    expect(sdk.instance.googlePay).toHaveBeenCalledWith(sdk.request);
    expect(sdk.googlePay.attach).toHaveBeenCalledWith(el, {
      buttonColor: "black",
      buttonSizeMode: "fill",
      buttonType: "pay",
    });
    await expect(handle.applePay?.()).resolves.toBe("cnon:apple");
    await expect(handle.googlePay?.()).resolves.toBe("cnon:google");
    expect(handle.unavailable).toEqual({});
  });

  it("leaves a refused wallet out and reports why, keeping the other", async () => {
    // Apple Pay refuses on any non-Safari browser and on an unverified domain.
    // Neither should take Google Pay or the card form down with it.
    const sdk = fakeSdk();
    sdk.instance.applePay.mockRejectedValue(new Error("Apple Pay is not supported"));
    const { mountWallets } = await load();
    document.body.innerHTML = '<div id="gpay"></div>';
    const onUnavailable = vi.fn();
    const handle = await mountWallets(...APP, {
      ...WALLET,
      googlePayEl: document.getElementById("gpay"),
      onUnavailable,
    });

    expect(handle.applePay).toBeUndefined();
    expect(handle.googlePay).toBeDefined();
    expect(handle.unavailable.applePay).toBe("Error: Apple Pay is not supported");
    expect(onUnavailable).toHaveBeenCalledWith("applePay", "Error: Apple Pay is not supported");
    expect(onUnavailable).toHaveBeenCalledTimes(1);
  });

  it("skips Google Pay, with a reason, when there is no element for its button", async () => {
    const sdk = fakeSdk();
    const { mountWallets } = await load();
    const handle = await mountWallets(...APP, WALLET);
    expect(sdk.instance.googlePay).not.toHaveBeenCalled();
    expect(handle.googlePay).toBeUndefined();
    expect(handle.unavailable.googlePay).toMatch(/googlePayEl/);
  });

  it("merges caller button options over the defaults", async () => {
    const sdk = fakeSdk();
    const { mountWallets } = await load();
    document.body.innerHTML = '<div id="gpay"></div>';
    await mountWallets(...APP, {
      ...WALLET,
      googlePayEl: document.getElementById("gpay"),
      googlePayButton: { buttonColor: "white" },
    });
    expect(sdk.googlePay.attach.mock.calls[0]?.[1]).toEqual({
      buttonColor: "white",
      buttonSizeMode: "fill",
      buttonType: "pay",
    });
  });

  it("surfaces Square's error detail when a wallet tokenize is not OK", async () => {
    const sdk = fakeSdk();
    sdk.applePay.tokenize.mockResolvedValue({
      status: "Cancel",
      errors: [{ message: "Sheet dismissed" }],
    });
    const { mountWallets } = await load();
    const handle = await mountWallets(...APP, WALLET);
    await expect(handle.applePay?.()).rejects.toThrow("Sheet dismissed");
  });
});

describe("mountCard", () => {
  afterEach(() => {
    window.Square = undefined;
    document.body.innerHTML = "";
  });

  it("attaches to the selector and tokenizes through the shared instance", async () => {
    const sdk = fakeSdk();
    const { mountCard } = await load();
    document.body.innerHTML = '<div id="card"></div>';
    const handle = await mountCard(...APP, "#card");
    expect(sdk.card.attach).toHaveBeenCalledWith("#card");
    await expect(handle.tokenize()).resolves.toBe("cnon:card");
  });

  it("throws Square's error detail, or a generic decline, when tokenize is not OK", async () => {
    const sdk = fakeSdk();
    sdk.card.tokenize.mockResolvedValueOnce({
      status: "Invalid",
      errors: [{ message: "Bad CVV" }],
    });
    sdk.card.tokenize.mockResolvedValueOnce({ status: "Invalid" });
    const { mountCard } = await load();
    const handle = await mountCard(...APP, "#card");
    await expect(handle.tokenize()).rejects.toThrow("Bad CVV");
    await expect(handle.tokenize()).rejects.toThrow("Card was declined");
  });
});
