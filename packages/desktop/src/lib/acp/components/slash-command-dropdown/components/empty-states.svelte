<script lang="ts">
import * as m from "$lib/paraglide/messages.js";

import Header from "./header.svelte";

interface Props {
	commandsCount: number;
	query: string;
}

let { commandsCount, query }: Props = $props();
</script>

{#if commandsCount === 0}
	<!-- No commands available -->
	<div class="px-3 py-4 text-center text-sm text-muted-foreground">
		{m.slash_command_no_commands_available()}
	</div>
{:else if query.length > 0}
	<!-- Commands available but no matches -->
	<div class="px-3 py-4 text-center text-sm text-muted-foreground">
		{m.slash_command_no_results()}
	</div>
{:else}
	<!-- Commands available but empty query -->
	<Header />
	<div class="px-3 py-4 text-center text-sm text-muted-foreground">
		{m.slash_command_start_typing()}
	</div>
{/if}
