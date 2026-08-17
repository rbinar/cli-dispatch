# cli-dispatch

> 🌐 **Diller:** **Türkçe** · [English](README.md)

**DeepSeek, Gemini, OpenAI Codex, OpenCode'u (OpenRouter üzerinden) veya GitHub Copilot'ı Claude Code içinden delege işçi olarak kullan.** Claude Code'un yerleşik subagent aracı yalnızca Anthropic modellerini destekler — cli-dispatch, mevcut `claude` oturumundan bu beş backend'e görev delege edebilmen için taşınabilir wrapper'lar kurar.

> ℹ️ **Çok-backend delege hub'ı.** Beş işçi backend'i var — **DeepSeek** (`/cli-dispatch:ds-*`), **Antigravity/Gemini** (`/cli-dispatch:ag-run`, wrapper'lar `ag-agent`/`ag-stream`), **Codex** (`/cli-dispatch:cx-run`, `cx-agent`/`cx-stream`), **OpenCode** (`/cli-dispatch:oc-run`, `oc-agent`/`oc-stream`) ve **GitHub Copilot** (`/cli-dispatch:cp-run`, `cp-agent`/`cp-stream`). Hangisini kuracağını setup'ta seçersin. Beşi de aynı session düzenine yazar; `sessions`/`watch` hepsinde çalışır. DeepSeek wrapper/config yolları `claude-ds` adını korur (o backend'in adı).

> 📝 **Yazı:** [cli-dispatch: Claude'a patron, DeepSeek'e işçi rolü veren bir plugin](https://medium.com/@rbinar/cli-dispatch-claudea-patron-deepseek-e-i%CC%87%C5%9F%C3%A7i-rol%C3%BC-veren-bir-plugin-b232803581fc) — Medium

![cli-dispatch demo — projende Claude Code başlat, sonra: install, /cli-dispatch:setup, /cli-dispatch:ds-run ve deterministik /cli-dispatch:run ile delege et, kullanımı gör](assets/demo.gif)

> **Demo** — plugin'i kur, `/cli-dispatch:setup` ile backend(ler)ini seç ve yapılandır, ardından `/cli-dispatch:ds-run` / `ag-run` / `cx-run` / `oc-run` / `cp-run` ile ya da deterministik, babysitter'sız yol için `/cli-dispatch:run <backend> "<görev>" --verify '<cmd>'` ile görev delege et. İşçi üretir; Claude Code canlı izler ve doğrular.

![cli-dispatch dashboard — canlı session listesi, subagent detayı, backend başına işçi session izi](assets/dashboard.gif)

> **Dashboard** (`/cli-dispatch:dashboard`) — tüm Claude Code session'larını, spawn ettikleri subagent'ları ve cli-dispatch ile delege edilen işçi CLI session'larını canlı gösterir. Durum, görev ve backend başına iz gerçek zamanlı izlenir.

## Kurulum

> ⚠️ Bu komutlar **slash komutudur** ve **Claude Code CLI'ın içinden** çalıştırılmalıdır (normal terminal/shell'de değil). Önce `claude` yazıp Claude Code oturumunu başlat, komutları o oturumun prompt'una gir.

**Başlamadan önce — gerekenler:**
- `claude` CLI kurulu ve `PATH`'te
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

Install çıktısı `Run /reload-plugins to apply` der. Komutların (`/cli-dispatch:ds-*`) tanınması için bu adım zorunludur:

```text
/reload-plugins
```

> Reload sonrası hâlâ "Unknown command: /cli-dispatch:setup" alıyorsan, Claude Code'u tamamen kapatıp yeniden aç. `/plugin` komutuyla `cli-dispatch`'in yüklü ve **enabled** olduğunu doğrulayabilirsin.

**4. Adım — Kurulumu çalıştır** (plugin etkinleştikten sonra):

```text
/cli-dispatch:setup
```

`/cli-dispatch:setup` önce **hangi backend('ler)i kuracağını sorar** — DeepSeek, Antigravity (Gemini), Codex, OpenCode, Copilot ya da hepsi (`--backends all` veya `--backends deepseek,antigravity,codex,opencode,copilot`). Seçilen bir backend'in altındaki CLI eksik çıkarsa, `install.sh` bunu senin için otomatik kurmayı deneyebilir — `--install-missing` geç (opt-in, varsayılan kapalı; mümkün olduğunda npm tercih edilir, fallback olarak `curl | bash` vendor installer'lar). Setup bu bayrağı yalnızca senin açık onayını aldıktan ve hangi CLI'ların eksik olduğunu, hangi komutların çalışacağını gösterdikten sonra ekler; auth'u (sign-in, API key) asla otomatikleştirmez. Detaylar için [CHANGELOG.md](CHANGELOG.md).

| Backend | CLI (kurulum) | Auth | Model seçimi |
|---|---|---|---|
| **DeepSeek** | `claude` (zaten kurulu) | Config'te `DEEPSEEK_API_KEY` ([edin](https://platform.deepseek.com/api_keys)) | `DS_MODEL` / `DS_FLASH_MODEL` |
| **Antigravity (Gemini)** | `agy` — `curl -fsSL https://antigravity.google/cli/install.sh \| bash` (+ `script`, `node`) | Google girişi (bir kez `agy` çalıştır) veya `GEMINI_API_KEY` | `--model "<ad>"` / `AG_MODEL` — liste: `agy models` |
| **Codex (OpenAI)** | `codex` ≥ 0.142.3 — `npm i -g @openai/codex`, `brew install --cask codex` veya `curl -fsSL https://chatgpt.com/codex/install.sh \| sh` (+ `node`) | `codex login` (ChatGPT/OAuth) veya `CODEX_API_KEY`/`OPENAI_API_KEY` | `--model <ad>` / `CX_MODEL` — liste: codex içinde `/model` |
| **OpenCode (OpenRouter)** | `opencode` — `npm i -g opencode-ai` (+ `node`) | `OPENROUTER_API_KEY` ([edin](https://openrouter.ai/keys)), sen yapıştırırsın | `--model <bare-slug>` / `OC_MODEL` — liste: `opencode models openrouter` |
| **GitHub Copilot** | `copilot` — `npm i -g @github/copilot`, `brew install --cask copilot-cli` veya `curl -fsSL https://gh.io/copilot-install \| bash` (+ `node` 22+) | `COPILOT_GITHUB_TOKEN` > `GH_TOKEN` > `GITHUB_TOKEN` (mümkünse `gh auth token`'ı kullanır); aktif Copilot aboneliği gerekir | `--model <slug>` / `CP_MODEL`; `--effort low\|medium\|high` |

Native Windows: yalnızca DeepSeek ve Codex — diğer üçü WSL altında kur (bkz. [Windows](#windows)). Sandbox: yalnızca Codex'in `--read-only`'si kernel-zorunlu bir OS sandbox'ıdır — gerisi worktree izolasyonu gerektirir (bkz. [Güvenlik ve veri](#güvenlik-ve-veri)).

DeepSeek ve OpenCode için, key'i kendin yapıştırdığından, key hâlâ boşsa setup config dosyasını **platformun varsayılan editöründe otomatik açar** (macOS `open`, Linux `xdg-open`, WSL `explorer.exe`, Windows `notepad`):

```bash
# ~/.config/cli-dispatch/config
DEEPSEEK_API_KEY="sk-..."     # kendi DeepSeek key'in
DS_MODEL="deepseek-v4-pro"
DS_FLASH_MODEL="deepseek-v4-flash"
```

> Farklı bir editör istiyorsan `CLI_DISPATCH_EDITOR` ortam değişkenini ayarla (ör. `CLI_DISPATCH_EDITOR="code"`; eski `CLAUDE_DS_EDITOR` da hâlâ geçerli). Otomatik açma başarısız olursa dosyayı elle aç: `${EDITOR:-nano} ~/.config/cli-dispatch/config`.

OpenCode'un setup adımı ayrıca (seçmeli bir soru ile) 2-3 seçkin ücretsiz-katman OpenRouter slug'ından (ör. `google/gemma-4-31b-it:free`) bir default model ister ya da özel bir slug girmene izin verir; sonucu `OC_MODEL`'e yazar. Copilot'ın model listesi yalnızca interaktif olarak görülebilir (copilot TUI içinde `/model` veya GitHub Copilot docs) — slug'lar zamanla değişir.

`/cli-dispatch:setup`'ın son bir adımı, evet/hayır tarzı bir soruyla, global veya proje `CLAUDE.md`'ine kalıcı bir delegasyon-tercihi hatırlatması yazmayı önerir — deterministik runner'ı (`/cli-dispatch:run`, LLM babysitter yok) delegasyon yolu olarak işaret eder — böylece her oturumda delegasyon tercihini yeniden anlatman gerekmez (idempotent/marker-guarded, tekrar setup çalıştırmak onu çoğaltmaz).

## Oturum-başı politika enjeksiyonu (opsiyonel)

`/cli-dispatch:setup`'ın bu son adımı **üç tercih** sorar — oturum-başı politika enjeksiyonunu etkinleştir/etkinleştirme, GitHub-issue hatırlatmasının dahil edilip edilmeyeceği ve ayrıca statik bir CLAUDE.md bloğu yazılıp yazılmayacağı — ve yanıtları `~/.config/cli-dispatch/policy.json`'a kaydeder. Bir `SessionStart` hook'u (`startup`/`resume`/`clear`/`compact`/`fork`'ta tetiklenir — `compact` dahil, yani politika **auto-compaction'dan sağ çıkar**: sıkıştırma eski kopyayı düşürür, hook tazesini enjekte eder, context başına net bir canlı kopya kalır) sonra her oturumun context'ine kompakt bir delegasyon politikası otomatik enjekte eder: mekanik işi deterministik runner'a (`/cli-dispatch:run`, LLM babysitter yok) yönlendir, verify komutu yoksa escalation'ı kendin yap, ve cli-dispatch sorunlarını GitHub issue olarak açma hatırlatması — hepsi elle CLAUDE.md düzenlemeye gerek kalmadan.

- **Opt-in, varsayılan kapalı** — `policy.json` yoksa veya `enabled:false` ise, hook sessiz bir no-op'tur, sıfır token maliyeti.
- Statik CLAUDE.md bloğunun (eski `orchestration-priority`, şimdi `policy:v1`) yerine geçmez, tamamlayıcısıdır — ikisi birden açılırsa aynı politika oturum başına iki kez enjekte edilir, bu yüzden yalnızca hook önerilir. `/cli-dispatch:doctor`, durumunu bir **Policy injection** bölümünde raporlar.
- **Kaldırmak için** `~/.config/cli-dispatch/policy.json`'ı sil ya da `enabled:false` yap.

## Güncelleme

Plugin'i Claude Code içinden güncelle, sonra reload et (teker teker çalıştır):

```text
/plugin update cli-dispatch
/reload-plugins
```

`/plugin update` marketplace'ten en yeni sürümü çeker; `/reload-plugins` çalışan oturuma uygular
(tam yeniden başlatma olmadan). `/cli-dispatch:status` ile doğrula.

> ℹ️ `/plugin update` yalnızca **komutları/skill'leri** yeniler — `~/.local/bin`'deki worker
> wrapper'larını **yeniden kurmaz**. Bir wrapper'ı değiştiren bir güncellemeden sonra, wrapper'ları
> yeniden kurmak için bir kez **`/cli-dispatch:setup`** çalıştır.

<video src="https://github.com/rbinar/cli-dispatch/raw/main/assets/update.mp4" controls width="820"></video>

> ▶️ [Güncelleme demosunu izle (mp4)](assets/update.mp4) — Claude Code içinde `/plugin update` sonra `/reload-plugins`.

## Dashboard

```text
/cli-dispatch:dashboard
```

Disk'te zaten var olan veriler üzerinde **local web dashboard**. Aktif Claude Code
CLI session'larını listeler (tüm projeler, **busy** olanlar üstte sabit); bir session'a tıkla →
**akışını** gör (mesajlar / tool çağrıları / sonuçlar), spawn ettiği **subagent'ları** gör,
subagent'a tıkla → *onun* akışına in (spawn derinliğine göre iç içe). İkinci panel cli-dispatch
**worker** delegasyonlarını (DeepSeek / Antigravity / Codex / OpenCode / Copilot) durum + akışla gösterir. Busy
session'lar otomatik yenilenir.

`~/.claude/projects/**` (Claude Code transcript'leri), `~/.claude/sessions/*.json` (canlı
busy/idle) ve `~/.cache/cli-dispatch/sessions/**` (worker'lar) okur. Notlar:
- **Plugin'in başlattığı tek uzun-süreli süreç.** Yalnızca `127.0.0.1`'e bağlanır, varsayılan
  olarak **çoğunlukla okur**: diskte zaten var olan veriyi okur, artı her biri Origin + Host +
  özel header kontrolü isteyen üç dar kapsamlı yazma yolu — **Config** editörü (aşağıda), bayat
  session temizliği, ve bir worker'ın detay görünümündeki opt-in **human-takeover** aksiyonu
  (headless process'i öldürür, PTY terminal bağlar; yalnız zaten sahip olunan worker
  session'larına). Genel shell yok, keyfi komut yok. Yazdırılan `kill <pid>` ile durdur (ya da terminalde
  `cli-dispatch-dashboard` çalıştırdıysan Ctrl-C).
- Claude Code'un disk transcript formatı internal'dır ve sürümler arası değişebilir; dashboard
  bilinmeyen yapıları savunmacı render eder.
- Workers genel görünümü **Anthropic'ten ne kadar worker token'ı offload edildiğini** bildirir — *saved* değil *offloaded* denir, çünkü hangi token'ın Anthropic hesabını atladığı ölçülebilir, tasarruf ise karşı-olgusaldır. Deterministik runner alt kümesi ayrıca belirtilir (yapısı gereği sıfır Anthropic gözetimi) ve sayı kendi çekincelerini taşır: kaç session hiç usage bildirmiyor (toplamı taban değer yapar) ve kaçı koşu ortası anlık görüntüden geldi. `/cli-dispatch:gain` bunu dengeleyen legacy babysitter maliyetini ekler.
- Her backend grubu, key rozetinin cevaplayamadığı soruyu yanıtlayan bir **auth** satırıyla başlar: beş backend'in üçü normalde config'de hiç key taşımaz ve kendi CLI'siyle giriş yapar, bu yüzden görünüm iki kaynağı birleştirir — `✓ key in config`, `✓ logged in (ChatGPT)`, `✓ logged in (gh)`, ya da düzeltecek komutla birlikte `✗ not logged in`. Probe'lar etkileşimsizdir, süre sınırlıdır ve çıktıları sunucudan çıkmaz (Copilot'un probe'u bir token basar, yerinde atılır). Koşamayan probe kırmızı çarpı değil `could not check` gösterir. Antigravity'de auth subcommand'ı hiç yoktur; bu açıkça belirtilir ve koşu geçmişine düşülür.
- Bir **Config** sekmesi cli-dispatch config dosyasını doğrudan tarayıcıda düzenler. Secret alanlar (API key'ler) write-only'dir (kaydedildikten sonra asla geri gösterilmez); maskelenmiş bir önizleme (ör. `sk-e78f...ea1b`, ilk 6 + son 4 karakter) hangi key'in ayarlı olduğunu göstermeni sağlar. Secret olmayan alanlar (`*_MODEL` / `*_MODELS` vb.) tarayıcıda doğrudan görüntülenebilir ve düzenlenebilir.
- Session/subagent'lar için session başına token kullanımını ve hangi modelin çalıştığını gösterir.
  Koşu ortasında yakalanmış token sayıları (öldürülmüş ya da kesilmiş bir worker) toplam gibi
  gösterilmez, kısmi olarak etiketlenir.
- **Deterministik runner sonuçları birinci sınıf.** `/cli-dispatch:run` ile başlatılan bir worker
  `verdict.json` yazar ve dashboard onu okur: worker satırına `⚙RUN` işareti, exit kodlu bir
  verify ✓/✗ rozeti ve değişim boyutu gelir; detay görünümüne verify komutları ve çıktı kuyruğu,
  git durumlarıyla değişen dosyalar (worker çalışmadan önce zaten kirli olan yollar ayrı
  gösterilir), branch/base/worktree ve diff'e bir bağlantı eklenir. Verify başarısızlığı
  worker'ın state'inden ayrı bir eksende gösterilir — çünkü "worker bitti ama kontrol geçmedi"
  ile "worker öldü" farklı sonuçlardır.

## Statusline rozeti

`scripts/cli-dispatch-statusline.sh` bir statusline **fragment'ıdır**: birleştirici
`~/.claude/hooks/statusline.sh` wrapper'ın statusline stdin JSON'unu bu script'e aktarıp
çıktısını eklemesiyle çalışır. Claude Code'un snake_case `session_id` alanından
yalnızca **bu Claude Code session'ının** başlattığı taze ve çalışan worker'ları sayar;
`[CD](ds:1,ag:2,cx:1)` gibi sarı bir ekte backend'e göre gruplar. Sabit grup sırası
`ds`, `ag`, `cx`, `oc`, `cp`'dir; boş gruplar yazılmaz. Cyan `[CD]` rozeti politika enjeksiyonu
açıkken veya bu session'ın canlı bir worker'ı varken görünür; pasifken hiçbir şey basılmaz.
`parentSessionId` alanı olmayan eski worker'lar hariç tutulur. Boş olmayan `session_id`
taşımayan çağırıcılar eski global sarı `▶N` sayacını kullanmaya devam eder.

Birleştirici wrapper'ına tek satırla bağla; fragment'ı plugin cache'inden glob ile bul (hash/versiyon adlı, o yüzden glob kullan — yol'u sabit kodlama):

```bash
CD_SCRIPT=$(ls "$CONFIG_DIR"/plugins/cache/cli-dispatch/cli-dispatch/*/scripts/cli-dispatch-statusline.sh 2>/dev/null | head -1)
```

Sadece küçük `status.json` ve `meta.json` dosyalarını okur (asla `transcript.jsonl`'ı),
böylece statusline her prompt'ta yeniden çalışsa da ucuz kalır. Yalnızca Unix (bash)
statusline kurulumları.

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
| `/cli-dispatch:run <backend> "<görev>" --verify '<cmd>'` | Deterministik delegasyon, sıfır LLM babysitter token'ı — mekanik iş için asıl delegasyon yolu |
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
| `/cli-dispatch:gain` | Backend başına worker token toplamlarını, legacy runner-subagent session'larından Anthropic babysitting maliyetiyle birlikte raporla |
| `/cli-dispatch:doctor` | Tüm backend'ler için sağlık kontrolü — PATH, API key'ler, CLI auth ✓/✗ |
| `/cli-dispatch:help` | Tek ekranda komut referans tablosu |

## Özellikler

Hepsi Claude Code içinden kullanılır (`/cli-dispatch:ds-run <görev>`, `/cli-dispatch:cx-run`, `/cli-dispatch:ag-run`, `/cli-dispatch:oc-run`, `/cli-dispatch:cp-run` ya da "deepseek/codex/gemini/opencode/copilot ile <görev>"):

- **Beş işçi backend, tek hub** — **DeepSeek** (`ds-*`), **Antigravity / Gemini** (`ag-*`), **Codex / OpenAI** (`cx-*`), **OpenCode / OpenRouter** (`oc-*`), **GitHub Copilot** (`cp-*`). Setup'ta birini (veya hepsini) seç; beşi de **aynı session düzenine** yazar, böylece `sessions`, `watch`, `clean`, balance komutları ve dashboard her backend'de çalışır.
- **Delege & doğrula** — işçi üretir/uygular; Claude Code canlı izler ve çıktıyı doğrular. Konuşma bağlamı paylaşılmaz → görev **kendine yeten** olmalı. İşçi = yapan, sen = inceleyen/merge sahibi.
- **Session takibi (canlı izleme + resume)** — iş opak bir arka plan süreci değildir; her çalışma bir session dizini yazar (status / progress / transcript / meta + tam prompt) ve izlenebilir/sürdürülebilir. → [Session takibi](#session-takibi-canlı-izleme--resume)
- **İzolasyon & read-only** — gerçek repo görevleri tek-kullanımlık git worktree'de çalışır, diff commit'siz bırakılır; Codex'in `--read-only`'si ayrıca kernel-zorunlu bir yazma-yok sandbox'ı aktive eder. → [Güvenlik ve veri](#güvenlik-ve-veri)
- **Deterministik runner, LLM babysitter yok (`/cli-dispatch:run`)** — tek delegasyon yolu: bir işçi başlatır, gerçek repo değişikliklerini worktree'de izole eder, bitene kadar bloklar ve makine-kontrol-edilebilir bir `--verify` komutuna göre geçit koyar — orkestrasyonda sıfır Anthropic token harcanır. Verify komutu olmayan, muhakeme-yoğun işler için escalation yolu aynı runner'dır (veya doğrudan bir `*-agent` CLI) — kompakt verdict + diff'i kendin okur, gerekirse `/cli-dispatch:resume` ile devam edersin. → [Deterministik runner](#deterministik-runner-cli-dispatchrun--llm-babysitter-yok)
- **Oturum-başı politika enjeksiyonu (opsiyonel)** — bir `SessionStart` hook'u, `/cli-dispatch:setup`'ta bir kez yapılandırılan kompakt bir delegasyon politikasını (deterministik-runner yönlendirmesi, escalation path, issue-açma hatırlatması) her oturumun context'ine otomatik enjekte eder. Opt-in, varsayılan kapalı, kapalıyken sıfır token maliyeti. → [Oturum-başı politika enjeksiyonu](#oturum-başı-politika-enjeksiyonu-opsiyonel)
- **Statusline rozeti (opsiyonel)** — cyan bir `[CD]` rozeti ve bu Claude Code session'ının canlı worker'ları için sarı, backend bazlı sayaçlar. → [Statusline rozeti](#statusline-rozeti)
- **Web dashboard** — local görünüm: Claude Code session'ları → akış → subagent'lar → akış, + her koşunun verify sonucu ve diff'iyle worker paneli, maliyet/model görünürlüğü ve bir Config editörü. → [Dashboard](#dashboard)
- **Native kullanım / kota** — `/cli-dispatch:balance` (beşi birden) ya da backend başına `*-balance`; mümkün olduğunda her CLI'nın kendi local verisinden, **üçüncü-parti araç yok**. Copilot CLI'dan sorgulanamaz. → [Kullanım & kota](#kullanım--kota--native-üçüncü-parti-araç-yok)
- **Temizlik** — `/cli-dispatch:clean` stale (`running` ama ölü) worker dizinlerini budar; `/cli-dispatch:clean-schedule` bunu launchd / cron / Scheduled Tasks ile günlük otomatikleştirir.
- **Güvenlik ağı & izolasyon** — asılı/kaçak işçi, süre veya durgunluk limitinde (çocuk süreçleriyle birlikte) otomatik öldürülür, session `state: error` olur; işçiler senin `~/.claude` MCP sunucularını (playwright, vb.) miras almaz.

> ⚠️ **Varsayılan mod bir sandbox değildir.** İşçiler agentic çalışır → **dosya yazabilir / bash çalıştırabilir**. Gerçek repo işini worktree'de izole et. Backend başına tam sandbox durumu: [Güvenlik ve veri](#güvenlik-ve-veri).

## Session takibi (canlı izleme + resume)

Delege edilen iş **opak bir arka plan süreci değildir**: her backend'in çıktısı parse edilip her görev bir **session dizinine** yazılır (DeepSeek, Antigravity, Codex, OpenCode ve Copilot için aynı düzen). İşçinin ne yaptığını `/cli-dispatch:sessions` ve `/cli-dispatch:watch <id>` ile (veya sonucu tek çağrıda bloklamak için `/cli-dispatch:wait <id>` ile) **canlı, yapılandırılmış ve resume-edilebilir** şekilde takip edersin.

Session dizini: `${XDG_CACHE_HOME:-$HOME/.cache}/cli-dispatch/sessions/<id>/` (eski `claude-ds` yolu hâlâ fallback olarak okunur)

| Dosya | İçerik |
|-------|--------|
| `status.json` | Kompakt özet (durum, son tool, tool sayıları, sonuç önizlemesi) — **izlemek için tek okunan dosya** |
| `progress.log` | Terse insan-okur akış (`▸ Edit foo.ts`, `✓ / ✗`, kısaltılmış metin) |
| `transcript.jsonl` | Ham stream-json (resume/audit; izlerken okunmaz) |
| `meta.json` | Prompt önizlemesi, cwd, branch, model, başlangıç/bitiş |
| `prompt.txt` | **Tam** görev prompt'u (kısaltmasız; worker'ın dashboard sayfasında üstte sabit gösterilir) |

**Maliyet-odaklı izleme:** ilerleme yalnızca küçük `status.json`'dan takip edilir (`/cli-dispatch:watch <id>` veya `/cli-dispatch:wait <id>`); ham transcript okunmaz, sıkı döngüde tail edilmez — orkestratörün her okuması token harcadığı için.

> Gereksinim: session takibi/parse için `node` gerekir (claude-code zaten node ortamında çalışır).

## Deterministik runner (`/cli-dispatch:run`) — LLM babysitter yok

Her delegasyonu kendi LLM alt-bağlamında çalıştıran beş backend-başına "babysitter" subagent'ı
(`ds-/ag-/cx-/oc-/cp-runner`) 4.0.0'da kaldırıldı — prodüksiyonda ölçüldüğünde kendi işçisinin
çıktısının kabaca **9 katı** Anthropic token'ı tüketiyorlardı (bkz. [CHANGELOG.md](CHANGELOG.md)).
Deterministik runner artık **tek** delegasyon yoludur:

```text
/cli-dispatch:run <backend> "<görev>" --verify '<cmd>'
```

`cli-dispatch-run` işçiyi başlatır (`ds` DeepSeek / `ag` Antigravity / `cx` Codex / `oc` OpenCode
/ `cp` GitHub Copilot), gerçek repo değişikliklerini git worktree'de izole eder, bitene kadar
(veya timeout'a kadar) bloklar, `--verify` komutunu çalıştırır ve kompakt bir verdict basar —
**orkestrasyonda sıfır LLM babysitter token'ı harcanır.** Codex'te `--read-only` hâlâ **gerçek
OS-düzey sandbox'ı** (macOS Seatbelt / Linux bwrap+seccomp) aktive eder — kernel düzeyinde sert
yazma engeli, gerçek bir yazma garantisi için worktree gerekmez.

**Escalation yolu** (muhakeme-yoğun iş, makine-kontrol-edilebilir verify yok): hâlâ hiçbir LLM
babysitter subagent yok. Sen (Claude Code) deterministik runner'ı — veya doğrudan bir
`*-agent` CLI'ı — çalıştırırsın, ama `--verify`'a geçit koymak yerine kompakt verdict'i ve diff'i
kendin okur, sonuç bir tur daha gerektiriyorsa `/cli-dispatch:resume <session-id> "<prompt>"`
ile devam edersin.

Tek dosyalık, önemsiz bir düzeltme için (yaklaşık 50 satırın çok altında, sıfır keşif/belirsizlik)
delegasyonu hiç kullanma, doğrudan inline yap — herhangi bir delegasyonun sabit maliyeti buna
değmez. Repo değişikliği olmayan basit, tek-atışlık bir iş için düz `/cli-dispatch:ds-run` /
`ag-run` / `cx-run` / `oc-run` / `cp-run` komutları yeterlidir.

## Kullanım & kota — native, üçüncü-parti araç yok

"Limitimden ne kadar kaldı?" — **her** backend için, ekstra hiçbir şey kurmadan yanıtlanır.
Her `*-balance` komutu, CLI'ın zaten yerelde tuttuğu veriyi tersine mühendislikle okur; senin
adına ağ üzerinden yeni bir şey gönderilmez.

Beşini bir arada görmek için `/cli-dispatch:balance` kullan, ya da backend başına tek bir `*-balance` komutu.

| Backend | Komut | Sayı nereden geliyor |
|---|---|---|
| **Hepsi** | `/cli-dispatch:balance` | Aşağıdaki beşini bir seferde çalıştırır ve her başlık sayıyı yan yana özetler. |
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

> 📄 Terminalden kurulum, tüm komutlar, bayraklar ve env override'larının tam referansı: [TERMINAL.md](TERMINAL.md).

## Windows

Native Windows'ta (WSL kullanmıyorsan) PowerShell varyantları devreye girer. **DeepSeek ve Codex** native çalışır; Antigravity bir pseudo-TTY gerektirdiğinden, OpenCode/Copilot ise v1'de Unix-only olduğundan WSL altında kurulmalı.

- `/cli-dispatch:setup` → `install.ps1 -Backends <deepseek,codex|all>` çalışır (varsayılan `deepseek`):
  - **DeepSeek**: `claude-ds.ps1` + `claude-ds-stream.ps1` + `ds-agent.ps1` ve `.cmd` shim'lerini `~/.local/bin`'e, parser'ı (`ds-stream-parse.mjs`) `~/.local/share/cli-dispatch`'e kurar.
  - **Codex**: `cx-stream.ps1` + `cx-agent.ps1` + `.cmd` shim'leri ve parser'ı (`cx-stream-parse.mjs`) kurar. Auth: `codex login` (ya da config'te `CODEX_API_KEY`). Gerçek `-s read-only` sandbox dahil.
  - Dashboard her zaman kurulur; config `~/.config/cli-dispatch/config`'e yazılır.
  - `install.ps1`'e `-InstallMissing` ekleyerek eksik bir worker CLI'ını otomatik kurmayı denetebilirsin (npm, ya da bir vendor fallback) ve `Get-Command` ile yeniden kontrol eder; başarısızlıkta mevcut uyarıya düşer — opt-in, varsayılan kapalı; auth asla otomatikleştirilmez.
- Repo görevleri (worktree koşuları) **bash** gerektirir — WSL ya da Git Bash. `cli-dispatch-run.ps1` `.sh` worktree runner'ını onun üzerinden çağırır ve bash yoksa hiç başlamaz. PowerShell ikizleri (`ds-worktree-run.ps1` / `cx-worktree-run.ps1`) 4.6.0'da kaldırıldı: hiçbir kod yolu onları seçmiyordu, dolayısıyla yalnızca aynadıkları bash orijinallerinden sessizce sapabilirlerdi.
- Geri kalan her şey — generation, sessions, watch, kill, gain, dashboard — native PowerShell'dir ve bash gerektirmez.

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
rm -f  ~/.local/bin/claude-ds ~/.local/bin/claude-ds-stream ~/.local/bin/ds-agent
rm -f  ~/.local/bin/{ag,cx,oc,cp}-agent ~/.local/bin/{ag,cx,oc,cp}-stream
rm -f  ~/.local/bin/cli-dispatch-{run,wait,clean,gain,dashboard}
rm -f  ~/.local/bin/{ds,cx}-worktree-run.* ~/.local/bin/stream-utils.sh ~/.local/bin/version-check.sh
rm -rf ~/.local/share/cli-dispatch ~/.local/share/claude-ds   # engine/parser'lar (eski yol dahil)
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

- **Backend başına sandbox durumu:** yalnızca Codex'in `--read-only`'si kernel-zorunlu bir OS sandbox'ıdır (macOS Seatbelt / Linux bwrap+seccomp) — sırf analiz için worktree gerektirmeyen gerçek bir yazma-yok garantisi. DeepSeek'in `--read-only`'si yalnızca araç-katmanı kısıtıdır. Antigravity, OpenCode ve Copilot'ta **hiç sandbox yoktur**. Gerisinde, gerçek repo işini bir git worktree'de izole et — agentic mod ana checkout'a/diğer branch'lere dokunmaz; diff'i inceleyip (build/test) merge etmek **sana** kalır.
- **Key'ler makineden çıkmaz:** varsa key `~/.config/cli-dispatch/config` içinde (0600, repo dışında) tutulur ve **asla commit edilmez**. Plugin/skill key'i hiçbir yere yazmaz; sen eklersin. (Codex ve Antigravity normalde kendi OAuth girişlerini kullanır — config'te key bile olmaz.)
- **Veri egress:** bir işçiye verdiğin **prompt ve kod o backend'in sağlayıcısına gönderilir** — DeepSeek, Google (Gemini/Antigravity), OpenAI (Codex), OpenRouter/OpenCode veya GitHub Copilot. Her birini yalnızca bunu kabul ediyorsan kullan. Dashboard ve `*-balance` komutları local/salt-okunur; senin adına ekstra bir şey göndermez.
- **Biten oturumlar otomatik sınırlanır:** her worker koşusu, başlamadan önce oturum kökünü en yeni **100 bitmiş** oturuma indirir. Bu bir silme işlemi, o yüzden sınırları bilmekte fayda var: hâlâ `running` ya da `human-controlled` olan bir oturum ne kadar eski olursa olsun asla silinmez, hiç state yazmamış bir oturuma dokunulmaz (onu yargılayacak boşta-kalma verisi yalnız `/cli-dispatch:clean`'de var) ve varsa `verdict.json` / `verdict-diff.patch` dizin gitmeden önce `sessions/verdict-archive/` altına kopyalanır. Sınırı `CLI_DISPATCH_MAX_SESSIONS=<n>` ile değiştir; tamamen kapatmak için `0` ver. Bu bir taban, `/cli-dispatch:clean`'in yerine geçmez — sınır bayat ya da ölmüş oturumları tespit etmez.
- **GitHub CLI (`gh`) kimlik aktarımı:** macOS'ta `gh` token'ını sistem Keychain'inde tutar; sandbox'lı worker'lar (Codex `workspace-write`, DeepSeek, agy, OpenCode, Copilot) buna erişemez — bu yüzden delege edilen `gh issue`/`gh pr`/`gh api` çağrıları sessizce başarısız olur. Giriş yapmışsan (`gh auth token` çalışıyorsa) ve kendin `GH_TOKEN`/`GITHUB_TOKEN` set etmemişsen, runner'lar **`gh` token'ını worker'a `GH_TOKEN` olarak aktarır**; böylece worker'ın `gh` çağrıları kimlik doğrular. Copilot, `COPILOT_GITHUB_TOKEN` açıkça set değilse bu token yolunu da kullanır. Token geniş kapsam taşıyabilir (`repo`, `workflow`, hatta `delete_repo`) ve worker sandbox'ına / sağlayıcı bağlamına gider — **devre dışı bırakmak** için `CLI_DISPATCH_NO_GH_TOKEN=1`. `/cli-dispatch:doctor` mevcut durumu raporlar.

## Mimari rol

İşçi (DeepSeek / Gemini / Codex / OpenCode / Copilot) = yapan (üretim/uygulama). Sen (Claude Code, Anthropic) = orkestratör + reviewer + git/merge sahibi. Bir işçinin çıktısını doğrulamadan güvenme.

## Lisans

MIT — bkz. [LICENSE](LICENSE).
