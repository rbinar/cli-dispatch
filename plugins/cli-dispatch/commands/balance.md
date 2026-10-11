---
description: Show usage/balance for all backends, or one (DeepSeek + Antigravity + Codex + OpenCode + Copilot)
argument-hint: "[ds|ag|cx|oc|cp]"
allowed-tools: Bash
---

Run this once with the Bash tool. With no argument it covers every backend; `ds`/`ag`/`cx`/`oc`/`cp`
(or the long name) limits it to one.

```bash
# The user's text is pasted in before bash parses it, so it is kept in a quoted heredoc and split
# by a tokenizer that expands nothing. (`read`, not $(cat): bash 3.2 mis-parses a lone quote in $( ).)
IFS= read -r -d '' ARGS_RAW <<'CLI_DISPATCH_ARGS_EOF_9f2c' || true
$ARGUMENTS
CLI_DISPATCH_ARGS_EOF_9f2c
_AF="$(mktemp)"; printf '%s' "$ARGS_RAW" | node "${CLAUDE_PLUGIN_ROOT}/scripts/cli-dispatch-args.mjs" > "$_AF" || { rm -f "$_AF"; exit 2; }
set --; while IFS= read -r -d '' a; do set -- "$@" "$a"; done < "$_AF"; rm -f "$_AF"
bash "${CLAUDE_PLUGIN_ROOT}/scripts/cli-dispatch-balance.sh" "$@"
```

Summarize one headline number per `==` section and nothing more:

- **DeepSeek** — `is_available` and `total_balance` per currency, from the raw JSON. If the
  API returned an error JSON, relay that error.
- **Antigravity** — per-model `% left` plus reset time. It reads Antigravity's local status
  endpoint, so the IDE or an `agy` session must already be running.
- **Codex** — 5h and 7d `% left` plus reset time. This figure is only as fresh as the last
  *interactive* codex turn; exec/`-q` runs report `rate_limits:null`.
- **OpenCode** — `total_credits - total_usage`. This is the **paid-credit**
  balance only. `:free` models have no quota API, so a low or zero number here
  does NOT mean a free-tier user is out of quota — free-tier limits only surface
  as a 429 from opencode itself.
- **Copilot** — no numeric balance exists from the CLI; do not call any GitHub billing
  API, point the user at https://github.com/settings/billing.

**Never print any key VALUE** — only the balance/quota figures. An unconfigured or
offline backend prints a short note instead of a number; report that note as-is
rather than treating it as an error.

**Native Windows** (DeepSeek only, PowerShell equivalent):

```powershell
$cfg = if ($env:CLI_DISPATCH_CONFIG) { $env:CLI_DISPATCH_CONFIG } elseif ($env:CLAUDE_DS_CONFIG) { $env:CLAUDE_DS_CONFIG } elseif (Test-Path (Join-Path $HOME '.config/cli-dispatch/config')) { Join-Path $HOME '.config/cli-dispatch/config' } else { Join-Path $HOME '.config/claude-ds/config' }
if (-not (Test-Path $cfg)) { 'config: MISSING — run /cli-dispatch:setup'; return }
$key = (Select-String -Path $cfg -Pattern 'DEEPSEEK_API_KEY="([^"]+)"').Matches.Groups[1].Value
if (-not $key) { 'key: MISSING — add it to the config'; return }
Invoke-RestMethod -Uri 'https://api.deepseek.com/user/balance' `
  -Headers @{ Authorization = "Bearer $key"; Accept = 'application/json' } | ConvertTo-Json -Depth 5
```

Fields: `balance_infos[]` carries `currency`, `total_balance` (granted + topped up),
`granted_balance`, and `topped_up_balance`. The other backends are Unix-only.
