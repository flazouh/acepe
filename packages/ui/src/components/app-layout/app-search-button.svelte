<script lang="ts">
	import MagnifyingGlass from "phosphor-svelte/lib/MagnifyingGlass";

	interface Props {
		label?: string;
		shortcutKey?: string;
		onclick?: () => void;
	}

	let {
		label = "Search...",
		shortcutKey = "P",
		onclick,
	}: Props = $props();
</script>

<button
	type="button"
	class="group flex items-center gap-1.5 h-6 px-2 rounded-md border border-border/60 bg-muted/30 text-muted-foreground text-[11px] hover:bg-muted/60 hover:border-border hover:text-foreground transition-all duration-150 cursor-pointer"
	{onclick}
>
	<MagnifyingGlass class="size-3 opacity-50 group-hover:opacity-80 transition-opacity" weight="bold" />
	<span class="font-medium">{label}</span>
	<kbd class="ml-0.5 inline-flex items-center gap-px">
		<kbd class="bg-background/60 border border-border/50 text-muted-foreground/70 pointer-events-none inline-flex h-[15px] min-w-[15px] items-center justify-center rounded px-0.5 font-sans text-[9px] font-medium select-none">&#8984;</kbd>
		<kbd class="bg-background/60 border border-border/50 text-muted-foreground/70 pointer-events-none inline-flex h-[15px] min-w-[15px] items-center justify-center rounded px-0.5 font-sans text-[9px] font-medium select-none">{shortcutKey}</kbd>
	</kbd>
</button>
