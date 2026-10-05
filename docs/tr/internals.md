# Kaputun altı (ileri düzey)

[← README](../../README.tr.md)

Plugin, Claude Code'un **Bash ile çağırdığı** taşınabilir CLI'ları `~/.local/bin`'e kurar —
normalde bunları **sen çağırmazsın**, Claude Code yönetir:

| CLI | Ne |
|-----|----|
| `claude-ds` | Düz env wrapper (`claude`'u DeepSeek'e yönlendirir; parse/session yok) |
| `claude-ds-stream` | Session-takipli varyant (stream-json parse + status/progress/transcript) |
| `ds-agent` | Tek-komut senkron sarmalayıcı: görev → çalış → cevap (stdout); ilerleme stderr'de |
| `ag-stream` | Session-takipli Antigravity wrapper (agy'nin disk JSONL transcript'ini tail eder) |
| `ag-agent` | agy için tek-komut senkron sarmalayıcı: görev → çalış → cevap (stdout) |
| `cx-stream` | Session-takipli Codex wrapper (codex'in JSONL stdout'unu parser'dan geçirir) |
| `cx-agent` | codex için tek-komut senkron sarmalayıcı: görev → çalış → cevap (stdout) |
| `oc-stream` | Session-takipli OpenCode wrapper (opencode'un JSON stream'ini parser'dan geçirir) |
| `oc-agent` | opencode için tek-komut senkron sarmalayıcı: görev → çalış → cevap (stdout) |
| `cp-stream` | Session-takipli GitHub Copilot wrapper (copilot'ın JSON stream'ini parser'dan geçirir) |
| `cp-agent` | copilot için tek-komut senkron sarmalayıcı: görev → çalış → cevap (stdout) |

İstersen terminalden de doğrudan kullanabilirsin (ör. plugin dışı script'lerde):

```bash
ds-agent --read-only "soru"             # tek komut; cevap stdout'a
ds-agent --cwd /tmp/x "dosya üret"      # agentic, izole dizin
claude-ds-stream --resume <id> -p "…"   # mevcut session'a devam

cx-agent --read-only -q "soru"          # read-only: kernel düzeyinde sandbox (macOS Seatbelt / Linux bwrap)
cx-agent --cwd /tmp/x "dosya üret"      # agentic, izole dizin
cx-agent --resume <thread-id> "devam"                # resume saklanan bağlamı kullanır; --cwd resume'da desteklenmez

cp-agent -q "soru"                      # tek komut; cevap stdout'a
cp-agent --cwd /tmp/x "dosya üret"      # agentic, izole dizin
cp-agent --effort high --model gpt-5.4 "görev"
cp-agent --resume <session-id> "devam"
```

Bayraklar (cx-agent / cx-stream): `--read-only`, `--sandbox <mod>`, `--cwd <dir>`, `--resume <id>`, `--model <m>`, `--max-runtime`/`--idle-timeout`, `-q`.
Bayraklar (cp-agent / cp-stream): `--cwd <dir>`, `--resume <id>`, `--model <m>`, `--effort low|medium|high`, `--max-runtime`/`--idle-timeout`, `-q`.

> 📄 Terminalden kurulum, tüm komutlar, bayraklar ve env override'larının tam referansı: [TERMINAL.md](../../TERMINAL.md).
