# cli-dispatch

> 🌐 **Diller:** **Türkçe** · [English](README.md)

**DeepSeek, Gemini, OpenAI Codex, OpenCode'u (OpenRouter üzerinden) veya GitHub Copilot'ı Claude Code içinden delege işçi olarak kullan.** Claude Code'un yerleşik subagent aracı yalnızca Anthropic modellerini destekler — cli-dispatch, mevcut `claude` oturumundan bu beş backend'e görev delege edebilmen için taşınabilir wrapper'lar kurar.

> ℹ️ **Çok-backend delege hub'ı.** Bugün beş işçi backend'i var — **DeepSeek** (komutlar `/cli-dispatch:ds-*`), **Antigravity/Gemini** (`/cli-dispatch:ag-run`, wrapper'lar `ag-agent`/`ag-stream`), **Codex** (`/cli-dispatch:cx-run`, wrapper'lar `cx-agent`/`cx-stream`), **OpenCode** (`/cli-dispatch:oc-run`, wrapper'lar `oc-agent`/`oc-stream`) ve **GitHub Copilot** (`/cli-dispatch:cp-run`, wrapper'lar `cp-agent`/`cp-stream`). Hangisini kuracağını setup'ta seçersin. Beşi de aynı session düzenine yazar; `sessions`/`watch` hepsinde çalışır. DeepSeek wrapper/config yolları `claude-ds` adını korur (o backend'in adı).

> 📝 **Yazı:** [cli-dispatch: Claude'a patron, DeepSeek'e işçi rolü veren bir plugin](https://medium.com/@rbinar/cli-dispatch-claudea-patron-deepseek-e-i%CC%87%C5%9F%C3%A7i-rol%C3%BC-veren-bir-plugin-b232803581fc) — Medium

![cli-dispatch demo — projende Claude Code başlat, sonra: install, /cli-dispatch:setup, /cli-dispatch:ds-run ve ds/ag/cx/oc/cp-runner ile delege et, kullanımı gör](assets/demo.gif)

> **Demo** — plugin'i kur, `/cli-dispatch:setup` ile backend(ler)ini seç ve yapılandır, ardından `/cli-dispatch:ds-run` / `ag-run` / `cx-run` / `oc-run` / `cp-run` veya `ds-/ag-/cx-/oc-/cp-runner` subagent'ları ile görev delege et. İşçi üretir; Claude Code canlı izler ve doğrular.

![cli-dispatch dashboard — canlı session listesi, subagent detayı (ds/ag/cx/oc/cp-runner), backend başına işçi session izi](assets/dashboard.gif)

> **Dashboard** (`/cli-dispatch:dashboard`) — tüm Claude Code session'larını, subagent'leri (ds/ag/cx/oc/cp-runner) ve bunların başlattığı işçi CLI session'larını canlı gösterir. Durum, görev ve backend başına iz gerçek zamanlı izlenir.

## Kurulum

> ⚠️ Bu komutlar **slash komutudur** ve **Claude Code CLI'ın içinden** çalıştırılmalıdır (normal terminal/shell'de değil). Önce `claude` yazıp Claude Code oturumunu başlat, komutları o oturumun prompt'una gir.

**Başlamadan önce — gerekenler:**
- `claude` CLI kurulu ve `PATH`'te
- `~/.local/bin` `PATH`'te — kontrol: `echo $PATH | grep -q local && echo tamam || echo 'ekle: export PATH="$HOME/.local/bin:$PATH" → ~/.zshrc'`
- Seçtiğin backend için API key/auth: DeepSeek ([platform.deepseek.com/api_keys](https://platform.deepseek.com/api_keys)) · Antigravity Google OAuth kullanır (`agy` girişi, key gerekmez) · Codex ChatGPT OAuth kullanır (`codex login`, key gerekmez) · OpenCode bir OpenRouter API key'i kullanır (kendin yapıştırırsın — [openrouter.ai/keys](https://openrouter.ai/keys), OAuth yok) · Copilot `gh auth login` veya `COPILOT_GITHUB_TOKEN`/`GH_TOKEN` ve aktif GitHub Copilot aboneliği kullanır

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

Install çıktısı `Run /reload-plugins to apply` der. Komutların (`/cli-dispatch:ds-*`) tanınması için bu adım zorunludur:

```text
/reload-plugins
```

> Reload sonrası hâlâ "Unknown command: /cli-dispatch:setup" alıyorsan, Claude Code'u tamamen kapatıp yeniden aç. `/plugin` komutuyla `cli-dispatch`'in yüklü ve **enabled** olduğunu doğrulayabilirsin.

**4. Adım — Kurulumu çalıştır** (plugin etkinleştikten sonra):

```text
/cli-dispatch:setup
```

`/cli-dispatch:setup` önce **hangi backend('ler)i kuracağını sorar** — DeepSeek, Antigravity (Gemini), Codex, OpenCode, Copilot ya da hepsi (`--backends all` veya `--backends deepseek,antigravity,codex,opencode,copilot`). Seçilen bir backend'in altındaki CLI (`claude`/`agy`/`codex`/`opencode`/`copilot`) eksik çıkarsa, `install.sh` bunu senin için otomatik kurmayı deneyebilir — `--install-missing` geç (opt-in, varsayılan kapalı; mümkün olduğunda npm tercih edilir, fallback olarak `curl | bash` vendor installer'lar). Setup bu bayrağı yalnızca senin açık onayını aldıktan ve hangi CLI'ların eksik olduğunu, hangi komutların çalışacağını gösterdikten sonra ekler; auth'u (sign-in, API key) asla otomatikleştirmez — detaylar için [CHANGELOG.md](CHANGELOG.md). **DeepSeek** için wrapper'ı `~/.local/bin/claude-ds`'e kurar ve `~/.config/cli-dispatch/config` iskeletini oluşturur; key hâlâ boşsa config'i **platformun varsayılan editöründe otomatik açar** (macOS `open`, Linux `xdg-open`, WSL `explorer.exe`, Windows `notepad`). Açılan dosyada DeepSeek API key'ini **kendin** ekle:

```bash
# ~/.config/cli-dispatch/config
DEEPSEEK_API_KEY="sk-..."     # kendi DeepSeek key'in
DS_MODEL="deepseek-v4-pro"
DS_FLASH_MODEL="deepseek-v4-flash"
```

> Farklı bir editör istiyorsan `CLI_DISPATCH_EDITOR` ortam değişkenini ayarla (ör. `CLI_DISPATCH_EDITOR="code"`; eski `CLAUDE_DS_EDITOR` da hâlâ geçerli). Otomatik açma başarısız olursa dosyayı elle aç: `${EDITOR:-nano} ~/.config/cli-dispatch/config`.

**Antigravity (Gemini)** backend'i için setup `ag-agent`/`ag-stream` kurar. `agy` CLI'ı (`curl -fsSL https://antigravity.google/cli/install.sh | bash`) + `script` (pseudo-TTY) + `node` gerekir; auth Google ile giriş (bir kez `agy` çalıştır) veya `GEMINI_API_KEY` ile. Native Windows: yalnızca DeepSeek — Antigravity için WSL kullan. agy **birden çok model ailesi** proxy'ler — `ag-agent --model "<ad>"` (veya `AG_MODEL` config default) ile seç: `Gemini 3.1 Pro (High)`, `Claude Opus 4.6 (Thinking)`, `GPT-OSS 120B (Medium)`, … (kesin liste için `agy models`; default `Gemini 3.5 Flash (High)`).

**Codex (OpenAI Codex CLI)** backend'i için setup `cx-agent`/`cx-stream` kurar. `codex` CLI'ı (≥ 0.142.3: `npm i -g @openai/codex`, `brew install --cask codex` veya `curl -fsSL https://chatgpt.com/codex/install.sh | sh`) + `node` gerekir; auth `codex login` (ChatGPT/OAuth — kişisel kullanım için API key gerekmez) veya `CODEX_API_KEY` (öncelikli) ya da `OPENAI_API_KEY` ile. Model seçimi: `cx-agent --model <ad>` (veya `CX_MODEL` config default; boş = codex'in kendi default'u). **Öne çıkan özellik:** `cx-agent --read-only` codex'in **gerçek OS-düzey sandbox'ını** aktive eder (macOS Seatbelt / Linux bwrap+seccomp) — yalnızca tool-katman kısıtlaması değil, kernel düzeyinde sert yazma engeli.

**OpenCode (OpenRouter üzerinden)** backend'i için setup `oc-agent`/`oc-stream` kurar. `opencode` CLI'ı (`npm i -g opencode-ai`) + `node` gerekir. Auth bir OpenRouter API key'idir (`OPENROUTER_API_KEY`) — **sen** yapıştırırsın, DeepSeek'in key'i için kullanılan otomatik-editör-açma mekanizmasıyla aynı şekilde (Claude/installer key değerini kendisi asla yazmaz). Model seçimi: setup, seçmeli bir soru ile 2-3 seçkin ücretsiz-katman OpenRouter slug'ından (ör. `google/gemma-4-31b-it:free`) bir default model ister ya da özel bir slug girmene izin verir; sonucu config'te `OC_MODEL`'e yazar. Çağrı başına `oc-agent --model <bare-slug>` ile override edebilirsin (`openrouter/` öneki gerekmez — `oc-stream` bunu ekler). Canlı model listesi için: `OPENROUTER_API_KEY=<key> opencode models openrouter`. **Önemli uyarı:** Codex'in `cx-agent --read-only`'sinin (gerçek, kernel düzeyinde zorunlu bir OS sandbox'ı) aksine, OpenCode'da **hiç sandbox yoktur** — ne OS-düzeyinde ne tool-katmanında yazma-engeli. `--auto` (dahili olarak her zaman kullanılır) her izin istemini otomatik onaylar, çünkü headless çalıştırmada isteme cevap verecek bir TTY yoktur — bu bir güvenlik özelliği değil, işlevsel bir gerekliliktir. İzolasyon yalnızca git worktree ile sağlanır (Antigravity backend'iyle aynı duruş). Native Windows: desteklenmez — OpenCode v1'de yalnızca Unix'te çalışır (macOS/Linux/WSL).

**GitHub Copilot** backend'i için setup `cp-agent`/`cp-stream` kurar. `copilot` CLI'ı (`npm i -g @github/copilot`, `brew install --cask copilot-cli` veya `curl -fsSL https://gh.io/copilot-install | bash`) + `node` ve Node 22+ gerekir. Auth sırası `COPILOT_GITHUB_TOKEN` > `GH_TOKEN` > `GITHUB_TOKEN`; cli-dispatch mümkünse `gh auth token` değerini otomatik `GH_TOKEN` olarak kullanır. Aktif GitHub Copilot aboneliği gerekir. Model seçimi: config'te `CP_MODEL` ayarla veya çağrı başına `cp-agent --model <slug>` kullan (örnekler: `gpt-5.4`, `auto`). Güncel model listesi yalnızca copilot TUI içinde `/model` ile (auth gerekir) veya GitHub Copilot docs'ta görülebilir; slug'lar zamanla değişir. Reasoning effort: `cp-agent --effort low|medium|high`, Copilot'ın `--reasoning-effort=<seviye>` bayrağına eşlenir. **Önemli uyarı:** OpenCode gibi Copilot'ta da **hiç sandbox yoktur** — ne OS-düzeyinde ne tool-katmanında yazma-engeli. `--allow-all-tools --no-ask-user` headless kullanım için dahili olarak her zaman geçilir; güvenlik özelliği değil, işlevsel gerekliliktir. İzolasyon yalnızca git worktree ile sağlanır. Native Windows: desteklenmez — Copilot v1'de yalnızca Unix'te çalışır (macOS/Linux/WSL).

DeepSeek key'i: https://platform.deepseek.com/api_keys

`/cli-dispatch:setup` artık son bir adımda, evet/hayır tarzı bir soruyla, global veya proje `CLAUDE.md`'ine kalıcı bir "bu runner'lara delege etmeyi tercih et" hatırlatması yazmayı önerir, böylece her oturumda delegasyon tercihini yeniden anlatman gerekmez (idempotent/marker-guarded, tekrar setup çalıştırmak onu çoğaltmaz).

## Güncelleme

Plugin'i Claude Code içinden güncelle, sonra reload et (teker teker çalıştır):

```text
/plugin update cli-dispatch
/reload-plugins
```

`/plugin update` marketplace'ten en yeni sürümü çeker; `/reload-plugins` çalışan oturuma uygular
(tam yeniden başlatma olmadan). `/cli-dispatch:status` ile doğrula.

> ℹ️ `/plugin update` yalnızca **komutları/skill'leri** yeniler — `~/.local/bin`'deki worker
> wrapper'larını **yeniden kurmaz**. Bir wrapper'ı değiştiren bir güncellemeden sonra (örn. yeni
> bir disk alanı) wrapper'ları yeniden kurmak için bir kez **`/cli-dispatch:setup`** çalıştır.

<video src="https://github.com/rbinar/cli-dispatch/raw/main/assets/update.mp4" controls width="820"></video>

> ▶️ [Güncelleme demosunu izle (mp4)](assets/update.mp4) — Claude Code içinde `/plugin update` sonra `/reload-plugins`.

## Dashboard

```text
/cli-dispatch:dashboard
```

Disk'te zaten var olan veriler üzerinde **local, salt-okunur web dashboard**. Aktif Claude Code
CLI session'larını listeler (tüm projeler, **busy** olanlar üstte sabit); bir session'a tıkla →
**akışını** gör (mesajlar / tool çağrıları / sonuçlar), spawn ettiği **subagent'ları** gör,
subagent'a tıkla → *onun* akışına in (spawn derinliğine göre iç içe). İkinci panel cli-dispatch
**worker** delegasyonlarını (DeepSeek / Antigravity / Codex / OpenCode / Copilot) durum + akışla gösterir. Busy
session'lar otomatik yenilenir. Dashboard artık cli-dispatch config dosyası için bir **Config** sekmesi/editörü içerir — secret alanlar (API key'ler) write-only'dir (kaydedildikten sonra asla geri gösterilmez); maskelenmiş bir önizleme (ör. `sk-e78f...ea1b`, ilk 6 + son 4 karakter) hangi key'in ayarlı olduğunu göstermeni sağlar. Secret olmayan alanlar (`*_MODEL` / `*_MODELS` alanları vb.) tarayıcıda doğrudan görüntülenebilir ve düzenlenebilir.

`~/.claude/projects/**`, `~/.claude/sessions/*.json` (canlı busy/idle) ve
`~/.cache/cli-dispatch/sessions/**` (worker'lar) okur. Notlar:
- **Plugin'in başlattığı tek uzun-süreli süreç.** Yalnızca `127.0.0.1`'e bağlanır, kesinlikle
  **salt-okunur**, config/key'lere asla dokunmaz. Yazdırılan `kill <pid>` ile durdur (ya da
  terminalde `cli-dispatch-dashboard` çalıştırdıysan Ctrl-C).
- Claude Code'un disk transcript formatı internal'dır ve sürümler arası değişebilir; dashboard
  bilinmeyen yapıları savunmacı render eder.

## Kullanım

cli-dispatch'i **Claude Code'un içinden** kullanırsın — iki yol:

1. **Slash komutları** (aşağıdaki tablo) — `claude` oturumunun prompt'una yazılır.
2. **Doğal dille** — "deepseek ile şunu yap", "codex ile çalıştır", "gemini'ye delege et" dersin; skill devreye girer ve Claude Code işi eşleşen backend'de yürütür.

| Komut | İş |
|-------|-----|
| `/cli-dispatch:setup` | Backend(ler) seç + kur + config iskeleti + smoke test |
| `/cli-dispatch:dashboard` | Local web dashboard'u aç — Claude Code session → akış → subagent → akış, + worker paneli |
| `/cli-dispatch:ds-run <görev>` | Bir görevi **DeepSeek**'e delege et (session-takipli; repo görevinde worktree izolasyonu) |
| `/cli-dispatch:ag-run <görev>` | Bir görevi **Antigravity (Gemini)**'ye delege et (aynı akış) |
| `/cli-dispatch:cx-run <görev>` | Bir görevi **Codex (OpenAI)**'e delege et (gerçek read-only sandbox; aynı session düzeni) |
| `/cli-dispatch:oc-run <görev>` | Bir görevi **OpenCode (OpenRouter)**'a delege et (sandbox yok — yalnızca worktree izolasyonu; aynı session düzeni) |
| `/cli-dispatch:cp-run <görev>` | Bir görevi **GitHub Copilot**'a delege et (sandbox yok — yalnızca worktree izolasyonu; aynı session düzeni) |
| `/cli-dispatch:sessions` | Geçmiş/aktif session'ları listele (tüm backend'ler; `backend` kolonu) |
| `/cli-dispatch:ds-sessions` / `ag-sessions` / `cx-sessions` / `oc-sessions` / `cp-sessions` | Aynı liste, yalnızca DeepSeek / Antigravity / Codex / OpenCode / Copilot'a filtreli |
| `/cli-dispatch:watch <id>` | Bir session'ın canlı durumunu göster (maliyet-odaklı) |
| `/cli-dispatch:resume <id> <prompt>` | Bir worker session'a follow-up göndererek devam et (backend otomatik tespit) |
| `/cli-dispatch:kill <id>` | Çalışan worker session'ı durdur (SIGTERM + state → killed) |
| `/cli-dispatch:clean` | Stale worker dizinlerini (`running` ama ölü) temizle; varsayılan dry-run, `--remove` ile siler. Silinen session ile birlikte `verdict.json` ve `verdict-diff.patch` de gider; dry-run'da kalan patch'li adaylar işaretlenir, `--preserve-verdicts` bunları `<sessions-root>/verdict-archive/` altında saklar. |
| `/cli-dispatch:clean-schedule` | OS zamanlayıcısıyla günlük otomatik temizlik kur (launchd / cron / Scheduled Tasks); `status` / `uninstall` da var |
| `/cli-dispatch:status` | Tüm backend'ler için kurulum/key/CLI durumunu kontrol et |
| `/cli-dispatch:ds-status` / `ag-status` / `cx-status` / `oc-status` / `cp-status` | Aynı kontrol, yalnızca DeepSeek / Antigravity / Codex / OpenCode / Copilot kapsamında |
| `/cli-dispatch:balance` | Toplu — DeepSeek bakiyesi + Antigravity kotası + Codex rate limit + OpenCode kredisi + Copilot kullanım notu, hepsi bir arada |
| `/cli-dispatch:ds-balance` | DeepSeek hesap bakiyesini göster |
| `/cli-dispatch:cx-balance` | Codex kullanım / rate limit (5h + haftalık kalan %) — native, codex'in kendi disk session kayıtlarından |
| `/cli-dispatch:ag-balance` | Antigravity kotası (model başına kalan % + plan) — native, local language-server `GetUserStatus` RPC ile |
| `/cli-dispatch:oc-balance` | OpenCode'un OpenRouter paid-credit bakiyesini göster (`total_credits - total_usage`) — `:free` modellerin kota API'si yok |
| `/cli-dispatch:cp-balance` | Copilot kullanım görünürlüğünü açıklar — CLI'dan sorgulanamaz; GitHub Billing kullanılır |
| `/cli-dispatch:doctor` | Tüm backend'ler için sağlık kontrolü — PATH, API key'ler, CLI auth ✓/✗ |
| `/cli-dispatch:help` | Tek ekranda komut referans tablosu |

## Özellikler

Hepsi Claude Code içinden kullanılır (`/cli-dispatch:ds-run <görev>`, `/cli-dispatch:cx-run`, `/cli-dispatch:ag-run`, `/cli-dispatch:oc-run`, `/cli-dispatch:cp-run` ya da "deepseek/codex/gemini/opencode/copilot ile <görev>"):

- **Beş işçi backend, tek hub** — **DeepSeek** (`ds-*`), **Antigravity / Gemini** (`ag-*`), **Codex / OpenAI** (`cx-*`), **OpenCode / OpenRouter** (`oc-*`), **GitHub Copilot** (`cp-*`). Setup'ta birini (veya hepsini) seç; beşi de **aynı session düzenine** yazar, böylece `sessions`, `watch`, `clean`, balance komutları ve dashboard her backend'de çalışır.
- **Delege & doğrula** — işçi üretir/uygular; Claude Code canlı izler ve çıktıyı doğrular. Konuşma bağlamı paylaşılmaz → görev **kendine yeten** olmalı. İşçi = yapan, sen = inceleyen/merge sahibi.
- **Session takibi (canlı izleme + resume)** — iş opak bir arka plan süreci değildir; her çalışma bir session dizini yazar (status / progress / transcript / meta + tam prompt) ve izlenebilir/sürdürülebilir. → [Session takibi](#session-takibi-canlı-izleme--resume)
- **`--read-only` mod (Codex = gerçek OS sandbox)** — `cx-agent --read-only` **kernel-zorunlu** yazma-yok sandbox'ı aktive eder (macOS Seatbelt / Linux bwrap+seccomp). DeepSeek'in `--read-only`'si araç-katmanı kısıtı; Antigravity, OpenCode ve Copilot'ta hiç yazma-engeli yok (worktree'de izole et).
- **agentic + worktree izolasyonu** — gerçek repo görevleri tek-kullanımlık git worktree'de çalışır; diff **commit'siz** bırakılır (incele → build/test → merge **sende/Claude'da**). Yardımcılar: `ds-/ag-/cx-/oc-/cp-worktree-run`.
- **Backend başına runner subagent (`ds-/ag-/cx-/oc-/cp-runner`)** — tüm delegasyonu izole bir alt-bağlama devret; modu seçer, işi izole eder, doğrular, kısa sonuç döner — yönetim gürültüsü orkestratöre girmez. → [runner subagent'lar](#ds-runner-subagent-bağlamı-temiz-tut)
- **Çok adaylı model seçimi** — `ag-`/`cx-`/`oc-`/`cp-runner`'a delege ederken (ds-runner hariç) görev prompt'unda 2+ aday model verebilirsin; babysitter subagent hangisinin işe en uygun olduğuna karar verip birini seçer ve seçimi + nedenini raporlar. Aynı dört backend ayrıca config dosyasında kalıcı bir virgülle-ayrılmış aday listesi de destekler (`AG_MODELS`, `CX_MODELS`, `OC_MODELS`, `CP_MODELS` — çoğul, mevcut tekil `AG_MODEL`/`CX_MODEL`/`OC_MODEL`/`CP_MODEL`'in yanında), böylece her seferinde listeyi yeniden yazmana gerek kalmaz. Prompt'ta açık model/liste verilmezse runner önce config listesine bakar, yoksa tekil default'a döner.
- **Web dashboard** — local, salt-okunur: Claude Code session'ları → akış → subagent'lar → akış, + worker paneli. Üstte sabit görev/talimat, Markdown render, stale-worker tespiti, canlı SSE. → [Dashboard](#dashboard)
- **Native kullanım / kota** — `/cli-dispatch:balance` (beşi birden) ya da backend başına `*-balance`; mümkün olduğunda her CLI'nın kendi local verisinden, **üçüncü-parti araç yok**. Copilot CLI'dan sorgulanamaz. → [Kullanım & kota](#kullanım--kota--native-üçüncü-parti-araç-yok)
- **Dashboard maliyet & kullanım görünürlüğü** — dashboard her session/subagent için Anthropic token kullanımını, worker başına toplam delegasyon maliyetini, babysitter'ın kendi token kullanımı worker'ınkine göre orantısız yüksekse bir "high overhead" uyarı rozetini ve her Claude Code session/subagent'ının gerçekte hangi modeli kullandığını gösteren bir model rozetini gösterir; böylece düşük-değerli veya yüksek-overhead delegasyonları kolayca fark edebilirsin.
- **Temizlik** — `/cli-dispatch:clean` stale (`running` ama ölü) worker dizinlerini budar; `/cli-dispatch:clean-schedule` bunu launchd / cron / Scheduled Tasks ile günlük otomatikleştirir.
- **timeout güvenlik ağı** — asılı/kaçak işçi, süre veya durgunluk limitinde (çocuk süreçleriyle birlikte) otomatik öldürülür; session `state: error` olur.
- **global MCP izolasyonu** — işçiler senin `~/.claude` MCP sunucularını (playwright, vb.) miras almaz.

> ⚠️ **Varsayılan mod bir sandbox değildir.** İşçiler agentic çalışır → **dosya yazabilir / bash çalıştırabilir**. Gerçek repo işini worktree'de izole et; garantili "dosya yazmaz" için `--read-only` kullan (**Codex**'te bu garanti kernel-zorunlu).

## Session takibi (canlı izleme + resume)

Delege edilen iş **opak bir arka plan süreci değildir**: her backend'in çıktısı parse edilip her görev bir **session dizinine** yazılır (DeepSeek, Antigravity, Codex, OpenCode ve Copilot için aynı düzen). İşçinin ne yaptığını `/cli-dispatch:sessions` ve `/cli-dispatch:watch <id>` ile **canlı, yapılandırılmış ve resume-edilebilir** şekilde takip edersin.

Session dizini: `${XDG_CACHE_HOME:-$HOME/.cache}/cli-dispatch/sessions/<id>/` (eski `claude-ds` yolu hâlâ fallback olarak okunur)

| Dosya | İçerik |
|-------|--------|
| `status.json` | Kompakt özet (durum, son tool, tool sayıları, sonuç önizlemesi) — **izlemek için tek okunan dosya** |
| `progress.log` | Terse insan-okur akış (`▸ Edit foo.ts`, `✓ / ✗`, kısaltılmış metin) |
| `transcript.jsonl` | Ham stream-json (resume/audit; izlerken okunmaz) |
| `meta.json` | Prompt önizlemesi, cwd, branch, model, başlangıç/bitiş |
| `prompt.txt` | **Tam** görev prompt'u (kısaltmasız; worker'ın dashboard sayfasında üstte sabit gösterilir) |

**Maliyet-odaklı izleme:** ilerleme yalnızca küçük `status.json`'dan takip edilir (`/cli-dispatch:watch <id>`); ham transcript okunmaz, sıkı döngüde tail edilmez — orkestratörün her okuması token harcadığı için.

> Gereksinim: session takibi/parse için `node` gerekir (claude-code zaten node ortamında çalışır).

## ds-runner subagent (bağlamı temiz tut)

Bir delegasyonu adım adım kendin yönetmek yerine, tümünü paketlenmiş **`ds-runner`**
subagent'ına devredebilirsin (Claude Code içinde "şu görevi ds-runner ile yap" dersin).
O; modu seçer, işi izole eder, **doğrular** (repo/kod görevinde build/test) ve kısa bir sonuç
döndürür — yönetim gürültüsü orkestratörün bağlamına hiç girmez. İşçi her zaman DeepSeek'tir;
subagent'ın *kendi* (babysitter) modelini Claude Code zorluğa göre seçer (Claude Code içeride
şu çağrıyı yapar, sen `Agent(...)`'ı elle yazmazsın):

```text
Agent(subagent_type="ds-runner", model="haiku",  prompt="<kendine yeten görev>")   # saf üretim/analiz
Agent(subagent_type="ds-runner", model="sonnet", prompt="<repo/kod görevi>")        # build/test doğrulaması gerekir
```

Uzun/agentic işler, doğrulama ya da paralel birden çok iş için değerli; tek-atışlık basit işte
doğrudan `/cli-dispatch:ds-run` yeter.

## cx-runner subagent (Codex ikizi — bağlamı temiz tut)

Codex backend'inin kendi paralel subagent'ı vardır: **`cx-runner`**. `ds-runner` ile aynı şekilde çalışır — modu seçer, gerektiğinde işi git worktree'de izole eder, **doğrular** (repo görevinde build/test) ve kısa bir sonuç döndürür — ancak işçi her zaman Codex'tir. Diğer backend'lere göre öne çıkan avantajı Mod A'dır: `--read-only`, **gerçek bir OS-düzey sandbox** (macOS Seatbelt / Linux bwrap+seccomp) aktive eder; kernel düzeyinde sert yazma engeli — gerçek bir yazma garantisi için worktree gerekmez. Claude Code içinde "şu görevi cx-runner ile yap" dersin veya `Agent(subagent_type="cx-runner", ...)` kullanırsın.

## ag-runner subagent (Antigravity ikizi — bağlamı temiz tut)

Antigravity backend'inin kendi paralel subagent'ı vardır: **`ag-runner`**. `ds-runner` ile aynı şekilde çalışır — modu seçer, gerektiğinde işi git worktree'de izole eder, **doğrular** (repo görevinde build/test) ve kısa bir sonuç döndürür — ancak işçi her zaman Antigravity'dir (`agy` / `ag-agent` ile). agy birden çok model ailesi proxy'ler (Gemini, Claude, GPT — güncel liste için `agy models`), bu sayede delege akışını değiştirmeden işçiyi değiştirebilirsin. Claude Code içinde "şu görevi ag-runner ile yap" dersin veya `Agent(subagent_type="ag-runner", ...)` kullanırsın.

## oc-runner subagent (OpenCode ikizi — bağlamı temiz tut)

OpenCode backend'inin kendi paralel subagent'ı vardır: **`oc-runner`**. `ds-runner` ile aynı şekilde çalışır — modu seçer, gerektiğinde işi git worktree'de izole eder, **doğrular** (repo görevinde build/test) ve kısa bir sonuç döndürür — ancak işçi her zaman OpenCode'dur (OpenRouter üzerinden, `oc-agent` / `oc-stream` ile). İki ayrıcalığı vardır: (a) OpenCode'da hiç sandbox yok — ne OS-düzeyinde ne tool-katmanında yazma-engeli; izolasyon yalnızca git worktree ile sağlanır (Antigravity ile aynı duruş). (b) Model seçimi **bare OpenRouter slug'ları** kullanır, `openrouter/` öneki gerekmez (`oc-stream` otomatik ekler); örneğin `oc-agent --model google/gemma-4-31b-it:free`. Claude Code içinde "şu görevi oc-runner ile yap" dersin veya `Agent(subagent_type="oc-runner", ...)` kullanırsın.

## cp-runner subagent (GitHub Copilot ikizi — bağlamı temiz tut)

GitHub Copilot backend'inin kendi paralel subagent'ı vardır: **`cp-runner`**. `ds-runner` ile aynı şekilde çalışır — modu seçer, gerektiğinde işi git worktree'de izole eder, **doğrular** (repo görevinde build/test) ve kısa bir sonuç döndürür — ancak işçi her zaman GitHub Copilot'tur (`cp-agent` / `cp-stream` ile). İki ayrıcalığı vardır: (a) Copilot'ta da hiç sandbox yok — ne OS-düzeyinde ne tool-katmanında yazma-engeli; izolasyon yalnızca git worktree ile sağlanır. (b) Aktif bir GitHub Copilot aboneliği ve `gh` / `GH_TOKEN` auth gerekir; öncelik sırası `COPILOT_GITHUB_TOKEN` > `GH_TOKEN` > `GITHUB_TOKEN`, cli-dispatch mümkünse `gh auth token` değerini otomatik `GH_TOKEN` olarak kullanır. Claude Code içinde "şu görevi cp-runner ile yap" dersin veya `Agent(subagent_type="cp-runner", ...)` kullanırsın.

## Kullanım & kota — native, üçüncü-parti araç yok

"Limitimden ne kadar kaldı?" — **her** backend için, ekstra hiçbir şey kurmadan yanıtlanır.
Her `*-balance` komutu, CLI'ın zaten yerelde tuttuğu veriyi tersine mühendislikle okur; senin
adına ağ üzerinden yeni bir şey gönderilmez.

| Backend | Komut | Sayı nereden geliyor |
|---|---|---|
| **DeepSeek** | `/cli-dispatch:ds-balance` | DeepSeek'in resmi REST balance API'si (`/user/balance`), `DEEPSEEK_API_KEY` ile. |
| **Codex** | `/cli-dispatch:cx-balance` | Codex, backend'in rate-limit verisini kendi session kayıtlarına **yazıyor** (`~/.codex/sessions/**/*.jsonl`). Komut en güncel `token_count` kaydının `rate_limits`'ini okur → `primary` (5h) + `secondary` (7d) pencereleri **kalan %** + reset. Ağ yok. |
| **Antigravity** | `/cli-dispatch:ag-balance` | Local Antigravity **language server** (IDE/`agy`'nin zaten çalıştırdığı) bir Connect-RPC `GetUserStatus` endpoint'i sunar. Komut çalışan `language_server` process'ini bulur, `--csrf_token` arg + dinlenen port'u okur, `GetUserStatus`'a `POST` atar → plan + **model-başına `remainingFraction`** + reset. |
| **OpenCode** | `/cli-dispatch:oc-balance` | OpenRouter'ın resmi REST endpoint'i (`GET /api/v1/credits`), `OPENROUTER_API_KEY` ile → `total_credits - total_usage` kalan bakiye. **Sadece ücretli-kredi bakiyesi** — `:free` ekli modellerin ayrı, kimliksiz, model-başına rate limiti var, scriptable kota API'si yok. |
| **GitHub Copilot** | `/cli-dispatch:cp-balance` | `copilot` CLI'dan sorgulanamaz. `/usage` yalnızca Copilot REPL içinde session-kapsamlı ve interaktiftir; gerçek kullanım/limitler için GitHub Billing (https://github.com/settings/billing) kullanılır. |

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

## Kaputun altı (ileri düzey)

Plugin, Claude Code'un **Bash ile çağırdığı** taşınabilir CLI'ları `~/.local/bin`'e kurar —
normalde bunları **sen çağırmazsın**, Claude Code yönetir:

| CLI | Ne |
|-----|----|
| `claude-ds` | Düz env wrapper (`claude`'u DeepSeek'e yönlendirir; parse/session yok) |
| `claude-ds-stream` | Session-takipli varyant (stream-json parse + status/progress/transcript) |
| `ds-agent` | Tek-komut senkron sarmalayıcı: görev → çalış → cevap (stdout); ilerleme stderr'de |
| `ag-stream` | Session-takipli Antigravity wrapper (agy'nin disk JSONL transcript'ini tail eder) |
| `ag-agent` | agy için tek-komut senkron sarmalayıcı: görev → çalış → cevap (stdout) |
| `cx-stream` | Session-takipli Codex wrapper (codex'in JSONL stdout'unu parser'dan geçirir) |
| `cx-agent` | codex için tek-komut senkron sarmalayıcı: görev → çalış → cevap (stdout) |
| `oc-stream` | Session-takipli OpenCode wrapper (opencode'un JSON stream'ini parser'dan geçirir) |
| `oc-agent` | opencode için tek-komut senkron sarmalayıcı: görev → çalış → cevap (stdout) |
| `cp-stream` | Session-takipli GitHub Copilot wrapper (copilot'ın JSON stream'ini parser'dan geçirir) |
| `cp-agent` | copilot için tek-komut senkron sarmalayıcı: görev → çalış → cevap (stdout) |

İstersen terminalden de doğrudan kullanabilirsin (ör. plugin dışı script'lerde):

```bash
ds-agent --read-only "soru"             # tek komut; cevap stdout'a
ds-agent --cwd /tmp/x "dosya üret"      # agentic, izole dizin
claude-ds-stream --resume <id> -p "…"   # mevcut session'a devam

cx-agent --read-only -q "soru"          # read-only: kernel düzeyinde sandbox (macOS Seatbelt / Linux bwrap)
cx-agent --cwd /tmp/x "dosya üret"      # agentic, izole dizin
cx-agent --resume <thread-id> "devam"                # resume saklanan bağlamı kullanır; --cwd resume'da desteklenmez

cp-agent -q "soru"                      # tek komut; cevap stdout'a
cp-agent --cwd /tmp/x "dosya üret"      # agentic, izole dizin
cp-agent --effort high --model gpt-5.4 "görev"
cp-agent --resume <session-id> "devam"
```

Bayraklar (cx-agent / cx-stream): `--read-only`, `--sandbox <mod>`, `--cwd <dir>`, `--resume <id>`, `--model <m>`, `--max-runtime`/`--idle-timeout`, `-q`.
Bayraklar (cp-agent / cp-stream): `--cwd <dir>`, `--resume <id>`, `--model <m>`, `--effort low|medium|high`, `--max-runtime`/`--idle-timeout`, `-q`.
(`cx-runner` bunlardan biri **değildir** — o bir Claude Code subagent'ıdır, `~/.local/bin`'de yer almaz.)

> 📄 Terminalden kurulum, tüm komutlar, bayraklar ve env override'larının tam referansı: [TERMINAL.md](TERMINAL.md).

## Windows

Native Windows'ta (WSL kullanmıyorsan) PowerShell varyantları devreye girer. **DeepSeek ve Codex** native çalışır; Antigravity bir pseudo-TTY gerektirdiğinden, OpenCode/Copilot ise v1'de Unix-only olduğundan WSL altında kurulmalı.

- `/cli-dispatch:setup` → `install.ps1 -Backends <deepseek,codex|all>` çalışır (varsayılan `deepseek`):
  - **DeepSeek**: `claude-ds.ps1` + `claude-ds-stream.ps1` + `ds-agent.ps1` ve `.cmd` shim'lerini `~/.local/bin`'e, parser'ı (`ds-stream-parse.mjs`) `~/.local/share/cli-dispatch`'e kurar.
  - **Codex**: `cx-stream.ps1` + `cx-agent.ps1` + `.cmd` shim'leri ve parser'ı (`cx-stream-parse.mjs`) kurar. Auth: `codex login` (ya da config'te `CODEX_API_KEY`). Gerçek `-s read-only` sandbox dahil.
  - Dashboard her zaman kurulur; config `~/.config/cli-dispatch/config`'e yazılır.
  - `install.ps1`'e `-InstallMissing` ekleyerek eksik bir worker CLI'ını otomatik kurmayı denetebilirsin (npm, ya da bir vendor fallback) ve `Get-Command` ile yeniden kontrol eder; başarısızlıkta mevcut uyarıya düşer — opt-in, varsayılan kapalı; auth asla otomatikleştirilmez.
- Repo görevleri: `ds-worktree-run.ps1` / `cx-worktree-run.ps1` — `node_modules` için symlink yerine **junction** (`New-Item -ItemType Junction`; admin/developer-mode gerektirmez) kullanır.
- WSL ya da Git Bash varsa Unix `.sh` scriptleri de çalışır.

Gereksinim: PowerShell 5.1+ veya pwsh 7+; DeepSeek için `claude`, Codex için `codex` PATH'te.

## Kaldırma (Uninstall)

Tam temizlik için sırayla: (1) plugin'i kaldır, (2) wrapper + config dosyalarını sil, (3) varsa geçici worktree'leri temizle.

**1. Adım — Plugin'i ve marketplace'i kaldır** (Claude Code CLI içinden):

```text
/plugin uninstall cli-dispatch@cli-dispatch
/plugin marketplace remove cli-dispatch
/reload-plugins
```

**2. Adım — Wrapper ve config dosyalarını sil:**

```bash
# macOS / Linux / WSL / Git Bash
rm -f  ~/.local/bin/claude-ds ~/.local/bin/claude-ds-stream
rm -rf ~/.local/share/cli-dispatch ~/.local/share/claude-ds   # stream parser'ları (eski yol dahil)
rm -rf ~/.cache/cli-dispatch ~/.cache/claude-ds               # session kayıtları (eski yol dahil)
rm -rf ~/.config/cli-dispatch ~/.config/claude-ds             # config (API key dahil) — silinince key de gider (eski yol dahil)
```

```powershell
# Native Windows (PowerShell)
Remove-Item -Force "$HOME\.local\bin\claude-ds.ps1","$HOME\.local\bin\claude-ds.cmd","$HOME\.local\bin\claude-ds-stream.ps1","$HOME\.local\bin\claude-ds-stream.cmd" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force "$HOME\.local\share\claude-ds" -ErrorAction SilentlyContinue   # stream parser
Remove-Item -Recurse -Force "$HOME\.cache\claude-ds" -ErrorAction SilentlyContinue          # session kayıtları
Remove-Item -Recurse -Force "$HOME\.config\claude-ds" -ErrorAction SilentlyContinue
```

**3. Adım — (Opsiyonel) geçici worktree'leri temizle:**

`/cli-dispatch:ds-run` veya `ds-worktree-run.sh` kullandıysan ayrı git worktree'ler kalmış olabilir. İlgili repoda kontrol et:

```bash
git worktree list          # claude-ds'in açtığı worktree'leri gör
git worktree remove <yol>  # gereksizleri kaldır
git worktree prune         # ölü kayıtları temizle
```

> Not: PATH'e `~/.local/bin`'i bu plugin için elle eklediysen ve başka bir şey kullanmıyorsan, shell profilinden (`~/.zshrc`, `~/.bashrc` vb.) o satırı da kaldırabilirsin. DeepSeek hesabındaki API key'i iptal etmek istersen https://platform.deepseek.com/api_keys üzerinden sil.

## Güvenlik ve veri

- **Key'ler makineden çıkmaz:** varsa key `~/.config/cli-dispatch/config` içinde (0600, repo dışında) tutulur ve **asla commit edilmez**. Plugin/skill key'i hiçbir yere yazmaz; sen eklersin. (Codex ve Antigravity normalde kendi OAuth girişlerini kullanır — config'te key bile olmaz.)
- **Veri egress:** bir işçiye verdiğin **prompt ve kod o backend'in sağlayıcısına gönderilir** — DeepSeek, Google (Gemini/Antigravity), OpenAI (Codex), OpenRouter/OpenCode veya GitHub Copilot. Her birini yalnızca bunu kabul ediyorsan kullan. Dashboard ve `*-balance` komutları local/salt-okunur; senin adına ekstra bir şey göndermez.
- **İzole çalışma:** gerçek repo görevleri ayrı git worktree'de çalışır; agentic mod ana checkout'a/diğer branch'lere dokunmaz. Üreteni inceleyip (diff + build/test) merge etmek **sana** kalır.
- **GitHub CLI (`gh`) kimlik aktarımı:** macOS'ta `gh` token'ını sistem Keychain'inde tutar; sandbox'lı worker'lar (Codex `workspace-write`, DeepSeek, agy, OpenCode, Copilot) buna erişemez — bu yüzden delege edilen `gh issue`/`gh pr`/`gh api` çağrıları sessizce başarısız olur. Giriş yapmışsan (`gh auth token` çalışıyorsa) ve kendin `GH_TOKEN`/`GITHUB_TOKEN` set etmemişsen, runner'lar **`gh` token'ını worker'a `GH_TOKEN` olarak aktarır**; böylece worker'ın `gh` çağrıları kimlik doğrular. Copilot, `COPILOT_GITHUB_TOKEN` açıkça set değilse bu token yolunu da kullanır. Token geniş kapsam taşıyabilir (`repo`, `workflow`, hatta `delete_repo`) ve worker sandbox'ına / sağlayıcı bağlamına gider — **devre dışı bırakmak** için `CLI_DISPATCH_NO_GH_TOKEN=1`. `/cli-dispatch:doctor` mevcut durumu raporlar.

## Mimari rol

İşçi (DeepSeek / Gemini / Codex / OpenCode / Copilot) = yapan (üretim/uygulama). Sen (Claude Code, Anthropic) = orkestratör + reviewer + git/merge sahibi. Bir işçinin çıktısını doğrulamadan güvenme.

## Lisans

MIT — bkz. [LICENSE](LICENSE).
