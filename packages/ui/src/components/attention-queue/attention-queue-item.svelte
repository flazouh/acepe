<script lang="ts">
	import type { Snippet } from "svelte";

	interface Props {
		selected?: boolean;
		onSelect?: () => void;
		children?: Snippet;
		/** When true, no item bg/hover; parent provides sliding highlight (e.g. session list). */
		slidingHighlight?: boolean;
		/** When true, use smaller px/py (e.g. sidebar session list). */
		compactPadding?: boolean;
	}

	let { selected = false, onSelect, children, slidingHighlight = false, compactPadding = false }: Props = $props();

	const paddingClass = $derived(compactPadding ? "px-1.5 py-1" : "px-2 py-1.5");
	const baseClass =
		$derived(`flex flex-col justify-center w-full text-left gap-1 ${paddingClass} rounded-md transition-[background-color] duration-75 ease-out`);
	const withHover = $derived(slidingHighlight ? "" : "hover:bg-accent/50");
	const selectedClass = $derived(selected ? "bg-accent/20" : "");
</script>

{#if onSelect}
	<button
		type="button"
		class="{baseClass} {withHover} {selectedClass}"
		onclick={onSelect}
	>
		{#if children}
			{@render children()}
		{/if}
	</button>
{:else}
	<div class="{baseClass} {withHover} {selectedClass}">
		{#if children}
			{@render children()}
		{/if}
	</div>
{/if}
