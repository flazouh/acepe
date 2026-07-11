<script lang="ts">
	import { RoundedIcon } from "../icons/index.js";

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
	<RoundedIcon name="check-circle-filled" class="text-success {className}" style="width: {size}px; height: {size}px;" />
{:else if status === "cancelled"}
	<RoundedIcon name="x-circle" class="text-muted-foreground {className}" style="width: {size}px; height: {size}px;" />
{:else if status === "in_progress" && isLive}
	<RoundedIcon name="spinner" class="animate-spin text-foreground {className}" style="width: {size}px; height: {size}px;" />
{:else}
	<RoundedIcon name="circle-dashed" class="text-muted-foreground {className}" style="width: {size}px; height: {size}px;" />
{/if}
