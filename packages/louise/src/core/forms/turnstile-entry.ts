// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/forms/turnstile—Cloudflare Turnstile, both halves, and
// nothing else.
//
// Its own entry because `louise-toolkit/forms` also carries the form-table
// builder, which imports the optional `drizzle-orm` peer. A sign-in page wants
// the widget, and a CSP builder wants the widget's origins; neither should have
// to install an ORM to get them. Everything here is dependency-free, and
// scripts/ci/checks/export-map.mjs holds the BUILT entry to that.
//
// The same symbols stay exported from `louise-toolkit/forms`.

export { verifyTurnstileToken } from "./turnstile.js";
export {
  loadTurnstile,
  type RenderTurnstileOptions,
  renderTurnstile,
  TURNSTILE_SCRIPT_SRC,
  turnstileCsp,
  type TurnstileWidget,
} from "./turnstile-client.js";
