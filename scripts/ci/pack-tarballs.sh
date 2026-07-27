#!/usr/bin/env bash
# Pack the three published packages the way `pnpm publish` would, into $1.
#
# Two details this depends on, neither incidental:
#   - `pnpm pack` (not `npm pack`) — only pnpm rewrites `workspace:*` into the
#     real version, which is what makes the tarball match a published one.
#   - Packing runs each package's `prepublishOnly`, so the artifact is built the
#     same way `pnpm publish` would build it.
set -euo pipefail

DEST="${1:?usage: pack-tarballs.sh <dest-dir>}"

rm -rf "$DEST"
mkdir -p "$DEST"

for pkg in louise astroid create-astroid; do
  (cd "packages/$pkg" && corepack pnpm pack --pack-destination "$DEST")
done

ls -1 "$DEST"
