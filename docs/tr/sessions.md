# Session takibi (canlı izleme + resume)

[← README](../../README.tr.md)

Delege edilen iş **opak bir arka plan süreci değildir**: her backend'in çıktısı parse edilip her görev bir **session dizinine** yazılır (DeepSeek, Antigravity, Codex, OpenCode, Copilot ve Ollama için aynı düzen). İşçinin ne yaptığını `/cli-dispatch:sessions` ve `/cli-dispatch:watch <id>` ile (veya sonucu tek çağrıda bloklamak için `/cli-dispatch:watch <id> --wait` ile) **canlı, yapılandırılmış ve resume-edilebilir** şekilde takip edersin.

Session dizini: `${XDG_CACHE_HOME:-$HOME/.cache}/cli-dispatch/sessions/<id>/` (eski `claude-ds` yolu hâlâ fallback olarak okunur)

| Dosya | İçerik |
|-------|--------|
| `status.json` | Kompakt özet (durum, son tool, tool sayıları, sonuç önizlemesi) — **izlemek için tek okunan dosya** |
| `progress.log` | Terse insan-okur akış (`▸ Edit foo.ts`, `✓ / ✗`, kısaltılmış metin) |
| `transcript.jsonl` | Ham stream-json (resume/audit; izlerken okunmaz) |
| `meta.json` | Prompt önizlemesi, cwd, branch, model, başlangıç/bitiş |
| `prompt.txt` | Worker'a gönderilen **tam** görev prompt'u (kısaltmasız, 0600); resume orijinali korur |
| `changed-files.json` | `{files, diffstat, preexistingDirty}` — çalıştırmanın değiştirdiği dosyalar; repo'yu değiştiren bir run bittikten sonra yazılır |
| `verdict.json` | Yalnızca `cli-dispatch-run` üzerinden giden run'lar için yazılır: verify sonucu, branch, diffstat, çıkış kodu |
| `worker-report.json` | İşçinin kendi beyanı (claims, notDone, assumptions); istendiğinde worktree'sinde işçi yazar; kanıt değil, beyandır |

**Maliyet-odaklı izleme:** ilerleme yalnızca küçük `status.json`'dan takip edilir (`/cli-dispatch:watch <id>` veya `/cli-dispatch:watch <id> --wait`); ham transcript okunmaz, sıkı döngüde tail edilmez — orkestratörün her okuması token harcadığı için.

> Gereksinim: session takibi/parse için `node` gerekir (claude-code zaten node ortamında çalışır).

`<sessions-root>/.ask/run-XXXXXX/` (7.3.0) bir `dispatch`-aracı koşusunun canlı soru ve mesaj dosyalarını tutar (`ask_user` soruları, `msg-*.json`, `log.jsonl`); koşu bitince silinir, session okuyucuları nokta ile başlayan girdileri atlar. Bir session dizini ona işaret eden bir `ask-dir` dosyası taşıyabilir.