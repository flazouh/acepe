<script lang="ts">
import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel";

let { sessionId = null, sceneEntries = [] } = $props<{
	sessionId?: string | null;
	sceneEntries?: readonly AgentPanelSceneEntryModel[];
}>();
</script>

<div
	data-testid="virtualized-entry-list-stub"
>
	{#each sceneEntries as entry (entry.id)}
		{#if entry.type === "assistant"}
			<div data-testid="virtualized-entry-list-stub-assistant">{entry.markdown}</div>
		{/if}
	{/each}
</div>
