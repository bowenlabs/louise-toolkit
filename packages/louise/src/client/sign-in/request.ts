// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// The request half of the sign-in-link form, with no DOM: a site that draws
// its own sign-in screen calls this and keeps the same answers.
//
// Every hand-written copy got one thing wrong in the same way: it ignored the
// response and showed "check your inbox" for a 429 or a refused captcha, so
// the person waited for a link that was never sent. The endpoint answers the
// same for an address with an account and one without, so reading the status
// reveals nothing about the address.

/** Why a link wasn't sent. */
export type SignInLinkFailure =
  /** Better Auth's limiter answered 429. */
  | "rate-limited"
  /** The captcha token was missing, spent, or refused. */
  | "captcha"
  /** The server didn't accept the address. */
  | "invalid-email"
  /** Any other refusal. */
  | "failed"
  /** The request never got an answer. */
  | "network";

export type SignInLinkResult = { ok: true } | { ok: false; reason: SignInLinkFailure };

export interface RequestSignInLinkOptions {
  email: string;
  /** The Better Auth instance's mount. Default `/api/auth`, the editor
   *  instance; a customer instance has its own, such as `/api/shop-auth`. */
  basePath?: string;
  /** Where the link lands after signing in. */
  callbackURL: string;
  /** Where the link lands instead when following it made the account. */
  newUserCallbackURL?: string;
  /** Where an expired or used link lands. Better Auth appends `?error=…`. */
  errorCallbackURL?: string;
  /** The Turnstile token, sent as `x-captcha-response`. Better Auth's captcha
   *  plugin reads only that header, never the body. */
  captchaToken?: string | null;
}

// Better Auth's captcha plugin: 400 with no token, 403 with a refused one.
const CAPTCHA_CODES = new Set(["MISSING_RESPONSE", "VERIFICATION_FAILED"]);

/**
 * Ask a Better Auth instance for a one-time sign-in link. Resolves with
 * `{ ok: true }` for any 2xx, and never throws: a refusal or a dropped
 * connection comes back as a `reason` a form can word.
 */
export async function requestSignInLink(
  options: RequestSignInLinkOptions,
): Promise<SignInLinkResult> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.captchaToken) headers["x-captcha-response"] = options.captchaToken;
  let res: Response;
  try {
    res = await fetch(`${options.basePath ?? "/api/auth"}/sign-in/magic-link`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        email: options.email,
        callbackURL: options.callbackURL,
        ...(options.newUserCallbackURL ? { newUserCallbackURL: options.newUserCallbackURL } : {}),
        ...(options.errorCallbackURL ? { errorCallbackURL: options.errorCallbackURL } : {}),
      }),
    });
  } catch {
    return { ok: false, reason: "network" };
  }
  if (res.ok) return { ok: true };
  if (res.status === 429) return { ok: false, reason: "rate-limited" };
  const code = await errorCode(res);
  if (code && CAPTCHA_CODES.has(code)) return { ok: false, reason: "captcha" };
  if (res.status === 400 && code === "VALIDATION_ERROR") {
    return { ok: false, reason: "invalid-email" };
  }
  return { ok: false, reason: "failed" };
}

/** Better Auth's error `code`, or null when the body isn't its JSON. */
async function errorCode(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { code?: unknown };
    return typeof body.code === "string" ? body.code : null;
  } catch {
    return null;
  }
}
