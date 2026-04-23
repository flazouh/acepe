<script lang="ts">
	import type { AgentPanelConversationModel } from "../agent-panel/types.js";
	import AgentPanelSceneEntry from "./agent-panel-scene-entry.svelte";

	interface Props {
		conversation: AgentPanelConversationModel;
		iconBasePath?: string;
	}

	let { conversation, iconBasePath = "" }: Props = $props();

</script>

<div class="flex-1 min-h-0 overflow-y-auto py-2">
	{#each conversation.entries as entry (entry.id)}
		<div class="px-3 py-1.5">
			<AgentPanelSceneEntry {entry} {iconBasePath} />
		</div>
	{/each}
</div>
