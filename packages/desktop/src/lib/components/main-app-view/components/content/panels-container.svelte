<script lang="ts">
import { AgentPanelDeck } from "@acepe/ui";
import { ProjectTabBar } from "@acepe/ui/app-layout";
import { onMount } from "svelte";
import { BrowserPanel } from "$lib/acp/components/browser-panel/index.js";
import { FilePanel } from "$lib/acp/components/file-panel/index.js";
import FilePanelTabs from "$lib/acp/components/file-panel/file-panel-tabs.svelte";
import { ReviewPanel } from "$lib/acp/components/review-panel/index.js";
import { TerminalTabs } from "$lib/acp/components/terminal-panel/index.js";
import type { ProjectManager } from "$lib/acp/logic/project-manager.svelte.js";
import { getViewModeState } from "$lib/acp/logic/view-mode-state.js";
import { getAgentPreferencesStore, getAgentStore, getPanelStore } from "$lib/acp/store/index.js";
import { createLogger } from "$lib/acp/utils/logger.js";
import type { MainAppViewState } from "../../logic/main-app-view-state.svelte.js";
import { getSpawnableSessionAgents } from "../../logic/spawnable-agents.js";

import AgentPanelHost from "./agent-panel-host.svelte";
import {
	groupAllPanelsByProject,
	sortProjectGroupsForMultiLayout,
	type ProjectPanelGroup,
} from "./panel-grouping.js";
import KanbanView from "./kanban-view.svelte";
import MultiProjectGroupLabel from "./multi-project-group-label.svelte";
import { shouldHideAgentPanelProjectBadge } from "./panel-project-badge-visibility.js";

const pcLogger = createLogger({ id: "panels-container-perf", name: "PanelsContainerPerf" });
type AgentProjectRef = {
	readonly id: string;
	readonly sessionProjectPath: string | null;
	readonly sessionSequenceId: number | null;
};
type StableProjectGroup = ProjectPanelGroup<AgentProjectRef>;
const stableGroupCache = new Map<string, StableProjectGroup>();

function arraysMatchById<T extends { readonly id: string }>(
	left: readonly T[],
	right: readonly T[]
): boolean {
	return left.length === right.length && left.every((item, index) => item.id === right[index]?.id);
}

function agentArraysMatch(
	left: readonly AgentProjectRef[],
	right: readonly AgentProjectRef[]
): boolean {
	return (
		left.length === right.length &&
		left.every(
			(item, index) =>
				item.id === right[index]?.id &&
				item.sessionProjectPath === right[index]?.sessionProjectPath &&
				item.sessionSequenceId === right[index]?.sessionSequenceId
		)
	);
}

function stabilizeProjectGroups(nextGroups: readonly StableProjectGroup[]): StableProjectGroup[] {
	const nextCache = new Map<string, StableProjectGroup>();
	const stabilized = nextGroups.map((group) => {
		const cached = stableGroupCache.get(group.projectPath);
		const canReuse =
			cached !== undefined &&
			cached.projectName === group.projectName &&
			cached.projectColor === group.projectColor &&
			cached.projectIconSrc === group.projectIconSrc &&
			agentArraysMatch(cached.agentPanels, group.agentPanels) &&
			arraysMatchById(cached.filePanels, group.filePanels) &&
			arraysMatchById(cached.reviewPanels, group.reviewPanels) &&
			arraysMatchById(cached.terminalPanels, group.terminalPanels) &&
			arraysMatchById(cached.browserPanels, group.browserPanels) &&
			arraysMatchById(cached.gitPanels, group.gitPanels);
		const value = canReuse ? cached : group;
		nextCache.set(group.projectPath, value);
		return value;
	});
	stableGroupCache.clear();
	for (const [projectPath, group] of nextCache.entries()) {
		stableGroupCache.set(projectPath, group);
	}
	return stabilized;
}

interface Props {
	projectManager: ProjectManager;
	state: MainAppViewState;
	onFocusPanel?: (panelId: string) => void;
	onToggleFullscreenPanel?: (panelId: string) => void;
}

let { projectManager, state, onFocusPanel, onToggleFullscreenPanel }: Props = $props();

const panelStore = getPanelStore();
const agentStore = getAgentStore();
const agentPreferencesStore = getAgentPreferencesStore();

onMount(() => {
	pcLogger.info("[PERF] PanelsContainer: mounted", {
		panelCount: panelStore.panels.length,
		t_ms: Math.round(performance.now()),
	});
});

const agentPanelProjectRefs = $derived(panelStore.getTopLevelAgentPanelProjectRefs());

// Session hydration is handled imperatively by the initialization manager:
// - earlyPreloadPanelSessions() loads & connects sessions (Phase 2.5)
// - validateRestoredSessions() cleans up orphaned session IDs (Phase 3)
// No reactive $effect needed — imperative flows avoid infinite retry loops.

// Hoisted out of the `{#each}` loop so it has a stable identity across
// panel list mutations (open/close). If computed inside the loop, every
// render allocates a fresh array of fresh objects, which cascades into
// each AgentPanel's `viewStateInput` → `viewState` `$derived` chain and
// re-fires every dependent `$effect` on sibling panels — producing a
// visible flicker across other panels when one is opened or closed.
const availableAgents = $derived(
	getSpawnableSessionAgents(agentStore.agents, agentPreferencesStore.selectedAgentIds).map((a) => ({
		id: a.id,
		name: a.name,
		icon: a.icon,
		availability_kind: a.availability_kind,
	}))
);

// Focused view: panels grouped by project (needed for view mode state and card layout)
const allGroups = $derived.by(() =>
	stabilizeProjectGroups(
		groupAllPanelsByProject(
			agentPanelProjectRefs,
			panelStore.filePanels.filter((panel) => panel.ownerPanelId === null),
			panelStore.reviewPanels,
			panelStore.terminalPanelGroups,
			panelStore.browserPanels,
			[],
			projectManager.projects
		)
	)
);
const topLevelPanelsWithProject = $derived.by(() => {
	const topLevelPanels: Array<{ id: string; projectPath: string | null }> = [];
	for (const panel of agentPanelProjectRefs) {
		topLevelPanels.push({ id: panel.id, projectPath: panel.sessionProjectPath });
	}
	for (const panel of panelStore.workspacePanels) {
		if (panel.kind === "agent" || panel.kind === "git" || panel.ownerPanelId !== null) {
			continue;
		}
		topLevelPanels.push({ id: panel.id, projectPath: panel.projectPath });
	}
	return topLevelPanels;
});

// Single source of truth for single/project/multi semantics (layout, active project, fullscreen panel)
const viewModeState = $derived.by(() =>
	getViewModeState(panelStore, { panelsWithState: topLevelPanelsWithProject, allGroups })
);

// True multi-project layout: cards layout with no focused project (all groups visible).
// Drives wrapper removal, explicit project ordering, and per-panel project badge visibility.
const isMultiCardsMode = $derived(
	viewModeState.layout === "cards" &&
		viewModeState.activeProjectPath == null &&
		allGroups.length > 1
);

// Project tab bar: shown in project mode when there are multiple projects to switch between.
const projectTabs = $derived.by(() => {
	const projects = viewModeState.focusedModeAllProjects ?? [];
	return projects.map((project) => {
		const group = allGroups.find((candidate) => candidate.projectPath === project.path);
		return {
			name: project.name,
			color: project.color,
			path: project.path,
			iconSrc: project.iconSrc,
			sessionCount: group ? group.agentPanels.length : 0,
		};
	});
});
const showProjectTabBar = $derived(
	viewModeState.layout === "cards" &&
		viewModeState.activeProjectPath != null &&
		projectTabs.length > 1 &&
		!viewModeState.isFullscreenMode
);

// Explicitly-sorted groups for true multi-project rendering. project/single modes keep
// reading `allGroups` so focused-project switching and fallback semantics stay intact.
const pinnedMultiProjectPath = $derived.by(() => {
	const frontPanel = agentPanelProjectRefs[0];
	if (!frontPanel) {
		return null;
	}
	const frontPanelState = panelStore.getTopLevelPanel(frontPanel.id);
	if (frontPanelState?.kind !== "agent") {
		return null;
	}
	// Pin only unsaved/empty composer panels so project switching does not
	// reshuffle the active panel in multi mode.
	if (frontPanelState.sessionId !== null || frontPanel.sessionSequenceId !== null) {
		return null;
	}
	return frontPanel.sessionProjectPath;
});
const sortedGroupsForMulti = $derived(
	sortProjectGroupsForMultiLayout(allGroups, { pinnedProjectPath: pinnedMultiProjectPath })
);

// Agent panels now carry their own project identity in project and multi-project views.
const hideEmbeddedProjectBadge = $derived(
	shouldHideAgentPanelProjectBadge({
		groupCount: allGroups.length,
		isMultiCardsMode,
	})
);

function isGroupHidden(group: { projectPath: string }): boolean {
	return (
		viewModeState.activeProjectPath != null && group.projectPath !== viewModeState.activeProjectPath
	);
}

const fullscreenTopLevelPanel = $derived.by(() => {
	const fullscreenPanelRef = viewModeState.fullscreenPanel;
	if (!fullscreenPanelRef) {
		return null;
	}

	const fullscreenPanel = panelStore.getTopLevelPanel(fullscreenPanelRef.id);
	if (fullscreenPanel?.kind === "agent") {
		return { kind: "agent", panelId: fullscreenPanel.id } as const;
	}

	const filePanel = panelStore.filePanels.find(
		(panel) => panel.ownerPanelId === null && panel.id === fullscreenPanelRef.id
	);
	if (filePanel) {
		return { kind: "file", panel: filePanel } as const;
	}

	const reviewPanel = panelStore.reviewPanels.find((panel) => panel.id === fullscreenPanelRef.id);
	if (reviewPanel) {
		return { kind: "review", panel: reviewPanel } as const;
	}

	const terminalPanel = panelStore.terminalPanelGroups.find(
		(panel) => panel.id === fullscreenPanelRef.id
	);
	if (terminalPanel) {
		return { kind: "terminal", panel: terminalPanel } as const;
	}

	const browserPanel = panelStore.browserPanels.find((panel) => panel.id === fullscreenPanelRef.id);
	if (browserPanel) {
		return { kind: "browser", panel: browserPanel } as const;
	}

	return null;
});
const fullscreenAgentPanelId = $derived(
	viewModeState.isFullscreenMode && fullscreenTopLevelPanel?.kind === "agent"
		? fullscreenTopLevelPanel.panelId
		: null
);
const isAgentFullscreenActive = $derived(fullscreenAgentPanelId !== null);

function isAgentPanelFullscreen(panelId: string): boolean {
	return fullscreenAgentPanelId === panelId || panelStore.fullscreenPanelId === panelId;
}

function isAgentPanelHidden(panelId: string): boolean {
	return fullscreenAgentPanelId !== null && fullscreenAgentPanelId !== panelId;
}

function isAgentFullscreenGroup(group: { agentPanels: readonly AgentProjectRef[] }): boolean {
	return (
		fullscreenAgentPanelId !== null &&
		group.agentPanels.some((panel) => panel.id === fullscreenAgentPanelId)
	);
}

const terminalTabsPanelStore = $derived.by(() => ({
	fullscreenPanelId: panelStore.fullscreenPanelId,
	focusedPanelId: panelStore.focusedPanelId,
	viewMode: panelStore.viewMode === "kanban" ? "project" : panelStore.viewMode,
	getSelectedTerminalTabId: panelStore.getSelectedTerminalTabId.bind(panelStore),
	setSelectedTerminalTab: panelStore.setSelectedTerminalTab.bind(panelStore),
	openTerminalTab: panelStore.openTerminalTab.bind(panelStore),
	closeTerminalTab: panelStore.closeTerminalTab.bind(panelStore),
	moveTerminalTabToNewPanel: panelStore.moveTerminalTabToNewPanel.bind(panelStore),
	canMoveTerminalTabToNewPanel: panelStore.canMoveTerminalTabToNewPanel.bind(panelStore),
	enterTerminalFullscreen: panelStore.enterTerminalFullscreen.bind(panelStore),
	exitFullscreen: panelStore.exitFullscreen.bind(panelStore),
	closeTerminalPanel: panelStore.closeTerminalPanel.bind(panelStore),
	resizeTerminalPanel: panelStore.resizeTerminalPanel.bind(panelStore),
	updateTerminalPtyId: panelStore.updateTerminalPtyId.bind(panelStore),
}));
</script>

{#if showProjectTabBar}
	<div class="shrink-0 overflow-hidden">
		<ProjectTabBar
			projects={projectTabs}
			activeProjectPath={viewModeState.activeProjectPath}
			onSelectProject={(path) => panelStore.setFocusedViewProjectPath(path)}
		/>
	</div>
{/if}
<AgentPanelDeck fullscreen={viewModeState.isFullscreenMode}>
	<!-- Tabs are now rendered in parent (main-app-view.svelte) via TabBar -->
		<!-- Fullscreen top-level panel -->
		{#if viewModeState.isFullscreenMode && fullscreenTopLevelPanel && fullscreenTopLevelPanel.kind !== "agent"}
			{#if fullscreenTopLevelPanel.kind === "file"}
				{@const filePanel = fullscreenTopLevelPanel.panel}
				{@const project = projectManager.projects.find((p) => p.path === filePanel.projectPath)}
				<FilePanel
					panelId={filePanel.id}
					filePath={filePanel.filePath}
					projectPath={filePanel.projectPath}
					projectName={project ? project.name : "Unknown"}
					projectColor={project?.color}
					projectIconSrc={project?.iconPath ?? null}
					width={filePanel.width}
					isFullscreenEmbedded={true}
					hideProjectBadge={true}
					onClose={() => panelStore.closeFilePanel(filePanel.id)}
					onResize={(panelId, delta) => panelStore.resizeFilePanel(panelId, delta)}
				/>
			{:else if fullscreenTopLevelPanel.kind === "review"}
				{@const reviewPanel = fullscreenTopLevelPanel.panel}
				<ReviewPanel
					panelId={reviewPanel.id}
					projectPath={reviewPanel.projectPath}
					modifiedFilesState={reviewPanel.modifiedFilesState}
					selectedFileIndex={reviewPanel.selectedFileIndex}
					width={reviewPanel.width}
					isFullscreenEmbedded={true}
					onClose={() => panelStore.closeReviewPanel(reviewPanel.id)}
					onResize={(panelId, delta) => panelStore.resizeReviewPanel(panelId, delta)}
					onSelectFile={(index) => panelStore.updateReviewPanelFileIndex(reviewPanel.id, index)}
				/>
			{:else if fullscreenTopLevelPanel.kind === "terminal"}
				{@const terminalGroup = fullscreenTopLevelPanel.panel}
				{@const project = projectManager.projects.find((p) => p.path === terminalGroup.projectPath)}
				<TerminalTabs
					group={terminalGroup}
					tabs={panelStore.getTerminalTabsForGroup(terminalGroup.id)}
					projectPath={terminalGroup.projectPath}
					projectName={project ? project.name : "Unknown"}
					projectColor={project ? project.color : "#4AD0FF"}
					projectIconSrc={project?.iconPath ?? null}
					panelStore={terminalTabsPanelStore}
				/>
			{:else if fullscreenTopLevelPanel.kind === "browser"}
				{@const browserPanel = fullscreenTopLevelPanel.panel}
				<BrowserPanel
					panelId={browserPanel.id}
					url={browserPanel.url}
					title={browserPanel.title}
					width={browserPanel.width}
					isFullscreenEmbedded={true}
					onClose={() => panelStore.closeBrowserPanel(browserPanel.id)}
					onResize={(panelId, delta) => panelStore.resizeBrowserPanel(panelId, delta)}
				/>
			{/if}
		{:else if viewModeState.layout === "kanban"}
			<KanbanView {projectManager} {state} />
		{:else}
			<!-- Project/Multi mode: panels grouped by project; hide inactive in focused view so they stay mounted -->
		{#each (isMultiCardsMode ? sortedGroupsForMulti : allGroups) as group (group.projectPath)}
			{@const hasAgentPanels = group.agentPanels.length > 0}
			{@const isSingleProject = allGroups.length === 1}
			{#snippet nonAgentPanels()}
				{#if !isAgentFullscreenActive}
					<!-- File panels (tabbed per project) -->
					{#if group.filePanels.length > 0}
						{@const project = projectManager.projects.find((p) => p.path === group.projectPath)}
						<FilePanelTabs
							filePanels={group.filePanels}
							activeFilePanelId={panelStore.getActiveTopLevelFilePanelId(group.projectPath)}
							projectName={project ? project.name : "Unknown"}
							projectColor={project?.color}
							projectIconSrc={project?.iconPath ?? null}
							onSelectFilePanel={(panelId) => panelStore.setActiveTopLevelFilePanel(group.projectPath, panelId)}
							onCloseFilePanel={(panelId) => panelStore.closeFilePanel(panelId)}
							onResizeFilePanel={(panelId, delta) => panelStore.resizeFilePanel(panelId, delta)}
						/>
					{/if}

					<!-- Review panels -->
					{#each group.reviewPanels as reviewPanel (reviewPanel.id)}
						<ReviewPanel
							panelId={reviewPanel.id}
							projectPath={reviewPanel.projectPath}
							modifiedFilesState={reviewPanel.modifiedFilesState}
							selectedFileIndex={reviewPanel.selectedFileIndex}
							width={reviewPanel.width}
							onClose={() => panelStore.closeReviewPanel(reviewPanel.id)}
							onResize={(panelId, delta) => panelStore.resizeReviewPanel(panelId, delta)}
							onSelectFile={(index) => panelStore.updateReviewPanelFileIndex(reviewPanel.id, index)}
						/>
					{/each}

					<!-- Terminal panels (always use TerminalTabs for tab support in header) -->
					{#if group.terminalPanels.length > 0}
						{#each group.terminalPanels as terminalGroup (terminalGroup.id)}
							<TerminalTabs
								group={terminalGroup}
								tabs={panelStore.getTerminalTabsForGroup(terminalGroup.id)}
								projectPath={group.projectPath}
								projectName={group.projectName}
								projectColor={group.projectColor}
								projectIconSrc={projectManager.projects.find((project) => project.path === group.projectPath)?.iconPath ??
									null}
								panelStore={terminalTabsPanelStore}
							/>
						{/each}
					{/if}

					<!-- Browser panels (project-scoped) -->
					{#each group.browserPanels as browserPanel (browserPanel.id)}
						<BrowserPanel
							panelId={browserPanel.id}
							url={browserPanel.url}
							title={browserPanel.title}
							width={browserPanel.width}
							isFillContainer={!hasAgentPanels}
							onClose={() => panelStore.closeBrowserPanel(browserPanel.id)}
							onResize={(panelId, delta) => panelStore.resizeBrowserPanel(panelId, delta)}
						/>
					{/each}
				{/if}
			{/snippet}

			{#snippet agentPanels()}
					<!-- Agent panels -->
					{#each group.agentPanels as panel (panel.id)}
						<div class={isAgentPanelHidden(panel.id) ? "hidden" : "contents"}>
							<AgentPanelHost
								panelId={panel.id}
								panelRef={panelStore.getTopLevelAgentPanelRef(panel.id)}
								{projectManager}
								{state}
								{availableAgents}
								hideProjectBadge={hideEmbeddedProjectBadge}
								isFullscreen={isAgentPanelFullscreen(panel.id)}
								isFocused={panelStore.focusedPanelId === panel.id}
								{onFocusPanel}
								{onToggleFullscreenPanel}
							/>
						</div>
					{/each}
			{/snippet}

			{#if isSingleProject}
				{@render nonAgentPanels()}
				{@render agentPanels()}
			{:else if isMultiCardsMode}
				{#if hasAgentPanels}
					{@render agentPanels()}
					{@render nonAgentPanels()}
				{:else}
					<div class="flex flex-col flex-1 min-w-0 min-h-0">
						<MultiProjectGroupLabel
							projectName={group.projectName}
							projectColor={group.projectColor}
							projectIconSrc={group.projectIconSrc}
						/>
						{@render nonAgentPanels()}
					</div>
				{/if}
			{:else}
				<div
					class="flex flex-row items-stretch gap-0.5 {isAgentFullscreenGroup(group) || !hasAgentPanels
						? 'flex-1 min-w-0 min-h-0'
						: 'flex-none min-h-0'} {isGroupHidden(group) ? 'hidden' : ''}"
				>
					{@render nonAgentPanels()}
					{@render agentPanels()}
				</div>
			{/if}
			{/each}
		{/if}
</AgentPanelDeck>
