---
description: claude-ds kurulum durumunu kontrol et
allowed-tools: Bash
---

# claude-ds durum

Aşağıdaki kontrolleri yap (read-only; key DEĞERİNİ yazdırma):

```bash
command -v claude-ds >/dev/null 2>&1 && echo "wrapper: kurulu ($(command -v claude-ds))" || echo "wrapper: YOK (/claude-ds:setup calistir)"
CFG="${CLAUDE_DS_CONFIG:-$HOME/.config/claude-ds/config}"
if [ -f "$CFG" ]; then
  ( . "$CFG"; [ -n "${DEEPSEEK_API_KEY:-}" ] && echo "key: set" || echo "key: MISSING (config'e ekle)" )
else
  echo "config: YOK ($CFG)"
fi
command -v claude >/dev/null 2>&1 && echo "claude CLI: bulundu" || echo "claude CLI: YOK"
```

Hepsi tamamsa opsiyonel smoke test öner (background task): `claude-ds -p "Reply with exactly: OK"`.
