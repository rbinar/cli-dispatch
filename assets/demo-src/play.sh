#!/usr/bin/env bash
# Simulated Claude Code session player for VHS. Types each slash command
# char-by-char, then prints a representative (mocked) response. Deterministic.
D=$'\033[2m'; G=$'\033[32m'; C=$'\033[36m'; Y=$'\033[33m'; O=$'\033[38;5;208m'; B=$'\033[1m'; R=$'\033[0m'
PROMPT="${O}>${R} "

type_cmd() {  # animate typing of "$1"
  printf '%s' "$PROMPT"
  local s="$1" i
  for (( i=0; i<${#s}; i++ )); do printf '%s' "${s:$i:1}"; sleep 0.045; done
  printf '\n'; sleep 0.35
}
out(){ printf '%b\n' "$1"; }
pause(){ sleep "${1:-1.2}"; }

scene_demo() {
  printf '%b\n' "${D}# cli-dispatch — set up & use, all inside Claude Code${R}"; pause 1
  type_cmd "/plugin marketplace add rbinar/cli-dispatch"
  out "${D}  Added marketplace ${C}rbinar/cli-dispatch${R}"; pause
  type_cmd "/plugin install cli-dispatch@cli-dispatch"
  out "${G}  ✔${R} Installed ${B}cli-dispatch${R}. Run ${C}/reload-plugins${R} to apply."; pause
  type_cmd "/reload-plugins"
  out "${D}  Reloaded: 11 plugins · 16 skills · 12 agents${R}"; pause 1
  type_cmd "/cli-dispatch:setup"
  out "${C}  ? Which backend(s) to install${R}  ${D}(multi-select)${R}"
  out "    ${G}◉${R} DeepSeek   ${G}◉${R} Antigravity (Gemini)   ${G}◉${R} Codex (OpenAI)"
  out "${G}  ✔${R} wrappers → ~/.local/bin   config → ~/.config/cli-dispatch"
  out "${G}  ✔${R} smoke test: DeepSeek OK · Antigravity OK · Codex OK"; pause 1.4
  type_cmd "/cli-dispatch:ds-run \"fix the login redirect bug\""
  out "${D}  ▶ delegating to ${B}DeepSeek${R}${D} worker (session-tracked)…  state: running → done${R}"
  out "${G}  ✔${R} patch ready ${D}— diff left uncommitted in a worktree; review → merge is yours${R}"; pause 1.4
  type_cmd "/cli-dispatch:cx-balance"
  out "  Codex ${D}(plan: plus)${R}   5h ${G}76% left${R}   7d ${G}89% left${R}"; pause
  type_cmd "/cli-dispatch:ag-balance"
  out "  Antigravity ${D}(plan: Google AI Pro)${R}   Gemini 3.1 Pro ${Y}94% left${R}   Claude Opus ${G}100% left${R}"; pause 1.6
}

scene_update() {
  printf '%b\n' "${D}# How to update cli-dispatch (inside Claude Code)${R}"; pause 1
  type_cmd "/plugin update cli-dispatch"
  out "${G}  ✔${R} Updated ${B}cli-dispatch${R} → ${B}3.3.0${R}. Run ${C}/reload-plugins${R} to apply."; pause 1.2
  type_cmd "/reload-plugins"
  out "${D}  Reloaded: 11 plugins · 16 skills · 12 agents${R}"; pause 1.2
  type_cmd "/cli-dispatch:status"
  out "  DeepSeek: ${G}installed${R} key ${G}set${R}   Antigravity: ${G}installed${R}   Codex: ${G}installed${R}"; pause 1.4
}

clear
"scene_$1"
