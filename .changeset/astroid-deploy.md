---
"astroidjs": minor
---

Implement `astroid deploy` (#104) — the one-command platform bring-up. It reads the
generated `wrangler.jsonc`, and for every binding still holding a placeholder id it
provisions the resource (D1/R2/KV) via the project's own `wrangler`, patches the
discovered id back into `wrangler.jsonc`, applies migrations, prompts for
`SESSION_SECRET`, and deploys.

Plan-first + safe: it prints the exact commands it will run; `--dry-run` stops
there, and the irreversible steps only proceed on an interactive `y` (or `--yes`) —
non-interactively it refuses unless `--yes` is passed. `--local` targets the local
D1 for migrations. Replaces the previous "coming soon" stub.
