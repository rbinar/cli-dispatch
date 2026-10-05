# cli-dispatch

> 🌐 **Diller:** **Türkçe** · [English](README.md)

**DeepSeek, Gemini, OpenAI Codex, OpenCode'u (OpenRouter üzerinden) veya GitHub Copilot'ı Claude Code içinden delege işçi olarak kullan.** Claude Code'un yerleşik subagent aracı yalnızca Anthropic modellerini destekler — cli-dispatch, mevcut `claude` oturumundan bu beş backend'e görev delege edebilmen için taşınabilir wrapper'lar kurar. Delegasyon deterministik bir runner (düz shell, sıfır LLM token'ı) ve ince bir haiku `cli-dispatch:runner` agent'ı üzerinden yürür; işi işçi yapar, Claude Code yalnızca inceler.

> 📝 **Yazı:** [cli-dispatch: Claude'a patron, DeepSeek'e işçi rolü veren bir plugin](https://medium.com/@rbinar/cli-dispatch-claudea-patron-deepseek-e-i%CC%87%C5%9F%C3%A7i-rol%C3%BC-veren-bir-plugin-b232803581fc) — Medium

![cli-dispatch demo — projende Claude Code başlat, sonra: install, /cli-dispatch:setup, /cli-dispatch:ds-run ve deterministik /cli-dispatch:run ile delege et, kullanımı gör](assets/demo.gif)

## Kurulum

> ⚠️ Bunlar **slash komutudur**: **Claude Code CLI'ın içinde** (önce `claude` yaz), tek tek ve sırayla çalıştır. Ayrıntılar, ön koşullar ve sorun giderme: [Kurulum](docs/tr/install.md).

```text
/plugin marketplace add rbinar/cli-dispatch
/plugin install cli-dispatch@cli-dispatch
/reload-plugins
/cli-dispatch:setup
```

| Backend | CLI (kurulum) | Auth | Model seçimi |
|---|---|---|---|
| **DeepSeek** | `claude` (zaten kurulu) | Config'te `DEEPSEEK_API_KEY` ([edin](https://platform.deepseek.com/api_keys)) | `DS_MODEL` / `DS_FLASH_MODEL` |
| **Antigravity (Gemini)** | `agy` — `curl -fsSL https://antigravity.google/cli/install.sh \| bash` (+ `script`, `node`) | Google girişi (bir kez `agy` çalıştır) veya `GEMINI_API_KEY` | `--model "<ad>"` / `AG_MODEL` — liste: `agy models` |
| **Codex (OpenAI)** | `codex` ≥ 0.142.3 — `npm i -g @openai/codex`, `brew install --cask codex` veya `curl -fsSL https://chatgpt.com/codex/install.sh \| sh` (+ `node`) | `codex login` (ChatGPT/OAuth) veya `CODEX_API_KEY`/`OPENAI_API_KEY` | `--model <ad>` / `CX_MODEL` — liste: codex içinde `/model` |
| **OpenCode (OpenRouter)** | `opencode` — `npm i -g opencode-ai` (+ `node`) | `OPENROUTER_API_KEY` ([edin](https://openrouter.ai/keys)), sen yapıştırırsın | `--model <bare-slug>` / `OC_MODEL` — liste: `opencode models openrouter` |
| **GitHub Copilot** | `copilot` — `npm i -g @github/copilot`, `brew install --cask copilot-cli` veya `curl -fsSL https://gh.io/copilot-install \| bash` (+ `node` 22+) | `COPILOT_GITHUB_TOKEN` > `GH_TOKEN` > `GITHUB_TOKEN` (mümkünse `gh auth token`'ı kullanır) ya da `copilot login --device-code`; aktif Copilot aboneliği gerekir | `--model <slug>` / `CP_MODEL`; `--effort low\|medium\|high` |

Native Windows: yalnızca DeepSeek ve Codex — diğer üçü WSL altında kur (bkz. [Windows](docs/tr/windows.md)). Sandbox: yalnızca Codex'in `--read-only`'si kernel-zorunlu bir OS sandbox'ıdır — gerisi worktree izolasyonu gerektirir (bkz. [Güvenlik ve veri](docs/tr/security.md)).

## Kurulum sihirbazı (setup)

`/cli-dispatch:setup` hangi backend('ler)i kuracağını sorar (DeepSeek, Antigravity, Codex, OpenCode, Copilot ya da hepsi); eksik bir CLI'ı `--install-missing` ile otomatik kurabilir — yalnızca senin onayından sonra, auth'u asla otomatikleştirmez. DeepSeek ve OpenCode için tarayıcında tek kullanımlık yerel bir web formu açar; key ve model adlarını oraya yazarsın, değerler doğrudan `~/.config/cli-dispatch/config` dosyasına gider, Claude'dan geçmez. Son adım isteğe bağlı olarak bir delegasyon tercihi yazar ve [oturum-başı politika enjeksiyonunu](docs/tr/policy-injection.md) açar. Tam anlatım: [Kurulum](docs/tr/install.md).

## Delege etme

Orkestratörden varsayılan yol ince runner agent'ıdır: deterministik runner'ı ayrık başlatır, bitene kadar bloklar, başarısız verify'ı bir kez yeniden dener ve kompakt bir verdict döndürür.

```text
Agent(subagent_type: "cli-dispatch:runner", prompt: "backend: ds\ncwd: /mutlak/yol\nverify: <cmd>\n---\n<kendi başına yeterli brief>")
```

Doğrudan (sıfır LLM token'ı; arka plana almayı sen yaparsın):

```text
/cli-dispatch:run <backend> "<görev>" --verify '<cmd>'
```

Geriye kompakt bir verdict gelir; gerçek repo değişiklikleri izole bir git worktree'de commit'siz kalır, incelemeden sonra patch'i sen uygularsın. Basit, tek-atışlık işler için backend başına `/cli-dispatch:ds-run` / `ag-run` / `cx-run` / `oc-run` / `cp-run` kullanılır. Devamı: [Deterministik runner](docs/tr/runner.md), [Komutlar](docs/tr/commands.md).

> ⚠️ **Varsayılan mod bir sandbox değildir.** İşçiler dosya yazabilir ve bash çalıştırabilir — gerçek repo işini worktree'de izole et ([Güvenlik ve veri](docs/tr/security.md)).

## Güncelleme

```text
/plugin update cli-dispatch
/reload-plugins
```

`/plugin update` yalnızca komutları ve skill'leri yeniler; bir wrapper'ı değiştiren güncellemeden sonra `~/.local/bin`'deki wrapper'ları yeniden kurmak için bir kez `/cli-dispatch:setup` çalıştır. `/cli-dispatch:status` ile doğrula. Bkz. [Kurulum](docs/tr/install.md#güncelleme).

## Dokümantasyon

- [Kurulum](docs/tr/install.md) — ön koşullar, adım adım kurulum, setup ve config, güncelleme
- [Komutlar](docs/tr/commands.md) — tüm slash komutları
- [Deterministik runner](docs/tr/runner.md) — runner agent'ı, `/cli-dispatch:run`, escalation yolu
- [Session takibi](docs/tr/sessions.md) — canlı izleme, resume, session dizini
- [Oturum-başı politika enjeksiyonu](docs/tr/policy-injection.md) — opsiyonel delegasyon politikası hook'u
- [Statusline rozeti](docs/tr/statusline.md) — `[CD]` statusline fragment'ı
- [Kullanım & kota](docs/tr/quota.md) — backend başına native bakiye ve rate limit kontrolü
- [Özellikler ve mimari](docs/tr/features.md) — özellik özeti ve mimari rol
- [Kaputun altı](docs/tr/internals.md) — kurulan CLI'lar ve doğrudan terminal kullanımı
- [Windows](docs/tr/windows.md) — native PowerShell desteği
- [Güvenlik ve veri](docs/tr/security.md) — sandbox durumu, key'ler, veri egress, budama
- [Kaldırma](docs/tr/uninstall.md) — tam temizlik
- [Terminal referansı](TERMINAL.md) ve [CHANGELOG](CHANGELOG.tr.md)

## Lisans

MIT — bkz. [LICENSE](LICENSE).
