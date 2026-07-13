---
title: Inline editing
description: Field markers, the client, the edit bar, and the save contract.
sidebar:
  order: 3
---

Inline editing is the heart of Louise: in edit mode, each editable region on the
page becomes editable _in place_, and only the fields that actually change are
saved.

## Field markers

An editable region carries a `data-louise-field` marker whose value is
`"<collection>:<key>:<field>"`:

```html
<h1 data-louise-field="settings:1:heroHeadline">…</h1>
<div data-louise-field="settings:1:heroIntro" data-louise-type="richtext">…</div>
```

- **Plain text** (no `data-louise-type`) becomes a single-line
  `contenteditable="plaintext-only"` region.
- **Rich text** (`data-louise-type="richtext"`) mounts the ProseKit editor — see
  [Rich text](/guide/rich-text/).

List items are patched by index with a dotted field: `aboutParagraphs.2`.

## Mounting the client

```ts
import { mountLouise } from "louise/client";

// Safe to call on every page: if there are no markers (the page wasn't rendered
// in edit mode), mountLouise does nothing — so you can lazy-import it.
mountLouise();
```

`mountLouise` finds the markers, attaches the right editor to each, and mounts
the **edit bar** for the page: a live-status line, **Settings** (dispatches a
`louise:open-settings` event), and **Done** (leaves edit mode). Edits **auto-save**
by default (see below), so there is no manual Save button unless you opt out.

The client also re-exports the pieces a host app's own panels reuse, so the
Settings renders the same editor and icon set as inline editing:

```ts
import { RichText, mountRichText, Icon } from "louise/client";
```

See the [client reference](/reference/client/) for the full export list.

## The save contract

When a save runs, the client sends **one `PATCH` per changed field** to your save
endpoint (e.g. `POST /api/louise/save`). Unchanged fields are never sent.

Your endpoint owns two responsibilities Louise cannot do for you:

1. **Authorize the write** from the session — _not_ from the page's edit mode.
2. **Allowlist every writable field.** A forged request must not reach a column
   you didn't list.

```ts
// Sketch of a save endpoint.
const EDITABLE_SETTINGS = new Set(["heroHeadline", "heroIntro", "footerBlurb"]);
const RICH_FIELDS = new Set(["heroIntro"]); // sanitized as HTML

export async function POST({ request, locals, env }) {
  if (!locals.editor) return new Response("Forbidden", { status: 403 });
  const { field, value } = await request.json();
  if (!EDITABLE_SETTINGS.has(field)) return new Response("Unknown field", { status: 400 });
  const clean = RICH_FIELDS.has(field) ? sanitize(value) : String(value);
  // …persist `clean` to your D1 row via db(env.DB)…
  return new Response(null, { status: 204 });
}
```

## Auto-save

Edits persist **automatically**, on a short idle debounce — there is no Save
button to remember. It's on by default:

```ts
mountLouise();                          // auto-save on (800ms debounce)
mountLouise({ autoSave: { debounceMs: 1500 } }); // tune the delay
mountLouise({ autoSave: false });       // opt out → a manual Save button returns
```

- Auto-save reuses the **same save** as a manual click: a live field write, or a
  **draft** on a [versioned page](/guide/drafts/). It **never publishes** —
  Publish stays an explicit action.
- Pending edits are flushed when you tab out of a field, hide the tab, or navigate
  away (the save `fetch` uses `keepalive` so it survives the unload), and the
  browser warns if you try to leave with a save still in flight.
- The edit bar's status line reflects it live: _Saving…_ → _Saved_ (or _Draft
  saved_). A failed save keeps the field dirty and retries on your next edit.

On a page with no inline fields (a sections-only page), the [sections
dock](/guide/sections/) owns its own auto-save instead.

## Adding an inline-editable field

The pattern, generalised:

1. Add the field to your content type and give it a seed/default value.
2. Render it with the marker (plain or `data-louise-type="richtext"`).
3. Allowlist it in the save endpoint (and in your rich-field set if it's HTML).

That's the whole loop — no schema migration on the CMS side, because the schema
is yours.
