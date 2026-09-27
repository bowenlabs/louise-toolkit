// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// The SEO length limits, in one place. The page head, `metaDescription()`, the
// AI `suggestSeo` helper, and the Pages panel's character counts all read
// these, so a derived description, a suggested one, and the count an owner
// sees agree on where a search result cuts off.

/** Characters of a page title a search result shows before it truncates. */
export const SEO_TITLE_MAX = 60;

/** Characters of a meta description a search result shows before it truncates. */
export const SEO_DESCRIPTION_MAX = 155;
