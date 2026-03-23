<script lang="ts">
import type { Snippet } from "svelte";

interface Props {
	isExpanded: boolean;
	hasContent: boolean;
	fixedCollapsedHeight?: string;
	maxExpandedHeight?: string;
	onToggle?: () => void;
	header: Snippet;
	children: Snippet;
}

let {
	isExpanded,
	hasContent,
	fixedCollapsedHeight = "72px",
	maxExpandedHeight = "200px",
	onToggle,
	header,
	children,
}: Props = $props();

const heightStyle = $derived(
	isExpanded ? `max-height: ${maxExpandedHeight};` : `max-height: ${fixedCollapsedHeight};`
);
</script>

<div class="relative rounded-lg border border-border bg-muted/30">
	<!-- Header (always visible) -->
	<div
		class="cursor-pointer px-2.5 py-1.5"
		onclick={onToggle}
		role="button"
		tabindex="0"
		onkeydown={(e) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				onToggle?.();
			}
		}}
	>
		{@render header()}
	</div>

	<!-- Content (collapsible) -->
	{#if hasContent}
		<div class="overflow-hidden transition-[max-height] duration-200 ease-out" style={heightStyle}>
			<div class="relative">
				<!-- Top gradient fade when collapsed and content overflows -->
				{#if !isExpanded}
					<div
						class="pointer-events-none absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-muted/30 to-transparent"
					></div>
				{/if}

				<!-- Actual content -->
				<div class="px-2.5 pb-1.5">
					{@render children()}
				</div>
			</div>
		</div>
	{/if}
</div>
