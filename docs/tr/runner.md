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
çalışma sayesinde Bash aracının 10 dakikalık tavanını aşan bir run artık öldürülmez. Claude Code 2.1.287'den eski sürümlerde orkestratörden delegasyon yolu budur; 2.1.287+ sürümlerde aşağıdaki `mcp__cli-dispatch__dispatch` aracı tercih edilir:

```text
Agent(subagent_type: "cli-dispatch:runner", prompt: "backend: ds\ncwd: /mutlak/yol\nverify: <cmd>\n---\n<kendi başına yeterli brief>")
```

6.3.0'dan beri Claude Code 2.1.287+ sürümlerinde eklentinin mod'u, modelin çağırabildiği bir araç da sağlar: `mcp__cli-dispatch__dispatch` — kullanılabiliyorsa tercih edilen yol budur. `cli-dispatch-run --detach … --fix-attempts 1` komutunu kendisi çalıştırır (subagent yok, kendi başına LLM turu yok), `cli-dispatch-wait --run <id>` üzerinde bloklar (en fazla 570 sn'lik, en çok 6 bekleme) ve runner'ın kompakt özetini olduğu gibi döndürür (session id, verify sonucu, diff, STRANDED worktree, patch yolu). Girdiler: `backend` (`ds|ag|cx|oc|cp`, zorunlu), `cwd` (mutlak repo yolu, zorunlu), `task` (brief'in tamamı, zorunlu), `verify` (shell komutları dizisi, opsiyonel), `model` (opsiyonel), `scope` (repo'ya göre glob dizisi, opsiyonel — aşağıya bak). Ölçüm: gerçek bir `ds` run'ı uçtan uca 29 sn sürdü ve orkestratör tarafında 2 tur harcandı; 780 sn'lik tek bir araç çağrısı kesilmedi. Oturum-başı politika, orkestratöre aracı kullanılabiliyorsa çağırmasını, değilse `Agent(subagent_type: "cli-dispatch:runner")` kullanmasını söyler. Araç verdict'i ya da diff'i senin yerine okumaz — sonucu yine kendin yeniden ölçersin.

```text
mcp__cli-dispatch__dispatch({"backend": "ds", "cwd": "/mutlak/yol", "task": "<kendi başına yeterli brief>", "verify": ["<cmd>"]})
```

`scope` (runner'ın `--scope <glob>` bayrağı, tekrarlanabilir), worker'ın hangi dosyaları değiştirebileceğini sınırlar. Run bitince worker'ın değiştirdiği her dosya (worker'ın raporundan değil, git'ten ölçülür) bir glob'a uymalıdır; uymayan varsa verify geçse bile run exit 2 ile başarısız olur, verdict bu dosyaları `scopeViolations` altında listeler ve özet bir `SCOPE:` satırı basar. `**` dizinler arasında geçer, `*` ve `?` tek dizinde kalır; joker içermeyen bir glob o yolu ve altındaki her şeyi kapsar (`src/auth` = dizin). `scope` verilmezse hiçbir şey kontrol edilmez.

Doğrudan kullanım için aynı runner bir slash komutudur (sıfır LLM token'ı; arka plana almayı sen
yaparsın):

```text
/cli-dispatch:run <backend> "<görev>" --verify '<cmd>'
```

`cli-dispatch-run` işçiyi başlatır (`ds` DeepSeek / `ag` Antigravity / `cx` Codex / `oc` OpenCode
/ `cp` GitHub Copilot / `ol` Ollama), gerçek repo değişikliklerini git worktree'de izole eder, bitene kadar
(veya timeout'a kadar) bloklar, `--verify` komutunu çalıştırır ve kompakt bir verdict basar —
**orkestrasyonda sıfır LLM token'ı harcanır** (yukarıdaki agent yalnızca yönlendirir). Codex'te `--read-only` hâlâ **gerçek
OS-düzey sandbox'ı** (macOS Seatbelt / Linux bwrap+seccomp) aktive eder — kernel düzeyinde sert
yazma engeli, gerçek bir yazma garantisi için worktree gerekmez.

**Escalation yolu** (muhakeme-yoğun iş, makine-kontrol-edilebilir verify yok): devredebileceğin bir LLM
babysitter yok. Sen (Claude Code) deterministik runner'ı — veya doğrudan bir
`*-agent` CLI'ı — çalıştırırsın, ama `--verify`'a geçit koymak yerine kompakt verdict'i ve diff'i
kendin okur, sonuç bir tur daha gerektiriyorsa `/cli-dispatch:resume <session-id> "<prompt>"`
ile devam edersin.

Varsayılan delege etmektir: test ekleyen ya da değiştiren veya birden fazla dosyaya dokunan iş
dispatch aracına (eski Claude Code'da runner agent'ına) gider. Yalnızca tek dosyada ~20 satırlık bir düzeltme (sıfır keşif/belirsizlik)
inline kalır — orada delegasyonun sabit maliyeti işe değmez. Repo değişikliği olmayan basit, tek-atışlık bir iş için `/cli-dispatch:ask <backend> "<prompt>"`
yeterlidir.
