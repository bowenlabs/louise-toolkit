---
"louise-toolkit": patch
---

`parseWeekday(day)` in `louise-toolkit/dates` returns an opening-hours row's `day` as a weekday number, from 0 for Sunday to 6 for Saturday, or `null` when it names no weekday. It's the matcher `openingState`, `pickupSlots`, `pickupProblem`, and `openingHoursJsonLd` already use: a full English weekday name or its first three letters in any case, or an integer from 0 to 6.

Use it when you word your own hours summary from the same rows, so the summary and `openingState` agree on which row is which day. If your site copied this matcher, replace the copy with the import. Nothing changes for existing code.
