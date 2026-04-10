import type { ComparisonData } from "./types.js";

export const conductorComparison: ComparisonData = {
	slug: "conductor",
	competitorName: "Conductor",
	competitorUrl: "https://www.conductor.build",
	verificationStatus: "verified",
	lastVerifiedOn: "2026-04-02",
	sourceNotes: [
		{
			url: "https://www.conductor.build",
			note: "Verified Conductor homepage and public FAQ for Mac positioning, Claude Code + Codex support, isolated worktrees, and the at-a-glance operator workflow wording on 2026-04-02.",
		},
		{
			url: "https://docs.conductor.build/",
			note: "Verified Conductor public docs home for the published feature index covering Diff viewer, MCP, and Slash commands on 2026-04-02.",
		},
		{
			url: "https://www.conductor.build/changelog",
			note: "Verified Conductor public changelog for checkpoints, plan mode, sharable approved plans, tool approvals, and related review workflows on 2026-04-02.",
		},
	],
	heroTagline: "Acepe vs Conductor",
	heroDescription:
		"Conductor is a polished Mac app for running teams of Claude Code and Codex agents in isolated workspaces, then reviewing and merging their changes. Acepe competes with broader built-in agent coverage, an explicit attention queue, checkpoints, and built-in SQL Studio.",
	features: [
		{
			category: "Agents",
			feature: "Supported agents",
			acepe: "Claude Code, Codex, Cursor Agent, and OpenCode",
			competitor: "Conductor homepage FAQ says it supports Claude Code and Codex",
		},
		{
			category: "Workflow",
			feature: "Attention / triage surface",
			acepe:
				"Dedicated attention queue for questions, permissions, and completions across sessions",
			competitor:
				"Homepage says you can see what needs attention at a glance, and the public changelog highlights next-workspace and status-driven flows",
		},
		{
			category: "Workflow",
			feature: "Plan mode",
			acepe: "Structured plans with readable markdown preview before execution",
			competitor:
				"Public changelog highlights plan mode, approve-with-feedback flows, and one-click sharing of approved plans",
		},
		{
			category: "Safety",
			feature: "Checkpoint recovery",
			acepe: "Automatic snapshots after each tool run with per-file or per-session revert",
			competitor:
				"Public changelog highlights checkpoints and resetting Codex sessions to a previous turn",
		},
		{
			category: "Safety",
			feature: "Worktree isolation",
			acepe: "One-click Git worktree per session",
			competitor: "Homepage FAQ says each Conductor workspace is a new git worktree",
		},
		{
			category: "Workflow",
			feature: "MCP and slash commands",
			acepe: "Visible MCP integrations and reusable skills inside the app",
			competitor: "Public docs home lists MCP and Slash commands as core product features",
		},
		{
			category: "Tools",
			feature: "SQL editor",
			acepe: "Built-in SQL Studio with schema browser",
			competitor: "Not highlighted in Conductor public site, docs home, or changelog",
		},
		{
			category: "Platform",
			feature: "Desktop platform focus",
			acepe: "macOS today; Linux and Windows are planned",
			competitor: "Conductor publicly positions itself as a Mac app",
		},
	],
	differentiators: [
		{
			title: "Acepe covers more built-in agents today",
			description:
				"Conductor is a serious peer for Mac-based multi-agent work, but its public positioning stays focused on Claude Code and Codex. Acepe is broader today if you want Cursor Agent and OpenCode in the same environment too.",
		},
		{
			title: "Acepe keeps session triage more explicit",
			description:
				"Conductor clearly supports at-a-glance coordination, but Acepe puts more product weight on the attention queue itself when several agent threads need operator input at once.",
		},
		{
			title: "Acepe includes SQL Studio in the core app",
			description:
				"Built-in database inspection and query workflows remain one of Acepe's clearest differentiators when you want the agent loop and the data layer in one place.",
		},
	],
	faqs: [
		{
			question: "What Conductor product is this page comparing against?",
			answer:
				"This page compares Acepe against Conductor at conductor.build, the Mac app that publicly positions itself around teams of Claude Code and Codex agents working in isolated workspaces.",
		},
		{
			question: "Does Conductor support worktrees?",
			answer: "Yes. Conductor's public homepage FAQ says each workspace is a new git worktree.",
		},
		{
			question: "Does Conductor support MCP and slash commands?",
			answer:
				"Yes. Conductor's public docs home lists both MCP and Slash commands in its feature index.",
		},
		{
			question: "Why choose Acepe over Conductor?",
			answer:
				"Choose Acepe if you want broader built-in agent coverage, an explicit attention queue, checkpoints tied to the session, and built-in SQL Studio in the same operator surface.",
		},
		{
			question: "Does Acepe include built-in SQL tooling?",
			answer: "Yes. Acepe includes SQL Studio with a schema browser and query editor.",
		},
	],
	metaTitle: "Acepe vs Conductor — Broader Agent Coverage vs Mac-Native Agent Workspace",
	metaDescription:
		"Compare Acepe and Conductor side by side. Conductor is a Mac app for Claude Code and Codex workspaces with worktrees and review flows, while Acepe differentiates with broader agent coverage, explicit session triage, checkpoints, and SQL Studio.",
};
