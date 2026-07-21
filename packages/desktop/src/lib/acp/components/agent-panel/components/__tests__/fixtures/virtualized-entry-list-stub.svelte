<script lang="ts">
import type {
	AgentPanelPerformanceRecorder,
	AgentPanelSceneEntryModel,
} from "@acepe/ui/agent-panel";
import type { TranscriptRowsState } from "../../../../../store/transcript-rows-store.js";
import type { TurnState } from "../../../../../store/types.js";

let {
	sessionId = null,
	sceneEntries = [],
	rowsProjection = null,
	turnState = "idle",
	skipRowsBootstrap = false,
	profileRecorder,
} = $props<{
	sessionId?: string | null;
	sceneEntries?: readonly AgentPanelSceneEntryModel[];
	rowsProjection?: TranscriptRowsState | null;
	turnState?: TurnState;
	skipRowsBootstrap?: boolean;
	profileRecorder?: AgentPanelPerformanceRecorder;
}>();
</script>

<div
	data-testid="virtualized-entry-list-stub"
	data-session-id={sessionId}
	data-row-count={rowsProjection?.rows.length ?? 0}
	data-turn-state={turnState}
	data-skip-rows-bootstrap={skipRowsBootstrap}
	data-profile-recorder={profileRecorder === undefined ? "absent" : "present"}
>
	{#each sceneEntries as entry (entry.id)}
		{#if entry.type === "assistant"}
			<div data-testid="virtualized-entry-list-stub-assistant">{entry.markdown}</div>
		{/if}
	{/each}
</div>
