// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/forms—declarative form builder (issue #46). Define a form's fields
// once; derive the table, capture route (`formRoute`, in louise-toolkit/editor),
// validation, and review columns from that single definition.

export { columnName, deriveFormColumns } from "./columns.js";
export { defineForm } from "./defineForm.js";
export { autofillProneName } from "./honeypot.js";
export {
  looksLikeSpam,
  notifySubmission,
  renderSubmissionText,
  type SpamVerdict,
  spamVerdict,
} from "./notify.js";
export {
  type TanstackFieldValidator,
  tanstackFieldValidator,
  tanstackFormValidators,
} from "./tanstack.js";
export { verifyTurnstileToken } from "./turnstile.js";
export {
  loadTurnstile,
  type RenderTurnstileOptions,
  renderTurnstile,
  TURNSTILE_SCRIPT_SRC,
  turnstileCsp,
  type TurnstileWidget,
} from "./turnstile-client.js";
export type {
  AnyFormTable,
  FormColumns,
  FormConfig,
  FormDefinition,
  FormField,
  FormFieldType,
  FormMailer,
  FormNotifyConfig,
  FormReviewColumn,
  FormSpamConfig,
} from "./types.js";
export {
  type CoerceOptions,
  coerceFormValue,
  type SubmissionResult,
  validateField,
  validateSubmission,
} from "./validate.js";
