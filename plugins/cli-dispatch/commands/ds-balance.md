---
description: Show the DeepSeek account balance
allowed-tools: Bash
---

# claude-ds balance

Call the DeepSeek balance API with the `DEEPSEEK_API_KEY` from the config and show the result.
**Do not print the key VALUE** — only present the balance info.

```bash
CFG="${CLAUDE_DS_CONFIG:-$HOME/.config/claude-ds/config}"
if [ ! -f "$CFG" ]; then echo "config: MISSING ($CFG) — run /cli-dispatch:ds-setup"; exit 1; fi
# shellcheck disable=SC1090
. "$CFG"
if [ -z "${DEEPSEEK_API_KEY:-}" ]; then echo "key: MISSING — add it to the config (/cli-dispatch:ds-setup)"; exit 1; fi
curl -sS --max-time 20 https://api.deepseek.com/user/balance \
  -H "Authorization: Bearer $DEEPSEEK_API_KEY" \
  -H "Accept: application/json"
echo
```

**Native Windows** (PowerShell equivalent):

```powershell
$cfg = Join-Path $HOME '.config/claude-ds/config'
if (-not (Test-Path $cfg)) { 'config: MISSING — run /cli-dispatch:ds-setup'; return }
$key = (Select-String -Path $cfg -Pattern 'DEEPSEEK_API_KEY="([^"]+)"').Matches.Groups[1].Value
if (-not $key) { 'key: MISSING — add it to the config'; return }
Invoke-RestMethod -Uri 'https://api.deepseek.com/user/balance' `
  -Headers @{ Authorization = "Bearer $key"; Accept = 'application/json' } | ConvertTo-Json -Depth 5
```

The returned JSON contains these fields:

- `is_available` — whether the balance is sufficient for API calls (true/false)
- `balance_infos[]` — per currency:
  - `currency` — `CNY` or `USD`
  - `total_balance` — total usable balance (granted + topped up)
  - `granted_balance` — unexpired granted balance
  - `topped_up_balance` — topped-up balance

Summarize the output for the user in a readable form (e.g. `is_available` and `total_balance` per currency). If an HTTP error is returned (e.g. 401 = invalid key), relay the error message from the JSON.
