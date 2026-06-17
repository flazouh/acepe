<script lang="ts">
	import type { Snippet } from "svelte";
	import type { HTMLButtonAttributes } from "svelte/elements";

	import { PROJECT_CARD_ACTION_BUTTON_CLASS } from "./project-card-action-button-class.js";

	interface Props {
		children?: Snippet;
		class?: string;
		title?: string;
		ariaLabel?: string;
		disabled?: boolean;
		active?: boolean;
		onclick?: ((event: MouseEvent) => void) | undefined;
		type?: "button" | "submit" | "reset";
	}

	let {
		children,
		class: className = "",
		title,
		ariaLabel,
		disabled = false,
		active = false,
		onclick,
		type = "button",
		...rest
	}: Props & HTMLButtonAttributes = $props();
</script>

<button
	{type}
	{title}
	aria-label={ariaLabel}
	{disabled}
	{...rest}
	class="{PROJECT_CARD_ACTION_BUTTON_CLASS} inline-flex focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset disabled:opacity-50 disabled:pointer-events-none {active
		? 'bg-accent text-foreground'
		: ''} {className}"
	onclick={onclick}
	data-header-control
>
	{@render children?.()}
</button>
