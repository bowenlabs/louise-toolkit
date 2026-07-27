#!/usr/bin/env bash
# Shared helpers for the clean-room scaffold smoke tests.
#
# The clean room is the point. Running a scaffold in-tree resolves every import
# through the workspace's own node_modules, so a package that forgets to DECLARE
# a dependency still works — the workspace has it hoisted anyway. That blind spot
# shipped a broken `create-astroid` to the registry once: astroidjs reaches
# drizzle-orm through `louise-toolkit/content`, but drizzle-orm is an *optional*
# peer of louise-toolkit, so it was never installed for real users and the CLI
# died before writing a file. In-tree it passed.
#
# Sourced, not executed. Callers set -euo pipefail themselves.

# Absolute path to a directory holding the three packed tarballs, and the
# directory to build the clean room in. Both are caller-supplied so the
# storefront and portfolio jobs can run on separate runners.
clean_room_init() {
  local pack="$1" room="$2"

  rm -rf "$room"
  mkdir -p "$room"
  cd "$room"

  # A bare manifest, written directly: `pnpm init` emits a caret
  # packageManager range that corepack then refuses to run.
  echo '{ "name": "clean-room", "private": true }' > package.json

  # Pin every astroidjs / louise-toolkit resolution — the scaffold's own
  # install inherits this, so it builds against THESE tarballs too.
  #
  # Installing the tarballs side by side is NOT enough: pnpm's node_modules is
  # isolated, so create-astroid resolves its own copy — from the REGISTRY — and
  # the run silently tests the published packages. (npm only got this right by
  # accident, via hoisting.)
  {
    echo "overrides:"
    clean_room_tarball_pins "$pack"
  } > pnpm-workspace.yaml

  corepack pnpm add "$pack"/*.tgz
}

# The two `overrides:` entries pointing at the packed tarballs, indented as
# children of an existing `overrides:` key.
clean_room_tarball_pins() {
  local pack="$1"
  printf '  astroidjs: "file:%s"\n  louise-toolkit: "file:%s"\n' \
    "$(ls "$pack"/astroidjs-*.tgz)" \
    "$(ls "$pack"/louise-toolkit-*.tgz)"
}

# Install + type-check + build a scaffold the way a user would. This is the only
# thing that resolves the template's imports, so it's the only thing that can
# catch a dependency the template forgot to declare.
clean_room_build_scaffold() {
  local pack="$1" dir="$2"
  cd "$dir"

  # Keep the scaffold's OWN pnpm-workspace.yaml — do not replace it. It carries
  # the `allowBuilds` approvals without which `pnpm install` fails outright
  # (ERR_PNPM_IGNORED_BUILDS), which is the first command the README tells a
  # user to run. This step used to overwrite that file and append its own
  # approvals, which meant CI proved the scaffold installs *for CI* and never
  # for a user — it shipped a scaffold whose first documented command errored.
  #
  # `overrides:` is the LAST key in that file, so appending two indented lines
  # extends it and pins astroidjs/louise-toolkit to THESE tarballs.
  clean_room_tarball_pins "$pack" >> pnpm-workspace.yaml

  corepack pnpm install
  corepack pnpm exec astro check
  corepack pnpm exec astro build
}
