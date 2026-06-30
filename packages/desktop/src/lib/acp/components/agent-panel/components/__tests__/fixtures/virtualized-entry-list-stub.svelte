<script lang="ts">
import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel";
import type { TranscriptRowsState } from "../../../../../store/transcript-rows-store.js";
import type { TurnState } from "../../../../../store/types.js";

let { sessionId = null, sceneEntries = [], rowsProjection = null, turnState = "idle" } = $props<{
	sessionId?: string | null;
	sceneEntries?: readonly AgentPanelSceneEntryModel[];
	rowsProjection?: TranscriptRowsState | null;
	turnState?: TurnState;
}>();
</script>

<div
	data-testid="virtualized-entry-list-stub"
	data-session-id={sessionId}
	data-row-count={rowsProjection?.rows.length ?? 0}
	data-turn-state={turnState}
>
	{#each sceneEntries as entry (entry.id)}
		{#if entry.type === "assistant"}
			<div data-testid="virtualized-entry-list-stub-assistant">{entry.markdown}</div>
		{/if}
	{/each}
</div>
