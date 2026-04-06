<script lang="ts">
import { AppSessionItem } from "@acepe/ui/app-layout";
import type { AppSessionItemType } from "@acepe/ui/app-layout";
import { MagnifyingGlass } from "phosphor-svelte";

interface Props {
	readonly sessions: readonly AppSessionItemType[];
}

	let { sessions }: Props = $props();
</script>

<div class="overflow-hidden rounded-lg border border-border/50 bg-card/30">
	<div class="flex h-7 items-center border-b border-border/50 px-2.5">
		<div class="flex flex-1 items-center gap-2 rounded-md bg-muted/30 px-2 py-0.5">
			<MagnifyingGlass size={10} class="text-muted-foreground/50" />
			<span class="font-mono text-[10px] text-muted-foreground/50">Search sessions...</span>
		</div>
	</div>
	<div class="p-1">
		{#each sessions as session (session.id)}
			<AppSessionItem {session} />
		{/each}
	</div>
</div>
