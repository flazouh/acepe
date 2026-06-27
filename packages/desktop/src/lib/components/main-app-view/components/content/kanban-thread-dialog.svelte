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
import DialogFrame from "$lib/components/ui/dialog-frame.svelte";

import type { MainAppViewState } from "../../logic/main-app-view-state.svelte.js";
import { getSpawnableSessionAgents } from "../../logic/spawnable-agents.js";
import {
	buildKanbanThreadDialogPanelSnapshot,
	resolveKanbanThreadDialogSelectedAgentId,
} from "./logic/kanban-thread-dialog-model.js";

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

let {
	panelId,
	mode,
	projectManager,
	mainAppState,
	onFocusPanel,
	onToggleFullscreenPanel,
	onDismiss,
	onClosePanel,
}: Props = $props();

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
			: (panelStore.getTopLevelAgentPanel(panelId) ?? null);
	const hotState = panel ? panelStore.getHotState(panel.id) : null;
	const identity =
		panel && panel.sessionId !== null ? sessionStore.read.getSessionIdentity(panel.sessionId) : undefined;

	return buildKanbanThreadDialogPanelSnapshot({
		panel,
		sessionIdentity: identity,
		hotState,
		getProject: (projectPath) => projectManager.getProject(projectPath),
	});
});

const isPanelOpen = $derived(panelId !== null && panelSnapshot.panelId !== "");

const selectedAgentId = $derived(
	resolveKanbanThreadDialogSelectedAgentId({
		configuredAgentId: panelSnapshot.selectedAgentId,
		availableAgents,
	})
);

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

<DialogFrame
	open={isPanelOpen}
	title="Kanban thread"
	closeLabel="Close kanban thread"
	size="bare"
	hideHeader={true}
	portalDisabled={true}
	contentClass="!flex items-center justify-center overflow-visible !border-0 !bg-transparent !p-0 !shadow-none"
	onOpenChange={handleOpenChange}
	onOpenAutoFocus={handleDialogOpenAutoFocus}
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
				onCreateIssueReport={(draft) => mainAppState.openUserReportsWithDraft(draft)}
				hasAttachedFilePane={panelStore.hasAttachedFilePanels(panelSnapshot.panelId)}
		/>
	{/if}
</DialogFrame>
