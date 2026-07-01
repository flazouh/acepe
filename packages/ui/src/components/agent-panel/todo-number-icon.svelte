<script lang="ts">
	import { RoundedIcon } from "../icons/index.js";

	import type { AgentTodoStatus } from "./types.js";

	interface Props {
		/** 0-based index of the todo item */
		index: number;
		status: AgentTodoStatus;
		/** Whether the session is currently live/streaming */
		isLive?: boolean;
		size?: number;
		class?: string;
	}

	let { index, status, isLive = false, size = 12, class: className = "" }: Props = $props();

	const hasNumberLabel = $derived(index >= 0 && index < 9);
	const numberLabel = $derived(String(index + 1));
	const numberFontSize = $derived(Math.max(8, Math.round(size * 0.58)));
</script>

{#if status === "completed"}
	<RoundedIcon name="check-circle" class="text-success {className}" style="width: {size}px; height: {size}px;" />
{:else if status === "cancelled"}
	<RoundedIcon name="x-circle" class="text-muted-foreground {className}" style="width: {size}px; height: {size}px;" />
{:else if status === "in_progress" && isLive}
	<RoundedIcon name="spinner" class="animate-spin text-foreground {className}" style="width: {size}px; height: {size}px;" />
{:else if hasNumberLabel}
	<span
		class="inline-flex shrink-0 items-center justify-center rounded-full border border-current font-semibold leading-none text-muted-foreground {className}"
		style="width: {size}px; height: {size}px; font-size: {numberFontSize}px;"
		data-testid="todo-number-css-icon"
	>
		{numberLabel}
	</span>
{:else}
	<RoundedIcon name="unselected" class="text-muted-foreground {className}" style="width: {size}px; height: {size}px;" />
{/if}
