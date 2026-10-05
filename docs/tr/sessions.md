# Session takibi (canlı izleme + resume)

[← README](../../README.tr.md)

Delege edilen iş **opak bir arka plan süreci değildir**: her backend'in çıktısı parse edilip her görev bir **session dizinine** yazılır (DeepSeek, Antigravity, Codex, OpenCode ve Copilot için aynı düzen). İşçinin ne yaptığını `/cli-dispatch:sessions` ve `/cli-dispatch:watch <id>` ile (veya sonucu tek çağrıda bloklamak için `/cli-dispatch:wait <id>` ile) **canlı, yapılandırılmış ve resume-edilebilir** şekilde takip edersin.

Session dizini: `${XDG_CACHE_HOME:-$HOME/.cache}/cli-dispatch/sessions/<id>/` (eski `claude-ds` yolu hâlâ fallback olarak okunur)

| Dosya | İçerik |
|-------|--------|
| `status.json` | Kompakt özet (durum, son tool, tool sayıları, sonuç önizlemesi) — **izlemek için tek okunan dosya** |
| `progress.log` | Terse insan-okur akış (`▸ Edit foo.ts`, `✓ / ✗`, kısaltılmış metin) |
| `transcript.jsonl` | Ham stream-json (resume/audit; izlerken okunmaz) |
| `meta.json` | Prompt önizlemesi, cwd, branch, model, başlangıç/bitiş |
| `prompt.txt` | **Tam** görev prompt'u (kısaltmasız) |

**Maliyet-odaklı izleme:** ilerleme yalnızca küçük `status.json`'dan takip edilir (`/cli-dispatch:watch <id>` veya `/cli-dispatch:wait <id>`); ham transcript okunmaz, sıkı döngüde tail edilmez — orkestratörün her okuması token harcadığı için.

> Gereksinim: session takibi/parse için `node` gerekir (claude-code zaten node ortamında çalışır).
