<script lang="ts">
	import type { AgentPanelConversationModel } from "@acepe/agent-panel-contract";
	import AgentPanelSceneEntry from "./agent-panel-scene-entry.svelte";

	interface Props {
		conversation: AgentPanelConversationModel;
		iconBasePath?: string;
	}

	let { conversation, iconBasePath = "" }: Props = $props();

</script>

<div class="flex-1 min-h-0 overflow-y-auto bg-accent/20 py-2">
	{#each conversation.entries as entry (entry.id)}
		<div class="px-3 py-1.5">
			<AgentPanelSceneEntry {entry} {iconBasePath} />
		</div>
	{/each}
</div>
