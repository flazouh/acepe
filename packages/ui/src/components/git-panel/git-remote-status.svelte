<script lang="ts">
	/**
	 * GitRemoteStatus — Ahead/behind indicator pill.
	 */
	import ArrowUp from "phosphor-svelte/lib/ArrowUp";
	import ArrowDown from "phosphor-svelte/lib/ArrowDown";

	import { cn } from "../../lib/utils.js";
	import type { GitRemoteStatus } from "./types.js";

	interface Props {
		status: GitRemoteStatus | null;
		class?: string;
	}

	let { status, class: className }: Props = $props();

	const hasChanges = $derived(status !== null && (status.ahead > 0 || status.behind > 0));
</script>

{#if hasChanges && status}
	<span
		class={cn(
			"inline-flex items-center gap-1 rounded-full bg-muted/40 px-2 py-0.5 text-[0.625rem] font-mono font-medium text-muted-foreground",
			className,
		)}
	>
		{#if status.ahead > 0}
			<span class="inline-flex items-center gap-0.5">
				<ArrowUp size={10} weight="bold" />
				{status.ahead}
			</span>
		{/if}
		{#if status.behind > 0}
			<span class="inline-flex items-center gap-0.5">
				<ArrowDown size={10} weight="bold" />
				{status.behind}
			</span>
		{/if}
	</span>
{/if}
