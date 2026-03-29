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
		collapsed?: boolean;
		expanded?: boolean;
		onExpandedChange?: (expanded: boolean) => void;
		onActivateCollapsed?: () => void;
	}

	let {
		groups,
		totalCount,
		emptyHint = "",
		itemRenderer,
		collapsed = false,
		expanded: expandedProp,
		onExpandedChange,
		onActivateCollapsed,
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
	{#if collapsed}
		<button
			type="button"
			class="flex h-8 w-full items-center justify-center rounded-md border border-border bg-card/50 text-muted-foreground transition-colors duration-200 hover:bg-accent/50 hover:text-foreground"
			onclick={() => onActivateCollapsed?.()}
			aria-label="Open attention queue"
			title="Attention Queue"
		>
			<div class="relative flex items-center justify-center">
				<BellSimple size={15} weight="fill" class="shrink-0 text-primary" />
				<span class="absolute -right-2 -top-2 min-w-[16px] rounded-full border border-background bg-primary px-1 text-center text-[9px] font-semibold leading-4 text-primary-foreground">
					{totalCount}
				</span>
			</div>
		</button>
	{:else}
		<div class="flex flex-col overflow-hidden border border-border rounded-lg bg-card/50 shrink-0 mb-0.5 transition-[transform,opacity] duration-200 ease-out">
			<button
				type="button"
				class="flex items-center gap-1.5 px-2 py-1.5 w-full text-left cursor-pointer bg-transparent border-none hover:bg-accent/50 rounded-md transition-colors"
				onclick={toggleExpanded}
			>
				<BellSimple size={12} weight="fill" class="text-primary shrink-0" />
				<span class="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
					Attention Queue
				</span>
				<span class="text-[10px] text-muted-foreground/60 tabular-nums">
					{totalCount}
				</span>
				<div class="ml-auto">
					{#if expandedInternal}
						<CaretDown size={10} weight="bold" class="text-muted-foreground shrink-0" />
					{:else}
						<CaretRight size={10} weight="bold" class="text-muted-foreground shrink-0" />
					{/if}
				</div>
			</button>

			{#if expandedInternal}
				<div class="flex flex-col gap-0.5 p-1 pt-0">
					{#each groups as group, i (group.id)}
						{#if group.items.length > 0 || emptyHint}
							<div 
								class="section-card flex overflow-hidden rounded-lg border border-border/50 bg-card/20 border-l-[3px]"
								style="border-left-color: {sectionColor(group.id)};"
							>

								<!-- Section content -->
								<div class="flex min-w-0 flex-1 flex-col">
									<FeedSectionHeader sectionId={group.id} label={group.label} count={group.items.length} color={sectionColor(group.id)} />

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
							</div>
						{/if}
					{/each}
				</div>
			{/if}
		</div>
	{/if}
{/if}

<style>
	.section-card {
		backdrop-filter: blur(12px);
	}
</style>
