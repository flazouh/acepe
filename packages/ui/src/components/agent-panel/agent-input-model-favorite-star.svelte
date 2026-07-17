<script lang="ts">
	import { HugeiconsIcon } from "../icons/index.js";
	import { Colors } from "../../lib/colors.js";
	import { cn } from "../../lib/utils.js";

	interface Props {
		isFavorite: boolean;
		label: string;
		onToggle: () => void;
	}

	let { isFavorite, label, onToggle }: Props = $props();

	const starColor = Colors.yellow;
</script>

<button
	type="button"
	aria-label={isFavorite ? `Remove ${label} from favorites` : `Add ${label} to favorites`}
	aria-pressed={isFavorite}
	onclick={(event) => {
		event.stopPropagation();
		onToggle();
	}}
	class={cn(
		"group/star grid h-4 w-4 shrink-0 place-items-center transition-colors",
		isFavorite
			? ""
			: "text-muted-foreground hover:text-foreground focus-visible:text-foreground"
	)}
	style={isFavorite ? `color: ${starColor}` : undefined}
>
	<HugeiconsIcon name="star" class="size-3.5" />
</button>
