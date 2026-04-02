import type { ComparisonData } from './types.js';

export const onecodeComparison: ComparisonData = {
	slug: '1code',
	competitorName: '1Code',
	competitorUrl: 'https://1code.dev',
	verificationStatus: 'verified',
	lastVerifiedOn: '2026-04-02',
	sourceNotes: [
		{
			url: 'https://github.com/21st-dev/1Code',
			note: 'Verified 1Code public README and repository structure for agent support, worktree isolation, background agents, kanban, MCP/plugins, plan mode, browser previews, and platform claims on 2026-04-02.',
		},
		{
			url: 'https://1code.dev',
			note: 'Verified the product domain from the public repository materials on 2026-04-02.',
		},
	],
	heroTagline: 'Acepe vs 1Code',
	heroDescription:
		'1Code is an open-source coding agent client centered on Claude Code and Codex, with worktrees, background agents, kanban, and live browser previews. Acepe competes with broader built-in agent coverage, an attention queue, and SQL Studio.',
	features: [
		{
			category: 'Agents',
			feature: 'Supported agents',
			acepe: 'Claude Code, Codex, Cursor Agent, and OpenCode',
			competitor: 'Public README highlights Claude Code and Codex, with “and more” in the top-level positioning copy',
		},
		{
			category: 'Workflow',
			feature: 'Attention queue',
			acepe: 'Ranks sessions by urgency so you know what needs you next',
			competitor: 'Public materials emphasize message queue and kanban rather than a dedicated attention queue',
		},
		{
			category: 'Workflow',
			feature: 'Kanban board',
			acepe: 'Bird’s-eye view of all session states inside the app',
			competitor: 'Public README highlights a visual kanban board for agent sessions',
		},
		{
			category: 'Workflow',
			feature: 'Plan mode',
			acepe: 'Structured plans with readable markdown preview before execution',
			competitor: 'Public README highlights clarifying questions, structured plans, and markdown preview',
		},
		{
			category: 'Workflow',
			feature: 'Skills, slash commands, and MCP',
			acepe: 'ACP-based agents plus skills management and MCP integrations',
			competitor: 'Public README highlights MCP & plugins, skills & slash commands, and custom sub-agents',
		},
		{
			category: 'Safety',
			feature: 'Git worktree isolation',
			acepe: 'One-click worktree per session',
			competitor: 'Each chat runs in its own isolated worktree',
		},
		{
			category: 'Safety',
			feature: 'Rollback / checkpoint-style recovery',
			acepe: 'Automatic checkpoints with per-file or per-session revert',
			competitor: 'Public README highlights rollback from user message bubbles; the public materials do not center checkpoint history as strongly',
		},
		{
			category: 'Tools',
			feature: 'SQL editor',
			acepe: 'Built-in SQL Studio',
			competitor: 'Not highlighted in the public README or repository overview',
		},
		{
			category: 'Tools',
			feature: 'Browser previews',
			acepe: 'Cloud agents are planned, but live browser previews are not a core public feature today',
			competitor: 'Public README highlights live browser previews for background agents',
		},
		{
			category: 'Platform',
			feature: 'Platform support',
			acepe: 'macOS today; Linux and Windows are planned',
			competitor: 'Public README highlights macOS desktop, web app, Windows, and Linux',
		},
	],
	differentiators: [
		{
			title: 'Acepe covers more built-in agent options today',
			description:
				'If you want Claude Code, Codex, Cursor Agent, and OpenCode in one environment, Acepe covers a broader built-in agent set than what 1Code currently highlights publicly.',
		},
		{
			title: 'Acepe keeps more emphasis on session triage',
			description:
				'1Code is richer than our earlier draft implied, but Acepe still puts more product weight on the attention queue and session prioritization when many threads need operator input.',
		},
		{
			title: 'Acepe includes SQL Studio in the core app',
			description:
				'Database inspection and queries stay inside Acepe instead of depending on a separate database tool.',
		},
	],
	faqs: [
		{
			question: 'How does Acepe differ from 1Code at a high level?',
			answer:
				'1Code publicly emphasizes Claude Code/Codex workflows, worktrees, background agents, kanban, and browser previews. Acepe differentiates with broader built-in agent coverage, stronger session triage, and SQL Studio.',
		},
		{
			question: 'Does 1Code support background agents?',
			answer:
				'Yes. The public 1Code README highlights cloud sandboxes and background agents that keep running while your laptop sleeps.',
		},
		{
			question: 'Does Acepe include built-in SQL tooling?',
			answer:
				'Yes. SQL Studio is built in so you can inspect schemas and run queries without bouncing to another app.',
		},
		{
			question: 'Which agents does 1Code highlight publicly?',
			answer:
				'Its public README specifically highlights Claude Code and Codex, while also using “and more” in the top-level positioning copy.',
		},
		{
			question: 'Is 1Code more cross-platform than Acepe today?',
			answer:
				'Based on the public README, yes. 1Code highlights macOS, web, Windows, and Linux support, while Acepe is currently macOS-first.',
		},
	],
	metaTitle: 'Acepe vs 1Code — Operator-Focused ADE vs Open-Source Agent Client',
	metaDescription:
		'Compare Acepe and 1Code side by side. 1Code highlights Claude Code/Codex, worktrees, background agents, and kanban. Acepe differentiates with broader agent coverage, session triage, and SQL Studio.',
};