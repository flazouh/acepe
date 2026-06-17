<script lang="ts">
import type { Snippet } from "svelte";

interface Props {
	children?: Snippet;
	header?: Snippet;
	collapsed?: boolean;
	headerLabel?: string;
	onCollapseChange?: (collapsed: boolean) => void;
	showHeader?: boolean;
}

let {
	children,
	header,
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
			{#if header}
				{@render header()}
			{:else}
				{headerLabel}
			{/if}
		</button>
	{/if}

	{#if !collapsed && children}
		{@render children()}
	{/if}
</div>
