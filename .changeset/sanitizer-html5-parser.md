---
"louise-toolkit": patch
---

Sanitizer hardening: `sanitizeRichHtml` and `sanitizeModelHtml` in `louise-toolkit/security` now parse with [parse5](https://github.com/inikulin/parse5), an implementation of the WHATWG HTML parser, in place of ultrahtml. The sanitizers read markup the way a browser does, write new HTML from the parsed tree with every text node and attribute value escaped, and never throw, whatever the input. Before, some malformed markup could reach the output in a form a browser would read differently, and a stray closing tag could throw during render.

The public API, the allowlists, `mediaBase`, and the URL and style checks stay the same, so there's no code to change. The toolkit's save paths sanitize on write, so every save after you deploy gets the fix. HTML stored before then went through the old sanitizer: if your site also sanitizes rich text on render, as the security reference recommends, the next render covers it; if it doesn't, start sanitizing on render, or run stored rich text through `sanitizeRichHtml` once.

Output for content the editor wrote is the same. Hand-written or pasted HTML can come back different in ways that render the same, or better:

- **Character references:** apart from `&amp;`, `&lt;`, `&gt;`, `&nbsp;`, and `&quot;` inside an attribute, the sanitizers write the character a reference stands for. `&mdash;` becomes `—` and `&#39;` becomes `'`.
- **Attribute values:** `<` and `>` inside a value come back as `&lt;` and `&gt;`. Before, the old sanitizer cut an `alt` text short at its first `>`.
- **Line endings:** `\r\n` becomes `\n`.
- **Comments** go, as the old sanitizer meant them to and didn't.
- **Uppercase tags,** such as `<P>`, survive as their lowercase allowed tag rather than disappearing.
- **Malformed markup** gets the repair a browser gives it, so a misnested or unclosed tag can close in a different place than before.
- **Deep nesting:** markup nested more than 256 elements deep comes back as escaped text rather than HTML. Rich text never nests that deep, and the cap keeps a crafted payload from costing quadratic parse time.

The build bundles parse5, as it bundled ultrahtml, so the package still has no runtime dependencies. The `louise-toolkit/security`, `louise-toolkit/editor`, and `louise-toolkit/mcp` entries grow by about 150 KB minified, or 40 KB minified and gzipped, in the server bundle only. The browser client doesn't import the sanitizers.
