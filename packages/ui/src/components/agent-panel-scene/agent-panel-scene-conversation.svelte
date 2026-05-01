<script lang="ts">
	import type { AgentPanelConversationModel } from "../agent-panel/types.js";
	import type { EditToolTheme } from "../agent-panel/agent-panel-conversation-entry.svelte";
	import AgentPanelSceneEntry from "./agent-panel-scene-entry.svelte";

	interface Props {
		conversation: AgentPanelConversationModel;
		iconBasePath?: string;
		editToolTheme?: EditToolTheme;
	}

	let { conversation, iconBasePath = "", editToolTheme }: Props = $props();

</script>

<div class="flex-1 min-h-0 overflow-y-auto py-2">
	{#each conversation.entries as entry (entry.id)}
		<div class="px-3 py-1.5">
			<AgentPanelSceneEntry {entry} {iconBasePath} {editToolTheme} />
		</div>
	{/each}
</div>
