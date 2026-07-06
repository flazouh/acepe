<script lang="ts">
import type { Snippet } from "svelte";
import type {
	MessageScrollerItem,
	MessageScrollerItemSource,
	MessageScrollerRangeState,
	StickToBottomController,
} from "@acepe/ui/agent-panel";

type Props = {
	items?: readonly MessageScrollerItem[];
	itemSource?: MessageScrollerItemSource;
	virtualLeadingSpacePx?: number;
	renderItem: Snippet<[MessageScrollerItem]>;
	ariaLabel: string;
	onReady?: (controller: StickToBottomController) => void;
	onEdgeStateChange?: (state: { readonly atTop: boolean; readonly atBottom: boolean }) => void;
	onVisibleRangeChange?: (state: MessageScrollerRangeState) => void;
	onFollowStateChange?: (state: {
		readonly released: boolean;
		readonly hasUnreadBelow: boolean;
	}) => void;
};

let {
	items = [],
	itemSource,
	virtualLeadingSpacePx = 0,
	renderItem,
	ariaLabel,
	onEdgeStateChange,
	onVisibleRangeChange,
}: Props = $props();

const renderedItems = $derived.by(() => {
	if (itemSource === undefined) {
		return items;
	}

	const nextItems: MessageScrollerItem[] = [];
	for (let index = 0; index < itemSource.length; index += 1) {
		const item = itemSource.getItem(index);
		if (item !== undefined) {
			nextItems.push(item);
		}
	}
	return nextItems;
});
</script>

<div
		data-testid="message-scroller-stub"
		data-row-count={renderedItems.length}
		data-virtual-leading-space-px={virtualLeadingSpacePx}
		aria-label={ariaLabel}
	>
	<button
		type="button"
		data-testid="message-scroller-stub-edge-top"
		onclick={() => onEdgeStateChange?.({ atTop: true, atBottom: false })}
	>
		edge top
	</button>
	<button
		type="button"
		data-testid="message-scroller-stub-near-loaded-start"
		onclick={() =>
			onVisibleRangeChange?.({
				startIndex: 12,
				endIndex: 32,
				itemCount: 256,
				beforePx: 1200,
				afterPx: 22000,
				totalPx: 32000,
				isVirtualized: true,
			})}
	>
		near loaded start
	</button>
	{#each renderedItems as item (item.key)}
		<div data-testid="message-scroller-stub-row" data-row-id={item.rowId}>
			{@render renderItem(item)}
		</div>
	{/each}
</div>
