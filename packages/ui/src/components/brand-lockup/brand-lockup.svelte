<script lang="ts">
	import logo from "../../../../../assets/logo.svg?url";
	import { cn } from "../../lib/utils.js";

	interface Props {
		class?: string;
		markClass?: string;
		wordmark?: string;
		wordmarkClass?: string;
	}

	let {
		class: className = "",
		markClass = "h-6 w-6",
		wordmark = "ACEPE",
		wordmarkClass = ""
	}: Props = $props();
</script>

<div data-slot="brand-lockup" class={cn("inline-flex items-center gap-2.5", className)}>
	<span
		aria-hidden="true"
		data-slot="brand-lockup-mark"
		class={cn("shrink-0 bg-current", markClass)}
		style={`mask: url("${logo}") center / contain no-repeat; -webkit-mask: url("${logo}") center / contain no-repeat;`}
	></span>
	<span
		class={cn(
			"text-sm font-semibold leading-none tracking-[0.18em] text-foreground uppercase",
			wordmarkClass
		)}
	>
		{wordmark}
	</span>
</div>
