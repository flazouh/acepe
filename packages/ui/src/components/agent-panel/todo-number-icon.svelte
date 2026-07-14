<script lang="ts">
	import { HugeiconsIcon } from "../icons/index.js";

	import type { AgentTodoStatus } from "./types.js";

	interface Props {
		status: AgentTodoStatus;
		/** Whether the session is currently live/streaming */
		isLive?: boolean;
		size?: number;
		class?: string;
	}

	let { status, isLive = false, size = 12, class: className = "" }: Props = $props();
</script>

{#if status === "completed"}
	<HugeiconsIcon name="check-circle-filled" class="text-success {className}" style="width: {size}px; height: {size}px;" />
{:else if status === "cancelled"}
	<HugeiconsIcon name="x-circle" class="text-muted-foreground {className}" style="width: {size}px; height: {size}px;" />
{:else if status === "in_progress" && isLive}
	<HugeiconsIcon name="spinner" class="animate-spin text-foreground {className}" style="width: {size}px; height: {size}px;" />
{:else}
	<HugeiconsIcon name="circle-dashed" class="text-muted-foreground {className}" style="width: {size}px; height: {size}px;" />
{/if}
