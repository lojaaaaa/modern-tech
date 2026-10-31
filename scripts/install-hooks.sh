#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."
git config core.hooksPath .githooks
printf 'Git hooks installed.\n'
