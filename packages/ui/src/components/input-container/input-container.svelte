<script lang="ts">
	import type { Snippet } from "svelte";
	import { cn } from "../../lib/utils.js";

	interface Props {
		class?: string;
		/** Class applied to the content area. Defaults to "px-3 py-2". */
		contentClass?: string;
		/** Named content snippet (used by desktop input). Mutually exclusive with children. */
		content?: Snippet;
		/** Optional footer snippet rendered below content with a top border. */
		footer?: Snippet;
		/** Default slot (used by UI package consumers). Mutually exclusive with content. */
		children?: Snippet;
	}

	let {
		class: className = "",
		contentClass = "px-3 py-2",
		content,
		footer,
		children,
	}: Props = $props();
</script>

<div
	class={cn("relative h-fit flex flex-col rounded-xl bg-input/30", className)}
>
	<div class={contentClass}>
		{#if content}
			{@render content()}
		{:else if children}
			{@render children()}
		{/if}
	</div>
	{#if footer}
		<div class="flex items-center justify-between gap-2 h-7 border-t border-border/50">
			{@render footer()}
		</div>
	{/if}
</div>
