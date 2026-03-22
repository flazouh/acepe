<script lang="ts">
	import HardDrives from "phosphor-svelte/lib/HardDrives";
	import { cn } from "../../lib/utils.js";
	import type { SqlDbEngine } from "./types.js";

	interface Props {
		engine: SqlDbEngine;
		name: string;
		onclick?: () => void;
		class?: string;
	}

	let { engine, name, onclick, class: className }: Props = $props();
</script>

<button
	type="button"
	class={cn(
		"inline-flex items-center gap-1.5 rounded-md px-2 py-1 bg-muted/50 transition-colors",
		onclick ? "hover:bg-muted/80 cursor-pointer" : "cursor-default",
		className,
	)}
	onclick={onclick}
>
	<HardDrives size={14} weight="bold" class="shrink-0 text-muted-foreground" />
	<span class="font-mono text-[0.75rem] font-medium truncate max-w-[160px]">{name}</span>
	<span class="text-[0.5625rem] uppercase text-muted-foreground font-mono shrink-0">{engine}</span>
</button>
