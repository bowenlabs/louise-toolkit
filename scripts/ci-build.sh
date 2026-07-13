#!/usr/bin/env sh
# Pack the library, then build the site.
#
# In deploy/CI environments (e.g. Cloudflare Workers Builds) the Vite+ `vp`
# toolchain isn't preinstalled — it's a curl-installed global, not a pnpm
# dependency — so bootstrap it here the same way .github/workflows/ci.yml does.
# Local dev already has `vp` on PATH, so the install is skipped.
set -e

if ! command -v vp >/dev/null 2>&1; then
  echo "vp not found — installing Vite+…"
  curl -fsSL https://vite.plus | VP_NODE_MANAGER=no bash
  # The installer drops the `vp` binary in ~/.vite-plus/bin.
  export PATH="$HOME/.vite-plus/bin:$PATH"
fi

vp run "louise#pack"

# Build the standalone static docs app (workers/docs) and fold its output into
# the marketing Worker's static assets at public/_docs. Astro copies public/
# verbatim into the build, so the one Worker serves docs.louisetoolkit.com from
# /_docs (see workers/site/src/worker.ts). Must happen before the site build.
vp run "docs#build"
rm -rf workers/site/public/_docs
mkdir -p workers/site/public
cp -R workers/docs/dist workers/site/public/_docs

vp run "site#build"
