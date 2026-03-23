<script lang="ts">
	import ArrowsIn from "phosphor-svelte/lib/ArrowsIn";
	import ArrowsOut from "phosphor-svelte/lib/ArrowsOut";

	import EmbeddedIconButton from "./embedded-icon-button.svelte";

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

<EmbeddedIconButton onclick={() => onToggle?.()} {title} ariaLabel={title} class={className}>
	{#snippet children()}
		{#if isFullscreen}
			<ArrowsIn size={14} weight="fill" />
		{:else}
			<ArrowsOut size={14} weight="fill" />
		{/if}
	{/snippet}
</EmbeddedIconButton>
