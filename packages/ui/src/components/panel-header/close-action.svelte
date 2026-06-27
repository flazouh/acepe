<script lang="ts">
	import { X } from "phosphor-svelte";

	import { Button } from "../button/index.js";

	interface Props {
		onClose?: (() => void) | undefined;
		title?: string;
		class?: string;
	}

	let { onClose, title = "Close", class: className = "" }: Props = $props();
</script>

<Button
	variant="chromeIcon"
	size="chromeIcon"
	data-header-control
	onclick={() => onClose?.()}
	{title}
	aria-label={title}
	class={className}
>
	{#snippet children()}
		<X size={12} weight="bold" />
	{/snippet}
</Button>
