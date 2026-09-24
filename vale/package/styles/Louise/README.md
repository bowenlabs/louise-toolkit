# Louise house style for Vale

This style sits on top of the Google developer documentation style guide. It
adds only what Google's rules can't know about this stack. [ADR
0013](../../../../docs/adr/0013-google-style-everywhere.md) records the decision.
The style ships inside the house Vale package, `vale/package/`, which every
Bowen Labs repository consumes.

| Rule           | What it checks                                                                                                   |
| -------------- | ---------------------------------------------------------------------------------------------------------------- |
| `Louise.Names` | The stack's product and tool names, spelled the way their owners spell them (`daisyUI`, `GitHub`, `TypeScript`). |

The vocabulary in `../config/vocabularies/Louise/accept.txt` lists the names
that aren't dictionary words, so no rule flags them as misspellings or wrong
case.

Keep the set small. A rule belongs here only when the Google style can't express
it, and every rule carries a comment that explains why it exists, the same
convention as the ast-grep rules in `.ast-grep/rules/`.
