// The versioned-draft store deps for `pages`, shared by the raw `versionsRoute`
// (worker.ts) and the `saveDraft` Astro Action (actions/index.ts) so their draft
// behaviour — sections validation + the #70 DRAFTS KV write-buffer — can never
// drift between the two save entrypoints (#138).
//
// `deferReindex` is deliberately NOT here: it's a *publish*-path concern, and a
// draft save never publishes, so it stays inline on the raw route.

import { assertValidSections } from "louise-toolkit/content";
import { pagesCollection } from "../../pages-collection.js";
import { pages, pagesVersions } from "../../schema.js";
import { SECTIONS } from "../../sections/catalog.js";

/** Media base — matches wrangler.jsonc `vars.MEDIA_URL`; every section image is
 *  validated against it so only media-library assets are stored (#47). */
const MEDIA_BASE = "/media";

/** Shared draft deps — spread into both `versionsRoute(...)` and
 *  `louiseSaveDraftAction(...)`. Params are annotated inline because the
 *  `SaveDraftDeps` type isn't publicly exported; the shape is structurally what
 *  both consumers accept. */
export const pagesDraftDeps = {
  table: pages,
  versionsTable: pagesVersions,
  config: pagesCollection,
  validate: async (data: Record<string, unknown>) => {
    if ("sections" in data) {
      await assertValidSections(SECTIONS, data.sections, {
        operation: "update",
        mediaBase: MEDIA_BASE,
      });
    }
  },
  bufferKv: (env: CloudflareEnv) => env.DRAFTS,
};
