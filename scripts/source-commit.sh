#!/bin/sh
# Source identity for locally installed/Xcode-built diagnostic reports.
set -eu
source_commit=$(git rev-parse HEAD)
if ! git diff --quiet || ! git diff --cached --quiet; then
  source_commit="${source_commit}-dirty"
fi
printf '%s\n' "$source_commit"
