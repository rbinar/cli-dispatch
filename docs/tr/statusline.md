# Statusline rozeti

[← README](../../README.tr.md)

`scripts/cli-dispatch-statusline.sh` bir statusline **fragment'ıdır**: birleştirici
`~/.claude/hooks/statusline.sh` wrapper'ın statusline stdin JSON'unu bu script'e aktarıp
çıktısını eklemesiyle çalışır. Claude Code'un snake_case `session_id` alanından
yalnızca **bu Claude Code session'ının** başlattığı taze ve çalışan worker'ları sayar;
`[CD](ds:1,ag:2,cx:1)` gibi sarı bir ekte backend'e göre gruplar. Sabit grup sırası
`ds`, `ag`, `cx`, `oc`, `cp`'dir; boş gruplar yazılmaz. Cyan `[CD]` rozeti politika enjeksiyonu
açıkken veya bu session'ın canlı bir worker'ı varken görünür; pasifken hiçbir şey basılmaz.
`parentSessionId` alanı olmayan eski worker'lar hariç tutulur. Boş olmayan `session_id`
taşımayan çağırıcılar eski global sarı `▶N` sayacını kullanmaya devam eder.

Birleştirici wrapper'ına tek satırla bağla; fragment'ı plugin cache'inden glob ile bul (hash/versiyon adlı, o yüzden glob kullan — yol'u sabit kodlama):

```bash
CD_SCRIPT=$(ls "$CONFIG_DIR"/plugins/cache/cli-dispatch/cli-dispatch/*/scripts/cli-dispatch-statusline.sh 2>/dev/null | head -1)
```

Sadece küçük `status.json` ve `meta.json` dosyalarını okur (asla `transcript.jsonl`'ı),
böylece statusline her prompt'ta yeniden çalışsa da ucuz kalır. Yalnızca Unix (bash)
statusline kurulumları.
