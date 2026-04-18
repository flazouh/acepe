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
		ProjectLetterBadge,
		TextShimmer,
		SegmentedProgress,
	} from "@acepe/ui";
	import {
		AppMainLayout,
		AppSidebarLayout,
		AppSidebarProjectGroup,
		AppSidebarFooter,
		AppSearchButton,
	} from "@acepe/ui/app-layout";
	import type {
		AppProjectGroup,
	} from "@acepe/ui/app-layout";
	import { ProjectCard } from "@acepe/ui/project-card";
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

	const sidebarGroups = $derived<AppProjectGroup[]>([
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
		status: "running",
		header: {
			title: "Unblock review queue",
			subtitle: null,
			status: "running",
			agentLabel: "Claude Code",
			agentIconSrc: agentIcon("claude", theme),
			projectLabel: "acepe.dev",
			projectColor: "#9858FF",
			projectIconSrc: null,
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
						<div class="shrink-0 px-1.5 pt-1.5">
							<AppSearchButton label="Search sessions…" />
						</div>
						<div class="mb-0.5 flex shrink-0 flex-col overflow-hidden rounded-lg bg-card/50 mx-1.5 mt-1">
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
						<div class="flex flex-col overflow-auto p-1.5 gap-0.5">
							{#each sidebarGroups as group (group.name)}
								<AppSidebarProjectGroup {group} />
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
						{#snippet composerOverride()}
							<div class="shrink-0">
								<AgentPanelComposerFrame>
									<AgentPanelComposer
										class="border-t-0 p-0"
										inputClass="flex-shrink-0 border border-border bg-input/30"
										contentClass="p-3"
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
