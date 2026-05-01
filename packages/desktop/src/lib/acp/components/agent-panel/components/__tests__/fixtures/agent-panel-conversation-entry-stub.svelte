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

<div data-testid="agent-panel-conversation-entry-stub" data-entry-type={entry.type}>
	{entry.type}
</div>
