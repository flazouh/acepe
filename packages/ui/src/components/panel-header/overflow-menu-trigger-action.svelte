<script lang="ts">
	import { IconDotsVertical } from "@tabler/icons-svelte";

	import { Button } from "../button/index.js";
	import { OVERFLOW_DOTS_ICON_CLASS } from "./project-card-action-button-class.js";

	interface Props {
		title?: string;
		class?: string;
		onclick?: ((event: MouseEvent) => void) | undefined;
	}

	let { title = "More actions", class: className = "", onclick }: Props = $props();
</script>

<Button
	variant="ghost"
	size="icon-chrome"
	data-header-control
	{title}
	aria-label={title}
	class={className}
	{onclick}
>
	{#snippet children()}
		<IconDotsVertical class={OVERFLOW_DOTS_ICON_CLASS} />
	{/snippet}
</Button>
