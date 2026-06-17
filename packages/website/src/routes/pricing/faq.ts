export interface PricingFaqComparisonLink {
	readonly href: string;
	readonly label: string;
}

export interface PricingFaqItem {
	readonly q: string;
	readonly a: string;
	readonly comparisonLink: PricingFaqComparisonLink | null;
}

export const pricingFaqItems: readonly PricingFaqItem[] = [
	{
		q: "Is the free plan really free?",
		a: "Yes. The desktop app, local agent sessions, checkpoints, Git integration, SQL Studio, and keyboard workflows are all free. No trial, no time limit.",
		comparisonLink: null,
	},
	{
		q: "What are cloud agents?",
		a: "They let you run coding sessions on remote machines. Queue up work, close your laptop, check results later. Your local Acepe app connects to them automatically.",
		comparisonLink: null,
	},
	{
		q: "When will Premium launch?",
		a: "We're building the cloud infrastructure now. We'll announce Premium availability on the site, changelog, and GitHub releases.",
		comparisonLink: null,
	},
	{
		q: "Do I need a separate subscription?",
		a: "No. Acepe works with agents you already have. If you have a Claude Code or Cursor subscription, just connect it. Acepe picks up your existing authentication automatically.",
		comparisonLink: null,
	},
	{
		q: "Which agents does Acepe support?",
		a: "Claude Code, Codex, Cursor Agent, and OpenCode. You can run any of them side by side, or all at once.",
		comparisonLink: null,
	},
	{
		q: "Can I use Acepe with my own custom agent?",
		a: "If your agent runs in a terminal, it works in Acepe. We plan to add a plugin system for deeper integrations.",
		comparisonLink: null,
	},
	{
		q: "Does Acepe store my code or send it anywhere?",
		a: "No. Everything runs locally on your machine. Acepe never sees your code. The agents you connect handle their own data policies.",
		comparisonLink: null,
	},
	{
		q: "How is Acepe better than Superset?",
		a: "Superset publicly emphasizes a terminal-first workflow with parallel agents and isolated worktrees. Acepe leans harder into the operator layer around those sessions with an attention queue, richer session context, checkpoints, and built-in tools like SQL Studio.",
		comparisonLink: {
			href: "/compare/superset",
			label: "See Acepe vs Superset",
		},
	},
	{
		q: "How is Acepe different from 1Code?",
		a: "1Code publicly emphasizes Claude Code/Codex support, worktrees, background agents, kanban, browser previews, and MCP/plugins. Acepe differentiates with broader built-in agent support, an attention queue, and SQL Studio.",
		comparisonLink: {
			href: "/compare/1code",
			label: "See Acepe vs 1Code",
		},
	},
	{
		q: "How does Acepe compare to T3?",
		a: "T3 Code publicly positions itself as a minimal GUI for Claude and Codex. Acepe differentiates with broader agent coverage, stronger session triage, and built-in SQL Studio.",
		comparisonLink: {
			href: "/compare/t3",
			label: "See Acepe vs T3",
		},
	},
	{
		q: "How does Acepe compare to Conductor?",
		a: "Conductor publicly emphasizes Mac-native Claude Code and Codex workspaces with isolated worktrees, review flows, and strong multi-workspace UX. Acepe differentiates with broader built-in agent coverage, a dedicated attention queue, checkpoints, and built-in SQL Studio.",
		comparisonLink: {
			href: "/compare/conductor",
			label: "See Acepe vs Conductor",
		},
	},
	{
		q: "How is this different from just using multiple terminals?",
		a: "Terminals don't track what each agent is doing, snapshot file changes, or tell you which session needs your attention. Acepe does.",
		comparisonLink: null,
	},
	{
		q: "What operating systems are supported?",
		a: "macOS right now. Linux is next, Windows after that.",
		comparisonLink: null,
	},
	{
		q: "Is Acepe open source?",
		a: "Yes. The full source is on GitHub. You can inspect it, fork it, or contribute.",
		comparisonLink: null,
	},
];
