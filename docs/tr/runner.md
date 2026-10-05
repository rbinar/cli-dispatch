# Deterministik runner ve runner agent'ı

[← README](../../README.tr.md)

Her delegasyonu kendi LLM alt-bağlamında izleyen beş backend-başına "babysitter" subagent'ı
(`ds-/ag-/cx-/oc-/cp-runner`) 4.0.0'da kaldırıldı — prodüksiyonda ölçüldüğünde kendi işçisinin
çıktısının kabaca **9 katı** Anthropic token'ı tüketiyorlardı (run başına ~62 tur; bkz.
[CHANGELOG.md](../../CHANGELOG.md)). 5.2.0'dan beri yerlerinde tek bir **ince** agent var:
`cli-dispatch:runner` (haiku, yalnız Bash). Babysitter değil, yönlendiricidir: tek bir Bash çağrısı
`cli-dispatch-run --detach` ile runner'ı başlatır, tek bir bloklayan `cli-dispatch-wait --run <id>`
bitmesini bekler ve kompakt verdict olduğu gibi geri döner (~3-4 tur). Mekanik her şey shell'de
kalır — başarısız bir verify'ın bir kez yeniden denenmesi de (`--fix-attempts 1`) — ve ayrık
çalışma sayesinde Bash aracının 10 dakikalık tavanını aşan bir run artık öldürülmez. Orkestratörden
varsayılan delegasyon yolu budur:

```text
Agent(subagent_type: "cli-dispatch:runner", prompt: "backend: ds\ncwd: /mutlak/yol\nverify: <cmd>\n---\n<kendi başına yeterli brief>")
```

Doğrudan kullanım için aynı runner bir slash komutudur (sıfır LLM token'ı; arka plana almayı sen
yaparsın):

```text
/cli-dispatch:run <backend> "<görev>" --verify '<cmd>'
```

`cli-dispatch-run` işçiyi başlatır (`ds` DeepSeek / `ag` Antigravity / `cx` Codex / `oc` OpenCode
/ `cp` GitHub Copilot), gerçek repo değişikliklerini git worktree'de izole eder, bitene kadar
(veya timeout'a kadar) bloklar, `--verify` komutunu çalıştırır ve kompakt bir verdict basar —
**orkestrasyonda sıfır LLM token'ı harcanır** (yukarıdaki agent yalnızca yönlendirir). Codex'te `--read-only` hâlâ **gerçek
OS-düzey sandbox'ı** (macOS Seatbelt / Linux bwrap+seccomp) aktive eder — kernel düzeyinde sert
yazma engeli, gerçek bir yazma garantisi için worktree gerekmez.

**Escalation yolu** (muhakeme-yoğun iş, makine-kontrol-edilebilir verify yok): devredebileceğin bir LLM
babysitter yok. Sen (Claude Code) deterministik runner'ı — veya doğrudan bir
`*-agent` CLI'ı — çalıştırırsın, ama `--verify`'a geçit koymak yerine kompakt verdict'i ve diff'i
kendin okur, sonuç bir tur daha gerektiriyorsa `/cli-dispatch:resume <session-id> "<prompt>"`
ile devam edersin.

Tek dosyalık, önemsiz bir düzeltme için (yaklaşık 50 satırın çok altında, sıfır keşif/belirsizlik)
delegasyonu hiç kullanma, doğrudan inline yap — herhangi bir delegasyonun sabit maliyeti buna
değmez. Repo değişikliği olmayan basit, tek-atışlık bir iş için düz `/cli-dispatch:ds-run` /
`ag-run` / `cx-run` / `oc-run` / `cp-run` komutları yeterlidir.
