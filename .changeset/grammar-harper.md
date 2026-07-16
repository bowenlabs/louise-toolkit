---
"louise-toolkit": minor
---

Add an opt-in spelling **and grammar** checker to the rich-text editor (#110), powered by [Harper](https://writewithharper.com) — Automattic's Rust→WASM checker — running **entirely on-device in a Web Worker**. Issues are underlined inline; clicking one opens a popover to apply a suggestion.

Pivoted from the issue's original self-hosted-LanguageTool design: Harper needs no service to deploy or provision, and the text **never leaves the browser** (a stronger privacy story than a self-hosted checker), while adding a second Rust/WASM module after the resvg OG renderer (#85).

Enable it per surface — off by default:

```ts
mountLouise({ /* … */, grammar: true });        // inline rich-text fields
// or on the component:  <RichText grammar />    //  and mountRichText(el, onChange, doc, { grammar: true })
```

`harper.js` is an **optional peer dependency**, loaded via dynamic `import()` only when `grammar` is enabled — so its multi-MB WASM never ships to sites that don't use it (the `binaryInlined` build also avoids a separate `.wasm` fetch). Scope: rich-text prose fields, English only for now (Harper's current limit). Multiline plain-text fields and other languages are follow-ups.
