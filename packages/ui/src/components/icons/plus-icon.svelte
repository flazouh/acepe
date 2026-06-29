<script lang="ts">
	import { IconPlus } from "@tabler/icons-svelte";

	import { cn } from "../../lib/utils.js";
	import { PLUS_ICON_CLASS } from "./plus-icon-classes.js";

	interface Props {
		class?: string;
	}

	let { class: className = "" }: Props = $props();
</script>

<IconPlus class={cn(className, PLUS_ICON_CLASS)} aria-hidden="true" />
