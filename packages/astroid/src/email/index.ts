// Copyright (c) 2026 BowenLabs. Astroid is MIT licensed.

export { astroidMailTheme, type MailThemeOverrides } from "./theme.js";
export { type AstroidMailEnv, sendInquiryMail } from "./inquiry.js";
export {
  createMailer,
  type DeliveryResult,
  EMAIL_SECRET_NAMES,
  type EmailSender,
  type MailerEnv,
  type MailerOptions,
  type MailerStatus,
  type OutgoingMail,
  resolveMailer,
  resolveMailerStatus,
  sendTransactional,
} from "./send.js";
export {
  type InquiryDetails,
  inquiryConfirmationEmail,
  inquiryNotificationEmail,
  magicLinkEmail,
  type MailContent,
  type MailTheme,
  passwordResetEmail,
} from "./templates.js";
