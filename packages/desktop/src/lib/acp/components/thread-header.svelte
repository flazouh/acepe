<script lang="ts">
import IconTrash from "@tabler/icons-svelte/icons/trash";
import IconX from "@tabler/icons-svelte/icons/x";
import { Badge } from "$lib/components/ui/badge/index.js";
import { Button } from "$lib/components/ui/button/index.js";
import type { ThreadState } from "../types/thread-state.js";
import type { ThreadStatus } from "../types/thread-status.js";

let {
	thread,
	onCancel,
	onDelete,
}: {
	thread: ThreadState | null;
	onCancel?: () => void | Promise<void>;
	onDelete?: () => void | Promise<void>;
} = $props();

const statusColor = (status: ThreadStatus) => {
	switch (status) {
		case "idle":
			return "secondary";
		case "loading":
		case "sending":
		case "waiting":
		case "streaming":
			return "default";
		case "completed":
			return "default";
		case "error":
			return "destructive";
		default:
			return "secondary";
	}
};
</script>

{#if thread}
	<div class="flex items-center justify-between p-4 border-b">
		<div class="flex items-center gap-3">
			<h2 class="text-lg font-semibold">{thread.title}</h2>
			<Badge variant={statusColor(thread.status)}>{thread.status}</Badge>
			{#if thread.error}
				<span class="text-sm text-destructive">{thread.error}</span>
			{/if}
		</div>
		<div class="flex items-center gap-2">
			{#if onCancel && (thread.status === "streaming" || thread.status === "sending")}
				<Button variant="outline" size="icon" onclick={onCancel}>
					<IconX class="h-4 w-4" />
				</Button>
			{/if}
			{#if onDelete}
				<Button variant="outline" size="icon" onclick={onDelete}>
					<IconTrash class="h-4 w-4" />
				</Button>
			{/if}
		</div>
	</div>
{/if}
