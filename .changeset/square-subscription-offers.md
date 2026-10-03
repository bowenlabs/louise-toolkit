---
"louise-toolkit": minor
---

`louise-toolkit/commerce/square` has pure helpers that turn the plans from `listSubscriptionPlans` into the ways to subscribe to one item, and a chosen plan variation into the `phases` that `createSubscription` takes:

- `subscriptionOffersFor(plans, item, locationId?, { labels }?)` returns a `SquareSubscriptionOffer` for each plan variation the item can be subscribed under. `item` is a `SquareSubscribableItem`, `{ itemId, categoryIds }`. A plan has to name the item, one of its categories, or every item, and when you pass `locationId`, both the plan and the variation have to be present there. Only a variation whose ongoing phase, the last one, prices `RELATIVE` is offered: Square bills it by copying an order template, which can carry a shipment and its shipping charge, while a `STATIC` variation raises an invoice only.
- `findSubscriptionOffer(plans, item, planVariationId, locationId?, { labels }?)` returns the one offer for a plan variation ID, or `null`. Use it to check an ID a client sent before you enroll.
- `templatePhases(variation, templateOrderId)` returns one `{ ordinal, orderTemplateId }` per `RELATIVE` phase, ready for `createSubscription`'s `phases`.
- `planCoversItem(plan, item)`, `ongoingPhase(variation)`, and `cadenceLabel(cadence, labels?)` are the pieces the two above use. `cadenceLabel` reads `EVERY_TWO_WEEKS` as "Every 2 weeks". Its table and its fallback for an unknown cadence are English. A site in another language passes `labels` (a `SquareCadenceLabels`): a map, keyed by Square's cadence name, replaces entries, and a function, called for every cadence, replaces the fallback too, returning `undefined` for a cadence it leaves to the built-in label.

Nothing existing changes. A site that wrote its own version of these can switch to them; rename its item's ID field to `itemId` on the way.
