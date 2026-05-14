<script lang="ts">
	import { untrack, type Snippet } from "svelte";

	interface Props {
		visible: boolean;
		initiallyExpanded?: boolean;
		fileList?: Snippet;
		leadingContent?: Snippet;
		trailingContent: Snippet<[boolean, () => void]>;
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
			<div class="rounded-t-md bg-input/30 overflow-hidden border border-b-0 border-border">
				<div class="flex flex-col p-1 max-h-[300px] overflow-y-auto">
					{@render fileList()}
				</div>
			</div>
		{/if}

		<div
			class="flex w-full min-w-max items-center gap-3 pl-1 pr-3 py-1 rounded-md border border-border bg-input/30 {isExpanded
				? 'rounded-t-none border-t-0'
				: ''}"
		>
			<div class="flex shrink-0 items-center gap-2">
				{#if leadingContent}
					{@render leadingContent()}
				{/if}
			</div>

			<div class="ml-auto flex shrink-0 items-center gap-3">
				{@render trailingContent(isExpanded, toggleExpanded)}
			</div>
		</div>
	</div>
{/if}
