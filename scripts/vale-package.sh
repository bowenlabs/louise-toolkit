#!/bin/sh
# Builds Louise.zip, the house Vale package, from vale/package/ (ADR 0013).
# The layout is Vale's "complete package": a top-level Louise/ folder holding
# the shared .vale.ini and a styles/ folder with the Louise style and its
# vocabulary. Other repositories name the zip in their .vale.ini:
#
#   Packages = Google, https://github.com/bowenlabs/louise-toolkit/releases/download/vale-v1.0.0/Louise.zip
#
# Usage: sh scripts/vale-package.sh [out-dir]   (default: dist-vale)
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
out=${1:-"$root/dist-vale"}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

mkdir -p "$work/Louise" "$out"
cp -R "$root/vale/package/." "$work/Louise/"
rm -f "$out/Louise.zip"
(cd "$work" && zip -qr "$out/Louise.zip" Louise)
echo "$out/Louise.zip"
