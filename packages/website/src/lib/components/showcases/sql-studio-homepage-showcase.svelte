<script lang="ts">
import { SqlStudioDataGrid } from "@acepe/ui/sql-studio";
import { HardDrives } from "phosphor-svelte";

interface SqlRow {
	readonly originalIndex: number;
	readonly cells: readonly string[];
}

interface Props {
	readonly columns: readonly string[];
	readonly rows: readonly SqlRow[];
	readonly tableLabel: string;
	readonly engineLabel: string;
}

	let { columns, rows, tableLabel, engineLabel }: Props = $props();

	function getCellValue(rowIndex: number, columnName: string): string {
		const columnIndex = columns.indexOf(columnName);
		return `${rows[rowIndex]?.cells[columnIndex] ?? ""}`;
	}
</script>

<div class="overflow-hidden rounded-lg border border-border/50 bg-card/30">
	<div class="flex h-7 items-center gap-2 border-b border-border/50 px-2.5">
		<HardDrives size={10} class="text-muted-foreground/60" />
		<span class="font-mono text-[10px] text-foreground">{tableLabel}</span>
		<span class="ml-auto font-mono text-[9px] text-muted-foreground/40">{engineLabel}</span>
	</div>
	<SqlStudioDataGrid
		columns={columns}
		rows={rows}
		sortColumn={null}
		sortDirection="asc"
		readOnly={true}
		isCellDirty={() => false}
		{getCellValue}
		onSortChange={() => {}}
		onCellClick={() => {}}
	/>
	<div class="flex items-center justify-between border-t border-border/30 px-2.5 py-1">
		<span class="font-mono text-[9px] text-muted-foreground/40">{rows.length} rows</span>
	</div>
</div>
