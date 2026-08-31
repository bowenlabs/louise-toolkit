// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// `louise-toolkit/astro` — optional Astro glue for Louise sites. Framework-specific
// helpers that import Astro's types live here (never in the framework-agnostic
// core), so `astro` is an OPTIONAL peer, pulled in only by sites that import
// this subpath. First inhabitant: the shared middleware factory.

export {
  type ActionErrorCtor,
  type EditorActionContext,
  type EditorActionDeps,
  type LouiseSaveActionConfig,
  type LouiseSaveDraftActionConfig,
  type LouiseSettingsActionConfig,
  louiseSaveAction,
  louiseSaveDraftAction,
  louiseSettingsAction,
  type SaveActionInput,
  type SaveDraftActionInput,
} from "./actions.js";
export { type CatalogLoaderConfig, defineCatalogLoader } from "./catalog.js";
export {
  collectionToAstroSchema,
  louiseLoader,
  type LouiseLoaderConfig,
  type LouiseRow,
} from "./content-loader.js";
export { formToAstroSchema } from "./form-schema.js";
export {
  createLouiseMiddleware,
  type LouiseMiddlewareConfig,
  type LouiseMiddlewareRateLimit,
} from "./middleware.js";
