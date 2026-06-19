# claude-ds

**DeepSeek destekli Claude Code'u delege işçi olarak çalıştıran** bir Claude Code plugin'i.

Claude Code'un yerleşik `Agent`/subagent tool'u yalnızca Anthropic modellerini (sonnet/opus/haiku) destekler — DeepSeek'e iş veremez. `claude-ds`, Claude Code CLI'ı DeepSeek'in Anthropic-uyumlu API'siyle çalıştıran taşınabilir bir wrapper kurar; böylece görevleri DeepSeek'e **delege işçi** olarak verebilirsin.

## Kurulum

> ⚠️ Bu komutlar **slash komutudur** ve **Claude Code CLI'ın içinden** çalıştırılmalıdır (normal terminal/shell'de değil). Önce `claude` yazıp Claude Code oturumunu başlat, komutları o oturumun prompt'una gir.

Komutları **tek tek, sırayla** çalıştır — hepsini aynı anda yapıştırma. Her komutu gönder, sonucu bekle, sonra bir sonrakine geç:

**1. Adım — Marketplace'i ekle:**

```text
/plugin marketplace add rbinar/claude-ds
```

> Eğer "Enter marketplace source" kutusu açılırsa, o kutuya **yalnızca kaynağı** yaz (komutu değil): `rbinar/claude-ds`

**2. Adım — Plugin'i kur** (marketplace eklendikten sonra):

```text
/plugin install claude-ds@claude-ds
```

> Format `plugin-adı@marketplace-adı` şeklindedir; her ikisi de `claude-ds` olduğu için isim tekrar eder, bu normaldir.

**3. Adım — Plugin'i etkinleştir:**

Install çıktısı `Run /reload-plugins to apply` der. Komutların (`/claude-ds:*`) tanınması için bu adım zorunludur:

```text
/reload-plugins
```

> Reload sonrası hâlâ "Unknown command: /claude-ds:setup" alıyorsan, Claude Code'u tamamen kapatıp yeniden aç. `/plugin` komutuyla `claude-ds`'in yüklü ve **enabled** olduğunu doğrulayabilirsin.

**4. Adım — Kurulumu çalıştır** (plugin etkinleştikten sonra):

```text
/claude-ds:setup
```

`/claude-ds:setup` wrapper'ı `~/.local/bin/claude-ds`'e kurar ve `~/.config/claude-ds/config` iskeletini oluşturur. Key hâlâ boşsa setup config dosyasını **platformun varsayılan editöründe otomatik açar** (macOS `open`, Linux `xdg-open`, WSL `explorer.exe`, Windows `notepad`). Açılan dosyada DeepSeek API key'ini **kendin** ekle:

```bash
# ~/.config/claude-ds/config
DEEPSEEK_API_KEY="sk-..."     # kendi DeepSeek key'in
DS_MODEL="deepseek-v4-pro"
DS_FLASH_MODEL="deepseek-v4-flash"
```

> Farklı bir editör istiyorsan `CLAUDE_DS_EDITOR` ortam değişkenini ayarla (ör. `CLAUDE_DS_EDITOR="code"`). Otomatik açma başarısız olursa dosyayı elle aç: `${EDITOR:-nano} ~/.config/claude-ds/config`.

Gereksinim: `claude` CLI kurulu ve `~/.local/bin` PATH'te olmalı. DeepSeek key'i: https://platform.deepseek.com/api_keys

## Kullanım

claude-ds **iki ayrı yerden** kullanılır — karıştırma. Bu README'de kod bloklarını buna göre işaretliyoruz:

- 💬 **Claude Code prompt'u** — `claude` oturumunun **içine** yazılır: `/claude-ds:*` slash komutları + `ds-runner` subagent. **Terminale yazılmaz.**
- 🖥 **Terminal** — normal kabuk (iTerm/bash). `claude-ds`, `claude-ds-stream`, `ds-agent` CLI'ları buraya yazılır. (Claude Code de bunları Bash tool ile çalıştırabilir — ama yazımı terminal komutu yazımıdır.)

### 💬 Claude Code komutları (slash — `claude` prompt'una yazılır)

| Komut | İş |
|-------|-----|
| `/claude-ds:setup` | Wrapper'ları kur + config iskeleti + smoke test |
| `/claude-ds:run <görev>` | Bir görevi claude-ds'e delege et (session-takipli) |
| `/claude-ds:sessions` | Geçmiş/aktif session'ları listele |
| `/claude-ds:watch <id>` | Bir session'ın canlı durumunu göster (maliyet-odaklı) |
| `/claude-ds:status` | Kurulum/key/CLI durumunu kontrol et |
| `/claude-ds:balance` | DeepSeek hesap bakiyesini göster |

### Hangi aracı kullanmalı?

Kurulumdan sonra `~/.local/bin`'e **üç CLI komutu** gelir — `claude-ds`, `claude-ds-stream`,
`ds-agent`. Üçü de **hem düz terminalden hem Claude Code içinden (Bash tool)** çağrılır.
`ds-runner` ise binary **değildir**: bir Claude Code **subagent**'ıdır, yalnızca Claude Code
içinden `Agent` tool'uyla çağrılır.

| Araç | Nereden çağrılır | Ne zaman | Çıktı / takip |
|------|------------------|----------|----------------|
| **`ds-agent`** | Terminal **veya** Claude Code (Bash) | **En basit.** Tek komut: görevi ver, çalışsın, cevabı al (senkron). | Nihai cevap → stdout; canlı ilerleme → stderr |
| **`claude-ds-stream`** | Terminal **veya** Claude Code (Bash) | Arka planda çalıştırıp **izlemek / resume** etmek istediğinde. | `status.json`/`progress.log` + `--resume` |
| **`claude-ds`** | Terminal **veya** Claude Code (Bash) | Hızlı tek-atış, takip/parse gerekmiyor. | Sadece düz `claude` çıktısı |
| **`ds-runner`** (subagent) | **Sadece Claude Code** (`Agent` tool) | Orkestratör bağlamını **temiz tutmak** + otomatik doğrulama. | Kısa, doğrulanmış sonuç |

> ⚠️ **Varsayılan mod bir sandbox değildir.** Wrapper her zaman `--permission-mode
> bypassPermissions` ile çalışır (non-interactive `--print` modunda onay sorulamaz), bu yüzden
> işçi `--dangerously-skip-permissions` olmadan da **dosya yazabilir / bash çalıştırabilir**.
> Gerçek repo görevlerini worktree'de izole et; garantili "dosya yazmaz" için `--read-only` kullan.

## Örnekler

> Aksi belirtilmedikçe örnekler 🖥 **terminalde** çalışır. 💬 ile işaretli bloklar Claude Code prompt'una yazılır.

### 1) Hızlı soru / analiz (yazmaz) — 🖥 terminal
```bash
ds-agent --read-only "JWT ile session-cookie auth farkını kısa açıkla"
ds-agent --read-only "bu repodaki mimariyi özetle"
```
`--read-only` → Write/Edit/Bash kapalı; sadece okur ve metin üretir. Cevap stdout'a basılır.

### 2) Kod üretip dosyaya yazdırma (agentic, izole dizinde) — 🖥 terminal
```bash
mkdir -p /tmp/scratch && ds-agent --cwd /tmp/scratch "fizzbuzz.py oluştur, 1-15 yaz, çalıştırıp doğrula"
```
İzole bir dizin verdiğin için repo'na dokunmaz; `▸ Write … ✓`, `▸ Bash … ✓` adımlarını canlı görürsün.

### 3) Çıktıyı yakalama / pipe'lama — 🖥 terminal
```bash
ds-agent --read-only -q "PostgreSQL bağlantı stringi örneği ver" > conn.txt   # -q: banner yok
answer=$(ds-agent --read-only -q "tek satır: docker nedir")
```
`-q` banner/ilerlemeyi susturur; stdout **yalnızca** nihai cevabı taşır → güvenle pipe'lanır.

### 4) Çok-turlu araştırma (aynı bağlamı sürdür) — 🖥 terminal
```bash
ds-agent --read-only "bitcoin nedir, uzun cevap"            # session id stderr'de basılır
ds-agent --read-only --resume <session-id> "lightning network'ü açıkla"
ds-agent --read-only --resume <session-id> "taproot nedir"
```
`--resume` aynı DeepSeek konuşmasına ekler; model önceki turları hatırlar.

### 5) Arka planda uzun iş + canlı izleme (maliyet-odaklı)
🖥 **Terminal** — işi başlat (session id stderr'de basılır):
```bash
claude-ds-stream -p "$(cat brief.txt)"
```
💬 **Claude Code prompt'u** — izle (slash komutları, terminale değil):
```text
/claude-ds:watch <session-id>     # sadece status.json + son satırlar (ucuz)
/claude-ds:sessions               # tüm session'ları listele
```

### 6) Güvenlik ağı: timeout — 🖥 terminal
```bash
ds-agent --max-runtime 600 --idle-timeout 90 "büyük refactor görevi"
```
İş 600 sn'yi aşarsa ya da 90 sn çıktı üretmezse worker (ve çocuk süreçleri) öldürülür; session `state: error` olur.

### 7) Gerçek repo görevi (worktree'de izole + sen incele/merge et)
💬 **Claude Code prompt'u** — en temiz yol:
```text
/claude-ds:run auth.ts'e rate-limit ekle, testlerini de yaz
```
Claude Code bunu izole bir git worktree'de çalıştırır (`ds-worktree-run.sh`; bu script
`~/.local/bin`'de **değildir**, plugin içinden çağrılır), diff'i COMMIT'siz bırakır —
sonra sen/Claude diff → build/test → merge.

### 8) Subagent'a devret (orkestratör bağlamı temiz kalsın)
💬 **Claude Code prompt'u** — bunu **doğal dille** istersin, örn:
> "şu görevi `ds-runner` ile yap: …" (kolaysa haiku, build/test gerekiyorsa sonnet)

Bunun üzerine Claude Code arka planda şu tool çağrısını yapar (**sen `Agent(...)`'ı elle yazmazsın**):
```text
Agent(subagent_type="ds-runner", model="haiku",  prompt="<kendine yeten görev>")   # saf üretim/analiz
Agent(subagent_type="ds-runner", model="sonnet", prompt="<repo/kod görevi>")        # build/test doğrulaması gerekir
```
Detay için aşağıdaki [ds-runner subagent](#ds-runner-subagent-bağlamı-temiz-tut) bölümüne bak.

## Session takibi (canlı izleme + resume)

`claude-ds-stream`, delege ettiğin işi **opak bir arka plan süreci** olmaktan çıkarır: Claude Code CLI'ı `--output-format stream-json` ile çalıştırır, çıktıyı satır satır parse eder ve her görevi bir **session dizinine** yazar. Böylece DeepSeek işçisinin ne yaptığını **canlı, yapılandırılmış ve resume-edilebilir** şekilde takip edebilirsin.

Session dizini: `${XDG_CACHE_HOME:-$HOME/.cache}/claude-ds/sessions/<id>/`

| Dosya | İçerik |
|-------|--------|
| `status.json` | Kompakt özet (durum, son tool, tool sayıları, sonuç önizlemesi) — **izlemek için tek okunan dosya** |
| `progress.log` | Terse insan-okur akış (`▸ Edit foo.ts`, `✓ / ✗`, kısaltılmış metin) |
| `transcript.jsonl` | Ham stream-json (resume/audit; izlerken okunmaz) |
| `meta.json` | Prompt önizlemesi, cwd, branch, model, başlangıç/bitiş |

**Maliyet-odaklı izleme:** ilerlemeyi yalnızca küçük `status.json`'dan takip et (`/claude-ds:watch <id>`); ham transcript'i okuma, sıkı döngüde tail etme. Orkestratör (Claude Code) her okumada token harcadığı için akış bu ilkeye göre tasarlandı. (Komut örnekleri için yukarıdaki [Örnekler](#örnekler) — #4 resume, #5 izleme, #6 timeout.)

> Timeout: bir watchdog, worker toplam süreyi (`--max-runtime`) aşarsa ya da çıktı üretmeden
> takılırsa (`--idle-timeout`, `transcript.jsonl` aktivitesine göre) worker'ı **ve çocuk
> süreçlerini** öldürür; session `state: error` ("timeout: …") olur. Env: `CLAUDE_DS_MAX_RUNTIME`,
> `CLAUDE_DS_IDLE_TIMEOUT`. Her iki wrapper'da da uygulanır — bash `kill_tree` watchdog'u ile, PowerShell worker'ı session id'sinden bulup `taskkill /T /F` ile ağacıyla öldüren bir arka plan watchdog'u ile.

> Gereksinim: `claude-ds-stream` parser için `node` ister (claude-code zaten node ortamında çalışır). Düz `claude-ds` wrapper'ı parse/session olmadan çalışmaya devam eder.

## ds-runner subagent (bağlamı temiz tut)

`ds-*` komutlarını kendin çalıştırıp izlemek yerine, tüm delegasyonu paketlenmiş **`ds-runner`**
subagent'ına devredebilirsin. O; modu seçer, işi izole eder, **doğrular** (repo/kod görevinde
build/test) ve kısa bir sonuç döndürür — yönetim gürültüsü orkestratörün bağlamına hiç girmez.
İşçi her zaman DeepSeek'tir; subagent'ın *kendi* (babysitter) modelini orkestratör zorluğa göre
seçer:

```text
Agent(subagent_type="ds-runner", model="haiku",  prompt="<kendine yeten görev>")   # saf üretim/analiz
Agent(subagent_type="ds-runner", model="sonnet", prompt="<repo/kod görevi>")        # build/test doğrulaması gerekir
```

Uzun/agentic işler, doğrulama ya da paralel birden çok iş için değerli; tek-atışlık işte doğrudan
`ds-agent` daha ucuz.

## Windows

Native Windows'ta (WSL kullanmıyorsan) PowerShell varyantları devreye girer:

- `/claude-ds:setup` → `install.ps1` çalışır: `claude-ds.ps1` + `claude-ds-stream.ps1` ve `.cmd` shim'lerini `~/.local/bin`'e, stream parser'ını (`ds-stream-parse.mjs`) `~/.local/share/claude-ds`'e kurar (böylece `claude-ds` / `claude-ds-stream` cmd/PowerShell'den çağrılır), config'i `~/.config/claude-ds/config`'e yazar.
- Repo görevleri: `ds-worktree-run.ps1` — `node_modules` için symlink yerine **junction** (`New-Item -ItemType Junction`; admin/developer-mode gerektirmez) kullanır.
- WSL ya da Git Bash varsa Unix `.sh` scriptleri de çalışır.

Gereksinim: PowerShell 5.1+ veya pwsh 7+, ve `claude` CLI PATH'te.

## Kaldırma (Uninstall)

Tam temizlik için sırayla: (1) plugin'i kaldır, (2) wrapper + config dosyalarını sil, (3) varsa geçici worktree'leri temizle.

**1. Adım — Plugin'i ve marketplace'i kaldır** (Claude Code CLI içinden):

```text
/plugin uninstall claude-ds@claude-ds
/plugin marketplace remove claude-ds
/reload-plugins
```

**2. Adım — Wrapper ve config dosyalarını sil:**

```bash
# macOS / Linux / WSL / Git Bash
rm -f  ~/.local/bin/claude-ds ~/.local/bin/claude-ds-stream
rm -rf ~/.local/share/claude-ds     # stream parser (ds-stream-parse.mjs)
rm -rf ~/.cache/claude-ds           # session kayıtları (status/progress/transcript)
rm -rf ~/.config/claude-ds          # config (API key dahil) burada — silinince key de gider
```

```powershell
# Native Windows (PowerShell)
Remove-Item -Force "$HOME\.local\bin\claude-ds.ps1","$HOME\.local\bin\claude-ds.cmd","$HOME\.local\bin\claude-ds-stream.ps1","$HOME\.local\bin\claude-ds-stream.cmd" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force "$HOME\.local\share\claude-ds" -ErrorAction SilentlyContinue   # stream parser
Remove-Item -Recurse -Force "$HOME\.cache\claude-ds" -ErrorAction SilentlyContinue          # session kayıtları
Remove-Item -Recurse -Force "$HOME\.config\claude-ds" -ErrorAction SilentlyContinue
```

**3. Adım — (Opsiyonel) geçici worktree'leri temizle:**

`/claude-ds:run` veya `ds-worktree-run.sh` kullandıysan ayrı git worktree'ler kalmış olabilir. İlgili repoda kontrol et:

```bash
git worktree list          # claude-ds'in açtığı worktree'leri gör
git worktree remove <yol>  # gereksizleri kaldır
git worktree prune         # ölü kayıtları temizle
```

> Not: PATH'e `~/.local/bin`'i bu plugin için elle eklediysen ve başka bir şey kullanmıyorsan, shell profilinden (`~/.zshrc`, `~/.bashrc` vb.) o satırı da kaldırabilirsin. DeepSeek hesabındaki API key'i iptal etmek istersen https://platform.deepseek.com/api_keys üzerinden sil.

## Güvenlik ve veri

- **API key makineden çıkmaz:** key `~/.config/claude-ds/config` içinde (0600, repo dışında) tutulur ve **asla commit edilmez**. Plugin/skill key'i hiçbir yere yazmaz; sen eklersin.
- **Veri egress:** claude-ds'e verdiğin **prompt ve kod DeepSeek'e (harici servis) gönderilir.** Yalnızca bunu kabul ediyorsan kullan.
- **İzole çalışma:** gerçek repo görevleri `ds-worktree-run.sh` ile ayrı git worktree'de çalışır; `--dangerously-skip-permissions` ana checkout'a/diğer branch'lere dokunmaz. Üreteni inceleyip (diff + build/test) merge etmek **sana** kalır.

## Mimari rol

`claude-ds` = işçi (DeepSeek üretimi/uygulaması). Sen (Claude Code, Anthropic) = orkestratör + reviewer + git/merge sahibi.

## Lisans

MIT — bkz. [LICENSE](LICENSE).
