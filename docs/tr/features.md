# Özellikler

[← README](../../README.tr.md)

> ℹ️ **Çok-backend delege hub'ı.** Beş işçi backend'i var — **DeepSeek** (`ds`), **Antigravity/Gemini** (`ag`, wrapper'lar `ag-agent`/`ag-stream`), **Codex** (`cx`, `cx-agent`/`cx-stream`), **OpenCode** (`oc`, `oc-agent`/`oc-stream`) ve **GitHub Copilot** (`cp`, `cp-agent`/`cp-stream`). Hangisini kuracağını setup'ta seçersin. Beşi de aynı session düzenine yazar; `sessions`/`watch` hepsinde çalışır. DeepSeek wrapper/config yolları `claude-ds` adını korur (o backend'in adı).

Hepsi Claude Code içinden kullanılır (`/cli-dispatch:run <backend> "<görev>"`, `/cli-dispatch:ask <backend> "<prompt>"` ya da "deepseek/codex/gemini/opencode/copilot ile <görev>"):

- **Beş işçi backend, tek hub** — **DeepSeek** (`ds-*`), **Antigravity / Gemini** (`ag-*`), **Codex / OpenAI** (`cx-*`), **OpenCode / OpenRouter** (`oc-*`), **GitHub Copilot** (`cp-*`). Setup'ta birini (veya hepsini) seç; beşi de **aynı session düzenine** yazar, böylece `sessions`, `watch`, `clean` ve balance komutları her backend'de çalışır.
- **Delege & doğrula** — işçi üretir/uygular; Claude Code canlı izler ve çıktıyı doğrular. Konuşma bağlamı paylaşılmaz → görev **kendine yeten** olmalı. İşçi = yapan, sen = inceleyen/merge sahibi.
- **Session takibi (canlı izleme + resume)** — iş opak bir arka plan süreci değildir; her çalışma bir session dizini yazar (status / progress / transcript / meta + tam prompt) ve izlenebilir/sürdürülebilir. → [Session takibi](sessions.md#session-takibi-canlı-izleme--resume)
- **İzolasyon & read-only** — gerçek repo görevleri tek-kullanımlık git worktree'de çalışır, diff commit'siz bırakılır; Codex'in `--read-only`'si ayrıca kernel-zorunlu bir yazma-yok sandbox'ı aktive eder. → [Güvenlik ve veri](security.md#güvenlik-ve-veri)
- **Deterministik runner + ince `cli-dispatch:runner` agent'ı** — bir işçi başlatır, gerçek repo değişikliklerini worktree'de izole eder, bitene kadar bloklar ve makine-kontrol-edilebilir bir `--verify` komutuna göre geçit koyar; hepsi düz shell'de. Orkestratörden varsayılan yol `cli-dispatch:runner` agent'ıdır: runner'ı ayrık (detached) başlatan, bitmesini bekleyen, başarısız verify'ı bir kez yeniden deneyen ve kompakt verdict'i döndüren bir haiku yönlendiricisi (~3-4 tur; babysitter değil). `/cli-dispatch:run` doğrudan yoldur (sıfır LLM token'ı). Verify komutu olmayan, muhakeme-yoğun işlerde kompakt verdict + diff'i kendin okur, gerekirse `/cli-dispatch:resume` ile devam edersin. → [Deterministik runner](runner.md#deterministik-runner-ve-runner-agentı)
- **Oturum-başı politika enjeksiyonu (opsiyonel)** — bir `SessionStart` hook'u, `/cli-dispatch:setup`'ta bir kez yapılandırılan kompakt bir delegasyon politikasını (deterministik-runner yönlendirmesi, escalation path, issue-açma hatırlatması) her oturumun context'ine otomatik enjekte eder. Opt-in, varsayılan kapalı, kapalıyken sıfır token maliyeti. → [Oturum-başı politika enjeksiyonu](policy-injection.md#oturum-başı-politika-enjeksiyonu-opsiyonel)
- **Statusline rozeti (opsiyonel)** — cyan bir `[CD]` rozeti ve bu Claude Code session'ının canlı worker'ları için sarı, backend bazlı sayaçlar. → [Statusline rozeti](statusline.md#statusline-rozeti)
- **Native kullanım / kota** — `/cli-dispatch:balance` (beşi birden) ya da backend başına `*-balance`; mümkün olduğunda her CLI'nın kendi local verisinden, **üçüncü-parti araç yok**. Copilot CLI'dan sorgulanamaz. → [Kullanım & kota](quota.md#kullanım--kota--native-üçüncü-parti-araç-yok)
- **Temizlik** — `/cli-dispatch:clean` stale (`running` ama ölü) worker dizinlerini budar; `/cli-dispatch:clean --schedule` bunu launchd / cron / Scheduled Tasks ile günlük otomatikleştirir.
- **Güvenlik ağı & izolasyon** — asılı/kaçak işçi, süre veya durgunluk limitinde (çocuk süreçleriyle birlikte) otomatik öldürülür, session `state: error` olur; işçiler senin `~/.claude` MCP sunucularını (playwright, vb.) miras almaz.

> ⚠️ **Varsayılan mod bir sandbox değildir.** İşçiler agentic çalışır → **dosya yazabilir / bash çalıştırabilir**. Gerçek repo işini worktree'de izole et. Backend başına tam sandbox durumu: [Güvenlik ve veri](security.md#güvenlik-ve-veri).

## Mimari rol

İşçi (DeepSeek / Gemini / Codex / OpenCode / Copilot) = yapan (üretim/uygulama). Sen (Claude Code, Anthropic) = orkestratör + reviewer + git/merge sahibi. Bir işçinin çıktısını doğrulamadan güvenme.
