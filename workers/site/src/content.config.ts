// Example (#92): expose the PUBLISHED `pages` collection through Astro's native
// Content Layer — `getCollection("publishedPages")` / `getEntry(...)` — via
// `louiseLoader`, with a Zod schema derived straight from `pagesCollection`'s
// own fields (no hand-written schema).
//
// This is a build-time SNAPSHOT: the loader reads D1 over REST during
// `astro build` (see ./lib/louise/published-pages), so it refreshes on rebuild,
// not per request. It's intentionally SEPARATE from the site's live editing
// path — `src/pages/[...slug].astro` still reads D1 per request via the Worker
// binding for instant edits. Use this snapshot collection for cacheable,
// build-time listings (indexes, sitemaps, static exports).
import { defineCollection } from "astro:content";
import { louiseLoader } from "@louise-toolkit/astro";
import { readPublishedPages } from "./lib/louise/published-pages.js";
import { pagesCollection } from "./pages-collection.js";

export const collections = {
  publishedPages: defineCollection({
    loader: louiseLoader({ collection: pagesCollection, read: readPublishedPages }),
  }),
};
