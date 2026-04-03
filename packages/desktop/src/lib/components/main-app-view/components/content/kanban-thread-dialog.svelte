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
		projectManager: ProjectManager;
		state: MainAppViewState;
		onClose: () => void;
	}

	let { panelId, projectManager, state, onClose }: Props = $props();

	const panelStore = getPanelStore();
	const sessionStore = getSessionStore();
	const agentStore = getAgentStore();
	const agentPreferencesStore = getAgentPreferencesStore();
	const themeState = useTheme();

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
			panelId === null ? null : (panelStore.panels.find((candidate) => candidate.id === panelId) ?? null);
		const hotState = panel ? panelStore.getHotState(panel.id) : null;
		const identity = panel && panel.sessionId !== null ? sessionStore.getSessionIdentity(panel.sessionId) : null;
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
			onClose();
		}
	}
</script>

<Dialog.Root open={isPanelOpen} onOpenChange={handleOpenChange}>
	<Dialog.Content
		class="flex h-[90vh] w-fit max-w-[96vw] items-center justify-center overflow-visible border-0 bg-transparent p-0 shadow-none"
		portalProps={{ disabled: true }}
		showCloseButton={false}
	>
		{#if isPanelOpen}
			<AgentPanel
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
				onAgentChange={(agentId) => state.handlePanelAgentChange(panelSnapshot.panelId, agentId)}
				effectiveTheme={themeState.effectiveTheme}
				isFullscreen={false}
				isFocused={panelStore.focusedPanelId === panelSnapshot.panelId}
				onClose={() => {
					onClose();
				}}
				onCreateSessionForProject={(project) =>
					state.handleCreateSessionForProject(panelSnapshot.panelId, project).mapErr(() => {
						// Error handling is done in the handler
					})}
				onSessionCreated={(sessionId) => panelStore.updatePanelSession(panelSnapshot.panelId, sessionId)}
				onResizePanel={(currentPanelId, delta) => state.handleResizePanel(currentPanelId, delta)}
				onToggleFullscreen={() => {
					onClose();
					state.handleToggleFullscreen(panelSnapshot.panelId);
				}}
				onFocus={() => state.handleFocusPanel(panelSnapshot.panelId)}
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
						onClose();
						state.openReviewFullscreen(sessionId, fileIndex);
					}
					: undefined}
				attachedFilePanels={panelStore.getAttachedFilePanels(panelSnapshot.panelId)}
				activeAttachedFilePanelId={panelStore.getActiveFilePanelId(panelSnapshot.panelId)}
				onSelectAttachedFilePanel={(ownerPanelId, filePanelId) =>
					panelStore.setActiveAttachedFilePanel(ownerPanelId, filePanelId)}
				onCloseAttachedFilePanel={(filePanelId) => panelStore.closeFilePanel(filePanelId)}
				onResizeAttachedFilePanel={(filePanelId, delta) =>
					panelStore.resizeFilePanel(filePanelId, delta)}
				onCreateIssueReport={(draft) => state.openUserReportsWithDraft(draft)}
			/>
		{/if}
	</Dialog.Content>
</Dialog.Root>