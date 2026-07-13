// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise/forms — declarative form builder (issue #46). Define a form's fields
// once; derive the table, capture route (`formRoute`, in louise/editor),
// validation, and review columns from that single definition.

export { columnName, deriveFormColumns } from "./columns.js";
export { defineForm } from "./defineForm.js";
export { looksLikeSpam, notifySubmission, renderSubmissionText } from "./notify.js";
export {
  type TanstackFieldValidator,
  tanstackFieldValidator,
  tanstackFormValidators,
} from "./tanstack.js";
export { verifyTurnstileToken } from "./turnstile.js";
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
  coerceFormValue,
  type SubmissionResult,
  validateField,
  validateSubmission,
} from "./validate.js";
