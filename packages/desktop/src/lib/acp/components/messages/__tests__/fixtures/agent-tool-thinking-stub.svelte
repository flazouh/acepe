<script lang="ts">
import type { Snippet } from "svelte";

interface Props {
	children?: Snippet;
	collapsed?: boolean;
	headerLabel?: string;
	showHeader?: boolean;
}

let { children, collapsed = false, headerLabel = "Thought for 0s", showHeader = true }: Props = $props();
</script>

<div data-testid="agent-tool-thinking-stub" data-collapsed={collapsed ? "true" : "false"}>
	{#if showHeader}
		<div>{headerLabel}</div>
	{/if}

	{#if !collapsed && children}
		{@render children()}
	{/if}
</div>
