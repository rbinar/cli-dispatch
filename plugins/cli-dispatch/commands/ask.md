---
description: One-shot question or generation to a worker backend (no repo changes) — ds, ag, cx, oc or cp
argument-hint: <ds|ag|cx|oc|cp> "<prompt>" [agent flags, e.g. --effort high --model <m>]
allowed-tools: Bash
---

# Ask a worker: $ARGUMENTS

A one-shot prompt to one backend's `*-agent` CLI, for analysis or generation where the answer
is the output. It never touches the caller's repo: `ds` and `cx` run with `--read-only` (a real
read-only mode); `ag`, `oc` and `cp` have no write-deny, so they run in a throwaway directory.
Repo changes go through `/cli-dispatch:run` or the `cli-dispatch:runner` agent instead.

Run it as a **background task** (a worker can take minutes), then continue the session with
`/cli-dispatch:resume <id> <follow-up>`. Progress: `/cli-dispatch:watch <id>`.

```bash
# The user's text is pasted in before bash parses it, so it is kept in a quoted heredoc and split
# by a tokenizer that expands nothing. (`read`, not $(cat): bash 3.2 mis-parses a lone quote in $( ).)
IFS= read -r -d '' ARGS_RAW <<'CLI_DISPATCH_ARGS_EOF_9f2c' || true
$ARGUMENTS
CLI_DISPATCH_ARGS_EOF_9f2c
_AF="$(mktemp)"; printf '%s' "$ARGS_RAW" | node "${CLAUDE_PLUGIN_ROOT}/scripts/cli-dispatch-args.mjs" > "$_AF" || { rm -f "$_AF"; exit 2; }
set --; while IFS= read -r -d '' a; do set -- "$@" "$a"; done < "$_AF"; rm -f "$_AF"
BACKEND="${1:-}"; PROMPT="${2:-}"; shift 2 2>/dev/null || true
case "$BACKEND" in
  ds) AGENT=ds-agent; SAFE=(--read-only) ;;
  cx) AGENT=cx-agent; SAFE=(--read-only) ;;
  ag) AGENT=ag-agent; SAFE=(--cwd "$(mktemp -d)") ;;
  oc) AGENT=oc-agent; SAFE=(--cwd "$(mktemp -d)") ;;
  cp) AGENT=cp-agent; SAFE=(--cwd "$(mktemp -d)") ;;
  *)
    echo "usage: /cli-dispatch:ask <ds|ag|cx|oc|cp> \"<prompt>\" [agent flags]"
    exit 1 ;;
esac
if [ -z "$PROMPT" ]; then
  echo "usage: /cli-dispatch:ask $BACKEND \"<prompt>\" [agent flags]   (prompt is required)"
  exit 1
fi
if ! command -v "$AGENT" >/dev/null 2>&1; then
  echo "$AGENT not found on PATH — re-run /cli-dispatch:setup."
  exit 1
fi
"$AGENT" -q "${SAFE[@]}" "$@" "$PROMPT"
```

Agent flags go before the prompt: `--effort low|medium|high` (ds, ag, cx, cp), `--model <m>`
(ag, cx, oc, cp), `--max-runtime <s>`, `--idle-timeout <s>`. The worker's output is a claim, not
evidence: verify it before relying on it.
