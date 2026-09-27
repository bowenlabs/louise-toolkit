---
"louise-toolkit": minor
---

The editor chrome goes dark with the system setting (#603, ADR 0019 §3).

With every rule reading a role token since the last release, dark mode is a second set of role values. The edit bar, the node toolbar, the Settings drawer, the studio, and the pickers switch when the owner's system is in dark mode. The surface is `#0e141b`, text is `#e6edf3`, and the brand fills keep their hue and take dark ink on top, as the `louise-dark` theme does. Every text pair in both schemes clears 4.5:1, and the ring clears 3:1; the contrast test checks each one.

What to know when you upgrade:

- An owner whose system is in dark mode now sees a dark editor over the site, whatever the site's own colors are.
- To pin a scheme, set `data-louise-scheme="light"` or `data-louise-scheme="dark"` on the root element. A site with its own theme switch can set it to match.
- The chrome doesn't read the site's daisyUI theme, so choosing `louise-dark` for a site doesn't switch the chrome by itself. The scope note in `louise.css` says so.
