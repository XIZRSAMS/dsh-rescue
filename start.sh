#!/usr/bin/env sh
# dsh-rescue · static launcher (hand-written, no machine-specific path).
set -eu
RESCUE_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
: "${DSH_HOME:=$RESCUE_ROOT/runtime/home}"
: "${DSH_RESCUE_PROFILE:=rescue}"
: "${DSH_RESCUE_UI:=minimal}"
export DSH_HOME DSH_RESCUE_PROFILE DSH_RESCUE_UI
exec node "$RESCUE_ROOT/scripts/entry.mjs" "$@"
