<script lang="ts">
	import { cn } from "../../lib/utils.js";
	import RoundedIcon from "./rounded-icon.svelte";

	interface Props {
		class?: string;
	}

	let { class: className = "" }: Props = $props();
</script>

<RoundedIcon name="plus" class={cn("shrink-0", className)} />
