<script lang="ts">
	/**
	 * SQL Studio demo for the homepage features section.
	 * Composed manually (without the top bar) to show the data browsing core.
	 */
	import {
		SqlStudioSidebar,
		SqlStudioToolbar,
		SqlStudioFilterBar,
		SqlStudioDataGrid,
		SqlStudioStatusBar,
		type SqlConnection,
		type SqlSchemaInfo,
		type SqlFilterOperator,
		type SqlSortDirection
	} from '@acepe/ui/sql-studio';

	const connections: SqlConnection[] = [
		{ id: '1', name: 'Production DB', engine: 'postgres', subtitle: 'db.example.com:5432' },
		{ id: '2', name: 'Local Dev', engine: 'sqlite', subtitle: 'dev.sqlite3' }
	];

	const schema: SqlSchemaInfo[] = [
		{
			name: 'public',
			tables: [
				{
					name: 'users',
					schema: 'public',
					columns: [
						{ name: 'id', dataType: 'bigint', nullable: false, isPrimaryKey: true },
						{ name: 'email', dataType: 'varchar', nullable: false, isPrimaryKey: false },
						{ name: 'name', dataType: 'varchar', nullable: true, isPrimaryKey: false },
						{ name: 'plan', dataType: 'varchar', nullable: false, isPrimaryKey: false }
					]
				},
				{
					name: 'projects',
					schema: 'public',
					columns: [
						{ name: 'id', dataType: 'bigint', nullable: false, isPrimaryKey: true },
						{ name: 'name', dataType: 'varchar', nullable: false, isPrimaryKey: false },
						{ name: 'owner_id', dataType: 'bigint', nullable: false, isPrimaryKey: false }
					]
				}
			]
		}
	];

	const columns = ['id', 'email', 'name', 'plan', 'created_at'];
	const allRows = [
		{ originalIndex: 0, cells: ['1', 'alice@example.com', 'Alice Chen', 'pro', '2025-11-02'] },
		{ originalIndex: 1, cells: ['2', 'bob@example.com', 'Bob Smith', 'free', '2025-11-05'] },
		{ originalIndex: 2, cells: ['3', 'carol@example.com', '', 'pro', '2025-12-01'] },
		{ originalIndex: 3, cells: ['4', 'dave@example.com', 'Dave Park', 'enterprise', '2026-01-10'] },
		{ originalIndex: 4, cells: ['5', 'eve@example.com', 'Eve Johnson', 'free', '2026-01-22'] }
	];

	let selectedConnectionId = $state<string | null>('1');
	let selectedSchemaName = $state<string | null>('public');
	let selectedTableName = $state<string | null>('users');
	let sortColumn = $state<string | null>('id');
	let sortDirection = $state<SqlSortDirection>('asc');
	let filterColumn = $state<string | null>(null);
	let filterOperator = $state<SqlFilterOperator>('equals');
	let filterValue = $state('');

	const rows = $derived(
		allRows.filter((row) => {
			if (!filterColumn || !filterValue) return true;
			const colIdx = columns.indexOf(filterColumn);
			if (colIdx === -1) return true;
			const cell = row.cells[colIdx] ?? '';
			return filterOperator === 'equals' ? cell === filterValue : cell.includes(filterValue);
		})
	);

	const selectedTableLabel = $derived(
		selectedSchemaName && selectedTableName ? `${selectedSchemaName}.${selectedTableName}` : null
	);
</script>

<div class="flex h-full overflow-hidden">
	<!-- Sidebar -->
	<div class="w-[200px] shrink-0 overflow-y-auto border-r border-border/30">
		<SqlStudioSidebar
			{connections}
			{selectedConnectionId}
			{schema}
			{selectedSchemaName}
			{selectedTableName}
			onConnectionSelect={(id) => (selectedConnectionId = id)}
			onConnectionCreate={() => {}}
			onConnectionDelete={() => {}}
			onTableSelect={(s, t) => {
				selectedSchemaName = s;
				selectedTableName = t;
			}}
		/>
	</div>

	<!-- Main area -->
	<div class="flex min-w-0 flex-1 flex-col overflow-hidden">
		<SqlStudioToolbar
			{selectedTableLabel}
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
			{columns}
			{filterColumn}
			{filterOperator}
			{filterValue}
			onColumnChange={(col) => (filterColumn = col || null)}
			onOperatorChange={(op) => (filterOperator = op)}
			onValueChange={(val) => (filterValue = val)}
			onClear={() => {
				filterColumn = null;
				filterValue = '';
			}}
		/>
		<div class="min-h-0 flex-1 overflow-y-auto">
			<SqlStudioDataGrid
				{columns}
				{rows}
				{sortColumn}
				{sortDirection}
				readOnly={false}
				isCellDirty={() => false}
				getCellValue={(rowIndex, columnName) => {
					const colIdx = columns.indexOf(columnName);
					return rows[rowIndex]?.cells[colIdx] ?? '';
				}}
				onSortChange={(col) => {
					if (sortColumn === col) {
						sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
					} else {
						sortColumn = col;
						sortDirection = 'asc';
					}
				}}
				onCellClick={() => {}}
			/>
		</div>
		<SqlStudioStatusBar
			rowCount={rows.length}
			hasMore={false}
			isLoadingMore={false}
			onLoadMore={() => {}}
		/>
	</div>
</div>
