<script lang="ts">
	import "@fontsource-variable/archivo/standard.css";
	import logo from "../../../../../assets/logo.svg?url";
	import { cn } from "../../lib/utils.js";

	interface Props {
		class?: string;
		wordmarkClass?: string;
	}

	let {
		class: className = "",
		wordmarkClass = ""
	}: Props = $props();
</script>

<span
	role="img"
	aria-label="Acepe"
	data-slot="brand-lockup"
	class={cn(
		"inline-flex items-end gap-[0.02em] text-sm text-foreground uppercase",
		wordmarkClass,
		className
	)}
	style="font-family: 'Archivo Variable', Archivo, sans-serif; font-stretch: 112%; font-weight: 900; letter-spacing: -0.085em; line-height: 1;"
>
	<span
		aria-hidden="true"
		data-slot="brand-lockup-mark"
		class="block shrink-0 bg-current"
		style={`width: 1.053em; height: 0.72em; mask: url("${logo}") center / contain no-repeat; -webkit-mask: url("${logo}") center / contain no-repeat; transform: translateY(-0.17em);`}
	></span>
	<span
		aria-hidden="true"
		class="block"
		style="transform: translateX(-0.025em); -webkit-text-stroke: 0.015em currentColor;"
	>
		CEPE
	</span>
</span>
