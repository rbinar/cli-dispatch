#!/usr/bin/env bash
# Simulated Claude Code session player for VHS. Approximates the real Claude
# Code TUI (welcome box, > prompt, ⏺/⎿ output) with representative mocked
# responses. Deterministic; no live calls.
D=$'\033[2m'; G=$'\033[32m'; C=$'\033[36m'; Y=$'\033[33m'; O=$'\033[38;5;208m'; M=$'\033[35m'; B=$'\033[1m'; R=$'\033[0m'

sh_prompt(){ printf "${C}~/projects/myapp${R} ${D}\$${R} "; }
type_at(){ # $1 = text, $2 = prompt-printer
  "$2"; local s="$1" i; for (( i=0; i<${#s}; i++ )); do printf '%s' "${s:$i:1}"; sleep 0.028; done; printf "\n"; sleep 0.12
}
cc_prompt(){ printf "${O}>${R} "; }
type_sh(){ type_at "$1" sh_prompt; }
type_cc(){ type_at "$1" cc_prompt; }
out(){ printf '%b\n' "$1"; }
pause(){ sleep "${1:-0.5}"; }

banner(){
  out "${M}╭──────────────────────────────────────────────────────╮${R}"
  out "${M}│${R} ${O}✻${R} ${B}Welcome to Claude Code${R}                              ${M}│${R}"
  out "${M}│${R}                                                        ${M}│${R}"
  out "${M}│${R}   ${D}/help for help · /status for setup${R}                   ${M}│${R}"
  out "${M}│${R}   ${D}cwd: ~/projects/myapp${R}                                ${M}│${R}"
  out "${M}╰──────────────────────────────────────────────────────╯${R}"
  out "${D}  Sonnet 4.6 · cli-dispatch plugin loaded${R}"
}

scene_demo(){
  type_sh "claude"; pause 0.4; banner; pause 0.9
  out "${D}# set up cli-dispatch — all inside Claude Code${R}"; pause 0.8
  type_cc "/plugin marketplace add rbinar/cli-dispatch"
  out "${D}  Added marketplace ${C}rbinar/cli-dispatch${R}"; pause
  type_cc "/plugin install cli-dispatch@cli-dispatch"
  out "${G}  ✔${R} Installed ${B}cli-dispatch${R}. Run ${C}/reload-plugins${R} to apply."; pause
  type_cc "/reload-plugins"
  out "${D}  Reloaded: 11 plugins · 16 skills · 12 agents${R}"; pause 1
  type_cc "/cli-dispatch:setup"
  out "${C}  ? Which backend(s) to install${R}  ${D}(multi-select)${R}"
  out "    ${G}◉${R} DeepSeek   ${G}◉${R} Antigravity (Gemini)   ${G}◉${R} Codex (OpenAI)"
  out "${G}  ✔${R} wrappers → ~/.local/bin   config → ~/.config/cli-dispatch"
  out "${G}  ✔${R} smoke test: DeepSeek OK · Antigravity OK · Codex OK"; pause 0.9
  out "${D}# delegate — one-shot command${R}"; pause 0.6
  type_cc "/cli-dispatch:ds-run \"fix the login redirect bug\""
  out "${D}  ▶ DeepSeek worker (session-tracked)…  running → done${R}"
  out "${G}  ✔${R} patch ready ${D}— uncommitted in a worktree; review → merge is yours${R}"; pause 0.9
  out "${D}# delegate — subagent runners (babysit + verify in a sub-context)${R}"; pause 0.6
  type_cc "use cx-runner to add tests for the parser"
  out "${M}⏺${R} ${B}cx-runner${R}(Add parser tests)"
  out "  ${D}⎿${R} real read-only sandbox → wrote tests in worktree"
  out "  ${D}⎿${R} verified: ${G}build ✓${R}  ${G}tests 12/12 ✓${R}"
  out "${M}⏺${R} Done — diff ready for review."; pause 0.9
  out "${D}  ⎿ ds-runner (DeepSeek) and ag-runner (Antigravity) work the same way${R}"; pause 1.1
  out "${D}# how much quota is left? (native, no third-party)${R}"; pause 0.6
  type_cc "/cli-dispatch:cx-balance"
  out "  Codex ${D}(plan: plus)${R}   5h ${G}76% left${R}   7d ${G}89% left${R}"; pause
  type_cc "/cli-dispatch:ag-balance"
  out "  Antigravity ${D}(plan: Google AI Pro)${R}   Gemini 3.1 Pro ${Y}94% left${R}   Claude Opus ${G}100% left${R}"; pause 1.0
}

scene_update(){
  type_sh "claude"; pause 0.4; banner; pause 1
  out "${D}# update cli-dispatch — inside Claude Code${R}"; pause 0.7
  type_cc "/plugin update cli-dispatch"
  out "${G}  ✔${R} Updated ${B}cli-dispatch${R} → ${B}3.3.0${R}. Run ${C}/reload-plugins${R} to apply."; pause 1.1
  type_cc "/reload-plugins"
  out "${D}  Reloaded: 11 plugins · 16 skills · 12 agents${R}"; pause 1.1
  type_cc "/cli-dispatch:status"
  out "  DeepSeek: ${G}installed${R} key ${G}set${R}   Antigravity: ${G}installed${R}   Codex: ${G}installed${R}"; pause 0.9
}

clear
"scene_$1"
