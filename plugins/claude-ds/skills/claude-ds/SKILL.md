---
name: claude-ds
description: |
  Delegate a coding or agentic task to claude-ds — a DeepSeek-backed Claude Code
  CLI — as a worker. Use ONLY when the user explicitly asks to run/delegate work via
  claude-ds or DeepSeek (prompt/code leaves to an external service). Covers invocation
  (generation vs full-agentic), running as a background task, isolating real-repo work
  in a git worktree, and review/verify/merge of the output. The built-in Agent/subagent
  tool canNOT use DeepSeek (model enum is Anthropic-only) — claude-ds is the only path.
  Triggers: "claude-ds", "deepseek ile yap/calistir", "delege et claude-ds".
user-invocable: true
---

# claude-ds — DeepSeek delege işçisi

`claude-ds`, `/claude-ds:setup` ile `~/.local/bin`'e kurulan taşınabilir bir wrapper'dır;
Claude Code CLI'ı DeepSeek'in Anthropic-uyumlu API'siyle çalıştırır. PATH'te olduğu için
**doğrudan `claude-ds`** ile çağrılır (eski `zsh -ic` fonksiyon hilesi gerekmez).

## Ne zaman / ne zaman değil
- **Sadece kullanıcı açıkça isteyince.** Prompt/kod DeepSeek'e (harici servis) gider.
- Yerleşik `Agent`/subagent tool'u DeepSeek'i **DESTEKLEMEZ** (`model` enum: sonnet/opus/haiku/fable).
  DeepSeek'e iş vermenin tek yolu budur.
- Konuşma bağlamı **paylaşılmaz** → prompt **kendine yeten** olmalı.

## Çalıştırma kuralları
- **Her zaman background task** olarak çalıştır: Bash tool `run_in_background: true` (bloklamasın).
- **Uzun prompt** için brief'i dosyaya yaz, `-p "$(cat <brieffile>)"` ile geçir.

### Mod 1 — Üretim (dosya yazmaz; kod/metin/analiz üretir)
```bash
claude-ds -p "<kendine yeten prompt>"
```

### Mod 2 — Tam agentic (dosya yazar + bash çalıştırır)
```bash
cd <dizin> && claude-ds --dangerously-skip-permissions -p "$(cat /tmp/ds-brief.txt)"
```
`--dangerously-skip-permissions` onaysız dosya/bash demektir → **mutlaka izole et**.

## Gerçek repo görevi için güvenli operasyon (ZORUNLU)
Bundled yardımcıyı kullan:
```bash
"${CLAUDE_PLUGIN_ROOT}/scripts/ds-worktree-run.sh" <repo> <branch> <brief-file>
```
Bu script: izole git worktree açar (origin/main), varsa `node_modules` symlink'ler,
worktree içinde Mod 2 ile claude-ds çalıştırır ve diff'i **commit ETMEDEN** bırakır.

Sonra **reviewer SENSİN:**
1. `git -C <worktree> status && git -C <worktree> diff` ile TÜM diff'i incele — yan etki var mı,
   sadece hedef dosyalara mı dokunmuş kontrol et.
2. tsc/build/test'i **sen** çalıştır (bağımsız doğrulama).
3. Sorun yoksa git'i SEN yap: commit → push → PR → merge → ana checkout'ta `git pull origin main`.
   Commit gövdesine "implementasyon claude-ds (DeepSeek) ile delege edildi" yaz (şeffaflık).
4. Temizlik: `rm <worktree>/node_modules` → `git worktree remove <worktree> --force` → `git worktree prune`.

## Rol
claude-ds = işçi (üretim/uygulama), sen = orkestratör + reviewer + git/merge sahibi.
Doğrulanmadan hiçbir çıktıyı güvene alma.

## Komutlar
- `/claude-ds:setup` — wrapper'ı kur + config iskeleti + smoke test.
- `/claude-ds:run <görev>` — bir görevi claude-ds'e delege et (repo görevinde worktree izolasyonu).
- `/claude-ds:status` — kurulum/key/CLI durumunu kontrol et.
