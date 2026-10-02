---
"louise-toolkit": minor
---

The `LouiseAuth` type that `getLouiseAuth` returns now includes `api.signOut({ headers, asResponse: true })`, which returns a `Promise<Response>`, as in Better Auth 1.7. The instance always had the method, but the type hid it, so the sign-out example in the `redirectWithCookies` docs didn't compile without a cast:

```ts
const result = await auth.api.signOut({ headers: request.headers, asResponse: true });
return redirectWithCookies(result, "/");
```

Nothing changes at run time. If your site casts `auth` to reach `signOut`, or builds a sign-out `Request` and passes it to `auth.handler`, you can call `auth.api.signOut` directly. Code that builds a `LouiseAuth` by hand, such as a test stub, needs a `signOut` method, or a cast as before.
