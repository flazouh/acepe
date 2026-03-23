<script lang="ts">
	import MagnifyingGlass from "phosphor-svelte/lib/MagnifyingGlass";
	import { cn } from "../../lib/utils.js";
	import type { SqlFilterOperator } from "./types.js";

	interface Props {
		columns: readonly string[];
		filterColumn: string | null;
		filterOperator: SqlFilterOperator;
		filterValue: string;
		onColumnChange: (column: string | null) => void;
		onOperatorChange: (op: SqlFilterOperator) => void;
		onValueChange: (value: string) => void;
		onClear: () => void;
		class?: string;
	}

	let {
		columns,
		filterColumn,
		filterOperator,
		filterValue,
		onColumnChange,
		onOperatorChange,
		onValueChange,
		onClear,
		class: className,
	}: Props = $props();

	const operators: SqlFilterOperator[] = ["equals", "contains", "starts with", "greater than", "less than"];
</script>

<div class={cn("shrink-0 flex flex-wrap items-center gap-1.5 px-2 py-1 border-b border-border/30 bg-muted/10", className)}>
	<MagnifyingGlass size={10} weight="bold" class="shrink-0 text-muted-foreground" />

	<select
		class="h-6 px-2 py-0.5 text-[0.6875rem] font-mono rounded-md bg-muted/40 border-0 text-foreground cursor-pointer appearance-none min-w-[100px]"
		value={filterColumn ?? ""}
		onchange={(e) => onColumnChange(e.currentTarget.value || null)}
	>
		<option value="">Column</option>
		{#each columns as col (col)}
			<option value={col}>{col}</option>
		{/each}
	</select>

	<select
		class="h-6 px-2 py-0.5 text-[0.6875rem] font-mono rounded-md bg-muted/40 border-0 text-foreground cursor-pointer appearance-none min-w-[90px]"
		value={filterOperator}
		onchange={(e) => onOperatorChange(e.currentTarget.value as SqlFilterOperator)}
	>
		{#each operators as op (op)}
			<option value={op}>{op}</option>
		{/each}
	</select>

	<input
		type="text"
		class="h-6 flex-1 min-w-[80px] px-2 text-[0.6875rem] font-mono bg-transparent border-b border-border/30 focus:border-primary/50 focus:outline-none text-foreground placeholder:text-muted-foreground/50"
		placeholder="e.g. 11"
		value={filterValue}
		oninput={(e) => onValueChange(e.currentTarget.value)}
	/>

	<button
		type="button"
		class="text-[0.625rem] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded transition-colors cursor-pointer"
		onclick={onClear}
	>
		Clear
	</button>
</div>
