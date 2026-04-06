<script lang="ts">
	import {
		SqlStudioToolbar,
		SqlStudioFilterBar,
		SqlStudioDataGrid,
		SqlStudioStatusBar,
		type SqlFilterOperator,
		type SqlSortDirection
	} from "@acepe/ui/sql-studio";

	const columns = ["id", "email", "role", "created_at", "active"] as const;

	const allRows = [
		{ originalIndex: 0, cells: ["1", "sarah@acepe.dev", "owner", "2026-02-12", "true"] },
		{ originalIndex: 1, cells: ["2", "devon@acepe.dev", "editor", "2026-02-14", "true"] },
		{ originalIndex: 2, cells: ["3", "ops@acepe.dev", "viewer", "2026-02-20", "false"] }
	] as const;

	let sortColumn = $state<string | null>("id");
	let sortDirection = $state<SqlSortDirection>("asc");
	let filterColumn = $state<string | null>(null);
	let filterOperator = $state<SqlFilterOperator>("contains");
	let filterValue = $state("");

	const rows = $derived(
		allRows.filter((row) => {
			if (!filterColumn || !filterValue) return true;

			const columnIndex = columns.indexOf(filterColumn as (typeof columns)[number]);

			if (columnIndex === -1) return true;

			const cellValue = row.cells[columnIndex] ?? "";

			if (filterOperator === "equals") return cellValue === filterValue;
			if (filterOperator === "starts with") return cellValue.startsWith(filterValue);
			if (filterOperator === "greater than") return cellValue > filterValue;
			if (filterOperator === "less than") return cellValue < filterValue;

			return cellValue.includes(filterValue);
		})
	);

	function getCellValue(rowIndex: number, columnName: string): string {
		const columnIndex = columns.indexOf(columnName as (typeof columns)[number]);

		return rows[rowIndex]?.cells[columnIndex] ?? "";
	}

	function handleSortChange(column: string): void {
		if (sortColumn === column) {
			sortDirection = sortDirection === "asc" ? "desc" : "asc";
			return;
		}

		sortColumn = column;
		sortDirection = "asc";
	}
</script>

<div class="overflow-hidden rounded-lg border border-border/50 bg-card/30">
	<SqlStudioToolbar
		selectedTableLabel="public.users"
		pendingEditCount={0}
		isSaving={false}
		sqlEditorOpen={false}
		isExecutingQuery={false}
		hasConnection={true}
		lastInfo={null}
		onSaveEdits={() => {}}
		onDiscardEdits={() => {}}
		onToggleSqlEditor={() => {}}
		onRunQuery={() => {}}
	/>

	<SqlStudioFilterBar
		columns={columns}
		{filterColumn}
		{filterOperator}
		{filterValue}
		onColumnChange={(column) => {
			filterColumn = column;
		}}
		onOperatorChange={(operator) => {
			filterOperator = operator;
		}}
		onValueChange={(value) => {
			filterValue = value;
		}}
		onClear={() => {
			filterColumn = null;
			filterOperator = "contains";
			filterValue = "";
		}}
	/>

	<SqlStudioDataGrid
		columns={columns}
		{rows}
		{sortColumn}
		{sortDirection}
		readOnly={true}
		isCellDirty={() => false}
		{getCellValue}
		onSortChange={handleSortChange}
		onCellClick={() => {}}
	/>

	<SqlStudioStatusBar
		rowCount={rows.length}
		hasMore={false}
		isLoadingMore={false}
		onLoadMore={() => {}}
	/>
</div>
