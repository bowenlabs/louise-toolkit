// Copyright (c) 2026 BowenLabs. Astroid is MIT licensed.

export { astroidMailTheme, type MailThemeOverrides } from "./theme.js";
export { type AstroidMailEnv, sendInquiryMail } from "./inquiry.js";
export {
  createMailer,
  type DeliveryResult,
  type EmailSender,
  type MailerOptions,
  type OutgoingMail,
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
