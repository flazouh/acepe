<script lang="ts">
import BlogPostLayout from "$lib/blog/blog-post-layout.svelte";
import { sqlStudioBlogPost as metadata } from "$lib/blog/posts.js";
import Card from "$lib/components/ui/card/card.svelte";
import { MarkdownDisplay } from "@acepe/ui";
import SqlStudioDemo from "$lib/blog/demos/sql-studio-demo.svelte";
import {
	SqlConnectionBadge,
	SqlStudioSidebar,
	SqlStudioDataGrid,
	SqlStudioToolbar,
	SqlStudioFilterBar,
	SqlStudioStatusBar,
	type SqlSchemaInfo,
} from "@acepe/ui/sql-studio";

let { data } = $props();

// --- Demo state for individual component showcases ---

const demoSchema: SqlSchemaInfo[] = [
	{
		name: "public",
		tables: [
			{
				name: "users",
				schema: "public",
				columns: [
					{ name: "id", dataType: "bigint", nullable: false, isPrimaryKey: true },
					{ name: "email", dataType: "varchar", nullable: false, isPrimaryKey: false },
					{ name: "name", dataType: "varchar", nullable: true, isPrimaryKey: false },
				],
			},
			{
				name: "projects",
				schema: "public",
				columns: [
					{ name: "id", dataType: "bigint", nullable: false, isPrimaryKey: true },
					{ name: "name", dataType: "varchar", nullable: false, isPrimaryKey: false },
					{ name: "status", dataType: "varchar", nullable: false, isPrimaryKey: false },
				],
			},
		],
	},
];

const demoColumns = ["id", "email", "name", "created_at", "plan"];
const demoRows = [
	{ originalIndex: 0, cells: ["1", "alice@example.com", "Alice Chen", "2025-11-02", "pro"] },
	{ originalIndex: 1, cells: ["2", "bob@example.com", "Bob Smith", "2025-11-05", "free"] },
	{ originalIndex: 2, cells: ["3", "carol@example.com", "", "2025-12-01", "pro"] },
	{ originalIndex: 3, cells: ["4", "dave@example.com", "Dave Park", "2026-01-10", "enterprise"] },
];
</script>

<BlogPostLayout
	{metadata}
	showDownload={data.featureFlags.downloadEnabled}
	showLogin={data.featureFlags.loginEnabled}
>
	<MarkdownDisplay
		content={`
# SQL Studio

Most AI coding tools don't talk to your database at all — you're left copying query results into prompts. Acepe's SQL Studio is a built-in database browser that connects to Postgres, MySQL, and SQLite, letting you explore schemas, filter data, and run queries without leaving context.

## Full Interactive Demo

Connect to databases, browse schemas, click cells to edit, sort and filter — all backed by mock data.
	`}
	/>

	<Card class="mx-auto max-w-5xl">
		<SqlStudioDemo />
	</Card>

	<MarkdownDisplay
		content={`
## Components

Every piece of SQL Studio is a standalone shared component. Here's each one in action.

### Connection Badge

Shows a database connection with its engine type. Compact and monospaced.
	`}
	/>

	<Card class="mx-auto max-w-[560px]">
		<div class="flex flex-wrap items-center gap-3">
			<SqlConnectionBadge name="Production DB" engine="postgres" />
			<SqlConnectionBadge name="Local Dev" engine="sqlite" />
			<SqlConnectionBadge name="Analytics" engine="mysql" />
		</div>
	</Card>

	<MarkdownDisplay
		content={`
### Sidebar

Connections list with color-coded dots, engine badges, and a collapsible schema tree with primary key indicators.
	`}
	/>

	<Card class="mx-auto max-w-[560px] max-h-[320px] overflow-y-auto">
		<SqlStudioSidebar
			connections={[
				{ id: '1', name: 'Production DB', engine: 'postgres', subtitle: 'db.example.com:5432' },
				{ id: '2', name: 'Local Dev', engine: 'sqlite', subtitle: 'dev.sqlite3' }
			]}
			selectedConnectionId="1"
			schema={demoSchema}
			selectedSchemaName="public"
			selectedTableName="users"
			onConnectionSelect={() => {}}
			onConnectionCreate={() => {}}
			onConnectionDelete={() => {}}
			onTableSelect={() => {}}
		/>
	</Card>

	<MarkdownDisplay
		content={`
### Toolbar

Action bar with table label, save/discard buttons for pending edits, and SQL editor toggle with run button.
	`}
	/>

	<Card class="mx-auto max-w-[560px]">
		<SqlStudioToolbar
			selectedTableLabel="public.users"
			pendingEditCount={3}
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
	</Card>

	<MarkdownDisplay
		content={`
### Filter Bar

Column filter with native selects for column and operator, inline text input, and clear button.
	`}
	/>

	<Card class="mx-auto max-w-[560px]">
		<SqlStudioFilterBar
			columns={demoColumns}
			filterColumn="plan"
			filterOperator="equals"
			filterValue="pro"
			onColumnChange={() => {}}
			onOperatorChange={() => {}}
			onValueChange={() => {}}
			onClear={() => {}}
		/>
	</Card>

	<MarkdownDisplay
		content={`
### Data Grid

Compact monospace data table with sortable column headers, clickable cells, NULL styling, and dirty cell indicators.
	`}
	/>

	<Card class="mx-auto max-w-[560px] max-h-[320px] overflow-y-auto">
		<SqlStudioDataGrid
			columns={demoColumns}
			rows={demoRows}
			sortColumn="id"
			sortDirection="asc"
			readOnly={false}
			isCellDirty={(rowIndex: number, columnName: string) => rowIndex === 2 && columnName === 'name'}
			getCellValue={(rowIndex: number, columnName: string) => {
				const colIdx = demoColumns.indexOf(columnName);
				return demoRows[rowIndex]?.cells[colIdx] ?? '';
			}}
			onSortChange={() => {}}
			onCellClick={() => {}}
		/>
	</Card>

	<MarkdownDisplay
		content={`
### Status Bar

Row count and load-more button for paginated results.
	`}
	/>

	<Card class="mx-auto max-w-[560px]">
		<SqlStudioStatusBar
			rowCount={8}
			hasMore={true}
			isLoadingMore={false}
			onLoadMore={() => {}}
		/>
	</Card>

	<MarkdownDisplay
		content={`
## How It Works

SQL Studio opens as a full-screen overlay from the sidebar. Every component is presentational — props in, callbacks out. The desktop app wires them to Tauri commands that run real database operations in Rust via the \`sqlx\` crate.

- **Connect** — add Postgres, MySQL, or SQLite connections with one click
- **Browse** — expand schemas and tables in the sidebar tree
- **Explore** — view rows in a dense, sortable, filterable data grid
- **Edit** — click any cell to edit, then save or discard changes
- **Query** — toggle the SQL editor to run raw queries

This blog page uses the same shared components with mock data — the identical code runs inside Acepe with real database connections.
	`}
	/>
</BlogPostLayout>
