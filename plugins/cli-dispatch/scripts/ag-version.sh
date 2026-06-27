#!/usr/bin/env bash
# ag-version — print the installed Antigravity (agy) CLI version.
# Thin wrapper over `agy --version`; errors clearly if agy is not on PATH.
set -euo pipefail

usage() { echo 'usage: ag-version [-h|--help]' >&2; }

case "${1:-}" in
  -h|--help) usage; exit 0;;
  '') ;;
  *) echo "ag-version: unexpected argument: $1" >&2; usage; exit 1;;
esac

if ! command -v agy >/dev/null 2>&1; then
  echo "ag-version: agy not found on PATH (run /cli-dispatch:ds-setup, Antigravity backend)." >&2
  exit 1
fi

exec agy --version
