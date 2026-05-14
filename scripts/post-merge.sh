#!/bin/bash
set -e

# AGENTS.md pins pnpm to v9 (CI uses pnpm 9; pnpm 10/11 rewrite the lockfile
# in a way pnpm 9 rejects, breaking GitHub Pages deploys).
PNPM_VERSION="$(pnpm --version 2>/dev/null || echo none)"
case "$PNPM_VERSION" in
  9.*) ;;
  *)
    echo "post-merge: pnpm $PNPM_VERSION detected; installing pnpm@9 to keep lockfile compatible with CI"
    npm install -g pnpm@9 >/dev/null
    ;;
esac

pnpm install
