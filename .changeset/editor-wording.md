---
"louise-toolkit": patch
---

The inline edit bar now says "Couldn't publish. The live page hasn't changed." when a publish fails, followed by the server's reason when it gives one, such as a failed field check. Before, it said "Couldn't save," which described the wrong action. The status keeps its error styling, so a site that styles `.louise-status[data-status="error"]` needs no change.

When a media delete comes back as in use but doesn't say what uses the file, the second prompt now says the file is still in use instead of "still used by 0 items" (#704).
