<p align="center">
  <img src="packages/website/static/images/landing/acepe-working-view.png" width="1200" alt="Acepe working view" />
</p>

<div align="center">

# Acepe

**The next-generation Agentic Developer Environment.**

A native desktop app for running, coordinating, and supervising AI agents across real software projects.<br/>
Use Acepe to orchestrate agents, review their work, manage git flows, and ship pull requests without losing control of what changed.

<br/>

<a href="https://acepe.dev">Website</a>
&nbsp;&nbsp;&bull;&nbsp;&nbsp;
<a href="https://acepe.dev/docs">Docs</a>
&nbsp;&nbsp;&bull;&nbsp;&nbsp;
<a href="https://acepe.dev/download">Download</a>
&nbsp;&nbsp;&bull;&nbsp;&nbsp;
<a href="https://discord.gg/acepe">Discord</a>

<br/>

[![CI](https://github.com/flazouh/acepe/actions/workflows/ci.yml/badge.svg)](https://github.com/flazouh/acepe/actions)
[![License](https://img.shields.io/badge/License-FSL--1.1--ALv2-blue.svg)](LICENSE)
[![Rust](https://img.shields.io/badge/Rust-2021-orange?logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![Tauri](https://img.shields.io/badge/Tauri-2.0-24C8D8?logo=tauri&logoColor=white)](https://tauri.app/)

</div>

---

## What is Acepe?

Acepe is an **Agentic Developer Environment (ADE)** built for teams and developers who want AI agents to do real work inside a controlled engineering workflow.

Instead of treating agents like chat tabs or editor plugins, Acepe gives you a workspace to run multiple agents in parallel, inspect every tool call, review every file change, manage branches and worktrees, and turn useful output into commits and pull requests.

### Why Acepe?

- **Orchestrate agents, don't just chat with them** — Run multiple agents side by side across multiple repos and tasks.
- **Review before you trust** — Inspect diffs, tool calls, checkpoints, and generated changes before they land.
- **Ship from one place** — Manage branches, commits, and pull requests without bouncing across tools.
- **Built for serious project work** — Native desktop app, worktree-aware, and designed for long-running agent sessions.

## Features

### Agent Orchestration
- **Multi-agent sessions** — Run multiple agents across multiple projects simultaneously
- **Agent marketplace** — Install agents (Claude Code, Cursor, Codex, OpenCode) or register custom ones
- **Model selection** — Switch models and modes per session
- **Session history** — Full conversation history with search, forking, and resuming

### Review & Change Control
- **Diff viewer** — Side-by-side and unified diffs with syntax highlighting
- **Checkpoints** — Snapshot file state, compare across checkpoints, revert individual files or entire checkpoints
- **Modified files panel** — Track all agent changes with +/- stats and file tree navigation
- **Git integration** — Branch management, staging, commits, push/pull — all from the UI

### Guardrails & Visibility
- **Granular permissions** — Approve, deny, or auto-approve tool calls per type (read, write, terminal, web)
- **Permission queue** — Batch-review pending tool requests
- **Execution history** — See every tool call with inputs, outputs, and timing

### Shipping Workflow
- **PR workflow** — Create, review, and merge pull requests
- **Commit badges** — SHAs and PR references render as interactive badges in conversations
- **Diff stats** — Inline +X -Y change counts on badges, click to open full diff viewer

### Workspace for Agentic Work
- **Multi-project** — Work across multiple repositories in a single window
- **Multi-panel layout** — Resizable panels with per-panel agent sessions
- **Built-in terminal** — Native PTY terminal embedded per agent panel
- **Built-in browser** — Webview panel with navigation for previewing apps
- **SQL Studio** — Connect to SQLite, PostgreSQL, MySQL, or browse S3 buckets
- **@-mentions** — Reference files, code, and images in messages

### Built for Real Teams
- **Worktree support** — Isolated git worktrees for parallel agent work
- **Keyboard shortcuts** — Customizable keybindings and command palette
- **Dark / light mode** — System-aware theming
- **Auto-updates** — Built-in updater for new releases
- **Notifications** — Native OS notifications for agent activity

## Supported Agents

Acepe is designed to be the place where you manage agent work, regardless of which coding agent you prefer.

| Agent | Provider | Protocol |
|-------|----------|----------|
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | Anthropic | JSON-RPC / stdio |
| [Cursor](https://cursor.com) | Anysphere | JSON-RPC / stdio |
| [Codex](https://github.com/zed-industries/codex) | Zed Industries | JSON-RPC / stdio |
| [OpenCode](https://github.com/nichochar/opencode) | Community | HTTP / SSE |

## Quick Start

Use Acepe when you want AI agents to operate inside a workflow that still feels like disciplined software engineering: parallel sessions, visible changes, review checkpoints, and a clean path to a PR.

### Download

Grab the latest release from [acepe.dev/download](https://acepe.dev/download) or the [releases page](https://github.com/flazouh/acepe/releases).

### Build from Source

```bash
git clone https://github.com/flazouh/acepe.git
cd acepe && bun install
cd packages/desktop && bun run tauri
```

**Prerequisites**: [Bun](https://bun.sh/) 1.3+, [Rust](https://www.rust-lang.org/tools/install) stable, [Tauri prerequisites](https://tauri.app/start/prerequisites/)

## Architecture

Acepe combines a native desktop shell with agent integrations, local project context, review tooling, and git workflows so you can keep the entire loop, from prompt to PR, in one place.

```
┌──────────────────────────────────┐
│  Frontend (SvelteKit + Svelte 5) │
│  Agent workspace, review UI      │
└───────────────┬──────────────────┘
                │ Tauri IPC
┌───────────────▼──────────────────┐
│  Backend (Tauri + Rust)          │
│  Sessions, git, indexing, state  │
└───────────────┬──────────────────┘
                │ Agent runtimes
┌───────────────▼──────────────────┐
│  Coding agents                   │
│  Claude, Cursor, Codex, OpenCode │
└──────────────────────────────────┘
```

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) to get started.

If you're looking for something to work on, check issues tagged [`good first issue`](https://github.com/flazouh/acepe/issues?q=label%3A%22good+first+issue%22) or [`help wanted`](https://github.com/flazouh/acepe/issues?q=label%3A%22help+wanted%22).

## License

[FSL-1.1-ALv2](https://fsl.software) — source-available today, Apache 2.0 after two years. See [LICENSE](LICENSE) for details.

## Acknowledgments

Built with [Tauri](https://tauri.app/), [Svelte](https://svelte.dev/), and [shadcn-svelte](https://www.shadcn-svelte.com/).

---

<div align="center">
<sub>Acepe is in active development. Expect rough edges. We'd love your help smoothing them out.</sub>
</div>
