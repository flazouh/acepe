<script lang="ts">
	import { Button } from "../button/index.js";
	import type { ButtonSize } from "../button/variants.js";
	import { HugeiconsIcon } from "../icons/index.js";

	interface Props {
		onClose?: (() => void) | undefined;
		title?: string;
		size?: ButtonSize;
		class?: string;
	}

	let {
		onClose,
		title = "Close",
		size = "icon-sm",
		class: className = "",
	}: Props = $props();
</script>

<Button
	variant="ghost"
	{size}
	data-header-control
	onclick={() => onClose?.()}
	{title}
	aria-label={title}
	class={className}
>
	{#snippet children()}
		<HugeiconsIcon name="close" />
	{/snippet}
</Button>
