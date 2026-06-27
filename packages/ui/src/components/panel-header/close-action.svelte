<script lang="ts">
	import { X } from "../icons/index.js";

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
		<X size={12} weight="bold" />
	{/snippet}
</EmbeddedIconButton>
