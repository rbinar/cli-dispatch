# Değişiklik Günlüğü

**cli-dispatch** (eski adıyla **claude-ds**) için tüm kayda değer değişiklikler burada belgelenmiştir.

Format [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)'u temel alır,
ve bu proje [Semantic Versioning](https://semver.org/spec/v2.0.0.html) kurallarına uyar.

> Not: `README.md` bilinçli olarak Türkçe'dir; bu değişiklik günlüğü ve diğer tüm dökümanlar İngilizce'dir.

## [4.16.0] — 2026-08-05

### Düzeltildi

- **Statusline'ın bayatlık sınırı testi sıfır marjlı bir yarıştı ve tam suite yükünde aralıklı
  olarak düşüyordu.** `session at exactly 90s is counted (≤ stale threshold)` testi, `status.json`
  mtime'ı tam `şimdi - 90` olan bir fixture yazıp script'i başlatıyordu; script ise `şimdi - mtime`
  farkını kendi duvar saatiyle hesaplayıp `-le 90` ile karşılaştırıyor. Yazma ile başlatma
  arasında gerçek bir saniye geçmesi 90'ı 91 yapıp assertion'ı çeviriyordu. Doğrudan ölçüldü:
  0 sn gecikmeyle script 90 görüyor (sayılıyor), 2 sn gecikmeyle 92 görüyor (sayılmıyor).
  3 tam suite koşusunda 1 düşüş olarak yeniden üretildi; düzeltmeden sonra 5 koşuda 0.
  `cli-dispatch-statusline.sh` artık `now` değerini set edilmişse `CLI_DISPATCH_NOW`'dan
  okuyor, yoksa `date +%s`'e düşüyor — yani test dışındaki davranış değişmiyor — ve iki sınır
  testi de saati duvar saati yerine fixture'ın kendi mtime'ına sabitliyor. 91 sn'lik kardeş test
  hiç flaky değildi (91'in 92'ye kaymasi onu dışarıda tutmaya devam eder) ama o da sabitlendi;
  çifti gevşek bağlı iki assertion olmaktan çıkarıp gerçek bir sınır testi yapan şey bu.
  Negatif kontrol yapıldı: eşiği 89'a çekmek ve `-le`'yi `-lt` yapmak, ikisi de 90 sn testini
  düşürüyor — yani test yalnızca geçmiyor, sınırı gerçekten ölçüyor.

## [4.15.0] — 2026-08-02

### Eklendi

- **`verdict.json` artık worker'ın kanıt kaydını taşıyor.** `cli-dispatch-run`, worker'dan
  çalışma dizinine `worker-report.json` yazmasını isteyen kalıcı bir talimat ekliyor —
  `{claim, howVerified, command, result}` şeklinde `claims[]`, ayrıca `notDone[]` ve
  `assumptions[]`. `verdict-writer.mjs` bunu normalize edip verdict'e `workerReport` altında
  katlıyor. `CLI_DISPATCH_NO_WORKER_REPORT=1` ile kapatılır; çalışma-dizini
  sözleşmesinden ayrı bir bloktur ve kendi anahtarı vardır.

  **Bu bir öz-beyandır ve bilinçli olarak kanıt sayılmaz.** Var olma sebebi şu: worker'lar
  istendiğinde zaten kanıtlıyor — üç delegasyon koşusunda da worker'a çıktı denkliğini
  kanıtlaması söylendi, kanıtladı, ama kanıt orkestratöre yalnızca 300 karaktere kırpılmış
  önizleme olarak ulaştı; orkestratör hepsini elle yeniden türetti. Kayıt, o kanıtı
  makine-okunur yapar ve "her şeyi yeniden kontrol et"i "neyi yeniden kontrol edeceğim"e
  çevirir. Hiçbir iddiayı doğru kılmaz; `--verify` hâlâ yalnızca "testler geçiyor" der,
  "çıktı değişmedi" demez.

  Bu çerçevenin şekle yansıyan sonuçları:
  - `unevidencedClaims`, arkasında **komut olmayan** claim'leri sayar; böylece bir iddia asla
    bir ölçüm gibi okunmaz. Bu claim'ler silinmez, sayılır — gizlemek saymaktan kötü olurdu.
  - rapor yoksa `null`; yazılmış ama kullanılamazsa `{valid: false, reason}`. "Worker çöp
    yazdı" ile "worker hiçbir iddiada bulunmadı" birbirine benzememeli.
  - claim/liste girdileri 50, alan başına 2000 karakterle sınırlı; kaçak bir rapor, her
    tüketicinin okuduğu verdict'i şişiremez.

- `__tests__/worker-report.test.mjs` (10 test) ve runner brief'i için varsayılan-açık davranışı
  ile opt-out'u kapsayan iki test. Suite: 479 → 490.

### Değişti

- `.specs/dev/sdd/deterministic-runner.md`, `workerReport` bloğunu "kanıt DEĞİL, kanıt KAYDI"
  vurgusuyla birlikte belgeliyor; şemayı sonra okuyan biri onu doğrulama sonucu sanmasın.

## [4.14.0] — 2026-08-01

### Eklendi

- **Oturum dizinleri artık yazma anında, pasif olarak sınırlanıyor.** Her parser,
  `parse-utils.mjs`'e eklenen `pruneSessionRoot()`'u kendi oturum dizinini oluşturduktan
  hemen sonra bir kez çağırıyor ve kökü en yeni `CLI_DISPATCH_MAX_SESSIONS` (varsayılan
  **100**) *bitmiş* oturuma indiriyor. Şimdiye kadar kök yalnızca biri `/cli-dispatch:clean`
  çalıştırırsa ya da zamanlanmış işi kurarsa küçülüyordu — ikisi de yapılmamış bir makinede
  41 oturum / 54 MB birikmiş ve hiçbir şey budamıyordu. Fikir codex-plugin-cc'nin
  `MAX_JOBS`'undan alındı.

  Bu veri siliyor, o yüzden garantiler önemli:
  - **terminal olmayan** bir oturum (`running`, `human-controlled`) ne kadar eski sıralanırsa
    sıralansın asla silinmez — canlı bir worker kardeşinin budamasından sağ çıkar
  - hiç state yazmamış bir oturuma **dokunulmaz**: ilk status yazımından önce ölen bir parser,
    hiç başlamamış olandan ayırt edilemez ve onu yargılayacak boşta-kalma verisi yalnız
    `cli-dispatch-clean`'de vardır
  - `verdict.json` / `verdict-diff.patch`, dizin gitmeden önce
    `sessions/verdict-archive/` altına kopyalanır; pasif bir sınır, deterministik bir
    koşunun tek kaydını asla yok edemez
  - çağıran oturumun kendi dizini muaftır ve her hata yutulur — temizlik işi, onu tetikleyen
    koşuyu bozamamalı
  - `CLI_DISPATCH_MAX_SESSIONS=0` budamayı kapatır; negatif ya da ayrıştırılamayan bir değer
    de "her şeyi buda" değil "kapalı" olarak okunur

  Bu bir taban, `/cli-dispatch:clean`'in **yerine geçmez**: sınır bayatlık tespiti,
  takeover reap'i ve yaşa dayalı süpürme yapmaz.

- `__tests__/session-prune.test.mjs` — 14 test; çoğu mutlu yolu değil, iki tehlikeli hata
  modunu (canlı oturumu silmek, verdict kaybetmek) çiviliyor. Beş parser'ın da budamayı
  gerçekten çağırdığını, kendi dizinini değil oturum *kökünü* budadığını ve bunu
  `mkdirSync`'ten *sonra* yaptığını doğrulayan bir test de içeriyor. Suite: 465 → 479.

## [4.13.0] — 2026-08-01

Salt-okunur komutlarda ön-çalıştırma yayılımını tamamlar.

### Değişti

- **Backend'e özgü beş `*-balance` komutu artık `cli-dispatch-balance.sh`'i paylaşıyor.**
  4.12.0'daki `*-status` birleştirmesiyle aynı şekil: `--backend <slug>` bayrağı raporu tek
  backend'in bölümüyle sınırlar, bayraksız çağrı tam beş bölümlü raporu değişmeden basar.
  15.401 → 3.977 bayt (-%74). Bilinmeyen ya da eksik slug 2 koduyla çıkar.
  `*-status`'te olduğu gibi, backend'e özgü metin ve *çıkış kodu* toplu raporunkiyle aynı
  değildi: `ds-balance` config ya da anahtar yoksa 1 ile çıkarken toplu rapor
  `key: not set (skip)` yazıp devam ediyor; `cx-balance` toplu raporun basmadığı bir
  snapshot satırı basıyor. `--backend` komuta özgü davranışı korur — her eski bloğa karşı
  hem çıktı hem çıkış kodu karşılaştırılarak doğrulandı.
  `ds-balance.md` native Windows PowerShell bloğunu koruyor.

### Eklendi

- `preexec-commands.test.mjs`'e dönüştürülen her `*-balance` komutu için satır, her birinin
  doğru `--backend` slug'ını geçirdiğini doğrulayan bir test ve `ds-balance.md`'nin hâlâ
  fenced PowerShell bloğu taşıdığını ama fenced bash bloğu taşımadığını doğrulayan bir test
  eklendi. Ortak yasaklı-desen döngüsüne opt-in `stripFencedPowerShell` bayrağı geldi;
  yalnızca `ds-balance` kullanıyor — meşru PowerShell bloğu, bash çıkarımının yasakladığı
  endpoint'i içerdiği için. Suite: 443 → 465.

### Notlar

- Denklik doğrulanırken Antigravity bölümünün **upstream'de belirlenimsiz** olduğu ortaya
  çıktı: yerel language server `clientModelConfigs`'i ardışık çağrılarda farklı sırada
  döndürüyor, yani *aynı* kodun iki koşusu farklı sıralı model listesi üretiyor. Bu durum
  refactor'dan önce de vardı ve onunla ilgisiz (eski blok kendisiyle diff'lenerek
  doğrulandı); denklik bu yüzden sıralanmış çıktı üzerinden kuruldu. Bir `balance` raporunu
  diff'leyip "bir şey değişmiş" sonucuna varmadan önce bilinmesi gereken bir ayrıntı.

## [4.12.0] — 2026-08-01

### Değişti

- **Backend'e özgü beş `*-status` komutu artık `cli-dispatch-status.sh`'i paylaşıyor.**
  Script'e `--backend <slug>` bayrağı eklendi (`deepseek`/`antigravity`/`codex`/`opencode`/
  `copilot`); raporu tek bir backend'in bölümüyle sınırlar. Bayraksız çağrıda bugünkü tam
  beş-backend raporu değişmeden basılır. `ds-status`, `ag-status`, `cx-status`, `oc-status`
  ve `cp-status` kendi problarını gömmek yerine bunu ön-çalıştırıyor: 9320 → 2808 bayt
  (-%70). Bayrağın ikinci bir konumsal argüman olmaması bilinçli — mevcut `[pluginRoot]`
  sözleşmesine dokunulmuyor. Bilinmeyen ya da eksik slug 2 koduyla ve kullanım satırıyla
  çıkar.
  Backend başına çıktı, yerini aldığı beş blokla byte-identical; toplu rapor da öncekiyle
  byte-identical — komut bazında doğrulandı. Not: backend'e özgü metin, toplu raporun ilgili
  bölümüyle hiçbir zaman aynı değildi (ifade ve prob derinliği farklı); `--backend`
  toplu raporunkini değil, *komuta özgü* metni korur.

### Eklendi

- `preexec-commands.test.mjs`'e dönüştürülen her `*-status` komutu için satır ve her birinin
  doğru `--backend` slug'ını geçirdiğini doğrulayan bir test eklendi. Suite: 422 → 443.

## [4.11.0] — 2026-08-01

Ön-çalıştırma yayılımına devam eder. Altı `sessions` komutunun birbirinin kopyası olduğu
ortaya çıktı; bu yüzden altı ayrı script yerine tek bir parametreli script'te birleşiyorlar.

### Değişti

- **`sessions` ailesinin tamamı artık tek bir script'i ön-çalıştırıyor.** `sessions`,
  `ds-sessions`, `ag-sessions`, `cx-sessions`, `oc-sessions` ve `cp-sessions` aynı node
  programını altı kez gömüyordu; aralarındaki tek fark bir backend adı, `backend`
  sütununun olup olmaması ve iki mesajdı. Hepsi artık `cli-dispatch-sessions.sh [backend]`
  çağırıyor: argümansız toplu görünüm, backend adıyla filtreli görünüm. Komut markdown'ı
  13.480 bayttan 3.684 bayta iniyor (-%73) ve tekrar da onunla birlikte gidiyor. Bilinmeyen
  bir backend argümanı 2 koduyla ve kullanım satırıyla çıkar. Çıktı, yerini aldığı altı
  bloğun her biriyle byte-identical — komut bazında doğrulandı.
- **`/cli-dispatch:help` artık `cli-dispatch-help.sh`'i ön-çalıştırıyor.** 3501 → 376 bayt
  (-%89); dosya neredeyse tamamen referans kutusundan ibaretti ve model her çağrıda onu
  baştan sona yeniden yazıyordu.

### Düzeltildi

- **Worktree leak post-check'i, orkestratörün kendi düzenlemelerini worker'a yıkıyordu.**
  Guard, korunan repoyu koşudan önce fotoğraflar ve sonrasındaki her YENİ girdide hata
  verir — ama bir fotoğraf yazarlık bilgisi taşımaz; koşu uçarken ana repoyu düzenlemek,
  worker'ın worktree dışına bir yol çözmesiyle birebir aynı görünür. Eski mesaj doğrudan
  "worker sızdırdı" diyordu ve sonuçtaki exit 1, `--verify` daha çalışmadan koşuyu
  öldürüyordu — yani çağıranın kendi düzenlemeleri yüzünden gayet iyi bir worker sonucu
  çöpe gidiyordu. Hata mesajı artık her iki olası nedeni de söylüyor, worker'ın çıktısının
  worktree'de sağlam durduğunu belirtiyor ve yeni `CLI_DISPATCH_ALLOW_CONCURRENT_EDITS=1`
  opt-out'unu gösteriyor; bu değişkenle durum uyarıya iniyor ve `--verify` yine çalışıyor.
  Bloğun birebir aynı kopyasını taşıyan beş `*-worktree-run.sh` runner'ının hepsine
  uygulandı.

### Eklendi

- `preexec-commands.test.mjs`'e yeni dönüştürülen yedi komut için satırlar, ayrıca her
  backend'e özgü `*-sessions` komutunun doğru backend adını geçirdiğini doğrulayan bir
  test eklendi.
- `worktree-in-place.test.mjs`'e backend başına iki test (toplam on) eklendi: eşzamanlı
  düzenleme opt-out'u ve yeniden yazılan hata mesajı. Suite: 383 → 422.

## [4.10.0] — 2026-08-01

4.9.0'ın ön-çalıştırma desenini kalan en büyük üç salt-okunur komuda yayar ve 4.9.0'ın
kendi ön-çalıştırmasının sessizce veri kaybetmesine yol açan regresyonu düzeltir.

### Düzeltildi

- **`${CLAUDE_PLUGIN_ROOT}` bir `!` ön-çalıştırma satırına interpolate edilir ama
  alt-sürece ortam değişkeni olarak GEÇMEZ.** `cli-dispatch-status.sh` onu ortam
  değişkeni olarak okuyordu; bu yüzden sürüm bayatlık kontrolü 4.9.0 boyunca hiç
  çalışmadı — kurulu wrapper'lar birkaç sürüm gerideyken rapor sağlıklı görünüyordu.
  Artık hem `status` hem `doctor` plugin kökünü argüman olarak (`$1`) alıyor, ortam
  değişkenine ise geri düşüyor. `cli-dispatch-status.ps1`'e eşleşen bir `-PluginRoot`
  parametresi eklendi.

### Değişti

- **`/cli-dispatch:doctor`, `/cli-dispatch:balance` ve `/cli-dispatch:clean-schedule`
  artık çıkarılmış bir script'i ön-çalıştırıyor** — modelin Bash tool çağrısı olarak
  birebir yeniden yazmak zorunda kaldığı gömülü shell yerine. Üçünün komut markdown'ı
  toplamda 21.372 bayttan 4.979 bayta iniyor (-%77): `doctor` 9135 → 707, `balance`
  6410 → 1280, `clean-schedule` 5827 → 2992. Yeni `cli-dispatch-doctor.sh`,
  `cli-dispatch-balance.sh` ve `cli-dispatch-clean-schedule.sh` plugin cache'inden
  çalışır, `~/.local/bin`'e kurulmaz — `cli-dispatch-status.sh` ile aynı düzen, böylece
  plugin'e göre asla bayatlayamazlar.
- **`clean-schedule` yalnızca salt-okunur bir `status` probu ön-çalıştırır.** Dönüştürülen
  komutlar arasında sistem durumunu değiştiren (launchd plist'i, crontab) tek komut odur
  ve ön-çalıştırma model hiçbir şey görmeden çalıştığı için onay alma imkânı yoktur.
  `install`/`uninstall` bilinçli bir adım olarak kalır ve `$ARGUMENTS`'ı aynı script'e
  iletir. Script'in kendi varsayılan eylemi de aynı nedenle `status`'tür — çıplak bir
  çalıştırma asla plist yazamaz ya da crontab'ı yeniden yazamaz. Komutun belgelenmiş
  varsayılanı hâlâ `install`; markdown onu açıkça geçirir. Script ayrıca launchd/cron
  seçimini modele blok seçtirmek yerine `uname` ile yapar; native Windows Scheduled Tasks
  yolu markdown içinde kalır.

### Eklendi

- `__tests__/preexec-commands.test.mjs` — dönüştürülen dört komutun tamamını kapsayan
  tablo tabanlı koruma (23 test): `!` satırı var ve var olan bir script'i gösteriyor,
  shell markdown'a geri sızmamış, her markdown boyut tavanının altında, her script
  `bash -n` geçiyor, hiçbir API anahtarı DEĞERİ basılmıyor, plugin kökü argüman olarak
  taşınıyor ve `clean-schedule`'ın ön-çalıştırması ne `install` ne `$ARGUMENTS` içeren
  bir `status` probu. `__tests__/status-command.test.mjs`'in yerini alır; onun
  status'e özgü doğrulamalarını da kapsar.

## [4.9.0] — 2026-07-31

`/cli-dispatch:status`'ün shell'ini modele yeniden yazdırmayı bırakır. Salt-okunur
komutların tamamının izleyebileceği bir desen için pilot.

### Değişti

- **`/cli-dispatch:status` artık shell'ini komut markdown'ına gömmek yerine ayıklanmış bir
  script'i ön-çalıştırıyor.** 100 satırlık bash bloğu `scripts/cli-dispatch-status.sh`'e
  taşındı; `commands/status.md` onu bir `` !`…` `` ön-çalıştırma satırıyla çağırıyor ve
  yalnızca sonucun nasıl sunulacağını anlatıyor.
  - Eski biçim her çağrıda iki kez ödetiyordu: shell context'e *input* olarak giriyordu
    (7615 baytlık komut markdown'ı), ardından model onu Bash tool çağrısı olarak kelimesi
    kelimesine yeniden yazıyordu — aynı 7 KB için bu kez pahalı olan *output* tokenlarından
    ikinci ödeme. Ön-çalıştırma script'i model daha hiçbir şey görmeden koşturuyor; shell
    hiç yeniden yazılmıyor ve tool-call karar turu da ortadan kalkıyor.
  - `status.md`: **7615 → 940 bayt (%-88)**. Çıktının gömülü bloğunkiyle birebir aynı
    olduğu doğrulandı, iki yönlü mutasyon kontrolü yapıldı.
  - Script plugin cache'inden (`${CLAUDE_PLUGIN_ROOT}/scripts/`) koşuyor, `~/.local/bin`'e
    **kurulmuyor** — `cli-dispatch-statusline.sh`'in zaten kullandığı düzen. Bu aynı zamanda
    `/plugin update`'in komutları tazeleyip kurulu wrapper'lara hiç dokunmaması yüzünden
    oluşan kurulum bayatlığı tuzağını da atlıyor.
  - Bilinçli olarak Node'a çevrilmedi, bash kaldı: `status`, görevlerinden biri
    `node: MISSING` demek olan komut; çalışmak için Node'a ihtiyaç duymamalı.
  - Native Windows için `cli-dispatch-status.ps1` yanında geliyor (önceki PowerShell
    bloğuyla aynı kapsam: yalnız DeepSeek + Codex), komuttaki geri-düşüş notundan erişiliyor.

### Düzeltildi

- **Tam test suite'i artık yük altında sonsuza kadar asılmıyor.** `cp-stream-parse.test.mjs`'in
  reconcile yardımcısı, parser'ın throttle'lı `status.json` yazımı için sabit 350 ms bekleyip
  üzerine yazıyordu. O yazım henüz inmemişse `writeFileSync` **bir timer callback'i içinde**
  `ENOENT` fırlatıyordu — ki bu, kapsayan promise'i reject edemez — dolayısıyla bir sonraki
  satırdaki `proc.stdin.end()` hiç çalışmıyor ve parser stdin'i sonsuza kadar bekliyordu.
  Canlı gözlem: `node --test` bloke haldeyken bir `cp-stream-parse.mjs` çocuğu 10+ dakika
  %0 CPU'da duruyordu. Yardımcı artık uyumak yerine `status.json`'ı poll ediyor (10 sn
  deadline) ve stdin'i `finally` içinde kapatıyor; böylece yazım hatası asılma yerine
  gürültülü bir başarısızlık üretiyor. 4.7.3'te düzeltilen `cx-stream-parse` zamanlama
  yarışıyla aynı sınıf; 27. test dosyasını eklemek eşzamanlılığı bunu devirecek kadar artırdı.
  Daha önce makine yüküne atfedilmişti — gerçek bir kusurmuş.

### Eklendi

- **`__tests__/status-command.test.mjs`** (6 test) — markdown/script çiftini koruyor:
  ön-çalıştırma satırı script'i göstermeli, her iki platform ikizi de var olmalı, bash
  bloğu markdown'a geri sızmamalı, markdown 2500 baytın altında kalmalı, script `bash -n`'i
  geçmeli, ve hiçbir backend'in API anahtar DEĞERİ yazdırılmamalı (yalnız set/MISSING).

## [4.8.0] — 2026-07-29

Güvenli temizlik davranışını varsayılan yapar ve statusline fragment'ine ilk testini kazandırır.

### Değişti

- **`cli-dispatch-clean` artık verdict'leri varsayılan olarak arşivliyor; vazgeçmek için
  `--no-preserve-verdicts`.** Arşivleme `--preserve-verdicts` bayrağının arkasındaydı, yani bir
  bayrağı unutunca elinize geçen davranış yıkıcı olandı. Worktree'si çoktan silinmiş bir session
  için `verdict-diff.patch`, worker'ın değişikliklerinin **tek** hayatta kalan kaydıdır — ve runner
  asla commit etmediği için bu, uç durum değil normal son durumdur.
  - Bu makinede ölçüldü: 105 eski session dizinini süpüren bir temizlik, 7'si patch taşıyordu ve
    hepsini yok edecekti. Arşivin tamamı 128 KB; eski varsayılan için hiçbir zaman maliyet argümanı
    yoktu.
  - `--preserve-verdicts` hâlâ parse ediliyor ve hâlâ çalışıyor — artık varsayılanı etkinleştirmek
    yerine ona ad veriyor. Hiçbir cron kaydı ya da script kırılmıyor.
- **Özet satırı, hiç yapılmamış bir arşiv denemesini ima etmeyi bıraktı.** Arşivleme kapalıyken
  `archived verdicts for 0 session(s)` basıyordu; bu "baktık ve bulamadık" diye okunuyordu. Artık
  arşivlemenin devre dışı olduğunu söylüyor. Dry-run notu da, zaten varsayılan olan bir bayrağı
  geçmeni söylemek yerine opt-out'u gösteriyor.
- `/cli-dispatch:clean` slash komutu temizleyici mantığın kendi kopyasını gömüyor; aynı değişikliği
  o da aldı — aksi hâlde komut ile kurulu binary, bir temizliğin neyi yok ettiği konusunda
  anlaşamazdı. İki README de güncellendi.

### Testler

- **`cli-dispatch-statusline.sh` için ilk test** (`__tests__/statusline-fragment.test.mjs`, 14
  test). Her statusline yenilemesinde çalışıyor ve hiç kapsamı yoktu. Sabitlenenler: pasifken boş
  çıktı (birleştirici wrapper bir işarete değil, boşluğa bakıyor), politika enjeksiyonu açıkken
  `[CD]`, `▶N` sayımı, terminal state'lerin sayılmaması ve — ince olanı — `status.json` mtime'ı
  90sn'den eski olan bir `state: "running"` session'ın sayılmaması; çünkü çökmüş bir worker o
  state'i süpürülene dek koruyor ve aksi hâlde sonsuza dek hayalet bir sayaç asılı kalırdı.
  Bağımsız olarak mutasyonla sınandı: staleness penceresini genişletmek 14 testin 3'ünü düşürüyor.
- Dört yeni temizleyici testi: varsayılan arşivleme, opt-out, `--preserve-verdicts` geriye dönük
  uyumluluğu ve özet satırının ifadesi.

## [4.7.4] — 2026-07-29

Bir koşumun hiç verdict üretmeden başarı raporlamasının son yolunu kapatır.

### Düzeltildi

- **Hiçbir şey basmayan ama 0 ile çıkan bir `build-verdict`, tüm koşumu 0 ile çıkartıyordu.**
  Boş-çıktı dalı zaten vardı — hata şekilli bir `verdict.json` yazıyor ki downstream `JSON.parse`
  tüketicileri çökmesin — ama sonra yardımcının exit kodana güveniyordu. Yani hiç verdict'i olmayan
  bir koşum (ne `state`, ne `verify`, ne `changedFiles`) başarı raporluyordu.
  - Bu bileşim 4.7.3'e kadar erişilebilirdi: `verdict-writer.mjs`'in entry-point guard'ı yolunda
    symlink varsa sessizce no-op yapıyordu ve runner worktree'lerini macOS'ta symlink olan `/tmp`
    altına koyuyor. Guard düzeldi, ama runner bir yardımcının asla böyle davranmayacağına
    bel bağlayamaz.
  - Artık hem boş-çıktı verdict'inin `exitCode` alanı hem runner'ın kendi çıkışı **5** —
    contract'ın setup-error kodu — ve stderr'e tek satır tanı basılıyor. `build-verdict` çıktı
    ürettiğinde hiçbir şey değişmiyor: aynı exit kodu, aynı dosya, aynı temizlik.
  - `cli-dispatch-run.ps1`'de birebir düzeltildi; ikizde de aynı delik vardı.
- `cli-dispatch-run`'ın verdict-build kuyruğu artık bir `build_and_write_verdict` fonksiyonu; hem
  normal yol hem test hook'u aynı fonksiyonu çağırıyor, böylece ikisi ayrışamıyor.

### Testler

- Yeni entegrasyon senaryosu h): `CLI_DISPATCH_VERDICT_WRITER`'ı hiçbir şey basmayıp 0 ile çıkan
  bir stub'a pinliyor, sonra runner'ın 5 ile çıktığını, `verdict.json`'ın parse olduğunu, `error`
  taşıdığını ve `exitCode`'unun 0 değil 5 olduğunu doğruluyor. Mutasyonla sınandı: eski
  `exit "$BUILD_EXIT"` geri konunca test düşüyor.
- Bunu gerçek bir worker CLI'ı başlatmadan erişilebilir kılan `--_test-verdict-build <session-dir>`
  hook'u, mevcut `--_test-cleanup`'ın yanında erken-çıkışlı bir blok; üretim yolu koşulsuz kalıyor —
  normal akışı değiştirebilen bir hook, test ettiği bug'dan kötüdür.

## [4.7.3] — 2026-07-29

Symlink'li yoldan çağrıldığında dört script'i sessizce hiçbir şey yapmaz hâle getiren guard'ı
düzeltir.

### Düzeltildi

- **`gain-report.mjs`, `verdict-writer.mjs`, `check-version-sync.mjs` ve `policy-inject.mjs` ana
  fonksiyonlarını yalnızca `process.argv[1]` içinde symlink yoksa çalıştırıyordu.** Entry-point
  guard'ı, Node'un zaten çözmüş olduğu `import.meta.url`'i ham çağrı yoluyla karşılaştırıyordu.
  İkisi farklı olduğunda script hiçbir şey basmadan, hiçbir şey yapmadan 0 ile çıkıyor: hata yok,
  uyarı yok, çıktı yok.
  - macOS'ta bu varsayılan olarak erişilebilir bir durum, çünkü `/tmp` → `/private/tmp` symlink'i:
    `node /tmp/wt/…/gain-report.mjs` hiçbir şey basmıyordu,
    `node /private/tmp/wt/…/gain-report.mjs` raporu basıyordu.
  - Asıl zarar verebileceği yer `verdict-writer.mjs`. `cli-dispatch-run` worktree'lerini `/tmp`
    altında açıyor ve `CLI_DISPATCH_VERDICT_WRITER` içlerinden birine işaret edebiliyor — orada
    sessiz no-op demek, `build-verdict`'in hiç verdict yazmaması ve `mark-worktree-removed`'ın
    hiçbir şey kaydetmemesi, üstelik tüm exit kodları hâlâ başarı raporlarken.
  - Her guard artık karşılaştırmadan önce `process.argv[1]`'i `realpathSync` ile çözüyor; hata
    fırlatırsa ham yola düşüyor, böylece var olmayan bir yol guard'ın kendisini çökertemiyor.
- **cx-stream kill testindeki sabit uyku, status yazıcısıyla yarışıyordu.** 200ms throttle'lı bir
  yazım için 400ms uyuyordu; bu yalnız suite hafifken tutuyordu. Process başlatan bir test dosyası
  daha eklenince kill ilk flush'tan önce düşüyor ve test, tek başına geçerken tam suite'te
  kalıyordu. Artık iddialarının ihtiyaç duyduğu dosyayı 10sn tavanla yokluyor.

### Testler

- Yeni `__tests__/entrypoint-guard.test.mjs` (5 test): repo kökünü geçici bir dizine symlink'leyip
  dört script'i o yoldan çalıştırıyor ve her birinin gerçekten çıktı ürettiğini doğruluyor — artı
  ham `import.meta.url === pathToFileURL(process.argv[1]).href` karşılaştırmasının kalmadığını
  kaynak düzeyinde kontrol ediyor. Mutasyonla doğrulandı: tek dosyada eski guard'ı geri koymak
  5 testin 2'sini düşürüyor.

## [4.7.2] — 2026-07-29

Raporun karar açısından en önemli sayısını dipnottan çıkarır.

### Eklendi

- **`gain` artık "Anthropic subagents vs workers" bloğu basıyor**, deterministik koşum satırının
  hemen ardından. Baştaki rakam zaten hesaplanıyordu — ama "historical" etiketli bir bölümün son
  satırında, dışlama notu olarak (`other (non-runner) subagents: N agents, output X — excluded from
  ratio`). O sayı, raporun var oluş sebebi olan soruyu yanıtlıyor: iş ne kadar worker'a değil bir
  Anthropic modeline gitti. Bu makinede 36,1M output token'a karşılık worker'ların 108k'sı.
  - Blok, dipnotun bastığı değerleri yeniden hesaplamıyor, birebir onları kullanıyor; dipnot da
    yerinde kalıyor. Raporun geri kalanı bayt bayt aynı — öncesi ve sonrası tam çıktı
    karşılaştırmasıyla doğrulandı.
  - Erken hesaplayabilmek için subagent transcript taramasının ilk `console.log`'un üstüne
    taşınması gerekti.
  - Worker output'u sıfırsa bölme yerine `ratio: n/a (workers reported no usage)`.
- **Bu orana retention uyarısı.** İki taraf farklı buduanıyor: worker output'u session dizinlerinden
  geliyor ve onları `cli-dispatch-clean` siliyor; Anthropic tarafı ise `~/.claude/projects`'i
  okuyor ve orayı buradaki hiçbir şey budamıyor. 105 eski session süpürülünce oran, davranışta
  hiçbir değişiklik olmadan ~28×'ten ~332×'e çıktı. Etiketsiz bırakılırsa bu bir eğilim gibi
  okunuyor; oysa bir yan etki, ve satır artık bunu söylüyor.

## [4.7.1] — 2026-07-28

#133'ü düzeltir: `agy models` çıktı formatını değiştirdi; bu, `ag-stream`'in sorunsuz çalışan
modeller için uyarı basmasına ve `--effort`'un sessizce sabit bir model ailesine çivilenmesine yol
açtı.

### Düzeltildi

- **`ag-stream` artık geçerli bir model için "not listed by `agy models`" uyarısı basmıyor.** agy
  1.1.8'den itibaren bu komut kebab-case slug yazıyor (`gemini-3.6-flash-high`); önceden display
  name yazıyordu (`Gemini 3.6 Flash (High)`). `agy --model` **her ikisini de** hâlâ kabul ediyor —
  değişen yalnız listeleme — ama doğrulama listeye karşı tam eşleşmeli bir `grep -qxF` idi; bu
  yüzden bu deponun dokümante ettiği formatta yazılmış her config, agy'nin default'a düştüğünü
  iddia eden bir uyarı basmaya başladı. Düşmemişti: session transcript'i istenen modelin
  koştuğunu doğruluyor. Yanlış alarm önemliydi, çünkü uyarının kendisi doğru — agy bir yazım
  hatasında gerçekten sessizce default'a düşüyor, ve insanların görmezden gelmeyi öğrendiği bir
  alarm, hiç alarm olmamasından kötüdür.
- **`--model` verilmeden kullanılan `--effort` artık sabit fallback'e düşmüyor.** Eski kod modeli
  `agy models | grep -m1 "($SUF)$"` ile seçiyordu. Slug'larda ` (High)` soneki yok, dolayısıyla bu
  eşleşme hiç tutmuyor ve yalnız-effort koşan her çalıştırma, agy ne sunuyor olursa olsun sessizce
  `Gemini 3.5 Flash (<effort>)` kullanıyordu. Bu, hangi modelin koştuğunu değiştiriyordu — hem de
  bunu söylemeden.
- Karşılaştırma artık küçük harfe indirip alfanümerik olmayan her karakteri atan bir anahtar
  üzerinden yapılıyor, çünkü slug dönüşümü **mekanik değil**: agy `gemini-3.5-flash-high`'da
  noktayı koruyor ama Claude'unkini `claude-opus-4-6-thinking`'de tireye çeviriyor. Dört shell
  yardımcısı bunu taşıyor — `model_key`, `model_listed`, `apply_effort_suffix`,
  `pick_model_for_effort` — ve iki yönde de çalışıyorlar: display-name'li bir config agy
  yükseltmesinden sağ çıkıyor, slug'lı bir config ise display name listeleyen eski bir agy'de de
  doğrulanıyor. Gerçek bir yazım hatası hâlâ uyarı alıyor.
- `apply_effort_suffix` çağıranın formatını koruyor: `--model gemini-3.6-flash --effort low`
  → `gemini-3.6-flash-low`, `--model "Gemini 3.6 Flash" --effort low` → `"Gemini 3.6 Flash (Low)"`.
- Kullanılamaz bir `agy` (kurulu değil, giriş yapılmamış, boş liste) artık modeli bilinmeyen
  ilan etmek yerine uyarıyı bastırıyor — bu, tam da kurulumu henüz bitirmemiş kişiye yönelen
  ikinci bir yanlış pozitifti.
- **Worktree taraması testlerde izole edilebilir hâle geldi (`CLI_DISPATCH_WT_SCAN_ROOTS`).** `GET
  /api/clean?worktrees=1` testi `TMPDIR`'ı fixture'a çeviriyordu, ama `/tmp` koşulsuz taranıyor;
  bu yüzden geliştiricinin makinesindeki gerçek bir artık worktree — ki başarılı bir delegasyon
  **tasarım gereği** böyle bir şey bırakır, runner asla commit etmediği için — fixture'larla
  birlikte sayılıp testi düşürüyordu. Yeni env değişkeni iki varsayılan kökün ikisini de
  değiştiriyor. Üretim davranışı aynı; testler dışında kimse bunu set etmiyor.

### Değişti

- Dokümanlar ve config editörü artık display-name'i tek geçerli format saymak yerine iki formatı
  da sunuyor: `install.sh` config iskeletinin yorumları, dashboard config editöründeki iki
  `AG_MODEL`/`AG_MODELS` `<datalist>`i (canlı `agy models` çıktısından tazelendi — artık listenin
  başında olmayan bir model kuşağını listeliyorlardı), `commands/ag-run.md` ve
  `skills/ds-delegate/SKILL.md`'deki backend tablosu. `commands/ag-run.md` açık açık *"not a loose
  slug like `gemini-3.5-flash`"* diyordu; bu artık gerçeğin tam tersi.
- Dokunulmayan ve bunun bilinçli olduğu doğrulanan: `ag-transcript-parse.mjs` ve testleri hâlâ
  **display name** kazıyor, çünkü `agy models` nasıl yazarsa yazsın agy transcript'ine bunu
  yazıyor (taze bir session'da kontrol edildi). `README.md` / `README.tr.md` yalnızca *"liste:
  `agy models`"* diyor, o da doğru kalıyor.

### Testler

- Yeni `__tests__/ag-model-format.test.mjs` (15 test) dört yardımcıyı sevk edilen `ag-stream`'den
  çıkarıp gerçek bash altında, `agy` stub'lanmış hâlde koşturuyor; böylece iddialar kopyayı değil
  script'in kendisini not veriyor — `ps1-bash-quoting.test.mjs`'in getirdiği teknik. İki listeleme
  formatını iki yönde de, gerçek-pozitif yazım hatasını, boş-liste durumunu kapsıyor ve eski
  `grep -m1 "($SUF)$"` deseninin gittiğini sabitliyor. Mutasyonla doğrulandı: `model_key`'i
  zayıflatmak 3'ünü, boş-liste guard'ını düşürmek 1'ini kırıyor.
- Bir guard testi `ag-stream`'in herhangi bir yerinde bash 4 case expansion'ını (`${var,,}` /
  `${var^^}`) reddediyor. macOS hâlâ `/bin/bash` 3.2 gönderiyor ve bu depodaki başka hiçbir script
  bunları kullanmıyor; yardımcılar doğrudan 3.2 altında yeniden koşturularak doğrulandı.
- Yeni bir dashboard testi `CLI_DISPATCH_WT_SCAN_ROOTS`'un varsayılan kökleri eklemek yerine
  **değiştirdiğini** sabitliyor; böylece izolasyon sessizce geri gidemiyor.

## [4.7.0] — 2026-07-26

Dashboard'un router'ını ayrıştırır — 4.3.0'da bilinçle kapsam dışı bırakılan tek yapısal madde ve
#125'in son açık parçası.

### Değişti

- **`dashboard-server.mjs`'in router'ı artık 288 satırlık `if`-zinciri değil, bir route tablosu.**
  Her istek tüm yol string'lerini sırayla yeniden test ediyordu (`/api/clean` üç kez,
  `/api/config` iki kez) ve iki handler — config yazıcı ile OpenRouter model çekimi, toplam ~120
  satır — dispatcher'ın ortasında gömülü duruyordu. Her handler artık tek tip
  `(req, res, params, url)` imzasıyla adlandırılmış bir fonksiyon; tablo
  `{method, path | pattern, handler}` bildiriyor.
  - Route kapsamı değişmedi ve eski zincire karşı satır satır karşılaştırıldı: 11 tam yol, 7
    pattern route, 3 vendor asset. Vendor satırları **`VENDOR_FILES`'tan üretiliyor**; böylece o
    allowlist hangi statik dosyaların var olduğunun tek kaynağı olarak kalıyor.
  - Tablo eski zincirin sırasında tutuldu. Sıra doğruluğu etkilemiyor — hiçbir iki satır aynı
    `(method, path)` çiftini paylaşmıyor — ama tabloyu getiren diff'i incelenebilir tutuyor.
  - Handler'ın `params`'ı HAM regex yakalamalarıdır. Decode ve `okId()` doğrulaması zaten
    bulundukları yerde, handler'ların içinde kalıyor; dispatcher'a containment kontrolleri
    koşmadan önce bir yol parçasını "yardımcı olmak için" decode etme şansı verilmedi.

- **Artık her route'un method guard'ı var ve yanlış verb `Allow` başlığıyla `405` dönüyor.** Bu
  gerçek bir davranış değişikliği: `POST /api/sessions` eskiden GET handler'ını çalıştırıp 200
  dönüyordu, çünkü eski zincir yalnız yola bakıyordu. Yalnızca üç route'a guard verilmişti.
  - `405 {"error":"method not allowed","allow":"GET"}` — başka bir verb altında var olan bir yol
    404 değildir ve `Allow` başlığı, çağıranın hangi verb'i kullanacağını öğrenmesinin tek
    yoludur. Bilinmeyen yollar mevcut `404 {"error":"no route"}` şeklini birebir koruyor.
  - **`HEAD`, `GET` handler'ı tarafından karşılanıyor.** Eskiden yalnızca zincir method'a hiç
    bakmadığı için çalışıyordu; guard eklemek aksi hâlde `curl -I`'yı 405 yapardı. Node, HEAD
    yanıtlarında gövdeyi kendisi bastırıyor.

### Testler

- 319 → 322 ve mevcut bir iddia güncellendi: diff route'unun POST reddi `404`'e (eski
  fall-through) sabitlenmişti, artık `405` + `Allow: GET`.
- Yeni kapsam: yalnız-GET, yalnız-POST ve GET+POST yollarında 405 + `Allow`; bilinmeyen yol için
  404 şekli (ve `Allow` taşımadığı); tablodaki her satırın kendi verb'ine yanıt vermesi; pattern
  route'larda bozuk id'lerin hâlâ fail-closed olması; ve HEAD'in boş gövdeyle başlık dönmesi.
- Mutasyonla doğrulandı: HEAD desteğini düşürmek 1 testi, 405 dalını kaldırmak 2 testi düşürüyor.

## [4.6.0] — 2026-07-26

4.5.0 sonrası açık kalan iki maddeyi kapatır: hiçbir zaman true olamayan `worktreeRemoved`
alanı (#128) ve hiçbir kod yolunun seçmediği `.ps1` worktree runner'ları (#125).

### Düzeltildi

- **`verdict.json`'daki `worktreeRemoved` yapısal olarak her zaman false'tu (#128).** SDD
  (`.specs/dev/sdd/deterministic-runner.md:217`) `--cleanup-if-clean` worktree'yi kaldırdığında
  true olmasını şart koşuyor, ama `buildVerdict()` cevabı bilemez: verdict cleanup'tan *önce*
  yazılır, çünkü escalation artefaktıdır ve cleanup ölse bile var olmak zorundadır. Alanı dürüst
  biçimde ayarlayabilecek tek yer sonrasıdır; runner artık geri dönüp kaldırmayı kaydediyor — ve
  bunu yalnızca dizinin gittiğini kanıtlamış tek daldan yapıyor. Yeni
  `verdict-writer.mjs mark-worktree-removed` alt komutu, PowerShell ikizinde de aynısı
  (`Set-WorktreeRemovedInVerdict`).
  - **Sözleşme gereği fail-soft:** o noktada iş bitmiş, verify verdict'i diskte ve worktree
    gerçekten gitmiştir; dolayısıyla düşmeyen bir muhasebe yazımı bitmiş bir koşuyu asla
    başarısıza çevirmemeli. Tüm hata yolları false döner, CLI her hâlükârda 0 ile çıkar.
  - **Tek bir boolean** yazar. `build-verdict` çöktüğünde `cli-dispatch-run`'ın ürettiği
    `{schemaVersion, error, sessionId, exitCode}` şekli dokunulmadan bırakılır — oraya tek başına
    bir `worktreeRemoved` eklemek, hiç kurulmamış bir verdict'i varmış gibi giydirmek olurdu.
    Guard `error` alanının varlığına değil, `state`'in **yokluğuna** bakar; çünkü `error` aynı
    zamanda meşru bir `status.state` değeridir.
  - Yazımlar temp + rename ile yapılır: dashboard bu dosyayı `(mtime, size)` ile cache'liyor ve
    koşular biterken okuyor, dolayısıyla yarı yazılmış bir verdict'i asla görmemeli.
  - Dashboard bilinçli olarak bu kayıtlı bayrak yerine **canlı** `worktreeExists` kontrolünü
    kullanmaya devam ediyor. Canlı cevap, koşu sonunda kaydedilmiş bir iddiadan iyidir.
- **`cli-dispatch-run.ps1` kesme işareti içeren yollarda kırılıyordu (#125).** `bash -lc` çağrısı
  dört değeri çıplak tek tırnaklar arasında interpolate ediyordu; `C:\Users\O'Brien\repo` —
  sıradan bir Windows yolu — tırnağı erken kapatıp geri kalanı bash'e sözdizimi olarak veriyordu:
  en iyi hâlde bozuk koşu, en kötü hâlde injection. Artık her değer
  `ConvertTo-BashSingleQuoted`'dan geçiyor. Doğrulama: kesme işareti, boşluk, `$`, backtick, ters
  bölü, `;`, `&&`, satır sonu ve boş string gerçek bash üzerinden round-trip edildi ve dört
  değerin tam olarak dört argv girdisi olarak vardığı iddia edildi.

### Değişti

- **Workers listesinde başlangıç zamanı satırın metadata satırının sağ ucuna taşındı.** Eskiden o
  satırı açıyordu ve rail'de aslında taradığın üç token'ı — repo, canlı araç, token kullanımı —
  değişken bir miktarda sağa itiyordu; çünkü yerel zaman damgası sabit genişlikte değil. Sağa
  sabitlendiğinde kendi kolonunu oluşturuyor ve sol grup kalan tüm genişliği ellipsis için
  kullanıyor (yani 260px'lik rail repo adını kırpıyor, zamanı asla).
  - Satır, `loadList`'in gömülü satır şablonundan `workerMetaLineHtml`'e çıkarıldı ki düzen
    gerçekten test edilebilsin: bir CSS class'ını grep'lemek sıra hakkında bir iddia değildir. Üç
    test kapsıyor — `.when`'in sonda olduğu DOM sırası, token yokken artık ` · ` kalmaması ve
    düşmanca `cwd`/`lastTool`'un kaçırılması — ve sıra iddiası mutasyonla doğrulandı.

### Kaldırıldı

- **`ds-worktree-run.ps1` ve `cx-worktree-run.ps1` (#125).** Hiçbir şey onları seçmiyordu:
  `cli-dispatch-run.ps1` `.sh` runner adını sabit yazıyor ve bash yoksa 5 ile çıkıyor. Gönderilen
  şey, hiçbir kod yolunun çalıştıramadığı ikinci bir leak-guard kopyasıydı — ve 4.2.0 tam bu tür
  sessiz `.ps1`/`.sh` sapmasının üç vakasını düzeltmek zorunda kalmıştı. `install.ps1` artık
  onları kurmuyor.
  - **Bu yalnız bir temizlik değil, gerçek bir Windows davranış değişikliğidir:** Windows'ta repo
    görevleri (worktree koşuları) artık bash gerektiriyor — WSL ya da Git Bash — ki
    `cli-dispatch-run.ps1` bunu zaten gerektiriyordu. `commands/ds-run.md` `.ps1`'i native Windows
    yolu olarak dokümante ediyordu; o blok kaldırıldı. Generation, sessions, watch, kill, gain ve
    dashboard native PowerShell kalıyor ve bash gerektirmiyor.
  - `install.ps1` ayrıca önceki sürümlerin `~/.local/bin`'e kurduğu kopyayı **siliyor**. Yükseltme
    yalnızca gönderdiği dosyaların üzerine yazdığı için, bu süpürme olmadan makinede hiçbir şeyin
    seçmediği ve artık düzeltme almayan bir runner PATH'te kalırdı.
  - `CLAUDE.md` artık `*-worktree-run.sh`'ı cross-platform pairing kuralının dışında kayda
    geçiriyor; böylece sonraki okuyucu onları geri ekleyip "parity'yi restore" etmiyor.

### Testler

- 305 → 319. `markWorktreeRemoved` (alan çevrilirken diğer her şeyin bayt-bayt aynı kalması,
  idempotence, hata-şeklini reddetme, okunamaz/parse edilemez/nesne-olmayan girdide fail-soft, CLI
  çıkış kodları); gerçek cleanup yolunu süren üç runner-seviyesi senaryo (kaldırıldı → kaydedildi,
  korundu → hâlâ false, verdict yok → koşu etkilenmiyor); ve repodaki ilk pwsh-güdümlü test —
  `ConvertTo-BashSingleQuoted`'ı gönderilen script'ten **birebir** çıkarıyor ki sapmış bir kopyaya
  karşı geçemesin, ve pwsh ya da bash yoksa skip ediyor.
- İki yeni suite de mutasyonla doğrulandı: `record_worktree_removed` çağrısını düşürmek tam olarak
  onu iddia eden tek senaryoyu, quoting yardımcısını çıplak interpolasyona geri çevirmek de
  round-trip testini düşürüyor.
- Integration testi artık `CLI_DISPATCH_VERDICT_WRITER`'ı bu checkout'a pinliyor.
  `~/.local/share/cli-dispatch/verdict-writer.mjs`'i — en son *kurulan* engine'i — çözüyordu, yani
  değiştirilen kod yerine kurulu kodu notluyordu. O hata burada gerçek bir test başarısızlığı
  olarak ortaya çıktı.

### Notlar

- `#125`'in kalan iki maddesi bu sürümden önce çözülmüştü; yeniden yapılmadı, doğrulandı:
  `--base-ref` iki runner'dan da kaldırılmış, `policy-injection.md`'deki fail-closed çelişkisi
  düzeltilmiş ve `policy-inject.test.mjs` test 2b onu sabitliyor.

## [4.5.0] — 2026-07-26

4.2.1'den beri açık kalan dört denetim issue'sunu kapatır (#122 AU4, #123, #124, #125'in karar
gerektirmeyen yarısı) ve dashboard'a token offload özeti ekler. Bu sırada **manşet tasarruf
sayısındaki 2 kat hatayı** da düzeltir — bkz. Düzeltildi.

### Eklendi

- **Workers genel görünümünde token offload.** `Offloaded from Anthropic — 3.5M in / 785.5K out
  across 120 worker sessions`, deterministik runner alt kümesi ayrıca belirtilir (onlar yapısı
  gereği sıfır Anthropic gözetimi taşır). Bilinçli olarak **offloaded** denir, *saved* denmez:
  hangi token'ın Anthropic hesabına gitmediği ölçülebilir, ama tasarruf karşı-olgusaldır — aynı işi
  inline Claude yapsa ne harcardı kimse bilmiyor ve dashboard'ın tahmin etme yetkisi yok. İki
  çekince sayının yanında taşınır, örtük bırakılmaz: kaç session hiç usage bildirmiyor (yani toplam
  bir **taban** değerdir) ve kaçı koşu ortası anlık görüntüden sayıldı.
- **`/cli-dispatch:gain` artık deterministik koşuları bildiriyor** — sayı, verify sonuç dağılımı,
  worker token'ları ve açıkça `Anthropic babysitter tokens: 0 (the runner is plain shell)`.
  `verdict.json`'dan saptanır; `gain` şimdiye kadar o dosyayı hiç okumuyordu. #122'nin `gain`
  yarısını (AU4) çözer.
- **Leak post-check artık beş backend'i de koruyor** (#124). Tek bir soruyu yanıtlar — worker
  kendisine verilen ağacın DIŞINA yazdı mı? — ve bunu yalnız `ds-worktree-run.sh` soruyordu (11
  `GUARD_REPO` referansı; ag/cx/oc/cp'de **0**). Diğer dördünde, worktree'sinin dışına çıkan bir
  absolute path'i çözen worker bunu sessizce yapıyordu. Beşi de artık aynı `--post-check` modunu,
  koşu öncesi kir anlık görüntüsünü (yalnız YENİ kir hata verir) ve kurtarma patch'i çıktısını
  taşıyor. Gerçek script'leri gerçek repo'lara karşı, backend başına koşan 20 yeni testle kapsandı.
- **`CLI_DISPATCH_AUTH_PROBE_TIMEOUT_MS`** 3 saniyelik auth-probe süresini geçersiz kılar. Bu üst
  sınır doğrulukla değil makine yüküyle ilgili: yüklü bir makinede önemsiz bir probe onu kaçırıp
  `unknown` bildirebiliyor — dürüst, ama bir testi kararsız yapıyordu.

### Düzeltildi

- 🔴 **Dashboard worker input token'larını ~2 kat fazla bildiriyordu.** Codex cache-INCLUSIVE
  `input_tokens` bildiriyor ve `cached_input_tokens` bir alt küme — **gerçek veride toplamın %88'i**
  (3.82M'nin 3.38M'i). `gain` bunu çıkarıyor (issue #99); dashboard çıkarmıyordu, dolayısıyla aynı
  session dosyaları bir yüzeyde `6.8M in`, diğerinde `3.5M in` veriyordu. İkisi de artık birebir
  `3,464,536 in / 785,496 out` bildiriyor. `cached <= input` guard'ı savunma amaçlı değil, taşıyıcı:
  OpenCode `cached_input_tokens`'ı **ayrı** bir sayaç olarak bildiriyor ve `input_tokens`'ı
  aşabiliyor (gerçek veride 196k in / 300k cached) — orada çıkarma negatif token sayısı üretirdi.
  O negatif vaka dahil testlerle sabitlendi.
- **`gain`'in babysitting bölümü gerçeğin tersini söylüyordu.** Çekincesi "pinned-model olmayan
  CLI çağıran subagent'ları" dışlanan anomali gibi tarif ediyordu; oysa 4.0.0 sonrası bu **normal**
  vaka. Başlık ise o subagent'lar kaldırıldıktan sonra "yalnız runner subagent'ları" ölçtüğünü iddia
  ediyordu. Bölüm artık açıkça LEGACY (4.0.0 öncesi) etiketli ve bugünün koşularının nerede
  sayıldığını söylüyor. `cli-dispatch-run` bilinçli olarak `RUNNER_RE` dışında kalıyor — o onaylı
  yol ve Anthropic token'ı harcamıyor; eşleştirmek çözümü sorun gibi puanlamak olurdu.
- **Cross-platform eşik semantiği** (#123), bash kanonik:
  - `cli-dispatch-clean.ps1` worktree'leri bash'ten tam bir gün önce süpürüyordu. `find -mtime +N`
    yaşı tam 24 saatlik dilimlere kırpıp sonra kesinlikle N'den büyük olmasını istiyor, yani gerçek
    eşik **N+1 tam gün** — varsayım değil, ölçüm: 3.5 günlük bir dizin `+3` ile süpürülmüyor,
    4.0 günlük süpürülüyor. `.ps1` artık bunu birebir taklit ediyor. Birinin worktree'sini bir gün
    erken silmek daha kötü bir başarısızlık, o yüzden bash kazanıyor.
  - `cli-dispatch-clean.ps1` sayısal olmayan `--worktree-days` ile **çöküyordu**
    (PowerShell'de `[int]"abc"` fırlatır ve tüm süpürmeyi götürür). Bash sessizce varsayılana
    düşüyor; `.ps1` artık `TryParse` kullanıp aynısını yapıyor.
  - `cli-dispatch-wait.ps1` istenen süreden bir aralık fazla yokluyordu (`-gt`, bash'in `-ge`'sine
    karşı). Tam `--timeout` saniyede bekleme artık iki platformda da bitiyor.

### Değişti

- **`--base-ref`, `cli-dispatch-run` ve `.ps1` ikizinden kaldırıldı** (#125). İki platformda da
  ayrıştırılıp atanıyor ama **hiçbir yerde okunmuyordu** — worktree runner'ları kendi base ref'ini
  hesaplıyor. Onu geçen bir çağıran artık sessizce hiçbir şey almak yerine `unknown arg` ve exit 5
  alıyor; bu dürüst sonuç: flag hiç çalışmamıştı.
- **`cli-dispatch-run-integration.test.mjs` `node:test`'e çevrildi** (#125). Elle yazılmış
  `main()` + `process.exit()` dört senaryoyu tek raporlama birimine çöküyordu, yani hata dosyanın
  bozulduğunu söylüyordu, hangi vakanın değil. Eski şekilde doğruluk kaybı yoktu —
  `process.exit(1)` `node --test` altında hata olarak görünür — yalnız gözlemlenebilirlik.
- **`marketplace.json` keyword'lerinden `"subagent"` çıkarıldı** (#125) — tarif ettiği subagent'lar
  4.0.0'da kaldırıldı.

Test süiti 278 → 305.

## [4.4.0] — 2026-07-26

⚙ Configuration görünümü "bu backend kimlik doğrulamış mı?" sorusunu "`~/.config/cli-dispatch/config`
içinde ona ait bir key var mı?" diye yanıtlıyordu — beş backend'in üçü için bu yanlış soru.
`setup.md`, `install.sh`'in ürettiği config'e yazdığı yorumlar ve `README.md`, Antigravity, Codex ve
Copilot'un normalde kendi CLI'siyle giriş yaptığını ve **config'de hiç key olmadığını** söylüyor.
Dolayısıyla görünüm, kanıtlanabilir şekilde çalışan backend'ler için `○ not set` diyordu ve
`doctor.md` aynı soruyu doğrulanmamış bir tahminle, geçmiş gibi ("using Google sign-in")
yanıtlıyordu. `README.md` ise backend başına "CLI auth ✓/✗" vaat ediyor, ama bunu yalnız `gh`
gerçekten veriyordu.

### Eklendi

- **⚙ Configuration görünümünde backend başına auth durumu.** Her backend grubu artık iki kimlik
  kaynağını birleştiren ve bildiğinden fazlasını asla iddia etmeyen bir `auth` satırıyla başlıyor:
  `✓ key in config` / `✓ logged in (ChatGPT)` / `✓ logged in (gh)` / `✗ not logged in` + düzeltecek
  komut / `could not check` / `CLI not installed`. Yeni `GET /api/backend-auth` — alt süreç
  başlattığı ve farklı bir saatte cache'lendiği için `/api/config`'e ek yük yerine kendi route'u
  (60 sn TTL; soğuk ~590 ms, sıcak ~1 ms).
- **`/cli-dispatch:doctor`'daki tahminler gerçek probe'larla değişti** — login'i olan dört backend
  için: `codex login status` (`~/.codex/auth.json`'ın yerel okuması, ve *yöntemi* de bildiriyor —
  ChatGPT aboneliği ile API key farklı faturalanır), Copilot için `gh auth token` (repo'nun kendi
  "logged in" tanımı; `gh auth status`'ün aksine keyring'i **ağ turu olmadan** okur, yani çevrimdışı
  görünümü kilitlemez) ve OpenCode için `opencode auth list`.
- **Probe olmayan yerde session geçmişi kanıt olarak.** `agy`'de auth subcommand'ı hiç yok ve
  repo'daki tek mevcut Antigravity kontrolü 35 saniye üst sınırlı gerçek bir `agy -p "ping"`
  başlatıyor — config görünümü için çok yavaş. Antigravity ve DeepSeek için görünüm bunu açıkça
  söylüyor ve session dizinlerinin zaten taşıdığı en güçlü ucuz kanıtı ekliyor: backend başına son
  başarılı koşu ve `errorKind: 'auth'` hata sayısı.
- **Görünümün göremediği dört kimlik env değişkeni** artık bildiriliyor (yalnız varlık, asla değer):
  `ANTIGRAVITY_API_KEY`, `OPENAI_API_KEY`, `GH_TOKEN`, `GITHUB_TOKEN`. Her biri bir wrapper
  tarafından onurlandırılıyor ama `CONFIG_KEYS`'te yok; bu yüzden bunlardan biriyle kimlik
  doğrulamış bir kullanıcı yine "not set" görünüyordu.

### Güvenlik

- **Hiçbir probe çıktısı sunucudan çıkmıyor.** Her sonuç `dashboard-server.mjs` içinde bir enum ve
  kısa bir yöntem metnine çevriliyor; client'a hesap adı, e-posta veya token materyali gitmiyor. Bu
  en çok Copilot'ta önemli: `gh auth token` *token'ı basıyor*, o yüzden uzunluk kontrolünden geçirilip
  atılıyor — asla saklanmıyor, loglanmıyor, yanıta konmuyor. Bir test, tüm probe'lar bunları basacak
  şekilde ayarlandığında bile yanıtta `gho_`/`sk-or-v1`/hesap kimliği olmadığını doğruluyor.
- **Probe'lar prompt gösteremez.** Sabit argv (shell yok), `stdin` kapalı, 3 saniye timeout, süre
  dolunca `SIGKILL` — böylece bir login prompt'u dashboard isteğinin arkasında bekleyemez.
- **Koşamayan probe `unknown` bildiriyor, asla `logged-out`.** "Kontrol edemedim" ile "giriş yok"
  farklı iddialar ve yalnız biri güvenle söylenebilir; timeout, eksik CLI ve tanınmayan çıktı kendi
  durumlarını alıyor. Testlerle sabitlendi.

### Düzeltildi

- **`doctor.md` artık doğrulamadığı bir başarıyı bildirmiyor.** Antigravity, Codex ve Copilot
  bölümleri, yalnızca key yok diye güven verici giriş metni basıyordu. Codex ve Copilot artık gerçek
  probe yapıyor; Antigravity key'i dürüstçe bildirip koşu geçmişine düşüyor; OpenCode'un eksik key'i
  artık otomatik ölümcül sayılmıyor, çünkü `opencode auth login` var.
- **Kendi testinin yakaladığı `codex login status` parse hatası:** `"Not logged in"` küçük harfe
  çevrilince hâlâ `"logged in"` içeriyor, dolayısıyla naif pozitif eşleşme girişi olmayan kullanıcıyı
  girişli bildiriyordu. Olumsuzlama artık önce test ediliyor.

## [4.3.0] — 2026-07-25

Dashboard'u 4.0.0'ın gönderdiği mimariye hizalar. Dashboard'a 3.43.x'ten beri anlamlı bir dokunuş
olmamıştı — 4.0.0 `public-page.mjs`'te iki satır değiştirdi — dolayısıyla deterministik runner'ın
tüm çıktısı görünmezdi (`verdict`, `changed-files`, `changedFiles`, `--verify` ve
`cli-dispatch-run` üç dashboard dosyasında da **sıfır** kez geçiyordu), buna karşılık ölü bir
"Babysitter cost" paneli yerini koruyordu. #122'nin (AU5) dashboard yarısını kapatır.

### Eklendi

- **`verdict.json` ve `changed-files.json` artık birinci sınıf dashboard verisi.**
  `dashboard-utils.mjs`'e `readVerdict` / `readChangedFiles` / `clipLines` eklendi;
  `dashboard-server.mjs`'te iki yeni cache ile mtime+size kapılı. `/api/workers` satırları
  `hasVerdict`, `verdictPending`, `changedFileCount`, `diffstat`, `hasDiff`, `usagePartial`,
  `errorKind`, `error` ve kompakt bir `verdict` objesi kazandı. `/api/worker/<id>/flow` tam
  verdict'i (verify komutları, `failedAt`, çıktı kuyruğu), dosya başına git durumu ve
  `preexistingDirty` ile değişen dosya listesini, `worktreeExists`, `sourceRepo`, `branch`,
  `endedAt` ve bir `diff` işaretçisi kazandı. Boyut sınırı önemli: `verdict-writer.mjs` verify
  kuyruğunu 40 *satırda* sınırlıyor ama bayt sınırı koymuyor; `clipLines` ikisini de sınırlar ve
  `clip()`'in aksine satır yapısını korur — başarısız bir test raporunun bütün yükü o yapıdır.
- **Worker satırı bir koşunun gerçekte ne yaptığını gösteriyor.** Verdict varsa `⚙RUN` işareti,
  kompakt `verify ✓` / `verify ✗ e4` rozeti, ve verify sonucu ile değişim boyutunu (`1 file +67`)
  taşıyan ikinci bir satır. Verdict'i olmayan worker tam eskisi gibi render edilir — gerçek bir
  makinede 120 session'ın 107'si bu durumda — işaret yok, verify token'ı yok, kırmızı yok.
- **Worker detay görünümü artık verdict ile başlıyor**, silinen babysitter panelinin bulunduğu
  yerde: runner'ın exit kodunu cümleye çeviren, her zaman görünür bir şerit; ardından verify
  komutları (hatadan sonraki komutlar `not run` olarak işaretlenir, çünkü `runVerify` ilkinde
  durur), çıktı kuyruğu, değişen dosyalar ve koşu ortamı için katlanabilir paneller. Beşi de
  `data-pk` anlık görüntüsüyle canlı yenilemelerde açık/kapalı durumunu korur — önceki tek-panel
  yaklaşımı dört yeni paneli 600 ms'de bir çarpar ve 3.15.2'nin flicker düzeltmesini bozardı.
- **`GET /api/worker/<id>/diff`** `verdict-diff.patch`'i (yoksa `diff.patch`) `nosniff` ile
  `text/plain` olarak servis eder, `readHead` ile 512 KB'da sınırlar, gerçek boyutu ve kırpılmayı
  response header'larında bildirir. Aday yolları `WORKERS_ROOT + id`'den **yeniden hesaplar** ve
  `verdict.diffPatchPath`'i asla okumaz: o alan, beş harici worker CLI'sinin yazdığı bir dosyadan
  gelen absolute path'tir; izlemek "session dizinine yazabilen herhangi bir dosyayı okur"
  primitifi olurdu. Bir test bunu sabitler.
- **`verify-fail` filtre çipi.** Her verify hatasının `state`'i `"done"` olduğu için `done` çipinin
  içinde saklanıyor; yaşam döngüsü çipleri bunu yapısal olarak ifade edemiyor.
- **Workers boş durumuna run özeti**, listenin zaten çektiği satırlardan client tarafında
  türetilir (yeni endpoint yok, dolayısıyla çip sayımlarıyla asla çelişemez):
  `runs 13 · verify ✓ 6 · ✗ 5 · none 2`, artı herhangi bir koşu bir worktree'de commit'lenmemiş
  değişiklik kaydettiyse ⚙ Bakım'a işaret eden bir satır.
- **Artık kalmış worktree listesi** — yeni `GET /api/clean?worktrees=1`, `/tmp` ve `$TMPDIR`'ı
  `*-wt-*` artıkları için tarar ve her birinin backend'ini, yaşını, kirli/temiz durumunu ve
  çözülmüş kaynak repo'sunu bildirir; ⚙ Bakım panelinde "Clean stale sessions" yanındaki
  **Leftover worktrees** butonuyla yüzeye çıkar. **Tasarım gereği salt-okunurdur — silme butonu
  yoktur**: `cli-dispatch-clean`'in süpürmesi commit'lenmemiş değişiklik içeren bir worktree'yi
  bilinçli olarak asla kaldırmaz (`commands/clean.md`) ve kirli worktree tam olarak başarılı bir
  koşunun geride bıraktığı şeydir (runner commit etmez); yani hiçbir otomatik iş bunları
  temizlemeyecek ve şimdiye kadar hiçbir yüzey de bildirmiyordu. Yalnız elle bulunabilirlerdi.
  Panel her biri için kopyalanabilir bir `git worktree remove` komutuyla listeler ve kararı
  insana bırakır; yalnızca worktree'ye *benzeyen* bir dizin durumunu temiz değil bilinmeyen
  olarak bildirir, böylece güvenle silinebilir sanılamaz.
- **`public-page.test.mjs`** — dashboard'ın 764 satırlık client SPA'sını kapsayan ilk test. Her
  inline `<script>`'i tarayıcının yaptığı gibi derler (CHANGELOG 3.15.2 böyle bir testin tüm
  sayfayı bozan bir template-literal kaçışını yakaladığını söylüyor, ama hiç commit'lenmemişti),
  SPA'yı sahte bir DOM'a karşı değerlendirip saf fonksiyonlarını test eder ve kaçış kurallarını
  düşmanca fixture'larla sabitler. 3.15.2'nin tam hatası yeniden enjekte edilerek boş olmadığı
  doğrulandı: süit yeşilden 8 hataya düşüyor. Bu sürüm yazılırken üç gerçek kaçış hatası yakaladı.

### Değişti

- **`killed` ve `stale` artık hata olarak raporlanmıyor.** `workerBucket`'ın catch-all'ı 5.
  enum state'i `killed`'ı `error` kovasına gönderiyordu — fonksiyonun kendi yorumunun
  `human-controlled` için bir kez düzeltildiğini kaydettiği hatanın aynısı — ve `stale`'i `error`'a
  katıyordu, bu da bayat bir worker'ı hata listesini taramak dışında bulunamaz kılıyordu. İkisi de
  kendi kovasına, nokta rengine ve filtre çipine kavuştu; *ölen* bir worker yeni kırmızı `.dead`
  noktasını alırken `killed` amber kalıyor. Catch-all artık açık bir `unknown` kovası, böylece
  sonradan eklenen 6. bir state hataya iftira edilmek yerine bilinmeyen olarak görünür.
- **Verify hatası worker state'inden ayrı bir eksende sunuluyor** ve runner'ın exit kodu çıplak
  sayı olarak değil, cümleye açılıp sahibine atfedilerek gösteriliyor. Exit 124/126/127 bozuk bir
  *koşum ortamı* olarak bildirilir, işin başarısızlığı olarak değil. `verify: null` olan bir koşu
  `no verify requested` der ve asla yeşil tik almaz.
- **Worker satırından `from <parent session>` ve ayrı proje satırı çıktı.** İlki babysitter dönemi
  provenansıydı ve `/api/workers`'ın en pahalı alanıydı; ikincisi bir koşuda `tmp/ds-wt-oUSONx`
  render ediyordu, yani repo değil atılacak worktree. Parent-session bağlantısının kendisi
  **değişmedi** ve tam olarak gösterilmeye devam ediyor — yalnızca detay route'una taşındı. Sonuç:
  120 gerçek session'da **`/api/workers` 4480 ms → 36 ms**.
- **`normalizeBackend` `parse-utils.mjs`'e taşındı** (`verdict-writer.mjs`'ten re-export edilir).

### Kaldırıldı

- **Babysitter muhasebesi, tümüyle** — "Babysitter cost" paneli, 4x "high overhead" rozeti,
  `parentSession.babysitterUsage`, hiç okunmayan `parentSession.subagentId` ve bunları üreten
  subagent taraması. 4.0.0 sonrası onaylı yolda `babysitterUsage` her zaman `null` olduğu için
  rozet hiç ateşlenmiyordu; ateşlendiğinde ise alakasız bir subagent'ın tüm token kullanımını
  worker'a faturalıyordu, çünkü eşleşme worker id'sinin transcript metninde substring aramasıydı.
  **Worker → parent Claude Code session bağlantısı ve `linkedWorkers` paneli KALDIRILMADI** —
  yalnız üzerine monte edilmiş muhasebe kaldırıldı.
- Bu kaldırma sunucudaki en pahalı I/O'yu da götürüyor: eşleşen her subagent transcript'inin her
  satırı için 4 MB `readTail` + `JSON.parse`, SSE ile yenilenen `/api/workers` yolunda, canlı bir
  transcript'e her yazımda yeniden ödenerek.

### Düzeltildi

- **`POST /api/clean` kimlik doğrulaması olmadan özyinelemeli silme yapıyordu.** Bayat session
  dizinlerinde hiçbir auth kontrolü olmadan `fs.rmSync(recursive, force)` çağırıyordu, oysa aynı
  sunucudaki `POST /api/config` Origin + Host + özel header kapısını doğru şekilde istiyordu.
  `readBody` `Content-Type`'ı yok saydığı için, kullanıcının açık olan herhangi bir sayfası
  `text/plain` (CORS-simple, preflight yok) ile `{"staleSecs":1}` gönderebilir — ki bu bir saniye
  sessiz kalan her çalışan worker'ı kapsar — ve transcript'ini, prompt'unu ve kurtarma diff'ini
  silebilirdi. Artık aynı şekilde kapılı; `GET /api/clean` yalnız listelemeye devam ediyor. Test
  iddiasını status kodu üzerinde değil dosya sistemi üzerinde kuruyor.
- **`readBody`'nin 64 KB sınırı hiçbir şeyi sınırlamıyordu.** Sınırı aşınca promise'i reject
  ediyor ama `data` dinleyicisini sökmüyordu, buffer isteğin sonuna kadar büyümeye devam ediyordu.
  Artık isteği destroy ediyor.
- **Koşu ortasındaki token anlık görüntüsü artık toplam gibi sunulmuyor.** `status.usagePartial`
  dashboard'da sıfır kez geçiyordu, dolayısıyla öldürülmüş bir worker'ın anlık görüntüsü
  `51.7k in / 0 out` olarak render ediliyordu — satış argümanı token muhasebesi olan bir üründe
  belirli bir yanlış sayı. Kısmi sayımlar artık etiketleniyor.
- **Kimlik doğrulama hatası artık genel kırmızı hata olarak gösterilmiyor.** `errorKind: 'auth'`
  worker'ın hiç başlamadığı anlamına gelir; prompt, model veya repo suçsuzdur — ve yönlendirdiği
  akışın hiç adımı yoktur. Artık amber `auth` rozeti ve `/cli-dispatch:doctor` ile ⚙ yapılandırma
  görünümüne işaret eden bir panel alıyor.
- **Açık detay görünümü bir verdict'i asla göstermezdi.** `watchDetail`, worker `done` bildirdiği
  anda aboneliği kesiyor — ki bu, `cli-dispatch-run`'ın verify'ı koşmasından (600 s'ye kadar) ve
  `verdict.json`'ı yazmasından *önce*. Yordam artık verdict beklemedeyken de akışı açık tutuyor;
  bekleme, runner'ın verify başlamadan önce oluşturduğu `verdict-diff.patch` işaretinden saptanır.
- **`stranded` artık uyarı olarak sunulmuyor.** `.specs/dev/sdd/deterministic-runner.md`,
  `stranded: true`'yu normal başarılı bir koşunun *beklenen* değeri olarak tanımlıyor — runner asla
  commit etmez, dolayısıyla commit'lenmemiş değişiklik worker'ın işini yaptığı anlamına gelir — ve
  gerçek bir makinedeki 9 stranded verdict'in 4'ü verify'ı geçmişti. Detay görünümü bunu zaman
  damgasıyla, koşu sonunda kaydedilmiş bir olgu olarak belirtir ve temizlik komutunu **yalnız**
  canlı bir `stat` worktree'nin hâlâ var olduğunu doğrularsa sunar; parent repo'yu worktree'nin
  kendi `.git` işaretçisinden çözer (session dizininde hiçbir yerde kayıtlı değildir). Worktree
  gitmişse bunu söyler, var olmayan bir dizini silmeni istemek yerine.
- **Bozuk veya hatalı bir `verdict.json` artık geçmiş gibi okunamıyor.** `cli-dispatch-run`,
  `build-verdict` fırlattığında `{schemaVersion, error, sessionId, exitCode}` şekli yazar; oradaki
  `exitCode` 0-5 sözleşme değeri değil bir *node exit kodudur*. Parse edilemeyen JSON ve bilinmeyen
  bir gelecek `schemaVersion` aynı şekilde ele alınır. Üçü de `malformed` + `unknown` olarak
  yüzeye çıkar ve bozuk bir dosya yanındakileri zehirleyemez.
- **Dokümanlar düzeltildi:** dashboard `dashboard-server.mjs` banner'ında, başlangıç satırında,
  `commands/dashboard.md`'de ve iki README'de "read-only" diye tanıtılıyordu; bu iki bakımdan
  yanlıştı — `POST /api/clean` dizin siler, `POST /api/config` API key'leri diske yazar.
  `CLAUDE.md`'nin session-dir sözleşmesi hiç sahip olmadığı `verdict.json` maddesini (iki tuzağıyla
  birlikte) ve `changed-files.json`'ın `preexistingDirty` alanını kazandı.

## [4.2.1] — 2026-07-25

Denetim takibinin ikinci turu: tasarım kararı gerektirmeyen bulgular. Kalanlar #122
(muhasebe semantiği), #123 (cross-platform eşikler), #124 (guard kapsamı), #125 (ölü kod)
issue'larında takip ediliyor.

### Düzeltildi

- **Statusline `▶N` ölü worker'ları sayıyordu.** `cli-dispatch-statusline.sh`,
  `state: running`'i canlılık sanıyordu; çöken bir worker `cli-dispatch-clean` süpürene
  kadar hayalet bir `▶1` gösteriyor — ve rozetin görünmesinin tek nedeni bile bu
  olabiliyordu. Artık repo'nun geri kalanının kullandığı bayatlık sinyalini uyguluyor
  (status.json mtime, 90s), BSD/macOS ve GNU için taşınabilir `stat` işleyişiyle.
- **`install.ps1` API key tutan config'i herkese okunur bırakıyordu.** `install.sh` bunu
  `umask 077` + `chmod 600` ile koruyor; PowerShell kurucusu düz `Set-Content` ile
  yazıyordu. Artık ACL kalıtımını kırıp yalnız mevcut kullanıcıya FullControl veriyor;
  best-effort (ACL hatası kurulumu düşürmek yerine uyarı basıyor).
- **Çalışma zamanında basılan artık `*-runner.md` referansları.** `oc-stream`/`cp-stream`
  her worker koşusunda kullanıcıyı silinmiş dosyalara yönlendiriyordu; `install.sh` da her
  kurulumda "zero-token polling for *-runner subagents" reklamı yapıyordu.
  `oc-agent`/`cp-agent` yorumlarından da temizlendi.

### Değiştirildi

- **`CLAUDE.md` envanteri düzeltildi** — plugin'in "subagent definitions" gönderdiğini
  iddia etmeye devam ediyordu (4.0.0'da silindi) ve `hooks/`, `cli-dispatch-run`,
  `cli-dispatch-gain`, `cli-dispatch-statusline.sh`'ı atlıyordu. Bu dosya her oturuma
  yüklendiği için yanlış envanter doğrudan ajan davranışına sızıyor. Cross-platform
  eşleşme kuralı artık bilinçli statusline istisnasını da kaydediyor ve paritenin bir
  *davranış* kuralı olduğunu not ediyor (4.2.0 üç sessiz `.ps1` kaymasını düzeltti).
- **`TERMINAL.md`** artık tümüyle atladığı backend-agnostik araçları belgeliyor —
  `cli-dispatch-run` (delegasyon yolu) bir kez bile anılmıyordu.
- **`commands/setup.md`** — bayat "question 4" referansı (üç soru var) ve hook'u yalnız
  yeni/resume/clear oturumlarında tetikleniyor gibi tanıtan kullanıcıya dönük metin
  düzeltildi (4.1.3 `compact` ve `fork`'u ekledi).
- **README kaldırma adımı** (EN + TR) artık kurucunun kurduğu şeyleri gerçekten siliyor —
  kendini "tam temizlik" diye sunarken ~18 ikiliden 2'sini listeliyordu.
- `.specs/dev/sdd/policy-injection.md` düzeltildi: eksik `enabled` alanının `true`
  varsayıldığını söylüyordu, oysa implementasyon fail-closed davranıyor. Kod doğru,
  spec değildi.

### Eklendi

- `policy-inject.test.mjs` test 2b — eksik/boolean-olmayan `enabled` alanı için fail-closed
  sözleşmesini sabitliyor; daha önce test edilmiyordu (ve yukarıdaki spec tersini
  söylüyordu).

## [4.2.0] — 2026-07-25

4.0 sonrası kod tabanının salt-okunur tam denetiminden çıkan bulgular. Bu sürüm doğruluk
hatalarını düzeltiyor; kalan bulgular issue olarak takip ediliyor.

### Düzeltildi

- **Windows'ta `--resume`'a hiçbir giriş yolu yoktu.** `cli-dispatch-run.ps1`'in
  prompt-zorunlu kontrolünde `$Resume` muafiyeti yoktu; `--resume <id>` orada (exit 5),
  `--resume <id> --prompt …` ise sonraki "resume prompt alamaz" kapısında ölüyordu —
  üçüncü bir yol yoktu. Bash ikizi hep doğruydu
  (`[ -z "$RESUME" ] && [ -z "$PROMPT$PROMPT_FILE" ]`); `.ps1` kontrolü artık ona uyuyor.
- **İki PowerShell worktree runner'ında `git worktree add` hataları sessizce yutuluyordu.**
  `ds-`/`cx-worktree-run.ps1` hem exit kodunu hem hata çıktısını (`2>$null`) atıyordu;
  başarısız `add` sonrası script devam ediyor ve worker var olmayan/yanlış dizinde
  koşuyordu — teslimatı sessizce kayboluyordu. İkisi de artık taze bir yolla bir kez
  retry ediyor (bash ikizleriyle aynı) ve o da başarısızsa teşhis mesajıyla sert biçimde
  hata veriyor.
- **Çöken bir `run-verify`, geçen bir verify gibi raporlanabiliyordu.** `verdict.json`
  escalation path'in tek veri kaynağı; ama `run-verify` çağrısı `set -e` altındaydı, yani
  node seviyesinde bir çökme hiç verdict yazılmadan script'i öldürüyordu. Naif düzeltme
  daha kötüsünü yapardı: `build-verdict`'in `readJson()`'ı parse hatasını yutup `{}`
  döndürüyor, bu da `exitCode: 0`'a eşleniyor — yani okunamayan bir verify dosyası
  **başarı** olarak okunurdu. Runner artık **fail-closed** davranıyor: sonucun bilinmediğini
  söyleyen açık bir verify hatası üretiyor. `cli-dispatch-run.ps1`'e de bash ikizinde zaten
  bulunan boş-verdict fallback'i eklendi.

### Eklendi

- **`__tests__/cli-dispatch-run-verify.test.mjs`** — `--verify` → `verdict.json` bağlantısı
  için altı uçtan uca test; bu yol daha önce kapsam dışıydı (yalnız altındaki motor test
  ediliyordu). Seam olarak `--resume` kullanılıyor: tohumlanmış bir oturuma yeniden
  bağlanmak, worker başlatmadan gerçek verify → verdict yolunu sürüyor. Yukarıdaki
  fail-closed davranışı için regresyon testi de dahil; mutasyonla doğrulandı (fix geri
  alındığında test 4 düşüyor).

## [4.1.3] — 2026-07-25

### Düzeltildi

- **Enjekte edilen delegasyon politikası artık auto-compaction'dan ve oturum
  fork'larından sağ çıkıyor** (#118). `hooks/hooks.json`, `policy-inject.mjs`'i yalnız
  `startup`/`resume`/`clear`'a bağlıyordu; uzun bir oturumun sıkıştırması
  `[cli-dispatch policy]` bloğunu context'ten sessizce düşürüyordu — tam da delegasyon
  kararlarının en yoğun olduğu pencerede — ve `/fork`/`/branch` oturumları politikasız
  başlıyordu. `compact` ve `fork` `SessionStart` matcher'ları da bağlandı. Birikme yok:
  sıkıştırma eski kopyayı düşürür, hook tazesini enjekte eder — context başına net bir
  canlı kopya. README'ler güncellendi (eski "bilinçli olarak compact hariç" gerekçesi
  emekli edildi).

## [4.1.2] — 2026-07-25

### Düzeltildi

- **`cli-dispatch-run.ps1` cleanup guard'ı artık yolları git ile kanonikleştiriyor**
  (PR #111'den taşındı). `--cleanup-if-clean` kemeri yolları yalnız .NET ile
  çözümleyip karşılaştırıyordu — `GetFullPath` sadece string'i normalize eder,
  `ResolveLinkTarget`/`.Target` yalnız SON bileşenin link'ini takip eder; dolayısıyla
  symlink'li bir *üst* dizin (`/var` → `/private/var`, junction'lı sürücü kökü) hâlâ
  eşitsiz karşılaştırılıyor ve guard çağıranın `--cwd`'sini yanlış değerlendirebiliyordu.
  Çözümleyici artık önce git'e soruyor (`git -C <p> rev-parse --show-toplevel`, iki taraf
  için aynı yazım), .NET adımlarına geri düşüyor. `cx-`/`ds-worktree-run.ps1` yorumları,
  `Resolve-RealPath`'in gerçekte ne garanti ettiğini söyleyecek şekilde düzeltildi.

### Değiştirildi

- `TERMINAL.md` yenilendi (yine PR #111'den): açıkça DeepSeek wrapper'larına
  kapsamlandı, legacy yol bahisleri kırpıldı, worktree açıklaması düzeltildi
  (`origin/main` değil, repo'nun mevcut durumu baz alınıyor).

## [4.1.1] — 2026-07-24

### Değiştirildi

- **Dokümanlar yenilendi ve sadeleştirildi.** `README.md`/`README.tr.md`: beş
  backend'in ayrı kurulum paragrafları tek karşılaştırma tablosuna (CLI/auth/model
  seçimi) indirildi, worktree/sandbox açıklaması "Güvenlik ve veri" altında tekleşti,
  `[CD]` statusline rozeti belgelendi (yeni bölüm + Özellikler maddesi) ve eksik olan
  `/cli-dispatch:run` / `wait` / `gain` satırları Kullanım tablosuna eklendi.
  `skills/ds-delegate/SKILL.md`: neredeyse özdeş dört backend bölümü tek "Other
  backends" bölümü + farklar tablosunda birleştirildi (−%27 uzunluk, bilgi kaybı yok);
  Komutlar listesine eksik yedi komut eklendi. `help.md`: `/cli-dispatch:run` satırının
  etiketi "Escalation:"dan "Runner:"a düzeltildi, eksik `wait` satırı ve tek satırlık
  `[CD]` rozet notu eklendi.

### Düzeltildi

- README'lerde deterministik-runner bölümüne giden, öteden beri bozuk anchor
  (`#deterministic-runner-clidispatchrun--no-llm-babysitter` →
  `#deterministic-runner-cli-dispatchrun--no-llm-babysitter`) — gerçek
  `github-slugger` algoritmasıyla doğrulandı.

## [4.1.0] — 2026-07-24

### Eklendi

- **Statusline rozeti (`[CD]`)** — yeni `scripts/cli-dispatch-statusline.sh`, bir
  statusline *fragment'i* (caveman'inkiyle aynı desen): birleştirici
  `~/.claude/hooks/statusline.sh` sarmalayıcısı statusline stdin JSON'unu ona da
  boru'lar ve çıktısını ekler. cli-dispatch aktifken (policy injection açık ya da ≥1
  worker koşuyorken) camgöbeği `[CD]` rozeti, N worker oturumu koşarken de sarı `▶N`
  sayacı basar; pasifken hiçbir şey basmaz. Yalnızca minik `status.json` dosyalarını
  okur (asla `transcript.jsonl` değil), statusline için ucuz kalır. Bağlama, sarmalayıcıya
  tek bir glob satırı eklemekten ibaret (script başlığında belgeli); fragment plugin
  cache'inde gelir, ekstra kurulum yok. Şimdilik yalnız Unix statusline kurulumları.

## [4.0.0] — 2026-07-24

### Kaldırıldı

- **KIRICI: beş LLM babysitter runner subagent'ı emekliye ayrıldı** (#114) —
  `ds-runner`, `ag-runner`, `cx-runner`, `oc-runner`, `cp-runner` (`agents/*-runner.md`)
  silindi. Gerçek bir iş istasyonunda 604 runner agent üzerinde ölçüldü: babysitter
  transcript'leri, worker'ların kendi çıktısının ~9 katı Anthropic token'a mal oluyordu
  (~7,1M babysitter output'a karşı ~785k worker output) — model haiku'ya pinlenmişken
  bile — ve plugin'in token tasarrufu amacını boşa çıkarıyordu. Delegasyonun artık tam
  iki şekli var:
  - **Makine-doğrulanabilir kontrolü olan mekanik iş** → deterministik runner
    (`/cli-dispatch:run <backend> "<görev>" --verify '<komut>'`) — worker + worktree
    izolasyonu + verify + `verdict.json`, sıfır Anthropic token.
  - **Verify komutu yok ya da verify başarısız** → *escalation path*: orkestratör
    kompakt verdict'i + diff'i kendisi okur ve `/cli-dispatch:resume` ile devam eder.
    Maliyet her koşuda değil, yalnızca hata/belirsizlik anında doğar.
- `install.sh`/`install.ps1`'in yazdığı `policy.json` iskeletinden ve
  `/cli-dispatch:setup`'ın politika sorularından `runners` alanı çıkarıldı. Mevcut
  `policy.json` dosyaları çalışmaya devam eder — `policy-inject.mjs` eski `runners`
  dizisini sessizce yok sayar (geriye uyumluluk, schemaVersion 1 olarak kalır).

### Değiştirildi

- Oturuma enjekte edilen politika artık yargı-ağır işi runner subagent'lara yönlendirmek
  yerine escalation path'i öğretiyor ("verdict'i + diff'i kendin oku,
  `/cli-dispatch:resume` ile devam et").
- Dokümanlar (`README.md`, `README.tr.md`, `CLAUDE.md`, `skills/ds-delegate/SKILL.md`,
  komut referansları) deterministik runner + escalation modeline göre yeniden yazıldı;
  demo betiğinin runner sahnesi artık `/cli-dispatch:run` gösteriyor.
- `/cli-dispatch:gain`'in Anthropic babysitting bölümü eski runner oturumlarını
  raporlamaya devam ediyor — muhasebe değişmedi, tarihsel oranlar görünür kalıyor.

## [3.44.0] — 2026-07-19

### Eklendi

- **Yerinde (in-place) worktree modu** (#108, #109). `--cwd` *zaten* bir linked git
  worktree ise runner artık iç içe `/tmp/<backend>-wt-*` worktree açmıyor — worker'ı
  doğrudan çağıranın verdiği dizinde çalıştırıyor. Tespit `git-dir != git-common-dir`
  ile yapılıyor; ana checkout verildiğinde her zamanki izole worktree açılmaya devam
  ediyor. `CLI_DISPATCH_NO_IN_PLACE=1` eski davranışa zorlar.
- **Her brief'e bir çalışma-dizini sözleşmesi ekleniyor** (#109). Worker'lar,
  kontrolü *düzenledikleri* ağaçta değil *başlatıldıkları* ağaçta koşup dokunulmamış
  orijinalleri lint'ledikten sonra "ruff check: all checks passed" raporladı. Artık
  her brief worker'a şunu söylüyor: önce `pwd` çalıştır, her doğrulama komutunun
  başına açıkça `cd <o dizin> &&` koy, her iddia ettiğin sonucun yanında dizini de
  raporla ve kendi öz-raporunu bağlayıcı sayma — tek kapı çağıranın `--verify`
  zinciri. Çağıranın `--prompt-file` dosyası asla yerinde değiştirilmiyor (kopya
  yazılıyor); `CLI_DISPATCH_NO_CWD_CONTRACT=1` devre dışı bırakır.

### Düzeltildi

- **`--backend cx` (ve `ag`/`oc`/`cp`) linked worktree'yi "Not a git repo" sayıyordu**
  (#107). Linked worktree'de `.git` bir *dosya*, dizin değil; dolayısıyla
  `test -d "$REPO/.git"` kontrolü iş hiç başlamadan düşüyordu. Beş bash runner'ın
  tamamı ve iki PowerShell ikizi artık git'e soruyor — `git rev-parse
  --is-inside-work-tree` — bu aynı zamanda submodule'leri de doğru ele alıyor. (`ds`
  daha önce `test -e`'ye çekilmişti; artık diğerleriyle aynı kontrolü kullanıyor.)
- **`--cwd <worktree>` her koşuda "worker leaked NEW changes outside the worktree"
  ile hatalı fail veriyordu** (#108). Worker, brief'indeki mutlak yolları izleyip
  doğru şekilde hedef worktree'ye yazıyordu — ve post-check bunu leak sayıp exit 1
  veriyordu; exit code kullanılamaz hâle geliyordu (raporlanan bir oturumda 4/4
  koşuda). Yerinde modda leak koruması artık **ana checkout**'u izliyor, çağıranın
  worker'a yazmasını açıkça istediği dizini değil.
- **Cleanup artık çağıranın verdiği `--cwd`'ye dokunamıyor** (#108).
  `--cleanup-if-clean` artık birbirinden bağımsız iki kemer kullanıyor — runner'ın
  kendi `>>> cli-dispatch: in-place=1` işareti (gerçekte seçtiği mod) ve `--cwd` ile
  çözümlenmiş yol karşılaştırması — ve dizini olduğu gibi bırakıyor; runner yalnızca
  kendi oluşturduğu worktree'leri siliyor.

### Güvenlik / sağlamlık

- **Miras alınan `GIT_DIR`/`GIT_WORK_TREE` artık repo tespitini ele geçiremiyor.** Git
  hook'ları, `git rebase --exec` ve herhangi bir üst git süreci bunları export eder ve
  bunlar `git -C <yol>`'u geçersiz kılar — yani her kontrol *miras alınan* repoyu
  tarif ederdi. En kötü senaryoda bir **ana checkout** linked worktree sanılıp
  worker'a hiç izolasyon olmadan kullanıcının kendi checkout'u veriliyordu. Yedi
  runner da ilk git çağrısından önce `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`,
  `GIT_COMMON_DIR`, `GIT_OBJECT_DIRECTORY` ve `GIT_NAMESPACE`'i temizliyor.
- **Bare repo'lar ve `.git` yönetim dizinleri artık içinde çalışılmak yerine
  reddediliyor.** `git rev-parse --is-inside-work-tree` ikisi için de exit 0 verip
  *çıktı olarak* `false` yazıyor; kontrol artık exit status'e değil çıktıya bakıyor.
- **Ana checkout `git worktree list --porcelain` ile bulunuyor**,
  `dirname(git-common-dir)` ile değil — ikincisi `--separate-git-dir` yerleşimlerinde
  ve bare repo worktree'lerinde yanlış; ya leak korumasını sessizce devre dışı
  bırakıyor ya da onu alakasız bir üst repoya yöneltiyordu (bu da `$HOME`'u
  snapshot'layıp her koşuyu fail ettiriyordu).
- **Leak patch'i artık temp dizine yazılıyor**, korunan reponun yanına değil — orası
  runner'ın sahibi olmadığı bir dizin (yerinde modda çoğu zaman kullanıcının tüm
  repo klasörü).
- **Yerinde mod işareti artık stderr'e basılıyor** — `cli-dispatch-run`'ın gerçekten
  yakaladığı akış (`2>&1 >/dev/null | tee`); stdout'ta atılıyor ve primary cleanup
  kemeri ölü kod kalıyordu. PowerShell runner'ları aynı nedenle
  `[Console]::Error.WriteLine` kullanıyor (`Write-Host` host akışına yazar, hiç
  yakalanamaz).
- **`--post-check` normal koşuyla hizalandı**: aynı bare-repo/`.git` kontrolü, aynı
  temp-dizin patch konumu.
- Yerinde mod, hedef worktree'de zaten kaç commit'lenmemiş değişiklik olduğunu
  raporluyor; böylece okuyan kişi `verdict-diff.patch`'in worker'a ait olmayan iş
  içerebileceğini görebiliyor.
- Yerinde mod artık `--branch` verilip yok sayıldığında bunu söylüyor; PowerShell
  ikizleri `git < 2.31` için `--path-format` fallback'i, symlink/junction/8.3 farkında
  yol çözümlemesi (`[System.IO.Path]::GetFullPath` yerine `Get-Item`) ve bash ikizinin
  `--resume` + prompt reddini kazandı (önceden Windows'ta `--resume`, içinde yalnızca
  sözleşme metni olan bir geçici brief oluşturuyordu).

### Dokümantasyon

- `/cli-dispatch:run` yerinde modu belgeliyor ve bir "Writing a good `--verify`"
  bölümü kazanıyor: worker öz-raporları kapı değildir ve Python taşıma/refactor
  delegasyonlarına `ruff check --select F821 <hedef>` eklenmelidir — gövde taşıma
  sadakati ile import sadakati birbirinden bağımsız olarak bozulur (#109).

### İç değişiklikler

- Yeni `__tests__/worktree-in-place.test.mjs` (17 senaryo): beş backend'de linked
  worktree kabulü, yerinde modda worker cwd'si, hedefe yazmanın leak sayılmaması,
  ana checkout leak'inin hâlâ yakalanması, worktree listesinin değişmemesi, eski
  yolun korunması, iki env kaçış kapısı, iki cleanup koruması, `GIT_DIR` hijack'i,
  bare-repo ve `.git`-dizini reddi, patch dosyasının konumu ve `--prompt-file`
  değişmezliği. Düzeltme öncesi script'lere karşı 10/17 fail verdiği doğrulandı. Bir
  senaryo, yerinde mod işaretinin `cli-dispatch-run`'ın yakalamasından sağ çıktığını
  doğruluyor — aksi hâlde sevk edilecek olan hata tam da buydu.

## [3.43.5] — 2026-07-17

### Düzeltildi

- **`gain`'in babysitter/worker oranı artık maliyeti abartmıyor.** Numeratör
  eskiden, CLI çağıran her subagent transcript'inde görünen *her* Anthropic
  modelinin output'unu topluyordu; böylece ana-loop `/cli-dispatch:run`
  invocation'larını ve yasak model override'larını (sonnet-5/opus/…), tek meşru
  runner modeli (haiku) ile birlikte sayıyordu — üstelik worker session'ları hiç
  usage raporlamayan backend'lerin (antigravity) babysitting'ini de içeriyordu.
  Gerçek bir makinede bu ~%2500 oran basıyordu; düzeltilen numeratör — yalnızca
  blind olmayan backend'lerdeki pinli-haiku runner'lar — ~%370 raporluyor.
  Numeratör dışı bırakılan output artık kendi satırında gösteriliyor, sayı
  denetlenebilir.
- **`polling instead of cli-dispatch-wait?` satırı sahte alarmdı.** Bir runner 20
  *assistant turn*'ü aştığında tetikleniyordu; oysa runner hem babysitter **hem**
  reviewer'dır — dispatch, tek bloklayan `cli-dispatch-wait` (bir turn), diff
  doğrulama, test çalıştırma, worker iterasyonu ve raporlama, hiç hot-loop olmadan
  kolayca 20 turn'ü aşar. Artık yalnızca bir session `status.json`'unu **doğrudan**
  5'ten fazla okuyan runner'ları sayıyor (`cli-dispatch-wait`'in önleyeceği gerçek
  poll); `cli-dispatch-wait` çağrıları asla sayılmıyor.

### Dahili

- `gain-report.mjs`, import-güvenli saf yardımcılara (`isStatusPollCommand`,
  `backendFromCommand`, `analyzeAgentEvents`, `computeBabysitRatio`) bir
  main-modül guard'ı arkasında bölündü; yeni `__tests__/gain-report.test.mjs` (12
  vaka) ile kapsandı.

## [3.43.4] — 2026-07-13

### Değiştirildi

- **Delegasyon politikası artık her delegasyonu LLM babysitter'a default'lamak
  yerine işin şekline göre route ediyor.** SessionStart politika enjeksiyonu
  (`policy-inject.mjs`) deterministik yolu öne çıkarıyor: makine-doğrulanabilir
  mekanik iş `/cli-dispatch:run <backend> "<task>" --verify '<cmd>'`'a gitmeli
  (sıfır LLM babysitter token'ı), trivial tek-dosya fix'leri inline kalmalı, ve
  LLM `*-runner` subagent'ları yargı-gereken işe (belirsiz kapsam, hiçbir
  komutun doğrulayamayacağı çıktı) ayrılmalı. Gerekçe: `/cli-dispatch:gain`,
  küçük-taneli delegasyonlarda babysitting overhead'inin baskın geldiğini
  gösterdi — deterministik runner zaten vardı (3.38.0) ama politika onu
  atlıyordu. Runner'ların kendisinde davranış değişikliği yok; bu, enjekte edilen
  bağlama yönelik bir routing/rehberlik güncellemesi.

## [3.43.3] — 2026-07-12

### Düzeltildi

- **Çalışan bir Copilot worker'ının mid-run devralınması artık 500 ile
  başarısız olmuyor.** `buildTakeoverCommand` copilot için `meta.threadId`
  zorunlu tutuyordu, ama GitHub Copilot CLI resume `sessionId`'sini yalnızca
  en son `result` event'inde yayıyor — dolayısıyla *çalışan* bir worker'ın tüm
  süresi boyunca `meta.threadId` boş kalıyor, ki devralma tam da o anda oluyor.
  `buildCopilot` artık `threadId` yoksa/boşsa `copilot --continue`'ya
  (en son oturumu resume et) düşüyor, biliniyorsa (ör. bitmiş oturum)
  `copilot --resume <id>`'yi koruyor. `meta.cwd` zorunluluğu değişmedi. Yarış
  uyarısı: `--continue` global olarak en-son copilot oturumunu hedefler;
  metadata yakalama ile devralma arasında başka bir copilot oturumu başlarsa
  yanlış olabilir — tek kullanıcılı yerel dashboard için kabul edilebilir.
  Diğer dört backend etkilenmedi (session id'lerini başta yayıyorlar).
  Çok-backend takeover testinde ortaya çıktı.

## [3.43.2] — 2026-07-12

### Düzeltildi

- **Dashboard canlı listesi, var olan bir oturum dizini içindeki worker
  state geçişlerini artık manuel sayfa yenilemesi olmadan yansıtıyor.** Canlı
  liste SSE'si (`/api/stream?watch=sessions`) `WORKERS_ROOT`'u shallow izliyor;
  yeni bir worker dizini bunu tetikliyordu ama var olan dizin *içindeki* bir
  `status.json` yazımı (devralmada running → `human-controlled`, ya da
  running → `done`) tetiklemiyordu — rozet/filtre yenilemeye kadar bayat
  kalıyordu. Düzeltme: yalnızca state geçişinde `parse-utils.mjs`,
  izlenen kökün doğrudan çocuğu olan `<WORKERS_ROOT>/.cli-dispatch-transitions`
  sentinel dosyasını bump'lıyor ve mevcut shallow watch bunu görüyor.
  `createStatusWriter` (yalnız `status.state` değişince tetiklenir, her ~200 ms
  running flush'ında değil) ile `markTakeoverActive` / `clearTakeoverState`
  (dashboard'un doğrudan tetiklediği devralma geçişleri) içine bağlandı.
  Bilinçli olarak recursive watch değil — o, yüzlerce oturum dizininde her
  `transcript.jsonl` eklemesinde tetiklenip repo'nun transcript-hot-loop
  maliyet modelini bozardı. `listWorkers()` zaten dizin olmayan girdileri
  atladığı için sentinel asla sahte bir worker olarak görünmez.

## [3.43.1] — 2026-07-12

### Değiştirildi

- **Config şablonları ve dökümanlardaki örnek model ID'leri, kurulu işçi
  CLI'lara ve sağlayıcı dokümanlarına karşı canlı doğrulandı, bayat olanlar
  güncellendi.** Antigravity (`agy models` canlı çıktısı) ve DeepSeek
  (api-docs.deepseek.com) örnekleri kontrol edildi ve zaten doğru bulundu —
  bu iki backend için değişiklik gerekmedi.
- **Codex:** `~/.codex/models_cache.json` (Codex'in kendi API'sinden çekilen
  canlı katalog), `gpt-5.5`'in üzerinde öncelikli yeni bir
  `gpt-5.6-sol` / `gpt-5.6-terra` / `gpt-5.6-luna` ailesi gösteriyor;
  `gpt-5.2` ve `gpt-5.3-codex` katalogdan tamamen düşmüş. `scripts/install.sh`
  ve `scripts/install.ps1`'deki `CX_MODEL` örnek yorum satırı,
  `commands/cx-run.md`'deki model listesi paragrafı,
  `skills/ds-delegate/SKILL.md`'deki "Model selection" bloğu, `README.md` ve
  dashboard'un `scripts/public-page.mjs` içindeki `dl_CX_MODEL` /
  `dl_CX_MODELS` datalist'leri güncellendi (üç yeni seçenek eklendi).
- **OpenCode:** canlı `opencode models openrouter` (343 model),
  `google/gemma-4-31b-it:free`'nin hâlâ geçerli olduğunu ama
  `deepseek/deepseek-v4:free` ve `meta-llama/llama-4.1-8b-instruct:free`'nin
  artık katalogda olmadığını doğruluyor. `commands/oc-run.md`'deki bu iki
  bayat örnek `meta-llama/llama-3.3-70b-instruct:free` ve
  `qwen/qwen3-coder:free` ile değiştirildi.
- **GitHub Copilot:** `copilot --help`, `gpt-5.4` ve `auto`'yu doğruluyor;
  `gpt-5.2` doğrulanamadı. `scripts/install.sh`'daki `CP_MODEL` örneği
  `gpt-5.2`'den `gpt-5.4`'e değiştirildi ve `scripts/public-page.mjs`'deki
  `dl_CP_MODEL` / `dl_CP_MODELS` datalist'lerinden `gpt-5.2` tamamen
  kaldırıldı.

## [3.43.0] — 2026-07-12

### Eklendi

- **Oturum-başı politika enjeksiyonu (opt-in, varsayılan kapalı).** Yeni bir
  plugin `SessionStart` hook'u (`hooks/hooks.json` → `scripts/policy-inject.mjs`,
  saf `node` — hook `command` alanı platforma göre dallanamadığından bilinçli
  olarak bash/`.ps1` ikizi yok) her yeni/resume/clear edilen oturuma
  `hookSpecificOutput.additionalContext` ile kompakt (~60 kelime) cli-dispatch
  delegasyon politikasını enjekte ediyor. `compact` matcher'ı bilinçli olarak
  dışlandı — uzun oturumlarda enjeksiyon birikmesin. Tercihler
  `~/.config/cli-dispatch/policy.json`'da (`enabled`, `runners`,
  `issueReminder`, `claudeMdBlock`, `schemaVersion`); dosya yok/bozuk,
  `enabled:false` veya gelecekteki bir `schemaVersion` → sessiz no-op (boş
  stdout, exit 0 — oturum başlatma asla engellenmez). `runners` değerleri
  bilinen beş runner adına karşı whitelist'leniyor; bilinmeyen string'ler
  sessizce düşüyor, context'e asla interpolate edilmiyor.
  `__tests__/policy-inject.test.mjs` ile kapsanıyor (12 test, subprocess
  entegrasyonu dahil).
- **`/cli-dispatch:setup` adım 7 artık politikayı yapılandırıyor** — dört
  tercih sorusu (enjeksiyon aç/kapa / runner önceliği / issue hatırlatması /
  statik CLAUDE.md bloğu), `policy.json`'ı idempotent yazıyor ve eski
  `<!-- cli-dispatch:orchestration-priority -->` CLAUDE.md marker'ını yerinde
  `<!-- cli-dispatch:policy:v1 -->`'e migrate ediyor (bul-ve-değiştir, asla
  silme). Hook ve CLAUDE.md bloğu birlikte açılırsa çift-enjeksiyon uyarısı
  veriliyor; `/cli-dispatch:doctor`'a `── Policy injection ──` bölümü eklendi —
  `policy.json` durumu, plugin paketindeki `hooks/hooks.json` varlığı
  (cache-staleness sinyali) ve sonradan oluşan çift-enjeksiyonu raporluyor.
- **Installer: `--policy-injection <on|off>` / `-PolicyInjection` ve
  `--non-interactive` / `-NonInteractive` bayrakları.** `on`, seçilen
  backend'lerden türetilen `runners` listesiyle bir `policy.json` iskeleti
  yazıyor (mevcut dosya asla ezilmiyor). Config iskeleti backend-başına
  bloklara refactor edildi ve idempotent eksik-satır ekleme geldi
  (`ensure_config_block` / `Ensure-ConfigBlock`, `^KEY=` satırının kendisi
  anahtar — mevcut satırlara, dolu ya da boş, asla dokunulmuyor;
  `__tests__/install-config-block.test.mjs` ile kapsanıyor, 7 test).
  Editör-açma tetikleyicisi "DeepSeek/OpenCode seçili + key boş"tan "config
  taze oluşturuldu veya blok eklendi VE kurulum interaktif"e değişti (açık
  bayrak veya TTY tespiti) — GUI opener yoksa TTY'siz koşuyu askıda bırakacak
  bir TUI editör açmak yerine talimat yazdırılıyor.

## [3.42.0] — 2026-07-11

### Eklendi

- **`/cli-dispatch:clean` artık eski worktree artıklarını süpürüyor.**
  `/tmp`/`$TMPDIR` (Windows'ta `$env:TEMP`) altında terk edilmiş cli-dispatch
  worktree'leri (`ds-wt-*`, `ag-wt-*`, `cx-wt-*`, `oc-wt-*`, `cp-wt-*`) bir
  eşikten (`--worktree-days N`, varsayılan 3; `--skip-worktrees` devre dışı
  bırakır) eski olunca siliniyor. Dirty worktree'ler (commit edilmemiş
  değişiklik) ASLA silinmiyor — raporlanıp atlanıyor; bozuk/git-olmayan
  `*-wt-*` dizinleri de öyle. Silme sonrası kaynak repo (worktree'nin `.git`
  gitdir işaretçisinden çözümlenir) best-effort `git worktree prune` alıyor.
  `cli-dispatch-clean`, `.ps1` ikizi ve `commands/clean.md`'nin her iki
  fenced bloğunda uygulandı; minimal-PATH launchd/cron/Scheduled-Task
  koşuları için `git` savunmacı şekilde aranıyor.
- **`/cli-dispatch:kill`'in bash bloğu için entegrasyon testleri**
  (`__tests__/kill-flow.test.mjs`, 8 test). Fenced bash `kill.md`'den
  çıkarılıp sahte session dizininde gerçek tek-kullanımlık process
  ağaçlarına karşı sınanıyor: worker.pid tree-kill, terminal-state guard
  (`done`/`human-controlled` atlanır), parser'ın yazdığı terminal `error`'ın
  ezilmemesi, legacy `pgrep` fallback ve hatalı-girdi durumları.

### Düzeltildi

- **`oc-stream`, parser `state: error` bayraklamışken gerçek sıfır-dışı
  çıkış için artık `exitCode: 0` raporlamıyor** — cx-stream'in 3.41.0'da
  aldığı fix'in aynısı: reconcile yine atlanıyor (parser'ın spesifik hata
  mesajı kazanır) ama `meta.json`'daki `exitCode` artık OpenCode'un gerçek
  çıkış koduyla yamalanıyor.
- **`ag-stream`'in preflight/auth bloğu artık kırık
  `$SCRIPT_DIR/parse-utils.mjs` path'ine referans vermiyor.** Gerçek
  kurulumda script `~/.local/bin`'de, `parse-utils.mjs` ise
  `~/.local/share/cli-dispatch/`'te — eski referanslar 3.41.0'da eklenen
  sağlam `PARSE_UTILS` çözümlemesini kullanıyor.
- **Windows watchdog/kill PID çözümlemesi artık deterministik**
  (`claude-ds-stream.ps1`, `cx-stream.ps1`). `Win32_Process` komut-satırı
  substring taraması, wrapper'ın kendi `$PID`'inin doğrudan çocuklarına
  scope'landı — tek ve kesin worker PID'i veriyor; eski sistem-geneli tarama
  yalnız son-çare fallback olarak kaldı. Streaming launch pipeline'ı ve
  `worker.pid` sözleşmesi (wrapper tree-root PID) hiç değişmedi.
- **Windows `changed-files.json` artık önceden var olan kiri worker'a mal
  etmiyor** (`claude-ds-stream.ps1`, `cx-stream.ps1`) — 3.41.0'daki bash
  fix'iyle parite: dirty/untracked path'ler launch öncesi snapshot'lanıyor,
  `files`'tan düşülüyor ve `preexistingDirty` altında kaydediliyor;
  `diff.patch` yine tam working-tree diff'ini taşıyor.
- **Test suite artık cwd'den bağımsız.** Altı test dosyası
  (`ag-transcript-parse`, `cp/cx/ds/oc-stream-parse`, `check-version-sync`)
  fixture/parser path'lerini `process.cwd()`'ye göre çözüyordu; `node --test`
  `plugins/cli-dispatch/scripts/` içinden koşulunca ~20 test kırılıyor ve
  `scripts/plugins/...` çöp ağacı oluşuyordu. Path'ler artık
  `import.meta.url` tabanlı, geçici dizinler `os.tmpdir()` + `mkdtemp`;
  suite her cwd'den yeşil ve repoya hiçbir şey yazmıyor.
- **Dashboard modül-seviyesi cache'leri artık sınırlı**
  (`dashboard-server.mjs`): `parentIndexCache`, `subagentCache` ve
  `sessionTailCache` 500 girdilik ortak bir tavanı en-eski-eklenen atılarak
  paylaşıyor — davranış değişikliği yok, yalnız sınırsız büyüme yok.

## [3.41.0] — 2026-07-11

### Düzeltildi

- **`/cli-dispatch:kill` artık gerçek worker'ı `worker.pid` tree-kill ile
  öldürüyor.** Komut process'leri `pgrep -f "$SID"` ile eşliyordu, ama
  oc/cp/ag worker'ları session id'yi argv'lerinde hiç taşımıyor — yani hiçbir
  sinyal gönderilmezken `status.json`'a sahte bir `killed` yazılıyor ve canlı
  worker token yakmaya devam ediyordu (bitince kaydı ezebiliyordu da).
  `kill.md` artık her `*-stream` wrapper'ının tam bu amaçla yazdığı
  `$DIR/worker.pid`'i okuyor, snapshot'lanmış process ağacının tamamına
  TERM→KILL uyguluyor (`stream-utils.sh`'ın takeover kill deseniyle aynı),
  eski oturumlar için önceki `pgrep` yoluna — artık o da tree-kill yapıyor —
  düşüyor ve `state: killed`'ı yalnızca status hâlâ non-terminal ise
  zorluyor; parser'ın yazdığı terminal `error`/`done` asla ezilmiyor.
- **`cp-stream` cleanup'ı artık native Copilot binary'sini öksüz
  bırakmıyor.** Interrupt yolu tek bir `kill -TERM` ile yalnızca node
  wrapper PID'ini öldürüyordu; child `copilot-darwin-arm64` init'e reparent
  olup sonsuza dek çalışıyordu. `cleanup()` artık diğer tüm backend
  wrapper'ları gibi `stream-utils.sh`'ın tree-kill'ini kullanıyor.
- **Copilot CLI 1.0.70'in stream metni artık düşürülmüyor.**
  `cp-stream-parse.mjs`'in `textFrom()`'u, `assistant.message_delta`
  olaylarının metni taşıdığı `deltaContent` alanını tanımıyordu; canlı çıktı
  `finalText`/`progress.log`'a hiç ulaşmıyordu — kill edilen oturum tüm
  cevabını kaybediyordu. Delta'lar artık mevcut `handleText` yolundan
  birikiyor; final `assistant.message` ekleme yerine üzerine yazıyor, yani
  hiçbir şey çift sayılmıyor. Gerçek 1.0.70 olay şekliyle (final mesajlı ve
  final'sız) yeni birim testlerle kapsandı.
- **Parser `finalize()`'ı reconcile edilmiş terminal state'i artık ezmiyor —
  beş backend'in tümünde.** Kill/timeout sonrası wrapper'ın
  `reconcile_session_error`'ı doğru şekilde `state:"error"` yazıyordu, ama
  parser'ın asenkron stdin-EOF finalize'ı bunu `done`/`exitCode:0` ile
  eziyordu. `finalize()` artık önce diskteki `status.json`'u okuyor ve
  hâlihazırda terminal `error`/`killed` kayda saygı gösteriyor
  (`parse-utils.mjs`'in `TERMINAL_STATES`'i ile), reconcile edilmiş
  `exitCode`'u koruyor. `ds-`, `cx-`, `oc-`, `cp-stream-parse.mjs` ve
  `ag-transcript-parse.mjs`'e uygulandı.
- **`cx-stream` hata durumunda gerçek worker exit code'unu kaydediyor.**
  Parser zaten `state:"error"` kaydetmişse (ör. geçersiz model) wrapper'ın
  reconcile bloğu tamamen atlanıyordu — codex 1 ile çıkmasına rağmen
  `meta.json`'da `exitCode: 0` kalıyordu. Error dalı artık parser'ın daha
  spesifik hata metnini korurken `meta.exitCode`'u gerçek `$CODEX_RC` ile
  yamalıyor. `cx-stream.ps1`'e senkronlandı. (`oc-stream`'de aynı desen var
  — takip işi olarak işaretlendi, burada değiştirilmedi.)
- **`*-worktree-run.sh` kurulumsuz PATH'te artık 127 ile çıkmıyor.** Beş
  script de sibling `*-stream`'i çıplak PATH çağrısıyla çalıştırıyordu;
  artık `*-agent` wrapper'larının zaten kullandığı
  `command -v X || X="$SCRIPT_DIR/X"` fallback'ini kullanıyorlar.
  `ds-worktree-run.ps1`/`cx-worktree-run.ps1` twin'leri pwsh-idiomatik
  eşdeğeriyle senkronlandı.
- **Antigravity conversation-id keşfi artık paralel bir çalışmanın
  oturumunu kaçıramıyor.** `discover_cid` conversation'ı launch sonrasında
  paylaşımlı `last_conversations.json`'ın cwd anahtarından seçiyordu — aynı
  cwd'de iki paralel çalışma birbirinin conversation'ına bağlanabiliyor,
  bir conversation hiç session dizini almadan kalabiliyordu. Keşif artık
  launch öncesi conversation-id kümesinin snapshot'ını alıyor, yalnızca yeni
  id'leri değerlendiriyor ve sadece ilk `USER_INPUT`'u (`<USER_REQUEST>`
  bloğu) bu çalışmanın kendi prompt'uyla eşleşen conversation'a bağlanıyor
  (saf eşleştirme yardımcıları `parse-utils.mjs`'e eklendi, birim testli).
  Hiçbir aday doğrulanamazsa çalışma sessizce yanlış bağlanmak yerine
  `state:"error"` ile gürültülü şekilde başarısız oluyor.
- **`changed-files.json` önceden kirli dosyaları artık worker'a mal
  etmiyor.** Her `*-stream` wrapper'ı launch öncesi `git status --porcelain`
  snapshot'ı alıyor; `write_diff_artifacts` bu path'leri `files`'tan çıkarıp
  yeni bilgilendirici `preexistingDirty` alanına kaydediyor. `diff.patch`
  değişmedi; temiz repolardaki çalışmalar yine `"preexistingDirty": []`
  üretiyor (geriye uyumlu).

## [3.40.2] — 2026-07-11

### Değiştirildi

- **Dashboard header'ı sadeleştirildi.** "· read-only by default · opt-in
  takeover" sloganı kaldırıldı, "Clean stale sessions" tetikleyicisi
  header'dan çıkarılıp config görünümüne (⚙) — session bakım
  kontrollerinin yanına — taşındı. Header artık yalnızca anlık değişen
  bilgiyi gösteriyor: başlık, aktif worker sayacı ve tema/config butonları
  — statik açıklama metni ve tek seferlik aksiyonlar her sayfa yüklemesinde
  yer kapmak yerine config paneline bırakıldı.

## [3.40.1] — 2026-07-11

### Düzeltildi

- **Takeover heartbeat timer'ı, guard tetiklendiğinde artık kendini
  durduruyor.** 3.39.4, `touchTakeoverHeartbeat`'i reap edilmiş bir
  takeover'ı diriltmeye karşı guard'lamıştı (taze okunan state artık
  `human-controlled` + `takeover.active` değilse yazmayı atla + tek satır
  stderr notu), ama `dashboard-server.mjs`'in 30 saniyelik PTY-köprüsü
  heartbeat timer'ı bu no-op durumda sonsuza dek çalışmaya devam ediyordu —
  out-of-process bir reap sonrası tarayıcı sekmesi bağlı kaldığı sürece her
  30 sn'de bir stderr'e spam basıyordu. Köprü artık her heartbeat çağrısının
  döndürdüğü status'u inceliyor ve guard tetiklendiğinde kendi interval'ını
  temizliyor (swap-güvenli: `entry.heartbeatTimer`'ı yalnızca hâlâ kendisine
  aitse null'luyor — mevcut teardown desenine birebir uygun). Socket
  teardown'ı yine kendi doğal close/exit yolundan geliyor.

### Değiştirildi

- **`listSessions` artık her `/api/sessions` isteğinde tüm Claude Code
  transcript tail'lerini yeniden okumuyor.** `dashboard-server.mjs`'teki
  `.jsonl` başına head/tail okuma ve tail-parse (model çıkarımı dahil),
  `buildWorkerParentIndex`'in zaten kullandığı mtime-kapılı modül-seviyesi
  cache deseninin arkasına alındı — değişmeyen dosyalar önceki parse
  sonucunu yeniden kullanıyor; live-status, boyut ve subagent sayıları her
  çağrıda taze kalıyor. Yanıt şekli ve sıralama değişmedi; yalnızca tekrar
  dosya I/O'su azaldı.
- **`findStaleSessions`'taki state-küme üyeliği kontrolü paylaşılan enum'a
  taşındı.** Hardcoded `state === 'running' || state === 'human-controlled'`
  kontrolü, repo sözleşmesi gereği `parse-utils.mjs`'in
  `NON_TERMINAL_STATES.has(state)`'ine geçirildi. Kasıtlı tek-state
  kontrolleri (yalnızca `running`'e scope'lu stale sezgiseli, takeover'ın
  `running` ön koşulu) olduğu gibi bırakıldı — semantikleri "non-terminal"
  değil.

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
