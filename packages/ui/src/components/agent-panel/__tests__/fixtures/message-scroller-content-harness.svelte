<script lang="ts">
import type { StickToBottomController } from "../../stick-to-bottom-effects.js";
import MessageScroller from "../../message-scroller.svelte";
import type { MessageScrollerItem } from "../../message-scroller-types.js";

let {
	items,
	onReady,
}: {
	readonly items: readonly MessageScrollerItem[];
	readonly onReady?: (controller: StickToBottomController) => void;
} = $props();
</script>

{#snippet renderItem(item: MessageScrollerItem)}
	<span data-testid="versioned-row-content">content {item.key}</span>
{/snippet}

<MessageScroller
	{items}
	{renderItem}
	ariaLabel="Conversation transcript"
	{onReady}
/>
