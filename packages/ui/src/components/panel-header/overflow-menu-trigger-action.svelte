<script lang="ts">
	import { Button } from "../button/index.js";
	import { RoundedIcon } from "../icons/index.js";

	interface Props {
		title?: string;
		class?: string;
		onclick?: ((event: MouseEvent) => void) | undefined;
	}

	let { title = "More actions", class: className = "", onclick }: Props = $props();
</script>

<Button
	variant="ghost"
	size="icon"
	data-header-control
	{title}
	aria-label={title}
	class={className}
	{onclick}
>
	{#snippet children()}
		<RoundedIcon name="more" />
	{/snippet}
</Button>
