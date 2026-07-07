#!/usr/bin/env bash
# version-check.sh — check if the installed cli-dispatch version is older than the newest plugin cache version.

cli_dispatch_semver_is_older() {
  local installed="$1"
  local available="$2"

  local i1 i2 i3
  IFS='.' read -r i1 i2 i3 <<< "$installed" || true
  local a1 a2 a3
  IFS='.' read -r a1 a2 a3 <<< "$available" || true

  i1="${i1//[!0-9]/}"
  i2="${i2//[!0-9]/}"
  i3="${i3//[!0-9]/}"
  a1="${a1//[!0-9]/}"
  a2="${a2//[!0-9]/}"
  a3="${a3//[!0-9]/}"

  i1="${i1:-0}"
  i2="${i2:-0}"
  i3="${i3:-0}"
  a1="${a1:-0}"
  a2="${a2:-0}"
  a3="${a3:-0}"

  if [ "$i1" -lt "$a1" ]; then
    return 0
  elif [ "$i1" -gt "$a1" ]; then
    return 1
  fi

  if [ "$i2" -lt "$a2" ]; then
    return 0
  elif [ "$i2" -gt "$a2" ]; then
    return 1
  fi

  if [ "$i3" -lt "$a3" ]; then
    return 0
  fi

  return 1
}

cli_dispatch_warn_if_stale() {
  local installed_ver_file="$HOME/.config/cli-dispatch/.installed-version"
  if [ ! -f "$installed_ver_file" ]; then
    return 0
  fi

  local installed_ver
  installed_ver="$(cat "$installed_ver_file" 2>/dev/null)"
  if [ -z "$installed_ver" ]; then
    return 0
  fi

  local cache_dir="$HOME/.claude/plugins/cache/cli-dispatch/cli-dispatch"
  if [ ! -d "$cache_dir" ]; then
    return 0
  fi

  local newest=""
  local d
  for d in "$cache_dir"/*/; do
    [ -d "$d" ] || continue
    local ver
    ver="$(basename "$d")"
    case "$ver" in
      [0-9]*.[0-9]*.[0-9]*)
        if [ -z "$newest" ]; then
          newest="$ver"
        elif cli_dispatch_semver_is_older "$newest" "$ver"; then
          newest="$ver"
        fi
        ;;
    esac
  done

  if [ -n "$newest" ] && cli_dispatch_semver_is_older "$installed_ver" "$newest"; then
    echo "cli-dispatch: installed copy ($installed_ver) is older than the available plugin ($newest) — run /cli-dispatch:setup to re-sync ~/.local. Continuing with the installed copy." >&2
  fi

  return 0
}
