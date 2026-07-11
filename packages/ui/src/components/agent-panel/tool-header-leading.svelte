<script lang="ts">
	import type { Snippet } from "svelte";
	import ToolLabel from "./tool-label.svelte";
	import ToolKindIcon from "./tool-kind-icon.svelte";
	import type { AgentToolKind, AgentToolStatus } from "./types.js";

	interface Props {
		kind?: AgentToolKind;
		status?: AgentToolStatus;
		class?: string;
		children: Snippet;
	}

	let { kind, status = "done", class: className = "", children }: Props = $props();
</script>

<div class={`flex items-center gap-2 min-w-0 ${className}`.trim()}>
	{#if kind !== undefined}
		<ToolKindIcon {kind} {status} size={13} />
	{/if}
	<ToolLabel {status}>
		{@render children()}
	</ToolLabel>
</div>
