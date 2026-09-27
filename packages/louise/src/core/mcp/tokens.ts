// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.

// `louise-toolkit/mcp`—agent tokens, the bearer credential for an agent with
// no browser (ADR 0009 §5, slice 3, #235).
//
// A token belongs to the editor who issued it and acts as them, narrowed to a
// scope: which collections, and whether it may read, write drafts, or publish.
// It's the first credential in the toolkit that isn't a session cookie, so it
// widens what has to be right for sign-in to be safe. Every choice here
// narrows that:
//
// - Only a hash is stored. The secret is shown once, when it's issued.
// - A token with no scope reaches nothing, and every token expires.
// - Revocation is a column on the row the check reads, on D1's primary, so it
//   takes effect on the next request. No cache stands between them.
// - The token doesn't carry the editor's role or email. Each request
//   re-derives the editor, so one who loses access loses it for their tokens.

import { and, desc, eq, isNull } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { AgentAccess, AgentScope, EditorSession } from "../auth/types.js";
import { db } from "../db/index.js";
import type { D1Client } from "../db/session.js";
import { LouiseAuthError } from "../errors.js";

/** Every agent token starts with this, so a secret scanner can recognize one
 *  that leaked into a repository or a log. */
export const AGENT_TOKEN_PREFIX = "louise_at_";

/** How long a token lasts when its issuer doesn't say. */
export const AGENT_TOKEN_DEFAULT_DAYS = 30;

/** The longest a token may last. A token outlives its purpose more often than
 *  it's revoked, so expiry is the control that always runs. */
export const AGENT_TOKEN_MAX_DAYS = 90;

/** How often a token's `lastUsedAt` is written: at most once an hour, so a busy
 *  agent doesn't write to D1 on every call. */
const LAST_USED_RESOLUTION_MS = 60 * 60 * 1000;

const ACCESS_RANK: Record<AgentAccess, number> = { read: 1, draft: 2, publish: 3 };

/** The `agent_tokens` columns, to compose into your own schema. */
export const agentTokensColumns = {
  /** The public ID, such as `tok_4f9c2a1b7e3d5a60`. Safe to show and log. */
  id: text("id").primaryKey(),
  /** SHA-256 of the whole token, in hex. The token itself is never stored. */
  tokenHash: text("token_hash").notNull(),
  /** The token's last four characters, so a person can tell tokens apart. */
  hint: text("hint").notNull(),
  /** What the issuer called it, such as "Claude Code on Kai's laptop". */
  name: text("name").notNull(),
  /** The editor the token acts for. */
  userId: text("user_id").notNull(),
  /** Collection slug to access, as JSON. */
  scope: text("scope", { mode: "json" }).$type<AgentScope>().notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  lastUsedAt: integer("last_used_at", { mode: "timestamp" }),
  revokedAt: integer("revoked_at", { mode: "timestamp" }),
};

/** The ready-made `agent_tokens` table. Add it to the schema drizzle-kit reads,
 *  so the migration creates it. */
export const agentTokens = sqliteTable("agent_tokens", agentTokensColumns, (table) => [
  uniqueIndex("agent_tokens_token_hash").on(table.tokenHash),
  index("agent_tokens_user_id").on(table.userId),
]);

export type AgentTokenTable = typeof agentTokens;

/** A token as its owner sees it: everything but the secret and its hash. */
export interface AgentTokenInfo {
  id: string;
  name: string;
  hint: string;
  scope: AgentScope;
  createdAt: Date;
  expiresAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

export interface IssueAgentTokenInput {
  /** The editor issuing it. The token acts as them, never as anyone else. */
  owner: EditorSession;
  /** A name the editor recognizes later, in a list or a version's history. */
  name: string;
  /** What it may reach. Required and non-empty: there's no default scope. */
  scope: AgentScope;
  /** Days until it expires, from 1 to {@link AGENT_TOKEN_MAX_DAYS}. Default
   *  {@link AGENT_TOKEN_DEFAULT_DAYS}. */
  expiresInDays?: number;
}

/**
 * Issue a token. Returns the token itself, which is the only time anyone sees
 * it, and what's stored about it.
 *
 * An agent can't issue a token: `owner` must be a person's session, so a
 * leaked token can't mint a longer-lived one.
 */
export async function issueAgentToken(
  d1: D1Client,
  input: IssueAgentTokenInput,
  table: AgentTokenTable = agentTokens,
): Promise<{ token: string; info: AgentTokenInfo }> {
  if (input.owner.agent) {
    throw new LouiseAuthError("An agent token can't issue another token.");
  }
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name || name.length > 100) {
    throw new LouiseAuthError("Give the token a name of 1 to 100 characters.");
  }
  const scope = parseAgentScope(input.scope);
  if (typeof scope === "string") throw new LouiseAuthError(scope);
  const days = input.expiresInDays ?? AGENT_TOKEN_DEFAULT_DAYS;
  if (!Number.isInteger(days) || days < 1 || days > AGENT_TOKEN_MAX_DAYS) {
    throw new LouiseAuthError(
      `A token lasts from 1 to ${AGENT_TOKEN_MAX_DAYS} days, as a whole number.`,
    );
  }

  const token = `${AGENT_TOKEN_PREFIX}${randomBase64Url(32)}`;
  const now = new Date();
  // Whole seconds, as the timestamp columns store them, so the info returned
  // here matches what a later list reads back.
  now.setMilliseconds(0);
  const row = {
    id: `tok_${randomHex(8)}`,
    tokenHash: await hashAgentToken(token),
    hint: token.slice(-4),
    name,
    userId: input.owner.userId,
    scope,
    createdAt: now,
    expiresAt: new Date(now.getTime() + days * 24 * 60 * 60 * 1000),
    lastUsedAt: null,
    revokedAt: null,
  };
  await db(d1).insert(table).values(row);
  return { token, info: toInfo(row) };
}

/** An editor's tokens, newest first, including revoked and expired ones so the
 *  list shows what happened to each. */
export async function listAgentTokens(
  d1: D1Client,
  userId: string,
  table: AgentTokenTable = agentTokens,
): Promise<AgentTokenInfo[]> {
  const rows = await db(d1)
    .select()
    .from(table)
    .where(eq(table.userId, userId))
    .orderBy(desc(table.createdAt));
  return rows.map(toInfo);
}

/**
 * Revoke one of an editor's tokens. Returns false when they have no live token
 * with that ID, including one that belongs to someone else, so the answer
 * doesn't say whether another editor's token exists.
 */
export async function revokeAgentToken(
  d1: D1Client,
  target: { id: string; userId: string },
  table: AgentTokenTable = agentTokens,
): Promise<boolean> {
  const revoked = await db(d1)
    .update(table)
    .set({ revokedAt: new Date() })
    .where(and(eq(table.id, target.id), eq(table.userId, target.userId), isNull(table.revokedAt)))
    .returning({ id: table.id });
  return revoked.length > 0;
}

/** A live token's owner and scope, as {@link verifyAgentToken} finds them. */
export interface VerifiedAgentToken {
  id: string;
  name: string;
  userId: string;
  scope: AgentScope;
}

/**
 * Look a token up. Returns null when it's malformed, unknown, revoked, or
 * expired, without saying which: the caller answers every one of those the same
 * way.
 *
 * The lookup is by the token's hash, so the comparison that could leak timing
 * runs on a digest, never on the secret.
 */
export async function verifyAgentToken(
  d1: D1Client,
  token: string,
  table: AgentTokenTable = agentTokens,
): Promise<VerifiedAgentToken | null> {
  if (!token.startsWith(AGENT_TOKEN_PREFIX) || token.length > 200) return null;
  const database = db(d1);
  const [row] = await database
    .select()
    .from(table)
    .where(eq(table.tokenHash, await hashAgentToken(token)))
    .limit(1);
  const now = Date.now();
  if (!row || row.revokedAt || row.expiresAt.getTime() <= now) return null;
  const scope = parseAgentScope(row.scope);
  // A row edited by hand into a bad scope reaches nothing.
  if (typeof scope === "string") return null;

  if (!row.lastUsedAt || now - row.lastUsedAt.getTime() >= LAST_USED_RESOLUTION_MS) {
    await database
      .update(table)
      .set({ lastUsedAt: new Date(now) })
      .where(eq(table.id, row.id));
  }
  return { id: row.id, name: row.name, userId: row.userId, scope };
}

/**
 * Whether `scope` grants `need` on the collection `slug`. A collection the
 * scope doesn't list is out of reach.
 */
export function agentMay(scope: AgentScope, slug: string, need: AgentAccess): boolean {
  if (!Object.hasOwn(scope, slug)) return false;
  const granted = scope[slug];
  return granted !== undefined && ACCESS_RANK[granted] >= ACCESS_RANK[need];
}

/**
 * Check a scope an issuer supplied, or one read back from D1. Returns the
 * scope, or a sentence saying what's wrong with it.
 */
export function parseAgentScope(raw: unknown): AgentScope | string {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return "A token's scope maps each collection to read, draft, or publish.";
  }
  const out: Record<string, AgentAccess> = {};
  for (const [slug, access] of Object.entries(raw)) {
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(slug)) {
      return `"${slug}" isn't a collection slug.`;
    }
    if (typeof access !== "string" || !Object.hasOwn(ACCESS_RANK, access)) {
      return `The access for ${slug} must be read, draft, or publish.`;
    }
    out[slug] = access as AgentAccess;
  }
  if (Object.keys(out).length === 0) {
    return "A token needs at least one collection in its scope.";
  }
  return out;
}

/**
 * The token in a request's `Authorization: Bearer` header, or null when there's
 * no bearer credential. The scheme is matched without regard to case, as HTTP
 * requires.
 */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  const match = header?.match(/^Bearer[ \t]+(\S+)[ \t]*$/i);
  return match?.[1] ?? null;
}

/** Hex SHA-256 of a token. A token carries 256 random bits, so a fast hash is
 *  enough: there's nothing to guess that a slow one would protect. */
export async function hashAgentToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function toInfo(row: typeof agentTokens.$inferSelect): AgentTokenInfo {
  return {
    id: row.id,
    name: row.name,
    hint: row.hint,
    scope: row.scope,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    lastUsedAt: row.lastUsedAt ?? null,
    revokedAt: row.revokedAt ?? null,
  };
}

function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

function randomHex(n: number): string {
  return [...randomBytes(n)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomBase64Url(n: number): string {
  return btoa(String.fromCharCode(...randomBytes(n)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
