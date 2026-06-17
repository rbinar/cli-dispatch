# claude-ds

**DeepSeek destekli Claude Code'u delege işçi olarak çalıştıran** bir Claude Code plugin'i.

Claude Code'un yerleşik `Agent`/subagent tool'u yalnızca Anthropic modellerini (sonnet/opus/haiku) destekler — DeepSeek'e iş veremez. `claude-ds`, Claude Code CLI'ı DeepSeek'in Anthropic-uyumlu API'siyle çalıştıran taşınabilir bir wrapper kurar; böylece görevleri DeepSeek'e **delege işçi** olarak verebilirsin.

## Kurulum

```text
/plugin marketplace add rbinar/claude-ds
/plugin install claude-ds@claude-ds
/claude-ds:setup
```

`/claude-ds:setup` wrapper'ı `~/.local/bin/claude-ds`'e kurar ve `~/.config/claude-ds/config` iskeletini oluşturur. Sonra DeepSeek API key'ini bu dosyaya **kendin** ekle:

```bash
# ~/.config/claude-ds/config
DEEPSEEK_API_KEY="sk-..."     # kendi DeepSeek key'in
DS_MODEL="deepseek-v4-pro"
DS_FLASH_MODEL="deepseek-v4-flash"
```

Gereksinim: `claude` CLI kurulu ve `~/.local/bin` PATH'te olmalı. DeepSeek key'i: https://platform.deepseek.com/api_keys

## Kullanım

| Komut | İş |
|-------|-----|
| `/claude-ds:setup` | Wrapper'ı kur + config iskeleti + smoke test |
| `/claude-ds:run <görev>` | Bir görevi claude-ds'e delege et |
| `/claude-ds:status` | Kurulum/key/CLI durumunu kontrol et |

Doğrudan kullanım (terminal):

```bash
# Üretim modu (dosya yazmaz)
claude-ds -p "Write a Python one-liner for fib(n)"

# Tam agentic mod (dosya yazar + bash çalıştırır) — izole worktree ile
plugins/claude-ds/scripts/ds-worktree-run.sh <repo> <branch> <brief-file>
```

## Güvenlik ve veri

- **API key makineden çıkmaz:** key `~/.config/claude-ds/config` içinde (0600, repo dışında) tutulur ve **asla commit edilmez**. Plugin/skill key'i hiçbir yere yazmaz; sen eklersin.
- **Veri egress:** claude-ds'e verdiğin **prompt ve kod DeepSeek'e (harici servis) gönderilir.** Yalnızca bunu kabul ediyorsan kullan.
- **İzole çalışma:** gerçek repo görevleri `ds-worktree-run.sh` ile ayrı git worktree'de çalışır; `--dangerously-skip-permissions` ana checkout'a/diğer branch'lere dokunmaz. Üreteni inceleyip (diff + build/test) merge etmek **sana** kalır.

## Mimari rol

`claude-ds` = işçi (DeepSeek üretimi/uygulaması). Sen (Claude Code, Anthropic) = orkestratör + reviewer + git/merge sahibi.

## Lisans

MIT — bkz. [LICENSE](LICENSE).
