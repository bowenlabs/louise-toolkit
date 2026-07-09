// Minimal pre-prod editor gate for the louisecms.com dogfood.
//
// This is NOT Better Auth — it's the smallest thing that can answer "is this
// request an editor?" for a single-editor, pre-production testbed, sitting
// behind the SAME `resolveEditor(request, env)` seam the louisecms/editor routes
// expect. A signed (HMAC-SHA256) cookie carries the editor identity; the login
// (/louise) checks one shared password. Swapping in getLouiseAuth
// (louisecms/auth) later is a drop-in — the routes and middleware don't change,
// only this module does.

import type { EditorSession } from "louisecms/auth";

/** Secrets the gate reads off the Worker/runtime env. */
export interface EditorGateEnv {
  /** HMAC key that signs the session cookie. */
  LOUISE_SESSION_SECRET: string;
  /** Shared password the /louise login checks. */
  LOUISE_EDITOR_PASSWORD?: string;
  /** Optional owner email used as the editor identity. */
  OWNER_EMAIL?: string;
}

/** Signed identity cookie. */
export const SESSION_COOKIE = "louise_session";
/** Unsigned edit-mode flag — controls affordance rendering only; every write is
 *  re-checked against the signed session + same-origin, so this is not a
 *  security boundary. */
export const EDIT_COOKIE = "louise_edit";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

interface SessionPayload extends EditorSession {
  exp: number; // unix seconds
}

const encoder = new TextEncoder();

function b64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(str: string): Uint8Array {
  const s = str.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "=".repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/** Sign an editor session into a cookie value (`<payload>.<sig>`, base64url). */
export async function signSession(env: EditorGateEnv, editor: EditorSession): Promise<string> {
  const payload: SessionPayload = {
    ...editor,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const body = b64urlEncode(encoder.encode(JSON.stringify(payload)));
  const key = await hmacKey(env.LOUISE_SESSION_SECRET);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(body)));
  return `${body}.${b64urlEncode(sig)}`;
}

/** Verify a cookie value, returning the editor session or null. */
export async function verifySession(
  env: EditorGateEnv,
  token: string | undefined,
): Promise<EditorSession | null> {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot < 1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const key = await hmacKey(env.LOUISE_SESSION_SECRET);
  const ok = await crypto.subtle
    .verify("HMAC", key, b64urlDecode(sig), encoder.encode(body))
    .catch(() => false);
  if (!ok) return null;
  let payload: SessionPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body))) as SessionPayload;
  } catch {
    return null;
  }
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  const { exp: _exp, ...editor } = payload;
  return editor;
}

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(/;\s*/)) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq) === name) return decodeURIComponent(part.slice(eq + 1));
  }
  return undefined;
}

/**
 * `resolveEditor` for the louisecms/editor routes AND the Astro middleware:
 * read + verify the session cookie off the request. Env-injected so it runs
 * identically in the Worker (editor routes) and in SSR (middleware).
 */
export function resolveEditorFromCookie(
  request: Request,
  env: EditorGateEnv,
): Promise<EditorSession | null> {
  return verifySession(env, readCookie(request, SESSION_COOKIE));
}

/** The fixed editor identity the single-password gate logs in as. */
export function gateEditor(env: EditorGateEnv): EditorSession {
  return {
    userId: "owner",
    email: env.OWNER_EMAIL ?? "editor@louisecms.com",
    name: "Editor",
    role: "owner",
  };
}

/** Constant-time-ish password check against the configured shared secret. */
export function checkPassword(env: EditorGateEnv, password: string): boolean {
  const expected = env.LOUISE_EDITOR_PASSWORD ?? "";
  if (!expected || password.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= password.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export const SESSION_MAX_AGE = SESSION_TTL_SECONDS;
