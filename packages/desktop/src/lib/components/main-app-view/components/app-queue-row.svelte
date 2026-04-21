<script lang="ts">
import { QueueSection } from "$lib/acp/components/index.js";
import type { ProjectManager } from "$lib/acp/logic/project-manager.svelte.js";
import type { QueueUpdateInput } from "$lib/acp/store/index.js";
import {
	getInteractionStore,
	getPanelStore,
	getQueueStore,
	getSessionStore,
	getUnseenStore,
} from "$lib/acp/store/index.js";
import { getPrimaryQuestionText } from "$lib/acp/store/question-selectors.js";
import { buildSessionOperationInteractionSnapshot } from "$lib/acp/store/operation-association.js";
import type { QueueItem } from "$lib/acp/store/queue/types.js";
import { buildQueueSessionSnapshot } from "$lib/acp/store/queue/utils.js";
import { DEFAULT_PANEL_WIDTH } from "$lib/acp/store/types.js";
import { SvelteMap } from "svelte/reactivity";

import type { MainAppViewState } from "../logic/main-app-view-state.svelte.js";
import { applyCompletionAttentionAction } from "../logic/completion-acknowledgement.js";
import {
	syncLiveSessionPanels,
	type LiveSessionPanelSyncInput,
} from "../logic/live-session-panel-sync.js";

interface Props {
	projectManager: ProjectManager;
	state: MainAppViewState;
}

let { projectManager, state: appState }: Props = $props();

const panelStore = getPanelStore();
const interactionStore = getInteractionStore();
const sessionStore = getSessionStore();
const unseenStore = getUnseenStore();
const queueStore = getQueueStore();
const operationStore = sessionStore.getOperationStore();

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

	for (const [sessionId, panelId] of sessionToPanelMap) {
		const identity = sessionStore.getSessionIdentity(sessionId);
		const metadata = sessionStore.getSessionMetadata(sessionId);
		if (!identity || !metadata) continue;

		const runtimeState = sessionStore.getSessionRuntimeState(sessionId);
		const hotState = sessionStore.getHotState(sessionId);
		const interactionSnapshot = buildSessionOperationInteractionSnapshot(
			identity.id,
			operationStore,
			interactionStore
		);
		const session = buildQueueSessionSnapshot({
			id: identity.id,
			agentId: identity.agentId,
			projectPath: identity.projectPath,
			title: metadata.title,
			entries: sessionStore.getEntries(sessionId),
			currentStreamingToolCall: operationStore.getCurrentStreamingToolCall(sessionId),
			currentToolKind: operationStore.getCurrentToolKind(sessionId),
			lastToolCall: operationStore.getLastToolCall(sessionId),
			lastTodoToolCall: operationStore.getLastTodoToolCall(sessionId),
			updatedAt: metadata.updatedAt,
			runtimeState,
			hotState,
			interactionSnapshot,
			hasUnseenCompletion: unseenStore.isUnseen(panelId),
		});
		const pendingQuestion = interactionSnapshot.pendingQuestion;
		const hasPendingQuestion = pendingQuestion !== null;
		const pendingQuestionText = getPrimaryQuestionText(pendingQuestion);
		const pendingPlanApproval = interactionSnapshot.pendingPlanApproval;
		const pendingPermission = interactionSnapshot.pendingPermission;
		const hasPendingPermission = pendingPermission !== null;

		inputs.push({
			session,
			hasPendingQuestion,
			hasPendingPermission,
			hasUnseenCompletion: session.state.attention.hasUnseenCompletion,
			pendingQuestionText,
			pendingQuestion,
			pendingPlanApproval,
			pendingPermission,
		});
	}
	return inputs;
});

const liveSessionSyncInputs = $derived.by((): LiveSessionPanelSyncInput[] => {
	const inputs: LiveSessionPanelSyncInput[] = [];

	for (const session of sessionStore.sessions) {
		const runtimeState = sessionStore.getSessionRuntimeState(session.id);
		const interactionSnapshot = buildSessionOperationInteractionSnapshot(
			session.id,
			operationStore,
			interactionStore
		);
		const pendingQuestion = interactionSnapshot.pendingQuestion;
		const pendingPlanApproval = interactionSnapshot.pendingPlanApproval;
		const pendingPermission = interactionSnapshot.pendingPermission;

		inputs.push({
			sessionId: session.id,
			updatedAtMs: session.updatedAt.getTime(),
			connectionPhase: runtimeState ? runtimeState.connectionPhase : null,
			activityPhase: runtimeState ? runtimeState.activityPhase : null,
			pendingQuestionId: pendingQuestion ? pendingQuestion.id : null,
			pendingPlanApprovalId: pendingPlanApproval ? pendingPlanApproval.id : null,
			pendingPermissionId: pendingPermission ? pendingPermission.id : null,
		});
	}

	return inputs;
});

function getProjectColor(projectPath: string): string | null {
	const project = projectManager.projects.find((candidate) => candidate.path === projectPath);
	return project?.color ?? null;
}

function getProjectIconSrc(projectPath: string): string | null {
	const project = projectManager.projects.find((candidate) => candidate.path === projectPath);
	return project?.iconPath ?? null;
}

$effect(() => {
	if (!appState.initializationComplete) return;

	syncLiveSessionPanels(
		liveSessionSyncInputs,
		{
			hasPanel(sessionId: string): boolean {
				return panelStore.isSessionOpen(sessionId);
			},
			syncSuppression(sessionId: string, signal: string): boolean {
				return panelStore.syncAutoSessionSuppression(sessionId, signal);
			},
			materialize(sessionId: string, width: number): void {
				panelStore.materializeSessionPanel(sessionId, width);
			},
		},
		DEFAULT_PANEL_WIDTH
	);

	queueStore.setProjectIconSrcLookup(getProjectIconSrc);
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
	applyCompletionAttentionAction(unseenStore, item.panelId, { kind: "explicit-reveal" });
}
</script>

<div class="min-h-0 shrink-0 overflow-hidden">
	<QueueSection
		sections={queueStore.sections}
		totalCount={queueStore.totalCount}
		selectedSessionId={panelStore.focusedPanel?.sessionId}
		onSelectItem={handleQueueItemSelect}
		expanded={appState.queueExpanded}
		onExpandedChange={(expanded) => appState.handleQueueExpandedChange(expanded)}
	/>
</div>
