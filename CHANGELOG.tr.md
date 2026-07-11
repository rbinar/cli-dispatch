# Değişiklik Günlüğü

**cli-dispatch** (eski adıyla **claude-ds**) için tüm kayda değer değişiklikler burada belgelenmiştir.

Format [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)'u temel alır,
ve bu proje [Semantic Versioning](https://semver.org/spec/v2.0.0.html) kurallarına uyar.

> Not: `README.md` bilinçli olarak Türkçe'dir; bu değişiklik günlüğü ve diğer tüm dökümanlar İngilizce'dir.

## [3.40.0] — 2026-07-11

### Kaldırıldı

- **`/cli-dispatch:gain --log` history logging'i.** `--log` flag'i (ve eşdeğeri
  `GAIN_LOG` env değişkeni), her raporun zaman damgalı bir JSON snapshot'ını
  `~/.cache/cli-dispatch/gain-history.jsonl`'a ekliyordu; böylece
  `/cli-dispatch:clean` eski session dizinlerini sildikten sonra bile
  çalıştırmalar zaman içinde karşılaştırılabiliyordu. Bu history mekanizması —
  flag, env değişkeni ve `gain-report.mjs`'teki `gain-history.jsonl` writer'ı —
  kaldırıldı; `commands/gain.md` artık bunu belgelemiyor. Anlık
  `/cli-dispatch:gain` raporunun kendisi (backend bazlı worker token toplamları
  + Anthropic babysitting muhasebesi) değişmedi; tanınmayan bir `--log`
  argümanı artık crash olmak yerine sessizce yok sayılıyor — script'in mevcut
  esnek arg işleme davranışıyla tutarlı.

## [3.39.4] — 2026-07-11

### Düzeltildi

- **Heartbeat artık reap edilmiş bir takeover oturumunu diriltemiyor (AU7).**
  `parse-utils.mjs`'in `touchTakeoverHeartbeat`'i (`dashboard-server.mjs`'in PTY
  köprüsü tarafından 30 sn'de bir çağrılır), in-memory kopyasında bir `takeover`
  alt-objesi olduğu sürece status.json'u geri yazıyordu — bu yüzden
  `cli-dispatch-clean`, heartbeat'in okuma ile yazması arasında stale bir
  takeover'ı reap ederse (PTY'yi öldürüp oturumu `error`'a geçirirse), heartbeat
  ölü oturumu tekrar `human-controlled`'a yazabiliyordu. Guard artık yazmadan
  hemen önce yeniden kontrol ediliyor: taze okunan state hâlâ `human-controlled`
  ve `takeover.active === true` değilse heartbeat yazmayı tamamen atlıyor (tek
  satır stderr notu, kilit yok — human-takeover SDD'sinin kilitsiz duruşu gereği
  milisaniye-altı TOCTOU penceresi kalıyor, ama yaygın stale-oku-sonra-yaz
  diriltme yolu kapandı). `takeover-integration.test.mjs`'e eklenen yeni
  reap-sonrası-heartbeat no-op senaryosuyla test edildi.
- **`Find-WorkerPid` çoklu-eşleşme guard'ı (`claude-ds-stream.ps1`).**
  Interrupt/exit yolundaki worker lookup'ı, `Kill-WorkerTree`'yi guard'sız bir
  WMI `Win32_Process` command-line substring eşleşmesinin ilk sonucuyla
  besliyordu — birden fazla eşleşen süreç varken yanlış ağacı öldürebilirdi.
  Artık 3.39.2'de watchdog'lara uygulanan AU5 kalıbının aynısını uyguluyor:
  eşleşmeler array'e toplanıyor, birden fazla eşleşmede kill stderr uyarısıyla
  atlanıyor (tek eşleşme ve sıfır eşleşme davranışı değişmedi). `cx-stream.ps1`
  eşdeğeri için denetlendi: tek `Win32_Process` lookup'ı (watchdog job) zaten
  AU5 guard'lı ve ayrı bir `Find-WorkerPid` yok — değişiklik gerekmedi.

### Değiştirildi

- **`parse-utils.mjs`'te atomic tam-dosya JSON yazımı (temp + rename).**
  `createStatusWriter.flush`, `writeMetaFile` ve internal `writeJsonFile`
  (takeover state helper'larının kullandığı) daha önce doğrudan `writeFileSync`
  ile yazıyordu; status.json/meta.json'u poll eden okuyucular yarım yazılmış
  dosya görebiliyordu (guard'lı okuyucular crash olmuyordu ama stale/boş veri
  görüyordu). Üçü de artık internal bir `atomicWriteFileSync`'ten geçiyor: aynı
  dizine `<hedef>.tmp-<pid>` temp dosyası yazılıyor, sonra `renameSync` ile
  hedefin üstüne taşınıyor. Rename başarısız olursa (özellikle Windows'ta hedef
  açıkken EPERM/EACCES — DeepSeek/Codex parser'ları Windows'ta native çalışıyor)
  önceki doğrudan yazıma düşülüyor ve mevcut stderr uyarı yolu korunuyor; temp
  dosyalar her yolda best-effort siliniyor. `createStatusWriter`'ın ~200ms
  throttle semantiği ve dönüş şekli değişmedi.

## [3.39.3] — 2026-07-11

### Değiştirildi

- **Ölü export temizliği (AU8, davranışı koruyan refactor).** `parse-utils.mjs`'in
  `writeJsonFile`'ı, `verdict-writer.mjs`'in `readJson`'ı, `check-version-sync.mjs`'in
  `defaultVersionSyncPaths`/`runVersionSyncCli`'ı ve `takeover-cmd.mjs`'in
  `loadConfigDefaults`'ı export ediliyordu ama repo genelinde (statik veya dinamik) hiçbir
  importer'ları yoktu — kaldırmadan önce yeniden doğrulandı. Her biri artık private,
  dosya-içi bir fonksiyon; davranış değişmedi. `parse-utils.mjs`'in `isNonTerminalState()`
  fonksiyonu da export ediliyor ve referanssız ama bilinçli olarak korundu — `CLAUDE.md`'de
  session-state public API sözleşmesinin parçası olarak belgeli.
- **`.ps1` version-staleness kontrolü tekilleştirildi (AU9).** `cli-dispatch-dashboard.ps1`,
  `ds-agent.ps1` ve `cx-agent.ps1` her biri kurulu-vs-cache'lenmiş plugin versiyonu
  kontrolünün kendi ~40 satırlık kopyasını taşıyordu (yukarıdaki 3.39.2 kaydı bu
  duplikasyonun o zaman kabul edildiğini not düşer). Yeni paylaşılan bir `version-check.ps1`
  modülüne çıkarıldı — mevcut `version-check.sh`'in `.ps1` karşılığı — üç dosya da artık
  onu kendi yanından dot-source ediyor; `install.ps1` onu tüketicileriyle birlikte
  `~/.local/bin`'e kopyalıyor. Semantik değişmedi, katı `^\d+\.\d+\.\d+$` versiyon-klasörü
  eşleşmesi dahil (bash'in daha gevşek glob'una bilinçli olarak hizalanmadı — bu bir
  davranış değişikliği olurdu, kapsam dışı).

## [3.39.2] — 2026-07-11

### Düzeltildi

- **`version-check.sh` hiç kurulmuyordu (AU3).** Beş agent wrapper'ının tamamı
  (`ds-agent`, `cx-agent`, `cp-agent`, `ag-agent`, `oc-agent`) çalışma zamanında
  `version-check.sh`'i source ediyor ama hiçbir installer onu kopyalamıyordu — bu yüzden
  stale-version uyarısı kurulu her sistemde ölü özellikti. `install.sh` artık onu
  wrapper'larla birlikte kuruyor (hedef, wrapper'ların gerçek source path'iyle
  doğrulandı). `install.ps1` değişiklik gerektirmiyor: `.ps1` agent'ları kontrolü inline
  duplike ediyor.
- **`cli-dispatch-run.ps1` hata yollarında temp dosya sızdırıyordu (AU4).** `stderrFile`,
  `launchMarker` ve `verifyResultsPath` sadece mutlu yolda temizleniyordu. Ana akış artık
  `$script:TempFiles` kaydı olan bir `try/finally` ile sarılı — bash ikizinin
  `trap cleanup_tmp EXIT INT TERM` kalıbının PS1 karşılığı — böylece erken `exit` ve
  Ctrl-C dahil her çıkış yolunda temp dosyalar siliniyor.
- **Windows watchdog yanlış process'i öldürebiliyordu (AU5, minimal guard).**
  `claude-ds-stream.ps1` ve `cx-stream.ps1` worker PID'ini WMI `Win32_Process`
  komut-satırı substring eşleşmesiyle buluyor; eşzamanlı benzer session'larda birden
  fazla process eşleşebiliyor. Eşleşme sayısı tam 1 değilse kill artık stderr uyarısıyla
  atlanıyor; tek-eşleşme davranışı değişmedi.
- **`parse-utils.mjs` yazma hatalarını sessizce yutuyordu (AU6).**
  `createStatusWriter.flush`, `writeMetaFile` ve `writeJsonFile` catch blokları
  `/* ignore */` idi — disk dolu ya da izin hatasında `status.json` iz bırakmadan
  sonsuza dek `running`'de kalıyordu. Her biri artık stderr'e tek satır uyarı yazıyor
  (~200ms'lik `flush` yolunda spam'i önlemek için writer başına bir kez). Yazma
  davranışının kendisi değişmedi.
- **`cli-dispatch-run` (bash) `--prompt-file` eksik-dosya kontrolü (AU13).** PS1 ikizi
  `--prompt-file` varlığını parse anında doğruluyordu; bash geç ve belirsiz hata
  veriyordu. Bash artık PS1 kontrolünü aynalıyor: argüman parse'ından hemen sonra
  stderr'e net `prompt file not found` mesajı ve `exit 1`.

## [3.39.1] — 2026-07-11

### Düzeltildi

- **Session dizini kaybolduğunda `cli-dispatch-wait.ps1` sonsuz döngüsü (AU1).**
  Terminal-durum kontrolü sabit `@('done','error','killed')` allowlist'i kullanıyordu; bu
  yüzden eksik/okunamayan `status.json` (state `$null` olur) non-terminal sayılıyordu.
  Varsayılan `-Timeout 0` ile timeout dalı hiç çalışmadığından poll döngüsü sonsuza dek
  dönüyor ve onu çağıran Windows run pipeline'ını (`cli-dispatch-run.ps1`) asıyordu. Döngü
  artık bash ikizinin polaritesini aynalıyor: `running`/`human-controlled` dışındaki her
  durumda break, ve boş/okunamayan durumda sessizce normal saymak yerine stderr'e uyarı
  yazıyor.
- **Worktree önceden silinmişse `cli-dispatch-run` (bash) çökmesi (AU2).**
  `verdict-diff.patch`'i üreten `git -C "$WORKTREE_PATH" status/diff` çağrıları
  `set -euo pipefail` altında korumasızdı; worktree kaldırılmışsa (ör. `--cleanup-if-clean`
  ardından `--resume`) git 128 ile çıkıyor ve script `verdict.json` yazılmadan ölüyordu. Git
  çağrıları artık `[ -d "$WORKTREE_PATH" ]` guard'ıyla korunuyor ve worktree yoksa boş diff'e
  düşüyor — PS1 ikiziyle eşleşiyor — böylece `verdict.json` yine yazılıyor.

## [3.39.0] — 2026-07-11

### Eklendi

- **Windows parite epic'i (#106) — üç dalganın tamamı.** `.ps1` ikizleri bash referans
  implementasyonlarıyla pariteye getirildi (native Windows backend'leri: ds + cx):
  - `claude-ds-stream.ps1` / `cx-stream.ps1`: worker exit code'u artık parser pipeline'ından
    geçiyor (rc-dosyası deseni — bash `PIPESTATUS[0]` karşılığı); `--verify-cmd` bayrağı;
    session dizinine `worker.pid`; kesinti/hata reconciliation'ı (çökme ya da Ctrl-C artık
    `state:"done"`/`"running"` bırakmıyor); diff artefaktları (`diff.patch` +
    `changed-files.json`); bash ile birebir öncelikli model env override'ları
    (`DS_MODEL`/`CX_MODEL`/`CODEX_MODEL`); cx ağ anahtarı (`--network`/`--no-network` +
    `CX_NETWORK`); ds read-only koşularına MCP izolasyonu + koşu-sonu bütünlük guard'ı.
  - `ds-agent.ps1`: `--effort` bayrağı + script-bitişiği stream fallback'i; `cx-agent.ps1`:
    ağ bayrakları + fallback; `claude-ds.ps1`: env-var model override'ları.
  - `ds/cx-worktree-run.ps1`: worker hataları yayılıyor (her hatayı exit 0'a çeviren boş
    `catch {}` gitti); cleanup talimatları try/finally ile her zaman basılıyor.
  - `install.ps1`: `pty-host.mjs`, `takeover-cmd.mjs` ve vendor xterm asset'lerini kuruyor
    (dashboard terminal/takeover paritesi; native Windows'ta takeover hâlâ test edilmedi);
    eski `CLAUDE_DS_EDITOR`'ın yanında `CLI_DISPATCH_EDITOR`'ı tanıyor.
  - `cli-dispatch-wait.ps1`: timeout mesajı gerçek geçen saniyeyi raporluyor;
    `cli-dispatch-clean.ps1`/`cli-dispatch-gain.ps1`: minimal PATH'te düşmeden önce Windows
    node yoklaması (NVM_SYMLINK, Volta, Program Files, scoop).
  - 13 `.ps1` dosyasının tamamı gerçek PowerShell parser'ıyla doğrulandı
    (`Language.Parser::ParseFile`) — parser, statik incelemenin kaçırdığı iki gerçek syntax
    hatası yakaladı (`"$Label:"` scope-parse tuzağı, parantez içinde statement).

### Düzeltildi

- **Worktree post-check yanlış pozitifi.** `ds-worktree-run.sh` (ve yeni `.ps1` portu) ANA
  repo herhangi bir sebeple kirliyse koşuyu FAIL ediyordu — önceden var olan untracked
  dosyalar (başıboş bir `CLAUDE.md`) üretimde gayet iyi koşuları düşürdü. Kontrol artık
  worker başlamadan `git status` anlık görüntüsü alıyor ve yalnız YENİ girdilerde düşüyor;
  sızıntı patch'i yalnız gerçek sızıntıda yazılıyor (boş `leaked-changes-*.patch` çöpü bitti).

## [3.38.0] — 2026-07-11

### Düzeltildi

- **cli-dispatch-run: session-id keşfi 5 backend'in 4'ünde ölüydü (#105).** Backend başına
  marker'lar (`cx session:` vb.) stream wrapper'ların gerçekte bastığı hiçbir satırla
  eşleşmiyordu ve `set -e` altında eşleşmeyen grep, en-yeni-dizin fallback'i hiç çalışamadan
  script'i **sessizce** öldürüyordu — her cx/ag/oc/cp çalışması sıfır teşhisle exit 1
  verirken worker'ın biten işi worktree'de strand kalıyordu. Marker'lar artık gerçek
  başlangıç satırlarıyla eşleşiyor (cx `thread:`, ag `conv:`, oc/cp `session:` — hepsi
  relocation-sonrası final id taşır) ve açık `|| true` guard'ı var; aynı fix `.ps1` ikizinde.
- **verdict-writer: backend adı sözleşme uyuşmazlığı (#105).** `meta.backend`'i kısa adlara
  (`ds|ag|cx|oc|cp`) karşı doğruluyordu ama her parser uzun ad yazar (`codex`,
  `antigravity`, …) — yani `build-verdict` her gerçek session'ı reddediyordu. Uzun adlar
  artık alias haritasıyla normalize ediliyor, `status.backend` fallback'i var; ds parser
  artık eksik `backend` alanını hem `status.json` hem `meta.json`'a yazıyor.
- **cli-dispatch-run sıkılaştırma (#105).** stderr yakalama process substitution'dan pipe'a
  geçti (`PIPESTATUS[0]`) — marker grep'i asla yarım flush edilmiş dosya okuyamaz;
  `--resume` artık `--prompt`'u sessizce yoksaymak yerine yüksek sesle reddediyor
  (re-attach eder, konuşmaz — `/cli-dispatch:resume` kullanın); başarısız `build-verdict`
  boş dosya yerine geçerli `{"error": …}` JSON verdict yazıyor; wait alt süreci çözülen
  node binary'sini `CLI_DISPATCH_NODE` ile devralıyor.
- **cli-dispatch-wait: çıplak `node` + sessiz boş-state (#105).** Artık `CLI_DISPATCH_NODE`'u
  tanıyor, yaygın sürüm-yöneticisi konumlarını yokluyor (cli-dispatch-clean ile aynı desen —
  launchd/cron minimal PATH ile çalışır) ve status.json okunamadığında bunu normal terminal
  state gibi ele almak yerine teşhis basıyor.
- **clean: hiç finalize olmamış session'lar sonsuza dek tutuluyordu (#105).** Worker'ı
  status.json hiç yazılmadan ölen dizin (state `?`) artık kendi mtime'ı üzerinden stale
  adayı, `(no status.json)` işaretiyle. Eski-bitmiş budama artık paylaşılan
  `TERMINAL_STATES` enum'unu kullanıyor (`killed` da kapsandı). Yeni regresyon testi.
- **stream-utils: `reconcile_session_error` hataları artık görünmez değil.** Yutulan
  status/meta yazma hataları (ve eksik `node`) stderr'e uyarı basıyor — oradaki sessiz
  hata status.json'ı sonsuza dek `running`'de bırakır.
- **`/cli-dispatch:run` özet sıkılaştırma.** `verdict.json` parse hataları ve error-verdict
  yakalanmamış Node stack trace yerine tek satırlık fallback basıyor; `$ARGUMENTS` satırının
  NEDEN eval'e sarılmaması gerektiği yorumla belgelendi (metinsel yerleştirme quoting'i
  zaten korur — stub-binary düzeneğiyle doğrulandı).

### Doğrulandı

- **5-backend E2E smoke matrisi artık yeşil:** backend başına bir `cli-dispatch-run`
  (ds/ag/cx/oc/cp), gerçek görev + `--verify` → 5/5 exit 0, doğru verdict.json (normalize
  backend, `verify.exitCode: 0`, tutulan iş için `stranded: true`). Test süiti: 97/97.
  Windows `.ps1` parite açıkları ayrıca #106 epic'i olarak izleniyor.

## [3.37.0] — 2026-07-11

### Eklendi

- **`/cli-dispatch:run` slash komutu (#102).** Deterministik runner `cli-dispatch-run`'ı
  orkestratör için tek satırlık kullanıma sarar:
  `/cli-dispatch:run <backend> "<prompt>" [--verify '<cmd>'] [--cleanup-if-clean] [bayraklar]`.
  Çalışma bitince `/cli-dispatch:wait` ile tutarlı kompakt bir verdict özeti basar (exit
  code, session id, state, verify sonucu, diffstat, `verdict-diff.patch` yolu); binary
  yoksa `/cli-dispatch:setup` yönlendirmesiyle zarifçe geri düşer. Beş runner def'i
  (`*-runner.md`) artık makine-doğrulanabilir verify'lı salt mekanik delegasyonlarda
  babysitter'a deterministik runner'ı önermesini söylüyor.
- **clean: verdict yaşam döngüsü (#101, SDD TL8).** `cli-dispatch-clean.mjs` (ve
  `commands/clean.md` içindeki inline bash/PowerShell kopyaları) artık deterministik
  runner'ın artefaktlarını tanıyor: dry-run, boş olmayan `verdict-diff.patch` taşıyan silme
  adaylarını işaretliyor (`⚠ has verdict patch` + özet ipucu) ve yeni `--preserve-verdicts`
  bayrağı (PowerShell: `-PreserveVerdicts`) silmeden önce `verdict.json`/`verdict-diff.patch`
  dosyalarını `<sessions-root>/verdict-archive/<id>.{json,patch}` altına arşivliyor.
  `verdict-archive` dizininin kendisi asla taranmaz/silinmez. Yeni
  `cli-dispatch-clean.test.mjs` süiti (5 test) ile kapsandı.

### Düzeltildi

- **install.sh/install.ps1 `*-worktree-run.sh` dosyalarını kurmuyordu (#103).**
  `cli-dispatch-run` backend worktree runner'larını `~/.local/bin`'de kendi yanında arar,
  ama installer'lar bunları hiç kopyalamıyordu — her backend `backend runner not found` ile
  başarısız oluyordu (ds yalnızca eski bir elle kopya sayesinde çalışıyordu). `install.sh`
  artık beşini de kuruyor; `install.ps1` ds/cx çiftini gönderiyor (bash-üzerinden çalışan
  Windows yolu için `.sh` + parite için `.ps1` ikizleri).
- **cli-dispatch-run verdict aşamasında `ERR_INPUT_TYPE_NOT_ALLOWED` ile çöküyordu (#104).**
  `node --input-type=module <dosya>` geçersizdir (bayrak yalnız `-e`/stdin ile kullanılır);
  hem `cli-dispatch-run` hem `cli-dispatch-run.ps1` bunu dosya-tabanlı `verdict-writer.mjs`
  çağrılarında kullanıyordu — `--verify`'lı her çalışma worker bittikten sonra çöküyor,
  `verdict.json` yazılmıyor, cleanup çalışmıyor, iş worktree'de strand kalıyordu. Bayrak
  kaldırıldı (`.mjs` uzantısı zaten module modunu seçer).

## [3.36.0] — 2026-07-11

### Eklendi

- **ds-agent: kirli checkout'lar için ön-uçuş anlık görüntüsü (#94).** Agentic bir
  çalıştırma uncommitted değişiklikleri olan bir git checkout'unu hedeflediğinde,
  `ds-agent` (ve `.ps1` ikizi) önce TÜM durumu — tracked + untracked — geçici index
  üzerinden dangling commit olarak yakalıyor (`git read-tree` + `add -A` +
  `commit-tree`; working tree'ye sıfır etki) ve kurtarma SHA'sını basıyor. Sonradan
  `git restore`/`git clean` çalıştıran bir worker artık işi geri dönülmez biçimde yok
  edemiyor: `git restore --source=<sha> -- <path>` her şeyi geri getiriyor.

### Değiştirildi

- **Runner tanımları ×5: task'ın mod seçimi mutlak (#98).** Task prompt'u "no worktree" /
  "in-place" diyorsa runner doğrudan `*-agent --cwd <repo>` çalıştırmak zorunda;
  `*-worktree-run.sh`'a asla düşemez. Worktree kurulum hataları artık hızlı başarısız
  oluyor (en fazla bir yeniden deneme) — üretilmiş branch adları üzerinde döngü yok.
- **Runner tanımları ×5: doğrulamada haydut-worker tespiti (#94).** Task izinli dosya
  listesi veriyorsa babysitter `git status --short` çıktısını o listeyle karşılaştırmak
  zorunda — liste dışı değişiklikler, özellikle hiç anılmamış dosyaların silinmesi/geri
  alınması, worker'ın kendi kontrolleri geçse bile `verified ✓` değil FAILED raporlanır.

### Düzeltildi

- **Gain: kullanım-körü backend'ler için isimli oran uyarısı (#97).** Session'ları hiç
  usage raporlamayan backend'ler (antigravity — agy hiçbir veri sunmuyor)
  babysitter/worker oranını şişiriyor: babysitting'leri paya girerken paydaya sıfır
  katkı yapıyorlar. Rapor artık bunları session sayısıyla adlandırıyor ve gerçek oranın
  gösterilenden düşük olduğunu belirtiyor.

## [3.35.0] — 2026-07-11

### Eklendi

- **`/cli-dispatch:wait` slash komutu.** `cli-dispatch-wait` binary'si üzerine ince
  sarmalayıcı: session terminal duruma ulaşana dek tek blocking çağrı, ardından kompakt
  özet — tekrarlı `/cli-dispatch:watch` polling'i yerine bunu kullanın. 2026-07-09
  tarihli bayat bir worktree'de uncommitted strand edilmiş hâlde bulundu (#93 hata
  kalıbı, worktree temizliği sırasında keşfedildi); exit-code dokümantasyonu gerçek
  sözleşmeye (`0` done, `1` error/killed, `2` timeout) düzeltilerek alındı.

## [3.34.0] — 2026-07-11

### Eklendi

- **Deterministik runner: `cli-dispatch-run` — sıfır LLM maliyetiyle delegasyon
  babysitting.** Yeni bağımsız CLI (bash + `.ps1` ikizi), delegasyonun mekanik kısmını
  LLM babysitter olmadan uçtan uca yürütüyor: backend worktree çalıştırması başlat
  (`--backend ds|ag|cx|oc|cp`), `cli-dispatch-wait` ile blokla (`human-controlled`
  devralmayı algılayıp geri çekilen sınırlı döngü), doğrulamadan ÖNCE koşulsuz
  `<session-dir>/verdict-diff.patch` yaz, `--verify` komutlarını Node `child_process`
  ile çalıştır (macOS'ta `timeout(1)` yok) ve 0–5 exit-code sözleşmeli
  (`0 tamam+doğrulandı, 1 verify başarısız, 2 worker hata/killed, 3 zaman aşımı,
  4 insan devralması, 5 kurulum hatası`) `<session-dir>/verdict.json`
  (`schemaVersion: 1`) üret — orkestratör runner subagent turn'leri (ölçülen: 60+ turn,
  ~2.5M cache-read token/babysitter) yerine tek küçük JSON okuyor. Saf çekirdek
  `scripts/verdict-writer.mjs`'te (birim testli); PowerShell ikizi ds/cx destekli
  (diğer backend'ler Unix-only). `install.sh` / `install.ps1` kuruyor. Tasarım:
  `.specs/dev/sdd/deterministic-runner.md` rev.1, issue
  [#100](https://github.com/rbinar/cli-dispatch/issues/100). Muhakeme gerektiren
  delegasyonlar için LLM `*-runner` subagent'ları duruyor.
- **`cli-dispatch-run --cleanup-if-clean`** — iki-sinyal AND koşuluna bağlı (verdict
  exit code 0 VE boş `git status --short`) opt-in worktree silme; issue #93
  regresyonunu içeren entegrasyon test paketiyle: uncommitted iş taşıyan worktree asla
  silinmiyor ve diff'i her zaman session dizininde yaşıyor.

## [3.33.0] — 2026-07-11

### Değiştirildi

- **Runner tanımları: `cli-dispatch-wait` artık beş runner'da da zorunlu bekleme
  primitifi.** 2026-07-11 ölçümü: tanımlar blocking wait'i yalnızca öneri olarak sunduğu
  için runner'lar `sleep && cat status.json` döngüsü kurmaya devam etti — runner başına
  60+ Anthropic turn ve ~2.5M cache-read token (issue #88, taze veri yorumlarda). Beş
  tanım da artık `cli-dispatch-wait <session-id>`'yi terminal durumu beklemenin TEK onaylı
  yolu ilan ediyor; sınırlı uzun-uykulu poll döngüsü yalnız binary kurulu değilse fallback.

### Eklendi

- **Bağımsız `cli-dispatch-gain` CLI.** Token muhasebesi script'i `/cli-dispatch:gain`
  komut gövdesinden `scripts/gain-report.mjs`'e taşındı; `cli-dispatch-gain` /
  `cli-dispatch-gain.ps1` sarmalayıcıları (cron/launchd için savunmacı node çözümleme,
  `cli-dispatch-clean` deseni) `install.sh` / `install.ps1` ile kuruluyor — haftalık
  `cli-dispatch-gain --log` anlık görüntüleri Claude olmadan OS zamanlayıcısından
  çalışabiliyor. Komut kurulu binary'yi tercih ediyor, plugin-kökü script'e düşüyor.
- **Gain: runner başına turn metriği.** Babysitting bölümü runner başına ortalama
  babysitter turn sayısını raporluyor ve 20 turn'u aşan runner'ları uyarıyor (polling
  imzası); iki değer de trend takibi için `--log` anlık görüntüsüne yazılıyor.

### Düzeltildi

- **Gain: Codex "input offloaded" ~13x şişikti.** Codex CLI'ın `turn.completed` usage'ı
  cache-DAHİL `input_tokens` raporluyor (`cached_input_tokens` bunun alt kümesi, ölçülen
  %65–95); gain ham alanı fresh input olarak topluyordu — 132 session için 204.6M
  raporlanırken gerçek fresh input ~15.6M'di. `usage()` artık varsa
  `cached_input_tokens`'ı düşüyor. ([#99](https://github.com/rbinar/cli-dispatch/issues/99))

## [3.32.0] — 2026-07-11

### Değiştirildi

- **Dashboard: yerleşim revizyonu — Configuration header'a, backend kullanım istatistikleri
  Workers genel görünümüne taşındı.** Gösterecek listesi olmayan Configuration rail tab'ı
  artık header'da bir `⚙` düğmesi; aynı config editörünü main pane'de açıyor. Rail iki
  tab'a indi ve adları **Sessions** / **Workers** oldu (satır sarma bitti). Backend başına
  token toplamı rail'den çıktı: Workers tab'ının boş durumu artık kart grid'i olarak genel
  görünüm çiziyor (backend başına bir kart — in/out token + "N sessions no data" notu);
  boş main pane alanı iş görüyor, liste kolonu daralmıyor. Boş durumlar çıplak `←` oku
  yerine yönlendirme metni gösteriyor.

### Eklendi

- **Dashboard: sürüklenebilir rail genişliği + responsive kırılım.** Liste kolonu bir
  sürükleme tutamacıyla 260–400px arası yeniden boyutlandırılabiliyor, `localStorage`'da
  kalıcı; ~1100px altında yan panel kapanıyor ve rail daralıyor — yarım ekran laptop
  genişliğinde kullanılabilir kalıyor.

### Düzeltildi

- **Dashboard: iki rail render hatası.** (1) Rail genişliği geri yükleme script'i kayıt
  yokken `Number(null)` → `0` çalıştırıp her yeni ziyaretçinin rail'ini 320px varsayılan
  yerine 260px minimuma sabitliyordu. (2) `loadList()`'te bayatlık koruması yoktu; önceki
  tab'ın yavaş fetch'i geç dönüp yeni seçilen tab'ın listesinin üzerine yazabiliyordu;
  artık bir nesil sayacı bayat yanıtları çöpe atıyor.

## [3.31.0] — 2026-07-11

### Değiştirildi

- **Dashboard: Vercel/Geist görsel yeniden tasarımı + koyu/açık tema anahtarı.** Web
  arayüzü Dracula paletini bırakıp Vercel tarzı tasarım token'larına geçti — koyu
  (`#0a0a0a` zemin, `#52a9ff` vurgu) ve açık (`#fafafa`/beyaz, `#0070f3` vurgu) temalar
  `html[data-theme]` üzerinde çift CSS değişken seti olarak tanımlı. Header'daki ☀/☾
  düğmesi temayı değiştirip `localStorage`'a kaydediyor; ilk boyama `prefers-color-scheme`
  tercihini izliyor (inline head script sayesinde parlama yok). Tipografi arayüz için
  sistem sans yığınına geçti, veri/log için monospace korundu; panel/chip'ler 1px
  `var(--bd)` kenarlık ve 6–8px köşe yarıçapı aldı. Önceden sabit kodlanmış tüm renkler
  değişkene çevrildi, iki tema da doğru render ediyor. Saf görsel yenileme — davranış,
  API veya DOM yapısı değişmedi.

## [3.30.10] — 2026-07-10

### Değiştirildi

- **Runner tanımları: beş `*-runner` description'ından "nadir durumlar için sonnet ayır"
  kaçış kapısı kaldırıldı.** 509 runner agent üzerinde yapılan ölçümde, "her zaman haiku"
  kuralına rağmen yalnızca %18'i gerçekten haiku'da çalışmıştı — sonnet/opus override'ları
  sıfır kalite kazancıyla ~%65 saf babysitting maliyeti ekliyordu (orkestratör diff'i ve
  testleri zaten yeniden doğruluyor). Description'lar artık model override geçmeyi açıkça
  yasaklıyor; frontmatter `model: haiku` sabit kalıyor.
  ([#95](https://github.com/rbinar/cli-dispatch/issues/95))

### Eklendi

- **cp-stream-parse: gerçek bir GitHub Copilot `assistant.message` fixture'ıyla regresyon
  testi.** [#96](https://github.com/rbinar/cli-dispatch/issues/96) araştırması, parser'ın
  `outputTokens`'ı 3.29.0'dan beri zaten doğru yakaladığını gösterdi — `usage: null` kalan
  session'ların tamamı o fix'ten önceydi. Bir production transcript satırı artık
  `output_tokens`'ın `status.json`'a yazıldığını assert eden test fixture'ı; yakalama yolu
  bir daha sessizce gerileyemez. (Copilot CLI input-token verisi hiç yaymıyor — upstream
  kısıt, kod içinde belgeli.)

## [3.30.9] — 2026-07-10

### Değiştirildi

- **`/cli-dispatch:setup`'ın dağıtılabilir "delegation priority" kalıcı-talimat bloğu
  artık bir resume-vs-yeni-delegation kuralı içeriyor.** Delege edilmiş bir worker'ın
  çıktısı düzeltme gerektirdiğinde (edit persist olmadı, yanlış kapsam, küçük bir
  düzeltme), blok artık orkestratöre aynı iş için yeni bir `*-runner`/`*-agent`
  delegasyonu başlatmak yerine `/cli-dispatch:resume <session-id>` ile devam etmesini
  söylüyor — yeni bir delegasyon, tek bir devam eden konuşma olması gereken şey için tam
  babysitting maliyetini tekrar ödüyor. Ayrıca `/cli-dispatch:gain`'in retry-cluster
  tespitini (#91) izlenmesi gereken sinyal olarak işaret ediyor. Daha önce bu rehberlik
  sadece bir kullanıcının özel global `CLAUDE.md`'sinde yaşıyordu, yani plugin'i
  taze kurup setup-zamanı hatırlatmayı seçen hiç kimseye ulaşmıyordu.

## [3.30.8] — 2026-07-10

### Düzeltildi

- **`/cli-dispatch:clean-schedule`'ın zamanlanmış otomatik temizliği,
  `node`'u sistem PATH'inde olmayan herkes için (nvm, Homebrew, volta, asdf)
  her çalıştırmada sessizce başarısız oluyordu** — launchd/cron, job'ları
  minimal bir PATH ile çalıştırır (shell rc dosyası kaynaklanmaz), bu yüzden
  `cli-dispatch-clean` `'node' not found in PATH` hatasıyla anında çıkıyor,
  bu sadece `clean.log`'a yazılıyor ve başka hiçbir yerde görünmüyordu —
  stale worker session dizinleri görünür bir hata olmadan sınırsız birikmeye
  devam ediyordu. `cli-dispatch-clean` artık pes etmeden önce yaygın node
  kurulum konumlarını (fnm, volta, asdf, Homebrew, en yüksek kurulu nvm
  sürümü) yokluyor — zaten zamanlanmış her job, yeniden kurulum gerekmeden
  bir sonraki çalışmasında düzeliyor. `clean-schedule`'ın launchd kurulum
  yolu da artık yeni kurulumlar için çözümlenmiş node dizinini job'ın kendi
  `EnvironmentVariables.PATH`'ine gömüyor.

## [3.30.7] — 2026-07-09

### Eklendi

- **`/cli-dispatch:gain` artık trivial delegasyonlar arasında "muhtemelen
  yeni-delegasyon-olarak-retry" kümelerini işaretliyor** (#91). Trivial
  session'lar (diffstat 1-49 satır) `(cwd, backend)`'e göre gruplanıyor,
  `startedAt`'e göre sıralanıyor ve ardışık başlangıç zamanları arasındaki
  fark 15 dakikadan azsa aynı kümeye zincirleniyor. Boyutu ≥2 olan kümeler
  — mevcut "trivial delegations (diff < 50 lines): N" satırının hemen
  ardından — şu satırı basıyor: `<cwd> (<backend>): <sessionId1>,
  <sessionId2>, ...  (N sessions, <first time> → <last time>)`. Bu, aynı
  görevin `/cli-dispatch:resume` ile devam ettirilmek yerine (her biri
  tam babysitting maliyetini tekrar ödeyen) birden fazla yepyeni
  delegasyon olarak retry edildiği durumları gün yüzüne çıkarıyor. `--log`
  anlık görüntüleri de eşleşen bir `trivialClusters` dizi alanı kazanıyor
  (küme başına `{cwd, backend, sessionIds, count, firstStartedAt,
  lastStartedAt}`) — böylece zaman içinde bu örüntünün artıp azalmadığı
  takip edilebiliyor. Tamamen eklemeli bir değişiklik — `trivialCount` ve
  diğer tüm gain çıktısı değişmedi.

## [3.30.6] — 2026-07-09

### Düzeltildi

- **`ag-runner`'ın mode-B (worktree ile izole edilmiş) doğrulaması,
  tamamlanmış işi sessizce kaybedebiliyordu** (#90). agy worker'ı timeout
  olduğunda veya çalışma sırasında nonzero exit verdiğinde, runner yine de
  temiz görünen bir nihai rapor yazabiliyordu (ör. "MOSTLY COMPLETE ✓,
  tests passing") — oysa dosya değişiklikleri sadece geçici worktree'de
  vardı ve hiçbir zaman hedef repo'ya merge edilmemişti. Gerçek bir olayda,
  build/test'i geçen bir `/var/folders` worktree'si sessizce kayboldu, çünkü
  hiçbir şey onu otomatik olarak geri taşımıyordu ve worktree reboot/
  cleanup'ta siliniyordu. Zorunlu mode-B doğrulama protokolüne **Rule 3**
  eklendi: bir worktree çalıştırması temiz bitmediğinde, runner commit
  edilmemiş worktree değişikliklerini kontrol etmeli, bunları ya hedef
  repo'ya kurtarmalı ya da temizlikten önce kalıcı bir `git diff` patch'i
  (mümkünse `/tmp`/`/var/folders` yerine hedef repo içinde bir yolda)
  dökmeli, ve herhangi bir build/test sonucunu hangi ağaca karşı çalıştığını
  belirterek rapor etmeli. `Return format` bölümündeki status satırına,
  `verified ✓`/`FAILED`'dan ayrı, tam olarak bu durum için üçüncü bir değer
  eklendi: `INCOMPLETE — STRANDED`.

## [3.30.5] — 2026-07-09

### Düzeltildi

- **DeepSeek (claude-ds) ve Codex worker session'ları sert kill/timeout/
  çökme durumunda token kullanımını kalıcı olarak kaybedebiliyordu** (#89).
  `status.json.usage` yalnızca son stream event'inde yazılıyordu (DeepSeek
  için `result`; Codex için pratikte genelde tur-başı `turn.completed` ile
  ulaşılıyor). Süreç bu event'ten önce ölürse, token'ların çoğu veya tamamı
  zaten harcanmış olsa bile `usage` sonsuza dek `null` kalıyordu.
  `ds-stream-parse.mjs` artık her `assistant` stream event'inden
  (`message.id`'ye göre dedupe edilmiş, `dashboard-utils.mjs`'nin
  `sumUsageFromEvents()` fonksiyonuyla aynı toplama mantığı) kademeli
  olarak kullanım biriktiriyor ve event'ler geldikçe `status.json`'a
  yazıyor; `cx-stream-parse.mjs`'nin mevcut tur-başı `turn.completed`
  kullanım yazımı da artık aynı işareti taşıyor. İkisi de kaydedilen
  kullanım henüz nihai toplam olmadığı sürece yeni bir
  `status.usagePartial: true` bayrağı taşıyor, gerçek nihai kullanım
  geldiğinde temizleniyor — böylece `/cli-dispatch:gain` (veya başka bir
  şey) gerçek bir nihai toplamı, öldürülmüş bir session'dan kalan
  en-iyi-çaba anlık görüntüsünden ayırt edebiliyor.

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
