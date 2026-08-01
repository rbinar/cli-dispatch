---
description: Show the DeepSeek account balance
allowed-tools: Bash
---

!`bash "${CLAUDE_PLUGIN_ROOT}/scripts/cli-dispatch-balance.sh" --backend deepseek`

The DeepSeek balance report above already ran — do NOT run it again. Summarize
`is_available` and `total_balance` per currency. If the API returned an error
JSON, relay that error. Never print a key VALUE.

**Native Windows** (PowerShell equivalent):

```powershell
$cfg = if ($env:CLI_DISPATCH_CONFIG) { $env:CLI_DISPATCH_CONFIG } elseif ($env:CLAUDE_DS_CONFIG) { $env:CLAUDE_DS_CONFIG } elseif (Test-Path (Join-Path $HOME '.config/cli-dispatch/config')) { Join-Path $HOME '.config/cli-dispatch/config' } else { Join-Path $HOME '.config/claude-ds/config' }
if (-not (Test-Path $cfg)) { 'config: MISSING — run /cli-dispatch:setup'; return }
$key = (Select-String -Path $cfg -Pattern 'DEEPSEEK_API_KEY="([^"]+)"').Matches.Groups[1].Value
if (-not $key) { 'key: MISSING — add it to the config'; return }
Invoke-RestMethod -Uri 'https://api.deepseek.com/user/balance' `
  -Headers @{ Authorization = "Bearer $key"; Accept = 'application/json' } | ConvertTo-Json -Depth 5
```

Fields: `is_available` says whether API calls have sufficient balance;
`balance_infos[]` contains `currency`, `total_balance` (granted + topped up),
`granted_balance`, and `topped_up_balance`.
