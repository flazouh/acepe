<script lang="ts">
import { AgentPanel } from "$lib/acp/components/index.js";
import type { ProjectManager } from "$lib/acp/logic/project-manager.svelte.js";
import {
	getAgentPreferencesStore,
	getAgentStore,
	getPanelStore,
	getSessionStore,
} from "$lib/acp/store/index.js";
import { useTheme } from "$lib/components/theme/context.svelte.js";
import * as Dialog from "$lib/components/ui/dialog/index.js";

import type { MainAppViewState } from "../../logic/main-app-view-state.svelte.js";
import { getSpawnableSessionAgents } from "../../logic/spawnable-agents.js";

interface Props {
	panelId: string | null;
	mode: KanbanThreadDialogMode;
	projectManager: ProjectManager;
	mainAppState: MainAppViewState;
	onFocusPanel?: (panelId: string) => void;
	onToggleFullscreenPanel?: (panelId: string) => void;
	onDismiss: () => void;
	onClosePanel: (panelId: string) => void;
}

export type KanbanThreadDialogMode = "inspect" | "close-panel";
export type KanbanThreadDialogHandle = {
	requestClosePanelConfirmation(): void;
};

let { panelId, mode, projectManager, mainAppState, onFocusPanel, onToggleFullscreenPanel, onDismiss, onClosePanel }: Props = $props();

const panelStore = getPanelStore();
const sessionStore = getSessionStore();
const agentStore = getAgentStore();
const agentPreferencesStore = getAgentPreferencesStore();
const themeState = useTheme();
const bypassWorktreeCloseConfirmation = $derived(mode === "inspect");
let agentPanelRef = $state<KanbanThreadDialogHandle | null>(null);

const availableAgents = $derived.by(() =>
	getSpawnableSessionAgents(agentStore.agents, agentPreferencesStore.selectedAgentIds).map(
		(agent) => ({
			id: agent.id,
			name: agent.name,
			icon: agent.icon,
			availability_kind: agent.availability_kind,
		})
	)
);

const panelSnapshot = $derived.by(() => {
	const panel =
		panelId === null
			? null
			: (panelStore.panels.find((candidate) => candidate.id === panelId) ?? null);
	const hotState = panel ? panelStore.getHotState(panel.id) : null;
	const identity =
		panel && panel.sessionId !== null ? sessionStore.getSessionIdentity(panel.sessionId) : null;
	const sessionProjectPath = identity ? identity.projectPath : panel ? panel.projectPath : null;
	const isWaitingForSession = panel ? panel.sessionId !== null && identity === undefined : false;

	let project = null;
	if (sessionProjectPath !== null) {
		const matchingProject = projectManager.projects.find(
			(candidate) => candidate.path === sessionProjectPath
		);
		project = matchingProject ? matchingProject : null;
	}

	return {
		panelId: panel ? panel.id : "",
		sessionId: panel ? panel.sessionId : null,
		width: panel && panel.width > 0 ? panel.width : 100,
		pendingProjectSelection: panel ? panel.pendingProjectSelection : false,
		selectedAgentId: panel ? panel.selectedAgentId : null,
		reviewMode: hotState ? hotState.reviewMode : false,
		reviewFilesState: hotState ? hotState.reviewFilesState : null,
		reviewFileIndex: hotState ? hotState.reviewFileIndex : 0,
		isWaitingForSession,
		project,
	};
});

const isPanelOpen = $derived(panelId !== null && panelSnapshot.panelId !== "");

const selectedAgentId = $derived.by(() => {
	const currentSelectedAgentId = panelSnapshot.selectedAgentId;
	if (currentSelectedAgentId === null) {
		return null;
	}

	const matchingAgent = availableAgents.find((agent) => agent.id === currentSelectedAgentId);
	return matchingAgent ? currentSelectedAgentId : null;
});

function handleOpenChange(open: boolean): void {
	if (!open) {
		onDismiss();
	}
}

function handlePanelClose(): void {
	if (mode === "close-panel" && panelSnapshot.panelId !== "") {
		onClosePanel(panelSnapshot.panelId);
		return;
	}

	onDismiss();
}

function handleDialogOpenAutoFocus(): void {
	if (mode !== "close-panel") {
		return;
	}

	requestAnimationFrame(() => {
		agentPanelRef?.requestClosePanelConfirmation();
	});
}
</script>

<Dialog.Root open={isPanelOpen} onOpenChange={handleOpenChange}>
	<Dialog.Content
		class="flex h-[90vh] w-fit max-w-[96vw] items-center justify-center overflow-visible border-0 bg-transparent p-0 shadow-none"
		onOpenAutoFocus={handleDialogOpenAutoFocus}
		portalProps={{ disabled: true }}
		showCloseButton={false}
	>
		{#if isPanelOpen}
			<AgentPanel
				bind:this={agentPanelRef}
				panelId={panelSnapshot.panelId}
				sessionId={panelSnapshot.sessionId}
				width={panelSnapshot.width}
				pendingProjectSelection={panelSnapshot.pendingProjectSelection}
				isWaitingForSession={panelSnapshot.isWaitingForSession}
				projectCount={projectManager.projectCount}
				allProjects={projectManager.projects}
				project={panelSnapshot.project}
				{selectedAgentId}
				{availableAgents}
				onAgentChange={(agentId) => mainAppState.handlePanelAgentChange(panelSnapshot.panelId, agentId)}
				effectiveTheme={themeState.effectiveTheme}
				isFullscreen={false}
				isFocused={panelStore.focusedPanelId === panelSnapshot.panelId}
				bypassWorktreeCloseConfirmation={bypassWorktreeCloseConfirmation}
				onClose={() => {
					handlePanelClose();
				}}
				onCreateSessionForProject={(project) =>
					mainAppState.handleCreateSessionForProject(panelSnapshot.panelId, project).mapErr(() => {
						// Error handling is done in the handler
					})}
				onSessionCreated={(sessionId) => panelStore.updatePanelSession(panelSnapshot.panelId, sessionId)}
				onResizePanel={(currentPanelId, delta) => mainAppState.handleResizePanel(currentPanelId, delta)}
				onToggleFullscreen={() => {
					onDismiss();
					if (onToggleFullscreenPanel) {
						onToggleFullscreenPanel(panelSnapshot.panelId);
						return;
					}
					mainAppState.handleToggleFullscreen(panelSnapshot.panelId);
				}}
				onFocus={() =>
					onFocusPanel
						? onFocusPanel(panelSnapshot.panelId)
						: mainAppState.handleFocusPanel(panelSnapshot.panelId)}
				hideProjectBadge={false}
				reviewMode={panelSnapshot.reviewMode}
				reviewFilesState={panelSnapshot.reviewFilesState}
				reviewFileIndex={panelSnapshot.reviewFileIndex}
				onEnterReviewMode={(modifiedFilesState, initialFileIndex) =>
					panelStore.enterReviewMode(panelSnapshot.panelId, modifiedFilesState, initialFileIndex)}
				onExitReviewMode={() => panelStore.exitReviewMode(panelSnapshot.panelId)}
				onReviewFileIndexChange={(index) => panelStore.setReviewFileIndex(panelSnapshot.panelId, index)}
				onOpenFullscreenReview={panelSnapshot.sessionId !== null
					? (sessionId, fileIndex) => {
						onDismiss();
						mainAppState.openReviewFullscreen(sessionId, fileIndex);
					}
					: undefined}
				attachedFilePanels={panelStore.getAttachedFilePanels(panelSnapshot.panelId)}
				activeAttachedFilePanelId={panelStore.getActiveFilePanelId(panelSnapshot.panelId)}
				onSelectAttachedFilePanel={(ownerPanelId, filePanelId) =>
					panelStore.setActiveAttachedFilePanel(ownerPanelId, filePanelId)}
				onCloseAttachedFilePanel={(filePanelId) => panelStore.closeFilePanel(filePanelId)}
				onResizeAttachedFilePanel={(filePanelId, delta) =>
					panelStore.resizeFilePanel(filePanelId, delta)}
				onCreateIssueReport={(draft) => mainAppState.openUserReportsWithDraft(draft)}
			/>
		{/if}
	</Dialog.Content>
</Dialog.Root>
