<script lang="ts">
import { AgentPanelDeck, ProjectCard } from "@acepe/ui";
import { onMount } from "svelte";
import { BrowserPanel } from "$lib/acp/components/browser-panel/index.js";
import { FilePanel } from "$lib/acp/components/file-panel/index.js";
import FilePanelTabs from "$lib/acp/components/file-panel/file-panel-tabs.svelte";
import { AgentPanel } from "$lib/acp/components/index.js";
import { ReviewPanel } from "$lib/acp/components/review-panel/index.js";
import { TerminalPanel, TerminalTabs } from "$lib/acp/components/terminal-panel/index.js";
import type { ProjectManager } from "$lib/acp/logic/project-manager.svelte.js";
import { getViewModeState } from "$lib/acp/logic/view-mode-state.js";
import {
	getAgentPreferencesStore,
	getAgentStore,
	getPanelStore,
	getSessionStore,
} from "$lib/acp/store/index.js";
import { createLogger } from "$lib/acp/utils/logger.js";
import { useTheme } from "$lib/components/theme/context.svelte.js";
import * as m from "$lib/paraglide/messages.js";

import type { MainAppViewState } from "../../logic/main-app-view-state.svelte.js";
import { getSpawnableSessionAgents } from "../../logic/spawnable-agents.js";

import { groupAllPanelsByProject } from "./panel-grouping.js";
import KanbanView from "./kanban-view.svelte";

const pcLogger = createLogger({ id: "panels-container-perf", name: "PanelsContainerPerf" });

interface Props {
	projectManager: ProjectManager;
	state: MainAppViewState;
}

let { projectManager, state }: Props = $props();

const panelStore = getPanelStore();
const sessionStore = getSessionStore();
const agentStore = getAgentStore();
const agentPreferencesStore = getAgentPreferencesStore();

onMount(() => {
	pcLogger.info("[PERF] PanelsContainer: mounted", {
		panelCount: panelStore.panels.length,
		t_ms: Math.round(performance.now()),
	});
});
const themeState = useTheme();

// Panel state with hot state - session data is resolved in AgentPanel
// This avoids creating new object references for all panels when any session changes
const panelsWithState = $derived.by(() => {
	return panelStore.panels.map((panel) => {
		const hotState = panelStore.getHotState(panel.id);

		// Use getSessionIdentity for immutable data (no object churn)
		// Identity contains: id, projectPath, agentId, worktreePath
		const identity = panel.sessionId ? sessionStore.getSessionIdentity(panel.sessionId) : null;

		// Get metadata for title (rarely changes, stable reference)
		const metadata = panel.sessionId ? sessionStore.getSessionMetadata(panel.sessionId) : null;

		// Track if we're waiting for a session to load (has ID but no data yet)
		const isWaitingForSession = panel.sessionId !== null && identity === undefined;

		const resolvedSessionProjectPath = identity?.projectPath ?? panel.projectPath ?? null;
		return {
			...panel,
			...hotState,
			// Pass primitives instead of full sessionData object
			sessionProjectPath: resolvedSessionProjectPath,
			sessionAgentId: identity?.agentId ?? panel.agentId ?? null,
			sessionTitle: metadata?.title ?? null,
			selectedAgentId: panel.selectedAgentId,
			isWaitingForSession,
		};
	});
});

$effect(() => {
	if (!import.meta.env.DEV) return;
	const panels = panelsWithState;
	for (const panel of panels) {
		if (panel.sessionProjectPath === null) {
			const identity = panel.sessionId ? sessionStore.getSessionIdentity(panel.sessionId) : null;
			pcLogger.info("[worktree-flow] panel projectPath null", {
				panelId: panel.id,
				sessionId: panel.sessionId ?? null,
				identityExists: identity !== undefined && identity !== null,
				panelProjectPath: panel.projectPath ?? null,
			});
		}
	}
});

$effect(() => {
	if (!import.meta.env.DEV) return;
	for (const panel of panelsWithState) {
		if (panelStore.focusedPanelId !== panel.id) {
			continue;
		}
		pcLogger.info("[first-send-trace] focused panel container state", {
			panelId: panel.id,
			sessionId: panel.sessionId ?? null,
			sessionProjectPath: panel.sessionProjectPath ?? null,
			selectedAgentId: panel.selectedAgentId ?? null,
			isWaitingForSession: panel.isWaitingForSession,
			pendingProjectSelection: panel.pendingProjectSelection,
		});
	}
});

// Session hydration is handled imperatively by the initialization manager:
// - earlyPreloadPanelSessions() loads & connects sessions (Phase 2.5)
// - validateRestoredSessions() cleans up orphaned session IDs (Phase 3)
// No reactive $effect needed — imperative flows avoid infinite retry loops.

// Focused view: panels grouped by project (needed for view mode state and card layout)
const allGroups = $derived(
	groupAllPanelsByProject(
		panelsWithState,
		panelStore.filePanels.filter((panel) => panel.ownerPanelId === null),
		panelStore.reviewPanels,
		panelStore.terminalPanelGroups,
		panelStore.browserPanels,
		[],
		projectManager.projects
	)
);
const hideEmbeddedProjectBadge = $derived(allGroups.length > 1);

const topLevelPanelsWithProject = $derived.by(() => {
	const topLevelPanels: Array<{ id: string; projectPath: string | null }> = [];
	for (const panel of panelsWithState) {
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

	const agentPanel = panelsWithState.find((panel) => panel.id === fullscreenPanelRef.id);
	if (agentPanel) {
		return { kind: "agent", panel: agentPanel } as const;
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
const fullscreenPanelSnapshot = $derived.by(() => {
	const panel =
		fullscreenTopLevelPanel && fullscreenTopLevelPanel.kind === "agent"
			? fullscreenTopLevelPanel.panel
			: null;
	return {
		panelId: panel?.id ?? "",
		sessionId: panel?.sessionId ?? null,
		width: panel && panel.width > 0 ? panel.width : 100,
		pendingProjectSelection: panel?.pendingProjectSelection ?? false,
		selectedAgentId: panel?.selectedAgentId ?? null,
		sessionProjectPath: panel?.sessionProjectPath ?? null,
		isWaitingForSession: panel?.isWaitingForSession ?? false,
		reviewMode: panel?.reviewMode ?? false,
		reviewFilesState: panel?.reviewFilesState ?? null,
		reviewFileIndex: panel?.reviewFileIndex ?? 0,
	};
});

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

<AgentPanelDeck fullscreen={viewModeState.isFullscreenMode}>
	<!-- Tabs are now rendered in parent (main-app-view.svelte) via TabBar -->
		<!-- Fullscreen top-level panel -->
		{#if viewModeState.isFullscreenMode && fullscreenTopLevelPanel}
			{#if fullscreenTopLevelPanel.kind === "agent"}
				{@const effectiveTheme = themeState.effectiveTheme}
				{@const projectPath = fullscreenPanelSnapshot.sessionProjectPath}
				{@const project = projectPath
					? (projectManager.projects.find((p) => p.path === projectPath) ?? null)
					: null}
				{@const availableAgents = getSpawnableSessionAgents(
					agentStore.agents,
					agentPreferencesStore.selectedAgentIds
				).map((a) => ({
						id: a.id,
						name: a.name,
						icon: a.icon,
						availability_kind: a.availability_kind,
					}))}
				{@const selectedAgentId = fullscreenPanelSnapshot.selectedAgentId
					? availableAgents.some((agent) => agent.id === fullscreenPanelSnapshot.selectedAgentId)
						? fullscreenPanelSnapshot.selectedAgentId
						: null
					: null}
				<div class="relative h-full min-h-0 min-w-0 flex-1">
					<svelte:boundary onerror={(e) => console.error('[boundary:agent-panel]', fullscreenPanelSnapshot.panelId, e)}>
						<AgentPanel
							panelId={fullscreenPanelSnapshot.panelId}
							sessionId={fullscreenPanelSnapshot.sessionId}
							width={fullscreenPanelSnapshot.width}
							pendingProjectSelection={fullscreenPanelSnapshot.pendingProjectSelection}
							isWaitingForSession={fullscreenPanelSnapshot.isWaitingForSession}
							projectCount={projectManager.projectCount}
							allProjects={projectManager.projects}
							{project}
							{selectedAgentId}
							{availableAgents}
							onAgentChange={(agentId) =>
								state.handlePanelAgentChange(fullscreenPanelSnapshot.panelId, agentId)}
							{effectiveTheme}
							isFullscreen={true}
							isFocused={panelStore.focusedPanelId === fullscreenPanelSnapshot.panelId}
							onClose={() => state.handleClosePanel(fullscreenPanelSnapshot.panelId)}
							onCreateSessionForProject={(project) =>
								state
									.handleCreateSessionForProject(fullscreenPanelSnapshot.panelId, project)
									.mapErr(() => {
										// Error handling is done in the handler
									})}
							onSessionCreated={(sessionId) =>
								panelStore.updatePanelSession(fullscreenPanelSnapshot.panelId, sessionId)}
							onResizePanel={(panelId, delta) => state.handleResizePanel(panelId, delta)}
							onToggleFullscreen={() =>
								state.handleToggleFullscreen(fullscreenPanelSnapshot.panelId)}
							onFocus={() => state.handleFocusPanel(fullscreenPanelSnapshot.panelId)}
							hideProjectBadge={hideEmbeddedProjectBadge}
							reviewMode={fullscreenPanelSnapshot.reviewMode}
							reviewFilesState={fullscreenPanelSnapshot.reviewFilesState}
							reviewFileIndex={fullscreenPanelSnapshot.reviewFileIndex}
							onEnterReviewMode={(modifiedFilesState, initialFileIndex) =>
								panelStore.enterReviewMode(
									fullscreenPanelSnapshot.panelId,
									modifiedFilesState,
									initialFileIndex
								)}
							onExitReviewMode={() => panelStore.exitReviewMode(fullscreenPanelSnapshot.panelId)}
							onReviewFileIndexChange={(index) =>
								panelStore.setReviewFileIndex(fullscreenPanelSnapshot.panelId, index)}
							onOpenFullscreenReview={fullscreenPanelSnapshot.sessionId
								? (sessionId, fileIndex) => state.openReviewFullscreen(sessionId, fileIndex)
								: undefined}
							attachedFilePanels={panelStore.getAttachedFilePanels(fullscreenPanelSnapshot.panelId)}
							activeAttachedFilePanelId={panelStore.getActiveFilePanelId(
								fullscreenPanelSnapshot.panelId
							)}
							onSelectAttachedFilePanel={(ownerPanelId, panelId) =>
								panelStore.setActiveAttachedFilePanel(ownerPanelId, panelId)}
							onCloseAttachedFilePanel={(panelId) => panelStore.closeFilePanel(panelId)}
							onResizeAttachedFilePanel={(panelId, delta) =>
								panelStore.resizeFilePanel(panelId, delta)}
							onCreateIssueReport={(draft) => state.openUserReportsWithDraft(draft)}
						/>
						{#snippet failed(error, reset)}
							<div class="flex flex-1 items-center justify-center p-4">
								<div class="flex flex-col items-center gap-2 text-muted-foreground text-sm">
									<span>{m.error_boundary_panel_failed()}</span>
									<button class="text-xs underline hover:text-foreground" onclick={reset}>{m.error_boundary_retry()}</button>
								</div>
							</div>
						{/snippet}
					</svelte:boundary>
				</div>
			{:else if fullscreenTopLevelPanel.kind === "file"}
				{@const filePanel = fullscreenTopLevelPanel.panel}
				{@const project = projectManager.projects.find((p) => p.path === filePanel.projectPath)}
				<FilePanel
					panelId={filePanel.id}
					filePath={filePanel.filePath}
					projectPath={filePanel.projectPath}
					projectName={project ? project.name : m.project_unknown()}
					projectColor={project?.color}
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
					projectName={project ? project.name : m.project_unknown()}
					projectColor={project ? project.color : "#4AD0FF"}
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
		{#each allGroups as group (group.projectPath)}
			{@const hasAgentPanels = group.agentPanels.length > 0}
			{@const isSingleProject = allGroups.length === 1}
			{#snippet groupPanels()}
					<!-- File panels (tabbed per project) -->
					{#if group.filePanels.length > 0}
						{@const project = projectManager.projects.find((p) => p.path === group.projectPath)}
						<FilePanelTabs
							filePanels={group.filePanels}
							activeFilePanelId={panelStore.getActiveTopLevelFilePanelId(group.projectPath)}
							projectName={project ? project.name : m.project_unknown()}
							projectColor={project?.color}
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

					<!-- Agent panels -->
					{#each group.agentPanels as panel (panel.id)}
							{@const effectiveTheme = themeState.effectiveTheme}
							{@const projectPath = panel.sessionProjectPath}
							{@const project = projectPath
								? (projectManager.projects.find((p) => p.path === projectPath) ?? null)
								: null}
							{@const availableAgents = getSpawnableSessionAgents(
								agentStore.agents,
								agentPreferencesStore.selectedAgentIds
							).map((a) => ({
									id: a.id,
									name: a.name,
									icon: a.icon,
									availability_kind: a.availability_kind,
								}))}
							{@const selectedAgentId = panel.selectedAgentId
								? availableAgents.some((agent) => agent.id === panel.selectedAgentId)
									? panel.selectedAgentId
									: null
								: null}
							<svelte:boundary onerror={(e) => console.error('[boundary:agent-panel]', panel.id, e)}>
								<AgentPanel
									panelId={panel.id}
									sessionId={panel.sessionId}
									width={panel.width || 100}
									pendingProjectSelection={panel.pendingProjectSelection}
									isWaitingForSession={panel.isWaitingForSession}
									projectCount={projectManager.projectCount}
									allProjects={projectManager.projects}
									{project}
									{selectedAgentId}
									{availableAgents}
									onAgentChange={(agentId) => state.handlePanelAgentChange(panel.id, agentId)}
									{effectiveTheme}
									isFullscreen={panelStore.fullscreenPanelId === panel.id}
									isFocused={panelStore.focusedPanelId === panel.id}
									onClose={() => state.handleClosePanel(panel.id)}
									onCreateSessionForProject={(project) =>
										state.handleCreateSessionForProject(panel.id, project).mapErr(() => {
											// Error handling is done in the handler
										})}
									onSessionCreated={(sessionId) => panelStore.updatePanelSession(panel.id, sessionId)}
									onResizePanel={(panelId, delta) => state.handleResizePanel(panelId, delta)}
									onToggleFullscreen={() => state.handleToggleFullscreen(panel.id)}
									onFocus={() => state.handleFocusPanel(panel.id)}
									hideProjectBadge={hideEmbeddedProjectBadge}
									reviewMode={panel.reviewMode}
									reviewFilesState={panel.reviewFilesState}
									reviewFileIndex={panel.reviewFileIndex}
									onEnterReviewMode={(modifiedFilesState, initialFileIndex) =>
										panelStore.enterReviewMode(panel.id, modifiedFilesState, initialFileIndex)}
									onExitReviewMode={() => panelStore.exitReviewMode(panel.id)}
									onReviewFileIndexChange={(index) => panelStore.setReviewFileIndex(panel.id, index)}
									onOpenFullscreenReview={panel.sessionId
										? (sessionId, fileIndex) => state.openReviewFullscreen(sessionId, fileIndex)
										: undefined}
									attachedFilePanels={panelStore.getAttachedFilePanels(panel.id)}
									activeAttachedFilePanelId={panelStore.getActiveFilePanelId(panel.id)}
									onSelectAttachedFilePanel={(ownerPanelId, panelId) =>
										panelStore.setActiveAttachedFilePanel(ownerPanelId, panelId)}
									onCloseAttachedFilePanel={(panelId) => panelStore.closeFilePanel(panelId)}
									onResizeAttachedFilePanel={(panelId, delta) =>
										panelStore.resizeFilePanel(panelId, delta)}
									onCreateIssueReport={(draft) => state.openUserReportsWithDraft(draft)}
								/>
								{#snippet failed(error, reset)}
									<div class="flex flex-1 items-center justify-center p-4">
										<div class="flex flex-col items-center gap-2 text-muted-foreground text-sm">
											<span>{m.error_boundary_panel_failed()}</span>
											<button class="text-xs underline hover:text-foreground" onclick={reset}>{m.error_boundary_retry()}</button>
										</div>
									</div>
								{/snippet}
							</svelte:boundary>
					{/each}
			{/snippet}

			{#if isSingleProject}
				{@render groupPanels()}
			{:else}
			<ProjectCard
				class="{!hasAgentPanels
					? 'flex-1 min-w-0 min-h-0'
					: 'flex-none min-h-0'} {isGroupHidden(group) ? 'hidden' : ''}"
					projectName={group.projectName}
					projectColor={group.projectColor}
					variant="corner"
					allProjects={viewModeState.focusedModeAllProjects
						? [...viewModeState.focusedModeAllProjects]
						: undefined}
					activeProjectPath={viewModeState.activeProjectPath}
					onSelectProject={(path: string) => panelStore.setFocusedViewProjectPath(path)}
				>
					{@render groupPanels()}
				</ProjectCard>
			{/if}
			{/each}
		{/if}
</AgentPanelDeck>
