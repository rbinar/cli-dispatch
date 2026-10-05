# Kullanım

[← README](../../README.tr.md)

cli-dispatch'i **Claude Code'un içinden** kullanırsın — iki yol:

1. **Slash komutları** (aşağıdaki tablo) — `claude` oturumunun prompt'una yazılır.
2. **Doğal dille** — "deepseek ile şunu yap", "codex ile çalıştır", "gemini'ye delege et" dersin; skill devreye girer ve Claude Code işi eşleşen backend'de yürütür.

| Komut | İş |
|-------|-----|
| `/cli-dispatch:setup` | Backend(ler) seç + kur + config iskeleti + smoke test |
| `/cli-dispatch:ds-run <görev>` | Bir görevi **DeepSeek**'e delege et (session-takipli; repo görevinde worktree izolasyonu) |
| `/cli-dispatch:ag-run <görev>` | Bir görevi **Antigravity (Gemini)**'ye delege et (aynı akış) |
| `/cli-dispatch:cx-run <görev>` | Bir görevi **Codex (OpenAI)**'e delege et (gerçek read-only sandbox; aynı session düzeni) |
| `/cli-dispatch:oc-run <görev>` | Bir görevi **OpenCode (OpenRouter)**'a delege et (sandbox yok — yalnızca worktree izolasyonu; aynı session düzeni) |
| `/cli-dispatch:cp-run <görev>` | Bir görevi **GitHub Copilot**'a delege et (sandbox yok — yalnızca worktree izolasyonu; aynı session düzeni) |
| `/cli-dispatch:run <backend> "<görev>" --verify '<cmd>'` | Doğrudan çağrılan deterministik delegasyon, sıfır LLM token'ı. Orkestratörden varsayılan yol, aynı runner'ı saran ince `cli-dispatch:runner` agent'ıdır |
| `/cli-dispatch:sessions` | Geçmiş/aktif session'ları listele (tüm backend'ler; `backend` kolonu) |
| `/cli-dispatch:ds-sessions` / `ag-sessions` / `cx-sessions` / `oc-sessions` / `cp-sessions` | Aynı liste, yalnızca DeepSeek / Antigravity / Codex / OpenCode / Copilot'a filtreli |
| `/cli-dispatch:watch <id>` | Bir session'ın canlı durumunu göster (maliyet-odaklı) |
| `/cli-dispatch:wait <id>` | Session bitene (veya timeout'a) kadar blokla, sonra kompakt bir özet bas — `watch`'ı yoklamak yerine tek bloklayan çağrı |
| `/cli-dispatch:resume <id> <prompt>` | Bir worker session'a follow-up göndererek devam et (backend otomatik tespit) |
| `/cli-dispatch:kill <id>` | Çalışan worker session'ı durdur (SIGTERM + state → killed) |
| `/cli-dispatch:clean` | Stale worker dizinlerini (`running` ama ölü) temizle; varsayılan dry-run, `--remove` ile siler. Silinen session'lardaki `verdict.json` ve `verdict-diff.patch` varsayılan olarak `<sessions-root>/verdict-archive/` altında arşivlenir; vazgeçmek için `--no-preserve-verdicts` geç. |
| `/cli-dispatch:clean-schedule` | OS zamanlayıcısıyla günlük otomatik temizlik kur (launchd / cron / Scheduled Tasks); `status` / `uninstall` da var |
| `/cli-dispatch:status` | Tüm backend'ler için kurulum/key/CLI durumunu kontrol et |
| `/cli-dispatch:ds-status` / `ag-status` / `cx-status` / `oc-status` / `cp-status` | Aynı kontrol, yalnızca DeepSeek / Antigravity / Codex / OpenCode / Copilot kapsamında |
| `/cli-dispatch:balance` | Toplu — DeepSeek bakiyesi + Antigravity kotası + Codex rate limit + OpenCode kredisi + Copilot kullanım notu, hepsi bir arada |
| `/cli-dispatch:ds-balance` | DeepSeek hesap bakiyesini göster |
| `/cli-dispatch:cx-balance` | Codex kullanım / rate limit (5h + haftalık kalan %) — native, codex'in kendi disk session kayıtlarından |
| `/cli-dispatch:ag-balance` | Antigravity kotası (model başına kalan % + plan) — native, local language-server `GetUserStatus` RPC ile |
| `/cli-dispatch:oc-balance` | OpenCode'un OpenRouter paid-credit bakiyesini göster (`total_credits - total_usage`) — `:free` modellerin kota API'si yok |
| `/cli-dispatch:cp-balance` | Copilot kullanım görünürlüğünü açıklar — CLI'dan sorgulanamaz; GitHub Billing kullanılır |
| `/cli-dispatch:gain` | Backend başına worker token toplamlarını, `cli-dispatch:runner` agent'ının ve legacy runner-subagent session'larının Anthropic maliyetiyle birlikte raporla |
| `/cli-dispatch:doctor` | Tüm backend'ler için sağlık kontrolü — PATH, API key'ler, CLI auth ✓/✗ |
| `/cli-dispatch:help` | Tek ekranda komut referans tablosu |
