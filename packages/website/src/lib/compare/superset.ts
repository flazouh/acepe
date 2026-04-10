import type { ComparisonData } from "./types.js";

export const supersetComparison: ComparisonData = {
	slug: "superset",
	competitorName: "Superset",
	competitorUrl: "https://superset.sh",
	verificationStatus: "verified",
	lastVerifiedOn: "2026-04-02",
	sourceNotes: [
		{
			url: "https://superset.sh",
			note: "Verified Superset homepage claims for parallel agents, any CLI agent support, worktree isolation, and IDE interoperability on 2026-04-02.",
		},
		{
			url: "https://docs.superset.sh/",
			note: "Verified Superset installation docs covering macOS requirements and published platform support on 2026-04-02.",
		},
	],
	heroTagline: "Acepe vs Superset",
	heroDescription:
		"Superset is a terminal-first environment for running many CLI agents in parallel with worktree isolation. Acepe is more opinionated about the operator layer around those sessions, with an attention queue, richer session context, and built-in tools like SQL Studio.",
	features: [
		{
			category: "Workflow",
			feature: "Attention queue",
			acepe: "Surfaces permissions, questions, failures, and completions across sessions",
			competitor: "Not highlighted as a dedicated product surface in public Superset materials",
		},
		{
			category: "Workflow",
			feature: "Side-by-side channels",
			acepe: "Run multiple agent sessions with visible parallel progress",
			competitor: "Superset publicly emphasizes many agents and side-by-side code review surfaces",
		},
		{
			category: "Workflow",
			feature: "Skills management",
			acepe: "Manage reusable agent workflows inside the app",
			competitor: "Not highlighted in public Superset materials",
		},
		{
			category: "Workflow",
			feature: "Session context",
			acepe: "Color-coded sessions with project labels and live status",
			competitor: "Terminal, worktree, and diff-oriented workflow",
		},
		{
			category: "Safety",
			feature: "Checkpoints",
			acepe: "Automatic file snapshots after each tool run",
			competitor: "Superset publicly emphasizes git diffs, review flows, and isolated worktrees",
		},
		{
			category: "Safety",
			feature: "Worktree isolation",
			acepe: "One-click Git worktree per agent session",
			competitor: "Each agent runs in its own isolated Git worktree",
		},
		{
			category: "Tools",
			feature: "SQL editor",
			acepe: "Built-in SQL Studio with schema browser",
			competitor: "Not highlighted in public Superset materials",
		},
		{
			category: "Tools",
			feature: "Multi-agent support",
			acepe: "Claude Code, Codex, Cursor Agent, and OpenCode",
			competitor:
				"Works with any CLI agent, including Claude Code, OpenCode, Codex, Gemini, and Cursor Agent",
		},
	],
	differentiators: [
		{
			title: "Acepe helps you operate agent work, not just run it",
			description:
				"Superset clearly supports parallel CLI-agent workflows. Acepe differentiates by giving you a stronger coordination layer around those sessions: attention queue, prioritization, checkpoints, and project-aware context.",
		},
		{
			title: "Parallel work stays readable",
			description:
				"If you want more explicit session state, color-coding, and a UI that helps you triage several running tasks, Acepe leans more into that operator experience.",
		},
		{
			title: "You get purpose-built tools around the agent loop",
			description:
				"Built-in SQL Studio, plan rendering, and session-level controls make Acepe feel like an agentic development environment rather than only a terminal-centered workspace.",
		},
	],
	faqs: [
		{
			question: "Is Acepe just another terminal manager?",
			answer:
				"No. Acepe is built around orchestrating agents safely: attention queue, checkpoints, worktrees, plan rendering, and purpose-built developer tooling.",
		},
		{
			question: "Can I run multiple agents at once in Acepe?",
			answer:
				"Yes. Acepe is designed for parallel sessions across multiple agents and projects, with clear visibility into which session needs you next.",
		},
		{
			question: "Does Acepe include a SQL editor?",
			answer:
				"Yes. Acepe includes SQL Studio with a schema browser and query editor so database work stays inside the same environment as your agent sessions.",
		},
		{
			question: "Is Acepe free for local workflows?",
			answer:
				"Yes. The desktop app, local sessions, checkpoints, Git integration, SQL Studio, and keyboard workflows are free.",
		},
		{
			question: "Does Acepe replace my editor?",
			answer:
				"No. Acepe sits alongside your editor as the orchestration layer for agent work. Keep VS Code, Cursor, or any editor you already like.",
		},
	],
	metaTitle: "Acepe vs Superset — Agent Operations Layer vs Terminal-First Workflow",
	metaDescription:
		"Compare Acepe and Superset side by side. Superset emphasizes terminal-first parallel agent workflows and worktree isolation, while Acepe adds an attention queue, richer session context, and SQL Studio.",
};
