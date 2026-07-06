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
