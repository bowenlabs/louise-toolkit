---
"louisecms": patch
---

Fix the rich-text editor failing to render (blank field, no editor).

`ToolbarDock`'s caret memo (via `useEditorDerivedValue`) is evaluated eagerly by
Solid during render — before `RichText`'s `onMount` calls `editor.mount(host)`.
Reading `editor.view` before then threw "Editor is not mounted", and that
synchronous throw aborted the entire `render()`, leaving the field cleared with
no editor and no visible error. The memo now bails while `!editor.mounted` (it
re-runs once mounted). Also surfaces future editor-boot failures: `mountLouise`
wraps each `mountRichText` in try/catch, and the site editor bootstrap adds a
`.catch`, so a swallowed throw no longer silently blanks the field.
