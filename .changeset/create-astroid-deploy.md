---
"create-astroid": minor
---

Scaffold the deploy paths (#104). The generated README now leads with two
low-friction options — a **Deploy to Cloudflare** button (zero-CLI: Cloudflare
clones the repo, provisions the bindings declared in `wrangler.jsonc`, and deploys)
and **`astroid deploy`** (one command: provision + migrate + secrets + deploy) —
with the by-hand `wrangler` steps kept as the fallback.
