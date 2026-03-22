<script lang="ts">
	/**
	 * SqlStudioDataGrid — Compact monospace data table for SQL Studio.
	 * Matches the git panel's dense, monospace design language.
	 */
	import CaretUp from "phosphor-svelte/lib/CaretUp";
	import CaretDown from "phosphor-svelte/lib/CaretDown";
	import { cn } from "../../lib/utils.js";
	import type { SqlSortDirection } from "./types.js";

	interface Props {
		columns: readonly string[];
		rows: readonly { originalIndex: number; cells: readonly string[] }[];
		sortColumn: string | null;
		sortDirection: SqlSortDirection;
		readOnly: boolean;
		isCellDirty: (rowIndex: number, columnName: string) => boolean;
		getCellValue: (rowIndex: number, columnName: string) => string;
		onSortChange: (column: string) => void;
		onCellClick: (rowIndex: number, columnName: string) => void;
		class?: string;
	}

	let {
		columns,
		rows,
		sortColumn,
		sortDirection,
		readOnly,
		isCellDirty,
		getCellValue,
		onSortChange,
		onCellClick,
		class: className,
	}: Props = $props();
</script>

<div class={cn("flex-1 min-h-0 overflow-auto", className)}>
	{#if columns.length === 0}
		<div class="flex items-center justify-center h-full">
			<span class="text-[0.8125rem] text-muted-foreground">Select a table to explore</span>
		</div>
	{:else}
		<table class="w-full min-w-max border-collapse">
			<thead>
				<tr class="sticky top-0 z-10 bg-muted/95 backdrop-blur">
					{#each columns as column (column)}
						<th class="text-left whitespace-nowrap">
							<button
								type="button"
								class="inline-flex items-center gap-1 px-2 py-0.5 text-[0.625rem] font-semibold uppercase text-muted-foreground font-mono hover:text-foreground transition-colors cursor-pointer"
								onclick={() => onSortChange(column)}
							>
								{column}
								{#if sortColumn === column}
									{#if sortDirection === "asc"}
										<CaretUp size={8} weight="bold" class="text-primary" />
									{:else}
										<CaretDown size={8} weight="bold" class="text-primary" />
									{/if}
								{/if}
							</button>
						</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each rows as { originalIndex, cells } (`row-${originalIndex}`)}
					<tr class="hover:bg-muted/40 transition-colors">
						{#each columns as columnName, colIdx (`cell-${originalIndex}-${columnName}`)}
							{@const value = getCellValue(originalIndex, columnName)}
							{@const dirty = isCellDirty(originalIndex, columnName)}
							{@const isNull = value === "" || value === "NULL"}
							<td
								class={cn(
									"px-2 py-0.5 font-mono text-[0.6875rem] whitespace-nowrap transition-colors",
									dirty && "bg-amber-500/5 border-l-2 border-amber-500/40",
									readOnly ? "cursor-default" : "cursor-pointer hover:bg-muted/60",
								)}
								onclick={() => {
									if (!readOnly) onCellClick(originalIndex, columnName);
								}}
							>
								<span
									class={cn(
										"block truncate max-w-[180px]",
										isNull && "text-muted-foreground/50 italic",
									)}
									title={value}
								>
									{value || "NULL"}
								</span>
							</td>
						{/each}
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</div>
