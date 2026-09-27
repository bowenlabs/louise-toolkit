---
"louise-toolkit": minor
---

Serve `sitemap.xml` and `robots.txt` from the published pages, per request (#583).

- **`sitemapRoute`** (`louise-toolkit/editor`) reads the pages table on every request. It lists published rows without `noindex` or an `exclude` slug, the home slug as `/`, then the `extra` paths. It lists nothing while **Hide from search engines** is on. Both files are public and cacheable for 60 seconds, and a sitemap that can't read the table answers 503.
- **`sitemapXml(entries)`** and **`robotsTxt({ sitemapUrl?, disallow? })`** (`louise-toolkit/seo`) are the pure builders it uses.
- **A publish now moves the page's `updatedAt`** when the table has a date-typed `updatedAt` column, as the framework `pages` table does, so a page's `<lastmod>` is when it last went live.

The origin, the home slug, the excluded slugs, and the extra paths are parameters, with no defaults. The only default is the 60-second cache (`maxAgeSeconds`).

**Upgrading:** nothing is required. To serve the files, mount `sitemapRoute` in `composeWorker`, and remove any hand-written `sitemap.xml` route.
