<script lang="ts">
	import { Button } from "../button/index.js";
	import type { ButtonSize } from "../button/variants.js";
	import { RoundedIcon } from "../icons/index.js";

	interface Props {
		isFullscreen: boolean;
		onToggle?: (() => void) | undefined;
		titleEnter?: string;
		titleExit?: string;
		size?: ButtonSize;
		class?: string;
	}

	let {
		isFullscreen,
		onToggle,
		titleEnter = "Fullscreen",
		titleExit = "Exit fullscreen",
		size = "icon-2xs",
		class: className = "",
	}: Props = $props();

	const title = $derived(isFullscreen ? titleExit : titleEnter);
</script>

<Button
	variant="ghost"
	{size}
	data-header-control
	onclick={() => onToggle?.()}
	{title}
	aria-label={title}
	class={className}
>
	{#snippet children()}
		<RoundedIcon name={isFullscreen ? "collapse" : "expand"} />
	{/snippet}
</Button>
