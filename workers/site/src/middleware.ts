import type { APIContext, MiddlewareNext } from "astro";
import { defineMiddleware } from "astro:middleware";
import { isNoindexHost, louiseSecurityHeaders } from "louise-toolkit/security";
import { getEditorGate } from "./lib/louise/gate.js";
import { EDIT_COOKIE, resolveEditorFromCookie, SESSION_MAX_AGE } from "./lib/louise/session.js";

// Resolves the editor session per request and derives edit mode, following the
// Louise contract: `locals.editor` authorizes writes (re-checked in the Worker's
// editor routes), while `locals.editMode` only decides whether the page renders
// edit affordances. Edit mode is a sticky cookie toggled by `?louise` /
// `?louise=off`; entering it requires a valid session.
//
// Every page response, redirects included, also gets the toolkit's baseline
// security headers, plus `X-Robots-Tag: noindex` on a `*.workers.dev` copy.
// Here rather than in page code: a streamed page has already sent its headers
// by the time page code runs.
export const onRequest = defineMiddleware(async (context, next) => {
  const { hostname } = context.url;
  const headers = { hostname, noindex: isNoindexHost(hostname) };
  return louiseSecurityHeaders(await handle(context, next), headers);
});

async function handle(context: APIContext, next: MiddlewareNext): Promise<Response> {
  const editor = await resolveEditorFromCookie(context.request, getEditorGate());

  const url = context.url;
  const secure = url.protocol === "https:";
  let editMode = context.cookies.get(EDIT_COOKIE)?.value === "1";

  if (url.searchParams.has("louise")) {
    if (url.searchParams.get("louise") === "off") {
      context.cookies.delete(EDIT_COOKIE, { path: "/" });
      editMode = false;
    } else if (editor) {
      context.cookies.set(EDIT_COOKIE, "1", {
        path: "/",
        httpOnly: false,
        sameSite: "lax",
        secure,
        maxAge: SESSION_MAX_AGE,
      });
      editMode = true;
    } else {
      return context.redirect(`/louise?next=${encodeURIComponent(url.pathname)}`);
    }
  }

  context.locals.editor = editor;
  context.locals.editMode = editMode && !!editor;
  return next();
}
