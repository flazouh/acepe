<script lang="ts">
import { MagnifyingGlass } from "phosphor-svelte";

interface CommandPaletteItem {
	readonly id: string;
	readonly label: string;
	readonly shortcut: string;
}

interface Props {
	readonly commands: readonly CommandPaletteItem[];
}

	let { commands }: Props = $props();
</script>

<div class="overflow-hidden rounded-lg border border-border/50 bg-card/30 shadow-lg">
	<div class="flex items-center gap-2 border-b border-border/50 px-3 py-2">
		<MagnifyingGlass size={12} class="text-muted-foreground/50" />
		<span class="font-mono text-[11px] text-muted-foreground/50">Type a command...</span>
	</div>
	{#each commands as command, index (command.id)}
		<div class={`flex items-center justify-between px-3 py-1.5 ${index === 0 ? "bg-muted/30" : ""}`}>
			<span class="font-mono text-[11px] text-foreground">{command.label}</span>
			<kbd class="rounded bg-muted/50 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">
				{command.shortcut}
			</kbd>
		</div>
	{/each}
</div>
