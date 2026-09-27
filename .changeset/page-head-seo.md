---
"louise-toolkit": minor
---

A new subpath, `louise-toolkit/seo`, turns a page row and the site settings into head tags (#582). Settings has always stored a meta description, a default share image, a favicon, and **Hide from search engines**, but nothing read them into a page, so an owner who hid the site from search engines was still indexed. `pageHead(input)` decides the title (through your title template), the description (SEO description, then the body's text, then the site default, never `content=""`), `noindex` (the page's or the site's), a canonical URL with the query string dropped except the parameters you keep, Open Graph and Twitter tags, and the favicon. `renderHeadTags(head)` prints them with every value escaped.

The share image follows one order everywhere, `shareImageSource`: the page's own image, then the site's generated card, then the site-wide default. The Pages panel's share preview now uses it, so it shows the default image when your site renders no cards; pass `ogCard: false` in the Settings config to say so. The panel's SEO title and description fields now count characters against the limits search results cut at.

Two behavior changes to check when you upgrade:

- `metaDescription()` clamps at 155 characters by default, not 160, so a derived description and an AI-suggested one agree. Pass `{ maxLength: 160 }` to keep the old length. `SEO_TITLE_MAX` and `SEO_DESCRIPTION_MAX` now live in `louise-toolkit/seo`; `louise-toolkit/ai` still exports them.
- The Pages panel reads `/api/louise/settings` to find the default share image. A site without that route shows the generated card as before.
