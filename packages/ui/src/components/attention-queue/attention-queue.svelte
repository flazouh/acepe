<script lang="ts">
	import type { Snippet } from "svelte";
	import type { SectionedFeedGroup, SectionedFeedItemData, SectionedFeedSectionId } from "./types.js";

	import BellSimple from "phosphor-svelte/lib/BellSimple";
	import CaretDown from "phosphor-svelte/lib/CaretDown";
	import CaretRight from "phosphor-svelte/lib/CaretRight";

	import FeedSectionHeader from "./feed-section-header.svelte";
	import { Colors } from "../../lib/colors.js";

	function sectionColor(id: SectionedFeedSectionId): string {
		switch (id) {
			case "answer_needed": return Colors.orange;
			case "working":
			case "planning":      return Colors.purple;
			case "finished":      return Colors.green;
			case "error":         return Colors.red;
		}
	}

	interface Props {
		groups: readonly SectionedFeedGroup<SectionedFeedItemData>[];
		totalCount: number;
		emptyHint?: string;
		itemRenderer: Snippet<[SectionedFeedItemData]>;
		expanded?: boolean;
		onExpandedChange?: (expanded: boolean) => void;
	}

	let {
		groups,
		totalCount,
		emptyHint = "",
		itemRenderer,
		expanded: expandedProp,
		onExpandedChange,
	}: Props = $props();

	let expandedInternal = $state(true);

	// Sync from prop
	$effect(() => {
		if (expandedProp !== undefined) {
			expandedInternal = expandedProp;
		}
	});

	function toggleExpanded() {
		expandedInternal = !expandedInternal;
		onExpandedChange?.(expandedInternal);
	}
</script>

{#if totalCount > 0}
	<div class="flex flex-col overflow-hidden border border-border rounded-lg bg-card/50 shrink-0 mb-2">
		<button
			type="button"
			class="flex items-center gap-1.5 px-2 py-1.5 w-full text-left cursor-pointer bg-transparent border-none hover:bg-accent/50 rounded-md transition-colors"
			onclick={toggleExpanded}
		>
			{#if expandedInternal}
				<CaretDown size={10} weight="bold" class="text-muted-foreground shrink-0" />
			{:else}
				<CaretRight size={10} weight="bold" class="text-muted-foreground shrink-0" />
			{/if}
			<BellSimple size={12} weight="fill" class="text-primary shrink-0" />
			<span class="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
				Attention Queue
			</span>
			<span class="text-[10px] text-muted-foreground/60 tabular-nums">
				{totalCount}
			</span>
		</button>

		{#if expandedInternal}
			<div class="flex flex-col gap-1 p-1 pt-0">
				{#each groups as group (group.id)}
					{#if group.items.length > 0 || emptyHint}
						<div
						class="flex flex-col overflow-hidden rounded-md bg-accent/10 border p-0.5"
						style="border-color: color-mix(in srgb, {sectionColor(group.id)} 40%, var(--border));"
					>
							<FeedSectionHeader sectionId={group.id} label={group.label} count={group.items.length} />

							{#if group.items.length === 0 && emptyHint}
								<div class="px-2 py-1 text-[10px] text-muted-foreground/70">{emptyHint}</div>
							{/if}

							{#if group.items.length > 0}
								<div class="flex flex-col">
									{#each group.items as item}
										{@render itemRenderer(item)}
									{/each}
								</div>
							{/if}
						</div>
					{/if}
				{/each}
			</div>
		{/if}
	</div>
{/if}
