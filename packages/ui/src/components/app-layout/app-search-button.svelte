<script lang="ts">
	import { Button } from "../button/index.js";
	import { MagnifyingGlass } from "phosphor-svelte";

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

<Button
	type="button"
	variant="headerAction"
	size="headerAction"
	class="group h-6 gap-1.5 bg-muted/30 px-2 text-[11px] text-muted-foreground hover:bg-muted/60 hover:text-foreground"
	{onclick}
>
	<MagnifyingGlass class="size-3 opacity-50 group-hover:opacity-80 transition-opacity" weight="bold" />
	<span class="font-medium">{label}</span>
	<kbd class="ml-0.5 inline-flex items-center gap-px">
		<kbd class="bg-background/60 border border-border/50 text-muted-foreground/70 pointer-events-none inline-flex h-[15px] min-w-[15px] items-center justify-center rounded px-0.5 font-sans text-[9px] font-medium select-none">&#8984;</kbd>
		<kbd class="bg-background/60 border border-border/50 text-muted-foreground/70 pointer-events-none inline-flex h-[15px] min-w-[15px] items-center justify-center rounded px-0.5 font-sans text-[9px] font-medium select-none">{shortcutKey}</kbd>
	</kbd>
</Button>
