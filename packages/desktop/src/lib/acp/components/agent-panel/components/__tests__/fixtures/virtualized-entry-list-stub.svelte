<script lang="ts">
import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel";
import type { TurnState } from "../../../../../store/types.js";

let { sessionId = null, sceneEntries = [], turnState = "idle" } = $props<{
	sessionId?: string | null;
	sceneEntries?: readonly AgentPanelSceneEntryModel[];
	turnState?: TurnState;
}>();
</script>

<div
	data-testid="virtualized-entry-list-stub"
	data-session-id={sessionId}
	data-turn-state={turnState}
>
	{#each sceneEntries as entry (entry.id)}
		{#if entry.type === "assistant"}
			<div data-testid="virtualized-entry-list-stub-assistant">{entry.markdown}</div>
		{/if}
	{/each}
</div>
