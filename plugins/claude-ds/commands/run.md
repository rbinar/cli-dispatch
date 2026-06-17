---
description: Bir gorevi claude-ds'e (DeepSeek) delege et
argument-hint: <gorev aciklamasi>
allowed-tools: Bash, Read
---

# claude-ds'e görev delege et

Delege edilecek görev: **$ARGUMENTS**

Önce kullanıcının bunu DeepSeek'e göndermeyi açıkça istediğinden emin ol (prompt/kod harici servise gider).

**Gerçek repo görevi** ise (dosya değişikliği gerekiyorsa) — izole worktree kullan:
1. Görevi bir brief dosyasına yaz (örn. `/tmp/ds-brief.txt`).
2. Çalıştır (background task):
   ```bash
   "${CLAUDE_PLUGIN_ROOT}/scripts/ds-worktree-run.sh" <repo-path> <branch-adi> /tmp/ds-brief.txt
   ```
3. Script bittiğinde worktree'deki diff'i **incele** (`git -C <worktree> diff`), bağımsız doğrula (tsc/build/test).
4. Sorun yoksa git/commit/push/PR/merge'i **sen** yap; sonra worktree'yi temizle.

**Saf üretim** (kod/metin, dosya yok) ise:
```bash
claude-ds -p "$ARGUMENTS"
```
(background task olarak çalıştır.)

claude-ds = işçi, sen = reviewer/merge sahibi. Doğrulanmadan çıktıyı güvene alma.
