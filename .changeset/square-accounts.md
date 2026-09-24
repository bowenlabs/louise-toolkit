---
"louise-toolkit": patch
---

commerce/square: cards on file, `updateCustomer`, the loyalty program, an application-id check, and a typed `SquareApiError` (#461)

Adds the Square calls a site was making around the toolkit with its own fetch (and
without the toolkit's retries):

- **`listCards(config, { customerId, includeDisabled? })`** follows the cursor.
- **`disableCard(config, cardId, { customerId })`** removes a card **only** if it's on
  file for that customer, and returns `false` otherwise. A guessed card id can't remove
  someone else's.
- **`updateCustomer(config, id, fields)`** is sparse: only the fields you pass are sent,
  and `null` clears one. `ensureCustomer` also takes `phoneNumber` now, applied when it
  creates.
- **`retrieveLoyaltyProgram(config)`** returns earn rules, reward tiers (cheapest first)
  and terminology, or `null` when the seller has no program. The program is returned as
  Square has it, so check `status` before advertising it. No terminology is invented.
- **`squareApplicationIdEnvironment(appId)`** returns `"sandbox"` / `"production"` /
  `null` from the id's format, to catch a placeholder or a wrong-environment id before
  the payment SDK fails.

**`SquareApiError`**: every non-2xx answer now throws this `Error` subclass, with
`status` and Square's `code`. **The message is unchanged**, so existing
`catch`/message checks behave as before. You can now check `err.status === 404`.

`SquareCard` gains optional `customerId` and `enabled`, which `createCard` now fills in
too.
