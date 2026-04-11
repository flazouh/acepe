<script lang="ts">
	import { untrack, type Snippet } from "svelte";

	interface Props {
		visible: boolean;
		initiallyExpanded?: boolean;
		fileList?: Snippet;
		leadingContent?: Snippet;
		trailingContent: Snippet<[boolean]>;
	}

	let {
		visible,
		initiallyExpanded = false,
		fileList,
		leadingContent,
		trailingContent,
	}: Props = $props();

	let isExpanded = $state(untrack(() => initiallyExpanded));

	function toggleExpanded(): void {
		isExpanded = !isExpanded;
	}
</script>

{#if visible}
	<div class="w-full">
		{#if isExpanded && fileList}
			<div class="rounded-t-md bg-muted/30 overflow-hidden border border-b-0 border-border">
				<div class="flex flex-col p-1 max-h-[300px] overflow-y-auto">
					{@render fileList()}
				</div>
			</div>
		{/if}

		<div
			role="button"
			tabindex="0"
			onclick={toggleExpanded}
			onkeydown={(event: KeyboardEvent) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					toggleExpanded();
				}
			}}
			class="w-full flex items-center justify-between pl-1 pr-3 py-1 rounded-md border border-border bg-muted/30 hover:bg-muted/40 transition-colors cursor-pointer {isExpanded
				? 'rounded-t-none border-t-0'
				: ''}"
		>
			{#if leadingContent}
				<div class="flex items-center gap-2 shrink-0 min-w-0">
					{@render leadingContent()}
				</div>
			{/if}

			<div class="flex items-center gap-3 shrink-0 ml-auto">
				{@render trailingContent(isExpanded)}
			</div>
		</div>
	</div>
{/if}
