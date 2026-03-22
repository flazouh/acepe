<script lang="ts">
	import { SpinnerGap } from "phosphor-svelte";
	import { cn } from "../../lib/utils";

	interface Props {
		class?: string;
		role?: string;
		"aria-label"?: string;
		style?: string;
	}

	let { class: className = "", role, "aria-label": ariaLabel, style = "" }: Props = $props();
</script>

<span {role} aria-label={ariaLabel} {style}>
	<SpinnerGap weight="bold" class={cn("size-4 animate-spin text-[#C69027] shrink-0", className)} />
</span>
