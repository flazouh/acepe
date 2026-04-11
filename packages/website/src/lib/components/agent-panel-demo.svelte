<script lang="ts">
	import {
		AgentInputAutonomousToggle,
		AgentInputConfigOptionSelector,
		AgentInputDivider,
		AgentInputEditor,
		AgentInputMetricsChip,
		AgentInputMicButton,
		AgentInputModelSelector,
		AgentInputModeSelector,
		AgentInputToolbar,
		AgentPanelComposer,
		AgentPanelScene,
	} from "@acepe/ui";
	import type { AgentPanelSceneModel } from "@acepe/ui/agent-panel";

	import LandingDemoFrame from "./landing-demo-frame.svelte";
	import { websiteThemeStore } from "$lib/theme/theme.js";

	type DemoModeId = "plan" | "build";
	type DemoAgentKey = "claude" | "codex" | "cursor";

	type DemoConfigOption = {
		id: string;
		name: string;
		category: string;
		type: string;
		currentValue: string;
		options: { value: string; name: string }[];
	};

	type DemoModelItem = {
		id: string;
		name: string;
		providerSource: string;
		isFavorite: boolean;
		isBuildDefault: boolean;
		isPlanDefault: boolean;
	};

	type DemoModelGroup = {
		label: string;
		items: DemoModelItem[];
	};

	type DemoPanel = {
		id: string;
		title: string;
		status: AgentPanelSceneModel["status"];
		subtitle: string | null;
		agentLabel: string | null;
		agentKey: DemoAgentKey;
		projectLabel: string;
		projectColor: string;
		sequenceId: number;
		placeholder: string;
		currentModeId: DemoModeId;
		autonomousActive: boolean;
		configOption: DemoConfigOption;
		modelGroups: DemoModelGroup[];
		currentModelId: string;
		metricsLabel: string;
		metricsPercent: number;
		micTitle: string;
		draftText: string;
		editorRef: HTMLDivElement | null;
	};

	const availableModes = [
		{ id: "plan" },
		{ id: "build" },
	] as const;

	const theme = $derived($websiteThemeStore);

	function createConfigOption(currentValue: "true" | "false"): DemoConfigOption {
		return {
			id: "reasoning",
			name: "Reasoning",
			category: "reasoning",
			type: "boolean",
			currentValue,
			options: [
				{ value: "true", name: "On" },
				{ value: "false", name: "Off" },
			],
		};
	}

	function createModelItem(params: {
		id: string;
		name: string;
		providerSource: string;
		isFavorite?: boolean;
		isBuildDefault?: boolean;
		isPlanDefault?: boolean;
	}): DemoModelItem {
		return {
			id: params.id,
			name: params.name,
			providerSource: params.providerSource,
			isFavorite: params.isFavorite ?? false,
			isBuildDefault: params.isBuildDefault ?? false,
			isPlanDefault: params.isPlanDefault ?? false,
		};
	}

	function resolveAgentIcon(agentKey: DemoAgentKey, currentTheme: string): string {
		if (agentKey === "codex") {
			return `/svgs/agents/codex/codex-icon-${currentTheme}.svg`;
		}

		if (agentKey === "cursor") {
			return `/svgs/agents/cursor/cursor-icon-${currentTheme}.svg`;
		}

		return `/svgs/agents/claude/claude-icon-${currentTheme}.svg`;
	}

	function getCurrentModel(panel: DemoPanel): DemoModelItem | null {
		for (const group of panel.modelGroups) {
			for (const item of group.items) {
				if (item.id === panel.currentModelId) {
					return item;
				}
			}
		}

		return null;
	}

	function getFavoriteModels(panel: DemoPanel): DemoModelItem[] {
		const favorites: DemoModelItem[] = [];

		for (const group of panel.modelGroups) {
			for (const item of group.items) {
				if (item.isFavorite) {
					favorites.push(item);
				}
			}
		}

		return favorites;
	}

	function buildScene(panel: DemoPanel, currentTheme: string): AgentPanelSceneModel {
		return {
			panelId: panel.id,
			status: panel.status,
			header: {
				title: panel.title,
				subtitle: panel.subtitle,
				status: panel.status,
				agentLabel: panel.agentLabel,
				agentIconSrc: resolveAgentIcon(panel.agentKey, currentTheme),
				projectLabel: panel.projectLabel,
				projectColor: panel.projectColor,
				sequenceId: panel.sequenceId,
				actions: [],
			},
			conversation: {
				entries: [],
				isStreaming: false,
			},
		};
	}

	let panels = $state<DemoPanel[]>([
		{
			id: "composer-primary",
			title: "Unblock review queue",
			status: "running",
			subtitle: null,
			agentLabel: null,
			agentKey: "claude",
			projectLabel: "acepe.dev",
			projectColor: "#9858FF",
			sequenceId: 12,
			placeholder: "Trace the blocked review queue and prepare a safe fix",
			currentModeId: "build",
			autonomousActive: false,
			configOption: createConfigOption("false"),
			modelGroups: [
				{
					label: "Anthropic",
					items: [
						createModelItem({
							id: "claude-sonnet-4",
							name: "Claude Sonnet 4",
							providerSource: "Anthropic",
							isFavorite: true,
							isBuildDefault: true,
						}),
						createModelItem({
							id: "claude-opus-4-6",
							name: "Claude Opus 4.6",
							providerSource: "Anthropic",
							isPlanDefault: true,
						}),
					],
				},
			],
			currentModelId: "claude-sonnet-4",
			metricsLabel: "12/200k",
			metricsPercent: 6,
			micTitle: "Record with Claude",
			draftText: "",
			editorRef: null,
		},
		{
			id: "composer-verify",
			title: "Audit panel regressions",
			status: "connected",
			subtitle: null,
			agentLabel: null,
			agentKey: "codex",
			projectLabel: "desktop",
			projectColor: "#4AD0FF",
			sequenceId: 4,
			placeholder: "Check panel states and confirm the desktop fix",
			currentModeId: "plan",
			autonomousActive: true,
			configOption: createConfigOption("true"),
			modelGroups: [
				{
					label: "OpenAI",
					items: [
						createModelItem({
							id: "gpt-5.4",
							name: "GPT-5.4",
							providerSource: "OpenAI",
							isFavorite: true,
							isPlanDefault: true,
						}),
						createModelItem({
							id: "gpt-5.3-codex",
							name: "GPT-5.3 Codex",
							providerSource: "OpenAI",
							isBuildDefault: true,
						}),
					],
				},
			],
			currentModelId: "gpt-5.4",
			metricsLabel: "8/128k",
			metricsPercent: 7,
			micTitle: "Record with Codex",
			draftText: "",
			editorRef: null,
		},
		{
			id: "composer-polish",
			title: "Polish release notes flow",
			status: "idle",
			subtitle: null,
			agentLabel: null,
			agentKey: "cursor",
			projectLabel: "website",
			projectColor: "#FF8D20",
			sequenceId: 9,
			placeholder: "Tighten the launch copy and reviewer handoff",
			currentModeId: "build",
			autonomousActive: false,
			configOption: createConfigOption("false"),
			modelGroups: [
				{
					label: "Anthropic",
					items: [
						createModelItem({
							id: "claude-3-7-sonnet",
							name: "Claude 3.7 Sonnet",
							providerSource: "Anthropic",
							isFavorite: true,
							isBuildDefault: true,
						}),
						createModelItem({
							id: "claude-opus-4-6-website",
							name: "Claude Opus 4.6",
							providerSource: "Anthropic",
							isPlanDefault: true,
						}),
					],
				},
			],
			currentModelId: "claude-3-7-sonnet",
			metricsLabel: "3/200k",
			metricsPercent: 2,
			micTitle: "Record with Cursor",
			draftText: "",
			editorRef: null,
		},
	]);

	function findPanel(panelId: string): DemoPanel | null {
		for (const panel of panels) {
			if (panel.id === panelId) {
				return panel;
			}
		}

		return null;
	}

	function handleModeChange(panelId: string, modeId: string): void {
		const panel = findPanel(panelId);
		if (!panel || (modeId !== "plan" && modeId !== "build")) {
			return;
		}

		panel.currentModeId = modeId;
	}

	function handleAutonomousToggle(panelId: string): void {
		const panel = findPanel(panelId);
		if (!panel) {
			return;
		}

		panel.autonomousActive = !panel.autonomousActive;
	}

	function handleConfigValueChange(panelId: string, configId: string, value: string): void {
		const panel = findPanel(panelId);
		if (!panel || panel.configOption.id !== configId) {
			return;
		}

		panel.configOption.currentValue = value;
	}

	function handleModelChange(panelId: string, modelId: string): void {
		const panel = findPanel(panelId);
		if (!panel) {
			return;
		}

		for (const group of panel.modelGroups) {
			for (const item of group.items) {
				if (item.id === modelId) {
					panel.currentModelId = modelId;
					return;
				}
			}
		}
	}

	function handleSetModeDefault(panelId: string, modelId: string, modeId: DemoModeId): void {
		const panel = findPanel(panelId);
		if (!panel) {
			return;
		}

		for (const group of panel.modelGroups) {
			for (const item of group.items) {
				if (modeId === "plan") {
					item.isPlanDefault = item.id === modelId;
					continue;
				}

				item.isBuildDefault = item.id === modelId;
			}
		}
	}

	function handleToggleFavorite(panelId: string, modelId: string): void {
		const panel = findPanel(panelId);
		if (!panel) {
			return;
		}

		for (const group of panel.modelGroups) {
			for (const item of group.items) {
				if (item.id === modelId) {
					item.isFavorite = !item.isFavorite;
					return;
				}
			}
		}
	}

	function handleDraftInput(panel: DemoPanel, event: Event): void {
		const currentTarget = event.currentTarget;
		if (!(currentTarget instanceof HTMLDivElement)) {
			return;
		}

		panel.draftText = currentTarget.textContent ?? "";
	}

	function handleSubmit(panel: DemoPanel): void {
		if (panel.draftText.trim().length === 0) {
			return;
		}

		panel.status = "running";
		panel.draftText = "";

		if (panel.editorRef) {
			panel.editorRef.textContent = "";
		}
	}
</script>

<LandingDemoFrame interactive={true}>
	{#snippet children()}
		{#snippet panelComposer(panel: DemoPanel)}
			{@const currentModel = getCurrentModel(panel)}
			<AgentPanelComposer
				class="border-t-0 p-0"
				inputClass="flex-shrink-0 border border-border bg-input/30"
				contentClass="p-2"
			>
				{#snippet content()}
					<AgentInputEditor
						bind:editorRef={panel.editorRef}
						placeholder={panel.placeholder}
						isEmpty={panel.draftText.trim().length === 0}
						submitIntent="send"
						submitDisabled={panel.draftText.trim().length === 0}
						submitAriaLabel="Send message"
						onSubmit={() => handleSubmit(panel)}
						oninput={(event) => handleDraftInput(panel, event)}
					/>
				{/snippet}
				{#snippet footer()}
					<AgentInputToolbar>
						{#snippet items()}
							<AgentInputModeSelector
								{availableModes}
								currentModeId={panel.currentModeId}
								onModeChange={(modeId) => handleModeChange(panel.id, modeId)}
							/>
							<AgentInputDivider />
							<AgentInputAutonomousToggle
								active={panel.autonomousActive}
								title="Autonomous mode"
								onToggle={() => handleAutonomousToggle(panel.id)}
							/>
							<AgentInputDivider />
							<AgentInputConfigOptionSelector
								configOption={panel.configOption}
								onValueChange={(configId, value) =>
									handleConfigValueChange(panel.id, configId, value)}
							/>
							<AgentInputDivider />
							<AgentInputModelSelector
								triggerLabel={currentModel?.name ?? "Select model"}
								triggerProviderSource={currentModel?.providerSource ?? ""}
								currentModelId={panel.currentModelId}
								modelGroups={panel.modelGroups}
								favoriteModels={getFavoriteModels(panel)}
								onModelChange={(modelId) => handleModelChange(panel.id, modelId)}
								onSetBuildDefault={(modelId) =>
									handleSetModeDefault(panel.id, modelId, "build")}
								onSetPlanDefault={(modelId) =>
									handleSetModeDefault(panel.id, modelId, "plan")}
								onToggleFavorite={(modelId) => handleToggleFavorite(panel.id, modelId)}
							/>
							<AgentInputDivider />
						{/snippet}
						{#snippet trailing()}
							<AgentInputMetricsChip
								label={panel.metricsLabel}
								percent={panel.metricsPercent}
								hideLabel={true}
							/>
							<AgentInputMicButton visualState="mic" title={panel.micTitle} />
						{/snippet}
					</AgentInputToolbar>
				{/snippet}
			</AgentPanelComposer>
		{/snippet}

		<div class="grid h-full min-h-0 grid-cols-3 gap-3 bg-background/15 p-3">
			{#each panels as panel (panel.id)}
				<div class="min-w-0 min-h-0">
					<AgentPanelScene scene={buildScene(panel, theme)} iconBasePath="/svgs/icons">
						{#snippet composerOverride()}
							{@render panelComposer(panel)}
						{/snippet}
					</AgentPanelScene>
				</div>
			{/each}
		</div>
	{/snippet}
</LandingDemoFrame>
