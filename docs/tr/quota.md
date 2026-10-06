# Kullanım & kota — native, üçüncü-parti araç yok

[← README](../../README.tr.md)

"Limitimden ne kadar kaldı?" — **her** backend için, ekstra hiçbir şey kurmadan yanıtlanır.
Her `*-balance` komutu, CLI'ın zaten yerelde tuttuğu veriyi tersine mühendislikle okur; senin
adına ağ üzerinden yeni bir şey gönderilmez.

Beşini bir arada görmek için `/cli-dispatch:balance` kullan, ya da backend başına tek bir `*-balance` komutu.

| Backend | Komut | Sayı nereden geliyor |
|---|---|---|
| **Hepsi** | `/cli-dispatch:balance` | Aşağıdaki beşini bir seferde çalıştırır ve her başlık sayıyı yan yana özetler. |
| **DeepSeek** | `/cli-dispatch:balance ds` | DeepSeek'in resmi REST balance API'si (`/user/balance`), `DEEPSEEK_API_KEY` ile. |
| **Codex** | `/cli-dispatch:balance cx` | Codex, backend'in rate-limit verisini kendi session kayıtlarına **yazıyor** (`~/.codex/sessions/**/*.jsonl`). Komut en güncel `token_count` kaydının `rate_limits`'ini okur → `primary` (5h) + `secondary` (7d) pencereleri **kalan %** + reset. Ağ yok. |
| **Antigravity** | `/cli-dispatch:balance ag` | Local Antigravity **language server** (IDE/`agy`'nin zaten çalıştırdığı) bir Connect-RPC `GetUserStatus` endpoint'i sunar. Komut çalışan `language_server` process'ini bulur, `--csrf_token` arg + dinlenen port'u okur, `GetUserStatus`'a `POST` atar → plan + **model-başına `remainingFraction`** + reset. |
| **OpenCode** | `/cli-dispatch:balance oc` | OpenRouter'ın resmi REST endpoint'i (`GET /api/v1/credits`), `OPENROUTER_API_KEY` ile → `total_credits - total_usage` kalan bakiye. **Sadece ücretli-kredi bakiyesi** — `:free` ekli modellerin ayrı, kimliksiz, model-başına rate limiti var, scriptable kota API'si yok. |
| **GitHub Copilot** | `/cli-dispatch:balance cp` | `copilot` CLI'dan sorgulanamaz. `/usage` yalnızca Copilot REPL içinde session-kapsamlı ve interaktiftir; gerçek kullanım/limitler için GitHub Billing (https://github.com/settings/billing) kullanılır. |

Tersine mühendislikle çözülen ikisi nasıl çalışıyor:

```bash
# Codex — disk'teki en güncel rate_limits anlık görüntüsü (TUI'deki /status ile aynı sayılar):
#   ~/.codex/sessions/**/*.jsonl  →  payload.rate_limits.{primary(5h),secondary(7d)}
#   used_percent → 100-used = kalan % ; resets_at (epoch) → reset zamanı

# Antigravity — local language server'a doğrudan sor (çalışıyor olmalı):
PID=$(ps aux | grep -i language_server | grep -i antigravity | grep -v grep | awk '{print $2}' | head -1)
CSRF=$(ps -ww -o command= -p "$PID" | sed -E 's/.*--csrf_token[ =]([^ ]+).*/\1/')
PORT=$(lsof -nP -iTCP -sTCP:LISTEN -a -p "$PID" | awk 'NR>1{print $9}' | sed -E 's/.*:([0-9]+)$/\1/' | head -1)
curl -sk -X POST "https://127.0.0.1:$PORT/exa.language_server_pb.LanguageServerService/GetUserStatus" \
  -H 'Content-Type: application/json' -H 'Connect-Protocol-Version: 1' \
  -H "X-Codeium-Csrf-Token: $CSRF" --data '{}'    # → userStatus.cascadeModelConfigData...quotaInfo
```

Uyarılar: Codex'in değeri **son interaktif turn** kadar tazedir (`-q`/exec çağrıları
`rate_limits:null` döner); Antigravity'nin komutu **language server çalışıyor** olmalıdır (IDE
açık ya da bir `agy` oturumu) — yoksa ipucu basar. İkisi de bağımlılık eklemez.
