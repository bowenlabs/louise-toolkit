// Copyright (c) 2026 BowenLabs. Astroid is MIT licensed.
//
// The module status report — "what is actually switched on right now".
//
// `secrets.ts` gives one module its gate. This composes every enabled module's
// gate into one answer, which is what the dormant-until-provisioned convention
// needs to be usable rather than merely available: a fresh scaffold boots with
// nothing provisioned, and the failure mode that convention exists to avoid is
// not a crash — it's a developer wondering for twenty minutes why the contact
// form "works" but no mail arrives.
//
// So the deal is: dormant is fine, dormant AND SILENT is not. Two consumers of
// this, both cheap:
//
//   • `astroid doctor` / a dev-server banner prints `describeAstroidStatus`.
//   • `astroidSecretNames` drives what the scaffold seeds and types, so the
//     list a developer is told to fill is generated from the same declaration
//     the runtime gate reads. They cannot drift.

import { commerceSecretNames, resolveCommerceStatus } from "./commerce/secrets.js";
import type { AstroidConfig } from "./config.js";
import { ASTROID_VITALS_SECRET_NAMES } from "./analytics/index.js";
import { EMAIL_SECRET_NAMES, type MailerEnv, resolveMailerStatus } from "./email/send.js";
import type { SecretSource } from "./secrets.js";

/**
 * Secrets every Astroid site has, independent of which modules are on.
 *
 * `SESSION_SECRET` is here but is NOT a dormancy gate — it fails closed off
 * localhost (see `getSessionSecret`), because an unsigned session isn't a
 * feature to switch off. It's listed so the scaffold seeds and types it.
 */
export const ASTROID_CORE_SECRET_NAMES = [
  "SESSION_SECRET",
  "TURNSTILE_SECRET",
  "TURNSTILE_SITE_KEY",
] as const;

/** One module's line in the report. */
export interface AstroidModuleReport {
  /** Module name, as a developer would say it: `"commerce"`, `"email"`. */
  module: string;
  /** Whether the project switched this module on at all. */
  enabled: boolean;
  /** Whether it has everything it needs to run live. */
  configured: boolean;
  /** Unprovisioned secret/binding names, in declaration order. */
  missing: string[];
  /** What the module does in this state — the sentence a banner prints. */
  detail: string;
}

/**
 * Every secret name this config implies, grouped by module.
 *
 * The scaffold uses this twice: to seed `.dev.vars`/`.env.example` with the
 * placeholder sentinel, and to type the matching `CloudflareEnv` members. A
 * module that isn't enabled contributes nothing — a declaration is a promise,
 * and a marketing site shouldn't be told to provision a Square token.
 */
export function astroidSecretNames(config: AstroidConfig): Record<string, string[]> {
  const groups: Record<string, string[]> = {
    core: [...ASTROID_CORE_SECRET_NAMES],
    email: [...EMAIL_SECRET_NAMES],
  };
  const commerce = commerceSecretNames(config.commerce);
  if (commerce.length > 0) groups.commerce = commerce;
  // The CWV read-back's API credentials. Collection needs none of this — only
  // querying the p75 back out does, because the Analytics Engine SQL API is
  // account-scoped and has no binding.
  groups.vitals = [...ASTROID_VITALS_SECRET_NAMES];
  return groups;
}

/** The env shape the status report reads. Structural; a real `env` fits. */
export type AstroidStatusEnv = MailerEnv & Record<string, SecretSource | unknown>;

/**
 * Resolve every enabled module's gate.
 *
 * ```ts
 * // src/pages/api/_astroid/status.ts, or a dev-only banner
 * const report = await astroidModuleStatus(config, env);
 * console.info(describeAstroidStatus(report));
 * ```
 */
export async function astroidModuleStatus(
  config: AstroidConfig,
  env: AstroidStatusEnv,
): Promise<AstroidModuleReport[]> {
  const secretEnv = env as Record<string, SecretSource>;

  const [commerce, mailer] = await Promise.all([
    resolveCommerceStatus(config.commerce, secretEnv),
    resolveMailerStatus(env),
  ]);

  const reports: AstroidModuleReport[] = [
    {
      module: "email",
      enabled: true,
      configured: mailer.configured,
      missing: mailer.missing,
      detail: mailer.configured
        ? "sending through the EMAIL binding"
        : // Naming the log is the useful part: the magic link IS in the console,
          // and someone who doesn't know that concludes sign-in is broken.
          "dormant — messages are logged to the console (the magic link is in the log), not sent",
    },
  ];

  if (commerce.enabled) {
    reports.push({
      module: "commerce",
      enabled: true,
      configured: commerce.configured,
      missing: commerce.missing,
      detail: commerce.configured
        ? `live via ${commerce.providers.map((p) => p.provider).join(" + ")}`
        : "dormant — the D1 catalog mirror still serves, but nothing syncs from the provider and checkout is simulated",
    });
  }

  return reports;
}

/**
 * The report as a printable block. One line per module, missing names spelled
 * out — "commerce is off" sends someone reading source; "commerce is dormant —
 * set SQUARE_ACCESS_TOKEN" does not.
 */
export function describeAstroidStatus(reports: AstroidModuleReport[]): string {
  if (reports.length === 0) return "[astroid] no optional modules enabled";
  return [
    "[astroid] module status",
    ...reports.map((r) => {
      const head = `  ${r.module}: ${r.configured ? "configured" : "dormant (simulated)"}`;
      const why = r.missing.length > 0 ? ` — unprovisioned: ${r.missing.join(", ")}` : "";
      return `${head}${why}\n    ${r.detail}`;
    }),
  ].join("\n");
}
