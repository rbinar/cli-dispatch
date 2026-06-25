# cli-dispatch demo — vhs tape (Claude Code CLI look, mock / key-free)
# Render:  vhs demo.tape   ->   demo.gif
#
# Simulates a Claude Code session: a tan ">" prompt, a /cli-dispatch slash
# command, and ⏺ / └ tool-use blocks streamed line by line.
# A DEBUG trap (extdebug) intercepts the slash command off-camera and
# prints the mocked session, then returns non-zero to skip real execution
# — so it renders key-free and deterministically. Outputs are faithful to
# real ds-runner behavior.

Output demo.gif

Set Shell "bash"
Set FontSize 19
Set Width 1280
Set Height 760
Set Padding 28
Set TypingSpeed 50ms
Set WindowBar Colorful
Set Margin 16
Set BorderRadius 10
Set Theme { "name": "claude-code", "background": "#1c1917", "foreground": "#e7e5e4", "cursor": "#d97757", "selection": "#44403c", "black": "#1c1917", "red": "#f87171", "green": "#4ade80", "yellow": "#fbbf24", "blue": "#60a5fa", "magenta": "#c084fc", "cyan": "#22d3ee", "white": "#e7e5e4", "brightBlack": "#78716c", "brightRed": "#f87171", "brightGreen": "#4ade80", "brightYellow": "#fbbf24", "brightBlue": "#60a5fa", "brightMagenta": "#c084fc", "brightCyan": "#22d3ee", "brightWhite": "#fafaf9" }

# ---- off-camera setup: Claude-Code-style prompt + slash-command mock ----
Hide
Type `PS1=$'\033[38;2;217;119;87m> \033[0m'`
Enter
Type `A=$'\033[38;2;217;119;87m'; D=$'\033[38;5;245m'; G=$'\033[32m'; R=$'\033[0m'; __g=0`
Enter
Type `__cc(){ [ "$__g" = 1 ] && return 0; case "$BASH_COMMAND" in /cli-dispatch:ds-run*) __g=1; echo; printf "%s⏺%s Delegating to DeepSeek via ds-runner…\n" "$A" "$R"; sleep 0.6; echo; printf "%s⏺%s ds-runner(write hello.py + a pytest test)\n" "$A" "$R"; sleep 0.5; printf "  %s└  worker: DeepSeek (deepseek-v4-pro) · isolated git worktree%s\n" "$D" "$R"; sleep 0.45; printf "  %s└  ▸ Write hello.py%s\n" "$D" "$R"; sleep 0.45; printf "  %s└  ▸ Write test_hello.py%s\n" "$D" "$R"; sleep 0.45; printf "  %s└  %s✓ pytest: 1 passed%s\n" "$D" "$G" "$R"; sleep 0.45; printf "  %s└  done — diff left uncommitted for review%s\n" "$D" "$R"; sleep 0.6; echo; printf "%s⏺%s DeepSeek wrote hello.py and a passing test in an isolated\n" "$A" "$R"; printf "  worktree. You review the diff and merge.%s\n" "$R"; echo; __g=0; return 1;; esac; return 0; }`
Enter
Type `shopt -s extdebug; trap '__cc' DEBUG`
Enter
Type "clear"
Enter
Show

# ---- the session ----
Sleep 600ms
Type "/cli-dispatch:ds-run write hello.py that prints hi, with a pytest test"
Sleep 700ms
Enter
Sleep 5500ms

# hold on the final frame
Sleep 2500ms
