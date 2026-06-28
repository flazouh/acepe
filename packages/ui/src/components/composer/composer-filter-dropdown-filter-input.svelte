<!--
  ComposerFilterDropdownFilterInput - Borderless search row for composer filter dropdowns.
-->
<script lang="ts">
	import { composerFilterDropdownFilterInputClass } from "./composer-filter-dropdown-menu.classes.js";

	interface Props {
		value?: string;
		placeholder?: string;
		ariaLabel?: string;
		inputRef?: HTMLInputElement | null;
	}

	let {
		value = $bindable(""),
		placeholder = "",
		ariaLabel = placeholder,
		inputRef = $bindable(null),
	}: Props = $props();
</script>

<input
	type="search"
	bind:this={inputRef}
	bind:value
	{placeholder}
	class={composerFilterDropdownFilterInputClass}
	aria-label={ariaLabel}
	autocomplete="off"
	spellcheck={false}
/>
