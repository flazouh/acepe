<script lang="ts">
	import type { Snippet } from "svelte";

	import SelectorPanelSearchInput from "./selector-panel-search-input.svelte";
	import { selectorPanelBodyClass, selectorPanelFilterRowClass } from "./selector-panel.classes.js";

	interface Props {
		searchQuery?: string;
		searchPlaceholder?: string;
		searchAriaLabel?: string;
		inputRef?: HTMLInputElement | null;
		showSearch?: boolean;
		onSearchChange?: (query: string) => void;
		children: Snippet;
	}

	let {
		searchQuery = $bindable(""),
		searchPlaceholder = "",
		searchAriaLabel = searchPlaceholder,
		inputRef = $bindable(null),
		showSearch = true,
		onSearchChange,
		children,
	}: Props = $props();

	function handleSearchInput(value: string): void {
		searchQuery = value;
		onSearchChange?.(value);
	}
</script>

<div class={selectorPanelBodyClass}>
	{#if showSearch}
		<div class={selectorPanelFilterRowClass}>
			<SelectorPanelSearchInput
				value={searchQuery}
				placeholder={searchPlaceholder}
				ariaLabel={searchAriaLabel}
				bind:inputRef={inputRef}
				oninput={handleSearchInput}
			/>
		</div>
	{/if}
	{@render children()}
</div>
