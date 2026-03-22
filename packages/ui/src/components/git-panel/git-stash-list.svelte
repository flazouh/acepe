<script lang="ts">
	/**
	 * GitStashList — List of stash entries with pop/drop actions.
	 */
	import Package from "phosphor-svelte/lib/Package";
	import ArrowCounterClockwise from "phosphor-svelte/lib/ArrowCounterClockwise";
	import Trash from "phosphor-svelte/lib/Trash";

	import { cn } from "../../lib/utils.js";
	import type { GitStashEntry } from "./types.js";

	interface Props {
		entries: GitStashEntry[];
		onPop?: (index: number) => void;
		onDrop?: (index: number) => void;
		class?: string;
	}

	let { entries, onPop, onDrop, class: className }: Props = $props();
</script>

<div class={cn("flex flex-col overflow-y-auto", className)}>
	{#if entries.length === 0}
		<div class="flex items-center justify-center py-8 text-sm text-muted-foreground">
			No stashes
		</div>
	{:else}
		{#each entries as entry (entry.index)}
			<div
				class="group flex items-center gap-2 px-2 py-1.5 hover:bg-muted/40 transition-colors"
			>
				<Package size={14} weight="bold" class="text-muted-foreground shrink-0" />

				<div class="min-w-0 flex-1">
					<div class="truncate font-mono text-[0.6875rem] text-foreground">
						stash@{"{" + entry.index + "}"}
					</div>
					<div class="truncate text-[0.625rem] text-muted-foreground">
						{entry.message}
					</div>
				</div>

				<span class="text-[0.625rem] text-muted-foreground shrink-0">
					{entry.date}
				</span>

				<div class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
					{#if onPop}
						<button
							type="button"
							class="flex items-center justify-center h-5 w-5 rounded text-muted-foreground hover:text-success hover:bg-success/10 cursor-pointer transition-colors"
							title="Pop stash"
							onclick={() => onPop?.(entry.index)}
						>
							<ArrowCounterClockwise size={12} weight="bold" />
						</button>
					{/if}
					{#if onDrop}
						<button
							type="button"
							class="flex items-center justify-center h-5 w-5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 cursor-pointer transition-colors"
							title="Drop stash"
							onclick={() => onDrop?.(entry.index)}
						>
							<Trash size={12} weight="bold" />
						</button>
					{/if}
				</div>
			</div>
		{/each}
	{/if}
</div>
