<script lang="ts">
	import type { Snippet } from "svelte";

	import { cn } from "../../lib/utils.js";
	import AgentPanelContentColumnFrame from "./agent-panel-content-column-frame.svelte";

	interface Props {
		centered?: boolean;
		widthClass?: string;
		class?: string;
		innerClass?: string;
		children?: Snippet;
	}

	let {
		centered = false,
		widthClass = "max-w-3xl",
		class: className = "",
		innerClass = "",
		children,
	}: Props = $props();
</script>

<AgentPanelContentColumnFrame
	{centered}
	{widthClass}
	class={cn("pb-2", className)}
	{innerClass}
	data-input-area
>
	{#if children}
		{@render children()}
	{/if}
</AgentPanelContentColumnFrame>
