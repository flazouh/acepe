<script lang="ts">
	import type {
		AgentPanelConversationEntry as AgentPanelConversationEntryModel,
		AgentTaskDetailPresentation,
		AgentTaskDetailRow,
	} from "../../types.js";
	import AgentPanelConversationEntry from "../../agent-panel-conversation-entry.svelte";

	interface Props {
		entry: AgentPanelConversationEntryModel;
		taskDetail: AgentTaskDetailPresentation;
		onTaskDetailOpenChange: (open: boolean) => void;
		onTaskDetailLoadMore: () => void;
	}

	let {
		entry,
		taskDetail,
		onTaskDetailOpenChange,
		onTaskDetailLoadMore,
	}: Props = $props();
</script>

{#snippet renderTaskDetailRow(row: AgentTaskDetailRow, _rowIndex: number)}
	<div data-testid="supplied-task-detail-row-renderer" data-rendered-row-id={row.rowId}>
		{#if row.entry.type === "assistant"}
			{row.entry.markdown}
		{:else if row.entry.type === "thinking"}
			{row.entry.label}
		{:else if row.entry.type === "tool_call"}
			{row.entry.title}
		{:else}
			Supplied renderer: {row.entry.type}
		{/if}
	</div>
{/snippet}

<AgentPanelConversationEntry
	{entry}
	taskDetail={{
		presentation: taskDetail,
		renderRow: renderTaskDetailRow,
		onOpenChange: onTaskDetailOpenChange,
		onLoadMore: onTaskDetailLoadMore,
	}}
/>
