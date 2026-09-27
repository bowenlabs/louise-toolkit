// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.

import type { EmailSender } from "../email/index.js";
import type { LouiseEnv, SecretBinding } from "../security/index.js";

/**
 * Bindings the Louise auth primitives read off a Worker's `env`. A site's own
 * `Env` should `extends LouiseAuthEnv`. Widens the security base (`LouiseEnv`,
 * which contributes `SESSION_SECRET`) with the auth + email + captcha surface.
 */
export interface LouiseAuthEnv extends LouiseEnv {
  /** D1 database—Better Auth speaks it natively (1.5+), no adapter needed. */
  DB: D1Database;
  /** Cloudflare Email Sending binding, used to deliver magic links. */
  EMAIL: EmailSender;
  /** Turnstile secret (Secrets Store binding or plain value), if the site
   *  provisioned one. Captcha activates only when this AND a real (non-test)
   *  site key are both configured, so leaving it off simply means no captcha. */
  TURNSTILE_SECRET?: SecretBinding | string;
  /** Public Turnstile site key, or the test key / unset to keep captcha off. */
  TURNSTILE_SITE_KEY?: string;
  /** Site owner email—always an admin (used by the default allowlist). */
  OWNER_EMAIL?: string;
  /** Optional second admin (for example, the engineer); clearing it revokes access. */
  ENGINEER_EMAIL?: string;
}

/** A resolved editor (admin) session, as a site surfaces it on `locals`. */
export interface EditorSession {
  userId: string;
  email: string;
  name: string;
  role: string;
  /**
   * Set when an agent holding one of this editor's tokens made the request,
   * rather than the editor in a browser. The rest of the session is the
   * editor's, so access functions see who the agent acts for, and can read this
   * to treat an agent differently.
   */
  agent?: EditorAgent;
}

/** What a token grants on one collection. Each level includes the one before:
 *  `draft` can read, and `publish` can do both. */
export type AgentAccess = "read" | "draft" | "publish";

/** A token's scope: collection slug to access. A collection that isn't listed
 *  is out of reach. */
export type AgentScope = Readonly<Record<string, AgentAccess>>;

/** The agent behind a request, named for an audit trail a person reads. */
export interface EditorAgent {
  /** The token's public ID, such as `tok_4f9c2a1b7e3d5a60`. Never the secret. */
  tokenId: string;
  /** The name the editor gave the token, such as "Claude Code on Kai's laptop". */
  name: string;
  scope: AgentScope;
}
