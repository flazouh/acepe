<!--
  AgentInputModelFavoriteStar - Star toggle on a model row.

  Extracted from packages/desktop/src/lib/acp/components/model-selector.favorite-star.svelte.
-->
<script lang="ts">
	import { HugeiconsIcon } from "../icons/index.js";
	import { cn } from "../../lib/utils.js";
	import { Colors } from "../../lib/colors.js";

	interface Props {
		isFavorite: boolean;
		onToggle: () => void;
	}

	let { isFavorite, onToggle }: Props = $props();

	const starColor = Colors.yellow;
</script>

<button
	type="button"
	aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
	aria-pressed={isFavorite}
	onclick={(event) => {
		event.stopPropagation();
		onToggle();
	}}
	class={cn(
		"group/star grid h-4 w-4 shrink-0 place-items-center",
		isFavorite ? "" : "text-muted-foreground opacity-0 group-hover/item:opacity-100"
	)}
	style={isFavorite ? `color: ${starColor}` : undefined}
>
	{#if isFavorite}
		<HugeiconsIcon name="star" class="size-3.5" />
	{:else}
		<HugeiconsIcon name="star" class="size-3.5 group-hover/star:hidden" />
		<HugeiconsIcon name="star" class="size-3.5 hidden group-hover/star:block" style={`color: ${starColor}`} />
	{/if}
</button>
