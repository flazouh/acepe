import type { ComparisonData } from "./types.js";

export const cursorComparison: ComparisonData = {
	slug: "cursor",
	competitorName: "Cursor",
	competitorUrl: "https://cursor.com",
	heroTagline: "Acepe vs Cursor",
	heroDescription:
		"Cursor is a code editor with built-in AI. Acepe is an agentic developer environment that orchestrates any agent — including Cursor Agent — in parallel sessions with full visibility and control.",
	features: [
		{
			category: "Agents",
			feature: "Multi-agent support",
			acepe: "Claude Code, Codex, Cursor Agent, OpenCode — all side by side",
			competitor: "Cursor Agent only",
		},
		{
			category: "Agents",
			feature: "Agent protocol",
			acepe: "ACP (Agent Client Protocol) — open standard",
			competitor: "Proprietary",
		},
		{
			category: "Agents",
			feature: "Parallel sessions",
			acepe: true,
			competitor: false,
		},
		{
			category: "Workflow",
			feature: "Attention queue",
			acepe: "Surfaces which sessions need you — permissions, questions, completions",
			competitor: false,
		},
		{
			category: "Workflow",
			feature: "Kanban view",
			acepe: "Bird's-eye view of all agent sessions by state",
			competitor: false,
		},
		{
			category: "Workflow",
			feature: "Plan mode UI",
			acepe: "Rendered markdown with copy, download, and preview",
			competitor: "Plain text in editor",
		},
		{
			category: "Safety",
			feature: "Checkpoints",
			acepe: "File snapshots after every tool run, revert per-file or per-session",
			competitor: "Manual git commits",
		},
		{
			category: "Safety",
			feature: "Worktree isolation",
			acepe: "One-click Git worktree per session",
			competitor: false,
		},
		{
			category: "Tools",
			feature: "SQL editor",
			acepe: "Built-in SQL Studio with schema browser",
			competitor: false,
		},
		{
			category: "Tools",
			feature: "Code editor",
			acepe: false,
			competitor: "Full VS Code fork with AI-native editing",
		},
		{
			category: "Tools",
			feature: "Inline completions",
			acepe: false,
			competitor: "Tab autocomplete, multi-line predictions",
		},
		{
			category: "Pricing",
			feature: "Free tier",
			acepe: "Free forever — all local features included",
			competitor: "Free tier with usage limits",
		},
		{
			category: "Pricing",
			feature: "License",
			acepe: "FSL-1.1-ALv2 (source-available, Apache 2.0 after 2 years)",
			competitor: "Proprietary, closed-source",
		},
		{
			category: "Platform",
			feature: "macOS",
			acepe: true,
			competitor: true,
		},
		{
			category: "Platform",
			feature: "Linux",
			acepe: "Coming soon",
			competitor: true,
		},
		{
			category: "Platform",
			feature: "Windows",
			acepe: "Coming soon",
			competitor: true,
		},
	],
	differentiators: [
		{
			title: "Orchestrate multiple agents at once",
			description:
				"Cursor runs one agent in one editor. Acepe runs Claude Code, Codex, Cursor Agent, and OpenCode in parallel sessions — each with its own project context, worktree, and checkpoint trail. Assign different agents to different tasks and monitor them all from one window.",
		},
		{
			title: "The attention queue tells you what needs you",
			description:
				"When you have multiple agents running, the hard problem is knowing which one needs your input. Acepe's attention queue surfaces permissions, questions, and completions so you can triage across sessions instead of polling each one.",
		},
		{
			title: "Checkpoints you can actually revert",
			description:
				"Acepe snapshots your files after every tool run. If an agent goes sideways, revert a single file or the entire session to any checkpoint. No manual git-stash ceremony — the safety net is automatic.",
		},
	],
	faqs: [
		{
			question: "Can I use Cursor Agent inside Acepe?",
			answer:
				"Yes. Acepe runs Cursor Agent as one of its supported agents via ACP. You get Cursor's agentic capabilities inside Acepe's orchestration layer.",
		},
		{
			question: "Does Acepe replace my code editor?",
			answer:
				"No. Acepe is a developer environment for orchestrating AI agents, not a code editor. Use it alongside VS Code, Cursor, or any editor you prefer.",
		},
		{
			question: "Is Acepe free?",
			answer:
				"Yes. The desktop app, local agent sessions, checkpoints, Git integration, SQL Studio, and keyboard workflows are all free. No trial, no time limit.",
		},
		{
			question: "What operating systems are supported?",
			answer:
				"macOS right now. Linux and Windows are coming.",
		},
		{
			question: "Does Acepe store my code?",
			answer:
				"No. Everything runs locally. Acepe never sees your code. The agents handle their own data policies.",
		},
	],
	metaTitle: "Acepe vs Cursor — Multi-Agent Orchestration vs AI Code Editor",
	metaDescription:
		"Compare Acepe and Cursor side by side. Acepe orchestrates Claude Code, Codex, Cursor Agent, and OpenCode in parallel. Cursor is an AI-native code editor. See which fits your workflow.",
};
