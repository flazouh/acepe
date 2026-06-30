<script lang="ts">
	import { cn } from "../../lib/utils.js";
	import { PLUS_ICON_CLASS } from "./plus-icon-classes.js";
	import RoundedIcon from "./rounded-icon.svelte";

	interface Props {
		class?: string;
	}

	let { class: className = "" }: Props = $props();
</script>

<RoundedIcon name="plus" class={cn(className, PLUS_ICON_CLASS)} />
