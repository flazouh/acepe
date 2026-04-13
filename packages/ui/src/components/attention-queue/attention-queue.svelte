<script lang="ts">
import type { Snippet } from "svelte";
import type { SectionedFeedGroup, SectionedFeedItemData } from "./types.js";

import { BellSimple } from "phosphor-svelte";
import { CaretDown } from "phosphor-svelte";
import { CaretRight } from "phosphor-svelte";

import FeedSectionHeader from "./feed-section-header.svelte";
import { sectionColor } from "./section-color.js";

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
			class="flex h-8 w-full items-center justify-center rounded bg-card/50 text-muted-foreground transition-colors duration-200 hover:bg-accent/50 hover:text-foreground"
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
		<div class="mb-0.5 flex shrink-0 flex-col overflow-hidden rounded-lg bg-card/50 transition-[transform,opacity] duration-200 ease-out">
			<button
				type="button"
				class="flex w-full cursor-pointer items-center gap-1.5 rounded border-none bg-transparent px-2 py-1.5 text-left transition-colors hover:bg-accent/50"
				onclick={toggleExpanded}
			>
				<BellSimple size={12} weight="fill" class="text-primary shrink-0" />
				<span class="text-[11px] font-medium text-muted-foreground">
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
							<div class="flex overflow-hidden">
								<div class="flex min-w-0 flex-1 flex-col">
									<FeedSectionHeader
										sectionId={group.id}
										label={group.label}
										count={group.items.length}
										color={sectionColor(group.id)}
										needsReviewIcon="file-code"
									/>

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
