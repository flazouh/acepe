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
import type { QueueItem } from "$lib/acp/store/queue/types.js";
import { DEFAULT_PANEL_WIDTH } from "$lib/acp/store/types.js";
import { SvelteMap } from "svelte/reactivity";

import type { MainAppViewState } from "../logic/main-app-view-state.svelte.js";
import { applyCompletionAttentionAction } from "../logic/completion-acknowledgement.js";
import { resolveQueueUpdateInputs } from "../logic/app-queue-row-update.js";
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
		const identity = sessionStore.read.getSessionIdentity(sessionId);
		const metadata = sessionStore.read.getSessionMetadata(sessionId);
		if (!identity || !metadata) continue;

		inputs.push(
			sessionStore.presentation.getSessionQueuePresentation({
				sessionId: identity.id,
				agentId: identity.agentId,
				projectPath: identity.projectPath,
				title: metadata.title,
				updatedAt: metadata.updatedAt,
				interactionStore,
				hasUnseenCompletion: unseenStore.isUnseen(panelId),
			})
		);
	}
	return inputs;
});

const liveSessionSyncInputs = $derived.by((): LiveSessionPanelSyncInput[] => {
	const inputs: LiveSessionPanelSyncInput[] = [];

	for (const session of sessionStore.read.getLiveSessionSyncReferences()) {
		inputs.push(sessionStore.presentation.getLiveSessionPanelSyncInput(session, interactionStore));
	}

	return inputs;
});

function getProjectColor(projectPath: string): string | null {
	const project = projectManager.getProject(projectPath);
	return project?.color ?? null;
}

function getProjectIconSrc(projectPath: string): string | null {
	const project = projectManager.getProject(projectPath);
	return project?.iconPath ?? null;
}

function getProjectBadgeLabel(projectPath: string): string | null {
	return projectManager.getProjectBadgeLabel(projectPath) ?? null;
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
	queueStore.setProjectBadgeLabelLookup(getProjectBadgeLabel);
	queueStore.updateFromSessions(
		resolveQueueUpdateInputs(queueInputs),
		sessionToPanelMap,
		getProjectColor
	);
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
