<script lang="ts">
import { ProjectCard } from "@acepe/ui";
import { onMount } from "svelte";
import { BrowserPanel } from "$lib/acp/components/browser-panel/index.js";
import { FilePanel } from "$lib/acp/components/file-panel/index.js";
import { GitPanel } from "$lib/acp/components/git-panel/index.js";
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
import EmbeddedModalShell from "$lib/components/ui/embedded-modal-shell.svelte";
import * as m from "$lib/paraglide/messages.js";

import type { MainAppViewState } from "../../logic/main-app-view-state.svelte.js";

import { clampFullscreenAuxPanelWidth, resolveFullscreenAuxPanel } from "./fullscreen-layout.js";
import { groupAllPanelsByProject } from "./panel-grouping.js";

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
		panelStore.terminalPanels,
		panelStore.browserPanels,
		panelStore.gitPanels,
		projectManager.projects
	)
);

// Single source of truth for single/project/multi semantics (layout, active project, fullscreen panel)
const viewModeState = $derived.by(() =>
	getViewModeState(panelStore, { panelsWithState, allGroups })
);

// Main fullscreen mode is only for agent-panel fullscreen.
// Terminal aux-only fullscreen stays on the project-card rendering path so the terminal component does not remount.
const fullscreenAuxPanel = $derived(
	viewModeState.isFullscreenMode || panelStore.fullscreenAuxOnly
		? resolveFullscreenAuxPanel({
				selectedAuxPanel: panelStore.fullscreenAuxPanel,
				filePanels: panelStore.filePanels.filter((panel) => panel.ownerPanelId === null),
				reviewPanels: panelStore.reviewPanels,
				terminalPanels: panelStore.terminalPanels,
				gitPanels: panelStore.gitPanels,
				browserPanels: panelStore.browserPanels,
			})
		: null
);
const fullscreenAuxPanelWidthStyle = $derived.by(() => {
	const auxPanel = fullscreenAuxPanel;
	if (!auxPanel) return null;
	const clampedWidth = clampFullscreenAuxPanelWidth(auxPanel.panel.width);
	return `width: ${clampedWidth}px; flex-basis: ${clampedWidth}px;`;
});

const auxOnlyTerminalProjectPath = $derived.by(() => {
	if (!panelStore.fullscreenAuxOnly || fullscreenAuxPanel?.kind !== "terminal") return null;
	const terminalPanel = panelStore.terminalPanels.find(
		(panel) => panel.id === fullscreenAuxPanel.panel.id
	);
	return terminalPanel?.projectPath ?? null;
});

const sourceControlPanel = $derived(panelStore.gitPanels[0] ?? null);
const sourceControlPanelSnapshot = $derived.by(() => {
	const panel = sourceControlPanel;
	return {
		id: panel?.id ?? "",
		projectPath: panel?.projectPath ?? "",
		width: panel?.width ?? 400,
		initialTarget: panel?.initialTarget,
		isOpen: panel !== null,
	};
});

function isGroupHidden(group: { projectPath: string }): boolean {
	if (panelStore.fullscreenAuxOnly && auxOnlyTerminalProjectPath !== null) {
		return group.projectPath !== auxOnlyTerminalProjectPath;
	}
	return (
		viewModeState.activeProjectPath != null && group.projectPath !== viewModeState.activeProjectPath
	);
}

// Resolve full panel from viewModeState for template (helper returns minimal PanelWithProject)
const fullscreenPanel = $derived(
	viewModeState.fullscreenPanel
		? (panelsWithState.find((p) => p.id === viewModeState.fullscreenPanel?.id) ?? null)
		: null
);
const fullscreenPanelSnapshot = $derived.by(() => {
	const panel = fullscreenPanel;
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
</script>

<div class="flex flex-col flex-1 min-h-0 gap-0.5">
	<!-- Tabs are now rendered in parent (main-app-view.svelte) via TabBar -->
	<div
		class="flex flex-row items-stretch gap-0.5 flex-1 min-h-0 {panelStore.fullscreenAuxOnly
			? 'overflow-hidden'
			: 'overflow-x-auto'}"
	>
		<!-- Fullscreen agent panel -->
		{#if viewModeState.isFullscreenMode && fullscreenPanel}
			{@const effectiveTheme = themeState.effectiveTheme}
			{@const projectPath = fullscreenPanelSnapshot.sessionProjectPath}
			{@const project = projectPath
				? (projectManager.projects.find((p) => p.path === projectPath) ?? null)
				: null}
			{@const availableAgents = agentPreferencesStore
				.getPanelSelectableAgents(agentStore.agents)
				.map((a) => ({
					id: a.id,
					name: a.name,
					icon: a.icon,
					available: a.available,
					availability_kind: a.availability_kind,
				}))}
			{@const selectedAgentId = fullscreenPanelSnapshot.selectedAgentId
				? availableAgents.some((agent) => agent.id === fullscreenPanelSnapshot.selectedAgentId)
					? fullscreenPanelSnapshot.selectedAgentId
					: null
				: null}
			{#snippet fullscreenInner()}
				<div class="flex h-full flex-1 min-w-0 min-h-0 gap-0.5">
					{#if fullscreenAuxPanel && fullscreenAuxPanel.kind !== "git"}
						<div
							class="h-full min-h-0 shrink-0 min-w-[18rem] max-w-[45%]"
							style={fullscreenAuxPanelWidthStyle ?? undefined}
						>
							{#if fullscreenAuxPanel.kind === "file"}
								{@const filePanel = fullscreenAuxPanel.panel}
								{@const fileProject = projectManager.projects.find(
									(p) => p.path === filePanel.projectPath
								)}
								<FilePanel
									panelId={filePanel.id}
									filePath={filePanel.filePath}
									projectPath={filePanel.projectPath}
									projectName={fileProject?.name ?? m.project_unknown()}
									projectColor={fileProject?.color}
									width={filePanel.width}
									isFullscreenEmbedded={true}
									hideProjectBadge={true}
									onClose={() => panelStore.closeFilePanel(filePanel.id)}
									onResize={(panelId, delta) => panelStore.resizeFilePanel(panelId, delta)}
								/>
							{:else if fullscreenAuxPanel.kind === "review"}
								{@const reviewPanel = fullscreenAuxPanel.panel}
								<ReviewPanel
									panelId={reviewPanel.id}
									projectPath={reviewPanel.projectPath}
									modifiedFilesState={reviewPanel.modifiedFilesState}
									selectedFileIndex={reviewPanel.selectedFileIndex}
									width={reviewPanel.width}
									isFullscreenEmbedded={true}
									onClose={() => panelStore.closeReviewPanel(reviewPanel.id)}
									onResize={(panelId, delta) => panelStore.resizeReviewPanel(panelId, delta)}
									onSelectFile={(index) =>
										panelStore.updateReviewPanelFileIndex(reviewPanel.id, index)}
								/>
							{:else if fullscreenAuxPanel.kind === "terminal"}
								{@const terminalPanel = fullscreenAuxPanel.panel}
								{@const terminalProject = projectManager.projects.find(
									(p) => p.path === terminalPanel.projectPath
								)}
								<TerminalPanel
									panelId={terminalPanel.id}
									projectPath={terminalPanel.projectPath}
									projectName={terminalProject?.name ?? m.project_unknown()}
									projectColor={terminalProject?.color}
									width={terminalPanel.width}
									isFullscreenEmbedded={true}
									shell={terminalPanel.shell}
									hideProjectBadge={true}
									isAuxFullscreen={true}
									onEnterFullscreen={() => panelStore.enterTerminalFullscreen(terminalPanel.id)}
									onExitFullscreen={() => panelStore.exitFullscreen()}
									onClose={() => panelStore.closeTerminalPanel(terminalPanel.id)}
									onResize={(panelId, delta) => panelStore.resizeTerminalPanel(panelId, delta)}
									onPtyCreated={(ptyId, shell) =>
										panelStore.updateTerminalPtyId(terminalPanel.id, ptyId, shell)}
								/>
							{:else}
								{@const browserPanel = fullscreenAuxPanel.panel}
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
						</div>
					{/if}

					<div class="relative h-full min-h-0 min-w-0 flex-1">
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
							hideProjectBadge={!viewModeState.isSingleMode}
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
						/>
					</div>
				</div>
			{/snippet}

			{#if project && !viewModeState.isSingleMode}
				<ProjectCard
					projectName={project.name}
					projectColor={project.color}
					variant="corner"
					class="flex-1 min-w-0 min-h-0"
				>
					{@render fullscreenInner()}
				</ProjectCard>
			{:else}
				{@render fullscreenInner()}
			{/if}
		{:else}
			<!-- Project/Multi mode: panels grouped by project; hide inactive in focused view so they stay mounted -->
		{#each allGroups as group (group.projectPath)}
			{@const hasAgentPanels = group.agentPanels.length > 0}
			<ProjectCard
				class="{panelStore.fullscreenAuxOnly || !hasAgentPanels
					? 'flex-1 min-w-0 min-h-0'
					: 'flex-none min-h-0'} {isGroupHidden(group) ? 'hidden' : ''}"
					projectName={group.projectName}
					projectColor={group.projectColor}
					variant="corner"
					allProjects={viewModeState.focusedModeAllProjects
						? [...viewModeState.focusedModeAllProjects]
						: undefined}
					activeProjectPath={viewModeState.activeProjectPath}
					onSelectProject={(path) => panelStore.setFocusedViewProjectPath(path)}
				>
					{#if !panelStore.fullscreenAuxOnly}
						<!-- File panels -->
						{#each group.filePanels as filePanel (filePanel.id)}
							{@const project = projectManager.projects.find(
								(p) => p.path === filePanel.projectPath
							)}
							<FilePanel
								panelId={filePanel.id}
								filePath={filePanel.filePath}
								projectPath={filePanel.projectPath}
								projectName={project?.name ?? m.project_unknown()}
								projectColor={project?.color}
								width={filePanel.width}
								hideProjectBadge={true}
								onClose={() => panelStore.closeFilePanel(filePanel.id)}
								onResize={(panelId, delta) => panelStore.resizeFilePanel(panelId, delta)}
							/>
						{/each}

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
								onSelectFile={(index) =>
									panelStore.updateReviewPanelFileIndex(reviewPanel.id, index)}
							/>
						{/each}
					{/if}

					<!-- Terminal panels (always use TerminalTabs for tab support in header) -->
					{#if group.terminalPanels.length > 0}
						<TerminalTabs
							terminals={group.terminalPanels}
							projectPath={group.projectPath}
							projectName={group.projectName}
							projectColor={group.projectColor}
							{panelStore}
							{fullscreenAuxPanel}
						/>
					{/if}

					<!-- Browser panels (project-scoped) -->
					{#if !panelStore.fullscreenAuxOnly}
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

					{#if !panelStore.fullscreenAuxOnly}
						<!-- Agent panels -->
						{#each group.agentPanels as panel (panel.id)}
							{@const effectiveTheme = themeState.effectiveTheme}
							{@const projectPath = panel.sessionProjectPath}
							{@const project = projectPath
								? (projectManager.projects.find((p) => p.path === projectPath) ?? null)
								: null}
							{@const availableAgents = agentPreferencesStore
								.getPanelSelectableAgents(agentStore.agents)
								.map((a) => ({
									id: a.id,
									name: a.name,
									icon: a.icon,
									available: a.available,
									availability_kind: a.availability_kind,
								}))}
							{@const selectedAgentId = panel.selectedAgentId
								? availableAgents.some((agent) => agent.id === panel.selectedAgentId)
									? panel.selectedAgentId
									: null
								: null}
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
								hideProjectBadge={true}
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
							/>
						{/each}
					{/if}
				</ProjectCard>
			{/each}
		{/if}
	</div>

	{#if sourceControlPanelSnapshot.isOpen}
		{@const gitProject = projectManager.projects.find(
			(p) => p.path === sourceControlPanelSnapshot.projectPath
		)}
		<EmbeddedModalShell
			open={true}
			ariaLabel="Source control"
			panelClass="max-w-[1180px]"
			onClose={() => panelStore.closeGitPanel(sourceControlPanelSnapshot.id)}
		>
			<GitPanel
				panelId={sourceControlPanelSnapshot.id}
				projectPath={sourceControlPanelSnapshot.projectPath}
				projectName={gitProject?.name ?? m.project_unknown()}
				projectColor={gitProject?.color}
				width={sourceControlPanelSnapshot.width}
				initialTarget={sourceControlPanelSnapshot.initialTarget}
				isFullscreenEmbedded={true}
				hideProjectBadge={true}
				onClose={() => panelStore.closeGitPanel(sourceControlPanelSnapshot.id)}
				onResize={(panelId: string, delta: number) => panelStore.resizeGitPanel(panelId, delta)}
				onRequestGeneration={(prompt) => {
					// Find the active agent panel session for this project
					const agentPanel = panelsWithState.find(
						(p) =>
							p.sessionProjectPath === sourceControlPanelSnapshot.projectPath && p.sessionId
					);
					if (agentPanel?.sessionId) {
						sessionStore.sendMessage(agentPanel.sessionId, prompt);
					}
				}}
			/>
		</EmbeddedModalShell>
	{/if}
</div>
