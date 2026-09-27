// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// `pageHead` from louise-toolkit/seo, with the origin and path filled in from
// Astro's request context. The adapter ships no `.astro` components, so a page
// prints the result itself: `<Fragment set:html={seoHead(Astro, { … })} />`.

import { type PageHeadInput, pageHead, renderHeadTags } from "louise-toolkit/seo";

/** The part of `Astro` (or an `APIContext`) that `seoHead` reads. */
export interface SeoHeadContext {
  /** The configured `site`, the canonical origin. */
  site?: URL | undefined;
  url: URL;
}

/** Everything `pageHead` takes except what the request supplies. */
export type SeoHeadInput = Omit<PageHeadInput, "origin" | "path"> &
  Partial<Pick<PageHeadInput, "origin">>;

/**
 * The page's head tags as HTML, from `pageHead` and `renderHeadTags`. The
 * origin is `input.origin`, then Astro's configured `site`, then the request's
 * own origin; set `site` in `astro.config` so a preview host or a proxy can't
 * leak into the canonical URL. The path is the request's.
 */
export function seoHead(context: SeoHeadContext, input: SeoHeadInput): string {
  const origin = input.origin ?? context.site?.origin ?? context.url.origin;
  return renderHeadTags(
    pageHead({ ...input, origin, path: `${context.url.pathname}${context.url.search}` }),
  );
}
