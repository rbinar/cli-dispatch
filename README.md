# cli-dispatch

> 🌐 **Languages:** **English** · [Türkçe](README.tr.md)

**Hand Claude Code's work to DeepSeek, Gemini (Antigravity), OpenAI Codex, OpenCode (OpenRouter) or GitHub Copilot.** Claude Code's own subagents only run Anthropic models; cli-dispatch runs these five CLIs as workers from inside your `claude` session. A deterministic runner isolates each job in a git worktree, runs your verify command and returns a short verdict, so the worker does the work and Claude Code reviews it.

![cli-dispatch demo: install, setup, doctor, ask, delegate, run, sessions and resume, gain and clean — every output recorded in a clean Debian container](assets/demo.gif)

▶️ [Watch it as a video (mp4)](assets/demo.mp4) · 📝 [Write-up (Turkish, Medium)](https://medium.com/@rbinar/cli-dispatch-claudea-patron-deepseek-e-i%CC%87%C5%9F%C3%A7i-rol%C3%BC-veren-bir-plugin-b232803581fc)

## Install

Run these inside Claude Code (type `claude` first), one at a time:

```text
/plugin marketplace add rbinar/cli-dispatch
/plugin install cli-dispatch@cli-dispatch
/reload-plugins
/cli-dispatch:setup
```

Setup asks which backends you want and installs their wrappers. API keys go into a local browser form and never pass through Claude. Check the result with `/cli-dispatch:doctor`. Per-backend CLIs, sign-in and models: [Install](docs/install.md).

## Use

**Just ask.** Claude hands the job to the `cli-dispatch:runner` agent, which runs the worker, verifies the result and returns a patch for review:

```text
add() in math.mjs is broken. Delegate the fix to DeepSeek, verify with node --test.
```

**Run it yourself.** No LLM tokens are spent on orchestration:

```text
/cli-dispatch:run cx "Fix add() in math.mjs" --verify 'node --test'
```

**Ask a one-shot question.** Read-only, with no repo changes:

```text
/cli-dispatch:ask ds "Explain what this regex matches: ^\d{3}-\d{4}$"
```

Backends: `ds` DeepSeek · `ag` Antigravity · `cx` Codex · `oc` OpenCode · `cp` Copilot. The 12 commands are listed by `/cli-dispatch:help`; details are in [Commands](docs/commands.md).

> ⚠️ Workers can write files and run commands. Real repo work stays in a git worktree until you apply the patch ([Security and data](docs/security.md)).

## Update

```text
/plugin update cli-dispatch
/reload-plugins
/cli-dispatch:setup
```

Re-running setup refreshes the wrappers in `~/.local/bin`, which `/plugin update` does not touch.

## Documentation

[Install](docs/install.md) · [Commands](docs/commands.md) · [Deterministic runner](docs/runner.md) · [Sessions](docs/sessions.md) · [Policy injection](docs/policy-injection.md) · [Statusline](docs/statusline.md) · [Usage & quota](docs/quota.md) · [Features](docs/features.md) · [Internals](docs/internals.md) · [Windows](docs/windows.md) · [Security](docs/security.md) · [Uninstall](docs/uninstall.md) · [Terminal reference](TERMINAL.md) · [Changelog](CHANGELOG.md)

## License

MIT, see [LICENSE](LICENSE).
