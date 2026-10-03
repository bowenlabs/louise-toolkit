// <SignInLinkForm> and requestSignInLink (louise-toolkit/client/sign-in):
// the request it sends, how it reads the answer, the captcha's single-use
// token, and what a screen reader and a keyboard get.

import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  requestSignInLink,
  SignInLinkForm,
  type SignInLinkFormProps,
} from "../../src/client/sign-in/index.js";

const SITE_KEY = "1x00000000000000000000AA";

let host: HTMLElement;
let dispose: (() => void) | undefined;

function mount(props: Partial<SignInLinkFormProps> = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  dispose = render(() => <SignInLinkForm callbackURL="/account" {...props} />, host);
}

const input = () => host.querySelector<HTMLInputElement>('input[name="email"]')!;
const button = () => host.querySelector<HTMLButtonElement>("button[type=submit]");
const errorText = () => host.querySelector(".louise-signin-error")?.textContent;

function submit(email = "kai@example.com") {
  input().value = email;
  host
    .querySelector("form")!
    .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function stubFetch(status = 200, body: unknown = { status: true }) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function sent(fetchMock: ReturnType<typeof stubFetch>) {
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  return {
    url,
    headers: init.headers as Record<string, string>,
    body: JSON.parse(String(init.body)) as Record<string, unknown>,
  };
}

function stubTurnstile() {
  let options: Record<string, unknown> = {};
  const api = {
    render: vi.fn((_el: HTMLElement, renderOptions: Record<string, unknown>) => {
      options = renderOptions;
      return "w1";
    }),
    reset: vi.fn(),
    remove: vi.fn(),
    getResponse: vi.fn(() => undefined),
  };
  vi.stubGlobal("turnstile", api);
  const call = (name: string, ...args: unknown[]) =>
    (options[name] as (...a: unknown[]) => void)(...args);
  return {
    api,
    issue: (token: string) => call("callback", token),
    expire: () => call("expired-callback"),
    fail: () => call("error-callback", "300030"),
  };
}

afterEach(() => {
  dispose?.();
  dispose = undefined;
  host?.remove();
  vi.unstubAllGlobals();
});

describe("requestSignInLink", () => {
  it("posts the address and callbacks to the instance's mount", async () => {
    const fetchMock = stubFetch();
    const result = await requestSignInLink({
      email: "kai@example.com",
      basePath: "/api/shop-auth",
      callbackURL: "/account",
      newUserCallbackURL: "/account?welcome=1",
      errorCallbackURL: "/login",
      captchaToken: "tok-1",
    });
    expect(result).toEqual({ ok: true });
    const { url, headers, body } = sent(fetchMock);
    expect(url).toBe("/api/shop-auth/sign-in/magic-link");
    expect(headers["x-captcha-response"]).toBe("tok-1");
    expect(body).toEqual({
      email: "kai@example.com",
      callbackURL: "/account",
      newUserCallbackURL: "/account?welcome=1",
      errorCallbackURL: "/login",
    });
  });

  it("defaults to the editor mount, and sends no captcha header or empty callbacks", async () => {
    const fetchMock = stubFetch();
    await requestSignInLink({ email: "kai@example.com", callbackURL: "/?louise" });
    const { url, headers, body } = sent(fetchMock);
    expect(url).toBe("/api/auth/sign-in/magic-link");
    expect(headers).not.toHaveProperty("x-captcha-response");
    expect(body).toEqual({ email: "kai@example.com", callbackURL: "/?louise" });
  });

  it.each([
    [429, { code: "TOO_MANY" }, "rate-limited"],
    [403, { code: "VERIFICATION_FAILED" }, "captcha"],
    [400, { code: "MISSING_RESPONSE" }, "captcha"],
    [400, { code: "VALIDATION_ERROR" }, "invalid-email"],
    [403, { code: "INVALID_CALLBACK_URL" }, "failed"],
    [500, {}, "failed"],
  ])("reads a %i with %j as %s", async (status, body, reason) => {
    stubFetch(status, body);
    expect(await requestSignInLink({ email: "kai@example.com", callbackURL: "/" })).toEqual({
      ok: false,
      reason,
    });
  });

  it("reads a body that isn't JSON, such as a proxy's error page, as failed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<h1>Bad gateway</h1>", { status: 502 })),
    );
    expect(await requestSignInLink({ email: "kai@example.com", callbackURL: "/" })).toEqual({
      ok: false,
      reason: "failed",
    });
  });

  it("answers a dropped connection rather than throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    expect(await requestSignInLink({ email: "kai@example.com", callbackURL: "/" })).toEqual({
      ok: false,
      reason: "network",
    });
  });
});

describe("<SignInLinkForm>", () => {
  it("labels the field and keeps the status region in the page before anything is sent", () => {
    mount({ label: "Studio email", inputId: "studio-email" });
    const label = host.querySelector("label")!;
    expect(label.textContent).toBe("Studio email");
    expect(label.getAttribute("for")).toBe("studio-email");
    expect(input().id).toBe("studio-email");
    expect(input().type).toBe("email");
    expect(input().autocomplete).toBe("email");
    expect(input().required).toBe(true);
    const status = host.querySelector(".louise-signin-status")!;
    expect(status.getAttribute("role")).toBe("status");
    expect(status.textContent).toBe("");
    expect(host.querySelector("form")!.getAttribute("method")).toBe("post");
  });

  it("generates distinct field IDs for two forms on one page", () => {
    mount();
    const first = input().id;
    const other = document.createElement("div");
    document.body.appendChild(other);
    const disposeOther = render(() => <SignInLinkForm callbackURL="/" />, other);
    const second = other.querySelector("input")!.id;
    expect(first).toMatch(/^louise-signin-/);
    expect(second).not.toBe(first);
    disposeOther();
    other.remove();
  });

  it("sends the trimmed address with the props' mount and callbacks", async () => {
    const fetchMock = stubFetch();
    mount({
      basePath: "/api/shop-auth",
      newUserCallbackURL: "/account?welcome=1",
      errorCallbackURL: "/login",
    });
    submit("  kai@example.com ");
    await flush();
    const { url, body } = sent(fetchMock);
    expect(url).toBe("/api/shop-auth/sign-in/magic-link");
    expect(body).toEqual({
      email: "kai@example.com",
      callbackURL: "/account",
      newUserCallbackURL: "/account?welcome=1",
      errorCallbackURL: "/login",
    });
  });

  it("replaces the form with the confirmation, and moves focus to it", async () => {
    stubFetch();
    const onSent = vi.fn();
    mount({ sentMessage: "If that address can edit, a link is on its way.", onSent });
    button()!.focus();
    submit();
    await flush();
    expect(host.querySelector("form")).toBeNull();
    const confirmation = host.querySelector<HTMLElement>(
      ".louise-signin-status .louise-signin-sent",
    )!;
    expect(confirmation.textContent).toBe("If that address can edit, a link is on its way.");
    expect(confirmation.getAttribute("tabindex")).toBe("-1");
    expect(document.activeElement).toBe(confirmation);
    expect(onSent).toHaveBeenCalledOnce();
  });

  it("shows a 429 as an error and keeps the form, rather than claiming a link was sent", async () => {
    stubFetch(429, { code: "TOO_MANY" });
    mount();
    submit();
    await flush();
    expect(host.querySelector(".louise-signin-sent")).toBeNull();
    expect(errorText()).toBe("Too many tries. Wait a few minutes, then try again.");
    const error = host.querySelector(".louise-signin-error")!;
    expect(error.getAttribute("role")).toBe("alert");
    expect(input().getAttribute("aria-describedby")).toBe(error.id);
    expect(input().hasAttribute("aria-invalid")).toBe(false);
    expect(button()!.disabled).toBe(false);
  });

  it("marks the field invalid when the server refuses the address", async () => {
    stubFetch(400, { code: "VALIDATION_ERROR" });
    mount();
    submit();
    await flush();
    expect(errorText()).toBe("Check the email address, then try again.");
    expect(input().getAttribute("aria-invalid")).toBe("true");
  });

  it("takes the site's wording for a message", async () => {
    stubFetch(500, {});
    mount({ messages: { failed: "The café couldn't send it." } });
    submit();
    await flush();
    expect(errorText()).toBe("The café couldn't send it.");
  });

  it("is busy while the request runs, and ignores a second submit", async () => {
    let answer: (res: Response) => void = () => {};
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    mount({ sendingLabel: "Sending the link…" });
    submit();
    await flush();
    expect(button()!.disabled).toBe(true);
    expect(button()!.getAttribute("aria-busy")).toBe("true");
    expect(button()!.textContent).toBe("Sending the link…");
    submit();
    expect(fetchMock).toHaveBeenCalledOnce();
    answer(new Response("{}", { status: 200 }));
    await flush();
    expect(host.querySelector(".louise-signin-sent")).not.toBeNull();
  });

  it("shows the notice until a link is sent", async () => {
    stubFetch();
    mount({ notice: "That link has expired. Enter your email for a new one." });
    const notice = () => host.querySelector(".louise-signin-notice");
    expect(notice()?.textContent).toBe("That link has expired. Enter your email for a new one.");
    expect(notice()?.getAttribute("role")).toBe("alert");
    submit();
    await flush();
    expect(notice()).toBeNull();
  });

  it("adds a site's classes beside the hooks", () => {
    mount({ classes: { submit: "btn btn-primary", field: "field" } });
    expect(button()!.className).toBe("louise-signin-submit btn btn-primary");
    expect(host.querySelector(".louise-signin-field")!.className).toBe("louise-signin-field field");
    expect(host.querySelector(".louise-signin-input")!.className).toBe("louise-signin-input");
  });

  it("renders no widget when captcha is off", () => {
    const { api } = stubTurnstile();
    mount({ turnstile: null });
    expect(host.querySelector(".louise-signin-captcha")).toBeNull();
    expect(api.render).not.toHaveBeenCalled();
  });

  describe("with Turnstile", () => {
    it("renders the widget with the sign-in action, and sends its token as the header", async () => {
      const { api, issue } = stubTurnstile();
      const fetchMock = stubFetch();
      mount({ turnstile: { siteKey: SITE_KEY, appearance: "interaction-only" } });
      await flush();
      expect(api.render).toHaveBeenCalledWith(
        host.querySelector(".louise-signin-captcha"),
        expect.objectContaining({
          sitekey: SITE_KEY,
          action: "sign-in",
          appearance: "interaction-only",
        }),
      );
      issue("tok-1");
      submit();
      await flush();
      expect(sent(fetchMock).headers["x-captcha-response"]).toBe("tok-1");
      expect(api.reset).toHaveBeenCalledWith("w1");
    });

    it("says it's still checking when submitted before a token, and sends nothing", async () => {
      stubTurnstile();
      const fetchMock = stubFetch();
      mount({ turnstile: { siteKey: SITE_KEY } });
      await flush();
      submit();
      await flush();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(errorText()).toBe("Still checking that you're a person. Try again in a moment.");
      expect(button()!.disabled).toBe(false);
    });

    it("resets the spent token after a refusal, so the retry waits for a new one", async () => {
      const { api, issue } = stubTurnstile();
      const fetchMock = stubFetch(403, { code: "VERIFICATION_FAILED" });
      mount({ turnstile: { siteKey: SITE_KEY } });
      await flush();
      issue("tok-1");
      submit();
      await flush();
      expect(errorText()).toBe("The security check didn't pass. Try again.");
      expect(api.reset).toHaveBeenCalledWith("w1");
      submit();
      await flush();
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(errorText()).toBe("Still checking that you're a person. Try again in a moment.");
    });

    it.each(["expire", "fail"] as const)(
      "waits for a new token after the widget's token %ss",
      async (event) => {
        const widget = stubTurnstile();
        const fetchMock = stubFetch();
        mount({ turnstile: { siteKey: SITE_KEY } });
        await flush();
        widget.issue("tok-1");
        widget[event]();
        submit();
        await flush();
        expect(fetchMock).not.toHaveBeenCalled();
        expect(errorText()).toBe("Still checking that you're a person. Try again in a moment.");
      },
    );

    it("says so at once when the widget can't load", async () => {
      vi.useFakeTimers();
      try {
        // No `window.turnstile`, and a script that never arrives.
        const append = vi.spyOn(document.head, "appendChild").mockImplementation((n) => n);
        mount({ turnstile: { siteKey: SITE_KEY } });
        await vi.advanceTimersByTimeAsync(11_000);
        append.mockRestore();
      } finally {
        vi.useRealTimers();
      }
      expect(errorText()).toBe(
        "The security check couldn't load. Check your connection and reload the page.",
      );
      const fetchMock = stubFetch();
      submit();
      await flush();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("removes the widget when the form goes away", async () => {
      const { api } = stubTurnstile();
      mount({ turnstile: { siteKey: SITE_KEY } });
      await flush();
      dispose?.();
      dispose = undefined;
      expect(api.remove).toHaveBeenCalledWith("w1");
    });
  });
});
