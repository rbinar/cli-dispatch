# Kurulum

[← README](../../README.tr.md)

> ⚠️ Bu komutlar **slash komutudur** ve **Claude Code CLI'ın içinden** çalıştırılmalıdır (normal terminal/shell'de değil). Önce `claude` yazıp Claude Code oturumunu başlat, komutları o oturumun prompt'una gir.

**Başlamadan önce — gerekenler:**
- `claude` CLI kurulu ve `PATH`'te, sürümü **2.1.287 veya daha yeni** (mod'lar Claude Code 2.1.287 ile geldi; plugin buna ihtiyaç duyar)
- `~/.local/bin` `PATH`'te — kontrol: `echo $PATH | grep -q local && echo tamam || echo 'ekle: export PATH="$HOME/.local/bin:$PATH" → ~/.zshrc'`
- Backend'ine göre API key/auth — aşağıdaki tabloya bak

Komutları **tek tek, sırayla** çalıştır — hepsini aynı anda yapıştırma. Her komutu gönder, sonucu bekle, sonra bir sonrakine geç:

**1. Adım — Marketplace'i ekle:**

```text
/plugin marketplace add rbinar/cli-dispatch
```

> Eğer "Enter marketplace source" kutusu açılırsa, o kutuya **yalnızca kaynağı** yaz (komutu değil): `rbinar/cli-dispatch`

**2. Adım — Plugin'i kur** (marketplace eklendikten sonra):

```text
/plugin install cli-dispatch@cli-dispatch
```

> Format `plugin-adı@marketplace-adı` şeklindedir; her ikisi de `cli-dispatch` olduğu için isim tekrar eder, bu normaldir.

**3. Adım — Plugin'i etkinleştir:**

Install çıktısı `Run /reload-plugins to apply` der. Komutların (`/cli-dispatch:*`) tanınması için bu adım zorunludur:

```text
/reload-plugins
```

> Reload sonrası hâlâ "Unknown command: /cli-dispatch:setup" alıyorsan, Claude Code'u tamamen kapatıp yeniden aç. `/plugin` komutuyla `cli-dispatch`'in yüklü ve **enabled** olduğunu doğrulayabilirsin.

**4. Adım — Kurulumu çalıştır** (plugin etkinleştikten sonra):

```text
/cli-dispatch:setup
```

`/cli-dispatch:setup` önce **hangi backend('ler)i kuracağını sorar** — DeepSeek, Antigravity (Gemini), Codex, OpenCode, Copilot, Ollama ya da hepsi (`--backends all` veya `--backends deepseek,antigravity,codex,opencode,copilot,ollama`). Seçilen bir backend'in altındaki CLI eksik çıkarsa, `install.sh` bunu senin için otomatik kurmayı deneyebilir — `--install-missing` geç (opt-in, varsayılan kapalı; mümkün olduğunda npm tercih edilir, fallback olarak `curl | bash` vendor installer'lar). Setup bu bayrağı yalnızca senin açık onayını aldıktan ve hangi CLI'ların eksik olduğunu, hangi komutların çalışacağını gösterdikten sonra ekler; auth'u (sign-in, API key) asla otomatikleştirmez. Detaylar için [CHANGELOG.md](../../CHANGELOG.md).

| Backend | CLI (kurulum) | Auth | Model seçimi |
|---|---|---|---|
| **DeepSeek** | `claude` (zaten kurulu) | Config'te `DEEPSEEK_API_KEY` ([edin](https://platform.deepseek.com/api_keys)) | `DS_MODEL` / `DS_FLASH_MODEL` |
| **Antigravity (Gemini)** | `agy` — `curl -fsSL https://antigravity.google/cli/install.sh \| bash` (+ `script`, `node`) | Google girişi (bir kez `agy` çalıştır) veya `GEMINI_API_KEY` | `--model "<ad>"` / `AG_MODEL` — liste: `agy models` |
| **Codex (OpenAI)** | `codex` ≥ 0.142.3 — `npm i -g @openai/codex`, `brew install --cask codex` veya `curl -fsSL https://chatgpt.com/codex/install.sh \| sh` (+ `node`) | `codex login` (ChatGPT/OAuth) veya `CODEX_API_KEY`/`OPENAI_API_KEY` | `--model <ad>` / `CX_MODEL` — liste: codex içinde `/model` |
| **OpenCode (OpenRouter)** | `opencode` — `npm i -g opencode-ai` (+ `node`) | `OPENROUTER_API_KEY` ([edin](https://openrouter.ai/keys)), sen yapıştırırsın | `--model <bare-slug>` / `OC_MODEL` — liste: `opencode models openrouter` |
| **Ollama (yerel)** | `claude` (zaten var) + çalışan bir Ollama ([ollama.com](https://ollama.com)), varsayılan olarak yerel | yok — key gerekmez | `OL_MODEL` (**zorunlu**, önceden çekilmiş bir model: `ollama pull <ad>`); `OLLAMA_BASE_URL` (varsayılan `http://127.0.0.1:11434`) |
| **GitHub Copilot** | `copilot` — `npm i -g @github/copilot`, `brew install --cask copilot-cli` veya `curl -fsSL https://gh.io/copilot-install \| bash` (+ `node` 22+) | `COPILOT_GITHUB_TOKEN` > `GH_TOKEN` > `GITHUB_TOKEN` (mümkünse `gh auth token`'ı kullanır); aktif Copilot aboneliği gerekir | `--model <slug>` / `CP_MODEL`; `--effort low\|medium\|high` |

Native Windows: yalnızca DeepSeek ve Codex — diğer dördünü (Antigravity, OpenCode, Copilot, Ollama) WSL altında kur (bkz. [Windows](windows.md#windows)). Sandbox: yalnızca Codex'in `--read-only`'si kernel-zorunlu bir OS sandbox'ıdır — gerisi worktree izolasyonu gerektirir (bkz. [Güvenlik ve veri](security.md#güvenlik-ve-veri)).

**Key'ler ve modeller (Claude Code 2.1.287+).** API key'lerini `/plugin configure cli-dispatch@cli-dispatch` ile gir: key, Claude Code'un güvenli deposunda tutulur, bir dosyada durmaz ve Claude'dan geçmez. Diyalog key'i maskeler ama **son 6 karakterini açık gösterir**; ekran paylaşırken ya da kayıt alırken girme. Model adlarını düzenlemek ve backend kurmak için `/cli-dispatch-config` kullan. Orada girilen key yalnızca `dispatch` aracına ulaşır; `/cli-dispatch:run`, runner agent ve `*-agent` script'leri hâlâ config dosyasını okur, bunları kullanıyorsan key'i oraya da ekle (ya da aşağıdaki formu kullan).

Mod yüklü değilse yedek yol: setup, key'i kendin girdiğin için tarayıcında **tek kullanımlık yerel bir web formu** açar (yalnızca loopback, çalıştırmaya özel token). Key ve model adlarını bu forma yazarsın; değerler doğrudan config dosyasına gider, Claude'dan geçmez. Sonuçta dosya şuna benzer:

```bash
# ~/.config/cli-dispatch/config
DEEPSEEK_API_KEY="sk-..."     # kendi DeepSeek key'in
DS_MODEL="deepseek-v4-pro"
DS_FLASH_MODEL="deepseek-flash"
# Ollama (key yok) — OL_MODEL zorunlu: o Ollama'da önceden çekilmiş bir model
OLLAMA_BASE_URL="http://127.0.0.1:11434"
OL_MODEL="qwen3.8:27b"
```

**Ollama ve bağlam penceresi.** Ollama, çalışan bağlamından uzun bir prompt'a HTTP 200 ile ve hata
vermeden yanıt verir: prompt'u **sessizce** kırpar, bu yüzden worker brief'i ya da önceki araç
sonuçlarını kaybedebilir. Ollama sunucusunda `OLLAMA_CONTEXT_LENGTH`'i ayarla (varsayılanı VRAM'e
göre değişir: 4k/32k/256k); Claude Code'un kendi başlangıç prompt'u yaklaşık 29k token olduğundan bir
çalıştırmanın ilk turu yerelde yaklaşık 40 sn sürer ve 4k'lık bir sunucu onu hiç çalıştıramaz.
cli-dispatch worker'a sunucunun gerçek penceresini (`CLAUDE_CODE_MAX_CONTEXT_TOKENS`) ayarladıysan
`OL_CONTEXT`'ten, yoksa model yüklüyken `/api/ps`'ten bildirir; o da yoksa 32768 varsayar ve bunu
söyler — model yüklü değilken başlayan çalıştırmalar için `OL_CONTEXT`'i sunucunun
`OLLAMA_CONTEXT_LENGTH` değerine ayarla. Claude Code bu pencereden çok önce sıkıştırır (ölçüldü: 64k
pencerede yaklaşık 40k'da), bu yüzden birkaç büyük dosya okuyan bir görev "Autocompact is thrashing"
ile durabilir; böyle görevler için sunucuya daha büyük bir pencere ver. Çekilmemiş bir model,
erişilemeyen bir sunucu ya da boş bir
`OL_MODEL` hiçbir şey başlamadan hata verir (runner worktree açmadan 5 ile çıkar); cli-dispatch asla
model çekmez. Ollama şimdilik yalnız Unix'te çalışır.

> Form yerine metin editörü mü istiyorsun? `CLI_DISPATCH_EDITOR` ortam değişkenini ayarla (ör. `CLI_DISPATCH_EDITOR="code"`; eski `CLAUDE_DS_EDITOR` da hâlâ geçerli). Dosyayı elle düzenlemek için: `${EDITOR:-nano} ~/.config/cli-dispatch/config`.

OpenCode'un setup adımı ayrıca (seçmeli bir soru ile) 2-3 seçkin ücretsiz-katman OpenRouter slug'ından (ör. `google/gemma-4-31b-it:free`) bir default model ister ya da özel bir slug girmene izin verir; sonucu `OC_MODEL`'e yazar. Copilot'ın model listesi yalnızca interaktif olarak görülebilir (copilot TUI içinde `/model` veya GitHub Copilot docs) — slug'lar zamanla değişir.

`/cli-dispatch:setup`'ın son bir adımı, evet/hayır tarzı bir soruyla, global veya proje `CLAUDE.md`'ine kalıcı bir delegasyon-tercihi hatırlatması yazmayı önerir — deterministik runner'ı (ince `cli-dispatch:runner` agent'ı veya doğrudan `/cli-dispatch:run`) delegasyon yolu olarak işaret eder — böylece her oturumda delegasyon tercihini yeniden anlatman gerekmez (idempotent/marker-guarded, tekrar setup çalıştırmak onu çoğaltmaz).

## Güncelleme

Plugin'i Claude Code içinden güncelle, sonra reload et (teker teker çalıştır):

```text
/plugin update cli-dispatch
/reload-plugins
```

`/plugin update` marketplace'ten en yeni sürümü çeker; `/reload-plugins` çalışan oturuma uygular
(tam yeniden başlatma olmadan). `/cli-dispatch:doctor` ile doğrula.

> ℹ️ `/plugin update` yalnızca **komutları/skill'leri** yeniler — `~/.local/bin`'deki worker
> wrapper'larını **yeniden kurmaz**. Bir wrapper'ı değiştiren bir güncellemeden sonra, wrapper'ları
> yeniden kurmak için bir kez **`/cli-dispatch:setup`** çalıştır.

<video src="https://github.com/rbinar/cli-dispatch/raw/main/assets/update.mp4" controls width="820"></video>

> ▶️ [Güncelleme demosunu izle (mp4)](../../assets/update.mp4) — Claude Code içinde `/plugin update` sonra `/reload-plugins`.
