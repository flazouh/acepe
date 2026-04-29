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
	AgentPanelStatusIcon,
	type AgentPanelSceneModel,
} from "@acepe/ui";
import {
	AppMainLayout,
	AppSidebarLayout,
	AppSidebarProjectGroup,
	AppSidebarFooter,
	AppTabBarTab,
	type AppProjectGroup,
	type AppTab,
} from "@acepe/ui/app-layout";
import { CaretDown, Plus, DotsThreeVertical, Terminal, Browser } from "phosphor-svelte";
import { ProjectLetterBadge } from "@acepe/ui";
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

let activeTabId = $state("single-tab-3");

const tabs = $derived<AppTab[]>([
	{
		id: "single-tab-1",
		title: "how to run a w",
		projectName: "acepe",
		projectColor: "#9858FF",
		agentIconSrc: agentIcon("claude", theme),
		mode: "build",
		status: "idle",
		isFocused: activeTabId === "single-tab-1",
	},
	{
		id: "single-tab-2",
		title: "for our websit",
		projectName: "acepe",
		projectColor: "#9858FF",
		agentIconSrc: agentIcon("claude", theme),
		mode: "build",
		status: "idle",
		isFocused: activeTabId === "single-tab-2",
	},
	{
		id: "single-tab-3",
		title: "i would like yo",
		projectName: "VC",
		projectColor: "#E879F9",
		agentIconSrc: agentIcon("claude", theme),
		mode: "build",
		status: "done",
		isFocused: activeTabId === "single-tab-3",
	},
]);

const scene = $derived<AgentPanelSceneModel>({
	panelId: "single-panel-demo",
	status: "connected",
	header: {
		title:
			"The composer placeholder on the website doesn't match desktop — still shows the old copy.",
		subtitle: null,
		status: "connected",
		agentLabel: null,
		agentIconSrc: agentIcon("claude", theme),
		projectLabel: "VC",
		projectColor: "#E879F9",
		sequenceId: 3,
		actions: [],
	},
	conversation: {
		entries: [
			{
				id: "single-user-1",
				type: "user",
				text: "The composer placeholder on the website doesn't match desktop — still shows the old copy.",
			},
			{
				id: "single-tool-1",
				type: "tool_call",
				kind: "search",
				title: "Search",
				subtitle: "composer placeholder",
				query: "Plan, @ for context",
				searchPath: "packages",
				searchFiles: [
					"packages/website/src/lib/components/landing-single-demo.svelte",
					"packages/desktop/src/lib/components/agent-input/agent-input-editor.svelte",
				],
				searchResultCount: 2,
				status: "done",
			},
			{
				id: "single-read-1",
				type: "tool_call",
				kind: "read",
				title: "Read",
				filePath: "packages/website/src/lib/components/landing-single-demo.svelte",
				status: "done",
				presentationState: "resolved",
			},
			{
				id: "single-unresolved-restore",
				type: "tool_call",
				kind: "other",
				title: "Unresolved tool",
				subtitle: "Restored transcript row",
				status: "degraded",
				presentationState: "degraded_operation",
				degradedReason: "No canonical operation was found for this restored transcript tool row.",
			},
			{
				id: "single-edit-1",
				type: "tool_call",
				kind: "edit",
				title: "Edit",
				filePath: "packages/website/src/lib/components/landing-single-demo.svelte",
				status: "done",
				editDiffs: [
					{
						filePath: "packages/website/src/lib/components/landing-single-demo.svelte",
						fileName: "landing-single-demo.svelte",
						oldString: 'placeholder="Ask anything…"',
						newString: 'placeholder="Plan, @ for context, / for commands"',
						additions: 1,
						deletions: 1,
					},
				],
			},
			{
				id: "single-assistant-1",
				type: "assistant",
				markdown:
					'The website demo had a stale placeholder string. Updated it to match desktop:\n\n```svelte\n- placeholder="Ask anything…"\n+ placeholder="Plan, @ for context, / for commands"\n```',
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
								<div class="px-1 py-px">
									<AppSidebarProjectGroup {group}>
										{#snippet header()}
											<div class="group shrink-0 flex items-center rounded-md bg-card px-2">
												<div class="inline-flex items-center justify-center h-7 shrink-0">
													<ProjectLetterBadge
														name={group.name}
														color={group.color ?? '#6B7280'}
														iconSrc={null}
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
										{#snippet children()}{/snippet}
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
				<div class="flex flex-1 min-w-0 min-h-0 flex-col gap-0.5 overflow-hidden">
					<div class="shrink-0 overflow-hidden rounded-lg border border-border bg-card/50">
						<div class="flex items-center gap-1 overflow-x-auto px-1 py-0.5" role="tablist">
							{#each tabs as tab (tab.id)}
								<AppTabBarTab {tab} onclick={() => { activeTabId = tab.id; }} onclose={() => {}} />
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
