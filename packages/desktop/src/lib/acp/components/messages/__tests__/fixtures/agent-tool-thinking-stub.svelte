<script lang="ts">
import type { Snippet } from "svelte";

interface Props {
	children?: Snippet;
	collapsed?: boolean;
	headerLabel?: string;
	onCollapseChange?: (collapsed: boolean) => void;
	showHeader?: boolean;
}

let {
	children,
	collapsed = false,
	headerLabel = "Thought for 0s",
	onCollapseChange,
	showHeader = true,
}: Props = $props();
</script>

<div data-testid="agent-tool-thinking-stub" data-collapsed={collapsed ? "true" : "false"}>
	{#if showHeader}
		<button
			type="button"
			data-testid="agent-tool-thinking-toggle"
			onclick={() => {
				onCollapseChange?.(!collapsed);
			}}
		>
			{headerLabel}
		</button>
	{/if}

	{#if !collapsed && children}
		{@render children()}
	{/if}
</div>
