<script lang="ts">
	import { untrack, type Snippet } from "svelte";

	interface Props {
		visible: boolean;
		hasExpandedContent: boolean;
		hasBelowHeader?: boolean;
		fetchError?: string | null;
		initiallyExpanded?: boolean;
		headerMain: Snippet;
		headerActions?: Snippet<[boolean]>;
		belowHeader?: Snippet;
		expandedContent?: Snippet;
	}

	let {
		visible,
		hasExpandedContent,
		hasBelowHeader = false,
		fetchError = null,
		initiallyExpanded = false,
		headerMain,
		headerActions,
		belowHeader,
		expandedContent,
	}: Props = $props();

	let isExpanded = $state(untrack(() => initiallyExpanded));

	function toggleExpand(): void {
		if (!hasExpandedContent) {
			return;
		}

		isExpanded = !isExpanded;
	}
</script>

{#if visible}
	<div class="w-full">
		{#if isExpanded && hasExpandedContent && expandedContent}
			<div class="bg-input/30 overflow-hidden border-x border-t border-border rounded-t-md">
				{@render expandedContent()}
			</div>
		{/if}

		<div
			role="button"
			tabindex="0"
			onclick={toggleExpand}
			onkeydown={(event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					toggleExpand();
				}
			}}
			class="w-full flex items-center justify-between px-3 py-1 rounded-md border border-border bg-muted/60 {hasExpandedContent
				? 'cursor-pointer'
				: 'cursor-default'} {isExpanded ? 'rounded-t-none border-t-0' : ''} {hasBelowHeader ? 'rounded-b-none border-b border-border/70' : ''}"
		>
			<div class="flex items-center gap-1.5 min-w-0 text-sm">
				{@render headerMain()}
			</div>

			{#if headerActions}
				<div class="flex items-center gap-2 shrink-0">
					{@render headerActions(isExpanded)}
				</div>
			{/if}
		</div>

		{#if hasBelowHeader && belowHeader}
			{@render belowHeader()}
		{/if}

		{#if fetchError}
			<div class="px-3 py-1.5 text-sm text-destructive/70 bg-input/30 rounded-b-lg border border-t-0 border-border">
				{fetchError}
			</div>
		{/if}
	</div>
{/if}
