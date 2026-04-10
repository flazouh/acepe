import type { ComparisonData } from "./types.js";

export const cursorComparison: ComparisonData = {
	slug: "cursor",
	competitorName: "Cursor",
	competitorUrl: "https://cursor.com",
	verificationStatus: "verified",
	lastVerifiedOn: "2026-04-02",
	sourceNotes: [
		{
			url: "https://cursor.com/product",
			note: "Verified Cursor product positioning, parallel subagents, plan mode, checkpoints, skills, CLI, and multi-surface support on 2026-04-02.",
		},
		{
			url: "https://cursor.com/pricing",
			note: "Verified Hobby free tier, paid plans, cloud agents in Pro, and usage-limited free access on 2026-04-02.",
		},
	],
	heroTagline: "Acepe vs Cursor",
	heroDescription:
		"Cursor is an AI-native coding product that spans editor, CLI, cloud agents, and other surfaces. Acepe is an agentic developer environment focused on orchestrating multiple agents side by side with stronger session visibility and control.",
	features: [
		{
			category: "Agents",
			feature: "Multi-agent support",
			acepe: "Claude Code, Codex, Cursor Agent, OpenCode — all side by side",
			competitor: "Cursor spans multiple models and surfaces inside the Cursor ecosystem",
		},
		{
			category: "Agents",
			feature: "Agent protocol",
			acepe: "ACP (Agent Client Protocol) — open standard",
			competitor: "Proprietary Cursor platform",
		},
		{
			category: "Agents",
			feature: "Parallel sessions",
			acepe: true,
			competitor: "Cursor publicly documents subagents and cloud agents running in parallel",
		},
		{
			category: "Workflow",
			feature: "Attention queue",
			acepe: "Surfaces which sessions need you — permissions, questions, completions",
			competitor: "Not highlighted as a dedicated product surface in public Cursor materials",
		},
		{
			category: "Workflow",
			feature: "Kanban view",
			acepe: "Bird's-eye view of all agent sessions by state",
			competitor: "Not documented publicly",
		},
		{
			category: "Workflow",
			feature: "Plan mode UI",
			acepe: "Rendered markdown with copy, download, and preview",
			competitor: "Cursor publicly documents planning mode inside its agent workflow",
		},
		{
			category: "Safety",
			feature: "Checkpoints",
			acepe: "File snapshots after every tool run, revert per-file or per-session",
			competitor: "Cursor publicly documents Git and checkpoints inside the product",
		},
		{
			category: "Safety",
			feature: "Worktree isolation",
			acepe: "One-click Git worktree per session",
			competitor: "Not highlighted in public Cursor product pages",
		},
		{
			category: "Tools",
			feature: "SQL editor",
			acepe: "Built-in SQL Studio with schema browser",
			competitor: "Not highlighted in public Cursor product pages",
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
			competitor: "Hobby plan is free with limited Agent requests and limited Tab completions",
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
				"Cursor supports a broad set of AI workflows inside the Cursor ecosystem. Acepe differentiates by letting you orchestrate several external agents side by side in one operator surface, with project context, worktrees, and a unified queue across sessions.",
		},
		{
			title: "The attention queue tells you what needs you",
			description:
				"When multiple coding sessions are moving at once, Acepe gives you a dedicated queue for permissions, questions, and completions. That operator layer is the clearest product difference in day-to-day use.",
		},
		{
			title: "Checkpoints you can actually revert",
			description:
				"Acepe snapshots your files after every tool run and keeps that history attached to the session. If an agent goes sideways, you can revert a file or a whole session without reconstructing the context yourself.",
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
			answer: "macOS right now. Linux and Windows are coming.",
		},
		{
			question: "Does Acepe store my code?",
			answer:
				"No. Everything runs locally. Acepe never sees your code. The agents handle their own data policies.",
		},
	],
	metaTitle: "Acepe vs Cursor — Multi-Agent Orchestration vs AI Code Editor",
	metaDescription:
		"Compare Acepe and Cursor side by side. Cursor spans editor, CLI, cloud agents, and multiple AI workflows. Acepe focuses on multi-agent orchestration, attention queue, checkpoints, and operator visibility.",
};
