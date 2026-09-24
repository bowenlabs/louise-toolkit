---
"louise-toolkit": minor
---

Three auth and editor-route fixes. Each closes a hole, and each can change what an existing site sees.

**`editorsRoute` now lists and deletes only editors (`role = 'admin'`).** It shares Better Auth's `user` table with customer accounts. GET listed every row, so any editor saw every customer's name and email. DELETE removed any row by `?id=`, customers included. Now GET returns only editors, and a DELETE for an id that isn't an editor returns **404** and changes nothing. *Do:* nothing, unless your UI relied on seeing non-editor rows through this route. It shouldn't have.

**`getLouiseAuth` sends magic links only to the allowlist, on every instance.** `handleAuthRequest` gated magic-link requests, but only on the route that calls it, and only at the exact path `/api/auth/sign-in/magic-link`. A second instance on its own `basePath` (a customer portal served straight from `auth.handler`) would mail a working sign-in link to any address that was typed in. Clicking it created an account even with `disableSignUp: true`. Now the factory itself sends a link only to addresses `resolveAdmins` returns, and `handleAuthRequest` matches `sign-in/magic-link` under any base path, with or without a trailing slash. *Do:* check that the `resolveAdmins` you pass to `getLouiseAuth` is the same list you pass to `handleAuthRequest`. If the factory's list is narrower, editors missing from it stop receiving sign-in email. Customers never used magic links, so portals lose nothing.

**`getLouiseAuth` refuses the `DUMMY_REPLACE_ME` placeholder as `SESSION_SECRET`.** A deploy that still carried the scaffold sentinel would have signed sessions with a publicly known key. Off `localhost` it now throws, like a missing secret. *Do:* if a deployed site is running on that value, set a real one (`openssl rand -base64 32`, then `wrangler secret put SESSION_SECRET`) **before** upgrading. After the upgrade, every auth request on that site returns 500 until the secret is set. Rotating the secret signs out existing sessions.
