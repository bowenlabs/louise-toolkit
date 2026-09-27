---
"louise-toolkit": minor
---

An AI rewrite shows its result before it replaces anything, and keeps a selection's paragraphs (#544, #551).

- **Preview:** the rewrite appears under the original with **Replace** and **Discard**, and nothing changes until Replace. A rewrite used to replace the selection at once.
- **Failures say so:** "Couldn't rewrite this right now. Your text hasn't changed." A `503` says "AI rewrite isn't set up for this site." once, then retires the control when the menu closes, instead of vanishing without a word.
- **Paragraphs:** a selection across several blocks goes to the model as paragraphs separated by blank lines, and each answer paragraph goes back into its own block, so headings and list items keep their type. A rewrite used to merge them into one. When the answer's paragraphs don't line up, Replace is off and the menu says why. `rewriteText` asks the model to keep the paragraphs only when the text has several; a single paragraph's prompt is unchanged.
- **Links:** a selection holding a link can't be rewritten, and the menu says why, since the model could change where the link goes.
- The preview notes when bold, italics, or other formatting in the selection won't carry over.
