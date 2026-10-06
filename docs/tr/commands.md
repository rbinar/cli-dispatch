# Kullanım

[← README](../../README.tr.md)

cli-dispatch'i **Claude Code'un içinden** kullanırsın — iki yol:

1. **Slash komutları** (aşağıdaki tablo) — `claude` oturumunun prompt'una yazılır.
2. **Doğal dille** — "deepseek ile şunu yap", "codex ile çalıştır", "gemini'ye delege et" dersin; skill devreye girer ve Claude Code işi eşleşen backend'de yürütür.

| Komut | İş |
|-------|-----|
| `/cli-dispatch:setup` | Backend(ler) seç + kur + config iskeleti + smoke test |
| `/cli-dispatch:ask <backend> "<prompt>"` | Bir worker'a tek-atışlık soru/cevap, repo değişikliği yok (`ds`/`cx` `--read-only` koşar; `ag`/`oc`/`cp`'de yazma engeli yok, bu yüzden repo erişimsiz geçici bir dizinde koşarlar). `--model` / `--effort` gibi agent bayrakları prompt'tan önce gelir. Repo işi için `run` veya runner agent'ı |
| `/cli-dispatch:run <backend> "<task>" --verify '<cmd>'` | Deterministik delegasyon, doğrudan çağrılır — sıfır LLM token. Bir orkestratörden varsayılan, bu runner'ı saran ince `cli-dispatch:runner` agent'ıdır |
| `/cli-dispatch:sessions [backend]` | Geçmiş/aktif session'ları listele (tüm backend'ler; `backend` sütunu gösterir); isteğe bağlı backend filtresi |
| `/cli-dispatch:watch <id> [--wait [--timeout S]]` | Bir session'ın canlı durumunu göster (maliyet-odaklı; her backend). `--wait` ile bitene (veya timeout'a) kadar blokla ve kompakt bir özet bas — yoklama yerine tek bloklayan çağrı |
| `/cli-dispatch:resume <id> <prompt>` | Bir worker session'ına takip prompt'uyla devam et (backend'i otomatik bulur) |
| `/cli-dispatch:kill <id>` | Çalışan bir worker session'ını durdur (SIGTERM + state → killed) |
| `/cli-dispatch:clean` | Stale worker dizinlerini sil (`running` ama ölü); varsayılan dry-run, silmek için `--remove`. Silinen session'lar `verdict.json` ve `verdict-diff.patch` dosyalarını varsayılan olarak `<sessions-root>/verdict-archive/` altına arşivler; vazgeçmek için `--no-preserve-verdicts`. `--schedule [install|status|uninstall]` OS zamanlayıcısıyla (launchd / cron / Scheduled Tasks) günlük otomatik temizliği yönetir; yalın `--schedule` = `status` |
| `/cli-dispatch:doctor [backend]` | Sağlık kontrolü — PATH, API key'ler, CLI auth ✓/✗, backend başına yapılandırılmış model, bayat-kurulum uyarısı; isteğe bağlı backend filtresi |
| `/cli-dispatch:balance [backend]` | DeepSeek bakiyesi + Antigravity kotası + Codex rate limit'leri + OpenCode kredileri + Copilot kullanım notu; isteğe bağlı backend filtresi (bkz. [Kota](quota.md)) |
| `/cli-dispatch:gain [--drift]` | Backend başına worker token toplamlarını, `cli-dispatch:runner` agent'ının ve legacy runner-subagent session'larının Anthropic maliyetiyle birlikte raporla; `--drift` drift raporunu ekler |
| `/cli-dispatch:help` | Tek ekranda komut referans tablosu |

`backend` kısa ya da uzun slug alır: `ds`|`deepseek`, `ag`|`antigravity`, `cx`|`codex`, `oc`|`opencode`, `cp`|`copilot`.

Codex'te `ask` gerçek bir OS read-only sandbox'ı kullanır; DeepSeek `--effort` alır.
