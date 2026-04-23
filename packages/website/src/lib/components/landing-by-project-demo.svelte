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
	import type {
		AgentPanelSceneModel,
	} from "@acepe/ui";

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
		name: string;
		color: string;
		iconSrc?: string | null;
		sessions: DemoSidebarSession[];
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
			name: "acepe.dev",
			color: "#9858FF",
			sessions: [
				{
					id: "s1",
					title: "Unblock review queue",
					agentIconSrc: agentIcon("claude", theme),
					status: "running",
					isActive: true,
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
					isActive: false,
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
					isActive: false,
					timeAgo: "1h",
					lastActionText: "Done — 3 files changed",
					insertions: 12,
					deletions: 3,
					sequenceId: 6,
				},
			],
		},
		{
			name: "desktop",
			color: "#4AD0FF",
			sessions: [
				{
					id: "s4",
					title: "Audit panel regressions",
					agentIconSrc: agentIcon("codex", theme),
					status: "running",
					isActive: false,
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
					isActive: false,
					timeAgo: "22m",
					lastActionText: "Error: git worktree remove failed",
					sequenceId: 3,
					worktreePath: "/tmp/acepe-wt-3",
				},
			],
		},
		{
			name: "api",
			color: "#FF8D20",
			sessions: [
				{
					id: "s6",
					title: "Fix auth middleware",
					agentIconSrc: agentIcon("opencode", theme),
					status: "idle",
					isActive: false,
					timeAgo: "45m",
					lastActionText: "Idle — waiting for input",
					sequenceId: 2,
				},
				{
					id: "s7",
					title: "Rate limiter config",
					agentIconSrc: agentIcon("codex", theme),
					status: "done",
					isActive: false,
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

	const focusedScene = $derived<AgentPanelSceneModel>({
		panelId: "by-project-panel",
		status: "connected",
		header: {
			title: "Unblock review queue",
			subtitle: null,
			status: "connected",
			agentLabel: "Claude Code",
			agentIconSrc: agentIcon("claude", theme),
			projectLabel: "acepe.dev",
			projectColor: "#9858FF",
			sequenceId: 12,
			actions: [],
		},
		conversation: {
			entries: [
				{ id: "bp-u1", type: "user", text: "Tighten the review queue so the shared agent panel stops drifting between desktop and website." },
				{
					id: "bp-tool-1",
					type: "tool_call",
					kind: "search",
					title: "Search",
					subtitle: "shared panel surfaces",
					query: "AgentPanelDeck AgentPanelFooter",
					searchPath: "packages",
					searchFiles: [
						"packages/ui/src/components/agent-panel/agent-panel-deck.svelte",
						"packages/ui/src/components/agent-panel/agent-panel-footer.svelte",
					],
					searchResultCount: 2,
					status: "done",
				},
				{
					id: "bp-tool-2",
					type: "tool_call",
					kind: "edit",
					title: "Edit",
					filePath: "packages/ui/src/components/agent-panel/agent-panel-shell.svelte",
					status: "done",
				},
				{
					id: "bp-a1",
					type: "assistant",
					markdown: "Pulled the shared panel rail and composer frame into `@acepe/ui`, then removed the website-only footer drift.\n\nChecking the remaining spacing deltas now.",
					isStreaming: true,
				},
			],
			isStreaming: true,
		},
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

	const favoriteModels = $derived(
		modelGroups.flatMap((g) => g.items.filter((i) => i.isFavorite))
	);
</script>

<LandingDemoFrame>
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
											<div class="group shrink-0 flex items-center rounded-md bg-card px-2">
												<div class="inline-flex items-center justify-center h-7 shrink-0">
													<ProjectLetterBadge
														name={group.name}
														color={group.color}
														iconSrc={group.iconSrc ?? null}
														size={16}
													/>
												</div>
												<div class="flex items-center flex-1 min-w-0 h-7 pl-2">
													<span class="truncate text-[10px] font-semibold tracking-wide text-muted-foreground/70">{group.name}</span>
												</div>
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
						projectName="acepe.dev"
						projectColor="#9858FF"
						variant="corner"
						allProjects={[
							{ name: "acepe.dev", color: "#9858FF", path: "/Users/dev/acepe" },
							{ name: "desktop", color: "#4AD0FF", path: "/Users/dev/desktop" },
							{ name: "api", color: "#FF8D20", path: "/Users/dev/api" },
						]}
						activeProjectPath="/Users/dev/acepe"
						class="h-full"
					>
					<div class="flex-1 min-w-0 min-h-0 overflow-hidden">
					<AgentPanelScene
						scene={focusedScene}
						iconBasePath="/svgs/icons"
						widthStyle="min-width: 0; width: 100%; max-width: 100%;"
					>
						{#snippet headerControls()}
							<AgentPanelStatusIcon status={focusedScene.header.status} />
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
					</ProjectCard>
				</div>
			{/snippet}
		</AppMainLayout>
	{/snippet}
</LandingDemoFrame>
