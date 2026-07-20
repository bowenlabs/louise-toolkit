// Copyright (c) 2026 BowenLabs. Astroid is MIT licensed.
//
// `src/actions/index.ts` — the Astro-native, typed mutation surface (ADR 0001
// layer 2), beside the framework-agnostic `/api/louise/*` routes.
//
// Astroid generated only the route half. That is not a missing convenience: the
// two entrypoints write the SAME rows, and the whole reason `louise-toolkit/astro`
// exposes these factories is that each one shares the raw route's store path —
// `applyFieldSave`, `applySettingsPatch`, `applySaveDraft`. A project that wired
// its own Actions by hand would get a second write path, and a second write path
// is where validation, sanitization, and draft-merge semantics drift apart
// silently (#138).
//
// So this file is SCAFFOLD-ONCE and is meant to be added to — the reference site
// keeps its own bespoke actions right beside these — but the three below come
// pre-wired against the same tables and the same collection config the generated
// worker uses.

import type { AstroidConfig } from "../config.js";

/** `src/actions/index.ts` — the typed mutation surface, scaffolded once. */
export function generateAstroidActions(config: AstroidConfig): string {
  const customKeys = config.settings?.customKeys ?? [];
  const extraImageKeys = config.settings?.imageKeys ?? [];
  const columnsOverride = config.settings?.columns;
  // Kept in step with the generated worker's settingsRoute: site-specific keys go
  // to site_settings.custom, extra image keys widen the media-strict set, a
  // custom-heavy site can override the base columns. Emitted as literals only
  // when present, so a stock project's Action is unchanged.
  const settingsExtra = [
    columnsOverride
      ? `        columns: ${JSON.stringify(columnsOverride)},`
      : "        columns: ASTROID_SETTINGS_COLUMNS,",
    ...(customKeys.length ? [`        customKeys: ${JSON.stringify(customKeys)},`] : []),
    extraImageKeys.length
      ? `        imageKeys: [...ASTROID_SETTINGS_IMAGE_KEYS, ...${JSON.stringify(extraImageKeys)}],`
      : "        imageKeys: ASTROID_SETTINGS_IMAGE_KEYS,",
  ];
  return [
    "// The typed Astro Actions surface — ADR 0001 layer 2.",
    "//",
    "// Scaffolded once and yours to ADD to: put your own `defineAction`s in the",
    "// `server` object below, alongside these.",
    "//",
    "// What matters about the three that ship here is that they are NOT a second",
    "// implementation. Each factory shares the store path of its raw",
    "// `/api/louise/*` counterpart (`applyFieldSave`, `applySettingsPatch`,",
    "// `applySaveDraft`), so a field is validated once and written in exactly one",
    "// place however it was called. Hand-rolling an Action that writes the same",
    "// row is how sanitization and draft-merge semantics drift apart without",
    "// anything failing.",
    'import { ActionError, defineAction } from "astro:actions";',
    'import { env } from "cloudflare:workers";',
    "import {",
    "  louiseSaveAction,",
    "  louiseSaveDraftAction,",
    "  louiseSettingsAction,",
    '} from "louise-toolkit/astro";',
    "import {",
    "  ASTROID_SETTINGS_COLUMNS,",
    "  ASTROID_SETTINGS_IMAGE_KEYS,",
    "  astroidPagesCollection,",
    '} from "astroidjs";',
    'import astroidConfig from "../../astroid.config.js";',
    'import { pages, pagesVersions, siteSettings } from "../schema.js";',
    "",
    "const pagesCollection = astroidPagesCollection(astroidConfig);",
    "",
    "// Astro v6+ removed `Astro.locals.runtime.env`, so the bindings are resolved",
    "// from `cloudflare:workers` — the same env the raw routes read.",
    "const getEnv = () => env as unknown as CloudflareEnv;",
    "",
    "// `getEditor` is left to its default (`locals.editor`), which the generated",
    "// middleware sets for a signed-in editor. A falsy result answers 401, so these",
    "// carry the same gate as the routes rather than a parallel one.",
    "const deps = { ActionError, getEnv };",
    "",
    "export const server = {",
    "  louise: {",
    "    // Inline field save (title, SEO) — the live, non-versioned path.",
    "    save: defineAction(",
    "      louiseSaveAction({",
    "        ...deps,",
    "        collections: {",
    "          pages: {",
    "            table: pages,",
    '            fields: ["title", "seoTitle", "seoDescription"],',
    "          },",
    "        },",
    "      }),",
    "    ),",
    "",
    "    // The versioned body/sections save — stages a DRAFT, exactly as",
    "    // versionsRoute does, through the same `applySaveDraft`.",
    "    saveDraft: defineAction(",
    "      louiseSaveDraftAction({",
    "        ...deps,",
    "        table: pages,",
    "        versionsTable: pagesVersions,",
    "        config: pagesCollection,",
    "        // The same KV write-buffer the route uses. Both entrypoints coalesce",
    "        // through one buffer, so an autosave burst is one D1 write however",
    "        // the client happened to call in.",
    "        bufferKv: (e) => e.DRAFTS,",
    "      }),",
    "    ),",
    "",
    "    // The Settings-panel patch (brand, nav, contact, SEO defaults).",
    "    settings: defineAction(",
    "      louiseSettingsAction({",
    "        ...deps,",
    "        table: siteSettings,",
    "        // The SAME allowlist the generated worker enforces, imported rather",
    "        // than copied — a second literal here is a list that drifts from the",
    "        // one the routes check against, and nothing would fail when it did.",
    ...settingsExtra,
    '        mediaBase: astroidConfig.deploy?.mediaBase ?? "/media",',
    "      }),",
    "    ),",
    "  },",
    "};",
    "",
  ].join("\n");
}
