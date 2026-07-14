---
"louise-toolkit": minor
---

commerce/square: add write wrappers for the "site is the source of truth" direction (pushing D1-owned data up to Square).

- `upsertCatalogItem` — create/update a catalog ITEM with fixed-price ITEM_VARIATIONs (item + variation `version` pass-through for updates); returns the normalized item with the ids Square assigned plus a temp→real `idMappings`.
- `SquareCatalogItem` / `SquareVariation` now carry the object `version` (from `mapCatalogItem` / the reads), so a retrieve→edit→`upsertCatalogItem` update round-trips the versions Square requires.
- Team API: `createTeamMember`, `updateTeamMember`, `retrieveTeamMember`, `searchTeamMembers` (+ `SquareTeamMember` / `TeamMemberInput`).
- Labor / timecards API: `createTimecard`, `updateTimecard`, `retrieveTimecard`, `searchTimecards` (+ `SquareTimecard` / `TimecardWage`). Requires Square-Version ≥ 2025-05-21, which the pinned `SQUARE_VERSION` satisfies.
- Invoices API: `createInvoice` (draft, against an OPEN order, with a DEPOSIT/BALANCE/INSTALLMENT payment schedule), `publishInvoice` (yields the hosted `publicUrl` under SHARE_MANUALLY), `retrieveInvoice` (+ `SquareInvoice` / `SquareInvoicePaymentRequest` / `InvoicePaymentRequestInput`) — for deposit+balance billing where one invoice tracks both installments.
- `createOrder` now accepts ad-hoc line items (`{ name, priceCents, quantity }`) so charges with no catalog object (e.g. a manufacturing deposit) can still mirror as itemized Square orders. `SquareOrderLineItem` is widened to a union (catalog-ref | ad-hoc); constructing catalog-ref line items is unchanged.
