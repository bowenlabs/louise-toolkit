---
title: Glossary
description: One meaning for each word in the content model, and the word the editor shows an owner.
sidebar:
  order: 0
---

Each term here has one meaning across the code, the docs, and the tool
descriptions an agent reads. When a sentence could mean two things, it's using
a word from this page loosely; say which one. The **In the editor** column is
the word an owner sees today, where it differs or matters.

## Content

| Term              | Meaning                                                                                                                     | In the editor                   |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| **Collection**    | A kind of content with one schema and one table, declared with `defineCollection`: pages, products, posts.                  | The panel's name, such as Pages |
| **Document**      | One row of a collection. A collection's MCP tools call it a document too.                                                   | A page, a product               |
| **Field**         | One named value of a document, with a field type (`text`, `richText`, `image`, `array`, …).                                 | The field's label               |
| **Page**          | A document of the `pages` collection: a slug, a title, and the body or sections a visitor sees at that URL.                 | Page                            |
| **Site settings** | The one row of site-wide values (name, contact, share image), edited in the Settings panel. Not a collection.               | Settings                        |
| **Site fact**     | A fact about a site or its business (time zone, currency, locale, brand). Always a parameter, never a constant in the kit.  | —                               |
| **Shared value**  | A value stored once in site settings and shown in several places, such as the navigation. Its node path starts `settings.`. | The value's label               |

## Sections and blocks

| Term                                 | Meaning                                                                                                                                                                                                                                                                                      | In the editor                           |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| **Section**                          | One item of a page's `sections` array: a `_type` plus its field values, rendered by the site's own component for that type ([Sections](/guide/sections/)).                                                                                                                                   | The section type's label, such as Hero  |
| **Section type**                     | One entry of the site's **catalog** (`SectionCatalog`), described by a `SectionDef`: its label, icon, description, fields, layouts, and settings.                                                                                                                                            | The add picker's rows                   |
| **Block**                            | One item of a section's `blocks` array: a `_type` plus field values, described by a `BlockDef` in the **block catalog** (`BlockCatalog`, ADR 0005). Blocks are ordered within their section and don't nest. Unqualified, "block" means this.                                                 | The block type's label, such as Feature |
| **Builder block**                    | A ProseMirror node the **page builder** inserts inside one rich-text field (hero, columns, gallery), stored as that field's HTML. Described by a `BuilderBlockDef`. Turned on by the `builder` option or `data-louise-builder="1"` ([Builder](/guide/builder/)). Never call it just "block." | The slash menu and "+ Block"            |
| **Document node**                    | One node of a stored rich-text document, keyed by `type`, that `createBlockRegistry` maps to a renderer. The registry's API says "block"; in prose, say "document node."                                                                                                                     | —                                       |
| **Layout**                           | A named arrangement a section type offers (`layouts`). Louise stores only the chosen key; the site's component maps it to markup.                                                                                                                                                            | Layout & settings                       |
| **Settings** (of a section or block) | Values that change how a section or block looks rather than what it says (background, spacing), edited in the inspector. Not site settings.                                                                                                                                                  | Layout & settings                       |

## The editor

| Term                | Meaning                                                                                                                                                                                                                                   | In the editor            |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| **Node**            | An element the render marks with `data-louise-node`, which the editor rings and gives a toolbar ([ADR 0010](https://github.com/bowenlabs/louise-toolkit/blob/main/docs/adr/0010-editable-node-model.md)). A section, a block, or a value. | The ring and its toolbar |
| **Path**            | A node's address in the content: `2` (a section), `2.blocks.0` (a block), `2.heading` (a value). The marker holds only the path.                                                                                                          | —                        |
| **Value node**      | A node for one field. Its toolbar has only the wrench, which opens that field.                                                                                                                                                            | The field's label        |
| **Inspector**       | The popover the wrench opens: layouts, settings, and the fields that aren't edited in place.                                                                                                                                              | Layout & settings        |
| **Edit mode**       | The state in which a signed-in owner's page loads with the editor on. Set by `?louise`.                                                                                                                                                   | —                        |
| **Edit bar**        | The bar along the page in edit mode: status, **Publish**, **Settings**, and **Sign out**. ADR 0019 proposes splitting it into an owner bar and an editing bar.                                                                            | —                        |
| **Settings drawer** | The panel set **Settings** opens: Home, Pages, Media, Settings, and the site's collections.                                                                                                                                               | Settings                 |
| **History drawer**  | The list of a page's versions. Nothing in it publishes ([Drafts](/guide/drafts/)).                                                                                                                                                        | Version history          |

## Drafts and publishing

These follow [ADR 0021](https://github.com/bowenlabs/louise-toolkit/blob/main/docs/adr/0021-page-lifecycle.md); the [drafts guide](/guide/drafts/#the-model) has the state tables.

| Term                | Meaning                                                                                                                                                               | In the editor                |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| **Live**            | A visitor can see the page: its row's `status` is `published`. "Published" and "live" name this and nothing else.                                                     | Live                         |
| **Hidden**          | A page that was live and was unpublished. Its content and pointer stay.                                                                                               | Hidden                       |
| **New**             | A page that has never been published.                                                                                                                                 | Not published                |
| **Publish**         | Put the newest pending draft onto the page and make it live; with nothing pending, show a hidden page again.                                                          | Publish                      |
| **Unpublish**       | Hide a live page.                                                                                                                                                     | Unpublish                    |
| **Version**         | One saved snapshot of a document in `${slug}_versions`. Every draft save adds one.                                                                                    | A row of Version history     |
| **Draft**           | A version saved as work in progress. Its state is pending, scheduled, or superseded.                                                                                  | Draft                        |
| **Pending**         | A draft newer than anything ever promoted: the work a save builds on and **Publish** puts live.                                                                       | Draft                        |
| **Scheduled**       | A pending draft with a `scheduledAt` time, which `publishScheduled` promotes once it's due.                                                                           | Scheduled                    |
| **Superseded**      | A draft at or below the high-water mark. A later publish moved past it, so it's never resumed or published as current work.                                           | Superseded                   |
| **Current version** | The version whose snapshot the page row holds, whether the page is live or hidden. The pointer names it.                                                              | Live, or Hidden              |
| **Earlier version** | A version that was promoted once and isn't the current one.                                                                                                           | Earlier                      |
| **Promote**         | Copy a version's snapshot onto the page row. A version's stored `status` of `published` records only that it was promoted once; it never means "live."                | —                            |
| **Pointer**         | The page row's `published_version_id`: which version the row holds. Publish moves it; nothing clears it.                                                              | —                            |
| **High-water mark** | The highest version ID ever promoted for a page. What makes a draft superseded.                                                                                       | —                            |
| **Auto-save**       | Saving a draft on an idle debounce, with no button. It never publishes.                                                                                               | Draft saved                  |
| **Draft buffer**    | The optional KV copy of the newest auto-save, ahead of the last write to D1 (`bufferKv`).                                                                             | —                            |
| **Revision**        | A hash of one field's stored value. A save sends the revisions it started from, so a change someone else made in the meantime is a conflict rather than an overwrite. | Someone else changed this    |
| **Soft lock**       | A field another editor has focused. A save that would change it is refused, and nothing is written, until they move on.                                               | Someone else is editing this |

## Media

| Term         | Meaning                                                                                                                 | In the editor    |
| ------------ | ----------------------------------------------------------------------------------------------------------------------- | ---------------- |
| **Media**    | The site's library of uploaded files, stored in R2. An image field picks its file from here.                            | Media            |
| **Alt text** | An image's text alternative, in one of three states: not written yet (`NULL`), **decorative** (`""`), or a description. | Decorative image |

## People

| Term          | Meaning                                                                                                                                                                                       |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Developer** | Someone who builds a site with the toolkit ([ADR 0015](https://github.com/bowenlabs/louise-toolkit/blob/main/docs/adr/0015-two-audiences-one-product.md)). The reference pages speak to them. |
| **Owner**     | Someone who runs a site built with the toolkit and edits it through the editor. Owner-facing copy uses plain business words and none of the terms marked "—" above.                           |
| **Editor**    | In code, a signed-in session that may edit (`EditorSession`, `resolveEditor`). In prose for owners, say "you."                                                                                |
