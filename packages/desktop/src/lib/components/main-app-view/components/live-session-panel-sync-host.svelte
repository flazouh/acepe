<script lang="ts">
/**
 * Host for live-session panel materialization.
 * Previously lived inside AppQueueRow (attention queue); kept after that panel was removed.
 */
import { getInteractionStore, getPanelStore, getSessionStore } from "$lib/acp/store/index.js";
import { DEFAULT_PANEL_WIDTH } from "$lib/acp/store/types.js";

import type { MainAppViewState } from "../logic/main-app-view-state.svelte.js";
import {
	syncLiveSessionPanels,
	type LiveSessionPanelSyncInput,
} from "../logic/live-session-panel-sync.js";

interface Props {
	state: MainAppViewState;
}

let { state: appState }: Props = $props();

const panelStore = getPanelStore();
const interactionStore = getInteractionStore();
const sessionStore = getSessionStore();

const liveSessionSyncInputs = $derived.by((): LiveSessionPanelSyncInput[] => {
	const inputs: LiveSessionPanelSyncInput[] = [];

	for (const session of sessionStore.read.getLiveSessionSyncReferences()) {
		inputs.push(sessionStore.presentation.getLiveSessionPanelSyncInput(session, interactionStore));
	}

	return inputs;
});

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
});
</script>
