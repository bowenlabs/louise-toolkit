---
"louise-toolkit": minor
---

Every editor control a finger taps is at least 44 px (#543). On a phone or tablet the node toolbar's buttons were 26 px, and icon buttons, extra-small buttons, and History stopped at 36 px, with delete right beside move, so a miss was a destructive miss.

- Under `pointer: coarse`, the node toolbar's buttons are 44 by 44 px, and icon buttons, the formatting toolbar, extra-small buttons, History, and inputs get a 44 px minimum. The toolbar's rule ships with the toolbar's own stylesheet, so it applies wherever the toolbar mounts.
- Delete sits 8 px from its neighbors on the node toolbar, on every pointer.

What to know when you upgrade: on touch devices the node toolbar is wider and taller, so it covers a little more of the node it floats over.
