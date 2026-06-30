<script lang="ts">
	import { cn } from "../../lib/utils.js";
	import { RoundedIcon } from "../icons/index.js";
	import * as DropdownMenu from "../dropdown-menu/index.js";
	import { Selector } from "../selector/index.js";
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

	const operators: SqlFilterOperator[] = [
		"equals",
		"contains",
		"starts with",
		"greater than",
		"less than",
	];

	const columnTriggerLabel = $derived(filterColumn ?? "Column");

	const filterTriggerClass =
		"h-6 min-w-0 font-mono text-[0.6875rem] rounded-md bg-muted/40 border-0 text-foreground";

	function handleColumnChange(value: string): void {
		onColumnChange(value.length > 0 ? value : null);
	}

	function handleOperatorChange(value: string): void {
		if (
			value === "equals" ||
			value === "contains" ||
			value === "starts with" ||
			value === "greater than" ||
			value === "less than"
		) {
			onOperatorChange(value);
		}
	}
</script>

<div
	class={cn(
		"shrink-0 flex flex-wrap items-center gap-1.5 px-2 py-1 border-b border-border/30 bg-muted/10",
		className
	)}
>
	<RoundedIcon name="search" class="size-2.5 shrink-0 text-muted-foreground" />

	<Selector
		align="start"
		variant="ghost"
		triggerSize="minimal"
		class="min-w-[100px] shrink-0"
		triggerClass={`${filterTriggerClass} min-w-[100px]`}
		triggerAriaLabel="Filter column"
		contentClass="min-w-[140px]"
	>
		{#snippet renderButton()}
			<span class="truncate">{columnTriggerLabel}</span>
		{/snippet}

		<DropdownMenu.RadioGroup value={filterColumn ?? ""} onValueChange={handleColumnChange}>
			<DropdownMenu.RadioItem value="">Column</DropdownMenu.RadioItem>
			{#each columns as col (col)}
				<DropdownMenu.RadioItem value={col}>{col}</DropdownMenu.RadioItem>
			{/each}
		</DropdownMenu.RadioGroup>
	</Selector>

	<Selector
		align="start"
		variant="ghost"
		triggerSize="minimal"
		class="min-w-[90px] shrink-0"
		triggerClass={`${filterTriggerClass} min-w-[90px]`}
		triggerAriaLabel="Filter operator"
		contentClass="min-w-[120px]"
	>
		{#snippet renderButton()}
			<span class="truncate">{filterOperator}</span>
		{/snippet}

		<DropdownMenu.RadioGroup value={filterOperator} onValueChange={handleOperatorChange}>
			{#each operators as op (op)}
				<DropdownMenu.RadioItem value={op}>{op}</DropdownMenu.RadioItem>
			{/each}
		</DropdownMenu.RadioGroup>
	</Selector>

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
