import { describe, expect, it, vi } from "vitest";
import { LouiseEmailError } from "../../src/core/errors.js";
import { type EmailSender, sendEmail } from "../../src/core/email/index.js";

function fakeSender(impl?: () => Promise<{ messageId: string }>) {
  const send = vi.fn(impl ?? (async () => ({ messageId: "m1" })));
  return { sender: { send } satisfies EmailSender, send };
}

const base = {
  from: "studio@example.com",
  to: "you@example.com",
  subject: "Hello",
} as const;

describe("sendEmail", () => {
  it("forwards to the binding and returns the messageId", async () => {
    const { sender, send } = fakeSender();
    const res = await sendEmail(sender, { ...base, html: "<p>Hi</p>" });
    expect(res.messageId).toBe("m1");
    expect(send).toHaveBeenCalledOnce();
  });

  it("derives a text/plain alternative from html when text is omitted", async () => {
    const { sender, send } = fakeSender();
    await sendEmail(sender, {
      ...base,
      html: "<h1>Hello</h1> <p>world &amp; friends</p>",
    });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ text: "Hello world & friends" }));
  });

  it("keeps an explicit text alternative", async () => {
    const { sender, send } = fakeSender();
    await sendEmail(sender, { ...base, html: "<p>x</p>", text: "custom" });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ text: "custom" }));
  });

  it("only includes replyTo when provided", async () => {
    const { sender, send } = fakeSender();
    await sendEmail(sender, { ...base, html: "x", replyTo: "reply@example.com" });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ replyTo: "reply@example.com" }));
  });

  it("wraps a binding failure in LouiseEmailError", async () => {
    const { sender } = fakeSender(async () => {
      throw new Error("smtp down");
    });
    await expect(sendEmail(sender, { ...base, html: "x" })).rejects.toBeInstanceOf(
      LouiseEmailError,
    );
  });
});

describe("sendEmail with no binding", () => {
  // The floor: a missing EMAIL binding must LOUDLY SIMULATE in dev, not crash the
  // request that triggered it. A hand-rolled contact route calling
  // `sendEmail(env.EMAIL, …)` with no localhost guard used to throw on `env.EMAIL`
  // being undefined locally — a dead contact form in dev, a 500 in prod misconfig.
  const link = "https://acme.coffee/api/auth/magic?token=abc";

  it("logs a simulated send and returns { simulated } instead of throwing", async () => {
    const log = vi.fn();
    const res = await sendEmail(
      null,
      { ...base, html: `<p>${link}</p>`, text: `Sign in:\n${link}` },
      { simulateWhenUnconfigured: true, devLog: true, log },
    );
    expect(res).toEqual({ simulated: true });
    expect(log).toHaveBeenCalledOnce();
    // The plaintext body is logged because that's where a sign-in link lives.
    expect(log.mock.calls[0][0]).toContain(link);
    expect(log.mock.calls[0][0]).toContain("no binding");
  });

  it("WITHHOLDS the body when this isn't a dev environment", async () => {
    // The body carries live single-use magic/reset links; console.info is
    // `wrangler tail` + Logpush, so it must not leak outside development.
    const log = vi.fn();
    const res = await sendEmail(
      undefined,
      { ...base, html: `<p>${link}</p>`, text: `Sign in:\n${link}` },
      { simulateWhenUnconfigured: true, devLog: false, log },
    );
    expect(res.simulated).toBe(true);
    const line = log.mock.calls[0][0];
    expect(line).not.toContain(link);
    expect(line).toContain("body withheld");
    // It still records THAT a message went unsent, and to whom.
    expect(line).toContain("you@example.com");
  });

  it("throws in a non-dev context rather than dropping mail in silence", async () => {
    // The production default: a missing binding is a real misconfiguration, and a
    // silently-swallowed send is worse than a loud failure.
    await expect(
      sendEmail(null, { ...base, html: "x" }, { simulateWhenUnconfigured: false }),
    ).rejects.toBeInstanceOf(LouiseEmailError);
  });

  it("names the opt-out in the thrown message", async () => {
    await expect(
      sendEmail(null, { ...base, html: "x" }, { simulateWhenUnconfigured: false }),
    ).rejects.toThrow(/simulateWhenUnconfigured/);
  });
});
