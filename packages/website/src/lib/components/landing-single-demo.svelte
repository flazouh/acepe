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
		type AgentPanelSceneModel,
	} from "@acepe/ui";
	import { AgentPanelStatusIcon } from "@acepe/ui/agent-panel";
	import {
		AppMainLayout,
		AppSidebarLayout,
		AppSidebarProjectGroup,
		AppSidebarFooter,
		AppTabBarTab,
		type AppProjectGroup,
		type AppTab,
	} from "@acepe/ui/app-layout";
	import { CloseAction, FullscreenAction, OverflowMenuTriggerAction } from "@acepe/ui/panel-header";

	import LandingDemoFrame from "./landing-demo-frame.svelte";
	import { websiteThemeStore } from "$lib/theme/theme.js";

	const theme = $derived($websiteThemeStore);

	function agentIcon(agent: "claude" | "codex" | "cursor" | "opencode", t: string): string {
		if (agent === "codex") return `/svgs/agents/codex/codex-icon-${t}.svg`;
		if (agent === "cursor") return `/svgs/agents/cursor/cursor-icon-${t}.svg`;
		if (agent === "opencode") return `/svgs/agents/opencode/opencode-logo-${t}.svg`;
		return `/svgs/agents/claude/claude-icon-${t}.svg`;
	}

	const sidebarGroups = $derived<AppProjectGroup[]>([
		{ name: "acepe", color: "#9858FF", sessions: [] },
		{ name: "VC", color: "#E879F9", sessions: [] },
		{ name: "luminar", color: "#FACC15", sessions: [] },
		{ name: "fluentai", color: "#8B5CF6", sessions: [] },
	]);

	const tabs = $derived<AppTab[]>([
		{
			id: "single-tab-1",
			title: "how to run a w",
			projectName: "acepe",
			projectColor: "#9858FF",
			agentIconSrc: agentIcon("claude", theme),
			mode: "build",
			status: "idle",
			isFocused: false,
		},
		{
			id: "single-tab-2",
			title: "for our websit",
			projectName: "acepe",
			projectColor: "#9858FF",
			agentIconSrc: agentIcon("claude", theme),
			mode: "build",
			status: "idle",
			isFocused: false,
		},
		{
			id: "single-tab-3",
			title: "i would like yo",
			projectName: "VC",
			projectColor: "#E879F9",
			agentIconSrc: agentIcon("claude", theme),
			mode: "build",
			status: "done",
			isFocused: true,
		},
	]);

	const scene = $derived<AgentPanelSceneModel>({
		panelId: "single-panel-demo",
		status: "connected",
		header: {
			title: "For our website second section where we showcase each view we have, can you take the exact pixel by ...",
			subtitle: null,
			status: "connected",
			agentLabel: null,
			agentIconSrc: agentIcon("claude", theme),
			projectLabel: "VC",
			projectColor: "#E879F9",
			projectIconSrc: null,
			sequenceId: 3,
			actions: [],
		},
		conversation: {
			entries: [
				{
					id: "single-user-1",
					type: "user",
					text: "For our website second section where we showcase each view we have, can you take the exact pixel by pixel design from our actual app and implement it instead of having almost similar as it is now",
				},
				{
					id: "single-tool-1",
					type: "tool_call",
					kind: "execute",
					title: "Run",
					command: "cd /Users/liya/Documents/acepe/packages/website && bun run check 2>&1 | tail -20",
					status: "done",
				},
				{
					id: "single-read-1",
					type: "tool_call",
					kind: "read",
					title: "Read",
					filePath: "landing-single-demo.svelte",
					status: "done",
				},
				{
					id: "single-assistant-1",
					type: "assistant",
					markdown:
						"Done. The **Single** demo now uses the real desktop composition instead of the simplified version:\n\n- selectors are **injected into the composer toolbar**\n- full composer chrome is back: **mode, autonomous, model, agent, project, metrics, mic**\n- branch picker is rendered in the same separate minimal row as the app",
					isStreaming: false,
				},
			],
			isStreaming: false,
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
		modelGroups.flatMap((group) => group.items.filter((item) => item.isFavorite))
	);
</script>

<LandingDemoFrame>
	{#snippet children()}
		<AppMainLayout>
			{#snippet sidebar()}
				<AppSidebarLayout>
					{#snippet sessionList()}
						<div class="relative flex flex-col flex-1 min-h-0 gap-0.5 overflow-y-auto outline-none">
							{#each sidebarGroups as group (group.name)}
								<AppSidebarProjectGroup {group} expanded={false} />
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
				<div class="flex flex-1 min-w-0 min-h-0 flex-col gap-0.5 overflow-hidden">
					<div class="shrink-0 overflow-hidden rounded-lg border border-border bg-card/50">
						<div class="flex items-center gap-1 overflow-x-auto px-1 py-0.5" role="tablist">
							{#each tabs as tab (tab.id)}
								<AppTabBarTab {tab} onclose={() => {}} />
							{/each}
						</div>
					</div>
					<div class="flex-1 min-w-0 min-h-0 overflow-hidden">
						<AgentPanelScene
							{scene}
							iconBasePath="/svgs/icons"
							widthStyle="min-width: 0; width: 100%; max-width: 100%;"
						>
							{#snippet headerControls()}
								<AgentPanelStatusIcon status={scene.header.status} />
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
											contentClass="p-3 py-4"
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
															label="18/200k"
															percent={9}
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
			{/snippet}
		</AppMainLayout>
	{/snippet}
</LandingDemoFrame>
