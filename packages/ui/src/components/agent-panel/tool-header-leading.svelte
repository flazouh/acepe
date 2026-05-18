<script lang="ts">
	import type { Snippet } from "svelte";
	import { LoadingIcon } from "../icons/index.js";
	import ToolLabel from "./tool-label.svelte";
	import type { AgentToolKind, AgentToolStatus } from "./types.js";

	interface Props {
		kind?: AgentToolKind;
		status?: AgentToolStatus;
		class?: string;
		children: Snippet;
	}

	let { status = "done", class: className = "", children }: Props = $props();

	const isPending = $derived(status === "pending" || status === "running");
</script>

<div class={`flex items-center gap-2 min-w-0 ${className}`.trim()}>
	{#if isPending}
		<LoadingIcon class="shrink-0" size={12} aria-label="Loading" />
	{/if}
	<ToolLabel {status}>
		{@render children()}
	</ToolLabel>
</div>
