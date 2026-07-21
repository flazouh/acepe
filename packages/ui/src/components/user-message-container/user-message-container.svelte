<script lang="ts">
	import type { Snippet } from "svelte";
	import { cn } from "../../lib/utils.js";

	interface Props {
		class?: string;
		contentClass?: string;
		dataTestid?: string;
		header?: Snippet;
		content?: Snippet;
		footer?: Snippet;
		children?: Snippet;
	}

	let {
		class: className = "",
		contentClass = "px-2 py-1",
		dataTestid,
		header,
		content,
		footer,
		children,
	}: Props = $props();
</script>

<!--
	Quiet recessed shell shared with tool cards: rounded-lg + overflow-hidden +
	bg-input/50, no border. Optional header matches the tool-call h-6 band.
-->
<div
	class={cn("relative flex h-fit max-w-full min-w-0 flex-col overflow-hidden rounded-lg bg-input/50", className)}
	data-testid={dataTestid}
>
	{#if header}
		<div class="flex h-6 shrink-0 items-center justify-between gap-1.5 pl-2 pr-0.5">
			{@render header()}
		</div>
	{/if}
	<div class={cn(contentClass, header ? "border-t border-border/50" : undefined)}>
		{#if content}
			{@render content()}
		{:else if children}
			{@render children()}
		{/if}
	</div>
	{#if footer}
		<div class="flex h-7 items-center justify-between gap-2 border-t border-border/50">
			{@render footer()}
		</div>
	{/if}
</div>
