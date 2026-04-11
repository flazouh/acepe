<script lang="ts">
	import { GitMerge } from "phosphor-svelte";

	interface MergeOption {
		id: string;
		label: string;
	}

	interface Props {
		label?: string;
		loading?: boolean;
		mergedLabel?: string;
		state?: "open" | "merged" | null;
		options?: readonly MergeOption[];
		onMerge?: (strategyId: string) => void;
	}

	let {
		label = "Merge",
		loading = false,
		mergedLabel = "Merged",
		state = "open",
		options = [],
		onMerge,
	}: Props = $props();

	let showDropdown = $state(false);
</script>

{#if state === "merged"}
	<div
		class="flex items-center gap-1 rounded border border-border/50 bg-muted px-2 py-0.5 text-[0.6875rem] font-medium text-muted-foreground opacity-60 shrink-0"
	>
		<GitMerge size={11} weight="fill" class="text-[#8250df]" />
		{mergedLabel}
	</div>
{:else if onMerge}
	<div
		class="flex items-center rounded border border-border/50 bg-muted overflow-hidden text-[0.6875rem] shrink-0 relative"
		onclick={(e) => e.stopPropagation()}
		role="none"
	>
		<button
			type="button"
			disabled={loading}
			onclick={() => { if (options.length > 0) onMerge?.(options[0].id); }}
			class="px-2 py-0.5 text-[0.6875rem] font-medium text-foreground/80 hover:text-foreground hover:bg-muted/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
		>
			<span class="flex items-center gap-1">
				<GitMerge size={11} weight="fill" />
				{label}
			</span>
		</button>
		{#if options.length > 1}
			<button
				type="button"
				class="self-stretch flex items-center px-1 border-l border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors disabled:opacity-50 outline-none"
				disabled={loading}
				onclick={(e) => { e.stopPropagation(); showDropdown = !showDropdown; }}
			>
				<svg class="size-2.5 text-muted-foreground" viewBox="0 0 10 10" fill="none">
					<path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
				</svg>
			</button>
			{#if showDropdown}
				<div class="absolute top-full left-0 mt-1 z-50 min-w-[150px] rounded-md border border-border bg-popover p-1 shadow-md">
					{#each options as option (option.id)}
						<button
							type="button"
							class="w-full rounded-sm px-2 py-1.5 text-left text-[0.6875rem] text-foreground hover:bg-accent cursor-pointer"
							onclick={() => { onMerge?.(option.id); showDropdown = false; }}
						>
							{option.label}
						</button>
					{/each}
				</div>
			{/if}
		{/if}
	</div>
{/if}
