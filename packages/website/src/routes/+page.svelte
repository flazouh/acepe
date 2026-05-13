<script lang="ts">
import { ArrowRightIcon, BrandLockup, PillButton } from "@acepe/ui";
import { CheckpointTimeline } from "@acepe/ui/checkpoint";
import { PlanCard } from "@acepe/ui/plan-card";
import { AgentSelectionGrid } from "@acepe/ui/agent-panel";
import type { AgentGridItem } from "@acepe/ui/agent-panel";
import { AppSessionItem as AppSessionItemComponent } from "@acepe/ui/app-layout";
import type { AppSessionItemType } from "@acepe/ui/app-layout";
import AgentIconsRow from "$lib/components/agent-icons-row.svelte";
import Header from "$lib/components/header.svelte";
import FeatureShowcase from "$lib/components/feature-showcase.svelte";
import HeroShaderStage from "$lib/components/hero-shader-stage.svelte";
import FeatureCardShader from "$lib/components/feature-card-shader.svelte";
import LazyFeatureMount from "$lib/components/lazy-feature-mount.svelte";
import DevShaderSwitcher from "$lib/components/dev-shader-switcher.svelte";
import {
	Stack,
	ArrowsOutSimple,
	GitBranch,
	HardDrives,
	Queue,
	Command,
	ClockCounterClockwise,
	Lightning,
	Check,
	MagnifyingGlass,
	GithubLogo,
	Kanban,
	GitPullRequest,
	Globe,
	Terminal,
	Microphone,
	ShieldCheck,
	Plug,
} from "phosphor-svelte";

let { data } = $props();

// === Mock data for real component showcases ===

const theme = "dark" as const;

const mockGridAgents: AgentGridItem[] = $derived([
	{
		id: "claude-code",
		name: "Claude Code",
		iconSrc: `/svgs/agents/claude/claude-icon-${theme}.svg`,
		available: true,
	},
	{
		id: "codex",
		name: "Codex",
		iconSrc: `/svgs/agents/codex/codex-icon-${theme}.svg`,
		available: true,
	},
	{
		id: "copilot",
		name: "Copilot",
		iconSrc: `/svgs/agents/copilot/copilot-icon-${theme}.svg`,
		available: true,
	},
	{
		id: "cursor",
		name: "Cursor",
		iconSrc: `/svgs/agents/cursor/cursor-icon-${theme}.svg`,
		available: true,
	},
	{
		id: "opencode",
		name: "OpenCode",
		iconSrc: `/svgs/agents/opencode/opencode-logo-${theme}.svg`,
		available: true,
	},
]);

const mockPlanContent = `Implementation Plan

1. Add rate limiting middleware
- Use token bucket algorithm
- Configure per-endpoint limits

2. Update API routes
- Apply middleware to public endpoints
- Skip for internal service calls

3. Add monitoring
- Track rate limit hits per endpoint
- Alert on sustained high rejection rates`;

const mockCheckpoints = [
	{
		id: "cp-1",
		number: 1,
		message: "Initial scaffold",
		timestamp: Date.now() - 3600000,
		fileCount: 3,
		totalInsertions: 42,
		totalDeletions: 0,
		isAuto: true,
	},
	{
		id: "cp-2",
		number: 2,
		message: "Add auth module",
		timestamp: Date.now() - 1800000,
		fileCount: 5,
		totalInsertions: 120,
		totalDeletions: 18,
		isAuto: false,
	},
	{
		id: "cp-3",
		number: 3,
		message: "Refactor middleware",
		timestamp: Date.now() - 120000,
		fileCount: 4,
		totalInsertions: 23,
		totalDeletions: 8,
		isAuto: true,
	},
];

const mockSessions: AppSessionItemType[] = [
	{
		id: "s1",
		title: "Fix auth middleware",
		status: "running",
		isActive: true,
	},
	{
		id: "s2",
		title: "Write API tests",
		status: "done",
		isActive: false,
	},
	{
		id: "s3",
		title: "Migrate database",
		status: "done",
		isActive: false,
	},
	{
		id: "s4",
		title: "Update README",
		status: "done",
		isActive: false,
	},
];

const features = [
	{
		id: "multi-agent",
		icon: Stack,
		label: "Multi-Agent Support",
		tag: "core",
		description:
			"Claude Code, Codex, Cursor Agent, OpenCode. Switch with ⌘L. Use whichever agent fits the task.",
		usecases: [
			"Use different agents for different tasks without context switching",
			"Run multiple agents in parallel for faster development",
			"Switch agents instantly with keyboard shortcuts",
		],
	},
	{
		id: "parallel",
		icon: ArrowsOutSimple,
		label: "Parallel Sessions & Focus",
		tag: "workflow",
		description:
			"Split your screen between agents working on different tasks. Tab between sessions like a browser. Go full-screen on one when you need to dig in.",
		usecases: [
			"Run agents on separate tasks and see all of them making progress at once",
			"Work across multiple repos at the same time without losing track",
			"Have 10 agents working across different projects with full visibility into each",
		],
	},
	{
		id: "queue",
		icon: Queue,
		label: "Attention Queue",
		tag: "triage",
		description:
			"Sessions sorted by urgency. Questions waiting for you, active errors, and running agents rise to the top. Idle sessions stay out of the way.",
		usecases: [
			"Answer-needed sessions stay at the top until you respond",
			"See errors and active work before idle sessions",
			"Switch context quickly without hunting through terminals",
		],
	},
	{
		id: "kanban",
		icon: Kanban,
		label: "Kanban Board",
		tag: "view",
		description:
			"See every session as a card across columns: Working, Needs review, Done. Drag-and-drop, batch actions, project grouping — without leaving the app.",
		usecases: [
			"Triage dozens of sessions at a glance",
			"Group by project, status, or attention level",
			"Move sessions through your pipeline like JIRA tickets",
		],
	},
	{
		id: "review",
		icon: Check,
		label: "Review Workspace",
		tag: "verify",
		description:
			"Inspect every modified file before you ship. Side-by-side diffs, accept/reject per hunk, and PR card preview — the gate between agent output and main.",
		usecases: [
			"Step through every file the agent touched",
			"Accept or reject changes hunk by hunk",
			"Preview the PR card before opening it",
		],
	},
	{
		id: "plan-mode",
		icon: Lightning,
		label: "Plan Mode",
		tag: "planning",
		description:
			"Agent plan mode outputs a wall of text in your terminal. Acepe renders it as clean markdown with one-click copy, download, and preview toggle.",
		usecases: [
			"Built-in review and deepen skills refine plans before execution",
			"Plans render as clean markdown you can copy or download",
			"Read through the plan, adjust if needed, then run",
		],
	},
	{
		id: "checkpoints",
		icon: GitBranch,
		label: "Checkpoints",
		tag: "safety",
		description:
			"Point-in-time file snapshots at every step. If the agent goes sideways, revert the whole session or just the files you care about.",
		usecases: [
			"Auto-checkpoints capture state after each tool run",
			"Revert entire project or individual files to any checkpoint",
			"Roll back to any checkpoint when the agent goes in the wrong direction",
		],
	},
	{
		id: "git",
		icon: GitBranch,
		label: "Git Panel",
		tag: "git",
		description:
			"Stage, commit, and push from inside Acepe. Diff hunks, file history, branch switching, and stash management — without leaving your agent's window.",
		usecases: [
			"Stage and commit agent changes with one keystroke",
			"Browse history and stashes inline",
			"Push branches and resolve conflicts without context switching",
		],
	},
	{
		id: "pr",
		icon: GitPullRequest,
		label: "PR Workflow",
		tag: "ship",
		description:
			"Open, review, and merge pull requests inside Acepe. The agent drafts the PR, you review the diff, and ship — all in one surface.",
		usecases: [
			"Generate PR titles and descriptions from session work",
			"Review diffs file-by-file with the same UI as the agent",
			"Merge or request changes without opening GitHub",
		],
	},
	{
		id: "sessions",
		icon: ClockCounterClockwise,
		label: "Session Management",
		tag: "history",
		description:
			"The CLI doesn't track your history across projects. Acepe indexes every session, searchable and filterable. Find that solution you wrote last week.",
		usecases: [
			"Search and filter across all your agent interactions",
			"Recover context from previous sessions instantly",
			"Organize sessions by project for easy reference",
		],
	},
	{
		id: "keyboard",
		icon: Command,
		label: "Keyboard-First",
		tag: "input",
		description:
			"⌘K command palette. ⌘L switch agent. ⌘/ change model. ⌘N new thread. Every action has a shortcut. Your mouse can rest.",
		usecases: [
			"Navigate entirely with keyboard shortcuts for flow state",
			"Customize shortcuts to match your muscle memory",
			"Discover new shortcuts with the searchable command palette",
		],
	},
	{
		id: "browser",
		icon: Globe,
		label: "Embedded Browser",
		tag: "verify",
		description:
			"Pin a browser pane next to your agent. Watch the dev server reload as the agent edits — no alt-tabbing, no broken loops.",
		usecases: [
			"Verify UI changes the moment the agent saves",
			"Inspect rendered output, console, and network in-app",
			"Share the browser context with the agent for visual debugging",
		],
	},
	{
		id: "terminal",
		icon: Terminal,
		label: "Terminal Drawer",
		tag: "tools",
		description:
			"A real terminal pinned to every session. Run scripts, tail logs, and inspect agent output side by side without leaving the panel.",
		usecases: [
			"Tail logs while the agent is mid-task",
			"Run quick scripts without leaving the session",
			"Multiple terminal tabs per agent panel",
		],
	},
	{
		id: "permissions",
		icon: ShieldCheck,
		label: "Permissions & Autonomy",
		tag: "control",
		description:
			"Decide which tools the agent runs without asking. Per-tool, per-session permission control with a one-click autonomous mode for trusted work.",
		usecases: [
			"Allow file edits but require permission for shell commands",
			"Run trusted tasks fully autonomous, gate the rest",
			"Per-session permission scopes that survive restart",
		],
	},
	{
		id: "skills",
		icon: Plug,
		label: "Skills & MCP",
		tag: "extend",
		description:
			"Plug in skills and MCP servers to give every agent the same superpowers. Search, fetch, run scripts, query APIs — across providers, in one place.",
		usecases: [
			"Share skills across Claude, Codex, Cursor, and OpenCode",
			"Connect MCP servers once, use them everywhere",
			"Build custom tools your whole team can run",
		],
	},
	{
		id: "sql-studio",
		icon: HardDrives,
		label: "SQL Studio",
		tag: "data",
		description:
			"Query PostgreSQL, MySQL, and SQLite without leaving the app. Schema explorer, SQL editor, and results grid in one overlay.",
		usecases: [
			"Connect to local or remote databases with saved connections",
			"Browse schemas and tables, run queries, inspect results",
			"Execute data-changing SQL with explicit write mode control",
		],
	},
	{
		id: "voice",
		icon: Microphone,
		label: "Voice Input",
		tag: "input",
		description:
			"Dictate prompts with your voice. Real-time transcription, push-to-talk, and language model selection — for when typing slows you down.",
		usecases: [
			"Brain-dump a task at the speed of speech",
			"Switch transcription models for accuracy or latency",
			"Hands-free prompting while reviewing code",
		],
	},
];
</script>

<svelte:head>
	<title>{"The Agentic Developer Environment"} - Acepe</title>
	<meta name="description" content={"Run Claude Code, Codex, Cursor Agent, and OpenCode side by side. Orchestrate parallel sessions, track every change, and ship from plan to PR. All in one window."} />
</svelte:head>

<div class="min-h-screen">
	<Header
		showLogin={data.featureFlags.loginEnabled}
		showDownload={data.featureFlags.downloadEnabled}
	/>

	<main>
		<!-- Hero and demo share one shader stage so the warm glow stays continuous
		     from the floating header through the first screen. -->
		<div class="relative isolate overflow-hidden">
			<HeroShaderStage heightClass="h-full" />

			<!-- Hero Section — centered headline + CTA, demo below -->
			<section class="relative z-10 px-4 pt-36 pb-24 md:px-6 md:pt-42 md:pb-32">
				<div class="mx-auto flex w-full max-w-4xl flex-col items-center text-center">
					<div class="mb-7 flex flex-col items-center gap-4">
						<div class="flex items-center gap-3">
							<span class="h-px w-10 bg-border/60"></span>
							<span class="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground/80">
								{"Works with"}
							</span>
							<span class="h-px w-10 bg-border/60"></span>
						</div>
						<AgentIconsRow size={22} />
					</div>

					<h1 class="mb-5 text-[30px] leading-[1.16] font-semibold tracking-[0.055em] text-foreground md:text-[56px] [text-shadow:0_1px_30px_rgba(0,0,0,0.45)]">
						{"The Agentic"}
						<br />
						{"Developer Environment"}
					</h1>

					<p class="mb-12 max-w-[680px] tracking-[0.045em] text-base leading-[1.5] text-muted-foreground md:text-[18px]">
						{"One native workspace for every coding agent. Run them in parallel, review every change, and ship from plan to PR without leaving the window."}
					</p>

					<div class="flex flex-col items-center gap-2.5 sm:flex-row">
						<PillButton
							href="/download"
							variant="invert"
							size="default"
							class="h-12 py-1.5 pr-1.5 pl-6"
						>
							{"Download for macOS"}
							{#snippet trailingIcon()}
								<ArrowRightIcon size="lg" />
							{/snippet}
						</PillButton>
					</div>
				</div>

				<!-- Demo — below the hero, centered. Hidden below lg: on phone widths
				     the multi-panel UI is unreadable and the hero works better as a
				     focused headline + CTA. -->
				<div class="hero-demo relative mx-auto mt-24 hidden w-full max-w-[1320px] lg:block">
					<div class="hero-demo-stage mx-auto">
						<FeatureShowcase />
					</div>
				</div>
			</section>
		</div>

		<!-- What is an ADE? -->
		<section class="border-t border-border/50 px-4 pt-24 pb-24 md:px-6 md:pt-32 md:pb-32">
			<div class="mx-auto max-w-4xl">
				<div class="mb-16 flex flex-col items-center text-center">
					<div class="mb-5 flex items-center gap-2">
						<span class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/50">//</span>
						<span class="font-mono text-[10px] font-medium uppercase tracking-wider text-muted-foreground">The new paradigm</span>
					</div>
					<h2 class="mb-4 text-2xl leading-[1.2] font-semibold tracking-[-0.03em] md:text-[40px]">
						{"Why an ADE?"}
					</h2>
					<p class="max-w-[640px] text-[15px] leading-[1.7] text-muted-foreground md:text-[17px]">
						{"More agents means more windows to manage."}
						<br />
						{"An ADE brings them into one workspace."}
					</p>
				</div>

				<!-- Three pillars -->
				<div class="grid gap-6 md:grid-cols-3 md:gap-8">
					<div class="feature-card rounded-xl border border-border/50 bg-card/20 p-6">
						<div class="mb-3 font-mono text-[11px] font-semibold uppercase tracking-wider text-primary">
							{"01 — Orchestrate"}
						</div>
						<h3 class="mb-2 text-sm font-semibold">{"Run any agent, in parallel"}</h3>
						<p class="text-[13px] leading-relaxed text-muted-foreground">
							{"Run Claude Code, Codex, Cursor Agent, and OpenCode side by side. Switch tasks with ⌘L."}
						</p>
					</div>
					<div class="feature-card rounded-xl border border-border/50 bg-card/20 p-6">
						<div class="mb-3 font-mono text-[11px] font-semibold uppercase tracking-wider text-primary">
							{"02 — Observe"}
						</div>
						<h3 class="mb-2 text-sm font-semibold">{"See what every agent is doing"}</h3>
						<p class="text-[13px] leading-relaxed text-muted-foreground">
							{"See agent, project, and status at a glance. Plans, todos, diffs, and code stay readable."}
						</p>
					</div>
					<div class="feature-card rounded-xl border border-border/50 bg-card/20 p-6">
						<div class="mb-3 font-mono text-[11px] font-semibold uppercase tracking-wider text-primary">
							{"03 — Control"}
						</div>
						<h3 class="mb-2 text-sm font-semibold">{"Revert, checkpoint, intervene"}</h3>
						<p class="text-[13px] leading-relaxed text-muted-foreground">
							{"Checkpoint every tool run, revert a file or session, and step in whenever needed."}
						</p>
					</div>
				</div>
			</div>
		</section>

<!-- Features Section -->
<section class="border-t border-border/50 px-4 py-24 md:px-6 md:py-32">
<div class="mx-auto max-w-6xl">
<div class="mb-16 flex flex-col items-center text-center">
<div class="mb-5 flex items-center gap-2">
<span class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/50">//</span>
<span class="font-mono text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Features</span>
</div>
<h2 class="mb-4 text-3xl leading-[1.2] font-semibold tracking-[-0.03em] md:text-[44px]">
{"Everything an ADE should have"}
</h2>
<p class="max-w-[600px] text-[15px] leading-[1.7] text-muted-foreground md:text-[17px]">
{"For developers who run AI agents every day."}
</p>
</div>

<div class="flex flex-col gap-16 md:gap-24">
{#each features as feature, i}
{@const Icon = feature.icon}
{@const isBig = feature.id === "kanban" || feature.id === "git" || feature.id === "sql-studio" || feature.id === "review"}
<div
class="grid grid-cols-1 items-center gap-10 md:grid-cols-2 md:gap-16"
class:md:[direction:rtl]={i % 2 === 1}
>
<!-- Visual card -->
<div class="relative aspect-[4/3] overflow-hidden rounded-2xl border border-border/50 bg-background [direction:ltr]">
<!-- Same site shader, scoped to cards and mounted only near the viewport. -->
<div class="pointer-events-none absolute inset-0">
<FeatureCardShader />
</div>
<div class="relative flex h-full w-full items-center justify-center p-6 md:p-8">
<div class="flex {isBig ? 'h-full w-full' : 'h-full w-full max-w-md'} items-center justify-center">
{#if feature.id === "multi-agent"}
<AgentSelectionGrid agents={mockGridAgents} selectedAgentId="claude-code" />
{:else if feature.id === "parallel"}
<div class="parallel-illustration flex h-full w-full items-stretch gap-2 p-2">
	<!-- Left agent panel -->
	<div class="parallel-panel parallel-panel-muted relative flex flex-1 flex-col overflow-hidden rounded-md border bg-card">
		<div class="flex items-center gap-1.5 border-b border-border/40 bg-muted/40 px-2 py-1.5">
			<img src="/svgs/agents/claude/claude-icon-dark.svg" alt="Claude" class="h-3 w-3" />
			<span class="font-mono text-[8px] font-medium text-foreground/70">claude · auth</span>
			<span class="ml-auto h-1.5 w-1.5 rounded-full bg-success animate-pulse"></span>
		</div>
		<div class="flex flex-1 flex-col gap-1.5 p-2">
			<div class="h-1 w-full rounded-full bg-muted-foreground/20"></div>
			<div class="h-1 w-3/4 rounded-full bg-muted-foreground/20"></div>
			<div class="h-1 w-5/6 rounded-full bg-muted-foreground/20"></div>
			<div class="mt-1 h-1 w-2/3 rounded-full bg-primary/40"></div>
			<div class="h-1 w-4/5 rounded-full bg-muted-foreground/20"></div>
			<div class="h-1 w-3/5 rounded-full bg-muted-foreground/20"></div>
		</div>
	</div>

	<!-- Middle agent panel (focused) -->
	<div class="parallel-panel parallel-panel-active relative flex flex-1 flex-col overflow-hidden rounded-md border bg-card">
		<div class="flex items-center gap-1.5 border-b border-border/50 px-2 py-1.5" style="background: color-mix(in srgb, #9858FF 12%, transparent);">
			<img src="/svgs/agents/cursor/cursor-icon-dark.svg" alt="Cursor" class="h-3 w-3" />
			<span class="font-mono text-[8px] font-semibold text-foreground">cursor · ui</span>
			<span class="ml-auto flex h-1.5 w-1.5">
				<span class="absolute inline-flex h-1.5 w-1.5 animate-ping rounded-full opacity-75" style="background: #22C55E;"></span>
				<span class="relative inline-flex h-1.5 w-1.5 rounded-full" style="background: #22C55E;"></span>
			</span>
		</div>
		<div class="flex flex-1 flex-col gap-1.5 p-2">
			<div class="h-1 w-full rounded-full bg-muted-foreground/25"></div>
			<div class="h-1 w-5/6 rounded-full bg-muted-foreground/25"></div>
			<div class="mt-1 h-1 w-3/4 rounded-full" style="background: color-mix(in srgb, #9858FF 60%, transparent);"></div>
			<div class="h-1 w-4/5 rounded-full" style="background: color-mix(in srgb, #9858FF 50%, transparent);"></div>
			<div class="h-1 w-2/3 rounded-full bg-muted-foreground/25"></div>
			<div class="h-1 w-5/6 rounded-full bg-muted-foreground/25"></div>
			<div class="mt-1 h-1 w-3/5 rounded-full" style="background: color-mix(in srgb, #9858FF 60%, transparent);"></div>
		</div>
	</div>

	<!-- Right agent panel -->
	<div class="parallel-panel parallel-panel-muted relative flex flex-1 flex-col overflow-hidden rounded-md border bg-card">
		<div class="flex items-center gap-1.5 border-b border-border/40 bg-muted/40 px-2 py-1.5">
			<img src="/svgs/agents/codex/codex-icon-dark.svg" alt="Codex" class="h-3 w-3" />
			<span class="font-mono text-[8px] font-medium text-foreground/70">codex · api</span>
			<span class="ml-auto h-1.5 w-1.5 rounded-full bg-warning animate-pulse"></span>
		</div>
		<div class="flex flex-1 flex-col gap-1.5 p-2">
			<div class="h-1 w-full rounded-full bg-muted-foreground/20"></div>
			<div class="h-1 w-2/3 rounded-full bg-success/40"></div>
			<div class="h-1 w-4/5 rounded-full bg-muted-foreground/20"></div>
			<div class="mt-1 h-1 w-3/4 rounded-full bg-muted-foreground/20"></div>
			<div class="h-1 w-1/2 rounded-full bg-muted-foreground/20"></div>
			<div class="h-1 w-5/6 rounded-full bg-muted-foreground/20"></div>
		</div>
	</div>
</div>
{:else if feature.id === "plan-mode"}
<div class="overflow-hidden rounded-lg bg-card shadow-2xl">
<PlanCard content={mockPlanContent} title="Implementation Plan" status="interactive" />
</div>
{:else if feature.id === "checkpoints"}
<div class="overflow-hidden rounded-lg border border-border/50 bg-card shadow-2xl backdrop-blur">
<CheckpointTimeline checkpoints={mockCheckpoints.slice(0, 4)} showRevertButtons={false} />
</div>
{:else if feature.id === "sessions"}
<div class="overflow-hidden rounded-lg border border-border/50 bg-card shadow-2xl backdrop-blur" style="width: 303px;">
<div class="border-b border-border/50 px-3 py-2">
<div class="flex h-7 items-center gap-2 rounded-md border border-border/40 bg-background px-2.5 font-mono text-[11px] text-muted-foreground/70">
<MagnifyingGlass size={11} />
<span>search sessions…</span>
</div>
</div>
<div class="p-1.5">
{#each mockSessions.slice(0, 3) as session}
<AppSessionItemComponent {session} />
{/each}
</div>
</div>
{:else if feature.id === "keyboard"}
<div class="overflow-hidden rounded-lg border border-border/50 bg-card shadow-2xl backdrop-blur">
<div class="border-b border-border/50 px-3 py-2.5">
<div class="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
<Command size={11} class="text-primary" />
<span class="text-foreground">switch agent</span>
</div>
</div>
<div class="space-y-0.5 p-1.5 font-mono text-[11px]">
{#each [{ k: "⌘L", l: "Switch agent" }, { k: "⌘K", l: "Command palette" }, { k: "⌘N", l: "New thread" }, { k: "⌘/", l: "Change model" }] as cmd, idx}
<div class="flex items-center justify-between rounded-md px-2.5 py-1.5 {idx === 0 ? 'bg-primary/15 text-foreground' : 'text-muted-foreground'}">
<span>{cmd.l}</span>
<kbd class="rounded border border-border/60 bg-background px-1.5 py-0.5 text-[10px]">{cmd.k}</kbd>
</div>
{/each}
</div>
</div>
{:else if feature.id === "sql-studio"}
<div class="sql-zoom-frame relative h-full w-full overflow-hidden rounded-lg border border-border/60 bg-background shadow-2xl">
<div class="sql-zoom-inner">
<LazyFeatureMount label="SQL Studio demo" class="h-full w-full">
{#snippet children()}
{#await import("$lib/blog/demos/sql-studio-demo.svelte")}
<div class="flex h-full w-full items-center justify-center font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Loading SQL Studio</div>
{:then module}
{@const Demo = module.default}
<Demo />
{/await}
{/snippet}
</LazyFeatureMount>
</div>
</div>
{:else if feature.id === "queue"}
<div class="mx-auto h-full w-full max-w-[340px] overflow-hidden rounded-lg border border-border/60 bg-card text-[13px] shadow-2xl">
<div class="h-full w-full overflow-y-auto">
<LazyFeatureMount label="Attention queue demo" class="h-full w-full">
{#snippet children()}
{#await import("$lib/blog/demos/queue-answer-needed-demo.svelte")}
<div class="flex h-full min-h-[220px] w-full items-center justify-center font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Loading queue</div>
{:then module}
{@const Demo = module.default}
<Demo />
{/await}
{/snippet}
</LazyFeatureMount>
</div>
</div>
{:else if feature.id === "kanban"}
<div class="kanban-zoom-frame relative h-full w-full overflow-hidden rounded-lg border border-border/60 bg-background shadow-2xl">
<div class="kanban-zoom-inner">
<LazyFeatureMount label="Kanban board demo" class="h-full w-full">
{#snippet children()}
{#await import("$lib/components/landing-kanban-demo.svelte")}
<div class="flex h-full w-full items-center justify-center font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Loading kanban</div>
{:then module}
{@const Demo = module.default}
<Demo bare={true} />
{/await}
{/snippet}
</LazyFeatureMount>
</div>
</div>
{:else if feature.id === "git"}
<div class="git-zoom-frame relative h-full w-full overflow-hidden rounded-lg border border-border/60 bg-card shadow-2xl">
<div class="git-zoom-inner">
<LazyFeatureMount label="Git panel demo" class="h-full w-full">
{#snippet children()}
{#await import("$lib/components/git-features-demo.svelte")}
<div class="flex h-full w-full items-center justify-center font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Loading git panel</div>
{:then module}
{@const Demo = module.default}
<Demo />
{/await}
{/snippet}
</LazyFeatureMount>
</div>
</div>
{:else if feature.id === "pr"}
<div class="overflow-hidden rounded-lg border border-border/50 bg-card shadow-2xl">
<div class="border-b border-border/50 bg-success/10 px-3 py-2 flex items-center gap-2">
<GitPullRequest size={14} class="text-success" />
<span class="font-mono text-[11px] font-medium text-success">Merged · #342</span>
</div>
<div class="p-3 space-y-2">
<div class="text-[13px] font-semibold">Redesign settings page with new tab layout</div>
<div class="font-mono text-[10px] text-muted-foreground">bob-dev · 7 files · +218 −179</div>
<div class="space-y-1 pt-2">
{#each ["+45 −112  src/routes/settings/+page.svelte", "+38   src/routes/settings/tabs/general.svelte", "+52   src/routes/settings/tabs/appearance.svelte", "+31   src/routes/settings/tabs/keys.svelte", "  −67  src/routes/settings/settings.css"] as line}
<div class="font-mono text-[10px] text-muted-foreground/80 truncate">{line}</div>
{/each}
</div>
</div>
</div>
{:else if feature.id === "review"}
<div class="overflow-hidden rounded-lg border border-border/50 bg-card shadow-2xl h-full w-full">
<div class="border-b border-border/50 px-3 py-2 flex items-center justify-between">
<span class="font-mono text-[11px] font-medium">Review · 5 files</span>
<div class="flex gap-1">
<button class="rounded border border-border/60 bg-background px-2 py-0.5 font-mono text-[10px]">Reject</button>
<button class="rounded bg-primary px-2 py-0.5 font-mono text-[10px] text-primary-foreground">Accept all</button>
</div>
</div>
<div class="grid grid-cols-[180px_1fr] h-[calc(100%-32px)]">
<div class="border-r border-border/50 p-1.5 space-y-0.5 overflow-y-auto">
{#each [{ p: "src/lib/auth/jwt.ts", a: 24, d: 6, sel: true }, { p: "src/lib/auth/session.ts", a: 8, d: 18 }, { p: "src/routes/login/+page.svelte", a: 12, d: 0 }, { p: "src/lib/auth/middleware.ts", a: 5, d: 2 }, { p: "tests/auth.test.ts", a: 47, d: 0 }] as f}
<div class="rounded px-1.5 py-1 font-mono text-[10px] {f.sel ? 'bg-primary/15 text-foreground' : 'text-muted-foreground/80 hover:bg-accent/40'}">
<div class="truncate">{f.p}</div>
<div class="text-[9px]"><span class="text-success">+{f.a}</span> <span class="text-destructive">−{f.d}</span></div>
</div>
{/each}
</div>
<div class="overflow-auto p-2 font-mono text-[10px] leading-relaxed">
<div class="text-muted-foreground">@@ -12,6 +12,12 @@</div>
<div class="text-foreground/80">{"export function verifyToken(token: string) {"}</div>
<div class="bg-destructive/10 text-destructive">−  return jwt.verify(token, process.env.SECRET);</div>
<div class="bg-success/10 text-success">+  const secret = process.env.JWT_SECRET;</div>
<div class="bg-success/10 text-success">+  if (!secret) throw new Error("JWT_SECRET missing");</div>
<div class="bg-success/10 text-success">+  return jwt.verify(token, secret, {"{ algorithms: ['HS256'] }"});</div>
<div class="text-foreground/80">{"}"}</div>
</div>
</div>
</div>
{:else if feature.id === "browser"}
<div class="overflow-hidden rounded-lg border border-border/50 bg-card shadow-2xl">
<div class="flex items-center gap-2 border-b border-border/50 bg-muted/30 px-3 py-1.5">
<div class="flex gap-1"><span class="h-2.5 w-2.5 rounded-full bg-destructive/60"></span><span class="h-2.5 w-2.5 rounded-full bg-warning/60"></span><span class="h-2.5 w-2.5 rounded-full bg-success/60"></span></div>
<div class="flex-1 truncate rounded border border-border/40 bg-background px-2 py-0.5 text-center font-mono text-[10px] text-muted-foreground">localhost:5173/dashboard</div>
</div>
<div class="aspect-[4/3] bg-gradient-to-br from-primary/15 via-background to-accent/15 p-3">
<div class="mb-2 h-3 w-1/2 rounded bg-foreground/15"></div>
<div class="grid grid-cols-2 gap-2">
<div class="h-12 rounded bg-card border border-border/50"></div>
<div class="h-12 rounded bg-card border border-border/50"></div>
<div class="h-12 rounded bg-card border border-border/50"></div>
<div class="h-12 rounded bg-card border border-border/50"></div>
</div>
</div>
</div>
{:else if feature.id === "terminal"}
<div class="overflow-hidden rounded-lg border border-border/50 bg-[#0a0a0a] shadow-2xl" style="width: 253px;">
<div class="flex items-center gap-2 border-b border-border/50 bg-muted/20 px-3 py-1.5">
<Terminal size={11} class="text-muted-foreground" />
<span class="font-mono text-[10px] text-muted-foreground">Terminal 1 · zsh</span>
</div>
<div class="p-3 font-mono text-[10px] leading-relaxed">
<div class="text-muted-foreground">$ bun run dev</div>
<div class="text-success">  ✓ vite v5.4.0 ready in 312ms</div>
<div class="text-foreground/70">  ➜  Local:   <span class="text-primary">http://localhost:5173/</span></div>
<div class="text-muted-foreground mt-2">$ bun test src/lib/auth</div>
<div class="text-success">  ✓ 12 tests passed (147ms)</div>
<div class="text-muted-foreground mt-2">$ <span class="animate-pulse">▊</span></div>
</div>
</div>
{:else if feature.id === "voice"}
<div class="voice-card relative flex w-full flex-col items-center gap-4 overflow-hidden rounded-lg border border-border/50 bg-card p-6 shadow-2xl">
<div class="relative flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_0_24px_rgba(247,126,44,0.45)]">
<Microphone size={26} weight="fill" />
</div>
<div class="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
<span class="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-destructive"></span>
<span>Recording · 0:14</span>
</div>
<!-- Animated waveform -->
<div class="voice-waveform flex h-10 items-center gap-[3px]">
{#each Array.from({ length: 24 }) as _, idx (idx)}
<span class="voice-bar" style="--i: {idx};"></span>
{/each}
</div>
<div class="relative font-mono text-[11px] text-foreground/70">
"Refactor the auth module to use JWT<span class="voice-caret">▊</span>"
</div>
</div>
{:else if feature.id === "permissions"}
<div class="overflow-hidden rounded-lg border border-border/50 bg-card shadow-2xl" style="width: 192px;">
<div class="border-b border-border/50 px-3 py-2 flex items-center gap-2">
<ShieldCheck size={12} class="text-success" />
<span class="font-mono text-[11px] font-medium">Session permissions</span>
</div>
<div class="p-2 space-y-1">
{#each [{ tool: "edit", state: "always", color: "success" }, { tool: "read", state: "always", color: "success" }, { tool: "execute", state: "ask", color: "warning" }, { tool: "fetch", state: "ask", color: "warning" }, { tool: "delete", state: "deny", color: "destructive" }] as p}
<div class="flex items-center justify-between rounded px-2 py-1 hover:bg-accent/30">
<span class="font-mono text-[11px] text-foreground/80">{p.tool}</span>
<span class="rounded border border-border/40 bg-{p.color}/10 px-2 py-0.5 font-mono text-[10px] text-{p.color}">{p.state}</span>
</div>
{/each}
<div class="mt-2 flex items-center justify-between border-t border-border/40 pt-2 px-2">
<span class="font-mono text-[11px] font-semibold">Autonomous mode</span>
<div class="flex h-4 w-7 items-center rounded-full bg-primary p-0.5">
<div class="ml-auto h-3 w-3 rounded-full bg-primary-foreground"></div>
</div>
</div>
</div>
</div>
{:else if feature.id === "skills"}
<div class="w-full overflow-hidden rounded-lg border border-border/50 bg-card shadow-2xl">
<div class="flex items-center gap-2 border-b border-border/50 px-3.5 py-2.5">
<Plug size={13} class="text-primary" />
<span class="font-mono text-[11px] font-medium tracking-wide">Skills & MCP</span>
<span class="ml-auto font-mono text-[10px] text-muted-foreground">5 active</span>
</div>
<div class="divide-y divide-border/40">
{#each [{ n: "github", t: "MCP", desc: "PRs, issues, code search", on: true }, { n: "linear", t: "MCP", desc: "Tickets & cycles", on: true }, { n: "ce-plan", t: "Skill", desc: "Reviewed implementation plans", on: true }, { n: "ce-debug", t: "Skill", desc: "Systematic root-cause", on: true }, { n: "git-commit", t: "Skill", desc: "Conventional commits", on: false }] as s, idx (s.n)}
<div class="flex items-center gap-3 px-3.5 py-2.5 transition-colors hover:bg-accent/30">
<div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border/50 bg-background/70 font-mono text-[10px] font-medium {s.t === 'MCP' ? 'text-primary' : 'text-foreground/80'}">
{s.t === "MCP" ? "M" : "S"}
</div>
<div class="min-w-0 flex-1">
<div class="flex items-center gap-1.5">
<span class="truncate font-mono text-[12px] font-medium text-foreground">{s.n}</span>
<span class="font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">{s.t}</span>
</div>
<div class="truncate text-[10px] text-muted-foreground">{s.desc}</div>
</div>
<div class="relative flex h-4 w-7 shrink-0 items-center rounded-full p-0.5 transition-colors {s.on ? 'bg-primary' : 'bg-muted-foreground/25'}">
<div class="h-3 w-3 rounded-full bg-white shadow-sm transition-all {s.on ? 'ml-auto' : ''}"></div>
</div>
</div>
{/each}
</div>
</div>
{/if}
</div>
</div>
</div>

<!-- Text -->
<div class="flex flex-col gap-4 [direction:ltr]">
<div class="flex items-center gap-2 font-mono text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
<Icon size={14} class="text-primary/80" />
<span>{feature.tag}</span>
</div>
<h3 class="text-balance text-3xl font-semibold tracking-[-0.02em] md:text-[40px] md:leading-[1.1]">
{feature.label}
</h3>
<p class="text-pretty text-[15px] leading-[1.65] text-muted-foreground md:text-[16px]">
{feature.description}
</p>
</div>
</div>
{/each}
</div>
</div>
</section>

		<!-- Bottom CTA -->
		<section class="relative overflow-hidden border-t border-border/50 px-4 py-32 md:px-6 md:py-40">
			<div class="absolute inset-0 -z-10">
				<HeroShaderStage heightClass="h-full" accentRing={false} />
			</div>
			<div class="relative mx-auto flex max-w-2xl flex-col items-center text-center">
				<span class="mb-5 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
					{"// ship from plan to PR"}
				</span>
				<h2 class="mb-4 text-balance text-3xl leading-[1.1] font-semibold tracking-[-0.03em] md:text-[52px]">
					{"Your ADE is ready"}
				</h2>
				<p class="mb-10 max-w-[540px] text-pretty text-[15px] leading-[1.65] text-muted-foreground md:text-[18px]">
					{"Acepe is free while in beta. One download, every agent, full control."}
				</p>
				<div class="flex flex-col items-center gap-3 sm:flex-row">
					<PillButton
						href="/download"
						variant="invert"
						size="default"
						class="h-12 py-1.5 pr-1.5 pl-6 shadow-[0_12px_40px_-12px_rgba(247,126,44,0.55)]"
					>
						{"Download for macOS"}
						{#snippet trailingIcon()}
							<ArrowRightIcon size="lg" />
						{/snippet}
					</PillButton>
					<a
						href="/compare/cursor"
						class="inline-flex h-12 items-center gap-2 rounded-full border border-white/10 bg-background/40 px-5 text-sm text-muted-foreground backdrop-blur-xl transition-colors hover:border-white/20 hover:text-foreground"
					>
						{"See how Acepe compares"}
						<ArrowRightIcon size="sm" />
					</a>
				</div>
			</div>
		</section>
	</main>

	<!-- Footer -->
	<footer class="border-t border-border/50 px-4 py-12 md:px-6">
		<div class="mx-auto max-w-6xl">
			<div class="grid grid-cols-2 gap-8 md:grid-cols-4">
				<!-- Brand -->
				<div class="col-span-2 md:col-span-1">
					<a href="/" class="mb-3 inline-flex items-center gap-2">
						<BrandLockup class="gap-2" markClass="h-6 w-6" wordmarkClass="text-sm" />
					</a>
					<p class="max-w-[200px] text-[13px] leading-relaxed text-muted-foreground">
						{"The Agentic Developer Environment"}
					</p>
				</div>

				<!-- Product -->
				<div>
					<h3 class="mb-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/50">
						{"Product"}
					</h3>
					<ul class="flex flex-col gap-2">
						<li>
							<a href="/blog" class="text-[13px] text-muted-foreground transition-colors hover:text-foreground">
								{"Blog"}
							</a>
						</li>
						<li>
							<a href="/changelog" class="text-[13px] text-muted-foreground transition-colors hover:text-foreground">
								{"Changelog"}
							</a>
						</li>
						<li>
							<a href="/pricing" class="text-[13px] text-muted-foreground transition-colors hover:text-foreground">
								{"Pricing"}
							</a>
						</li>
						<li>
							<a href="/compare" class="text-[13px] text-muted-foreground transition-colors hover:text-foreground">
								{"Compare"}
							</a>
						</li>
						{#if data.featureFlags?.roadmapEnabled}
							<li>
								<a href="/roadmap" class="text-[13px] text-muted-foreground transition-colors hover:text-foreground">
									{"Roadmap"}
								</a>
							</li>
						{/if}
					</ul>
				</div>

				<!-- Resources -->
				<div>
					<h3 class="mb-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/50">
						{"Resources"}
					</h3>
					<ul class="flex flex-col gap-2">
						<li>
							<a
								href="https://github.com/flazouh/acepe"
								target="_blank"
								rel="noopener noreferrer"
								class="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
							>
								<GithubLogo size={14} weight="fill" />
								GitHub
							</a>
						</li>
					</ul>
				</div>

				<!-- Legal -->
				<div>
					<h3 class="mb-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/50">
						{"Legal"}
					</h3>
					<ul class="flex flex-col gap-2">
						<li>
							<a href="/privacy" class="text-[13px] text-muted-foreground transition-colors hover:text-foreground">
								{"Privacy"}
							</a>
						</li>
						<li>
							<a href="/terms" class="text-[13px] text-muted-foreground transition-colors hover:text-foreground">
								{"Terms"}
							</a>
						</li>
					</ul>
				</div>
			</div>

			<!-- Bottom bar -->
			<div class="mt-10 border-t border-border/30 pt-6">
				<span class="font-mono text-[11px] text-muted-foreground/50">
					{`© ${new Date().getFullYear().toString()} Acepe. All rights reserved.`}
				</span>
			</div>
		</div>
	</footer>
</div>

<DevShaderSwitcher />

<style>
	@media (min-width: 1024px) {
		.hero-demo-stage {
			width: 1220px;
			transform-origin: top center;
			transform: scale(0.94);
			/* reclaim the empty space left behind by the scale so layout stays tight */
			margin-bottom: calc(-1 * (1220px * 0.06) * (500 / 1100));
		}
	}
	@media (min-width: 1280px) {
		.hero-demo-stage {
			transform: scale(1);
			margin-bottom: 0;
		}
	}
	@media (min-width: 1440px) {
		.hero-demo-stage {
			transform: scale(1.04);
			margin-bottom: calc(-1 * (1220px * 0.04) * (500 / 1100));
		}
	}

	.feature-card {
		backdrop-filter: blur(12px);
	}

	/* Parallel sessions illustration: tiled agent panels, one focused. */
	.parallel-panel-active {
		border-color: #9858FF;
		box-shadow:
			0 0 0 1px #9858FF,
			0 0 22px -4px color-mix(in srgb, #9858FF 55%, transparent),
			0 10px 28px -10px rgba(0, 0, 0, 0.5);
		transform: translateY(-2px);
		z-index: 2;
	}

	.parallel-panel-muted {
		border-color: var(--border);
		opacity: 0.7;
	}

	/* Render the SQL Studio at its real desktop modal size, then scale to fit the card. */
	.sql-zoom-frame {
		container-type: size;
	}
	.sql-zoom-inner {
		width: 1180px;
		height: 820px;
		transform-origin: top left;
		/* Render at 2× the natural fit so only the top-left quarter is visible. */
		transform: scale(calc(100cqw / 590px));
	}
	@container (min-aspect-ratio: 1180/820) {
		.sql-zoom-inner {
			transform: scale(calc(100cqh / 410px));
		}
	}

	/* Queue card has its own scroll inside if content overflows. */

	/* Kanban: render at fixed wide size, scale to card width.
	 * Source is taller than the 4:3 card so cards crop off the bottom — feels like the top of a real board. */
	.kanban-zoom-frame {
		container-type: size;
	}
	.kanban-zoom-inner {
		width: 1600px;
		height: 1400px;
		transform-origin: top left;
		transform: scale(calc(100cqw / 1600px));
	}

	/* Git Panel: render at desktop layout size, scale to card. */
	.git-zoom-frame {
		container-type: size;
	}
	.git-zoom-inner {
		width: 620px;
		height: 444px;
		transform-origin: top left;
		transform: scale(calc(100cqw / 620px));
	}

	/* Voice card animated rings + waveform */
	.voice-ring {
		position: absolute;
		width: 56px;
		height: 56px;
		border-radius: 9999px;
		border: 1.5px solid rgba(247, 126, 44, 0.6);
		opacity: 0;
		animation: voice-ring-pulse 2.4s cubic-bezier(0.22, 0.61, 0.36, 1) infinite;
	}
	.voice-ring-1 { animation-delay: 0s; }
	.voice-ring-2 { animation-delay: 0.8s; }
	.voice-ring-3 { animation-delay: 1.6s; }

	@keyframes voice-ring-pulse {
		0%   { transform: scale(0.6); opacity: 0; border-color: rgba(247, 126, 44, 0.7); }
		15%  { opacity: 0.55; }
		100% { transform: scale(3.2); opacity: 0; border-color: rgba(247, 126, 44, 0); }
	}

	.voice-bar {
		display: inline-block;
		width: 3px;
		height: 12px;
		border-radius: 9999px;
		background: linear-gradient(180deg, #F77E2C, #C85A12);
		transform-origin: center;
		animation: voice-bar-wave 1.1s ease-in-out infinite;
		animation-delay: calc(var(--i) * 60ms);
	}
	@keyframes voice-bar-wave {
		0%, 100% { transform: scaleY(0.4); opacity: 0.55; }
		20%      { transform: scaleY(1.6); opacity: 1; }
		50%      { transform: scaleY(0.8); opacity: 0.8; }
		75%      { transform: scaleY(2.2); opacity: 1; }
	}

	.voice-caret {
		display: inline-block;
		margin-left: 1px;
		color: #F77E2C;
		animation: voice-caret-blink 1s steps(1) infinite;
	}
	@keyframes voice-caret-blink {
		0%, 49%   { opacity: 1; }
		50%, 100% { opacity: 0; }
	}

</style>
