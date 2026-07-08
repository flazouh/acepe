<script lang="ts">
	/**
	 * GitRemoteStatus — Ahead/behind indicator pill.
	 */
	import { cn } from "../../lib/utils.js";
	import { RoundedIcon } from "../icons/index.js";
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
				<RoundedIcon name="arrow-up" class="size-2.5" />
				{status.ahead}
			</span>
		{/if}
		{#if status.behind > 0}
			<span class="inline-flex items-center gap-0.5">
				<RoundedIcon name="arrow-up" class="size-2.5 rotate-180" />
				{status.behind}
			</span>
		{/if}
	</span>
{/if}
