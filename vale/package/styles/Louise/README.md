# Louise house style for Vale

This style sits on top of the Google developer documentation style guide. It
adds only what Google's rules can't know about this stack. [ADR
0013](../../../../docs/adr/0013-google-style-everywhere.md) records the decision.
The style ships inside the house Vale package, `vale/package/`, which every
Bowen Labs repository consumes.

| Rule           | What it checks                                                                                                   |
| -------------- | ---------------------------------------------------------------------------------------------------------------- |
| `Louise.Names` | The stack's product and tool names, spelled the way their owners spell them (`daisyUI`, `GitHub`, `TypeScript`). |
| `Louise.Emoji` | No emoji anywhere: icons come from Phosphor, and prose uses words. Run by the lint runner, below, not by Vale.   |

The vocabulary in `../config/vocabularies/Louise/accept.txt` lists the names
that aren't dictionary words, so no rule flags them as misspellings or wrong
case.

Keep the set small. A rule belongs here only when the Google style can't express
it, and every rule carries a comment that explains why it exists, the same
convention as the ast-grep rules in `.ast-grep/rules/`.

## The lint runner

`lint-docs.mjs` ships with the style, so `vale sync` puts it at
`.vale/Louise/lint-docs.mjs` in every repository. A repository's `lint:docs` script
runs it:

```sh
node .vale/Louise/lint-docs.mjs [--exclude=<regex>]... [--strings=<regex>]... [--baseline=<file> [--update]]
```

It lints Markdown, comments in TypeScript and JavaScript, and `.astro` files
(the template as HTML, the code as TypeScript), with `.mjs` linted as
JavaScript because Vale 3.17 can't parse it. Use `--exclude` for files a tool
generates, whose text belongs to the generator.

With `--strings=<regex>`, it also lints user-facing strings in the TypeScript
files the pattern matches: error messages from `new Louise…Error(…)` and
`new Astroid…Error(…)`, `error` and `message` in a `json(…)` body, JSX text, and
the JSX attributes people read (`title`, `aria-label`, `placeholder`, `alt`,
`label`). `copy-extract.mjs` defines the list. Findings show up as
`path/to/file.tsx (strings)`. This needs the `typescript` package, resolved from
the repository being linted.

It also reports `Louise.SpacedDash`, a spaced dash in Markdown that Vale's
`Google.EmDash` can't see: one that bold text or inline code follows, where the
dash and the markup fall in different text nodes. It reads the raw Markdown and
skips front matter, code, and table cells that hold only a dash.

And it reports `Louise.Emoji` for any emoji in a linted file's raw text, code
included, because the emoji a person sees is usually a string literal: a
badge's label, a button's text. The stack draws its icons from
[Phosphor](https://phosphoricons.com) instead. CHANGELOG.md is exempt, because
it records what has already shipped. A test that needs an emoji as input writes
it as an escape, `"\u{1F600}"`.
