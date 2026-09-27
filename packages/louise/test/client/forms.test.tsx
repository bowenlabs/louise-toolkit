// Headless <Form> render helper—happy-dom Solid component tests (#46, Tier 2).
// Covers rendering from the catalog, the client-side validation mirror (reusing
// the shared Rule engine), a successful POST, and mapping a server 422.

import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Form } from "../../src/client/forms.jsx";
import { defineForm } from "../../src/core/forms/index.js";

const form = defineForm({
  name: "inquiries",
  fields: {
    email: { type: "email", label: "Email", required: true },
    topic: { type: "select", label: "Topic", options: ["sales", "support"] },
    message: { type: "textarea", label: "Message", required: true },
  },
});

let host: HTMLElement;
let dispose: (() => void) | undefined;

function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  dispose = render(() => <Form form={form} />, host);
}

function setValue(name: string, value: string) {
  const el = host.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function submit() {
  const f = host.querySelector("form")!;
  f.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  host?.remove();
  vi.unstubAllGlobals();
});

describe("<Form>", () => {
  it("renders an accessible input per field from the catalog", () => {
    mount();
    expect(host.querySelector('input[name="email"][type="email"]')).toBeTruthy();
    expect(host.querySelector('select[name="topic"]')).toBeTruthy();
    expect(host.querySelector('textarea[name="message"]')).toBeTruthy();
    // select options come from the field's `options`.
    const opts = [...host.querySelectorAll('select[name="topic"] option')].map((o) =>
      o.getAttribute("value"),
    );
    expect(opts).toEqual(["", "sales", "support"]);
    // labels present for the labelled inputs.
    expect(host.textContent).toContain("Email");
  });

  it("blocks submit and shows field errors client-side (no request)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    mount();
    setValue("email", "not-an-email");
    // message left empty (required)
    submit();
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    const errs = [...host.querySelectorAll(".louise-form-error")].map((e) => e.textContent);
    expect(errs.some((t) => /email/i.test(t ?? ""))).toBe(true);
    expect(errs.some((t) => /message/i.test(t ?? ""))).toBe(true);
  });

  it("POSTs JSON and shows success on 201", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    mount();
    setValue("email", "a@b.co");
    setValue("message", "hello there");
    submit();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/louise/forms/inquiries");
    expect(JSON.parse(String(init.body))).toMatchObject({
      email: "a@b.co",
      message: "hello there",
    });
    expect(host.querySelector('.louise-form-status[data-status="success"]')).toBeTruthy();
  });

  it("maps a server 422 back onto field errors", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: "validation",
            violations: [{ path: "email", message: "already used" }],
          }),
          { status: 422 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    mount();
    setValue("email", "a@b.co");
    setValue("message", "hello there");
    submit();
    await flush();
    expect(host.querySelector(".louise-form-error")?.textContent).toContain("already used");
  });

  it("links help and error text, and marks required fields", async () => {
    const withHelp = defineForm({
      name: "contact",
      fields: {
        email: {
          type: "email",
          label: "Email",
          required: true,
          help: "We only use it to reply.",
          autocomplete: "email",
        },
        postcode: { type: "text", label: "Postal code", inputmode: "numeric" },
      },
    });
    vi.stubGlobal("fetch", vi.fn());
    host = document.createElement("div");
    document.body.appendChild(host);
    dispose = render(() => <Form form={withHelp} />, host);

    const email = host.querySelector<HTMLInputElement>('input[name="email"]')!;
    expect(email.id).toBe("louise-f-contact-email");
    expect(email.required).toBe(true);
    expect(email.getAttribute("aria-required")).toBe("true");
    expect(email.getAttribute("autocomplete")).toBe("email");
    expect(email.getAttribute("aria-describedby")).toBe("louise-f-contact-email-help");
    expect(document.getElementById("louise-f-contact-email-help")?.textContent).toBe(
      "We only use it to reply.",
    );
    const postcode = host.querySelector<HTMLInputElement>('input[name="postcode"]')!;
    expect(postcode.getAttribute("inputmode")).toBe("numeric");
    expect(postcode.required).toBe(false);
    expect(postcode.hasAttribute("aria-required")).toBe(false);

    submit();
    await flush();
    expect(email.getAttribute("aria-describedby")).toBe(
      "louise-f-contact-email-help louise-f-contact-email-err",
    );
  });

  it("keeps field IDs apart when two forms share a field name", () => {
    const other = defineForm({
      name: "newsletter",
      fields: { email: { type: "email", label: "Email" } },
    });
    host = document.createElement("div");
    document.body.appendChild(host);
    dispose = render(
      () => (
        <>
          <Form form={form} />
          <Form form={other} />
        </>
      ),
      host,
    );
    const ids = [...host.querySelectorAll('input[name="email"]')].map((el) => el.id);
    expect(ids).toEqual(["louise-f-inquiries-email", "louise-f-newsletter-email"]);
  });

  it("moves focus to the first invalid field and says how many need attention", async () => {
    vi.stubGlobal("fetch", vi.fn());
    mount();
    setValue("email", "not-an-email");
    submit();
    await flush();
    expect(document.activeElement).toBe(host.querySelector('input[name="email"]'));
    expect(host.querySelector(".louise-form-status")?.textContent).toBe("2 fields need attention.");
  });

  it("shows a 422 violation that matches no field in the status region", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ violations: [{ path: "", message: "This form is closed." }] }),
            { status: 422 },
          ),
      ),
    );
    mount();
    setValue("email", "a@b.co");
    setValue("message", "hello there");
    submit();
    await flush();
    expect(host.querySelector(".louise-form-status")?.textContent).toBe("This form is closed.");
    expect(host.querySelector(".louise-form-error")).toBeNull();
  });

  it("names a next step when the server fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 500 })),
    );
    mount();
    setValue("email", "a@b.co");
    setValue("message", "hello there");
    submit();
    await flush();
    expect(host.querySelector(".louise-form-status")?.textContent).toBe(
      "Couldn't send your message. Try again in a minute.",
    );
  });

  it("keeps the status region in the DOM before there's anything to say", () => {
    mount();
    const status = host.querySelector(".louise-form-status");
    expect(status?.getAttribute("role")).toBe("status");
    expect(status?.textContent).toBe("");
  });
});
