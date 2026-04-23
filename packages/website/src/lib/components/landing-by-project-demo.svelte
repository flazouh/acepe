<script lang="ts">
import {
	AgentPanelScene,
	AgentPanelComposer,
	AgentPanelComposerFrame,
	AgentPanelFooter,
	AgentInputEditor,
	AgentInputToolbar,
	AgentInputModeSelector,
	AgentInputDivider,
	AgentInputAutonomousToggle,
	AgentInputModelSelector,
	AgentInputMetricsChip,
	AgentInputMicButton,
	DiffPill,
	ProjectLetterBadge,
	TextShimmer,
	SegmentedProgress,
} from "@acepe/ui";
import { AgentPanelStatusIcon } from "@acepe/ui/agent-panel";
import {
	AppMainLayout,
	AppSidebarLayout,
	AppSidebarProjectGroup,
	AppSidebarFooter,
} from "@acepe/ui/app-layout";
import { CloseAction, FullscreenAction, OverflowMenuTriggerAction } from "@acepe/ui/panel-header";
import { ProjectCard } from "@acepe/ui/project-card";
import { Browser, CaretDown, DotsThreeVertical, Plus, Terminal } from "phosphor-svelte";
import type { AgentPanelSceneModel } from "@acepe/ui";

import LandingDemoFrame from "./landing-demo-frame.svelte";
import { websiteThemeStore } from "$lib/theme/theme.js";

const theme = $derived($websiteThemeStore);

function agentIcon(agent: "claude" | "codex" | "cursor" | "opencode", t: string): string {
	if (agent === "codex") return `/svgs/agents/codex/codex-icon-${t}.svg`;
	if (agent === "cursor") return `/svgs/agents/cursor/cursor-icon-${t}.svg`;
	if (agent === "opencode") return `/svgs/agents/opencode/opencode-logo-${t}.svg`;
	return `/svgs/agents/claude/claude-icon-${t}.svg`;
}

// Queue items for the attention queue
interface DemoQueueItem {
	id: string;
	title: string;
	agentIconSrc: string;
	projectName: string;
	projectColor: string;
	statusText: string;
	isStreaming: boolean;
	todoProgress: { current: number; total: number } | null;
}

interface DemoSidebarSession {
	id: string;
	title: string;
	agentIconSrc: string;
	status: "idle" | "running" | "done" | "error";
	isActive: boolean;
	timeAgo: string;
	lastActionText: string;
	isStreaming?: boolean;
	insertions?: number;
	deletions?: number;
	sequenceId?: number;
	worktreePath?: string;
	prNumber?: number;
	prState?: "OPEN" | "CLOSED" | "MERGED";
}

interface DemoSidebarGroup {
	path: string;
	name: string;
	color: string;
	iconSrc?: string | null;
	sessions: DemoSidebarSession[];
}

interface DemoProjectPanel {
	sessionId: string;
	agentIconSrc: string;
	scene: AgentPanelSceneModel;
}

const ACEPE_PATH = "/Users/dev/acepe";
const DESKTOP_PATH = "/Users/dev/desktop";
const API_PATH = "/Users/dev/api";

let activeProjectPath = $state(ACEPE_PATH);
let activeSessionId = $state("s1");

function createScene(params: {
	panelId: string;
	title: string;
	agentLabel: string;
	agentIconSrc: string;
	projectLabel: string;
	projectColor: string;
	sequenceId: number;
	userText: string;
	searchSubtitle: string;
	searchQuery: string;
	searchFiles: string[];
	editFilePath: string;
	assistantMarkdown: string;
	isStreaming: boolean;
}): AgentPanelSceneModel {
	return {
		panelId: params.panelId,
		status: "connected",
		header: {
			title: params.title,
			subtitle: null,
			status: "connected",
			agentLabel: params.agentLabel,
			agentIconSrc: params.agentIconSrc,
			projectLabel: params.projectLabel,
			projectColor: params.projectColor,
			sequenceId: params.sequenceId,
			actions: [],
		},
		conversation: {
			entries: [
				{ id: `${params.panelId}-user`, type: "user", text: params.userText },
				{
					id: `${params.panelId}-tool-search`,
					type: "tool_call",
					kind: "search",
					title: "Search",
					subtitle: params.searchSubtitle,
					query: params.searchQuery,
					searchPath: "packages",
					searchFiles: params.searchFiles,
					searchResultCount: params.searchFiles.length,
					status: "done",
				},
				{
					id: `${params.panelId}-tool-edit`,
					type: "tool_call",
					kind: "edit",
					title: "Edit",
					filePath: params.editFilePath,
					status: "done",
				},
				{
					id: `${params.panelId}-assistant`,
					type: "assistant",
					markdown: params.assistantMarkdown,
					isStreaming: params.isStreaming,
				},
			],
			isStreaming: params.isStreaming,
		},
	};
}

function selectProject(projectPath: string): void {
	activeProjectPath = projectPath;
	const nextGroup = sidebarGroups.find((group) => group.path === projectPath);
	if (!nextGroup) return;
	const hasActiveSession = nextGroup.sessions.some((session) => session.id === activeSessionId);
	if (hasActiveSession) return;
	const firstSession = nextGroup.sessions[0];
	if (firstSession) {
		activeSessionId = firstSession.id;
	}
}

function selectSession(projectPath: string, sessionId: string): void {
	activeProjectPath = projectPath;
	activeSessionId = sessionId;
}

const queueItems = $derived<DemoQueueItem[]>([
	{
		id: "q1",
		title: "Unblock review queue",
		agentIconSrc: agentIcon("claude", theme),
		projectName: "acepe.dev",
		projectColor: "#9858FF",
		statusText: "Editing agent-panel-shell.svelte",
		isStreaming: true,
		todoProgress: { current: 2, total: 4 },
	},
	{
		id: "q2",
		title: "Audit panel regressions",
		agentIconSrc: agentIcon("codex", theme),
		projectName: "desktop",
		projectColor: "#4AD0FF",
		statusText: "Searching panel parity surfaces",
		isStreaming: true,
		todoProgress: { current: 1, total: 3 },
	},
]);

const sidebarGroups = $derived<DemoSidebarGroup[]>([
	{
		path: ACEPE_PATH,
		name: "acepe.dev",
		color: "#9858FF",
		sessions: [
			{
				id: "s1",
				title: "Unblock review queue",
				agentIconSrc: agentIcon("claude", theme),
				status: "running",
				isActive: activeProjectPath === ACEPE_PATH && activeSessionId === "s1",
				timeAgo: "2m",
				lastActionText: "Editing agent-panel-shell.svelte",
				isStreaming: true,
				insertions: 18,
				deletions: 5,
				sequenceId: 12,
			},
			{
				id: "s2",
				title: "Polish release notes",
				agentIconSrc: agentIcon("cursor", theme),
				status: "done",
				isActive: activeProjectPath === ACEPE_PATH && activeSessionId === "s2",
				timeAgo: "14m",
				lastActionText: "Ran bun run check",
				insertions: 34,
				deletions: 8,
				sequenceId: 9,
			},
			{
				id: "s3",
				title: "Fix hero spacing",
				agentIconSrc: agentIcon("claude", theme),
				status: "done",
				isActive: activeProjectPath === ACEPE_PATH && activeSessionId === "s3",
				timeAgo: "1h",
				lastActionText: "Done — 3 files changed",
				insertions: 12,
				deletions: 3,
				sequenceId: 6,
			},
		],
	},
	{
		path: DESKTOP_PATH,
		name: "desktop",
		color: "#4AD0FF",
		sessions: [
			{
				id: "s4",
				title: "Audit panel regressions",
				agentIconSrc: agentIcon("codex", theme),
				status: "running",
				isActive: activeProjectPath === DESKTOP_PATH && activeSessionId === "s4",
				timeAgo: "5m",
				lastActionText: "Searching panel parity surfaces",
				isStreaming: true,
				insertions: 6,
				deletions: 1,
				sequenceId: 4,
			},
			{
				id: "s5",
				title: "Worktree isolation bug",
				agentIconSrc: agentIcon("claude", theme),
				status: "error",
				isActive: activeProjectPath === DESKTOP_PATH && activeSessionId === "s5",
				timeAgo: "22m",
				lastActionText: "Error: git worktree remove failed",
				sequenceId: 3,
				worktreePath: "/tmp/acepe-wt-3",
			},
			{
				id: "s8",
				title: "Ship kanban polish",
				agentIconSrc: agentIcon("cursor", theme),
				status: "done",
				isActive: activeProjectPath === DESKTOP_PATH && activeSessionId === "s8",
				timeAgo: "34m",
				lastActionText: "Merged board density tweaks",
				insertions: 27,
				deletions: 11,
				sequenceId: 8,
			},
		],
	},
	{
		path: API_PATH,
		name: "api",
		color: "#FF8D20",
		sessions: [
			{
				id: "s6",
				title: "Fix auth middleware",
				agentIconSrc: agentIcon("opencode", theme),
				status: "idle",
				isActive: activeProjectPath === API_PATH && activeSessionId === "s6",
				timeAgo: "45m",
				lastActionText: "Idle — waiting for input",
				sequenceId: 2,
			},
			{
				id: "s7",
				title: "Rate limiter config",
				agentIconSrc: agentIcon("codex", theme),
				status: "done",
				isActive: activeProjectPath === API_PATH && activeSessionId === "s7",
				timeAgo: "2h",
				lastActionText: "Done — rate limiting applied",
				insertions: 22,
				deletions: 4,
				sequenceId: 1,
				prNumber: 47,
				prState: "MERGED",
			},
		],
	},
]);

const projectPanels = $derived<DemoProjectPanel[]>([
	{
		sessionId: "s1",
		agentIconSrc: agentIcon("claude", theme),
		scene: createScene({
			panelId: "by-project-s1",
			title: "Unblock review queue",
			agentLabel: "Claude Code",
			agentIconSrc: agentIcon("claude", theme),
			projectLabel: "acepe.dev",
			projectColor: "#9858FF",
			sequenceId: 12,
			userText:
				"Tighten the review queue so the shared agent panel stops drifting between desktop and website.",
			searchSubtitle: "shared panel surfaces",
			searchQuery: "AgentPanelDeck AgentPanelFooter",
			searchFiles: [
				"packages/ui/src/components/agent-panel/agent-panel-deck.svelte",
				"packages/ui/src/components/agent-panel/agent-panel-footer.svelte",
			],
			editFilePath: "packages/ui/src/components/agent-panel/agent-panel-shell.svelte",
			assistantMarkdown:
				"Pulled the shared panel rail and composer frame into `@acepe/ui`, then removed the website-only footer drift.\n\nChecking the remaining spacing deltas now.",
			isStreaming: true,
		}),
	},
	{
		sessionId: "s2",
		agentIconSrc: agentIcon("cursor", theme),
		scene: createScene({
			panelId: "by-project-s2",
			title: "Polish release notes",
			agentLabel: "Cursor",
			agentIconSrc: agentIcon("cursor", theme),
			projectLabel: "acepe.dev",
			projectColor: "#9858FF",
			sequenceId: 9,
			userText:
				"Tighten the launch notes so the new queue and kanban demos feel consistent with the rest of the homepage.",
			searchSubtitle: "launch-note surfaces",
			searchQuery: "queue demo kanban release notes",
			searchFiles: [
				"packages/website/src/routes/changelog/+page.svelte",
				"packages/website/src/lib/components/feature-showcase.svelte",
			],
			editFilePath: "packages/website/src/lib/components/landing-kanban-demo.svelte",
			assistantMarkdown:
				"Updated the release-note framing so the queue and kanban demos read as one launch slice.\n\nI also tightened the supporting copy to keep the section lighter.",
			isStreaming: false,
		}),
	},
	{
		sessionId: "s3",
		agentIconSrc: agentIcon("claude", theme),
		scene: createScene({
			panelId: "by-project-s3",
			title: "Fix hero spacing",
			agentLabel: "Claude Code",
			agentIconSrc: agentIcon("claude", theme),
			projectLabel: "acepe.dev",
			projectColor: "#9858FF",
			sequenceId: 6,
			userText:
				"The homepage hero feels too tight around the demo stage. Ease the spacing without making the fold too tall.",
			searchSubtitle: "hero layout",
			searchQuery: "hero-demo-stage feature-showcase",
			searchFiles: [
				"packages/website/src/routes/+page.svelte",
				"packages/website/src/lib/components/feature-showcase.svelte",
			],
			editFilePath: "packages/website/src/routes/+page.svelte",
			assistantMarkdown:
				"Gave the hero demo stage a calmer top rhythm and widened the text-to-demo gutter.\n\nThe fold still lands in one screen, but the composition breathes more.",
			isStreaming: false,
		}),
	},
	{
		sessionId: "s4",
		agentIconSrc: agentIcon("codex", theme),
		scene: createScene({
			panelId: "by-project-s4",
			title: "Audit panel regressions",
			agentLabel: "Codex",
			agentIconSrc: agentIcon("codex", theme),
			projectLabel: "desktop",
			projectColor: "#4AD0FF",
			sequenceId: 4,
			userText:
				"Track the panel parity regressions between website demos and the desktop app before the next release.",
			searchSubtitle: "parity checklist",
			searchQuery: "panel parity website desktop",
			searchFiles: [
				"packages/desktop/src/lib/components/main-app-view/components/content/panels-container.svelte",
				"packages/website/src/lib/components/landing-by-project-demo.svelte",
			],
			editFilePath: "packages/desktop/src/lib/components/top-bar/top-bar.svelte",
			assistantMarkdown:
				"Grouped the remaining parity issues by panel chrome, spacing, and layout controls.\n\nI’m validating the last header gap now.",
			isStreaming: true,
		}),
	},
	{
		sessionId: "s5",
		agentIconSrc: agentIcon("claude", theme),
		scene: createScene({
			panelId: "by-project-s5",
			title: "Worktree isolation bug",
			agentLabel: "Claude Code",
			agentIconSrc: agentIcon("claude", theme),
			projectLabel: "desktop",
			projectColor: "#4AD0FF",
			sequenceId: 3,
			userText:
				"Figure out why the temporary worktree cleanup sometimes fails when a session exits early.",
			searchSubtitle: "worktree cleanup",
			searchQuery: "worktree remove cleanup temp path",
			searchFiles: [
				"packages/desktop/src/lib/acp/components/worktree/worktree-default-store.svelte.ts",
				"packages/desktop/src/lib/components/main-app-view/logic/managers/session-handler.js",
			],
			editFilePath:
				"packages/desktop/src/lib/acp/components/worktree/worktree-default-store.svelte.ts",
			assistantMarkdown:
				"The failing branch still points at a detached temp path after the session exits.\n\nI isolated the cleanup guard and left the error state visible instead of masking it.",
			isStreaming: false,
		}),
	},
	{
		sessionId: "s8",
		agentIconSrc: agentIcon("cursor", theme),
		scene: createScene({
			panelId: "by-project-s8",
			title: "Ship kanban polish",
			agentLabel: "Cursor",
			agentIconSrc: agentIcon("cursor", theme),
			projectLabel: "desktop",
			projectColor: "#4AD0FF",
			sequenceId: 8,
			userText:
				"Tighten the kanban board so the cards read faster at a glance and the column rhythm feels lighter.",
			searchSubtitle: "kanban spacing",
			searchQuery: "kanban column density card rhythm",
			searchFiles: [
				"packages/desktop/src/lib/components/main-app-view/components/content/kanban-view.svelte",
				"packages/ui/src/components/kanban/kanban-card.svelte",
			],
			editFilePath: "packages/ui/src/components/kanban/kanban-card.svelte",
			assistantMarkdown:
				"Reduced the board chrome and sharpened the card hierarchy so active work stands out sooner.\n\nThe finished column now stays visually quieter.",
			isStreaming: false,
		}),
	},
	{
		sessionId: "s6",
		agentIconSrc: agentIcon("opencode", theme),
		scene: createScene({
			panelId: "by-project-s6",
			title: "Fix auth middleware",
			agentLabel: "OpenCode",
			agentIconSrc: agentIcon("opencode", theme),
			projectLabel: "api",
			projectColor: "#FF8D20",
			sequenceId: 2,
			userText:
				"The new auth layer still mixes session cookies and JWT checks. Simplify it so the middleware has one path.",
			searchSubtitle: "auth middleware",
			searchQuery: "jwt session middleware auth",
			searchFiles: [
				"packages/website/src/lib/server/auth/admin.ts",
				"packages/website/src/lib/server/domain/errors/AuthErrors.ts",
			],
			editFilePath: "packages/website/src/lib/server/auth/admin.ts",
			assistantMarkdown:
				"I traced the cookie fallback to the admin auth branch.\n\nNext step is removing the mixed-path guard so every request resolves through the same verifier.",
			isStreaming: false,
		}),
	},
	{
		sessionId: "s7",
		agentIconSrc: agentIcon("codex", theme),
		scene: createScene({
			panelId: "by-project-s7",
			title: "Rate limiter config",
			agentLabel: "Codex",
			agentIconSrc: agentIcon("codex", theme),
			projectLabel: "api",
			projectColor: "#FF8D20",
			sequenceId: 1,
			userText:
				"Apply the new token bucket config to the public endpoints and expose the hit counts in monitoring.",
			searchSubtitle: "rate-limit rollout",
			searchQuery: "token bucket public endpoints monitoring",
			searchFiles: [
				"packages/website/src/lib/server/application/ReportsApplicationService.ts",
				"packages/website/src/lib/server/infrastructure/container.ts",
			],
			editFilePath: "packages/website/src/lib/server/infrastructure/container.ts",
			assistantMarkdown:
				"Rolled the limiter into the public container bindings and wired the metrics emitter.\n\nThe merge is clean and the config stays project-local.",
			isStreaming: false,
		}),
	},
]);

const activeProject = $derived.by(() => {
	const matchedGroup = sidebarGroups.find((group) => group.path === activeProjectPath);
	if (matchedGroup) {
		return matchedGroup;
	}
	return sidebarGroups[0];
});

const activePanel = $derived.by(() => {
	const matchedPanel = projectPanels.find((panel) => panel.sessionId === activeSessionId);
	if (matchedPanel) {
		return matchedPanel;
	}
	return projectPanels[0];
});

const availableModes = [{ id: "plan" }, { id: "build" }] as const;

const modelGroups = $derived([
	{
		label: "Anthropic",
		items: [
			{
				id: "claude-sonnet-4",
				name: "Claude Sonnet 4",
				providerSource: "Anthropic",
				isFavorite: true,
				isBuildDefault: true,
				isPlanDefault: false,
			},
			{
				id: "claude-opus-4-6",
				name: "Claude Opus 4.6",
				providerSource: "Anthropic",
				isFavorite: false,
				isBuildDefault: false,
				isPlanDefault: true,
			},
		],
	},
]);

const favoriteModels = $derived(modelGroups.flatMap((g) => g.items.filter((i) => i.isFavorite)));
</script>

<LandingDemoFrame interactive={true}>
	{#snippet children()}
		<AppMainLayout>
			{#snippet sidebar()}
				<AppSidebarLayout>
					{#snippet queueSection()}
						<div class="mb-0.5 mt-1.5 flex shrink-0 flex-col overflow-hidden rounded-lg bg-card/50 mx-1.5">
							<div class="flex w-full items-center gap-1.5 px-2 py-1.5">
								<span class="text-[11px] font-medium text-muted-foreground">Attention Queue</span>
								<span class="text-[10px] text-muted-foreground/60 tabular-nums">{queueItems.length}</span>
							</div>
							<div class="flex flex-col gap-0.5 p-1 pt-0">
								{#each queueItems as qItem (qItem.id)}
									<div class="flex flex-col gap-1 px-2 py-1.5 rounded hover:bg-accent/50 transition-colors">
										<div class="flex items-center gap-1.5">
											<ProjectLetterBadge
												name={qItem.projectName}
												color={qItem.projectColor}
												iconSrc={null}
												size={14}
											/>
											<img src={qItem.agentIconSrc} alt="" class="size-3.5 rounded-sm" />
											<div class="flex-1 min-w-0">
												<div class="text-xs font-medium truncate">{qItem.title}</div>
											</div>
										</div>
										<div class="flex items-center gap-1.5">
											<div class="flex-1 min-w-0 text-[10px] text-muted-foreground truncate">
												{#if qItem.isStreaming}
													<TextShimmer class="truncate">{qItem.statusText}</TextShimmer>
												{:else}
													<span class="truncate">{qItem.statusText}</span>
												{/if}
											</div>
											{#if qItem.todoProgress}
												<div class="flex items-center gap-1 shrink-0">
													<SegmentedProgress current={qItem.todoProgress.current} total={qItem.todoProgress.total} />
												</div>
											{/if}
										</div>
									</div>
								{/each}
							</div>
						</div>
					{/snippet}
					{#snippet sessionList()}
						<div class="relative flex flex-col flex-1 min-h-0 gap-0.5 overflow-y-auto outline-none">
							{#each sidebarGroups as group (group.name)}
								<div class="p-1">
									<AppSidebarProjectGroup
										group={{
											name: group.name,
											color: group.color,
											iconSrc: group.iconSrc ?? null,
											sessions: [],
										}}
									>
										{#snippet header()}
											<div class="group shrink-0 flex items-center rounded-md px-2 {group.path === activeProjectPath ? 'bg-accent/25' : 'bg-card'}">
												<button
													type="button"
													class="flex min-w-0 flex-1 items-center text-left"
													onclick={() => selectProject(group.path)}
												>
													<div class="inline-flex items-center justify-center h-7 shrink-0">
														<ProjectLetterBadge
															name={group.name}
															color={group.color}
															iconSrc={group.iconSrc ?? null}
															size={16}
														/>
													</div>
													<div class="flex items-center flex-1 min-w-0 h-7 pl-2">
														<span class="truncate text-[10px] font-semibold tracking-wide {group.path === activeProjectPath ? 'text-foreground' : 'text-muted-foreground/70'}">{group.name}</span>
													</div>
												</button>
												<div class="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
													<button type="button" aria-label="Open terminal" class="flex items-center justify-center size-5 rounded text-muted-foreground">
														<Terminal class="h-3 w-3" weight="fill" />
													</button>
													<button type="button" aria-label="Open browser" class="flex items-center justify-center size-5 rounded text-muted-foreground">
														<Browser class="h-3 w-3" weight="fill" />
													</button>
												</div>
												<button type="button" aria-label="Collapse project" class="flex items-center justify-center size-5 shrink-0 rounded text-muted-foreground">
													<CaretDown class="h-3 w-3" weight="bold" />
												</button>
												<div class="flex items-center gap-0.5">
													<button type="button" aria-label="Project menu" class="flex items-center justify-center size-5 min-w-0 shrink-0 rounded text-muted-foreground">
														<DotsThreeVertical class="h-3.5 w-3.5" weight="bold" />
													</button>
													<button type="button" aria-label="New session" class="flex items-center justify-center size-5 rounded text-muted-foreground">
														<Plus class="h-3 w-3" weight="bold" />
													</button>
												</div>
											</div>
										{/snippet}
										{#snippet children()}
											<div class="flex-1 min-h-0 overflow-auto">
												<div class="flex flex-col gap-0.5 p-1">
													{#each group.sessions as session (session.id)}
														<button
															type="button"
															class="flex w-full flex-col gap-1 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent/50 {session.isActive
																? 'bg-accent/20'
																: ''}"
															onclick={() => selectSession(group.path, session.id)}
														>
														<div class="flex items-center gap-1.5">
															<img
																src={session.agentIconSrc}
																alt=""
																class="h-3 w-3 shrink-0 m-0.5 rounded-sm"
																role="presentation"
																width="12"
																height="12"
															/>
															<div class="min-w-0 flex-1">
																<div class="truncate text-xs font-medium">{session.title}</div>
															</div>
															<span class="shrink-0 text-[10px] tabular-nums text-muted-foreground/60">
																{session.timeAgo}
															</span>
															{#if session.status === "running"}
																<span class="relative flex h-1.5 w-1.5 shrink-0">
																	<span
																		class="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-75"
																	></span>
																	<span class="relative inline-flex h-1.5 w-1.5 rounded-full bg-green-500"></span>
																</span>
															{:else if session.status === "done"}
																<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-green-500"></span>
															{:else if session.status === "error"}
																<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-destructive"></span>
															{/if}
														</div>
														<div class="flex items-center gap-1.5">
															<div class="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">
																{#if session.isStreaming}
																	<TextShimmer class="truncate">{session.lastActionText}</TextShimmer>
																{:else}
																	<span class="truncate">{session.lastActionText}</span>
																{/if}
															</div>
															{#if (session.insertions ?? 0) > 0 || (session.deletions ?? 0) > 0}
																<DiffPill
																	insertions={session.insertions ?? 0}
																	deletions={session.deletions ?? 0}
																	variant="plain"
																	class="text-[10px]"
																/>
															{/if}
														</div>
														{#if session.worktreePath || session.prNumber}
															<div class="flex items-center gap-1.5 text-[10px] text-muted-foreground/70">
																{#if session.worktreePath}
																	<span class="min-w-0 flex-1 truncate font-mono">
																		{session.worktreePath}
																	</span>
																{/if}
																{#if session.prNumber}
																	<span class="shrink-0 rounded border border-border/60 px-1.5 py-0.5 font-mono uppercase">
																		PR #{session.prNumber} {session.prState?.toLowerCase()}
																	</span>
																{/if}
															</div>
														{/if}
														</button>
													{/each}
												</div>
											</div>
										{/snippet}
									</AppSidebarProjectGroup>
								</div>
							{/each}
						</div>
					{/snippet}
					{#snippet footer()}
						<AppSidebarFooter
							githubUrl="https://github.com/flazouh/acepe"
							xUrl="https://x.com/AcepeDev"
							discordUrl="https://discord.gg/acepe"
							version="1.4.2"
						/>
					{/snippet}
				</AppSidebarLayout>
			{/snippet}
			{#snippet panels()}
				<div class="flex-1 min-w-0 min-h-0 overflow-hidden p-0.5">
					<ProjectCard
						projectName={activeProject.name}
						projectColor={activeProject.color}
						variant="corner"
						allProjects={[
							{ name: "acepe.dev", color: "#9858FF", path: ACEPE_PATH },
							{ name: "desktop", color: "#4AD0FF", path: DESKTOP_PATH },
							{ name: "api", color: "#FF8D20", path: API_PATH },
						]}
						activeProjectPath={activeProjectPath}
						onSelectProject={selectProject}
						class="h-full"
					>
					<div class="flex min-w-0 min-h-0 flex-1 flex-col overflow-hidden">
					<div class="flex-1 min-w-0 min-h-0 overflow-hidden">
					<AgentPanelScene
						scene={activePanel.scene}
						iconBasePath="/svgs/icons"
						widthStyle="min-width: 0; width: 100%; max-width: 100%;"
					>
						{#snippet headerControls()}
							<AgentPanelStatusIcon status={activePanel.scene.header.status} />
							<OverflowMenuTriggerAction title="More actions" />
							<FullscreenAction isFullscreen={false} onToggle={() => {}} />
							<CloseAction onClose={() => {}} />
						{/snippet}
						{#snippet composerOverride()}
							<div class="shrink-0">
								<AgentPanelComposerFrame>
									<AgentPanelComposer
										class="border-t-0 p-0"
										inputClass="flex-shrink-0 border border-border bg-input/30"
										contentClass="p-4 py-4"
									>
										{#snippet content()}
											<AgentInputEditor
												placeholder="Plan, @ for context, / for commands"
												isEmpty={true}
												submitIntent="send"
												submitDisabled={true}
												submitAriaLabel="Send message"
											/>
										{/snippet}
										{#snippet footer()}
											<AgentInputToolbar>
												{#snippet items()}
													<AgentInputModeSelector
														{availableModes}
														currentModeId="build"
														onModeChange={() => {}}
													/>
													<AgentInputDivider />
													<AgentInputAutonomousToggle
														active={false}
														title="Autonomous mode"
														onToggle={() => {}}
													/>
													<AgentInputDivider />
													<AgentInputModelSelector
														triggerLabel="Claude Sonnet 4"
														triggerProviderSource="Anthropic"
														currentModelId="claude-sonnet-4"
														{modelGroups}
														{favoriteModels}
														onModelChange={() => {}}
														onSetBuildDefault={() => {}}
														onSetPlanDefault={() => {}}
														onToggleFavorite={() => {}}
													/>
													<AgentInputDivider />
												{/snippet}
												{#snippet trailing()}
													<AgentInputMetricsChip
														label="12/200k"
														percent={6}
														hideLabel={true}
													/>
													<AgentInputMicButton visualState="mic" title="Record with Claude" />
												{/snippet}
											</AgentInputToolbar>
										{/snippet}
									</AgentPanelComposer>
								</AgentPanelComposerFrame>
							</div>
						{/snippet}
						{#snippet footerOverride()}
							<AgentPanelFooter
								browserActive={false}
								terminalActive={false}
								terminalDisabled={false}
							/>
						{/snippet}
					</AgentPanelScene>
					</div>
					</div>
					</ProjectCard>
				</div>
			{/snippet}
		</AppMainLayout>
	{/snippet}
</LandingDemoFrame>
