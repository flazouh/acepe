import type { ComparisonData } from "./types.js";

export const t3Comparison: ComparisonData = {
	slug: "t3",
	competitorName: "T3",
	competitorUrl: "https://github.com/pingdotgg/t3code",
	verificationStatus: "verified",
	lastVerifiedOn: "2026-04-02",
	sourceNotes: [
		{
			url: "https://github.com/pingdotgg/t3code",
			note: "Verified T3 Code public README for product positioning, supported providers, and installation options on 2026-04-02.",
		},
		{
			url: "https://github.com/pingdotgg/t3code",
			note: "Verified worktree-mode and checkpoint-related flows against the public repository code on 2026-04-02.",
		},
	],
	heroTagline: "Acepe vs T3",
	heroDescription:
		"T3 Code is a minimal GUI for coding agents, currently Codex and Claude, with desktop installers and a public codebase that includes worktree and checkpoint flows. Acepe competes with broader built-in agent support and a richer operator surface around live sessions.",
	features: [
		{
			category: "Agents",
			feature: "Supported agents",
			acepe: "Claude Code, Codex, Cursor Agent, OpenCode",
			competitor: "Public README says T3 Code currently supports Codex and Claude",
		},
		{
			category: "Workflow",
			feature: "Attention queue",
			acepe: "Surfaces the session that needs your response next",
			competitor: "Not highlighted in the public README; the product is described as a minimal GUI",
		},
		{
			category: "Workflow",
			feature: "Interface style",
			acepe: "Operator-focused ADE with queue, panels, and richer session context",
			competitor: "Public README positions T3 Code as a minimal web GUI for coding agents",
		},
		{
			category: "Workflow",
			feature: "Worktree mode",
			acepe: "One-click worktree per session",
			competitor:
				"Public repository code and tests include worktree-mode thread flows and `.t3/worktrees` paths",
		},
		{
			category: "Safety",
			feature: "Checkpoint history",
			acepe: "Automatic snapshots after every tool run",
			competitor:
				"Public repository code contains checkpoint tracking, checkpoint diffs, and projection flows",
		},
		{
			category: "Platform",
			feature: "Install / distribution",
			acepe: "macOS desktop app today",
			competitor: "Public README highlights `npx t3`, GitHub Releases, Homebrew, winget, and AUR",
		},
		{
			category: "Tools",
			feature: "SQL editor",
			acepe: "Built-in SQL Studio",
			competitor: "Not highlighted in the public README or repository overview",
		},
		{
			category: "Workflow",
			feature: "Skills / MCP surface",
			acepe: "Skills management and MCP integrations are visible product surfaces",
			competitor:
				"Not highlighted in the public README; repository code includes MCP-related UI paths but the product positioning stays intentionally minimal",
		},
	],
	differentiators: [
		{
			title: "Acepe covers more built-in agents today",
			description:
				"If you want Claude Code, Codex, Cursor Agent, and OpenCode under one roof, Acepe covers a broader built-in agent set than T3 Code’s current public README.",
		},
		{
			title: "Acepe is less minimal and more operational",
			description:
				"T3 Code explicitly leans into a minimal GUI. Acepe makes the opposite tradeoff: more queueing, more visible session context, and more operator-focused UI around long-running work.",
		},
		{
			title: "Acepe includes SQL Studio in the core app",
			description:
				"Built-in database tooling remains one of Acepe’s clearest differentiators from thinner coding-agent shells.",
		},
	],
	faqs: [
		{
			question: "What is the exact T3 product this page compares against?",
			answer:
				"This page compares Acepe against T3 Code, the public repository at `pingdotgg/t3code`, which describes itself as a minimal GUI for Codex and Claude.",
		},
		{
			question: "Does T3 Code support worktrees and checkpoints?",
			answer:
				"Based on the public repository, yes. The codebase contains worktree-mode thread flows and checkpoint-related tracking and diff components.",
		},
		{
			question: "Why would I choose Acepe over a minimal interface?",
			answer:
				"Choose Acepe if you want more visibility and control across several sessions: more built-in agents, attention queue, richer context, and built-in SQL tooling.",
		},
		{
			question: "Does Acepe include SQL Studio?",
			answer: "Yes. Acepe includes a built-in SQL editor and schema browser.",
		},
		{
			question: "Does Acepe support Claude Code and Codex too?",
			answer:
				"Yes. Acepe supports Claude Code and Codex, plus Cursor Agent and OpenCode, in the same environment.",
		},
	],
	metaTitle: "Acepe vs T3 — Multi-Agent Control Surface vs Minimal Agent Interface",
	metaDescription:
		"Compare Acepe and T3 Code side by side. T3 Code is a minimal GUI for Codex and Claude, while Acepe differentiates with broader agent support, richer session triage, and SQL Studio.",
};
