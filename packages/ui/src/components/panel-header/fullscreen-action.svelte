<script lang="ts">
	import { ArrowsIn } from "phosphor-svelte";
	import { ArrowsOut } from "phosphor-svelte";

	import { Button } from "../button/index.js";

	interface Props {
		isFullscreen: boolean;
		onToggle?: (() => void) | undefined;
		titleEnter?: string;
		titleExit?: string;
		class?: string;
	}

	let {
		isFullscreen,
		onToggle,
		titleEnter = "Fullscreen",
		titleExit = "Exit fullscreen",
		class: className = "",
	}: Props = $props();

	const title = $derived(isFullscreen ? titleExit : titleEnter);
</script>

<Button
	variant="ghost"
	size="icon-chrome"
	data-header-control
	onclick={() => onToggle?.()}
	{title}
	aria-label={title}
	class={className}
>
	{#snippet children()}
		{#if isFullscreen}
			<ArrowsIn size={12} weight="fill" />
		{:else}
			<ArrowsOut size={12} weight="fill" />
		{/if}
	{/snippet}
</Button>
