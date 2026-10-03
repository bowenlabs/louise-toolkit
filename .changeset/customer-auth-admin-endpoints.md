---
"louise-toolkit": minor
---

Customer auth instances no longer mount Better Auth's admin endpoints. `getLouiseAuth` added the `admin` plugin to every instance, which serves user administration at `<basePath>/admin/*`: listing, creating, and removing users, setting roles, banning, and impersonation. An instance with `customers` set now leaves the plugin off unless it sets the new `customers.adminEndpoints: true`. An editor-only instance, with no `customers`, keeps it.

Only the endpoints go. With the plugin off, the instance still does what the plugin did on every request:

- **The schema doesn't change.** `generateAuthSchemaSql` still emits the `role` and ban columns, so you don't need a migration.
- **`role` stays on the session user.** A new account still gets its role, and no one can set their own role or ban, even when `additionalFields` declares a field with the same name.
- **A ban blocks a new session.** A banned user can't sign in, and an expired ban is cleared at the next sign-in. A ban doesn't end the sessions the user already has, since that was the `ban-user` endpoint's job.

**What to do:**

- Most sites: nothing. No Louise or Astroid code calls the admin endpoints on a customer instance.
- If your site calls `<basePath>/admin/*` on a customer instance, or uses Better Auth's `adminClient` against one, set `customers: { adminEndpoints: true }` on that instance to mount them again. Before you do, make sure no customer row holds an admin role, since the endpoints check only `role`.
- **If editors and customers share one instance,** that instance has `customers` set, so it loses `/api/auth/admin/*` too. Setting `adminEndpoints: true` on it gives every editor, who holds the `admin` role, the power to list, remove, ban, and impersonate every customer. To administer editors through these endpoints, move editors to an instance of their own.
- **If you ban customers by hand,** also delete the user's rows in the `session` table, and their entries in KV when `sessionCacheKv` is set. Without the `ban-user` endpoint, a ban only stops new sessions.
