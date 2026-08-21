<script lang="ts">
import type { RpcSessionSnapshot } from "@acepe/contracts";
import {
	AgentPanelConversationEntry,
	AgentSessionActivityEntryView,
	AgentToolRow,
} from "@acepe/ui/agent-panel";
import {
	conversationFromSnapshot,
	type AgentPanelActivityProjection,
} from "./agent-panel-conversation.ts";

interface Props {
	snapshot: RpcSessionSnapshot;
	activities?: ReadonlyArray<AgentPanelActivityProjection>;
}

let { snapshot, activities }: Props = $props();

const conversation = $derived.by(() => {
	if (activities === undefined) {
		return conversationFromSnapshot({ snapshot });
	}
	return conversationFromSnapshot({ snapshot, activities });
});
</script>

<div class="flex min-h-0 flex-1 flex-col" data-testid="agent-panel">
	{#each conversation.rows as row (row.eachKey)}
		<div class="px-3 py-1.5" data-testid="agent-panel-row" data-each-key={row.eachKey}>
			{#if row.entry.type === "session_activity"}
				<AgentSessionActivityEntryView
					title={row.entry.title}
					status={row.entry.status}
					subtitle={row.entry.subtitle ?? null}
					contextUsage={row.entry.contextUsage ?? null}
					metadata={row.entry.metadata ?? []}
				/>
			{:else if row.entry.type === "tool_call"}
				<AgentToolRow
					title={row.entry.title}
					filePath={row.entry.filePath ?? ""}
					status={row.entry.status}
					kind={row.entry.kind ?? "unclassified"}
				/>
			{:else}
				<AgentPanelConversationEntry entry={row.entry} />
			{/if}
		</div>
	{/each}
</div>
