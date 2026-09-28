---
"louise-toolkit": patch
---

`redirectWithCookies(from, location, status?)` in `louise-toolkit/auth` builds a redirect that carries every cookie a Better Auth response set. Use it in a server-rendered route that calls the API with `asResponse: true` and then redirects, such as a sign-out link:

```ts
const result = await auth.api.signOut({ headers: request.headers, asResponse: true });
return redirectWithCookies(result, "/");
```

Better Auth's sign-out expires three cookies at once. Copying them with `headers.get("set-cookie")` joins them into one header, and the browser keeps all but the first, so the visitor stays signed in. If a route of yours copies `set-cookie` that way, switch it to this helper. `status` defaults to 303.
