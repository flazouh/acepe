<script lang="ts">
import { Colors } from "@acepe/ui";
import Star from "phosphor-svelte/lib/Star";
import { cn } from "$lib/utils.js";

interface Props {
	isFavorite: boolean;
	onToggle: () => void;
}

let { isFavorite, onToggle }: Props = $props();

const starColor = Colors.yellow;
</script>

<button
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
		<Star class="size-3.5" weight="fill" />
	{:else}
		<Star class="size-3.5 group-hover/star:hidden" weight="regular" />
		<Star class="size-3.5 hidden group-hover/star:block" weight="fill" color={starColor} />
	{/if}
</button>
