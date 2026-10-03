// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// <SignInLinkForm>—one email field that asks a Better Auth instance for a
// one-time sign-in link. It serves an editor sign-in (the server mails only
// the allowlist) and a customer one (`customers.signIn: "magic-link"`, where
// following the link makes the account) alike; the mount, the callbacks, and
// the copy are props.
//
// What every hand-written copy had to learn, kept in one place:
//
//   - Read the response. A 429 or a refused captcha isn't "check your inbox".
//   - A Turnstile token is good for one request, so reset the widget after
//     every request, sent or not, or the retry posts a spent token.
//   - No widget means no token, and the endpoint refuses a request without one,
//     so a widget that can't load says so before anyone types.
//   - Keep the button enabled until the request starts, and say why a submit
//     didn't go, rather than disable it with no reason given.
//   - The `role="status"` region is in the page from the start, so a screen
//     reader announces the confirmation when it arrives, and focus moves to the
//     confirmation because the button it was on goes away.
//
// Unstyled: every element carries a `louise-signin*` class, and `classes` adds
// a site's own, so a site keeps its look without restyling the hooks.

import { createSignal, createUniqueId, type JSX, onCleanup, onMount, Show } from "solid-js";
import {
  type RenderTurnstileOptions,
  renderTurnstile,
  type TurnstileWidget,
} from "../../core/forms/turnstile-client.js";
import { requestSignInLink, type SignInLinkFailure } from "./request.js";

/** Every message the form can show, keyed by when it shows. */
export interface SignInLinkMessages {
  /** A 429 from Better Auth's limiter. */
  rateLimited: string;
  /** The server refused the captcha token. */
  captchaFailed: string;
  /** The server didn't accept the address. */
  invalidEmail: string;
  /** Any other refusal. */
  failed: string;
  /** The request got no answer. */
  network: string;
  /** Submitted before the widget issued a token. */
  captchaPending: string;
  /** The widget couldn't load, so no request can pass. */
  captchaUnavailable: string;
}

const DEFAULT_MESSAGES: SignInLinkMessages = {
  rateLimited: "Too many tries. Wait a few minutes, then try again.",
  captchaFailed: "The security check didn't pass. Try again.",
  invalidEmail: "Check the email address, then try again.",
  failed: "The link couldn't be sent. Try again in a moment.",
  network: "Couldn't reach the site. Check your connection and try again.",
  captchaPending: "Still checking that you're a person. Try again in a moment.",
  captchaUnavailable:
    "The security check couldn't load. Check your connection and reload the page.",
};

const FAILURE_MESSAGE: Record<SignInLinkFailure, keyof SignInLinkMessages> = {
  "rate-limited": "rateLimited",
  captcha: "captchaFailed",
  "invalid-email": "invalidEmail",
  failed: "failed",
  network: "network",
};

/** The parts `classes` can add a class to. */
export type SignInLinkFormPart =
  | "root"
  | "form"
  | "field"
  | "label"
  | "input"
  | "captcha"
  | "notice"
  | "error"
  | "submit"
  | "status"
  | "sent";

export interface SignInLinkFormProps {
  /** The Better Auth instance's mount. Default `/api/auth`. */
  basePath?: string;
  /** Where the link lands after signing in. */
  callbackURL: string;
  /** Where the link lands instead when following it made the account. */
  newUserCallbackURL?: string;
  /** Where an expired or used link lands. Better Auth appends `?error=…`. */
  errorCallbackURL?: string;
  /**
   * Render a Turnstile widget and send its token. Pass it exactly when the
   * server's captcha is on: take `siteKey` from `activeCaptcha`
   * (louise-toolkit/auth), so the widget and the check are one decision. Omit
   * it, or pass `null`, when captcha is off. `action` defaults to `"sign-in"`.
   */
  turnstile?: Pick<
    RenderTurnstileOptions,
    "siteKey" | "appearance" | "action" | "size" | "theme"
  > | null;
  /** The email field's label. Default "Email". */
  label?: string;
  /** The email field's ID. Default a generated one. */
  inputId?: string;
  placeholder?: string;
  /** The button's text. Default "Email me a link". */
  submitLabel?: string;
  /** The button's text while the request runs. Default "Sending…". */
  sendingLabel?: string;
  /**
   * Shown once a link is sent. Keep it the same whether or not the address has
   * an account, so it reveals nothing. Default "Check your inbox: a sign-in
   * link is on its way."
   */
  sentMessage?: string;
  /**
   * Shown above the form until a link is sent, such as "That link has
   * expired" when an `errorCallbackURL` brought the person back. Gone once a
   * new link is on its way, so the page never says both.
   */
  notice?: string | null;
  /** Override any of the error messages. */
  messages?: Partial<SignInLinkMessages>;
  /** A site's own classes, added beside each part's `louise-signin*` class. */
  classes?: Partial<Record<SignInLinkFormPart, string>>;
  /** Called after the server accepts a request. */
  onSent?: () => void;
}

type Status = "idle" | "working" | "sent";

export function SignInLinkForm(props: SignInLinkFormProps): JSX.Element {
  const [status, setStatus] = createSignal<Status>("idle");
  const [error, setError] = createSignal<keyof SignInLinkMessages | null>(null);
  const [widget, setWidget] = createSignal<TurnstileWidget | null>(null);
  const [token, setToken] = createSignal<string | null>(null);
  let captchaHost: HTMLDivElement | undefined;
  let sentEl: HTMLParagraphElement | undefined;

  const generatedId = createUniqueId();
  const inputId = () => props.inputId ?? `louise-signin-${generatedId}`;
  const errorId = () => `${inputId()}-error`;
  const message = (key: keyof SignInLinkMessages) => props.messages?.[key] ?? DEFAULT_MESSAGES[key];
  const cls = (part: SignInLinkFormPart) => {
    const extra = props.classes?.[part];
    return extra ? `louise-signin-${part} ${extra}` : `louise-signin-${part}`;
  };

  onMount(async () => {
    const turnstile = props.turnstile;
    if (!turnstile?.siteKey || !captchaHost) return;
    try {
      setWidget(
        await renderTurnstile(captchaHost, {
          ...turnstile,
          action: turnstile.action ?? "sign-in",
          onToken: setToken,
          onExpire: () => setToken(null),
          onError: () => setToken(null),
        }),
      );
    } catch {
      setError("captchaUnavailable");
    }
  });
  onCleanup(() => widget()?.remove());

  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    if (status() === "working") return;
    if (props.turnstile?.siteKey && !token()) {
      setError(widget() ? "captchaPending" : "captchaUnavailable");
      return;
    }
    const email = String(new FormData(e.currentTarget as HTMLFormElement).get("email") ?? "");
    setStatus("working");
    setError(null);
    const result = await requestSignInLink({
      email: email.trim(),
      basePath: props.basePath,
      callbackURL: props.callbackURL,
      newUserCallbackURL: props.newUserCallbackURL,
      errorCallbackURL: props.errorCallbackURL,
      captchaToken: token(),
    });
    // Spent whatever the answer was.
    widget()?.reset();
    setToken(null);
    if (result.ok) {
      setStatus("sent");
      // The button that had focus is gone; put focus on what replaced it.
      sentEl?.focus();
      props.onSent?.();
      return;
    }
    setError(FAILURE_MESSAGE[result.reason]);
    setStatus("idle");
  };

  return (
    <div class={cls("root")}>
      <Show when={props.notice && status() !== "sent"}>
        <p class={cls("notice")} role="alert">
          {props.notice}
        </p>
      </Show>
      <div class={cls("status")} role="status">
        <Show when={status() === "sent"}>
          <p class={cls("sent")} tabindex="-1" ref={(el) => (sentEl = el)}>
            {props.sentMessage ?? "Check your inbox: a sign-in link is on its way."}
          </p>
        </Show>
      </div>
      <Show when={status() !== "sent"}>
        {/* `post`, so a submit that somehow skips the handler never puts the
            address in a URL. */}
        <form class={cls("form")} method="post" onSubmit={submit}>
          <div class={cls("field")}>
            <label class={cls("label")} for={inputId()}>
              {props.label ?? "Email"}
            </label>
            <input
              class={cls("input")}
              id={inputId()}
              name="email"
              type="email"
              autocomplete="email"
              spellcheck={false}
              required
              placeholder={props.placeholder}
              aria-invalid={error() === "invalidEmail" ? true : undefined}
              aria-describedby={error() ? errorId() : undefined}
            />
          </div>
          <Show when={props.turnstile?.siteKey}>
            <div class={cls("captcha")} ref={(el) => (captchaHost = el)} />
          </Show>
          <Show when={error()}>
            {(key) => (
              <p class={cls("error")} id={errorId()} role="alert">
                {message(key())}
              </p>
            )}
          </Show>
          <button
            class={cls("submit")}
            type="submit"
            disabled={status() === "working"}
            aria-busy={status() === "working" ? true : undefined}
          >
            {status() === "working"
              ? (props.sendingLabel ?? "Sending…")
              : (props.submitLabel ?? "Email me a link")}
          </button>
        </form>
      </Show>
    </div>
  );
}
