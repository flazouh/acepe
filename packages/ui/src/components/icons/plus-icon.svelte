<script lang="ts">
	import { cn } from "../../lib/utils.js";
	import HugeiconsIcon from "./hugeicons-icon.svelte";

	interface Props {
		class?: string;
	}

	let { class: className = "" }: Props = $props();
</script>

<HugeiconsIcon name="plus" class={cn("shrink-0", className)} />
