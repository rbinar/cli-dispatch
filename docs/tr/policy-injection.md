# Oturum-başı politika enjeksiyonu (opsiyonel)

[← README](../../README.tr.md)

`/cli-dispatch:setup`'ın bu son adımı **üç tercih** sorar — oturum-başı politika enjeksiyonunu etkinleştir/etkinleştirme, GitHub-issue hatırlatmasının dahil edilip edilmeyeceği ve ayrıca statik bir CLAUDE.md bloğu yazılıp yazılmayacağı — ve yanıtları `~/.config/cli-dispatch/policy.json`'a kaydeder. Bir `SessionStart` hook'u (`startup`/`resume`/`clear`/`compact`/`fork`'ta tetiklenir — `compact` dahil, yani politika **auto-compaction'dan sağ çıkar**: sıkıştırma eski kopyayı düşürür, hook tazesini enjekte eder, context başına net bir canlı kopya kalır) sonra her oturumun context'ine kompakt bir delegasyon politikası otomatik enjekte eder: mekanik işi deterministik runner'a (ince `cli-dispatch:runner` agent'ı üzerinden) yönlendir, verdict hâlâ başarısızsa ya da verify komutu yoksa escalation'ı kendin yap, ve cli-dispatch sorunlarını GitHub issue olarak açma hatırlatması — hepsi elle CLAUDE.md düzenlemeye gerek kalmadan.

- **Opt-in, varsayılan kapalı** — `policy.json` yoksa veya `enabled:false` ise, hook sessiz bir no-op'tur, sıfır token maliyeti.
- Statik CLAUDE.md bloğunun (eski `orchestration-priority`, şimdi `policy:v1`) yerine geçmez, tamamlayıcısıdır — ikisi birden açılırsa aynı politika oturum başına iki kez enjekte edilir, bu yüzden yalnızca hook önerilir. `/cli-dispatch:doctor`, durumunu bir **Policy injection** bölümünde raporlar.
- **Kaldırmak için** `~/.config/cli-dispatch/policy.json`'ı sil ya da `enabled:false` yap.
