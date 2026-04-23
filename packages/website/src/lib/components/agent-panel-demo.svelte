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
	AgentPanelFooter,
	AgentPanelStatusIcon,
	AgentPanelModifiedFileRow,
	AgentPanelModifiedFilesHeader,
	AgentPanelModifiedFilesTrailingControls,
	AgentPanelPlanHeader,
	AgentPanelPrCard,
	AgentPanelScene,
	AgentPanelTerminalDrawer,
} from "@acepe/ui";
import { CloseAction, FullscreenAction, OverflowMenuTriggerAction } from "@acepe/ui/panel-header";
import type {
	AgentPanelModifiedFileItem,
	AgentPanelModifiedFilesTrailingModel,
	AgentPanelPrCardModel,
	AgentPanelSceneModel,
} from "@acepe/ui/agent-panel";

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

function createRemoveEffectConversation(): DemoConversationEntry[] {
	return [
		createUserEntry(
			"composer-primary-user",
			"There's a $effect in session-list.svelte syncing scroll position — replace it with a derived + action pattern."
		),
		{
			id: "composer-primary-read",
			type: "tool_call",
			kind: "read",
			title: "Read",
			filePath: "packages/desktop/src/lib/components/session-list.svelte",
			status: "done",
		},
		{
			id: "composer-primary-edit",
			type: "tool_call",
			kind: "edit",
			title: "Edit",
			filePath: "packages/desktop/src/lib/components/session-list.svelte",
			status: "done",
		},
		{
			id: "composer-primary-execute",
			type: "tool_call",
			kind: "execute",
			title: "Run",
			command: "cd packages/desktop && bun run check",
			stdout: "svelte-check found 0 errors and 0 warnings",
			exitCode: 0,
			status: "done",
		},
		createAssistantEntry(
			"composer-primary-assistant",
			"Replaced the `$effect` with a `scrollToBottom` action driven by a `$derived` count:\n\n```ts\n// before\n$effect(() => {\n  if (entries.length)\n    el.scrollTop = el.scrollHeight;\n});\n\n// after\nlet count = $derived(entries.length);\n```\n```svelte\n<div use:scrollToBottom={count} ...>\n```\n\nThe action fires only when `count` changes and doesn't read reactive state inside an effect body."
		),
	];
}

function createKeyboardNavConversation(): DemoConversationEntry[] {
	return [
		createUserEntry(
			"composer-verify-user",
			"Wire ⌘[ and ⌘] to cycle between panels — only ⌘L is bound right now."
		),
		{
			id: "composer-verify-search",
			type: "tool_call",
			kind: "search",
			title: "Search",
			subtitle: "keyboard handler",
			query: "keydown meta panel focus",
			searchPath: "packages/desktop/src",
			searchFiles: [
				"packages/desktop/src/lib/keyboard/panel-keyboard-handler.ts",
				"packages/desktop/src/lib/stores/panel-focus-store.ts",
			],
			searchResultCount: 2,
			status: "done",
		},
		{
			id: "composer-verify-read",
			type: "tool_call",
			kind: "read",
			title: "Read",
			filePath: "packages/desktop/src/lib/keyboard/panel-keyboard-handler.ts",
			status: "done",
		},
		{
			id: "composer-verify-edit",
			type: "tool_call",
			kind: "edit",
			title: "Edit",
			filePath: "packages/desktop/src/lib/keyboard/panel-keyboard-handler.ts",
			status: "done",
		},
		{
			id: "composer-verify-execute",
			type: "tool_call",
			kind: "execute",
			title: "Run",
			command: "cd packages/desktop && bun test panel-keyboard",
			stdout: "PASS  panel-keyboard-handler › cycles panels with ⌘[ and ⌘]",
			exitCode: 0,
			status: "done",
		},
		createAssistantEntry(
			"composer-verify-assistant",
			'Added `⌘[` / `⌘]` to `panel-keyboard-handler.ts`:\n\n```ts\ncase "[":\n  if (meta) { focusPrev(); return true; }\n  break;\ncase "]":\n  if (meta) { focusNext(); return true; }\n  break;\n```\n\nBoth shortcuts respect the existing `keyboardDisabled` guard and are no-ops when a text input is focused.'
		),
	];
}

function createNarrowStatusConversation(): DemoConversationEntry[] {
	return [
		createUserEntry(
			"composer-polish-user",
			"The status prop on AgentPanelHeader still accepts string — narrow it to the AgentStatus union before the public export."
		),
		{
			id: "composer-polish-read",
			type: "tool_call",
			kind: "read",
			title: "Read",
			filePath: "packages/ui/src/components/agent-panel/types.ts",
			status: "done",
		},
		{
			id: "composer-polish-edit",
			type: "tool_call",
			kind: "edit",
			title: "Edit",
			filePath: "packages/ui/src/components/agent-panel/types.ts",
			status: "done",
		},
		{
			id: "composer-polish-execute",
			type: "tool_call",
			kind: "execute",
			title: "Run",
			command: "cd packages/desktop && bun run check",
			stdout: "svelte-check found 0 errors and 0 warnings",
			exitCode: 0,
			status: "done",
		},
		createAssistantEntry(
			"composer-polish-assistant",
			'Replaced `string` with the `AgentStatus` union in `types.ts`:\n\n```ts\nexport type AgentStatus =\n  | "empty"\n  | "connected"\n  | "running"\n  | "idle"\n  | "done"\n  | "error";\n```\n\nAll 4 call sites already pass a valid member — the type check now proves it.'
		),
	];
}

// --- Demo data for real desktop components ---

const demoModifiedFiles: readonly AgentPanelModifiedFileItem[] = [
	{
		id: "f1",
		filePath: "packages/desktop/src/lib/keyboard/panel-keyboard-handler.ts",
		additions: 14,
		deletions: 2,
		reviewStatus: "accepted",
	},
	{
		id: "f2",
		filePath: "packages/desktop/src/lib/stores/panel-focus-store.ts",
		additions: 6,
		deletions: 0,
		reviewStatus: "partial",
	},
	{
		id: "f3",
		filePath: "packages/desktop/src/lib/keyboard/panel-keyboard-handler.test.ts",
		additions: 22,
		deletions: 0,
	},
];

const demoModifiedFilesTrailing: AgentPanelModifiedFilesTrailingModel = {
	reviewLabel: "Review",
	keepState: "enabled",
	keepLabel: "Keep",
	reviewedCount: 1,
	totalCount: 3,
};

const demoPrCardModel: AgentPanelPrCardModel = {
	mode: "pr",
	number: 171,
	title: "feat(desktop): add ⌘[ / ⌘] panel navigation",
	state: "OPEN",
	additions: 42,
	deletions: 2,
	descriptionHtml:
		"<p>Adds <code>⌘[</code> and <code>⌘]</code> shortcuts to cycle between panels. Respects the keyboard-disabled guard and ignores events inside text inputs.</p>",
	commits: [
		{
			sha: "a3f91c2",
			message: "feat: add focusPrev/focusNext to panel-focus-store",
			insertions: 6,
			deletions: 0,
		},
		{
			sha: "b7e04d1",
			message: "feat: wire ⌘[ / ⌘] in panel-keyboard-handler",
			insertions: 14,
			deletions: 2,
		},
		{
			sha: "c2d18a0",
			message: "test: panel-keyboard-handler cycles panels",
			insertions: 22,
			deletions: 0,
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
		title: "Remove $effect from session list",
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
		conversationEntries: createRemoveEffectConversation(),
		draftText: "",
		editorRef: null,
	},
	{
		id: "composer-verify",
		title: "Add ⌘[ / ⌘] panel navigation",
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
		conversationEntries: createKeyboardNavConversation(),
		draftText: "",
		editorRef: null,
	},
	{
		id: "composer-polish",
		title: "Narrow AgentStatus to a union type",
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
		conversationEntries: createNarrowStatusConversation(),
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
						contentClass="p-4 py-4"
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
							<AgentPanelStatusIcon status={panel.status} />
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
								{#if panel.id === "composer-verify"}
									<AgentPanelModifiedFilesHeader visible={true} initiallyExpanded={false}>
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
										initiallyExpanded={false}
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
