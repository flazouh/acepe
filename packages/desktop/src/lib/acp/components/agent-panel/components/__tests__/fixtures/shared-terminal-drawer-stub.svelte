<script lang="ts">
import type { Snippet } from "svelte";

interface Props {
	height: number;
	resizeHandle?: Snippet;
	tabs: Snippet;
	body: Snippet;
}

let { height, resizeHandle, tabs, body }: Props = $props();
</script>

<div data-testid="shared-terminal-drawer-stub" style={`height: ${height}px;`}>
	{#if resizeHandle}
		{@render resizeHandle()}
	{/if}
	<div data-testid="shared-terminal-drawer-tabs">
		{@render tabs()}
	</div>
	<div data-testid="shared-terminal-drawer-body">
		{@render body()}
	</div>
</div>
