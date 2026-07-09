# Değişiklik Günlüğü

**cli-dispatch** (eski adıyla **claude-ds**) için tüm kayda değer değişiklikler burada belgelenmiştir.

Format [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)'u temel alır,
ve bu proje [Semantic Versioning](https://semver.org/spec/v2.0.0.html) kurallarına uyar.

> Not: `README.md` bilinçli olarak Türkçe'dir; bu değişiklik günlüğü ve diğer tüm dökümanlar İngilizce'dir.

## [3.30.4] — 2026-07-09

### Eklendi

- **`cli-dispatch-wait <session-id> [--timeout SECS] [--poll SECS]`** —
  `*-runner` babysitter'ları için engelleyici (blocking) bir bekleme
  primitifi (#88). `status.json`'ı düz bir shell döngüsüyle (sıfır LLM
  token'ı) session terminal bir duruma (`done`/`error`/`killed`) ulaşana
  kadar poll'luyor, ardından kısa bir özet basıyor (durum, kullanım,
  diffstat, `finalResultPreview`, `progress.log`'un son 20 satırı). Done
  ise exit 0, error/killed ise 1, timeout'ta 2. Runner agent tanımlarındaki
  elle yazılmış `sleep 30 && cat status.json` poll döngülerinin yerini
  alıyor — 493 runner subagent genelinde ~1.38B token'lık runner-only
  cache-read'e karşılık geliyor, ağırlıklı olarak poll-turu context
  yeniden-okumalarından kaynaklanıyor. `cli-dispatch-clean` /
  `cli-dispatch-dashboard` ile birlikte kuruluyor (backend-agnostic;
  Windows ikizi `cli-dispatch-wait.ps1`). `ag/ds/cx/oc/cp-runner.md`
  dosyaları artık bunu, zaten çalışan bir arka plan session'ında
  bloklamak için tercih edilen primitif olarak öneriyor — mevcut
  senkron-bekleme / terminal-durum-kapısı gereksinimlerinin yerine değil,
  onlara ek olarak.

## [3.28.0] — 2026-07-07 17:35

### Eklendi

- **Dashboard için Dracula renk paleti.** Dashboard client UI'si
  (`public-page.mjs`) eski GitHub-dark tonlarından Dracula paletine
  taşındı (arka plan `#282a36`, mor `#bd93f9` vurgu, camgöbeği `#8be9fd`
  link, yeşil `#50fa7b` / sarı `#f1fa8c` durum, kırmızı `#ff5555` hata).
  Flow görünümündeki adım satırları da diff-tarzı bir görünüm kazandı:
  başarı/hata sonuç satırları diff +/- stiline benzer soluk tonlu bir
  arka plan (yeşil/kırmızı) alıyor, thinking adımları ise düz gri-italik
  yerine artık mor-italik. Kapsam yalnızca palet + adım stilidir —
  sidebar/title-bar chrome değişmedi. Canlı Playwright ekran
  görüntüleriyle ve tam test suite'iyle doğrulandı.

### Düzeltildi

- **ds-runner session'ları ilk komutta "command not found" hatasıyla
  başarısız olabiliyordu** (Fixes #77) — çünkü Claude Code'un kalıcı Bash
  shell'i `~/.zshenv`'i source etmiyor. `ds-runner.md` artık session'ın
  ilk komutu olarak gereken inline `PATH` export'unu belgeliyor;
  `cp-runner.md`'ye de tutarlılık için aynı not eklendi (yalnızca
  döküman, issue yok).
- **DeepSeek worker brief'leri doğrudan bir build/test komutu
  çalıştırmaya yönlendirildiğinde idle-timeout'a kadar askıda
  kalabiliyordu** (Fixes #69) — worker, host Claude Code hook'larını
  (ör. context-mode) miras aldığından, bu hook komutu worker'ın
  erişemediği bir MCP tool'una yönlendirebiliyordu. Worker brief'leri
  artık worker'a build/test komutu çalıştırmasını söylememeli — tüm
  doğrulamayı artık babysitter (ds-runner) kendi shell'inde yapıyor.
- **Bir worker, kendisine atanan worktree dışına sessizce değişiklik
  sızdırıp ana checkout'u kirletebiliyordu** (Fixes #68) — çünkü `--cwd`
  izolasyonu sert bir dosya sistemi sınırı değil. `ds-worktree-run.sh
  --post-check <repo-path>` eklendi: bir worker çalışmasından sonra ana
  checkout kirli kalmışsa (kaydedilmiş bir patch dosyasıyla birlikte)
  yüksek sesle başarısız oluyor, artık babysitter'ın manuel kontrolü
  hatırlamasına güvenilmiyor.
- **Codex worker brief'leri worktree görevlerinde "Operation not
  permitted" hatasıyla yarıda başarısız olabiliyordu** (Fixes #70) —
  çünkü Codex'in sandbox'ı worktree içindeki dosyaları düzenleyebiliyor
  ama worktree'nin gerçek git meta verisine (ana repo'nun
  `.git/worktrees/` altında, sandbox'ın yazılabilir kökü dışında yaşar)
  yazamıyor. `cx-runner.md` artık worker brief'lerini yalnızca dosya
  düzenlemeleriyle sınırlıyor — tüm git-meta veri işlemleri
  (commit/branch/push) worker'ın turu bittikten sonra cx-runner'ın
  kendisinde gerçekleşiyor.
- **`oc-stream --resume`, kendi `oc-<id>` session id'mizi doğrudan
  OpenCode'a geçiyordu**, bu da tanınmayıp "Session not found" hatasına
  yol açıyordu (Fixes #72) — cx/cp-stream için zaten düzeltilmiş olan
  hatayla aynı sınıf. Ayrıca yanlış ham id ile başarılı bir resume'un
  `meta.json`'daki doğru kaydedilmiş thread id'yi üzerine yazarak o
  session'ın gelecekteki resume'larını kalıcı olarak bozduğu kendi
  kendini bozan bir varyant da düzeltildi. `oc-runner.md`'ye ayrıca
  OpenCode (kimi) worker'ının geniş/çok-parçalı görevlerde bozulduğu,
  bunun yerine dar, tek-adımlı brief'ler verilmesi gerektiği rehberliği
  eklendi.
- **Oturumu kapanmış bir Antigravity session'ı, sıfır event üreten bir
  tam `ag-stream` çalıştırması boyunca yakılıp genel, açıklamasız bir
  hatayla sonuçlanabiliyordu** (Fixes #73). Şimdi taze (resume olmayan)
  bir çalıştırma, gerçek arka plan çalıştırmasını başlatmadan önce ucuz,
  sınırlı bir auth preflight kontrolü yapıyor; onaylanmış bir auth
  hatasında artık boş, kafa karıştırıcı bir başarısızlığa sessizce devam
  etmek yerine hemen net, Türkçe bir auth hatası yazıyor ve exit 3 ile
  çıkıyor.

## [3.27.0] — 2026-07-07

### Eklendi

- **Dashboard Configuration editöründe model-ID datalist önerileri.** 8 model alanı
  (`AG_MODEL`/`AG_MODELS`, `CX_MODEL`/`CX_MODELS`, `CP_MODEL`/`CP_MODELS`,
  `OC_MODEL`/`OC_MODELS`) artık yazarken bilinen-iyi model ID'lerini native bir HTML
  datalist ile önerir — serbest metin hâlâ kabul edilir, bu yalnızca bir öneridir. AG/CX/CP
  listeleri statiktir, keşfedilebildiği yerde kurulu CLI meta verisinden kaynaklanır (agy
  models, `~/.codex/models_cache.json`, `copilot --help`), repo-içi fallback'lerle birlikte.
  OpenCode'un listesi canlıdır: yeni bir `GET /api/models/opencode` route'u OpenRouter'ın
  public models API'sini sunucu tarafında proxy'ler (herhangi bir fetch hatasında boş liste,
  dashboard'ı asla çökertmez).
- **Stale-install versiyon sapması tespiti.** `install.sh`/`install.ps1` artık kurulu
  plugin versiyonunu `~/.config/cli-dispatch/.installed-version`'a damgalıyor;
  `/cli-dispatch:status`, kurulu bir kopya artık mevcut `plugin.json` ile eşleşmediğinde
  uyarıyor — çünkü kurulu kopyalar repo'dan ayrı deploy'lardır ve sessizce sapabilir.
- **`check-version-sync.mjs` eklendi**; `CHANGELOG.md`/`CHANGELOG.tr.md`/`marketplace.json`
  versiyon sapmasını otomatik yakalar — her iki dosya da daha önce sessizce plugin
  versiyonunun gerisinde kalmıştı (sırasıyla v3.21.0 ve v2.1.0), fark etmenin otomatik bir
  yolu yoktu. Bu release'in kendisinin senkron kaldığını doğrulamak için kullanıldı.

### Düzeltildi

- **`cx-stream --resume` artık session'ın orijinal çalışma dizinini geri yüklüyor**, ve
  **`cp-stream --resume` artık gerçek Copilot `threadId`'sini çözümlüyor** — kendi
  `cp-<id>` session id'mizi doğrudan `copilot`'a geçmek yerine (Fixes #75, #71). Ayrıca
  bir tool-error payload'ının `error`/`message` alanı obje olduğunda `"[object Object]"`
  literal string'i olarak render edilen bir hata-serileştirme hatası düzeltildi.
- **Worktree tabanlı delegasyon artık `origin/main`'i base branch olarak hardcode etmiyor**
  (Fixes #74). `main` branch'i olmayan repolar (develop-only, feature-branch-tabanlı) ya
  doğrudan başarısız oluyor ya da worktree'yi sessizce eski/uyumsuz bir ref'e
  dayandırıyordu; base ref artık şu sırayla çözümleniyor: repo'nun mevcut checkout edilmiş
  branch'i, sonra origin'in remote HEAD'i, son çare olarak `origin/main`.
- **Açık `OC_MODEL` olmayan OpenCode session'ları artık dashboard'da gerçekte kullanılan
  modeli gösteriyor** — yeni bir `OC_META_MODEL` fallback'i (OpenCode'un kendi config'inden
  kazınır) ile, mevcut Codex `META_MODEL`/`META_EFFORT` desenini yansıtır.
- **Windows (PowerShell) wrapper'ları bash eşdeğerleriyle eşitleniyor.**
  `claude-ds-stream.ps1`, `cx-agent.ps1` ve `cx-stream.ps1` artık `--effort` desteği,
  `META_MODEL`/`META_EFFORT` config-scrape fallback'i ve `gh`-token forwarding kazandı —
  önceden yalnızca bash'te vardı.

### Değişti

- **`dashboard-server.mjs`, `public-page.mjs` (client SPA template) ve `dashboard-utils.mjs`
  (saf flow/process yardımcıları) olarak ikiye bölündü** — bakım kolaylığı için, davranış
  değişikliği yok (HTTP response diff ile öncesi/sonrası byte-identical doğrulandı).
  `cx-stream-parse.mjs`, `ag-transcript-parse.mjs` ve yeni ayrıştırılan
  `dashboard-utils.mjs` hot path'leri için eksik regression test kapsamı eklendi; hiçbiri
  daha önce test edilmemişti, oysa `readHead`/`readTail` ve `collectProcTree`'de yakın
  zamanda gerçek hatalar düzeltilmişti.
- **`watchdog()` runtime-cap/idle-timeout mantığı** `cx-stream`, `oc-stream` ve `cp-stream`
  arasında (öncesinde her birinde byte-identical copy-paste) paylaşılan `stream-utils.sh`'a
  taşınarak tekilleştirildi — dahili bakım kolaylığı iyileştirmesi, davranış değişikliği yok.

## [3.26.1] — 2026-07-06 15:00

### Düzeltildi

- **`claude-ds-stream` artık kesintileri kaydediyor, session'ları sonsuza kadar
  `running` durumunda bırakmıyor.** INT/TERM trap'i olmayan tek backend
  wrapper'ıydı; bu yüzden kesintiye uğrayan bir DeepSeek session'ının
  `status.json`'ı hiçbir zaman `running` durumundan çıkmıyordu. Diğer stream
  wrapper'larının zaten kullandığı aynı interrupt-handling deseni geri
  taşındı (parser çıkışının doğru sıralanması için yeni bir sıralama
  işaretiyle birlikte); gerçek bir kesintiye karşı canlı doğrulandı ve artık
  temiz şekilde `interrupted: INT` kaydediyor. `cp-stream` de kardeşlerinde
  zaten var olan aynı sınırlı-bekleme parser mantığını ve eksik bir cleanup
  güvenliğini kazandı.
- **Dashboard sağlamlaştırma düzeltmeleri.** Log kuyruklama (`readHead`/
  `readTail`) artık hatada dosya tanımlayıcısı (fd) sızdırmıyor. Yarıda kalan
  bir devralma (takeover) işlemi daha önce bir worker'ı kalıcı olarak
  "kullanımda" (409) raporlar hâlde sıkışmış bırakabiliyordu — artık
  başarısızlıkta temiz şekilde sonlandırılıp serbest bırakılıyor. Süreç
  ağacı toplama artık "process-list araması başarısız oldu" ile "worker'ın
  gerçekten hiç çocuk süreci yok" durumlarını ayırt ediyor ve başarısızlığı
  sessizce yanlış raporlamak yerine bir kez logluyor.
- **Dokümantasyon gerçek davranışla yeniden senkronize edildi.** `--effort`
  reasoning-seviyesi bayrağı artık DeepSeek, Antigravity ve Codex runner'ları
  için de belgelendi (önceden yalnızca Copilot için belgeliydi, oysa dördü de
  destekliyor). Codex'in `--no-network` bayrağı belgelendi. Antigravity
  runner rehberi eksik olan "Model seçimi" ve "Resume" bölümlerini kazandı;
  OpenCode runner rehberindeki eski versiyon notu düzeltildi; DeepSeek runner
  rehberi "Read-only" ve "Resume" bölümlerini kazandı.

## [3.26.0] — 2026-07-06

### Eklendi

- **Dashboard, bir Claude Code subagent'ının hangi Anthropic modelini kullandığını gösterir.**
  Subagent çip listesi ve subagent detay breadcrumb'ı artık her Claude Code subagent'ının
  yanında model rozeti (örn. Sonnet, Opus, Haiku) gösterir; üst-seviye Claude Code session
  listesindeki model rozetiyle aynı tail-scan tekniğini kullanır. Böylece yalnızca üst-seviye
  session'ı değil, belirli bir subagent'ı gerçekte hangi modelin çalıştırdığını tek bakışta
  görmek kolaylaşır.

### Düzeltildi

- **5 runner agent'ın tamamı fire-and-forget beklemelere ve doğrulanmamış iddialara karşı
  sertleştirildi (#63, #64, #65).** ds/ag/cx/oc/cp-runner'ın hepsinde, babysitter
  subagent turn'ünün worker'ın gerçekten terminal state'e ulaştığını doğrulamadan bitebildiği
  bir güvenilirlik açığı vardı; bu da worker'ları öksüz bırakabiliyor veya Task kaydını zombie
  hâline getirebiliyordu. Mekanik bir terminal-state kapısı eklendi: babysitter turn'ü, taze
  bir `status.json` okuması terminal state doğrulamadan bitemez. Buna iki zorunlu
  iddia-doğrulama kuralı eklendi: bir hataya base state'e karşı kanıtlamadan asla
  "pre-existing" etiketi koyma ve görevin kendi adlandırılmış gereksinimlerine karşı mekanik
  checklist olmadan asla "done" raporlama.

## [3.25.0] — 2026-07-06

### Eklendi

- **`/cli-dispatch:setup`, delegasyon-önceliği hatırlatıcısını CLAUDE.md'ye kalıcı yazmayı
  teklif eder.** Setup artık `AskUserQuestion` ile global veya project `CLAUDE.md` dosyana
  kalıcı bir "runner delegation priority" hatırlatıcısı yazmak isteyip istemediğini soran yeni
  bir adım içerir. Kabul edildiğinde hatırlatıcı idempotent ve marker-korumalıdır
  (`<!-- cli-dispatch:orchestration-priority -->`); böylece delegasyon-önceliği talimatlarını
  her session'a elle tekrar yapıştırman gerekmez, plugin bunu bir kez yazıp yerinde bırakabilir.

### Düzeltildi

- **`cp-stream-parse`, ephemeral reasoning'in final cevabı ezmesine artık izin vermiyor (#62).**
  GitHub Copilot'ın `assistant.reasoning` event'leri (`ephemeral: true` işaretli), gerçek final
  `assistant.message` hemen ardından gelip yakalanan final cevabı gerçek rapor yerine dahili bir
  reasoning parçasıyla ezebiliyordu. Kök neden, gerçek bir geçmiş session transcript'inin parser
  üzerinden yeniden oynatılmasıyla bulundu. Düzeltme, ephemeral/reasoning event'lerinin `finalText`
  alanına hiç dokunmamasını sağlar; yeni regression test'i
  (`plugins/cli-dispatch/scripts/__tests__/cp-stream-parse.test.mjs`) davranışı kilitler.

## [3.24.0] — 2026-07-06

### Eklendi

- **ag/cx/oc/cp-runner için config seviyesinde aday model listeleri (`AG_MODELS`,
  `CX_MODELS`, `OC_MODELS`, `CP_MODELS`).** Bu dört runner artık mevcut tek-değerli `_MODEL`
  key'leriyle uyumlu şekilde config'te kalıcı, virgülle ayrılmış aday-model listesi kabul eder;
  böylece listeyi her delegasyon prompt'unda tekrar yazmak gerekmez. Orkestratör delegasyonu
  açık bir model veya satır-içi aday liste vermediğinde runner önce bu config key'lerini kontrol
  eder ve mevcut tek-değerli `_MODEL` default'una düşmeden önce en uygun adayı kendisi seçer.
  Dashboard Configuration UI'a (yeni alanlar + yardım metni) ve `install.sh`/`install.ps1` config
  template'lerine bağlandı. `DS_MODELS` bilinçli olarak hariçtir — ds-runner bu özelliğin dışında
  kalır.

### Düzeltildi

- **`cx-stream`, Codex'in default reasoning effort'unu artık dashboard etiketinde gösterir.**
  `--effort` geçilmediğinde Codex kendi `~/.codex/config.toml` `model_reasoning_effort`
  default'unu (örn. "high") sessizce uyguluyordu, ama dashboard hiçbir thinking-level suffix'i
  göstermediği için gerçekte uygulanmış effort yokmuş gibi görünüyordu. Mevcut `META_MODEL`
  fallback desenini yansıtır (`config.toml` aynı şekilde kazınır), böylece etiket gerçekten
  ne koştuğunu her zaman yansıtır.

## [3.23.0] — 2026-07-06

### Eklendi

- **Dashboard config editor (secret'lar write-only).** Dashboard artık cli-dispatch config dosyası
  için bir config editor içerir — API key'leri ve diğer secret alanları write-only'dir (kaydedildikten
  sonra asla geri echo edilmez), secret olmayan alanlar doğrudan görüntülenip düzenlenebilir.
  Maskelenmiş önizleme (örn. `sk-...a1b2`), tam değeri UI'da hiç açığa çıkarmadan hangi key'in
  yapılandırıldığını doğrulamaya yetecek kadarını gösterir.
- **`_MODEL` config alanları artık yalnızca tek-değerli olduklarını belgelemektedir** — aşağıdaki
  yeni çok-adaylı model listesi özelliğiyle karışmasını önlemek için docs netleştirildi.
- **ag/cx/oc/cp-runner bir aday model listesinden seçim yapabilir.** Tek sabit `_MODEL` config
  değeri yerine bu dört runner artık aday model listesi kabul eder; babysitter subagent dispatch
  sırasında göreve en uygun olanı listeden seçer.
- **Terminal-styled session/subagent/worker flow box.** Dashboard artık session → subagent → worker
  ilişkisini terminal-styled bir kutu içinde render eder; delegasyon zincirini tek bakışta okumak
  kolaylaşır.
- **Claude Code sekmesi her session'ın güncel modelini gösterir.** Claude Code sekmesindeki session
  satırları artık o session'da kullanılan mevcut modeli gösterir.
- **Dashboard toplam delegasyon maliyetini + yüksek-overhead uyarısını gösterir.** Dashboard artık
  tüm delege edilmiş worker session'ları genelinde toplam maliyeti toplar ve delegasyon overhead'i
  yapılan işe göre orantısız yüksek olduğunda uyarı gösterir.
- **Her worker satırı kendi babysitter subagent'ını + o subagent'ın token usage'ını çözer.**
  Worker detay görünümleri artık yalnızca worker'ı değil, belirli bir worker'dan sorumlu
  babysitter subagent'ını (ds/ag/cx/oc/cp-runner) ve o subagent'ın kendi token usage'ını gösterir.
- **Worker satırları parent Claude Code session'ını gösterir.** Worker detay görünümü artık worker'ı
  onu başlatan Claude Code session'ına geri bağlar; böylece worker'ı dispatch eden konuşmaya iz
  sürmek kolaylaşır.

### Düzeltildi

- **`parent-index`, çıplak üst-seviye eşleşme yerine çözümlenmiş subagent eşleşmesini tercih eder.**
  Hem belirli bir subagent hem de genel bir üst-seviye session bir worker'ın parent'ı gibi
  görünebildiğinde, index artık çıplak üst-seviye eşleşmeye düşmek yerine daha spesifik subagent
  eşleşmesini tercih eder.
- **`oc-stream`, OpenCode'un kendi interrupted-call cancellation'larını artık fatal saymıyor.**
  OpenCode normal çalışmasının parçası olarak bazen kendi devam eden tool call'larını içeride iptal
  eder; `oc-stream` bunları fatal error sanıp session'ı öldürüyordu. Artık tanınıp yok sayılıyorlar.
- **`cp-stream-parse`, gerçek tool name/args bilgisini Copilot'ın gerçek event şemasından çıkarır.**
  Önceki parser, Copilot CLI'ın gerçekte ürettiğiyle eşleşmeyen dokümante bir event şeklini varsayıyordu;
  bu yüzden worker log'undaki tool call'lar boş veya hatalı ad/arg gösteriyordu. Gerçek, dokümante
  olmayan şemaya göre yeniden işlendi.
- **`cx-runner`, Codex rate-limit durumunu net raporlar ve reroute önerir.** Codex görev ortasında
  rate limit'e takıldığında runner artık genel bir failure yerine açık bir rate-limit mesajı gösterir
  ve görevin başka backend'e yönlendirilmesini önerir.
- **`worktree-run.sh` script'leri kill edildiğinde worktree'lerini artık otomatik silmez.** Bir
  worker'ı koşu ortasında öldürmek eskiden script'in cleanup trap'ini tetikliyor ve git worktree'yi
  içindeki devam eden işle birlikte siliyordu; trap artık kill sinyalinde çalışmaz.
- **`install.sh`, human-takeover destek dosyalarını hiç kurmuyordu.** Temiz kurulumlarda dashboard'un
  "Take control" özelliği için gereken `pty-host.mjs`, `takeover-cmd.mjs` ve `vendor/` dizini eksikti;
  bu yüzden özellik, o sürümden sonra kurulmuş her makinede sessizce başarısız oluyordu. Installer artık
  üçünü de kopyalar.
- **Takeover spawn failure artık tüm dashboard'u çökertmez.** Human-takeover session'ı için alttaki
  CLI'ı spawn etmek başarısız olduğunda (örn. eksik binary), hata eskiden yalnızca o takeover denemesi
  yerine tüm dashboard process'ine yayılıp çökertiyordu.

## [3.22.0] — 2026-07-04

### Eklendi

- **Dashboard için human-takeover (5 backend'in tamamı).** Worker satırının detay görünümünde artık
  bir "Take control" aksiyonu var: headless worker process'ini öldürür, alttaki CLI'ı
  (DeepSeek/Antigravity/Codex/OpenCode/Copilot, desteklenenlerde session'ı resume ederek) bir PTY
  altında başlatır ve elde yazılmış WebSocket üzerinden tarayıcıdaki xterm.js terminaline stream eder;
  böylece insan, takılmış veya belirsiz bir session'a context'i kaybetmeden müdahale edebilir.
  "Hand back" PTY'yi kapatır ve session'ı yeniden headless tracking'e devreder. Varsayılan read-only'dir;
  bu, yalnızca zaten sahip olunan worker session'larıyla sınırlı açık opt-in write path'tir.
- **CC session / subagent token usage.** Claude Code sekmesindeki session ve subagent detay görünümleri
  artık transcript'in kendi turn-başına `usage` bilgisinden toplanmış bir "Usage: N in / M out" satırı
  gösterir (`message.id` ile dedupe edilir; çünkü Claude Code aynı usage'ı her content block için bir
  JSONL satırı olarak tekrar yayar).
- **Worker flow: tool call'lar ve AI mesajları artık görsel olarak ayrıdır.** Worker `progress.log`
  satırları zaten event tipine göre başta bir glyph taşıyordu (`·` message, `✻` thinking, `$` shell
  command, `✎` edit, `▸` tool, `✗` error), ama dashboard hepsini tek düz "log" kovası gibi render
  ediyordu. Renderer artık her glyph'i native Claude Code session'larının aldığı aynı
  message/tool/thinking step stillerine eşler; girintili tool-result satırları için de ayrı stil vardır.
- **Dashboard filtre default'ları.** Claude Code sekmesi artık yüklenirken "all" yerine "busy" filtresiyle
  açılır. Workers sekmesi, worker'ın cwd'sinin son iki path segmentinden türetilmiş bir project label'ı
  backend/model satırının altında gösterir.

### Düzeltildi

- **5 stream wrapper'ın tamamında exit-code reconciliation.** `claude-ds-stream`, `ag-stream`,
  `cx-stream` ve `oc-stream` artık SIGINT/SIGTERM sırasında parser'ın yazdığı status'u alttaki CLI'ın
  gerçek exit code'uyla uzlaştırır; `cp-stream`'in mevcut davranışıyla aynı hizaya geldi. Öldürülen
  worker artık `status.json` içinde `done` iddia ederek kalmaz.
- Dashboard: worker detay header'ı artık ham (ve yanıltıcı) `running` state metni yerine `stale`
  session'ları yansıtır.
- OpenCode takeover resume artık `oc-stream`'in kendi doğrulanmış resume çağrısıyla uyumlu olarak
  `--session` yanında `--continue` geçirir.

## [3.21.0] — 2026-07-04

### Eklendi

- **Dashboard'da worker usage görünürlüğü.** Parser'lar worker CLI'ın sunduğu token/maliyet
  bilgisini artık yakalıyor (DeepSeek: claude stream-json `result` event'inden; Copilot:
  dokümante olmayan şema üzerinde savunmacı çoklu-desen eşleme; Antigravity: veri yok,
  `null` kalır; Codex/OpenCode zaten yakalıyordu). Dashboard tüm şekilleri sunucu tarafında
  `{inTok, outTok, costUsd}` olarak normalize eder ve worker listesinde kompakt bir usage
  rozeti ("1.5k in / 4.1k out · $0.042") + worker detayında ayrıntılı usage satırı gösterir.
  Tamamen geriye uyumlu: usage'ı olmayan session'lar için hiçbir şey render edilmez.

## [3.20.0] — 2026-07-04

### Eklendi
- **Yeni backend: GitHub Copilot (`cp-*`).** cli-dispatch'in 5. worker backend'i olarak GitHub Copilot (npm `@github/copilot`, binary `copilot`) eklendi. OpenCode (`oc-*`) backend'inin ayak izinin tam karşılığı: `cp-agent` / `cp-stream` / `cp-worktree-run.sh` / `cp-stream-parse.mjs`, `cp-runner` babysitter subagent'ı ve `/cli-dispatch:cp-run`, `cp-status`, `cp-sessions`, `cp-balance` komutları — ayrıca her cross-backend aggregator (`setup`, `doctor`, `status`, `help`, `sessions`, `balance`, `resume`, `clean`), dashboard worker-panel etiketi, `plugin.json` ve README güncellendi.
- **Copilot'ta gerçek sandbox yok.** OpenCode gibi GitHub Copilot'ta OS-seviyesi veya tool-seviyesi write-deny yok; her zaman geçilen `--allow-all-tools --no-ask-user`, headless kullanım için bir güvenlik opsiyonu değil işlevsel gerekliliktir — tek güvenlik sınırı git-worktree izolasyonudur.
- **Copilot auth/model/effort desteği.** `cp-stream` ortak `maybe_export_gh_token` yardımcısını kullanır (`COPILOT_GITHUB_TOKEN` > `GH_TOKEN` > `GITHUB_TOKEN`), `CP_MODEL`'i dikkate alır, `--add-dir "$CWD"` ve `--no-auto-update` geçirir, repo-geneli `--effort low|medium|high` bayrağını Copilot'ın `--reasoning-effort=<seviye>` bayrağına eşler.
- **Copilot bakiyesi dürüstçe belgelendi.** `cp-balance` ve toplu balance komutu kullanımın CLI'dan sorgulanamadığını söyler; `/usage` yalnızca Copilot REPL içinde interaktif çalışır, gerçek kullanım/limitler GitHub Billing'dedir.
- **Windows v1 için ertelendi.** Copilot v1 için yalnızca Unix'tir (macOS/Linux/WSL); `install.ps1` ve varsa `.ps1` eşleri değiştirilmedi.

## [3.19.0] — 2026-07-04

### Eklendi
- **`--install-missing` / `-InstallMissing` — eksik worker CLI'larının opt-in otomatik kurulumu.** `install.sh`/`install.ps1`'e geçildiğinde, yalnızca seçilen bir backend'in altındaki worker CLI'ı eksikse (`claude`, `agy`, `codex`, `opencode`) devreye girer: installer sadece uyarmak yerine otomatik kurmayı dener.
  - **claude**: npm (`npm i -g @anthropic-ai/claude-code`) tercih edilir, fallback olarak `curl | bash` vendor installer.
  - **agy**: yalnızca `curl | bash` vendor installer (npm paketi yok).
  - **codex**: sırasıyla npm (`npm i -g @openai/codex`), `brew install --cask codex`, son çare olarak `curl | bash` vendor installer.
  - **opencode**: yalnızca npm (`npm i -g opencode-ai`).
  - Her denemeden sonra `command -v` (Windows'ta `Get-Command`) ile yeniden kontrol eder ve başarı/`FAIL` yazdırır; başarısızlıkta mevcut WARNING + manuel-talimat bloğuna değişmeden düşer.
  - **Varsayılan KAPALI** — bayrağı geçmemek installer davranışını byte-byte aynı bırakır.
  - **Auth asla otomatikleştirilmez**: agy sign-in, `codex login`, DeepSeek/OpenRouter API key'leri her zaman kullanıcıya bırakılır — başarılı bir otomatik-kurulumdan sonra bile.
  - `/cli-dispatch:setup`, bayrağı yalnızca kullanıcının `AskUserQuestion` ile açık onayını aldıktan sonra ekler; hangi CLI'ların eksik olduğunu ve hangi komutların çalışacağını listeler.

## [3.18.0] — 2026-07-03

### Eklendi
- **Host'un `gh` kimliğini sandbox'lı worker'lara aktar** ([#56](https://github.com/rbinar/cli-dispatch/issues/56)). macOS'ta `gh`, OAuth token'ını sistem Keychain'inde saklar (`~/.config/gh/hosts.yml`'de değil); sandbox'lı worker'lar buna erişemez — bu yüzden delege edilen her `gh issue`/`gh pr`/`gh api` çağrısı kimliksiz çalışıp sessizce boş döner (Codex `workspace-write` ve DeepSeek worker'larında gözlendi: *"gh auth status 7 denemede de geçersiz token döndürdü"*). Çözüm:
  - `stream-utils.sh` içinde yeni ortak yardımcı `maybe_export_gh_token`; **dört** stream wrapper'ında da (`cx-stream`, `ag-stream`, `claude-ds-stream`, `oc-stream`) `source_config` sonrası çağrılır — böylece her backend için hem `*-agent` hem `*-worktree-run.sh` başlatma yollarını kapsar. Host'un token'ını `GH_TOKEN` olarak dışa aktarır (`gh` bunu keyring'e tercih eder); yalnızca kullanıcı `GH_TOKEN`/`GITHUB_TOKEN` set etmemişse. `gh auth token` kullanır (ağ turu yok).
  - **Devre dışı bırakma:** aktarımı kapatmak için `CLI_DISPATCH_NO_GH_TOKEN=1` (token geniş kapsam taşıyabilir — `repo`, `workflow`, hatta `delete_repo` — ve worker sandbox'ına / sağlayıcı bağlamına girer).
  - **`doctor`** yeni bir *GitHub CLI (gh)* bölümüyle durumu raporlar: aktarım-kapalı (opt-out), kullanıcı-set token, otomatik-aktarıldı, veya *kimlik doğrulanmamış → delege gh görevleri başarısız olur*.
  - README'de *Security and data* altında belgelendi.
- **Codex worker artık default network erişimli** (workspace-write sandbox). Codex `workspace-write`'ta network'ü default kapatır; bu yüzden `GH_TOKEN` aktarılsa bile `gh`/`curl`/`pip` *"error connecting to api.github.com"* ile başarısızdı — diğer backend'lerde (ds/agy/oc, sandbox yok) tam network varken. `cx-stream` artık default `-c sandbox_workspace_write.network_access=true` enjekte eder; cx diğerleriyle aynı hizada. Çağrı-başına `cx-agent --no-network` ile, global olarak config'te `CX_NETWORK=0` ile kapatılır; `--read-only` tam izole kalır (network yok). Status satırı `sandbox: workspace-write (network: on|off)` gösterir. Canlı doğrulandı: `cx-agent` flag'siz `gh` ile private GitHub issue okuyor.

## [3.17.0] — 2026-07-02

### Eklendi
- **`--effort low|medium|high` — üç backend'de görev-başına reasoning-effort seçimi** (agent + stream wrapper'ları):
  - **antigravity**: agy effort'u yalnızca model görünen-adının suffix'iyle sunar; `--effort` bunu birleştirir — `--model "Gemini 3.5 Flash" --effort low` → `"Gemini 3.5 Flash (Low)"` (mevcut suffix değiştirilir); `--model`'siz, `agy models`'ın o effort'taki ilk kaydı seçilir. Birleştirilen ad mevcut bilinmeyen-model doğrulamasından geçer. Canlı doğrulandı: oturum `Gemini 3.5 Flash (Low)` kaydetti.
  - **codex**: `codex exec -c model_reasoning_effort=<seviye>`'ye eşlenir (hem yeni hem resume arg yolları). Oturumun model etiketi kaydeder, ör. `gpt-5.5 (low)` — canlı doğrulandı.
  - **deepseek**: worker'ın thinking bütçesini `MAX_THINKING_TOKENS` ile ayarlar (low=1024, medium=8192, high=31999). Canlı doğrulandı: koşunun transcript'i thinking blokları içeriyor ve oturum `deepseek-v4-pro (high)` kaydetti. Best-effort olarak dokümante edildi (bütçenin uygulanması API'ye ait).
  - **opencode**: `--effort` net mesajla **reddedilir** (exit 2) — opencode CLI reasoning-effort kontrolü sunmuyor.
  - Runner brief'leri güncellendi: ag/cx/ds `--model` ile aynı ZORUNLULUĞU alır (görev effort adlandırıyorsa `--effort` geçmek şart); ds'inki best-effort işaretli; oc-runner effort isteklerini orkestratöre geri gönderir. Geçersiz seviyeler gürültülü patlar (exit 2). Env fallback'leri: `AG_EFFORT` / `CX_EFFORT` / `CLAUDE_DS_EFFORT`.

## [3.16.0] — 2026-07-02

### Eklendi
- **Dashboard artık her worker'ın GERÇEKTE kullandığı modeli backend bazında gösteriyor.** `meta.json`'daki `model` alanı yalnızca istenen `--model` bayrağının / config defaultunun echo'suydu — model açıkça geçilmediğinde antigravity/codex/opencode için boştu; Workers listesi çoğu oturumda model göstermiyordu. Artık:
  - **antigravity**: parser, transcript'in `USER_INPUT` ayar-değişikliği bloğundan (``changed setting `Model Selection` … to Gemini 3.5 Flash (High)``) *gözlemlenen* modeli kazır ve istenen değeri ezmesine izin verir — gözlemlenen gerçektir; agy bilinmeyen istekte sessizce defaulta düştüğünde bile kayıt doğru olur.
  - **deepseek**: parser modeli env echo yerine stream'in `system/init` eventinden (API'nin gerçekte bildirdiği) damgalar.
  - **codex**: `codex exec --json` hiç model alanı taşımıyor (doğrulandı); model istenmediğinde `cx-stream`, codex'in kendi config defaultunu (`~/.codex/config.toml` `model = "…"`) — codex argümanlarına dokunmadan — oturum kaydına yazar.
  - **opencode**: ileride opencode `part.info.modelID`/`part.modelID` verirse fırsatçı yakalama (bugün no-op; `OC_MODEL` config defaultu alanı zaten dolduruyor).
  - **dashboard**: model yine de bilinemiyorsa (bu değişiklikten önceki eski oturumlar) liste satırı / crumb / bağlı-worker çipleri hiçlik yerine soluk `default` etiketi gösterir.

## [3.15.4] — 2026-07-02

Vaad-edilen-vs-teslim-edilen denetimi (README/komutlar/ajan-talimatları/script'ler üzerinde 4 paralel salt-okunur denetçi); bulgular düzeltilmeden önce repro ile doğrulandı.

### Düzeltildi
- **Antigravity backend'i tamamen ölüydü.** Track B refactor'ı `ag-transcript-parse.mjs`'in `node:fs` import'undan `openSync`/`closeSync`'i düşürmüş, `drain()` ise hâlâ çağırıyordu; ReferenceError `catch { return }` ile yutuluyordu — tailer agy transkriptinden tek byte okumadan her ag koşusu `state:"error"`, boş transcript kopyası, boş progress.log ve stdout'suz bitiyordu. Import geri eklendi; uçtan uca doğrulandı (sahte-transkript repro + canlı `ag-agent -q` smoke testi `OK` döndü).
- **Temiz kurulumlar kırık wrapper gönderiyordu: paylaşılan helper'lar hiç kurulmuyordu.** 3.15.x refactor'ları `stream-utils.sh` (her bash stream wrapper'ı `$SCRIPT_DIR` üzerinden source eder) ve `parse-utils.mjs`'i (her parser `./parse-utils.mjs` olarak import eder) çıkardı, ama `install.sh`/`install.ps1` ikisini de kopyalamıyordu — temiz kurulum/yeniden kurulum dört backend'de de eksik-dosya source hatası ya da `ERR_MODULE_NOT_FOUND` ile ölüyordu (mevcut makineler yalnızca bayat, refactor-öncesi kendine-yeten kopyalarla çalışmaya devam ediyordu). İki installer da helper'ları artık koşulsuz kurar.
- **`claude-ds-stream` eksik-key hatası açıklamak yerine çöküyordu.** Dostane "DEEPSEEK_API_KEY not set. Add it to <config>" mesajı `$CONFIG`'e başvuruyordu; config yükleme `source_config`'e (local değişken) taşınınca değişken yok oldu — `set -u` altında yol `CONFIG: unbound variable` ile ölüyordu. `source_config` artık çözümlenen yolu `CONFIG` olarak dışa açar.
- **Config'teki `CODEX_API_KEY` codex'e hiç ulaşmıyordu (macOS/Linux).** Config key-tabanlı headless auth vadediyor, ama bash `cx-stream` config'i export etmeden source ediyordu — değişken subprocess ortamına girmiyordu (PowerShell ikizi zaten export ediyordu — platform sapması). Artık `CODEX_API_KEY`/`OPENAI_API_KEY` set ise export edilir; `oc-stream`'in `OPENROUTER_API_KEY` işleyişiyle aynı.
- **Watchdog timeout'ları cx/oc oturum kayıtlarında görünmezdi.** `--max-runtime`/`--idle-timeout` kill'inde parser yalnızca stdin EOF görüp `state:"done"`/`exitCode:0` ile finalize ediyordu — timeout sadece wrapper'ın exit kodunda vardı; dashboard/sessions/clean başarılı koşu görüyordu. Yeni paylaşılan `reconcile_session_error` helper'ı iki wrapper'ın timeout yolundan `status.json`/`meta.json`'ı yeniden yazar (`state:"error"`, gerçek neden, gerçek rc) — DeepSeek backend'inin mevcut post-run reconcile'ıyla aynı.
- **Cevabı yalnızca streamed text olarak gelen DeepSeek koşularında `progress.log` son mesajı almıyordu.** `finalize()` `closeAll()`'ı `flushPending()`'den önce çağırıyordu; `appendProgress` kapalı fd'de no-op. Sıra değiştirildi; repro ile doğrulandı.
- **Dashboard bağlı-worker çipleri model/bayatlık göstermiyordu.** `workerPanelHtml` `w.model` ve `w.stale` render ediyor, ama `linkedWorkers()` bu alanları sonucuna koymuyordu — çipler ölü worker'da ham `running` gösteriyor, model hiç görünmüyordu. Alanlar eklendi.
- **Kaldırma talimatı var olmayan marketplace'i siliyordu.** README `/plugin marketplace remove claude-ds` diyordu; marketplace'in adı `cli-dispatch`. İki README'de de düzeltildi.
- **DeepSeek script'leri kullanıcıyı var olmayan slash komutuna yönlendiriyordu.** Beş kullanıcı-görünür hata mesajı "run /cli-dispatch:ds-setup" diyordu; komut `/cli-dispatch:setup`.

### Değişti
- **TERMINAL.md `claude-ds` → `cli-dispatch` rename'inden arındırıldı:** installer/worktree yolları, config yolu (dokümante legacy yola konan key sessizce yok sayılıyordu), sessions dizini, parser kurulum yolu, `CLI_DISPATCH_*` env adları (legacy `CLAUDE_DS_*` hâlâ geçerli notuyla) ve "dört executable" yanlış sayımı.
- **OpenCode görünürlüğü:** `ds-delegate` skill'i artık OpenCode backend'ini dokümante eder (bölüm, komutlar, tetikleyiciler, rol satırı) — 4. backend delegasyon skill'inden keşfedilemez durumdaydı; `dashboard.md` ve `watch.md` açıklamaları OpenCode'u sayar; README "kaputun altı" CLI tablosuna `oc-stream`/`oc-agent` satırları eklendi (iki dil); `oc-run.md`'nin bayat "resume doğrulanmadı" uyarısı 3.15.1'de doğrulanmış ifadeyle değiştirildi.
- **Runner-brief model doğrulama ifadesi dürüstleştirildi:** `meta.json` worker'ın gerçekte koştuğu modeli değil, *istenen* modeli (bayraktan echo) kaydeder — ag-runner talimatı artık gerçek güvencenin tam `agy models` adı + ag-stream'in bilinmeyen-model uyarısı olduğunu söyler; cx/oc talimatları geçersiz slug'ın gürültülü patlaması sayesinde başarılı koşuda istenen = gerçek olduğunu not eder.
- **`ag-runner` talimatı: `--read-only` reddi doğru katmana atfedildi** (`ag-agent` iletir; `ag-stream` exit 2 ile reddeder).

### Kaldırıldı
- `ag-version.sh` — öksüz: hiçbir şey kurmuyor, hiçbir şey başvurmuyordu.

## [3.15.3] — 2026-07-02

### Değişti
- **Worker model zorunluluğu tüm runner ajanlarına genişletildi (3.15.2'deki `ag-runner` sertleştirmesinin devamı).** `cx-runner`'a "Worker model selection" bölümü eklendi (hiç yoktu): görev bir model adlandırıyorsa `--model <slug>` ZORUNLU; codex'e özgü fark, geçersiz slug'ın sessiz fallback yerine API hatasıyla yüksek sesle patlaması ve varsayılanın `~/.codex/config.toml` / `CX_MODEL`'den gelmesi. `oc-runner`'ın mevcut bölümü aynı şekilde sertleştirildi (istendiğinde zorunlu, çıplak OpenRouter slug'ı, geçersiz slug'da gürültülü hata). `ds-runner`'a ters yönde not eklendi: `ds-agent`'ta `--model` bayrağı YOK — model `DS_MODEL` / `DS_FLASH_MODEL` ile sabit; göreve özel model isteği doğaçlanmadan orkestratöre backend seçimi olarak geri gönderilmeli. Üçüne de koşu sonrası `meta.json` doğrulama adımı ve her iki dönüş formatına `model:` satırı eklendi — `ag-runner` ile aynı.
- **`oc-runner`: bayat resume-semantiği TODO'su kaldırıldı.** `--session <id> --continue` davranışı 3.15.1'de canlı doğrulanmıştı (*adlandırılan* oturumu devam ettiriyor); ajan talimatı hâlâ "doğrulanmadı" TODO bloğunu taşıyordu — doğrulanmış ifadeyle değiştirildi.

## [3.15.2] — 2026-07-02

### Değişti
- **`ag-runner`: worker model seçimi artık öneri değil, zorunluluk.** Oturum kayıtları, orkestratör "Gemini 3.5 Flash" istediği hâlde antigravity oturumlarının çoğunun `model: ""` (agy varsayılanı) ile koştuğunu gösterdi — babysitter `--model` bayrağını hiç geçmiyordu. Ajan talimatı artık açık: görev bir worker modeli adlandırıyorsa, `agy models` çıktısındaki TAM satırla (reasoning eki dâhil) `--model` geçmek ZORUNLU; agy eksik/bilinmeyen isimde sessizce varsayılana düşer, bu yüzden bayrağı atlamak görevi başarısız saymak demektir. 3 adımlı prosedür eklendi (tam ismi kopyala → aynen geç → koşu sonrası oturumun `meta.json`'ındaki `"model"` alanını doğrula) ve her iki dönüş formatına `model:` satırı eklendi — orkestratör hangi modelin gerçekten koştuğunu her zaman görür.

### Düzeltildi
- **Dashboard: canlı yenileme artık titremiyor (flicker).** Her SSE change event'i detay görünümünü `loading…`'e boşaltıp sıfırdan kuruyordu (`loadList()` de fetch sonuçlanmadan sol rayı temizliyordu) — meşgul bir oturumda bu sürekli flaş ve scroll'un en başa zıplaması demekti. Artık: görünümler string'e render edilir ve HTML gerçekten değiştiyse DOM'a dokunulur (fs.watch uyanmalarının çoğu no-op olur), swap'lerde hem rayın hem ana panelin scroll konumu korunur, change patlamaları istemci tarafında 600ms'de en fazla bir yenilemeye koalese edilir, `loading…` yalnızca *farklı* bir öğeye geçerken gösterilir ve worker "Görev / talimat" paneli yenilemeler arasında açık/kapalı durumunu korur.
- **Dashboard: Workers filtre çipleri doğuştan ölüydü.** `setWFilter` onclick'i sunucu tarafı template literal içinde tek backslash kaçış (`\'`) kullanıyordu; bu, sunulan sayfada çıplak tırnağa dönüşüp istemci script'inin tamamını syntax hatasıyla kırıyordu. Bir üst satırdaki Claude Code filtresiyle aynı şekilde düzgün kaçışlandı (`\\'`). Gömülü `<script>`'i tarayıcının değerlendirdiği gibi değerlendiren bir parse testiyle yakalandı.

## [3.15.1] — 2026-07-02

### Düzeltilenler
- **`oc-stream-parse.mjs`: OpenCode'un üst-seviye `error` olayı tanı mesajını kaybediyordu.** OpenCode bir turn başarısız olduğunda (kötü model slug'ı, tool-use desteklemeyen endpoint, upstream 5xx) `{"type":"error","error":{"data":{"message":...}}}` yayınlıyor — payload olayın üst seviyesinde (`ev.error`), diğer tüm olay tiplerinin aksine `ev.part` altında değil. Parser yalnızca `part.message`'ı okuyordu, bu yüzden gerçek hatalar her zaman genel bir `"unknown error"` string'ine düşüyordu (`state:"error"` bayrağının kendisi doğru ayarlanıyordu — bu sahte-başarı değil, kaybolan-tanı bug'ıydı). Gerçek bir `OPENROUTER_API_KEY` ile iki farklı hata modunda canlı doğrulanıp düzeltildi. Ayrıca `--session <id> --continue`'un doğru şekilde *adlandırılmış* OpenCode session'ını resume ettiği (sadece "en sonuncusu" değil) ampirik olarak doğrulandı — 3.15.0'daki resume-semantiği TODO'su çözüldü, orada düzeltme gerekmedi.

### Değişenler
- `json_field` / `relocate_session_dir` / `surface_status_error`, `stream-utils.sh`'e çıkarıldı, artık `ag-stream` / `cx-stream` / `oc-stream` tarafından paylaşılıyor (davranış-korundu, ~30 tekrarlı satır kaldırıldı).
- `ds-stream-parse.mjs` artık satır-içi yeniden uygulama yerine paylaşılan `clip()` yardımcısını kullanıyor.

### Kaldırılanlar
- 5 yetim dashboard ekran görüntüsü (972KB, repoda hiçbir yerde referanslanmıyordu — README yalnızca GIF/MP4'leri gömüyor).

## [3.15.0] — 2026-07-02

### Eklenenler
- **Yeni backend: OpenCode (`oc-*`), OpenRouter üzerinden.** cli-dispatch'in 4. worker backend'i olarak OpenCode (npm `opencode-ai`, binary `opencode`) eklendi; OpenRouter üzerinden çalıştığı için kullanıcılar herhangi bir OpenRouter modelini (örn. `google/gemma-4-31b-it:free`) hedefleyebilir. Codex (`cx-*`) backend'inin ayak izinin tam karşılığı: `oc-agent` / `oc-stream` / `oc-worktree-run.sh` / `oc-stream-parse.mjs`, `oc-runner` babysitter subagent'ı ve `/cli-dispatch:oc-run`, `oc-status`, `oc-sessions`, `oc-balance` komutları — ayrıca her cross-backend aggregator (`setup`, `doctor`, `status`, `help`, `sessions`, `balance`, `resume`), dashboard worker-panel etiketi, `plugin.json` ve README güncellendi.
- **OpenCode'da gerçek sandbox yok.** Codex'in kernel tarafında zorlanan `--read-only`'sinin aksine, OpenCode'da OS-seviyesi veya tool-seviyesi write-deny yok; her zaman geçilen `--auto` bayrağı, headless kullanım için bir güvenlik opsiyonu değil işlevsel bir gereklilik olarak her izin isteğini otomatik onaylar — tek güvenlik sınırı git-worktree izolasyonudur (Antigravity backend'iyle aynı duruş).
- **OpenCode için setup akışında model seçici.** `/cli-dispatch:setup` artık `AskUserQuestion` ile kullanıcıya varsayılan bir OpenCode modeli seçtiriyor (2-3 seçilmiş ücretsiz-katman OpenRouter slug'ı + özel giriş seçeneği) ve bunu config'e `OC_MODEL` olarak yazıyor; `OPENROUTER_API_KEY`'in kendisi Claude tarafından asla yazılmaz — DeepSeek'in anahtarıyla aynı, kullanıcının kendi yapıştırdığı mekanizma (kurulumdan sonra anahtar hâlâ boşsa installer config'i otomatik olarak bir editörde açar).
- **Windows v1 için ertelendi.** OpenCode v1 için yalnızca Unix'tir (macOS/Linux/WSL); `install.ps1` ve varsa `.ps1` eşleri değiştirilmedi.

## [3.13.4] — 2026-06-28

### Düzeltilenler
- **cx-runner / ag-runner / ds-runner: delegasyon zorunluluğu — babysitter doğrudan dosya düzenleyemez.** Üç runner subagent'a, babysitter'ın Edit, Write, `cat >`, `sed -i` veya başka herhangi bir doğrudan dosya değişikliği yapmasını açıkça yasaklayan bir CRITICAL blok eklendi. Asıl kodlamayı işçi CLI (cx-agent / ag-agent / ds-agent) yapmalıdır; runner yalnızca çağırır, izler, doğrular ve raporlar.
- **cx-runner: hatalı `--version` kontrolü kaldırıldı.** `cx-agent`'ın `--version` bayrağı yok; çalıştırmak sıfırdan farklı çıkış kodu verip agent'ı yanıltıyordu. Ön koşul kontrolü artık yalnızca `command -v cx-agent`.

## [3.13.3] — 2026-06-28

### Değişenler
- **Dashboard: işçi "Görev / talimat" paneli artık kapalı başlar** (genişletmek için tıkla), Subagents/Worker-sessions panelleriyle aynı şekilde.

## [3.13.2] — 2026-06-28

### Değişenler
- **Dashboard: üstte sabitlenmiş görev/talimat paneli akışı gömmez, kayar.** Tam prompt'lar büyük olabilir (5k–25k+ karakter); "Görev / talimat" paneli artık ~38vh ile sınırlanır ve kayar, böylece akış erişilebilir kalır.

### Döküman
- **Güncelleme notu:** `/plugin update` yalnızca komutları/skill'leri yeniler — `~/.local/bin`'deki worker wrapper'larını **yeniden kurmaz**. Bir wrapper'ı değiştiren bir güncellemeden sonra (örn. 3.13.0'daki yeni `prompt.txt` alanı), bir kez `/cli-dispatch:setup` çalıştır. (README EN+TR.)

## [3.13.1] — 2026-06-28

### Döküman
- **README baştan yazıldı (EN + TR).** **Özellikler** bölümü güncel değildi (yalnızca DeepSeek) — üç backend'i, dashboard'u, native balance'ı (toplu + backend başına), `clean`/`clean-schedule`'u, Codex gerçek-OS sandbox'ını, `ds/ag/cx-runner` subagent'ları, Markdown render'ı ve stale-worker tespitini kapsayacak şekilde yeniden yazıldı. Ayrıca giriş, Kullanım girişi, Session takibi (`prompt.txt` satırı eklendi), Güvenlik/egress (sağlayıcı başına) ve Mimari rol bölümleri backend-bağımsız olacak şekilde tazelendi.

## [3.13.0] — 2026-06-28

### Eklenenler
- **Dashboard: işçinin görevi/talimatı sayfasının en üstüne sabitlendi.** Bir worker detay sayfası yalnızca akışı (en yeni üstte) gösteriyordu, bu yüzden orijinal talimat gömülü ya da ekran dışı kalıyordu. Şimdi akışın üstünde, her zaman ilk sırada (akış sırasından bağımsız) sabitlenmiş bir **"Görev / talimat"** paneli (Markdown render edilmiş) gösterir. `/api/worker/:id/flow` artık `prompt` (+ `model`/`cwd`/`startedAt`) döndürür.
- **Sabitlenen talimat TAM prompt'tur — kısaltma yok.** Daha önce yalnızca `meta.json`'daki 120 karakterlik `promptPreview` vardı. Stream wrapper'ları (`cx-stream`, `claude-ds-stream`, `ag-stream` + `.ps1` varyantları) artık tam prompt'u session dizinindeki `prompt.txt` dosyasına yazar; dashboard bunu tam olarak sunar, bu dosyaya sahip olmayan eski session'lar için 120 karakterlik önizlemeye düşer.

## [3.12.0] — 2026-06-28

### Eklenenler
- **Dashboard: akıştaki mesaj/prompt metinleri için Markdown render.** Worker'ların Markdown olarak ürettiği asistan mesajları ve prompt'lar artık başlıkları, **kalın**/*italik*, `satır içi kod`, çerçeveli kod bloklarını, listeleri ve bağlantıları — ham metin yerine — render eder. Tool satırları düz kalır. Render edici, küçük ve **XSS-güvenli** bir uygulamadır (bağımlılık yok, yalnızca stdlib): ÖNCE tüm girdiyi escape eder, sonra sabit bir beyaz liste dönüşüm kümesi uygular ve asla ham HTML geçirmez; bağlantı `href`'leri temizlenir (yalnızca `http(s)`/göreceli — `javascript:` vb. `#` olur). Doğrulandı: `<script>` escape edilir, `javascript:` bağlantıları etkisizleştirilir.

## [3.11.2] — 2026-06-28

### Değişenler
- **Dashboard: "Worker sessions (ds/ag/cx)" paneli de artık kapalı başlar.** Varsayılanı açıktı; Subagents paneli gibi artık varsayılanı kapalı.

## [3.11.1] — 2026-06-28

### Değişenler
- **Dashboard: aktif olmayan "Subagents" paneli artık kapalı başlar.** Session görünümündeki aktif olmayan subagent'lar panelinin varsayılanı açıktı; artık varsayılanı kapalı ("Active subagents" paneli açık kalır). Elle toggle canlı yenilemeler arasında korunur.

## [3.11.0] — 2026-06-28

### Eklenenler
- **`/cli-dispatch:clean-schedule` — stale worker dizinlerinin otomatik günlük temizliği.** **OS-düzeyinde** zamanlanmış bir iş (macOS'ta launchd, Linux/WSL'de cron, Windows'ta Scheduled Tasks) kaydeder; bu iş arka planda `cli-dispatch-clean --remove` çalıştırır — böylece `running` ama ölü stale dizinler Claude Code açık olmasa bile otomatik olarak budanır. Bulut agent'ı yok, token yok. Eylemler: `install` (varsayılan), `status`, `uninstall`; seçenekler `--time SS:DD` (varsayılan `03:00`) ve `--older-than GÜN`. `~/.cache/cli-dispatch/clean.log` dosyasına log yazar.
- **Paylaşımlı temizlik motoru + CLI.** `/cli-dispatch:clean` mantığı artık yeniden kullanılabilir bir `cli-dispatch-clean.mjs` motorudur, arkasında bir `cli-dispatch-clean` wrapper (bash + `.ps1`) bulunur, `~/.local/bin`'e kurulur (backend-bağımsız, dashboard gibi). Hem elle komut hem zamanlanmış iş bunu kullanır. Varsayılan DRY-RUN; `--remove` siler; gerçekten çalışan bir worker'a (son yazma yakın zamanda) asla dokunulmaz.

## [3.10.0] — 2026-06-28

### Eklenenler
- **`/cli-dispatch:clean` — stale worker session dizinlerini kaldır.** Sonlandırılmadan öldürülen bir worker (Ctrl-C, üst CLI çalışırken kapandı, çökme, watchdog kill'i veya hiç taşınmamış bir codex geçici `cx-<ts>-<pid>` dizini) `status.json`'u sonsuza kadar `state:"running"` takılı bırakır; bunlar `~/.cache/cli-dispatch/sessions` altında birikir ve `sessions`/dashboard'u kirletir. Komut bunları `status.json` mtime'ına göre bulur (`running` + `--stale-secs` kadar boşta, varsayılan 600 sn — dashboard'un 90 sn'sinden büyük, böylece canlı ama sessiz bir tur asla silinmez) ve `--remove` ile siler. **Varsayılan dry-run.** `--older-than GÜN` ayrıca GÜN'den eski tamamlanmış (`done`/`error`) session'ları da budar. Gerçekten çalışan bir worker'a (son yazma yakın zamanda) asla dokunulmaz. Bash + PowerShell.

## [3.9.1] — 2026-06-28

### Düzeltilenler
- **Dashboard: sonlandırılmadan önce kesilen bir worker artık sonsuza kadar yeşil "running" noktası göstermez.** Bir worker (codex/ds/ag) çalışırken öldürüldüğünde (Ctrl-C, CLI kapandı, çökme) `status.json`'u `state:"running"` takılı kalır — dashboard buna körü körüne güvenip yeşil/aktif gösteriyordu. `listWorkers()` artık `status.json` mtime'ından bir `stale` bayrağı türetir (`running` iken >90sn yazma yok ⇒ ölü); UI stale worker'ları boşta noktası + `stale` rozeti ile gösterir ve onlara SSE aboneliği başlatmaz. (Subagent'lar için zaten kullanılan aynı canlılık sezgisi; eşik cömerttir, böylece gerçekten çalışan ama sessiz bir tur yanlış işaretlenmez.)

## [3.9.0] — 2026-06-28

### Eklenenler
- **Native Windows'ta Codex.** Yeni `cx-stream.ps1` + `cx-agent.ps1` PowerShell wrapper'ları (bash `cx-stream`/`cx-agent`'ın aslına sadık portları: geçici→thread-id session-dizin taşıma, watchdog süre/boşta kalma limitleri, gerçek `-s read-only` sandbox, `-o` temiz-cevap yakalama, tur düzeyinde hata yayılımı). `install.ps1` artık `-Backends deepseek,codex|all` alır ve Codex backend'ini (+ `.cmd` shim'leri) kurar. Antigravity WSL'ye özel kalır (pseudo-TTY gerektirir). `codex`'in native çalıştığı ama wrapper'ının olmadığı Windows boşluğunu kapatır.
- **Toplu `/cli-dispatch:balance`.** Tek komut DeepSeek hesap bakiyesini + Antigravity model başına kotasını + Codex 5s/7g rate limitlerini yan yana gösterir — toplu `sessions`/`status`/`watch`'ın balance ikizi. Salt-okunur, üçüncü-parti araç yok; yapılandırılmamış/çevrimdışı backend'ler hata vermek yerine not basar.
- **Antigravity & Codex için worktree yardımcıları.** `ag-worktree-run.sh`, `cx-worktree-run.sh` (+ `cx-worktree-run.ps1`), `ds-worktree-run.sh`'ı yansıtır: `origin/main`'den bir worktree oluşturur, `node_modules`'e symlink atar, session-takipli stream worker'ı içinde çalıştırır, temizlik komutunu yazdırır. `ag-run`/`cx-run` skill'leri artık bunlara referans verir. (`ag-worktree-run.ps1` yok — Antigravity native Windows'ta desteklenmez.)

### Notlar
- Backend simetri denetimi: tüm backend-başına komutlar (`*-run`, `*-sessions`, `*-status`, `*-balance`) ve runner agent'lar ds/ag/cx için zaten mevcuttu; bu sürüm kalan script-düzeyi boşlukları (Windows Codex, worktree yardımcıları) kapatır ve toplu balance görünümünü ekler.

## [3.8.0] — 2026-06-28

### Eklenenler
- **Dashboard: bir Claude Code session/subagent'ından, spawn ettiği cli-dispatch worker'ına atla.** Bir işçiye delege eden runner subagent (ds/ag/cx-runner) işçinin session id'sini transcript'ine yazar; dashboard şimdi bilinen worker id'lerini tarar ve mavi bir **"Worker sessions (ds/ag/cx)"** paneli gösterir — bir worker'a tıkla, onun gerçek DeepSeek/Antigravity/Codex session akışını aç. `/api/session/:id/flow` ve `/api/subagent/:sid/:aid/flow` artık bir `linkedWorkers` dizisi içerir. (Id geçişine dayalı sezgisel eşleştirme; yanlış pozitif üst öğe takibi gerekmez.)

## [3.7.1] — 2026-06-28

### Düzeltilenler
- **Dashboard zamanları artık görüntüleyenin yerel saat diliminde gösterilir.** Zaman damgaları diskte UTC olarak saklanır; UI ham ISO string'ini kesiyordu (böylece GMT+3 kullanıcısı `01:50` yerine `22:50` görüyordu). Session/worker/subagent zamanları artık `Date.toLocaleString`/`toLocaleTimeString` ile formatlanır.

## [3.7.0] — 2026-06-28

### Eklenenler
- **Dashboard: sol panelde durum filtresi.** Claude Code session listesinin üstünde bir filtre çubuğu (all / busy / idle / closed, her biri canlı sayı ile); tıkla, yalnızca o durumu göster. Workers sekmesinde gizli.
- **Dashboard: subagent çipleri artık başlangıç zamanı gösterir** (SS:DD:SS), her subagent'ın yanında, aktif/Subagents panellerinde.

## [3.6.0] — 2026-06-28

### Değişenler
- **Dashboard artık polling yerine Server-Sent Events ile güncellenir.** Yeni bir `GET /api/stream?watch=<spec>` SSE endpoint'i, yalnızca ilgili dosya(ları)/dizin(leri) `fs.watch` ile izler ve debounce'lu bir `change` olayı gönderir; client yalnızca değişeni yeniden çeker. Spec'ler: `sessions` (liste — `~/.claude/sessions` + worker root'unun sığ watch'ı), `session:<id>` (transcript'i + subagents dizini, recursive), `subagent:<sid>:<aid>` (o transcript — aktif bir subagent'ın neredeyse anlık akışı), `worker:<id>` (dizini). Sabit ~3–4sn'lik `setInterval` polling'in yerini alır, böylece canlı görünümler alttaki dosya değişir değişmez güncellenir; heartbeat bağlantıyı canlı tutar; spec'ler temizlenir ve path-traversal kontrolünden geçer. Recursive watch, desteklemeyen platformlarda sığ watch'a düşer.

## [3.5.0] — 2026-06-28

### Eklenenler
- **Dashboard: aktif subagent'lar kendi canlı panelinde.** Transcript'i son ~45sn içinde yazılmış bir subagent **aktif** kabul edilir ve ayrı, yeşil vurgulu bir "Active subagents" panelinde, (daraltılabilir) tam "Subagents" listesinin üstünde gösterilir. Aktif bir subagent'a tıklamak, onun akışını bir **● live** rozeti ile açar ve otomatik yeniler (~3sn), böylece gerçek zamanlı olarak ne yaptığını izleyebilirsin. Aktif bayrağı, subagent transcript mtime'ından sunucu tarafında hesaplanır (`/api/session/:id/subagents` üzerinde `active`/`lastActivityMs`).

## [3.4.3] — 2026-06-28

### Değişenler
- **Dashboard: Subagents listesi artık daraltılabilir bir paneldir** (`▾ Subagents (N)`, macOS-Storage-tarzı disclosure, native `<details>` ile). Varsayılan açık; daraltılmış/genişletilmiş durum busy-session otomatik yenilemesinde korunur.

## [3.4.2] — 2026-06-28

### Düzeltilenler
- **Dashboard: `favicon.ico` 404'ünü sustur.** `/favicon.ico` → `204` route'u eklendi, böylece tarayıcı konsolu temiz kalır (bir Playwright QC geçişinden gelen tek bulgu; tüm paneller/akışlar/detaya-inme çalışır doğrulandı).

## [3.4.1] — 2026-06-28

### Değişenler
- **Dashboard akışı en yeni üstte gösterir.** Session / subagent / worker akışları artık ters kronolojik sırada render edilir (en son adım en üstte), böylece en güncel aktiviteyi görmek için en alta kaydırman gerekmez.

## [3.4.0] — 2026-06-28

### Eklenenler
- **`/cli-dispatch:dashboard` — local, salt-okunur bir web dashboard.** Tüm projelerdeki aktif Claude Code CLI session'larını listeler (**busy** olanlar üstte sabit); bir session'a tıkla → **akışını** gör (mesajlar / tool çağrıları / sonuçlar) → spawn ettiği **subagent'ları** gör → subagent'a tıkla → *onun* akışına in (spawn derinliğine göre iç içe). İkinci panel cli-dispatch **worker** delegasyonlarını (DeepSeek / Antigravity / Codex) durum + akışla gösterir. Busy hedefler otomatik yenilenir.
  - Yeni `dashboard-server.mjs` (yalnızca Node stdlib `http`/`fs` — npm bağımlılığı yok), başlatıcı `cli-dispatch-dashboard` (+ `.ps1`) ve `dashboard` komutu. `install.sh`/`install.ps1` bunları koşulsuz kurar (backend-bağımsız).
  - Yalnızca diskteki verileri okur: `~/.claude/projects/**` (transcript'ler: `uuid`/`parentUuid`, `tool_use`↔`tool_result`, `tool_use name:"Agent"`→`toolUseResult.agentId` subagent bağlantıları için), `~/.claude/sessions/*.json` (canlı busy/idle) ve `~/.cache/cli-dispatch/sessions/**` (worker'lar).
  - **Güvenlik:** yalnızca `127.0.0.1`'e bağlanır; kesinlikle salt-okunur; config/gizli veri erişimi yok; `:id` parametreleri temizlenir ve path-traversal reddedilir. Plugin'in başlattığı tek uzun-süreli süreç budur (yazdırılan `kill <pid>` ile durdur). Claude Code transcript formatı internal/sürüme özeldir — bilinmeyen yapılar savunmacı render edilir.

## [3.3.0] — 2026-06-27

### Eklenenler
- **`cx-balance` — native Codex kullanım / rate limit.** `/cli-dispatch:cx-balance`, 5s (birincil) ve haftalık 7g (ikincil) pencerelerini **kalan %** + sıfırlanma zamanı olarak raporlar — codex TUI'deki `/status` ile aynı sayılar. Codex'in script'lenebilir bir kullanım komutu yoktur, ancak backend'in rate-limit verisini kendi session kayıtlarına (`~/.codex/sessions/**/*.jsonl`) yazar; bu komut en güncel olanı okur. Ağ yok, token işleme yok, üçüncü-parti araç yok.
- **`ag-balance` — native Antigravity kotası.** `/cli-dispatch:ag-balance`, plan + **model başına kalan kota oranı** + sıfırlanma zamanını raporlar. Local Antigravity **language server**'ının Connect-RPC `GetUserStatus` endpoint'ini doğrudan çağırır — çalışan `language_server` process'ini, onun `--csrf_token`'ını ve dinlediği portu keşfederek — üçüncü-parti bir araca kabuk açmak yerine. Antigravity language server'ının çalışıyor olmasını gerektirir (IDE açık ya da bir `agy` session'ı); yoksa ipucu basar.
- Her ikisi de hiçbir harici bağımlılığa dayanmaz — her ikisi de CLI'ların zaten yerelde sunduğu resmi veriyi tersine mühendislikle okur.

## [3.2.0] — 2026-06-27

### Eklenenler
- **`ds-sessions` + `ds-status`** — DeepSeek backend'i artık Antigravity ve Codex'in zaten sahip olduğu backend-başına görünümlere sahip. `/cli-dispatch:ds-sessions`, `backend: deepseek` filtresiyle session'ları listeler; `/cli-dispatch:ds-status`, yalnızca DeepSeek kurulum/key/model sağlık kontrolüdür. 3.0.0'da oluşan bir asimetriyi düzeltir: `ds-sessions`/`ds-status`, `sessions`/`status` (tüm backend'leri kapsayan) olarak yeniden adlandırıldığında DeepSeek, `ag-*`/`cx-*`'in koruduğu filtrelenmiş görünümü kaybetmişti. (Ayrıca Türkçe README komut tablosunda eksik olan backend-başına satırları da ekler.)

## [3.1.0] — 2026-06-27

### Değişenler
- **Paylaşımlı altyapı `claude-ds` adından `cli-dispatch` adına taşındı.** Config, session cache ve parser dizini — üç backend arasında paylaşılanların tümü — artık DeepSeek wrapper'ının değil, hub'ın kendi adı altında yaşar:
  - `~/.config/claude-ds/config` → `~/.config/cli-dispatch/config`
  - `~/.cache/claude-ds/sessions` → `~/.cache/cli-dispatch/sessions`
  - `~/.local/share/claude-ds/` → `~/.local/share/cli-dispatch/`
  - env: `CLI_DISPATCH_CONFIG` / `CLI_DISPATCH_SESSIONS_DIR` / `CLI_DISPATCH_EDITOR` (eski `CLAUDE_DS_*` adları hâlâ geçerlidir).
  - **Worker binary adları değişmez** (`claude-ds`, `claude-ds-stream`, `ds-agent` kalır — bunlar DeepSeek backend'inin CLI'ını adlandırır).
- **Sıfır-kırılımlı geçiş.** `install.sh` / `install.ps1`, bir sonraki çalıştırmada mevcut eski config + session dizinini yeni yollara otomatik taşır. Bağımsız olarak, her wrapper/komut çalışma zamanında yenisi yoksa eski `claude-ds` yoluna **fallback** yapar, böylece mevcut kurulumlar setup tekrar çalıştırılmasa bile çalışmaya devam eder.

## [3.0.2] — 2026-06-27

### Değişenler
- **Yeni demo GIF** (`assets/demo.gif`) üç-backend hub'ı yansıtır: her işçiye gerçek bir salt-okunur delegasyon (DeepSeek → Antigravity → Codex) ve ardından `backend` kolonlu birleşik `sessions` görünümü. README alt metni güncellendi. Yalnızca asset.

## [3.0.1] — 2026-06-27

### Değişenler
- **`ds-delegate` skill'i Codex backend'ini belgeliyor.** Skill açıklaması + gövdesi artık üçüncü worker'ı (Codex / `cx-agent` / `cx-stream`) DeepSeek ve Antigravity ile birlikte kapsar: yeni bir "Codex (OpenAI) backend" bölümü (gerçek OS-düzeyi salt-okunur sandbox, model seçimi, auth, `cx-runner`), güncellenmiş Rol/Komut listeleri ve yeni tetikleyici ifadeler (`delegate to codex`, `codex/openai ile yap`). Yalnızca döküman; davranış değişikliği yok.

### Notlar
- agy ve Codex backend'leri için native bir kullanım/kota komutu araştırıldı (`ds-balance`'ın `ag-balance`/`cx-balance` benzeri). Hiçbir CLI script'lenebilir bir bakiye/kullanım komutu sunmaz — yalnızca TUI içi slash komutları (agy'de `/usage`, codex'te `/status`) ve web dashboard'ları. Böyle bir komut eklenmedi (üçüncü-parti bir araç gerekirdi, bu kapsam dışı).

## [3.0.0] — 2026-06-27

### Değişenler
- **KIRICI — cross-backend komutlar `ds-` ön ekini düşürdü.** Hiçbir zaman DeepSeek'e özel olmayan komutlar yeniden adlandırıldı: `/cli-dispatch:ds-setup` → `/cli-dispatch:setup`, `ds-sessions` → `sessions`, `ds-status` → `status`, `ds-watch` → `watch`. Takma ad tutulmadı — script'leri/dökümanları/kas hafızasını güncelle. Gerçekten DeepSeek'e özel komutlar ön ekini korur: `/cli-dispatch:ds-run`, `/cli-dispatch:ds-balance` (ve backend-başına `ag-run`/`cx-run`).

### Eklenenler
- **Backend-başına `status` + `sessions` görünümleri.** `/cli-dispatch:ag-status` / `cx-status` (backend-kapsamlı kurulum/auth/model sağlığı) ve `/cli-dispatch:ag-sessions` / `cx-sessions` (`backend: antigravity` / `codex` filtresiyle session listesi). Ön eksiz `/cli-dispatch:status` ve `/cli-dispatch:sessions` hâlâ tüm backend'leri aynı anda kapsar.
- **Setup wizard'da Codex seçeneği.** `/cli-dispatch:setup` artık `codex`'i tespit eder, Codex'i bir backend seçeneği olarak sunar ve auth'unu (`codex login` / `CODEX_API_KEY`) + smoke test'i belgeler. (`install.sh` zaten `--backends codex`'i destekliyordu; wizard henüz yakalamamıştı.)
- Codex model dökümanları güncel `gpt-5.x` serisine yenilendi (`gpt-5.5` varsayılan, `gpt-5.4`, subagent'lar için `gpt-5.4-mini`, `gpt-5.3-codex-spark`); eski `o4-mini` örneği düşürüldü. Script'ler hâlâ `--model`'i olduğu gibi iletir (sabit kodlu model yok).

## [2.2.0] — 2026-06-27

### Eklenenler
- **Codex (OpenAI Codex CLI) worker backend'i.** cli-dispatch artık üç-backend hub'dır: DeepSeek ve Antigravity'nin yanı sıra **OpenAI'nin Codex CLI**'ına (`codex`, ≥ 0.142.3) delege edebilirsin. Yeni wrapper'lar `cx-agent` (tek-atış, subagent-tarzı) ve `cx-stream` (session-takipli), artı `cx-stream-parse.mjs` parser'ı, bir `/cli-dispatch:cx-run <görev>` komutu ve bir `cx-runner` subagent.
  - `cx-stream`, `codex exec --json` stdout'unu `cx-stream-parse.mjs` üzerinden borular (pseudo-TTY veya dosya-tail gerekmez — codex'in native JSONL akışı vardır). Diğer backend'lerle **aynı session-dizin düzenini** yazar (`status.json`/`meta.json`/`progress.log`/`transcript.jsonl`), codex'in thread-id'si ile anahtarlanır, böylece `/cli-dispatch:ds-sessions` ve `/cli-dispatch:ds-watch` üç backend'i de kapsar.
  - **Gerçek OS-düzeyi salt-okunur sandbox:** `cx-agent --read-only`, codex'e `-s read-only` geçirir, macOS Seatbelt / Linux bwrap+seccomp'u aktive eder — tüm dosya yazmalarında kernel-zorunlu sert bir engel (DeepSeek gibi bir tool-katman kısıtlaması değil, Antigravity gibi yok da değil). Saf analiz görevleri worktree izolasyonu olmadan `--read-only` geçebilir ve gerçek bir yazma-yok garantisi alır.
  - Sandbox, normal agentic işler için varsayılan olarak `workspace-write` modundadır; çağrı başına `cx-agent --read-only` veya `cx-agent --sandbox <mod>` ile değiştir.
  - Resume, stderr'e yazdırılan thread-id ile: `cx-agent --resume <thread-id> --cwd <dizin> "<devam>"`. Resume'da her zaman `--cwd`'i tekrar geç (codex workspace'i thread'den yeniden yükler ancak dizini açıkça ister).
  - **Auth:** `codex login` (ChatGPT/OAuth — kişisel kullanım için key gerekmez) veya `CODEX_API_KEY` (`OPENAI_API_KEY`'e göre önceliklidir). Varsayılan model için config değişkeni: `CX_MODEL` (fallback `CODEX_MODEL`); boş = codex'in kendi varsayılanı (sürüme göre değişir, burada sabit kodlu değil).
  - **`cx-runner` subagent** (`agents/cx-runner.md`): babysitter-model agent (zorluğa göre haiku/sonnet), tam bir cx-agent delegasyonunu bir alt-bağlamda yönetir — modu seçer, kod görevleri için git worktree'de izole eder, doğrular (build/test) ve kısa bir sonuç döndürür.
- **Backend seçimi genişletildi.** `install.sh --backends` artık `codex` anahtar kelimesini kabul eder; `all`, `deepseek,antigravity,codex` olarak genişler. Config iskeleti, `CODEX_API_KEY`, `CX_MODEL` ve sandbox seçeneklerini belgeleyen bir Codex bölümü kazanır.

## [2.1.0] — 2026-06-26

### Eklenenler
- **Antigravity (Gemini) worker backend'i.** cli-dispatch artık gerçekten çok-backend'dir: DeepSeek'in yanı sıra Google'ın **Antigravity CLI**'ına (`agy`) delege edebilirsin. Yeni wrapper'lar `ag-agent` (tek-atış, subagent-tarzı) ve `ag-stream` (session-takipli), artı `ag-transcript-parse.mjs` parser'ı ve bir `/cli-dispatch:ag-run <görev>` komutu.
  - agy'nin `--output-format json`'u yoktur ve TTY olmayan sessiz-düşme hatası vardır, bu yüzden `ag-stream` onu bir **pseudo-TTY** (`script`) altında çalıştırır ve canlı ilerleme + nihai cevap için **agy'nin diskteki JSONL transcript'ini** (`transcript_full.jsonl`) tail'ler — stdout parse etmek yerine.
  - DeepSeek backend'iyle **aynı session-dizin düzenini** yazar (`status.json`/`meta.json`/`progress.log`), agy'nin conversation-id'si ile anahtarlanır, böylece `/cli-dispatch:ds-sessions` ve `/cli-dispatch:ds-watch` her iki backend için de çalışır (session'lar artık bir `backend` kolonu gösterir). `ag-agent --resume <conv-id>` ile resume. Süre/boşta-kalma timeout watchdog'unu ve worktree izolasyonunu yeniden kullanır.
  - `--cwd`'i agy'nin aktif workspace'i (`--add-dir`) olarak kaydeder, böylece dosyalar agy'nin scratch dizinine değil hedef dizine iner. Salt-okunur mod yok: agy'nin tool-düzeyinde yazma-engeli yoktur (`--sandbox` terminali kısıtlar, dosya yazmalarını değil — test edildi), bu yüzden `--read-only` reddedilir; yazma-yok garantisi için tek-kullanımlık/worktree bir `--cwd`'de izole et ve diff'i incele.
  - **Auth:** Google ile giriş (bir kez `agy` çalıştır) veya `GEMINI_API_KEY` / `ANTIGRAVITY_API_KEY`.
  - **Model seçimi:** `--model "<ad>"` (veya `AG_MODEL` config varsayılanı) agy'ye geçirilir, agy birden çok aileyi proxy'ler — `Gemini 3.5 Flash`, `Gemini 3.1 Pro`, `Claude Sonnet 4.6`, `Claude Opus 4.6` ve `GPT-OSS 120B`'ye yönlendirme doğrulandı (her biri reasoning kademeleriyle; kesin görünen adlar `agy models`'ten; varsayılan `Gemini 3.5 Flash (High)`). ag-stream, bir `--model` değeri `agy models`'te yoksa uyarır (agy aksi halde sessizce kendi varsayılanına düşer).
- **Kurulumda backend seçimi.** `/cli-dispatch:ds-setup` artık hangi backend(ler)in kurulacağını sorar (DeepSeek, Antigravity veya her ikisi); `install.sh`, `--backends deepseek,antigravity|all` kazandı. Config iskeleti isteğe bağlı bir Gemini bölümü tutar; mevcut config'ler asla ezilmez.

### Notlar
- Native Windows yalnızca DeepSeek backend'ini kurar — Antigravity backend'i bir pseudo-TTY (`script`) gerektirir, bunun için WSL kullan.
- **Timeout semantiği DeepSeek backend'inden farklıdır.** agy ayrık worker süreçleri spawn eder ve bir pty altında çalışır, bu yüzden harici bir süreç-ağacı kill'i güvenilir bir durdurma değildir (doğrulandı: tüm izlenen ağaçta SIGKILL agy'yi çalışır bıraktı). Bu nedenle `--max-runtime`, agy'nin kendi `--print-timeout`'u (model-başına bekleme sınırı, bu yüzden toplam duvar süresi bunu aşabilir) ile uygulanır, watchdog yalnızca son çare olarak; `--idle-timeout` son çaredir. Sınırlanmış bir çalışma `done` (kısmi) veya `error` raporlayabilir. Katı bir duvar-saati sınırı için çağrıyı `timeout(1)` ile sarmala ve bir worktree'de izole et.
- Antigravity backend'inde **`--read-only` yok** (agy'nin tool-düzeyinde yazma-engeli yoktur; `--sandbox` dosya yazmalarını engellemez). Watchdog kill yolu, snapshot-tabanlı bir killer ile sertleştirildi (sinyal vermeden önce alt ağacı yakalar), çünkü agy SIGTERM'ü yok sayar ve init'e reparent olur; keşif-başarısızlık yolu ise başlangıçta asılı kalan bir agy'yi sonsuza kadar beklemek yerine öldürür.

## [2.0.0] — 2026-06-23

### Değişenler (KIRICI)
- **Plugin ve marketplace `claude-ds` → `cli-dispatch` olarak yeniden adlandırıldı**, onu çok-backend bir delegasyon hub'ı olarak konumlandırdı (bir görev uygun işçi CLI'a gönderilir). DeepSeek destekli Claude Code artık "DeepSeek backend"idir; gelecekteki işçi CLI'lar (örn. Antigravity `agy`) ek backend olarak eklenebilir.
- **Komutlar artık `ds-` ön ekli** ve yeni namespace altındadır (`ds-`, DeepSeek backend'ini işaret eder): `/claude-ds:setup` → `/cli-dispatch:ds-setup`, aynı şekilde `ds-run`, `ds-sessions`, `ds-watch`, `ds-status`, `ds-balance`. Şemsiye delegasyon skill'i `claude-ds` artık `ds-delegate`. `ds-runner` subagent adını korur (şimdi `cli-dispatch:` altında).
- Repo referansları `rbinar/cli-dispatch` olarak güncellendi; kurulum artık `/plugin marketplace add rbinar/cli-dispatch` sonra `/plugin install cli-dispatch@cli-dispatch`.

### Değişmeyenler
- Backend wrapper binary'leri adlarını (`claude-ds`, `claude-ds-stream`, `ds-agent`) ve kurulum yollarını korur: config `~/.config/claude-ds/config`, parser `~/.local/share/claude-ds/`, session'lar `~/.cache/claude-ds/` ve `CLAUDE_DS_*` env değişkenleri. Bunlar backend'e özeldir (DeepSeek backend'inin adı `claude-ds`'tir), bu yüzden yeni backend'ler eklendiğinde değişmezler.

## [1.7.2] — 2026-06-22

### Düzeltilenler
- **Windows / Türkçe locale:** PowerShell wrapper'ları config'i büyük/küçük harf duyarsız `-match` ile parse ediyordu, `tr-TR` locale'inde `I`, noktasız `ı`'ya katlanır — bu yüzden `DEEPSEEK_API_KEY` içindeki `I` o satırın hiç eşleşmemesine ve key'in sessizce düşmesine neden oluyordu (geçerli bir key olmasına rağmen `DEEPSEEK_API_KEY not set`). `claude-ds.ps1` ve `claude-ds-stream.ps1`'deki config parser büyük/küçük harf duyarlı `-cmatch`'e geçirildi ve `install.ps1`'deki boş-key kontrolü sertleştirildi.

## [1.7.1] — 2026-06-21

### Değişenler
- `TERMINAL.md`, skill ve `run`/`setup` komutlarından harici-servis / "yalnızca kullanıcı açıkça istediğinde" uyarıları kaldırıldı, böylece claude-ds delegasyonu artık caydırılmaz.

## [1.7.0] — 2026-06-19

### Eklenenler
- **`ds-runner` subagent** (`agents/ds-runner.md`). Bir DeepSeek delegasyonunu bir alt-bağlama
  devreder: modu seçer, işi izole eder, **doğrular** ve kısa bir sonuç döndürür —
  orkestratörün bağlamını temiz tutar. İşçiyi `ds-*` CLI'ları
  (`ds-agent` / `ds-worktree-run.sh`) üzerinden **Bash** ile çalıştırır, böylece işçi her zaman
  DeepSeek'tir, agent'ın kendi (babysitter) modeli ise **orkestratör tarafından çağrı başına**
  seçilir: `model="haiku"` saf üretim/analiz için (frontmatter varsayılanı), `model="sonnet"`
  gerçek build/test doğrulaması veya diff incelemesi gerektiren repo/kod görevleri için.
  - Saf üretim/analiz → `ds-agent --read-only`, cevabı döndür (doğrulama yok).
  - Repo/kod görevi → git worktree'de izole et, bağımsız kontrolleri çalıştır (typecheck/build/test),
    sonuç + diff konumunu döndür; commit/merge orkestratöre/insana kalır.

## [1.6.0] — 2026-06-19

### Eklenenler
- **`ds-agent` — tek-komut, subagent-tarzı wrapper.** Bir görev ver, senkron olarak tamamlanana
  kadar çalışsın, tool aktivitesini **stderr**'e akıtsın ve **yalnızca nihai cevabı stdout**'a
  yazsın (yakalamak/pipe'lamak güvenli). Varsayılan agentic (`--cwd` içinde yazabilir/çalıştırabilir);
  `--read-only` yalnızca analiz için. `--cwd` / `--resume` / `--max-runtime` /
  `--idle-timeout` iletir; görevi pozisyonel arg, `-p` veya stdin'den okur; `-q` banner'ı susturur.
  `~/.local/bin/ds-agent`'e kurulur (+ Windows'ta `.ps1`/`.cmd`).
- Parser: opsiyonel `CLAUDE_DS_PROGRESS_STDERR=1` her ilerleme satırını stderr'e yansıtır
  (`ds-agent` tarafından canlı aktivite için kullanılır), stdout'a dokunmadan veya varsayılan
  davranışı değiştirmeden.

## [1.5.3] — 2026-06-19

### Performans
- Tool-yoğun session'lar: `progress.log` artık tek bir tutulan dosya tanımlayıcı kullanır
  (transcript gibi) ve `status.json` yazmaları ~200ms'ye throttled edilir (poll edilen bir
  anlık görüntüdür; `finalize` nihai yazmayı zorlar). 5000-tool'luk bir akış gerçek 0.63sn /
  sys 0.50sn'den gerçek 0.07sn / sys 0.02sn'ye indi (~9× duvar, ~25× syscall). Nihai durum ve
  `toolCounts` değişmedi, boşta kalma tespiti etkilenmedi (`transcript.jsonl`'e göre çalışır).

## [1.5.2] — 2026-06-19

### Performans
- Parser artık transcript'i her satırda dosyayı yeniden açmak (`appendFileSync`) yerine tek bir
  tutulan dosya tanımlayıcı üzerinden yazar. 50k satırlık bir akışta duvar süresini ~7×
  (1.08sn → 0.16sn) ve syscall süresini ~15× azalttı. Doğruluk değişmedi — chunk-sınırı
  yeniden birleştirme, bölünmüş çok baytlı (UTF-8) karakterler ve resume-append hepsi aynı
  doğrulandı, boşta-kalma timeout watchdog'u hâlâ çalışıyor (her yazmada mtime güncellenir).

## [1.5.1] — 2026-06-19

### Eklenenler
- **PowerShell timeout uygulaması.** Windows wrapper artık `--max-runtime` / `--idle-timeout`'u
  gerçekten uygular (önceden tanıyor ama yok sayıyordu). Bir arka plan işi watchdog'u, işçiyi
  süreç komut satırındaki benzersiz `--session-id` + `stream-json` çağrısıyla bulur, geçen
  süreyi ve `transcript.jsonl` aktivitesini izler ve ihlalde işçiyi **ve alt ağacını**
  `taskkill /PID <pid> /T /F` ile öldürür (bash'teki `kill_tree`'nın Windows eşdeğeri),
  ardından session'ı `error` ile sonlandırır.

> Not: PowerShell yolu yalnızca inceleme ile doğrulandı — geliştirme makinesinde `pwsh`/Windows
> yoktu. Bash, çalışma zamanında test edilen yol olarak kalır.

## [1.5.0] — 2026-06-19

### Eklenenler
- **Süre / boşta kalma timeout'ları** `claude-ds-stream` için: `--max-runtime <sn>` ve
  `--idle-timeout <sn>` (env fallback'leri `CLAUDE_DS_MAX_RUNTIME` / `CLAUDE_DS_IDLE_TIMEOUT`;
  her ikisi de varsayılan `0` = kapalı). Bir arka plan watchdog'u, toplam süre sınırını aşan
  veya yeni çıktı üretmeden duran (boşta kalma `transcript.jsonl` aktivitesinden ölçülür)
  asılı/kaçak bir işçiyi öldürür. Zaman aşımına uğrayan session'lar `state: error` ve
  `error: "timeout: …"` ile işaretlenir.
- Watchdog, işçiyi **ve alt süreçlerini** (`kill_tree`, `pgrep` ile) öldürür,
  octo-ai'nin `kill(-pid)`'ini yansıtır. Yalnızca üst süreci öldürmek, bir alt sürecin
  (bir Bash tool alt süreci, bir MCP sunucusu) stdout pipe'ını açık tutmasına ve wrapper'ı
  asmasına neden olabilir.

### Değişenler
- İşçi artık PID'i yakalanmış olarak arka planda çalışır (prompt süreç ikamesi ile beslenir),
  böylece watchdog onu hedefleyebilir; alt kabuk hâlâ çalışma dizinine `cd` yapar ve işçinin
  gerçek çıkış koduyla çıkar.

### Düzeltilenler
- Tam sayı olmayan timeout değerleri `0`'a (kapalı) zorlanır, böylece guard `set -e` altında çökemez.

## [1.4.0] — 2026-06-19

### Eklenenler
- **`--read-only` modu.** İşçiyi `--tools Read,Grep,Glob` ile salt-okunur bir tool setine
  kısıtlar (KISITLAYICI — yerleşik tool setini değiştirir, bu yüzden Write/Edit/Bash
  `bypassPermissions` altında bile kullanılamaz).

### Güvenlik
- **Varsayılan `--strict-mcp-config`.** Delege edilen işçi artık kullanıcının global
  `~/.claude` MCP sunucularını miras almaz. Önceden bir çalışma `playwright`
  (`browser_run_code_unsafe` = keyfi kod çalıştırma), `whatsapp`, `gmail`, `jira` vb.
  sürebilirdi. Bilinçli olarak MCP sunucusu eklemek için `--mcp-config <dosya>` geç
  (strict buna uyar).

### Düzeltilenler
- **cwd izolasyonu:** `--cwd` artık işçinin çalışma dizinini gerçekten ayarlar (alt kabuk `cd`),
  octo-ai'nin `spawn({ cwd })`'ini yansıtır. Önceden dosyalar wrapper'ın cwd'sine (repo kökü)
  iniyordu, bu da worktree izolasyonunu etkisiz kılıyordu.
- **Argüman parse:** argv'nin sonundaki değer tüketen bayraklar (`--cwd` / `--resume` / `-p`)
  artık şifreli bir `set -u` "unbound variable" hatasıyla çökmez; anlaşılır bir hata gösterilir.
- **Hata durumu:** bir worker çökmesi / sıfırdan farklı çıkış / hatalı cwd artık yanıltıcı bir
  `done` yerine `state: error` (çıkış koduyla) olarak raporlanır.
- **Çıkış kodu:** `printf`'in değil işçinin çıkışı (`PIPESTATUS[1]`) yakalanır.
- **Resume:** başarılı bir resume sonrası `meta.json`'daki eski `error` alanı temizlenir.

### Değişenler
- Dökümanlar (SKILL.md / README / run.md) varsayılan modun **bir sandbox olmadığını** açıklar
  (`bypassPermissions` her zaman açıktır → işçi dosya yazabilir / bash çalıştırabilir); repo
  görevleri için worktree izolasyonu, garantili yazma-yok için `--read-only` kullan.

## [1.3.0] — 2026-06-19

### Eklenenler
- **`claude-ds-stream` — stream-json session takibi.** Wrapper'ın session-takipli bir varyantı,
  Claude Code CLI'ı `--output-format stream-json` ile çalıştırır ve JSONL çıktısını session
  başına bir dizine (`~/.cache/claude-ds/sessions/<id>/`) parse eder:
  - `status.json` — kompakt döner özet (maliyet-odaklı izleme için poll edilen tek dosya)
  - `progress.log` — kısa insan-okur akış (tool çağrıları + kısaltılmış metin)
  - `transcript.jsonl` — ham stream-json (resume/audit)
  - `meta.json` — prompt önizlemesi, cwd, branch, model, başlangıç/bitiş
- **Resume:** aynı DeepSeek session'ına `claude-ds-stream --resume <id> -p "…"` ile devam et.
- **Komutlar:** `/claude-ds:sessions` (session'ları listele) ve `/claude-ds:watch <id>` (kompakt canlı durum).
- Bash ve PowerShell wrapper'ları tarafından paylaşılan cross-platform Node parser (`ds-stream-parse.mjs`).

### Değişenler
- Tüm plugin dökümanları, komutları ve script yorumları **İngilizce**'ye çevrildi (`README.md`
  istek üzerine Türkçe kalır).

## [1.2.0] — 2026-06-18

### Eklenenler
- **`/claude-ds:balance`** — DeepSeek hesap bakiyesini sorgula ve göster.
- Setup artık API key boşken config'i platformun varsayılan editöründe otomatik açar.

### Değişenler
- Kurulum dökümanları netleştirildi: slash komutlarını Claude Code CLI içinde, teker teker,
  açık bir `/reload-plugins` adımıyla çalıştır. README'ye kaldırma kılavuzu eklendi.

## [1.1.0] — 2026-06-18

### Eklenenler
- **Windows desteği.** Wrapper, installer ve worktree yardımcısının PowerShell varyantları
  (`claude-ds.ps1`, `install.ps1`, `ds-worktree-run.ps1`), artı bir `.cmd` shim, böylece
  `claude-ds` cmd/PowerShell'den çağrılabilir. Worktree yardımcısı `node_modules` için symlink
  yerine **junction** (`New-Item -ItemType Junction`; admin/developer-mode gerektirmez) kullanır.

## [1.0.0] — 2026-06-18

### Eklenenler
- İlk sürüm. Claude Code CLI'ı DeepSeek'in Anthropic-uyumlu API'sine karşı çalıştıran taşınabilir
  bir `claude-ds` wrapper'ı, böylece görevler DeepSeek'e bir işçi olarak delege edilebilir
  (yerleşik Agent/subagent tool'u DeepSeek'i hedefleyemez).
- Skill + komutlar: `/claude-ds:setup`, `/claude-ds:run`, `/claude-ds:status`.
- Agentic görevleri izole bir git worktree'de çalıştıran, diff'i inceleme için commit'siz
  bırakan `ds-worktree-run.sh` yardımcısı.
