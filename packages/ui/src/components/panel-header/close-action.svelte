<script lang="ts">
	import { Button } from "../button/index.js";
	import { RoundedIcon } from "../icons/index.js";

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
	size="icon-chrome"
	data-header-control
	onclick={() => onClose?.()}
	{title}
	aria-label={title}
	class={className}
>
	{#snippet children()}
		<RoundedIcon name="close" class="size-3" />
	{/snippet}
</Button>
