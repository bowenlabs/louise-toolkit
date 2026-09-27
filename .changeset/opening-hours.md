---
"louise-toolkit": minor
---

Opening hours and pickup times in `louise-toolkit/dates` (#714): `parseOpeningHours`, `openingState`, `pickupSlots`, `pickupProblem`, and `openingHoursJsonLd`. They read editor-written hours (`7a — 7p`, `Closed`) and answer on the shop's clock, so a page and its server offer and accept the same pickup times, and the structured-data hours come from the same parser.

The time zone, prep time, lead, slot step, horizon, slot count, grace past closing, and label locale are all arguments, with no defaults. So is what an unreadable row means (`whenUnknown`). An overnight range such as `8p — 2a` reads as `null`. Nothing changes for existing code.
