# create-astroid

Scaffold a new **Astroid** site — an editable, multi-editor Astro app on
Cloudflare Workers — in one command.

```sh
pnpm create astroid my-site
```

> **Status: pre-1.0, experimental.** The scaffold's output will change between
> minor versions.

## What you get

A working floor, not a blank page:

- `astroid.config.ts` — the one typed config the rest is generated from
- The generated trio — `src/schema.ts`, `src/worker.ts`, `src/middleware.ts`
  (Drizzle schema, editor routes in collision-free order, the shared middleware)
- `wrangler.jsonc` with every binding stubbed and clearly marked for you to fill
- A baseline Astro app with an **inline-editable home page**, magic-link editor
  sign-in, and the Louise editor wired up
- Migrations + a `seed:editors` script to create the first editor

## Options

Anything you don't pass is prompted for. In a non-TTY every prompt takes its
default, so the command is CI-safe. The target directory must be empty.

```
pnpm create astroid [directory] [options]

  --dir <path>          Target directory (also the first positional)
  --name <name>         Brand / site name
  --key <slug>          Project key (slug); defaults to a slug of --name
  --archetype <type>    marketing | storefront | wholesale | portfolio
  --color <hex>         Brand color
  --host <domain>       Primary domain, e.g. example.com
  --commerce <provider> square | stripe | fourthwall — also adds the queue
                        consumer, webhook receiver, and cron safety net
  --map                 Self-hosted PMTiles/MapLibre location map
  --pwa                 Installable PWA: a scoped service worker that never
                        caches /api/* or the editor, plus a manifest
  --portal              Customer/member portal: a second, isolated auth
                        instance plus role-gated routes
  --realtime            Live multi-editor editing: a per-page Durable Object
                        with presence, field sync, and a rich-text soft-lock
  -h, --help            Show help
  -v, --version         Show the version
```

## After scaffolding

```sh
cd my-site
pnpm install
pnpm exec wrangler d1 create <name>   # then paste the ids into wrangler.jsonc
pnpm doctor                           # validates config, bindings, generated files
pnpm dev
```

`pnpm doctor` flags any binding id you haven't filled in yet, plus generated
files that have drifted from the config.

## How the pieces relate

```
Astro        →  renderer / router / build
  Louise     →  unopinionated primitives + framework glue   (louise-toolkit)
    Astroid  →  opinions: theme, sections, config, scaffold  (astroidjs)
```

- [`astroidjs`](https://github.com/bowenlabs/louise-toolkit/tree/main/packages/astroid)
  — the meta-framework and the `astroid` CLI this scaffold writes a project for
- [`louise-toolkit`](https://github.com/bowenlabs/louise-toolkit/tree/main/packages/louise)
  — the underlying toolkit

## License

[MIT](https://github.com/bowenlabs/louise-toolkit/blob/main/LICENSE) © BowenLabs
