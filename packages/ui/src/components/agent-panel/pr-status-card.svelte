<script lang="ts">
	import { untrack, type Snippet } from "svelte";

	interface Props {
		visible: boolean;
		hasExpandedContent: boolean;
		fetchError?: string | null;
		initiallyExpanded?: boolean;
		headerMain: Snippet;
		headerActions?: Snippet<[boolean]>;
		expandedContent?: Snippet;
	}

	let {
		visible,
		hasExpandedContent,
		fetchError = null,
		initiallyExpanded = false,
		headerMain,
		headerActions,
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
			<div class="rounded-t-md bg-input/30 overflow-hidden border border-b-0 border-border">
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
			class="w-full flex items-center justify-between px-3 py-1 rounded-md border border-border bg-input/30 {hasExpandedContent
				? 'cursor-pointer'
				: 'cursor-default'} {isExpanded ? 'rounded-t-none border-t-0' : ''}"
		>
			<div class="flex items-center gap-1.5 min-w-0 text-[0.6875rem]">
				{@render headerMain()}
			</div>

			{#if headerActions}
				<div class="flex items-center gap-2 shrink-0">
					{@render headerActions(isExpanded)}
				</div>
			{/if}
		</div>

		{#if fetchError}
			<div class="px-3 py-1.5 text-xs text-destructive/70 bg-input/30 rounded-b-lg border border-t-0 border-border">
				{fetchError}
			</div>
		{/if}
	</div>
{/if}
