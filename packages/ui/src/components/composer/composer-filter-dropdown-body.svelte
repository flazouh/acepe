<script lang="ts">
	import type { Snippet } from "svelte";

	import ComposerFilterDropdownFilterInput from "./composer-filter-dropdown-filter-input.svelte";
	import {
		composerFilterDropdownBodyClass,
		composerFilterDropdownFilterRowClass,
	} from "./composer-filter-dropdown-menu.classes.js";

	interface Props {
		searchQuery?: string;
		searchPlaceholder?: string;
		searchAriaLabel?: string;
		inputRef?: HTMLInputElement | null;
		showFilter?: boolean;
		children: Snippet;
	}

	let {
		searchQuery = $bindable(""),
		searchPlaceholder = "",
		searchAriaLabel = searchPlaceholder,
		inputRef = $bindable(null),
		showFilter = true,
		children,
	}: Props = $props();
</script>

<div class={composerFilterDropdownBodyClass}>
	{#if showFilter}
		<div class={composerFilterDropdownFilterRowClass}>
			<ComposerFilterDropdownFilterInput
				bind:value={searchQuery}
				placeholder={searchPlaceholder}
				ariaLabel={searchAriaLabel}
				bind:inputRef={inputRef}
			/>
		</div>
	{/if}
	{@render children()}
</div>
