// Better Auth catch-all — magic-link sign-in, passkey, session. The allowlist
// gate (handleAuth → handleAuthRequest) rejects magic-link requests from
// non-editor emails before Better Auth runs, enumeration-safe.
import type { APIRoute } from "astro";
import { handleAuth } from "../../../auth";

export const prerender = false;

export const ALL: APIRoute = ({ request }) => handleAuth(request);
