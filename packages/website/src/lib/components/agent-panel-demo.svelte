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
	AgentPanelDeck,
	AgentPanelComposer,
	AgentPanelComposerFrame,
	AgentPanelErrorCard,
	AgentPanelFooter,
	AgentPanelInstallCard,
	AgentPanelModifiedFileRow,
	AgentPanelModifiedFilesHeader,
	AgentPanelModifiedFilesTrailingControls,
	AgentPanelPermissionBar,
	AgentPanelPermissionBarActions,
	AgentPanelPermissionBarIcon,
	AgentPanelPermissionBarProgress,
	AgentPanelPlanHeader,
	AgentPanelPrCard,
	AgentPanelQueueCardStrip,
	AgentPanelScene,
	AgentPanelTerminalDrawer,
	AgentPanelTodoHeader,
	AgentPanelWorktreeSetupCard,
} from "@acepe/ui";
import { CloseAction, FullscreenAction, OverflowMenuTriggerAction } from "@acepe/ui/panel-header";
import type {
	AgentPanelModifiedFileItem,
	AgentPanelModifiedFilesTrailingModel,
	AgentPanelPrCardModel,
	AgentPanelQueuedMessage,
	AgentPanelSceneModel,
	AgentTodoItem,
} from "@acepe/ui/agent-panel";
import { AgentPanelStatusIcon } from "@acepe/ui/agent-panel";

import LandingDemoFrame from "./landing-demo-frame.svelte";
import { websiteThemeStore } from "$lib/theme/theme.js";

type DemoModeId = "plan" | "build";
type DemoAgentKey = "claude" | "codex" | "cursor";
type DemoConversationEntry = AgentPanelSceneModel["conversation"]["entries"][number];

type DemoConfigOption = {
	id: string;
	name: string;
	category: string;
	type: string;
	currentValue: string;
	options: { value: string; name: string }[];
};

const noop = () => {};

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
	browserActive: boolean;
	terminalActive: boolean;
	conversationEntries: DemoConversationEntry[];
	draftText: string;
	editorRef: HTMLDivElement | null;
};

const availableModes = [{ id: "plan" }, { id: "build" }] as const;
const composerPlaceholder = "Plan, @ for context, / for commands";

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

function createUserEntry(id: string, text: string): DemoConversationEntry {
	return {
		id,
		type: "user",
		text,
	};
}

function createAssistantEntry(
	id: string,
	markdown: string,
	isStreaming = false
): DemoConversationEntry {
	return {
		id,
		type: "assistant",
		markdown,
		isStreaming,
	};
}

function createTaskEntry(params: {
	id: string;
	description: string;
	prompt: string;
	resultText: string;
	status: "pending" | "running" | "done" | "error";
	children: DemoConversationEntry[];
}): DemoConversationEntry {
	return {
		id: params.id,
		type: "tool_call",
		kind: "task",
		title: "Task",
		taskDescription: params.description,
		taskPrompt: params.prompt,
		taskResultText: params.resultText,
		taskChildren: params.children,
		status: params.status,
	};
}

function createReviewQueueConversation(): DemoConversationEntry[] {
	return [
		createUserEntry(
			"composer-primary-user",
			"Tighten the review queue so the shared agent panel stops drifting between desktop and website."
		),
		{
			id: "composer-primary-todos",
			type: "tool_call",
			title: "Todo",
			status: "running",
			todos: [
				{
					content: "Trace shared footer and deck ownership",
					activeForm: "Tracing shared footer and deck ownership",
					status: "completed",
				},
				{
					content: "Move layout parity into @acepe/ui",
					activeForm: "Moving layout parity into @acepe/ui",
					status: "completed",
				},
				{
					content: "Verify homepage showcase spacing",
					activeForm: "Verifying homepage showcase spacing",
					status: "in_progress",
				},
			],
		},
		{
			id: "composer-primary-search",
			type: "tool_call",
			kind: "search",
			title: "Search",
			subtitle: "shared panel surfaces",
			query: "AgentPanelDeck AgentPanelFooter AgentPanelComposerFrame",
			searchPath: "packages",
			searchFiles: [
				"packages/ui/src/components/agent-panel/agent-panel-deck.svelte",
				"packages/ui/src/components/agent-panel/agent-panel-footer.svelte",
				"packages/website/src/lib/components/agent-panel-demo.svelte",
			],
			searchResultCount: 3,
			status: "done",
		},
		{
			id: "composer-primary-web-search",
			type: "tool_call",
			kind: "web_search",
			title: "Web search",
			subtitle: "homepage panel parity examples",
			query: "agent panel parity extraction shared ui",
			webSearchSummary:
				"Found references to the extracted panel deck, composer frame, and footer parity work across the project documentation.",
			webSearchLinks: [
				{
					title: "Acepe docs",
					url: "https://acepe.dev/docs/panel-parity",
					domain: "acepe.dev",
				},
				{
					title: "Shared panel extraction notes",
					url: "https://acepe.dev/changelog/shared-panel-extraction",
					domain: "acepe.dev",
				},
			],
			status: "done",
		},
		{
			id: "composer-primary-execute",
			type: "tool_call",
			kind: "execute",
			title: "Run",
			command: "cd packages/website && bun run check",
			stdout: "svelte-check found 0 errors and 0 warnings",
			exitCode: 0,
			status: "done",
		},
		createAssistantEntry(
			"composer-primary-assistant",
			"Pulled the shared panel rail and composer frame into `@acepe/ui`, then removed the website-only footer drift.\n\nNow I’m checking the remaining spacing deltas before we call the extraction complete.",
			true
		),
	];
}

function createAuditConversation(): DemoConversationEntry[] {
	return [
		createUserEntry(
			"composer-verify-user",
			"Trace the remaining parity gaps before we ship the homepage showcase."
		),
		createTaskEntry({
			id: "composer-verify-task",
			description: "Run parity review subagent",
			prompt:
				"Review the shared panel extraction and surface only the remaining parity regressions between desktop and website.",
			resultText:
				"Flagged two issues: the shared shell still removed the right border outside fullscreen, and the website composer placeholder drifted from desktop copy.",
			status: "done",
			children: [
				{
					id: "composer-verify-task-search",
					type: "tool_call",
					kind: "search",
					title: "Search",
					subtitle: "panel parity regression",
					query: "border-r-0 placeholder panel composer",
					searchPath: "packages",
					searchFiles: [
						"packages/ui/src/components/agent-panel/agent-panel-shell.svelte",
						"packages/website/src/lib/components/agent-panel-demo.svelte",
					],
					searchResultCount: 2,
					status: "done",
				},
				{
					id: "composer-verify-task-read",
					type: "tool_call",
					kind: "read",
					title: "Read",
					filePath: "packages/ui/src/components/agent-panel/agent-panel-shell.svelte",
					status: "done",
				},
				{
					id: "composer-verify-task-edit",
					type: "tool_call",
					kind: "edit",
					title: "Edit",
					filePath: "packages/website/src/lib/components/agent-panel-demo.svelte",
					status: "done",
				},
			],
		}),
		{
			id: "composer-verify-lints",
			type: "tool_call",
			title: "Read lints",
			status: "done",
			lintDiagnostics: [
				{
					filePath: "packages/ui/src/components/agent-panel/agent-panel-shell.svelte",
					line: 52,
					message: "right border is suppressed outside fullscreen mode",
					severity: "warning",
				},
				{
					filePath: "packages/website/src/lib/components/agent-panel-demo.svelte",
					line: 78,
					message: "placeholder copy diverges from the desktop composer",
					severity: "warning",
				},
			],
		},
		createAssistantEntry(
			"composer-verify-assistant",
			"Found the last two regressions:\n\n1. the shared shell was still removing the right border in non-fullscreen mode\n2. the website composer placeholder was drifting from desktop copy\n\nBoth are now mapped back to the shared panel surfaces."
		),
	];
}

function createReleaseNotesConversation(): DemoConversationEntry[] {
	return [
		createUserEntry(
			"composer-polish-user",
			"Draft tighter release notes for the extracted panel primitives."
		),
		{
			id: "composer-polish-fetch",
			type: "tool_call",
			kind: "fetch",
			title: "Fetch",
			subtitle: "acepe.dev",
			url: "https://acepe.dev/changelog",
			resultText:
				"Current notes mention composer extraction but omit the shared deck, footer parity fixes, and homepage showcase alignment.",
			status: "done",
		},
		createAssistantEntry(
			"composer-polish-assistant",
			"### Agent panel extraction\n- moved the shared panel deck into `@acepe/ui`\n- restored footer parity between desktop and website\n- aligned composer framing, placeholder copy, and shell chrome across both surfaces"
		),
	];
}

// --- Demo data for real desktop components ---

const demoModifiedFiles: readonly AgentPanelModifiedFileItem[] = [
	{
		id: "f1",
		filePath: "packages/ui/src/components/agent-panel/agent-panel-shell.svelte",
		additions: 12,
		deletions: 3,
		reviewStatus: "accepted",
	},
	{
		id: "f2",
		filePath: "packages/ui/src/components/agent-panel/agent-panel-footer.svelte",
		additions: 28,
		deletions: 2,
		reviewStatus: "partial",
	},
	{
		id: "f3",
		filePath: "packages/website/src/lib/components/agent-panel-demo.svelte",
		additions: 8,
		deletions: 1,
	},
];

const demoModifiedFilesTrailing: AgentPanelModifiedFilesTrailingModel = {
	reviewLabel: "Review",
	keepState: "enabled",
	keepLabel: "Keep",
	reviewedCount: 1,
	totalCount: 3,
};

const demoTodoItems: readonly AgentTodoItem[] = [
	{
		content: "Trace shared footer and deck ownership",
		activeForm: "Tracing footer ownership",
		status: "completed",
		duration: 4200,
	},
	{
		content: "Move layout parity into @acepe/ui",
		activeForm: "Moving layout parity",
		status: "completed",
		duration: 8100,
	},
	{
		content: "Verify homepage showcase spacing",
		activeForm: "Verifying showcase spacing",
		status: "in_progress",
	},
	{ content: "Run final type check", activeForm: "Running type check", status: "pending" },
];

const demoCurrentTask: AgentTodoItem = demoTodoItems[2];

const demoQueueMessages: readonly AgentPanelQueuedMessage[] = [
	{
		id: "q1",
		content: "Also update the README with the new API docs",
		attachmentCount: 0,
		attachments: [],
	},
	{
		id: "q2",
		content: "Run the test suite after those changes",
		attachmentCount: 1,
		attachments: [{ id: "qa1", displayName: "screenshot.png", extension: "png", kind: "image" }],
	},
];

const demoPrCardModel: AgentPanelPrCardModel = {
	mode: "pr",
	number: 128,
	title: "fix: agent panel shell layout",
	state: "OPEN",
	additions: 54,
	deletions: 63,
	descriptionHtml:
		"<p>Makes card backgrounds opaque and uses preComposer slot for card placement.</p>",
	commits: [
		{
			sha: "e965d5c",
			message: "style(ui): make card backgrounds opaque",
			insertions: 12,
			deletions: 8,
		},
		{
			sha: "d079f81",
			message: "feat(website): wire remaining components into demo",
			insertions: 42,
			deletions: 55,
		},
	],
};

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
			projectIconSrc: null,
			sequenceId: panel.sequenceId,
			actions: [],
		},
		conversation: {
			entries: panel.conversationEntries,
			isStreaming: panel.status === "running",
		},
	};
}

function getPanelStatus(panel: DemoPanel): DemoPanel["status"] {
	return panel.status;
}

let panels = $state<DemoPanel[]>([
	{
		id: "composer-primary",
		title: "Unblock review queue",
		status: "connected",
		subtitle: null,
		agentLabel: null,
		agentKey: "claude",
		projectLabel: "acepe.dev",
		projectColor: "#9858FF",
		sequenceId: 12,
		placeholder: composerPlaceholder,
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
		browserActive: false,
		terminalActive: false,
		conversationEntries: createReviewQueueConversation(),
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
		placeholder: composerPlaceholder,
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
		browserActive: true,
		terminalActive: false,
		conversationEntries: createAuditConversation(),
		draftText: "",
		editorRef: null,
	},
	{
		id: "composer-polish",
		title: "Polish release notes flow",
		status: "connected",
		subtitle: null,
		agentLabel: null,
		agentKey: "cursor",
		projectLabel: "website",
		projectColor: "#FF8D20",
		sequenceId: 9,
		placeholder: composerPlaceholder,
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
		browserActive: false,
		terminalActive: true,
		conversationEntries: createReleaseNotesConversation(),
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

function handleBrowserToggle(panelId: string): void {
	const panel = findPanel(panelId);
	if (!panel) {
		return;
	}

	panel.browserActive = !panel.browserActive;
}

function handleTerminalToggle(panelId: string): void {
	const panel = findPanel(panelId);
	if (!panel) {
		return;
	}

	panel.terminalActive = !panel.terminalActive;
}

function getTerminalTranscript(panelId: string): readonly string[] {
	if (panelId === "composer-primary") {
		return [
			"$ cd packages/website",
			"$ bun run check",
			"svelte-check found 0 errors and 0 warnings",
			"$ bun run test -- agent-panel-demo",
			"PASS agent-panel-demo visual parity",
		];
	}

	if (panelId === "composer-verify") {
		return [
			'$ rg "AgentPanelScene" packages',
			"packages/ui/src/components/agent-panel-scene/agent-panel-scene.svelte",
			"packages/website/src/lib/components/agent-panel-demo.svelte",
			"$ bun run test -- panel-parity",
			"2 assertions updated",
		];
	}

	return [
		"$ git status --short",
		"M packages/website/src/lib/components/agent-panel-demo.svelte",
		"$ bun run build",
		"vite v7.2.6 building for production...",
		"build completed in 1.4s",
	];
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
			<div class="shrink-0">
				<AgentPanelComposerFrame>
					<AgentPanelComposer
						class="border-t-0 p-0"
						inputClass="flex-shrink-0 border border-border bg-input/30"
						contentClass="p-3"
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
				</AgentPanelComposerFrame>
			</div>
		{/snippet}

		{#snippet panelFooter(panel: DemoPanel)}
			<AgentPanelFooter
				browserActive={panel.browserActive}
				browserTitle="Toggle browser"
				browserAriaLabel="Toggle browser"
				onToggleBrowser={() => handleBrowserToggle(panel.id)}
				terminalActive={panel.terminalActive}
				terminalDisabled={false}
				terminalTitle="Toggle terminal"
				terminalAriaLabel="Toggle terminal"
				onToggleTerminal={() => handleTerminalToggle(panel.id)}
			/>
		{/snippet}

		<AgentPanelDeck rowClass="bg-background/15">
			{#each panels as panel (panel.id)}
				<div class="min-w-0 min-h-0 w-0 basis-0 flex-1 overflow-hidden">
					<AgentPanelScene
						scene={buildScene(panel, theme)}
						iconBasePath="/svgs/icons"
						widthStyle="min-width: 0; width: 100%; max-width: 100%;"
					>
						{#snippet headerControls()}
							<AgentPanelStatusIcon status={getPanelStatus(panel)} />
							<OverflowMenuTriggerAction title="More actions" />
							<FullscreenAction isFullscreen={false} onToggle={noop} />
							<CloseAction onClose={noop} />
						{/snippet}
						{#snippet topBarOverride()}
							{#if panel.id === "composer-polish"}
								<AgentPanelPlanHeader
									title="Release notes plan"
									isExpanded={false}
									expandLabel="Show plan"
									collapseLabel="Hide plan"
									onToggleSidebar={() => {}}
								/>
							{/if}
						{/snippet}
						{#snippet preComposerOverride()}
							<div class="flex flex-col gap-1 px-5 pb-1">
								{#if panel.id === "composer-primary"}
									<AgentPanelPermissionBar
										verb="Edit"
										filePath="packages/ui/src/components/agent-panel/agent-panel-shell.svelte"
										hasProgress={true}
									>
										{#snippet leading()}
											<AgentPanelPermissionBarIcon kind="edit" />
										{/snippet}
										{#snippet progress()}
											<AgentPanelPermissionBarProgress completed={1} total={3} />
										{/snippet}
										{#snippet actionBar()}
											<AgentPanelPermissionBarActions
												onAllow={() => {}}
												onDeny={() => {}}
												onAlwaysAllow={() => {}}
												showAlwaysAllow={true}
											/>
										{/snippet}
									</AgentPanelPermissionBar>
									<AgentPanelWorktreeSetupCard
										visible={true}
										title="Worktree"
										summary="Setting up review worktree"
										details="Cloning to ../acepe-panel-parity on branch fix/panel-parity"
										tone="running"
									/>
									<AgentPanelInstallCard
										title="Installing"
										summary="Claude Code v1.2.3"
										details="Downloading binary…"
										progressPercent={42}
									/>
								{:else if panel.id === "composer-verify"}
									<AgentPanelModifiedFilesHeader visible={true}>
										{#snippet leadingContent()}
											<span class="pl-2 text-[10px] font-medium text-muted-foreground">3 files changed</span>
										{/snippet}
										{#snippet trailingContent(isExpanded: boolean, toggleExpanded: () => void)}
											<AgentPanelModifiedFilesTrailingControls model={demoModifiedFilesTrailing} {isExpanded} onToggle={toggleExpanded} />
										{/snippet}
										{#snippet fileList()}
											{#each demoModifiedFiles as file (file.id)}
												<AgentPanelModifiedFileRow {file} />
											{/each}
										{/snippet}
									</AgentPanelModifiedFilesHeader>
									<AgentPanelPrCard
										visible={true}
										model={demoPrCardModel}
									/>
									<AgentPanelTodoHeader
										items={demoTodoItems}
										currentTask={demoCurrentTask}
										completedCount={2}
										totalCount={4}
										isLive={true}
										allCompletedLabel="All tasks completed"
										pausedLabel="Tasks paused"
									/>
								{:else if panel.id === "composer-polish"}
									<AgentPanelErrorCard
										title="Connection error"
										summary="Failed to connect to agent"
										details="ECONNREFUSED 127.0.0.1:3000 — the agent process may have crashed. Check logs for details."
										onRetry={() => {}}
										onDismiss={() => {}}
									/>
									<AgentPanelQueueCardStrip
										messages={demoQueueMessages}
										isPaused={false}
										queueLabel="Queued"
										pausedLabel="Paused"
										resumeLabel="Resume"
										clearLabel="Clear"
										sendLabel="Send"
										cancelLabel="Cancel"
										onCancel={() => {}}
										onClear={() => {}}
										onSendNow={() => {}}
									/>
								{/if}
							</div>
						{/snippet}
						{#snippet composerOverride()}
							{@render panelComposer(panel)}
						{/snippet}
						{#snippet footerOverride()}
							{@render panelFooter(panel)}
						{/snippet}
						{#snippet bottomDrawer()}
							{#if panel.terminalActive}
								<AgentPanelTerminalDrawer height={220}>
									{#snippet tabs()}
										<div
											class="inline-flex h-7 shrink-0 items-center gap-1 bg-accent/25 px-2 text-xs
												text-foreground"
											role="tab"
											aria-selected="true"
										>
											<span>Terminal 1</span>
										</div>
									{/snippet}
									{#snippet body()}
										<div class="absolute inset-0 overflow-auto bg-background px-3 py-2 font-mono text-[11px]">
											{#each getTerminalTranscript(panel.id) as line, index (`${panel.id}-${index}`)}
												<div class="whitespace-pre-wrap text-foreground/90">{line}</div>
											{/each}
										</div>
									{/snippet}
								</AgentPanelTerminalDrawer>
							{/if}
						{/snippet}
					</AgentPanelScene>
				</div>
			{/each}
		</AgentPanelDeck>
	{/snippet}
</LandingDemoFrame>
