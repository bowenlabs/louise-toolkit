---
"louise-toolkit": minor
---

AI failures say why (ADR 0022 § 8, as amended):

- **`classifyAiError`** (`louise-toolkit/ai`) sorts a thrown Workers AI error into an `AiFailureReason`: `model-retired`, `rate-limited`, `unavailable`, or `error`, from Workers AI's documented codes and messages.
- **`runAi` names its degrade for the reason.** A thrown error is reported as `ai.run.<reason>`, such as `ai.run.model-retired`, instead of `ai.run`, so a retired model is its own incident. A search for `ai.run` still finds them all. An unusable reply is reported as the new `ai.invalid-output` degrade.
- **`generateAltText`, `rewriteText`, and `suggestSeo` take `onFailure`,** called with the reason when they return `null`, adding `invalid-output` and `truncated` to the list. They still return `null` and never throw.
- **`aiRoute`'s `502` bodies carry `reason`,** and the editor tells an editor to try again later when AI is busy, or to select less when a rewrite came back cut off.

If you filter logs or an `onDegraded` listener on the exact name `ai.run`, match the `ai.run.` prefix instead.
