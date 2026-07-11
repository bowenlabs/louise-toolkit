// Headless <Form> render helper — happy-dom Solid component tests (#46, Tier 2).
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
});
