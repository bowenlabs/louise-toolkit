// Copyright (c) 2026 BowenLabs. Louise (louisecms) is MIT licensed.
//
// `louisecms/astro` — optional Astro glue for Louise sites. Framework-specific
// helpers that import Astro's types live here (never in the framework-agnostic
// core), so `astro` is an OPTIONAL peer, pulled in only by sites that import
// this subpath. First inhabitant: the shared middleware factory.

export {
  createLouiseMiddleware,
  type LouiseMiddlewareConfig,
  type LouiseMiddlewareRateLimit,
} from "./middleware.js";
