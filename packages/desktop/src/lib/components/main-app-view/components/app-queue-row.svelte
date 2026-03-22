<script lang="ts">
import type { SessionStatus } from "$lib/acp/application/dto/session-status.js";
import { QueueSection } from "$lib/acp/components/index.js";
import type { ProjectManager } from "$lib/acp/logic/project-manager.svelte.js";
import type { QueueUpdateInput } from "$lib/acp/store/index.js";
import {
	getPanelStore,
	getPermissionStore,
	getQuestionStore,
	getQueueStore,
	getSessionStore,
	getUnseenStore,
} from "$lib/acp/store/index.js";
import {
	getPrimaryQuestionText,
	groupPendingQuestionsBySession,
} from "$lib/acp/store/question-selectors.js";
import type { QueueItem } from "$lib/acp/store/queue/types.js";
import type { QueueSessionSnapshot } from "$lib/acp/store/queue/utils.js";
import { SvelteMap } from "svelte/reactivity";

import type { MainAppViewState } from "../logic/main-app-view-state.svelte.js";

interface Props {
	projectManager: ProjectManager;
	state: MainAppViewState;
	collapsed?: boolean;
}

let { projectManager, state: appState, collapsed = false }: Props = $props();

const panelStore = getPanelStore();
const sessionStore = getSessionStore();
const questionStore = getQuestionStore();
const permissionStore = getPermissionStore();
const unseenStore = getUnseenStore();
const queueStore = getQueueStore();

const sessionToPanelMap = $derived.by(() => {
	const map = new SvelteMap<string, string>();
	for (const panel of panelStore.panels) {
		if (panel.sessionId) {
			map.set(panel.sessionId, panel.id);
		}
	}
	return map;
});

const queueInputs = $derived.by(() => {
	const inputs: QueueUpdateInput[] = [];
	const pendingQuestionsBySession = groupPendingQuestionsBySession(questionStore.pending.values());

	const pendingPermissionsBySession = new SvelteMap<
		string,
		typeof permissionStore.pending extends Map<string, infer V> ? V : never
	>();
	for (const permission of permissionStore.pending.values()) {
		if (!pendingPermissionsBySession.has(permission.sessionId)) {
			pendingPermissionsBySession.set(permission.sessionId, permission);
		}
	}

	for (const [sessionId, panelId] of sessionToPanelMap) {
		const identity = sessionStore.getSessionIdentity(sessionId);
		const metadata = sessionStore.getSessionMetadata(sessionId);
		if (!identity || !metadata) continue;

		const runtimeState = sessionStore.getSessionRuntimeState(sessionId);
		const hotState = sessionStore.getHotState(sessionId);
		const derivedStatus: SessionStatus = !runtimeState
			? "idle"
			: runtimeState.connectionPhase === "failed"
				? "error"
				: runtimeState.connectionPhase === "connecting"
					? "connecting"
					: runtimeState.connectionPhase === "disconnected"
						? "idle"
						: runtimeState.activityPhase === "running"
							? "streaming"
							: "ready";
		const session: QueueSessionSnapshot = {
			id: identity.id,
			agentId: identity.agentId,
			projectPath: identity.projectPath,
			title: metadata.title,
			entries: sessionStore.getEntries(sessionId),
			isStreaming: runtimeState?.activityPhase === "running",
			isThinking: runtimeState?.showThinking ?? false,
			status: derivedStatus,
			updatedAt: metadata.updatedAt,
			currentModeId: hotState?.currentMode?.id ?? null,
			connectionError: hotState?.connectionError ?? null,
		};

		const pendingQuestions = pendingQuestionsBySession.get(session.id) ?? [];
		const hasPendingQuestion = pendingQuestions.length > 0;
		const pendingQuestion = hasPendingQuestion ? pendingQuestions[0] : null;
		const pendingQuestionText = getPrimaryQuestionText(pendingQuestion);

		const pendingPermission = pendingPermissionsBySession.get(session.id) ?? null;
		const hasPendingPermission = pendingPermission !== null;
		const hasUnseenCompletion = unseenStore.isUnseen(panelId);

		inputs.push({
			session,
			hasPendingQuestion,
			hasPendingPermission,
			hasUnseenCompletion,
			pendingQuestionText,
			pendingQuestion,
			pendingPermission,
		});
	}
	return inputs;
});

function getProjectColor(projectPath: string): string | null {
	const project = projectManager.projects.find((p) => p.path === projectPath);
	return project?.color ?? null;
}

$effect(() => {
	if (!appState.initializationComplete) return;
	queueStore.updateFromSessions(queueInputs, sessionToPanelMap, getProjectColor);
});

function handleQueueItemSelect(item: QueueItem) {
	if (!item.panelId) {
		return;
	}
	if (panelStore.viewMode !== "multi" && item.projectPath) {
		panelStore.setFocusedViewProjectPath(item.projectPath);
	}
	panelStore.movePanelToFront(item.panelId);
	panelStore.focusAndSwitchToPanel(item.panelId);
}
</script>

<div class="min-h-0 shrink-0 overflow-hidden">
	<QueueSection
		sections={queueStore.sections}
		totalCount={queueStore.totalCount}
		selectedSessionId={panelStore.focusedPanel?.sessionId}
		onSelectItem={handleQueueItemSelect}
		{collapsed}
		expanded={appState.queueExpanded}
		onExpandedChange={(expanded) => appState.handleQueueExpandedChange(expanded)}
		onActivateCollapsed={() => {
			appState.setSidebarOpen(true);
			appState.handleQueueExpandedChange(true);
		}}
	/>
</div>
