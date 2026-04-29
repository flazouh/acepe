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
		/** When true, sidebar is collapsed — show centered icon-only layout. */
		collapsed?: boolean;
	}

	let { selected = false, onSelect, children, slidingHighlight = false, compactPadding = false, collapsed = false }: Props = $props();

	const paddingClass = $derived(collapsed ? "px-0 py-0.5" : compactPadding ? "px-1.5 py-1" : "px-2 py-1.5");
	const baseClass = $derived(
		`flex flex-col ${collapsed ? "items-center" : ""} justify-center w-full text-left gap-1 ${paddingClass} rounded transition-[background-color] duration-75 ease-out`
	);
	const withHover = $derived(slidingHighlight ? "" : "hover:bg-accent/50");
	const selectedClass = $derived(selected ? "bg-accent/20" : "");

	function handleKeydown(event: KeyboardEvent): void {
		if (!onSelect) return;
		if (event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			onSelect();
		}
	}
</script>

{#if onSelect}
	<div
		class="{baseClass} {withHover} {selectedClass} cursor-pointer"
		role="button"
		tabindex={0}
		aria-pressed={selected}
		data-selected={selected ? "true" : "false"}
		onclick={onSelect}
		onkeydown={handleKeydown}
	>
		{#if children}
			{@render children()}
		{/if}
	</div>
{:else}
	<div class="{baseClass} {withHover} {selectedClass}">
		{#if children}
			{@render children()}
		{/if}
	</div>
{/if}
