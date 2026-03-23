<script lang="ts">
	/**
	 * Demo: SQL Studio — interactive connections, schema browsing, and data grid.
	 * All mock data, no backend needed.
	 */
	import {
		SqlStudioLayout,
		type SqlConnection,
		type SqlSchemaInfo,
		type SqlFilterOperator,
		type SqlSortDirection
	} from '@acepe/ui/sql-studio';

	// --- Mock data ---

	const mockConnections: SqlConnection[] = [
		{ id: 'pg-1', name: 'Production DB', engine: 'postgres', subtitle: 'db.example.com:5432/myapp' },
		{ id: 'sqlite-1', name: 'Local Dev', engine: 'sqlite', subtitle: 'dev.sqlite3' },
		{ id: 'mysql-1', name: 'Analytics', engine: 'mysql', subtitle: 'analytics.internal:3306/stats' }
	];

	const mockSchemas: Record<string, SqlSchemaInfo[]> = {
		'pg-1': [
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
							{ name: 'created_at', dataType: 'timestamptz', nullable: false, isPrimaryKey: false },
							{ name: 'plan', dataType: 'varchar', nullable: false, isPrimaryKey: false }
						]
					},
					{
						name: 'projects',
						schema: 'public',
						columns: [
							{ name: 'id', dataType: 'bigint', nullable: false, isPrimaryKey: true },
							{ name: 'name', dataType: 'varchar', nullable: false, isPrimaryKey: false },
							{ name: 'owner_id', dataType: 'bigint', nullable: false, isPrimaryKey: false },
							{ name: 'status', dataType: 'varchar', nullable: false, isPrimaryKey: false }
						]
					},
					{
						name: 'sessions',
						schema: 'public',
						columns: [
							{ name: 'id', dataType: 'uuid', nullable: false, isPrimaryKey: true },
							{ name: 'user_id', dataType: 'bigint', nullable: false, isPrimaryKey: false },
							{ name: 'project_id', dataType: 'bigint', nullable: false, isPrimaryKey: false },
							{ name: 'title', dataType: 'text', nullable: true, isPrimaryKey: false },
							{ name: 'created_at', dataType: 'timestamptz', nullable: false, isPrimaryKey: false }
						]
					}
				]
			}
		],
		'sqlite-1': [
			{
				name: 'main',
				tables: [
					{
						name: 'tasks',
						schema: 'main',
						columns: [
							{ name: 'id', dataType: 'integer', nullable: false, isPrimaryKey: true },
							{ name: 'title', dataType: 'text', nullable: false, isPrimaryKey: false },
							{ name: 'done', dataType: 'boolean', nullable: false, isPrimaryKey: false }
						]
					}
				]
			}
		],
		'mysql-1': [
			{
				name: 'stats',
				tables: [
					{
						name: 'events',
						schema: 'stats',
						columns: [
							{ name: 'id', dataType: 'bigint', nullable: false, isPrimaryKey: true },
							{ name: 'event_type', dataType: 'varchar', nullable: false, isPrimaryKey: false },
							{ name: 'user_id', dataType: 'bigint', nullable: true, isPrimaryKey: false },
							{ name: 'payload', dataType: 'json', nullable: true, isPrimaryKey: false },
							{ name: 'created_at', dataType: 'datetime', nullable: false, isPrimaryKey: false }
						]
					}
				]
			}
		]
	};

	type MockRow = Record<string, string[][]>;

	const mockRows: MockRow = {
		'public.users': [
			['1', 'alice@example.com', 'Alice Chen', '2025-11-02 09:14:22', 'pro'],
			['2', 'bob@example.com', 'Bob Smith', '2025-11-05 14:30:01', 'free'],
			['3', 'carol@example.com', 'Carol Davis', '2025-12-01 08:45:33', 'pro'],
			['4', 'dave@example.com', '', '2026-01-10 16:22:10', 'enterprise'],
			['5', 'eve@example.com', 'Eve Wilson', '2026-01-15 11:08:44', 'free'],
			['6', 'frank@example.com', 'Frank Lee', '2026-02-01 13:55:18', 'pro'],
			['7', 'grace@example.com', 'Grace Kim', '2026-02-10 07:30:00', 'free'],
			['8', 'hank@example.com', 'Hank Brown', '2026-02-14 22:12:05', 'pro']
		],
		'public.projects': [
			['1', 'Acepe Desktop', '1', 'active'],
			['2', 'API Gateway', '2', 'active'],
			['3', 'Analytics Dashboard', '3', 'archived'],
			['4', 'Mobile App', '1', 'active'],
			['5', 'Documentation Site', '4', 'active']
		],
		'public.sessions': [
			['a1b2c3d4', '1', '1', 'Refactor auth module', '2026-02-20 10:00:00'],
			['e5f6g7h8', '2', '2', 'Fix rate limiter', '2026-02-20 11:30:00'],
			['i9j0k1l2', '1', '1', '', '2026-02-21 09:15:00'],
			['m3n4o5p6', '3', '3', 'Add chart exports', '2026-02-21 14:45:00']
		],
		'main.tasks': [
			['1', 'Set up CI pipeline', 'true'],
			['2', 'Write integration tests', 'false'],
			['3', 'Deploy staging', 'false']
		],
		'stats.events': [
			['1', 'page_view', '1', '{"path": "/dashboard"}', '2026-02-20 10:00:00'],
			['2', 'click', '2', '{"button": "upgrade"}', '2026-02-20 10:05:00'],
			['3', 'page_view', '', '{"path": "/pricing"}', '2026-02-20 10:10:00'],
			['4', 'signup', '3', '{"plan": "pro"}', '2026-02-20 10:15:00'],
			['5', 'click', '1', '{"button": "new_project"}', '2026-02-20 10:20:00']
		]
	};

	// --- State ---

	let connections = $state<SqlConnection[]>([...mockConnections]);
	let selectedConnectionId = $state<string | null>('pg-1');
	let selectedSchemaName = $state<string | null>('public');
	let selectedTableName = $state<string | null>('users');

	let sortColumn = $state<string | null>(null);
	let sortDirection = $state<SqlSortDirection>('asc');
	let filterColumn = $state<string | null>(null);
	let filterOperator = $state<SqlFilterOperator>('contains');
	let filterValue = $state('');

	let sqlEditorOpen = $state(false);
	let sqlEditorText = $state('SELECT * FROM users WHERE plan = \'pro\' LIMIT 10;');
	let lastInfo = $state<string | null>('Connected to Production DB');
	let lastError = $state<string | null>(null);
	let pendingEdits = $state<Map<string, string>>(new Map());

	// --- Derived ---

	const schema = $derived(
		selectedConnectionId ? (mockSchemas[selectedConnectionId] ?? []) : []
	);

	const tableKey = $derived(
		selectedSchemaName && selectedTableName
			? `${selectedSchemaName}.${selectedTableName}`
			: null
	);

	const currentTable = $derived(
		schema
			.flatMap((s) => s.tables)
			.find(
				(t) => t.schema === selectedSchemaName && t.name === selectedTableName
			)
	);

	const columns = $derived(currentTable?.columns.map((c) => c.name) ?? []);

	const rawRows = $derived(tableKey ? (mockRows[tableKey] ?? []) : []);

	const sortedRows = $derived.by(() => {
		if (!sortColumn) return rawRows;
		const colIdx = columns.indexOf(sortColumn);
		if (colIdx === -1) return rawRows;
		return [...rawRows].sort((a, b) => {
			const aVal = a[colIdx] ?? '';
			const bVal = b[colIdx] ?? '';
			const cmp = aVal.localeCompare(bVal, undefined, { numeric: true });
			return sortDirection === 'asc' ? cmp : -cmp;
		});
	});

	const filteredRows = $derived.by(() => {
		if (!filterColumn || !filterValue) return sortedRows;
		const colIdx = columns.indexOf(filterColumn);
		if (colIdx === -1) return sortedRows;
		return sortedRows.filter((row) => {
			const val = (row[colIdx] ?? '').toLowerCase();
			const search = filterValue.toLowerCase();
			switch (filterOperator) {
				case 'equals':
					return val === search;
				case 'contains':
					return val.includes(search);
				case 'starts with':
					return val.startsWith(search);
				case 'greater than':
					return val > search;
				case 'less than':
					return val < search;
				default:
					return true;
			}
		});
	});

	const processedRows = $derived(
		filteredRows.map((cells, i) => ({ originalIndex: i, cells }))
	);

	// --- Handlers ---

	function handleConnectionSelect(id: string) {
		selectedConnectionId = id;
		selectedSchemaName = null;
		selectedTableName = null;
		sortColumn = null;
		filterColumn = null;
		filterValue = '';
		pendingEdits = new Map();
		lastError = null;
		const conn = connections.find((c) => c.id === id);
		lastInfo = conn ? `Connected to ${conn.name}` : null;

		// Auto-select first schema/table
		const schemas = mockSchemas[id] ?? [];
		if (schemas.length > 0 && schemas[0].tables.length > 0) {
			selectedSchemaName = schemas[0].name;
			selectedTableName = schemas[0].tables[0].name;
		}
	}

	function handleConnectionCreate() {
		lastInfo = 'Connection dialog would open here';
	}

	function handleConnectionDelete(id: string) {
		connections = connections.filter((c) => c.id !== id);
		if (selectedConnectionId === id) {
			selectedConnectionId = null;
			selectedSchemaName = null;
			selectedTableName = null;
		}
	}

	function handleTableSelect(schemaName: string, tableName: string) {
		selectedSchemaName = schemaName;
		selectedTableName = tableName;
		sortColumn = null;
		filterColumn = null;
		filterValue = '';
		pendingEdits = new Map();
		lastError = null;
	}

	function handleCellClick(rowIndex: number, columnName: string) {
		const key = `${rowIndex}:${columnName}`;
		if (pendingEdits.has(key)) {
			const next = new Map(pendingEdits);
			next.delete(key);
			pendingEdits = next;
		} else {
			pendingEdits = new Map(pendingEdits).set(key, '(edited)');
		}
	}

	function handleSortChange(column: string) {
		if (sortColumn === column) {
			sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
		} else {
			sortColumn = column;
			sortDirection = 'asc';
		}
	}

	function handleSaveEdits() {
		lastInfo = `Saved ${pendingEdits.size} edit${pendingEdits.size === 1 ? '' : 's'}`;
		pendingEdits = new Map();
	}

	function handleDiscardEdits() {
		pendingEdits = new Map();
	}

	function handleRunQuery() {
		lastInfo = `Query executed — ${processedRows.length} rows returned`;
	}

	function handleClose() {
		lastInfo = 'Close would navigate back to app';
	}
</script>

<p class="demo-hint">
	Interactive demo — select connections, browse tables, click cells to mark edits, sort columns, and filter rows.
</p>

<div class="studio-wrapper">
		<SqlStudioLayout
			{connections}
			{selectedConnectionId}
			{schema}
			{selectedSchemaName}
			{selectedTableName}
			{columns}
			rows={processedRows}
			isLoading={false}
			rowCount={processedRows.length}
			hasMore={false}
			isLoadingMore={false}
			{sortColumn}
			{sortDirection}
			{filterColumn}
			{filterOperator}
			{filterValue}
			pendingEditCount={pendingEdits.size}
			isSaving={false}
			readOnlyReason={null}
			isCellDirty={(rowIndex, columnName) => pendingEdits.has(`${rowIndex}:${columnName}`)}
			getCellValue={(rowIndex, columnName) => {
				const key = `${rowIndex}:${columnName}`;
				if (pendingEdits.has(key)) return pendingEdits.get(key) ?? '';
				const colIdx = columns.indexOf(columnName);
				return processedRows[rowIndex]?.cells[colIdx] ?? '';
			}}
			{lastError}
			{lastInfo}
			{sqlEditorOpen}
			isExecutingQuery={false}
			onConnectionSelect={handleConnectionSelect}
			onConnectionCreate={handleConnectionCreate}
			onConnectionDelete={handleConnectionDelete}
			onTableSelect={handleTableSelect}
			onCellClick={handleCellClick}
			onSortChange={handleSortChange}
			onFilterColumnChange={(col) => (filterColumn = col)}
			onFilterOperatorChange={(op) => (filterOperator = op)}
			onFilterValueChange={(val) => (filterValue = val)}
			onFilterClear={() => {
				filterColumn = null;
				filterValue = '';
			}}
			onLoadMore={() => {}}
			onSaveEdits={handleSaveEdits}
			onDiscardEdits={handleDiscardEdits}
			onToggleSqlEditor={() => (sqlEditorOpen = !sqlEditorOpen)}
			onRunQuery={handleRunQuery}
			onClose={handleClose}
		>
			{#snippet sqlEditorContent()}
				<textarea
					class="h-full w-full resize-none bg-transparent p-3 font-mono text-[0.75rem] text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
					placeholder="SELECT * FROM ..."
					bind:value={sqlEditorText}
				></textarea>
			{/snippet}
		</SqlStudioLayout>
</div>

<style>
	.demo-hint {
		margin-bottom: 1rem;
		padding: 0.75rem;
		border-radius: 0.375rem;
		background: hsl(var(--muted) / 0.5);
		color: hsl(var(--muted-foreground));
		font-size: 0.875rem;
		text-align: center;
	}

	.studio-wrapper {
		height: 560px;
		border-radius: 0.5rem;
		border: 1px solid hsl(var(--border) / 0.3);
		overflow: hidden;
	}
</style>
