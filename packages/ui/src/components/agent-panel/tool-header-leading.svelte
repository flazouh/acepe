<script lang="ts">
	import type { Snippet } from "svelte";
	import ToolKindIcon from "./tool-kind-icon.svelte";
	import ToolLabel from "./tool-label.svelte";
	import type { AgentToolKind, AgentToolStatus } from "./types.js";

	interface Props {
		kind: AgentToolKind;
		status?: AgentToolStatus;
		class?: string;
		children: Snippet;
	}

	let { kind, status = "done", class: className = "", children }: Props = $props();
</script>

<div class={`flex items-center gap-2 min-w-0 ${className}`.trim()}>
	<ToolKindIcon {kind} {status} />
	<ToolLabel {status}>
		{@render children()}
	</ToolLabel>
</div>
