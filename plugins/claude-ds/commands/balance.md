---
description: DeepSeek hesap bakiyesini goster
allowed-tools: Bash
---

# claude-ds bakiye

Config'teki `DEEPSEEK_API_KEY` ile DeepSeek bakiye API'sini çağır ve sonucu göster.
**Key DEĞERİNİ yazdırma** — yalnızca bakiye bilgisini sun.

```bash
CFG="${CLAUDE_DS_CONFIG:-$HOME/.config/claude-ds/config}"
if [ ! -f "$CFG" ]; then echo "config: YOK ($CFG) — /claude-ds:setup calistir"; exit 1; fi
# shellcheck disable=SC1090
. "$CFG"
if [ -z "${DEEPSEEK_API_KEY:-}" ]; then echo "key: MISSING — config'e ekle (/claude-ds:setup)"; exit 1; fi
curl -sS --max-time 20 https://api.deepseek.com/user/balance \
  -H "Authorization: Bearer $DEEPSEEK_API_KEY" \
  -H "Accept: application/json"
echo
```

**Native Windows** (PowerShell eşdeğeri):

```powershell
$cfg = Join-Path $HOME '.config/claude-ds/config'
if (-not (Test-Path $cfg)) { 'config: YOK — /claude-ds:setup calistir'; return }
$key = (Select-String -Path $cfg -Pattern 'DEEPSEEK_API_KEY="([^"]+)"').Matches.Groups[1].Value
if (-not $key) { 'key: MISSING — config''e ekle'; return }
Invoke-RestMethod -Uri 'https://api.deepseek.com/user/balance' `
  -Headers @{ Authorization = "Bearer $key"; Accept = 'application/json' } | ConvertTo-Json -Depth 5
```

Dönen JSON şu alanları içerir:

- `is_available` — bakiye API çağrıları için yeterli mi (true/false)
- `balance_infos[]` — para birimi başına:
  - `currency` — `CNY` veya `USD`
  - `total_balance` — toplam kullanılabilir bakiye (hediye + yüklenen)
  - `granted_balance` — süresi dolmamış hediye bakiyesi
  - `topped_up_balance` — yüklenen bakiye

Çıktıyı kullanıcıya okunur biçimde özetle (örn. `is_available` ve her para birimi için `total_balance`). HTTP hatası dönerse (ör. 401 = geçersiz key), JSON'daki hata mesajını ilet.
