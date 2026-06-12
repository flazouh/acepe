<script lang="ts">
	import { IconDotsVertical } from "@tabler/icons-svelte";

	import EmbeddedIconButton from "./embedded-icon-button.svelte";

	interface Props {
		title?: string;
		class?: string;
		onclick?: ((event: MouseEvent) => void) | undefined;
	}

	let { title = "More actions", class: className = "", onclick }: Props = $props();
</script>

<EmbeddedIconButton {title} ariaLabel={title} class={className} {onclick}>
	{#snippet children()}
		<IconDotsVertical class="h-3 w-3" />
	{/snippet}
</EmbeddedIconButton>
