---
"louise-toolkit": patch
---

`louise-toolkit/commerce/square` no longer guesses USD for an amount Square leaves out. A tender's `tipMoney`, an order's `netAmountDueMoney`, and a payment's `tipMoney` take the currency of the amount beside them, so a store that sells in another currency never sees a zero tip in USD next to its own totals.
