---
"louisecms": patch
---

Make the subpath exports resolvable by CJS-based tools. The `exports` map only
declared `types` + `import` conditions, so tools that resolve with Node's CJS
algorithm — notably **drizzle-kit**, which loads a site's Drizzle `schema.ts` —
failed with `ERR_PACKAGE_PATH_NOT_EXPORTED` when a schema imported the shared
column sets (`import { siteSettingsColumns, pagesColumns } from "louisecms/db"`).

Each subpath now also carries a `default` condition pointing at the same ESM
file. ESM consumers still match `import` first (unchanged); CJS-resolution tools
fall through to `default` and resolve the module (then bundle it themselves).
This unblocks importing the framework `louisecms/db` column sets into a site's
Drizzle schema, which the site migrations rely on.
