// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// `louise-toolkit/content/define` — the drizzle-free half of the content module:
// everything needed to DESCRIBE content (collection + field config, and the
// flatten/nest helpers) with none of the machinery that talks to a database.
//
// Why this exists. The `louise-toolkit/content` barrel re-exports the whole
// module, and three of its members import `drizzle-orm` as real values —
// `codegen` (builds Drizzle tables), `localApi` (builds queries), and
// `validation` (uniqueness queries). Those imports are legitimate, but ESM is
// eager: a caller that only wanted `defineCollection` still had to resolve
// drizzle-orm at import time. Since drizzle-orm is an *optional* peer, that
// silently required consumers to install a package they never asked for — it
// shipped a broken `create-astroid` to the registry once, because Astroid's config
// generators call `defineCollection` and nothing else.
//
// So: import from here when you're describing content (config, codegen tools,
// meta-frameworks); import from `louise-toolkit/content` when you're also
// reading or writing it. The barrel still exports all of this, so nothing here
// is a second source of truth — it's a narrower door onto the same rooms.

export * from "./defineCollection.js";
export * from "./types.js";
