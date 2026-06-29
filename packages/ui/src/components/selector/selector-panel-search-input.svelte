<script lang="ts">
	import { selectorPanelFilterInputClass } from "./selector-panel.classes.js";

	interface Props {
		value?: string;
		placeholder?: string;
		ariaLabel?: string;
		inputRef?: HTMLInputElement | null;
		oninput?: (value: string) => void;
	}

	let {
		value = "",
		placeholder = "",
		ariaLabel = placeholder,
		inputRef = $bindable(null),
		oninput,
	}: Props = $props();
</script>

<input
	type="search"
	bind:this={inputRef}
	{value}
	oninput={(event) => oninput?.(event.currentTarget.value)}
	{placeholder}
	class={selectorPanelFilterInputClass}
	aria-label={ariaLabel}
	autocomplete="off"
	spellcheck={false}
/>
