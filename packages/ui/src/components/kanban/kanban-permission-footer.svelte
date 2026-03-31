<script lang="ts">
	import type { KanbanPermissionData } from "./types.js";

	interface Props {
		permission: KanbanPermissionData;
		onApprove: () => void;
		onReject: () => void;
	}

	let { permission, onApprove, onReject }: Props = $props();

	function handleApprove(e: MouseEvent) {
		e.stopPropagation();
		onApprove();
	}

	function handleReject(e: MouseEvent) {
		e.stopPropagation();
		onReject();
	}
</script>

<div class="mt-1.5 border-t border-border/40 pt-1.5" data-testid="kanban-permission-footer">
	<div class="flex flex-col gap-1">
		<span class="truncate text-[10px] font-medium text-muted-foreground">{permission.label}</span>
		{#if permission.command}
			<code class="truncate rounded-sm bg-muted/50 px-1 py-0.5 text-[10px] text-muted-foreground">
				{permission.command}
			</code>
		{/if}
		{#if permission.filePath}
			<span class="truncate text-[10px] text-muted-foreground/70">{permission.filePath}</span>
		{/if}
		<div class="mt-0.5 flex gap-1">
			<button
				class="flex-1 rounded-sm bg-green-600/20 px-2 py-0.5 text-[10px] font-medium text-green-500 hover:bg-green-600/30 active:bg-green-600/40"
				onclick={handleApprove}
			>
				Approve
			</button>
			<button
				class="flex-1 rounded-sm bg-red-600/20 px-2 py-0.5 text-[10px] font-medium text-red-500 hover:bg-red-600/30 active:bg-red-600/40"
				onclick={handleReject}
			>
				Reject
			</button>
		</div>
	</div>
</div>