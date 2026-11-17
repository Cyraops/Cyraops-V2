#!/usr/bin/env bash
# Point this clone at the repository's git hooks.
# Run once per clone: ./scripts/install-git-hooks.sh
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
chmod +x scripts/git-hooks/pre-commit scripts/git-hooks/pre-push
git config --local core.hooksPath scripts/git-hooks
echo "✓ hooks installed (core.hooksPath = $(git config --local core.hooksPath))"
echo "  pre-commit: blocks secrets and files over 2 MB"
echo "  pre-push:   runs typecheck before dev / release / production"
