// Copyright (c) 2026 BowenLabs. Louise (louisecms) is MIT licensed.

import type { LouiseAuth } from "./auth.js";
import type { EditorSession } from "./types.js";

/**
 * Re-derive the editor (admin) session from the signed Better Auth session on
 * every request — edit access is never trusted from the client. Returns the
 * editor when the session user holds `editorRole` (the admin plugin's "admin"),
 * else null. The site assigns the result to its `locals`.
 */
export async function resolveEditorSession(
  auth: LouiseAuth,
  request: Request,
  editorRole = "admin",
): Promise<EditorSession | null> {
  const result = await auth.api.getSession({ headers: request.headers });
  const user = result?.user;
  if (!user || user.role !== editorRole) return null;
  return {
    userId: user.id,
    email: user.email ?? "",
    // Better Auth defaults name from the email local-part, so it's always set.
    name: user.name || user.email?.split("@")[0] || "Editor",
    role: user.role,
  };
}
