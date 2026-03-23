<script lang="ts">
	import X from "phosphor-svelte/lib/X";

	import EmbeddedIconButton from "./embedded-icon-button.svelte";

	interface Props {
		onClose?: (() => void) | undefined;
		title?: string;
		class?: string;
	}

	let { onClose, title = "Close", class: className = "" }: Props = $props();
</script>

<EmbeddedIconButton onclick={() => onClose?.()} {title} ariaLabel={title} class={className}>
	{#snippet children()}
		<X size={14} weight="bold" />
	{/snippet}
</EmbeddedIconButton>
