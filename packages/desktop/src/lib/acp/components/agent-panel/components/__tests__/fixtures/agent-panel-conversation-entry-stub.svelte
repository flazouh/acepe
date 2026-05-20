<script lang="ts">
import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel";
import { recordConversationEntry } from "./vlist-stub-state.js";

interface Props {
	entry: AgentPanelSceneEntryModel;
}

let { entry }: Props = $props();

$effect(() => {
	recordConversationEntry(entry);
});
</script>

{#if entry.type === "tool_call"}
	<div
		class="agent-tool-card"
		data-testid="agent-panel-conversation-entry-stub"
		data-entry-type={entry.type}
	>
		{entry.type}
	</div>
{:else}
	<div data-testid="agent-panel-conversation-entry-stub" data-entry-type={entry.type}>
		{entry.type}
	</div>
{/if}

<style>
	.agent-tool-card {
		border-bottom-width: 1px;
		border-bottom-style: solid;
		border-bottom-color: black;
		border-bottom-left-radius: 6px;
		border-bottom-right-radius: 6px;
	}
</style>
