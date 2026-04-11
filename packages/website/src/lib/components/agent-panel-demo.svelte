<script lang="ts">
	import { onMount } from "svelte";

	import {
		AgentPanel,
		AgentPanelComposer,
		AgentPanelComposerEditor,
		AgentPanelComposerSubmitButton,
		AgentPanelComposerToolbar,
		AgentPanelComposerToolbarDivider,
		AgentPanelConversationEntry,
		AgentPanelCreatePrButton,
		AgentPanelFooter,
		AgentPanelHeader,
		AgentPanelModifiedFileRow,
		AgentPanelModifiedFilesHeader,
		AgentPanelModifiedFilesTrailingControls,
		AgentPanelPermissionBar,
		AgentPanelPermissionBarActions,
		AgentPanelPermissionBarIcon,
		AgentPanelPermissionBarProgress,
		AgentPanelPlanHeader,
		AgentPanelTodoHeader,
	} from "@acepe/ui/agent-panel";
	import { PlanSidebarLayout } from "@acepe/ui/plan-sidebar";
	import type {
		AgentPanelModifiedFileItem,
		AgentPanelModifiedFilesTrailingModel,
	} from "@acepe/ui/agent-panel";
	import LandingDemoFrame from "./landing-demo-frame.svelte";
	import {
		AGENT_PANEL_DEMO_DELAYS,
		AGENT_PANEL_DEMO_PLAN_MARKDOWN,
		AGENT_PANEL_DEMO_REVIEW_FILES,
		AGENT_PANEL_DEMO_SCRIPT,
		buildDemoTodoItems,
	} from "./agent-panel-demo-scene.js";

	let visibleCount = $state(0);
	let animating = $state(false);
	let showPlanSidebar = $state(true);

	const entries = $derived(AGENT_PANEL_DEMO_SCRIPT.slice(0, visibleCount));
	const isRunning = $derived(
		visibleCount > 0 && visibleCount < AGENT_PANEL_DEMO_SCRIPT.length
	);
	const isComplete = $derived(visibleCount >= AGENT_PANEL_DEMO_SCRIPT.length);
	const showSupportWidgets = $derived(visibleCount >= 7);
	const showPermissionBar = $derived(visibleCount >= 9 && !isComplete);
	const showModifiedFilesHeader = $derived(visibleCount >= 10);
	const todoItems = $derived(buildDemoTodoItems(visibleCount));
	const completedTodoCount = $derived(
		todoItems.filter((item) => item.status === "completed").length
	);
	const currentTodoItem = $derived.by(() => {
		for (const item of todoItems) {
			if (item.status === "in_progress") {
				return item;
			}
		}

		return null;
	});
	const modifiedFiles = $derived<readonly AgentPanelModifiedFileItem[]>(
		AGENT_PANEL_DEMO_REVIEW_FILES.map((file) => ({
			id: file.id,
			filePath: file.label,
			reviewStatus:
			file.status === "done"
					? "accepted"
					: file.status === "reviewing"
						? "partial"
						: "unreviewed",
			additions: Number(file.summary.split(" ")[0]?.replace("+", "") ?? 0),
			deletions: Number(file.summary.split(" ")[1]?.replace("−", "").replace("-", "") ?? 0),
		}))
	);
	const modifiedFilesTrailingModel = $derived<AgentPanelModifiedFilesTrailingModel>({
		reviewLabel: "Review",
		reviewOptions: [],
		keepState: "applied",
		keepLabel: "Keep all",
		appliedLabel: "Reviewed",
		reviewedCount: 2,
		totalCount: 3,
	});

	async function play(): Promise<void> {
		if (animating) {
			return;
		}

		animating = true;
		visibleCount = 0;

		for (let index = 0; index < AGENT_PANEL_DEMO_SCRIPT.length; index += 1) {
			const delay = AGENT_PANEL_DEMO_DELAYS[index] ?? 400;
			await new Promise<void>((resolve) => {
				setTimeout(resolve, delay);
			});
			visibleCount = index + 1;
		}

		animating = false;
	}

	function togglePlanSidebar(): void {
		showPlanSidebar = !showPlanSidebar;
	}

	onMount(() => {
		const timer = setTimeout(() => {
			void play();
		}, 300);

		return () => {
			clearTimeout(timer);
		};
	});
</script>

<LandingDemoFrame>
	{#snippet children()}
		<div class="relative h-full w-full">
			<AgentPanel widthStyle="width: 100%; height: 100%;">
		{#snippet header()}
			<AgentPanelHeader
				displayTitle="Migrate auth to JWT"
				sessionStatus={isComplete ? "done" : isRunning ? "running" : "idle"}
				projectName="acepe"
				projectColor="#7C3AED"
				showTrailingBorder={false}
			>
				{#snippet controls()}
					<div class="flex items-center gap-1 px-1">
						<button
							type="button"
							class="rounded border border-border/50 px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
							onclick={() => void play()}
						>
							Replay
						</button>
					</div>
				{/snippet}
			</AgentPanelHeader>
		{/snippet}

		{#snippet topBar()}
			{#if showSupportWidgets}
				<AgentPanelPlanHeader
					title="Execution plan ready"
					isExpanded={showPlanSidebar}
					expandLabel="Expand plan"
					collapseLabel="Collapse plan"
					onToggleSidebar={togglePlanSidebar}
				/>
			{/if}
		{/snippet}

		{#snippet body()}
			<div class="flex-1 min-h-0 overflow-y-auto px-5 py-4">
				<div class="mx-auto flex w-full max-w-[60%] flex-col gap-3">
					{#each entries as entry (entry.id)}
						<AgentPanelConversationEntry {entry} iconBasePath="/svgs/icons" />
					{/each}
				</div>
			</div>
		{/snippet}

		{#snippet preComposer()}
			{#if showSupportWidgets}
				<div class="flex shrink-0 flex-col gap-0.5">
					<div class="flex justify-center">
						<div class="w-full max-w-[60%]">
							<div class="flex flex-col gap-0.5 px-5">
								{#if showPermissionBar}
									<AgentPanelPermissionBar
										verb="Approval needed"
										filePath="src/lib/auth/jwt.ts"
										command="bun test src/lib/auth"
									>
										{#snippet leading()}
											<AgentPanelPermissionBarIcon kind="execute" />
										{/snippet}
										{#snippet progress()}
											<AgentPanelPermissionBarProgress completed={1} total={3} />
										{/snippet}
										{#snippet actionBar()}
											<AgentPanelPermissionBarActions
												onAllow={() => {}}
												onDeny={() => {}}
												showAlwaysAllow={true}
												onAlwaysAllow={() => {}}
											/>
										{/snippet}
									</AgentPanelPermissionBar>
								{/if}

								{#if showModifiedFilesHeader}
									<AgentPanelModifiedFilesHeader visible={true}>
										{#snippet fileList()}
											{#each modifiedFiles as file (file.id)}
												<AgentPanelModifiedFileRow {file} />
											{/each}
										{/snippet}

										{#snippet leadingContent()}
											<AgentPanelCreatePrButton
												label="Create PR"
												insertions={212}
												deletions={52}
											/>
										{/snippet}

										{#snippet trailingContent(isExpanded: boolean)}
											<AgentPanelModifiedFilesTrailingControls
												model={modifiedFilesTrailingModel}
												{isExpanded}
											/>
										{/snippet}
									</AgentPanelModifiedFilesHeader>
								{/if}

								<AgentPanelTodoHeader
									items={todoItems}
									currentTask={currentTodoItem}
									completedCount={completedTodoCount}
									totalCount={todoItems.length}
									isLive={isRunning}
									allCompletedLabel="All tasks completed"
									pausedLabel="Tasks paused"
								/>

							</div>
						</div>
					</div>
				</div>
			{/if}
		{/snippet}

		{#snippet composer()}
			<div class="shrink-0 px-2 pb-2">
				<div class="mx-auto w-full max-w-[60%]">
					<AgentPanelComposer
						class="border-t-0 p-0"
						inputClass="flex-shrink-0 border border-border bg-input/30"
					>
						{#snippet content()}
							<AgentPanelComposerEditor
								placeholder="Ask your agent to keep going..."
								isEmpty={true}
							>
								{#snippet trailing()}
									<AgentPanelComposerSubmitButton
										intent={isRunning ? "stop" : "send"}
										disabled={!isRunning}
									/>
								{/snippet}
							</AgentPanelComposerEditor>
						{/snippet}
						{#snippet footer()}
							<AgentPanelComposerToolbar>
								{#snippet items()}
									<span class="px-2 text-[11px] text-muted-foreground">Claude 3.7 Sonnet</span>
									<AgentPanelComposerToolbarDivider />
									<span class="px-2 text-[11px] text-muted-foreground">acepe</span>
									<AgentPanelComposerToolbarDivider />
								{/snippet}
							</AgentPanelComposerToolbar>
						{/snippet}
					</AgentPanelComposer>
				</div>
			</div>
		{/snippet}

		{#snippet footer()}
			<AgentPanelFooter
				showTrailingBorder={false}
				browserActive={false}
				browserTitle="Toggle browser"
				terminalActive={false}
				terminalTitle="Toggle terminal"
			>
				{#snippet left()}
					<div class="px-2 text-[10px] font-mono text-muted-foreground">wt/jwt-auth</div>
				{/snippet}
			</AgentPanelFooter>
		{/snippet}

		{#snippet trailingPane()}
			{#if isComplete && showPlanSidebar}
				<div
					class="flex h-full min-h-0 shrink-0 flex-col border-l border-border/50"
					style="min-width: 300px; width: 300px; max-width: 300px;"
				>
					<PlanSidebarLayout
						title="JWT migration plan"
						slug="jwt-migration"
						content={AGENT_PANEL_DEMO_PLAN_MARKDOWN}
						onClose={togglePlanSidebar}
					/>
				</div>
			{/if}
		{/snippet}
			</AgentPanel>

			{#if !animating && isComplete}
				<button
					type="button"
					onclick={() => void play()}
					class="absolute bottom-20 right-4 rounded-full border border-border bg-muted/80 px-3 py-1 text-xs text-muted-foreground backdrop-blur-sm transition-colors hover:bg-muted hover:text-foreground"
				>
					↺ Replay
				</button>
			{/if}
		</div>
	{/snippet}
</LandingDemoFrame>
