---
"louise-toolkit": patch
---

**A rate rule keeps every request it matched before 0.43.0.** In 0.43.0, `matchRateRule` tested each rule against the path as given and its `normalizeRatePath` form before it moved to the next rule. So an earlier rule for the canonical path could take a spelling that a later rule was written for: with a rule for `/a` ahead of a rule for `/a/`, a request to `/a/` spent the first rule's budget.

`matchRateRule` now makes two passes over the rules, each in order. The first tests every rule against the path as given, as it did before 0.43.0. Only when no rule matches does the second pass test every rule against the normalized path. The slashed and encoded spellings of a path that 0.43.0 started limiting, such as `/api/checkout/` and `/api//checkout/`, still count against the rule for `/api/checkout`, because the bucket is keyed by the rule's name.

You don't need to change anything. If you merged rules for one endpoint after reading the 0.43.0 notes, they still work. The one upgrade edge from 0.43.0 remains: a request that matched no rule before, such as a POST to a slashed URL, can now get a 429.
