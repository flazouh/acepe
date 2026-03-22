<script lang="ts">
import * as m from "$lib/paraglide/messages.js";

interface Props {
	count?: number;
}

let { count }: Props = $props();
</script>

<div class="px-3 py-1.5 border-b bg-muted/30 flex items-center justify-between shrink-0">
	<span class="text-[11px] font-medium text-muted-foreground">
		{m.slash_command_header()}
	</span>
	{#if count !== undefined}
		<span class="text-[11px] text-muted-foreground tabular-nums">{count}</span>
	{/if}
</div>
