<script lang="ts">
/**
 * SQL Studio Page — Smart wrapper that connects @acepe/ui SqlStudioLayout
 * to Tauri backend SQL commands. Manages reactive state, data mapping,
 * and desktop-only dialogs (connection form, cell edit, delete confirmation).
 */

import {
	CloseAction,
	EmbeddedPanelHeader,
	HeaderActionCell,
	HeaderTitleCell,
} from "@acepe/ui/panel-header";
import type { SqlConnection, SqlFilterOperator, SqlSchemaInfo } from "@acepe/ui/sql-studio";
import { SqlStudioLayout } from "@acepe/ui/sql-studio";
import ArrowCounterClockwise from "phosphor-svelte/lib/ArrowCounterClockwise";
import ArrowUp from "phosphor-svelte/lib/ArrowUp";
import Database from "phosphor-svelte/lib/Database";
import DownloadSimple from "phosphor-svelte/lib/DownloadSimple";
import Eye from "phosphor-svelte/lib/Eye";
import FloppyDisk from "phosphor-svelte/lib/FloppyDisk";
import FolderOpen from "phosphor-svelte/lib/FolderOpen";
import Lightning from "phosphor-svelte/lib/Lightning";
import X from "phosphor-svelte/lib/X";
import { onMount } from "svelte";
import { toast } from "svelte-sonner";
import { getWorkspaceStore } from "$lib/acp/store/workspace-store.svelte.js";
import * as AlertDialog from "$lib/components/ui/alert-dialog/index.js";
import { CodeMirrorEditor } from "$lib/components/ui/codemirror-editor/index.js";
import * as Dialog from "$lib/components/ui/dialog/index.js";
import {
	type ConnectionFormInput,
	type DbEngine,
	getSqlStudioStore,
	sqlStudioApi,
} from "$lib/sql-studio/index.js";

import SqlStudioCellEditDialog, { type CellEditState } from "./sql-studio-cell-edit-dialog.svelte";

interface Props {
	onClose: () => void;
}

let { onClose }: Props = $props();

const store = getSqlStudioStore();
const workspaceStore = getWorkspaceStore();

// ─── Local State ─────────────────────────────────────────────────────

let sql = $state("SELECT *\nFROM sqlite_master\nLIMIT 50;");
let sqlEditorOpen = $state(false);
let createDialogOpen = $state(false);
let testingConnection = $state(false);
let cellEditOpen = $state(false);
let editingCell = $state<CellEditState | null>(null);
let deleteConfirmOpen = $state(false);
let deleteTargetId = $state<string | null>(null);

// Connection form state
let connectionName = $state("");
let connectionString = $state("");
let connectionStringError = $state<string | null>(null);
let connectionEngine = $state<DbEngine>("sqlite");
let connectionHost = $state("");
let connectionPort = $state("");
let connectionDatabase = $state("");
let connectionUsername = $state("");
let connectionPassword = $state("");
let connectionFilePath = $state("");
let connectionSslMode = $state("");
let connectionS3Region = $state("");
let connectionS3EndpointUrl = $state("");
let connectionS3AccessKeyId = $state("");
let connectionS3SecretAccessKey = $state("");
let connectionS3SessionToken = $state("");
let connectionS3DefaultPrefix = $state("");
let connectionS3ForcePathStyle = $state(false);

onMount(() => {
	store.queryText = sql;
	store.loadConnections().mapErr(() => {});
});

// ─── Derived: Map Store → UI Types ───────────────────────────────────

const uiConnections: SqlConnection[] = $derived(
	store.connections.map((c) => ({
		id: c.id,
		name: c.name,
		engine: c.engine as SqlConnection["engine"],
		subtitle: c.subtitle,
	}))
);

const uiSchema: SqlSchemaInfo[] = $derived(
	store.schema.map((s) => ({
		name: s.name,
		tables: s.tables.map((t) => ({
			name: t.name,
			schema: t.schema,
			columns: t.columns.map((c) => ({
				name: c.name,
				dataType: c.dataType,
				nullable: c.nullable,
				isPrimaryKey: c.isPrimaryKey,
			})),
		})),
	}))
);

const selectedTableColumns = $derived.by(() => {
	const schemaName = store.selectedSchemaName;
	const tableName = store.selectedTableName;
	if (!schemaName || !tableName) return [];
	const schemaNode = store.schema.find((s) => s.name === schemaName);
	const tableNode = schemaNode?.tables.find((t) => t.name === tableName);
	return tableNode?.columns ?? [];
});

// ─── Sort & Filter Logic ─────────────────────────────────────────────

const sortedExplorerRows = $derived.by(() => {
	const col = store.sortColumn;
	const dir = store.sortDirection;
	const cols = store.explorerColumns;
	const rows = store.explorerRows;
	if (!col || cols.length === 0) {
		return rows.map((row, i) => ({ originalIndex: i, cells: [...row] }));
	}
	const colIndex = cols.indexOf(col);
	if (colIndex < 0) {
		return rows.map((row, i) => ({ originalIndex: i, cells: [...row] }));
	}
	return [...rows]
		.map((row, i) => ({ originalIndex: i, cells: [...row] }))
		.sort((a, b) => {
			const va = a.cells[colIndex] ?? "";
			const vb = b.cells[colIndex] ?? "";
			const c = va.localeCompare(vb, undefined, { numeric: true });
			return dir === "asc" ? c : -c;
		});
});

function matchesFilter(cells: readonly string[]): boolean {
	const fCol = store.filterColumn;
	const fVal = store.filterValue.trim();
	if (!fCol || fVal === "") return true;
	const colIndex = store.explorerColumns.indexOf(fCol);
	if (colIndex < 0) return true;
	const cell = cells[colIndex] ?? "";
	switch (store.filterOperator) {
		case "equals":
			return cell === fVal;
		case "contains":
			return cell.toLowerCase().includes(fVal.toLowerCase());
		case "starts with":
			return cell.toLowerCase().startsWith(fVal.toLowerCase());
		case "greater than":
			return cell.localeCompare(fVal, undefined, { numeric: true }) > 0;
		case "less than":
			return cell.localeCompare(fVal, undefined, { numeric: true }) < 0;
		default:
			return true;
	}
}

const processedRows = $derived(sortedExplorerRows.filter(({ cells }) => matchesFilter(cells)));

// ─── Callbacks for SqlStudioLayout ────────────────────────────────────

function handleConnectionSelect(id: string): void {
	store.selectConnection(id).mapErr(() => {});
	workspaceStore.persist();
}

function handleConnectionCreate(): void {
	createDialogOpen = true;
}

function handleConnectionDelete(id: string): void {
	deleteTargetId = id;
	deleteConfirmOpen = true;
}

function handleTableSelect(schemaName: string, tableName: string): void {
	editingCell = null;
	cellEditOpen = false;
	store.selectTable(schemaName, tableName).mapErr(() => {});
	workspaceStore.persist();
}

function handleS3BucketSelect(bucketName: string): void {
	store.selectTable("buckets", bucketName).mapErr(() => {});
	workspaceStore.persist();
}

function handleCellClick(rowIndex: number, columnName: string): void {
	if (store.explorerReadOnlyReason !== null) return;
	const dataType = selectedTableColumns.find((c) => c.name === columnName)?.dataType ?? "";
	editingCell = {
		rowIndex,
		columnName,
		columnDataType: dataType,
		value: store.getExplorerCellValue(rowIndex, columnName),
	};
	cellEditOpen = true;
}

function handleSortChange(column: string): void {
	store.setSortColumn(column);
}

function handleFilterColumnChange(column: string | null): void {
	store.filterColumn = column;
}

function handleFilterOperatorChange(op: SqlFilterOperator): void {
	store.filterOperator = op;
}

function handleFilterValueChange(value: string): void {
	store.filterValue = value;
}

function handleFilterClear(): void {
	store.filterColumn = null;
	store.filterValue = "";
}

function handleLoadMore(): void {
	store.loadMoreExplorerRows().mapErr(() => {});
}

function handleSaveEdits(): void {
	store.saveExplorerEdits().mapErr(() => {});
}

function handleDiscardEdits(): void {
	store.discardExplorerEdits();
	editingCell = null;
	cellEditOpen = false;
}

function handleToggleSqlEditor(): void {
	sqlEditorOpen = !sqlEditorOpen;
}

function handleRunQuery(): void {
	store.queryText = sql;
	store.runQuery().mapErr(() => {});
}

// ─── Connection Form Logic ───────────────────────────────────────────

const canSaveConnection = $derived(
	connectionName.trim().length > 0 &&
		((connectionEngine === "sqlite" && connectionFilePath.trim().length > 0) ||
			(connectionEngine === "s3" &&
				connectionS3Region.trim().length > 0 &&
				connectionS3AccessKeyId.trim().length > 0 &&
				connectionS3SecretAccessKey.trim().length > 0) ||
			(connectionEngine !== "sqlite" &&
				connectionEngine !== "s3" &&
				connectionHost.trim().length > 0))
);

function resetConnectionForm(): void {
	connectionName = "";
	connectionString = "";
	connectionStringError = null;
	connectionEngine = "sqlite";
	connectionHost = "";
	connectionPort = "";
	connectionDatabase = "";
	connectionUsername = "";
	connectionPassword = "";
	connectionFilePath = "";
	connectionSslMode = "";
	connectionS3Region = "";
	connectionS3EndpointUrl = "";
	connectionS3AccessKeyId = "";
	connectionS3SecretAccessKey = "";
	connectionS3SessionToken = "";
	connectionS3DefaultPrefix = "";
	connectionS3ForcePathStyle = false;
}

function extractFileName(filePath: string): string {
	const parts = filePath.split(/[/\\]/);
	const fileName = parts.at(-1) ?? "";
	return fileName.replace(/\.(db|db3|sqlite|sqlite3)$/i, "");
}

function applyConnectionString(): void {
	const normalized = connectionString.trim();
	if (normalized.length === 0) {
		connectionStringError = "Connection string is empty.";
		return;
	}

	if (normalized.toLowerCase().startsWith("sqlite:")) {
		const sqlitePath = normalized.replace(/^sqlite:(\/\/)?/i, "").trim();
		if (sqlitePath.length === 0) {
			connectionStringError = "SQLite connection string is missing a file path.";
			return;
		}
		connectionEngine = "sqlite";
		connectionFilePath = sqlitePath.replace(/^\/{2,}/, "/");
		connectionHost = "";
		connectionPort = "";
		connectionDatabase = "";
		connectionUsername = "";
		connectionPassword = "";
		connectionSslMode = "";
		if (connectionName.trim().length === 0) {
			connectionName = extractFileName(connectionFilePath) || "SQLite Connection";
		}
		connectionStringError = null;
		return;
	}

	if (!URL.canParse(normalized)) {
		connectionStringError = "Invalid connection string.";
		return;
	}

	const parsed = new URL(normalized);
	const protocol = parsed.protocol.toLowerCase();
	const parsedEngine =
		protocol === "postgres:" || protocol === "postgresql:"
			? "postgres"
			: protocol === "mysql:"
				? "mysql"
				: null;

	if (parsedEngine === null) {
		connectionStringError =
			"Only sqlite, postgres, mysql, and manual s3 connection setup are supported.";
		return;
	}

	connectionEngine = parsedEngine;
	connectionHost = parsed.hostname;
	connectionPort = parsed.port;
	connectionDatabase = parsed.pathname.replace(/^\/+/, "");
	connectionUsername = parsed.username;
	connectionPassword = parsed.password;
	connectionFilePath = "";
	connectionSslMode =
		parsed.searchParams.get("sslmode") ??
		parsed.searchParams.get("ssl_mode") ??
		parsed.searchParams.get("ssl") ??
		"";
	connectionS3Region = "";
	connectionS3EndpointUrl = "";
	connectionS3AccessKeyId = "";
	connectionS3SecretAccessKey = "";
	connectionS3SessionToken = "";
	connectionS3DefaultPrefix = "";
	connectionS3ForcePathStyle = false;

	if (connectionName.trim().length === 0) {
		const hostName = connectionHost.length > 0 ? connectionHost : parsedEngine;
		const dbName = connectionDatabase.length > 0 ? connectionDatabase : "database";
		connectionName = `${hostName}/${dbName}`;
	}
	connectionStringError = null;
}

function browseSqliteFile(): void {
	sqlStudioApi.pickSqliteFile().match(
		(filePath) => {
			if (filePath === null) return;
			connectionEngine = "sqlite";
			connectionFilePath = filePath;
			if (connectionName.trim().length === 0) {
				connectionName = extractFileName(filePath) || "SQLite Connection";
			}
		},
		() => {}
	);
}

function createConnectionInput(): ConnectionFormInput {
	if (connectionEngine === "s3") {
		return {
			kind: "s3",
			id: null,
			name: connectionName.trim(),
			engine: "s3",
			host: null,
			port: null,
			databaseName: null,
			username: null,
			password: null,
			filePath: null,
			sslMode: null,
			s3Region: connectionS3Region.trim(),
			s3EndpointUrl: connectionS3EndpointUrl.trim() || null,
			s3ForcePathStyle: connectionS3ForcePathStyle,
			s3DefaultPrefix: connectionS3DefaultPrefix.trim() || null,
			s3AccessKeyId: connectionS3AccessKeyId.trim(),
			s3SecretAccessKey: connectionS3SecretAccessKey.trim(),
			s3SessionToken: connectionS3SessionToken.trim() || null,
		};
	}

	const normalizedPort = connectionPort.trim();
	const parsedPort = normalizedPort.length > 0 ? Number.parseInt(normalizedPort, 10) : null;
	const safePort = Number.isFinite(parsedPort) ? parsedPort : null;
	return {
		kind: "sql",
		id: null,
		name: connectionName.trim(),
		engine: connectionEngine,
		host: connectionHost.trim() || null,
		port: safePort,
		databaseName: connectionDatabase.trim() || null,
		username: connectionUsername.trim() || null,
		password: connectionPassword.trim() || null,
		filePath: connectionFilePath.trim() || null,
		sslMode: connectionSslMode.trim() || null,
		s3Region: null,
		s3EndpointUrl: null,
		s3ForcePathStyle: null,
		s3DefaultPrefix: null,
		s3AccessKeyId: null,
		s3SecretAccessKey: null,
		s3SessionToken: null,
	};
}

function saveConnection(): void {
	const input = createConnectionInput();
	store.createOrUpdateConnection(input).match(
		(connection) => {
			store.selectConnection(connection.id).mapErr(() => {});
			createDialogOpen = false;
			resetConnectionForm();
			workspaceStore.persist();
		},
		() => {}
	);
}

function testCurrentConnection(): void {
	const input = createConnectionInput();
	testingConnection = true;
	sqlStudioApi.testConnectionInput(input).match(
		(result) => {
			testingConnection = false;
			if (result.ok) toast.success(result.message);
			else toast.error(result.message);
		},
		(err) => {
			testingConnection = false;
			toast.error(err.message);
		}
	);
}

function saveCellEdit(rowIndex: number, columnName: string, value: string): void {
	store.setExplorerCellEdit(rowIndex, columnName, value);
	editingCell = null;
}

const s3BreadcrumbSegments = $derived.by(() => {
	const prefix = store.s3Prefix;
	if (prefix.length === 0) return [];
	const trimmed = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
	const parts = trimmed.split("/").filter((part) => part.length > 0);
	return parts.map((part, index) => ({
		label: part,
		prefix: `${parts.slice(0, index + 1).join("/")}/`,
	}));
});
</script>

<!-- SQL Editor snippet (desktop-only: CodeMirror) -->
{#snippet sqlEditorContent()}
	<CodeMirrorEditor value={sql} language="sql" class="h-full" onChange={(value) => (sql = value)} />
{/snippet}

{#snippet s3ExplorerContent()}
	<div class="flex-1 min-h-0 flex flex-col">
		<div
			class="shrink-0 border-b border-border/30 px-2 py-1 flex items-center justify-between gap-2"
		>
			<div class="flex items-center gap-1 text-[0.6875rem] font-mono min-w-0">
				{#if store.selectedS3Bucket}
					<FolderOpen size={12} weight="bold" class="shrink-0 text-muted-foreground" />
					<span class="font-medium truncate">{store.selectedS3Bucket}</span>
					{#if s3BreadcrumbSegments.length > 0}
						<span class="text-muted-foreground">/</span>
					{/if}
					{#each s3BreadcrumbSegments as segment, index}
						<button
							type="button"
							class="text-primary hover:underline cursor-pointer"
							onclick={() => store.openS3Prefix(segment.prefix).mapErr(() => {})}
						>
							{segment.label}
						</button>
						{#if index < s3BreadcrumbSegments.length - 1}
							<span class="text-muted-foreground">/</span>
						{/if}
					{/each}
				{:else}
					<span class="text-muted-foreground">Select a bucket from the sidebar</span>
				{/if}
			</div>
			<div class="flex items-center gap-1 shrink-0">
				<button
					type="button"
					class="h-6 px-2 rounded-md text-[0.6875rem] inline-flex items-center gap-1 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
					onclick={() => store.goToS3ParentPrefix().mapErr(() => {})}
					disabled={!store.selectedS3Bucket || store.s3Prefix.length === 0}
				>
					<ArrowUp size={10} weight="bold" />
					Up
				</button>
				<button
					type="button"
					class="h-6 px-2 rounded-md text-[0.6875rem] inline-flex items-center gap-1 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
					onclick={() => store.refreshS3Objects().mapErr(() => {})}
					disabled={!store.selectedS3Bucket}
				>
					<ArrowCounterClockwise size={10} weight="bold" />
					Refresh
				</button>
			</div>
		</div>
		<div class="flex-1 min-h-0 overflow-auto">
			{#if store.isLoadingS3Objects || store.isLoadingS3Buckets}
				<div class="h-full flex items-center justify-center text-[0.8125rem] text-muted-foreground">
					Loading S3 data...
				</div>
			{:else if !store.selectedS3Bucket}
				<div class="h-full flex items-center justify-center text-[0.8125rem] text-muted-foreground">
					Choose a bucket from the left sidebar.
				</div>
			{:else}
				<table class="w-full min-w-max border-collapse">
					<thead>
						<tr class="sticky top-0 z-10 bg-muted/95">
							<th
								class="px-2 py-0.5 text-left text-[0.625rem] font-semibold uppercase text-muted-foreground font-mono"
								>Key</th
							>
							<th
								class="px-2 py-0.5 text-left text-[0.625rem] font-semibold uppercase text-muted-foreground font-mono"
								>Size</th
							>
							<th
								class="px-2 py-0.5 text-left text-[0.625rem] font-semibold uppercase text-muted-foreground font-mono"
								>Modified</th
							>
							<th
								class="px-2 py-0.5 text-left text-[0.625rem] font-semibold uppercase text-muted-foreground font-mono"
								>Storage</th
							>
							<th
								class="px-2 py-0.5 text-left text-[0.625rem] font-semibold uppercase text-muted-foreground font-mono"
								>Actions</th
							>
						</tr>
					</thead>
					<tbody>
						{#each store.s3Objects as object}
							<tr class="hover:bg-muted/40 transition-colors">
								<td class="px-2 py-0.5 font-mono text-[0.6875rem]">
									{#if object.isPrefix}
										<button
											type="button"
											class="text-primary hover:underline cursor-pointer"
											onclick={() => store.openS3Prefix(object.key).mapErr(() => {})}
										>
											{object.key}
										</button>
									{:else}
										{object.key}
									{/if}
								</td>
								<td class="px-2 py-0.5 font-mono text-[0.6875rem]"
									>{object.isPrefix ? "-" : object.size}</td
								>
								<td class="px-2 py-0.5 font-mono text-[0.6875rem]">{object.lastModified ?? "-"}</td>
								<td class="px-2 py-0.5 font-mono text-[0.6875rem]">{object.storageClass ?? "-"}</td>
								<td class="px-2 py-0.5">
									{#if !object.isPrefix}
										<div class="flex items-center gap-1">
											<button
												type="button"
												class="h-5 px-1.5 rounded text-[0.625rem] inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors cursor-pointer"
												onclick={() => store.previewS3Key(object.key).mapErr(() => {})}
											>
												<Eye size={10} weight="bold" />
												Preview
											</button>
											<button
												type="button"
												class="h-5 px-1.5 rounded text-[0.625rem] inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors cursor-pointer"
												onclick={() =>
													store
														.downloadS3Key(object.key)
														.map((path) => {
															if (path) toast.success(`Saved to ${path}`);
														})
														.mapErr(() => {})}
											>
												<DownloadSimple size={10} weight="bold" />
												Download
											</button>
										</div>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</div>
		{#if store.s3NextContinuationToken && !store.isLoadingS3Objects}
			<div class="shrink-0 border-t border-border/30 px-2 py-1">
				<button
					type="button"
					class="text-[0.6875rem] text-muted-foreground hover:text-foreground hover:bg-muted/50 px-2 py-0.5 rounded-md transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
					onclick={() => store.loadMoreS3Objects().mapErr(() => {})}
					disabled={store.isLoadingS3ObjectsMore}
				>
					{store.isLoadingS3ObjectsMore ? "Loading..." : "Load more objects"}
				</button>
			</div>
		{/if}
		{#if store.s3PreviewKey}
			<div class="shrink-0 border-t border-border/30 px-2 py-1">
				<div class="flex items-center justify-between gap-2 mb-1">
					<span class="text-[0.6875rem] font-medium font-mono truncate"
						>Preview: {store.s3PreviewKey}</span
					>
					<button
						type="button"
						class="h-5 px-1.5 rounded text-[0.625rem] inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors cursor-pointer"
						onclick={() => (store.s3PreviewKey = null)}
					>
						<X size={10} weight="bold" />
						Close
					</button>
				</div>
				{#if store.isLoadingS3Preview}
					<div class="text-[0.6875rem] text-muted-foreground">Loading preview...</div>
				{:else if store.s3Preview?.previewable && store.s3Preview.content}
					<pre
						class="max-h-56 overflow-auto rounded-md bg-muted/20 p-2 text-[11px] font-mono">{store
							.s3Preview.content}</pre>
				{:else if store.s3Preview}
					<div class="text-[0.6875rem] text-muted-foreground">
						{store.s3Preview.reason ?? "No preview available."}
					</div>
				{/if}
			</div>
		{/if}
	</div>
{/snippet}

<SqlStudioLayout
	connections={uiConnections}
	selectedConnectionId={store.selectedConnectionId}
	schema={uiSchema}
	selectedSchemaName={store.selectedSchemaName}
	selectedTableName={store.selectedTableName}
	s3Buckets={store.s3Buckets}
	selectedS3Bucket={store.selectedS3Bucket}
	columns={store.isS3Mode ? [] : [...store.explorerColumns]}
	rows={store.isS3Mode ? [] : processedRows}
	isLoading={store.isS3Mode ? false : store.isLoadingExplorer}
	rowCount={store.isS3Mode ? store.s3Objects.length : processedRows.length}
	hasMore={store.isS3Mode
		? store.s3NextContinuationToken !== null
		: store.explorerNextOffset !== null}
	isLoadingMore={store.isS3Mode ? store.isLoadingS3ObjectsMore : store.isLoadingExplorerMore}
	sortColumn={store.sortColumn}
	sortDirection={store.sortDirection}
	filterColumn={store.filterColumn}
	filterOperator={store.filterOperator}
	filterValue={store.filterValue}
	pendingEditCount={store.pendingExplorerEditCount}
	isSaving={store.isSavingExplorerEdits}
	readOnlyReason={store.isS3Mode ? null : store.explorerReadOnlyReason}
	isCellDirty={(rowIndex, columnName) => store.isExplorerCellDirty(rowIndex, columnName)}
	getCellValue={(rowIndex, columnName) => store.getExplorerCellValue(rowIndex, columnName)}
	lastError={store.lastError}
	lastInfo={store.lastInfo}
	{sqlEditorOpen}
	isExecutingQuery={store.isExecutingQuery}
	onConnectionSelect={handleConnectionSelect}
	onConnectionCreate={handleConnectionCreate}
	onConnectionDelete={handleConnectionDelete}
	onTableSelect={handleTableSelect}
	onS3BucketSelect={handleS3BucketSelect}
	onCellClick={handleCellClick}
	onSortChange={handleSortChange}
	onFilterColumnChange={handleFilterColumnChange}
	onFilterOperatorChange={handleFilterOperatorChange}
	onFilterValueChange={handleFilterValueChange}
	onFilterClear={handleFilterClear}
	onLoadMore={handleLoadMore}
	onSaveEdits={handleSaveEdits}
	onDiscardEdits={handleDiscardEdits}
	onToggleSqlEditor={handleToggleSqlEditor}
	onRunQuery={handleRunQuery}
	{onClose}
	{sqlEditorContent}
	explorerContent={store.isS3Mode ? s3ExplorerContent : undefined}
	mode={store.isS3Mode ? "s3" : "sql"}
/>

<!-- Cell Edit Dialog -->
<SqlStudioCellEditDialog
	open={cellEditOpen}
	cell={editingCell}
	readOnly={store.explorerReadOnlyReason !== null}
	onOpenChange={(open) => {
		cellEditOpen = open;
		if (!open) editingCell = null;
	}}
	onSave={saveCellEdit}
/>

<!-- Connection Dialog -->
<Dialog.Root bind:open={createDialogOpen} onOpenChange={(open) => (createDialogOpen = open)}>
	<Dialog.Content
		showCloseButton={false}
		class="sm:max-w-md flex flex-col gap-0 !p-0 overflow-hidden"
		portalProps={{ disabled: true }}
	>
		<!-- Header -->
		<EmbeddedPanelHeader>
			<HeaderTitleCell>
				<Database size={14} weight="bold" class="shrink-0 mr-1.5 text-primary" />
				<span class="text-[11px] font-semibold text-foreground select-none truncate leading-none">
					New Connection
				</span>
			</HeaderTitleCell>
			<HeaderActionCell>
				<CloseAction onClose={() => (createDialogOpen = false)} />
			</HeaderActionCell>
		</EmbeddedPanelHeader>

		<!-- Form -->
		<div class="grid gap-2.5 px-3 py-3">
			<div class="grid gap-1">
				<label for="connection-string" class="text-[0.625rem] font-medium text-muted-foreground uppercase tracking-wider">Connection string</label>
				<div class="grid grid-cols-[1fr_auto] gap-1.5 items-center">
					<input
						id="connection-string"
						bind:value={connectionString}
						placeholder="postgresql://user:pass@localhost:5432/app"
						class="h-7 w-full rounded-md border border-border/40 bg-muted/30 px-2 text-[0.6875rem] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
					/>
					<button
						type="button"
						class="h-7 px-2.5 text-[0.625rem] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-md transition-colors cursor-pointer"
						onclick={applyConnectionString}
					>
						Apply
					</button>
				</div>
				{#if connectionStringError}
					<p class="text-[0.625rem] text-destructive">{connectionStringError}</p>
				{/if}
			</div>
			<div class="grid gap-1">
				<label for="connection-name" class="text-[0.625rem] font-medium text-muted-foreground uppercase tracking-wider">Name</label>
				<input
					id="connection-name"
					bind:value={connectionName}
					placeholder="Local SQLite"
					class="h-7 w-full rounded-md border border-border/40 bg-muted/30 px-2 text-[0.6875rem] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
				/>
			</div>
			<div class="grid gap-1">
				<label for="connection-engine" class="text-[0.625rem] font-medium text-muted-foreground uppercase tracking-wider">Engine</label>
				<select
					id="connection-engine"
					value={connectionEngine}
					onchange={(e) => {
						const v = (e.currentTarget as HTMLSelectElement).value;
						if (v === "sqlite" || v === "postgres" || v === "mysql" || v === "s3") {
							connectionEngine = v;
						}
					}}
					class="h-7 w-full rounded-md border border-border/40 bg-muted/30 px-2 text-[0.6875rem] text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40 cursor-pointer appearance-none"
				>
					<option value="sqlite">sqlite</option>
					<option value="postgres">postgres</option>
					<option value="mysql">mysql</option>
					<option value="s3">s3</option>
				</select>
			</div>

			{#if connectionEngine === "sqlite"}
				<div class="grid gap-1">
					<label for="connection-file" class="text-[0.625rem] font-medium text-muted-foreground uppercase tracking-wider">SQLite file path</label>
					<div class="grid grid-cols-[1fr_auto] gap-1.5 items-center">
						<input
							id="connection-file"
							bind:value={connectionFilePath}
							placeholder="/path/to/db.sqlite"
							class="h-7 w-full rounded-md border border-border/40 bg-muted/30 px-2 text-[0.6875rem] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
						/>
						<button
							type="button"
							class="h-7 px-2.5 text-[0.625rem] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-md transition-colors cursor-pointer inline-flex items-center gap-1"
							onclick={browseSqliteFile}
						>
							<FolderOpen weight="regular" size={13} class="text-primary" />
							Browse
						</button>
					</div>
				</div>
			{:else if connectionEngine !== "s3"}
				<div class="grid gap-1">
					<label for="connection-host" class="text-[0.625rem] font-medium text-muted-foreground uppercase tracking-wider">Host</label>
					<input id="connection-host" bind:value={connectionHost} placeholder="localhost" class="h-7 w-full rounded-md border border-border/40 bg-muted/30 px-2 text-[0.6875rem] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40" />
				</div>
				<div class="grid grid-cols-2 gap-2">
					<div class="grid gap-1">
						<label for="connection-port" class="text-[0.625rem] font-medium text-muted-foreground uppercase tracking-wider">Port</label>
						<input id="connection-port" bind:value={connectionPort} placeholder="5432" class="h-7 w-full rounded-md border border-border/40 bg-muted/30 px-2 text-[0.6875rem] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40" />
					</div>
					<div class="grid gap-1">
						<label for="connection-database" class="text-[0.625rem] font-medium text-muted-foreground uppercase tracking-wider">Database</label>
						<input id="connection-database" bind:value={connectionDatabase} placeholder="app" class="h-7 w-full rounded-md border border-border/40 bg-muted/30 px-2 text-[0.6875rem] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40" />
					</div>
				</div>
				<div class="grid grid-cols-2 gap-2">
					<div class="grid gap-1">
						<label for="connection-username" class="text-[0.625rem] font-medium text-muted-foreground uppercase tracking-wider">Username</label>
						<input id="connection-username" bind:value={connectionUsername} placeholder="user" class="h-7 w-full rounded-md border border-border/40 bg-muted/30 px-2 text-[0.6875rem] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40" />
					</div>
					<div class="grid gap-1">
						<label for="connection-password" class="text-[0.625rem] font-medium text-muted-foreground uppercase tracking-wider">Password</label>
						<input id="connection-password" type="password" bind:value={connectionPassword} placeholder="••••••••" class="h-7 w-full rounded-md border border-border/40 bg-muted/30 px-2 text-[0.6875rem] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40" />
					</div>
				</div>
				<div class="grid gap-1">
					<label for="connection-ssl" class="text-[0.625rem] font-medium text-muted-foreground uppercase tracking-wider">SSL mode (optional)</label>
					<input id="connection-ssl" bind:value={connectionSslMode} placeholder="require" class="h-7 w-full rounded-md border border-border/40 bg-muted/30 px-2 text-[0.6875rem] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40" />
				</div>
			{:else}
				<div class="grid gap-1">
					<label for="connection-s3-region" class="text-[0.625rem] font-medium text-muted-foreground uppercase tracking-wider">Region</label>
					<input id="connection-s3-region" bind:value={connectionS3Region} placeholder="us-east-1" class="h-7 w-full rounded-md border border-border/40 bg-muted/30 px-2 text-[0.6875rem] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40" />
				</div>
				<div class="grid gap-1">
					<label for="connection-s3-endpoint" class="text-[0.625rem] font-medium text-muted-foreground uppercase tracking-wider">Endpoint URL (optional)</label>
					<input id="connection-s3-endpoint" bind:value={connectionS3EndpointUrl} placeholder="https://s3.amazonaws.com" class="h-7 w-full rounded-md border border-border/40 bg-muted/30 px-2 text-[0.6875rem] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40" />
				</div>
				<div class="grid grid-cols-2 gap-2">
					<div class="grid gap-1">
						<label for="connection-s3-access-key" class="text-[0.625rem] font-medium text-muted-foreground uppercase tracking-wider">Access key ID</label>
						<input id="connection-s3-access-key" bind:value={connectionS3AccessKeyId} class="h-7 w-full rounded-md border border-border/40 bg-muted/30 px-2 text-[0.6875rem] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40" />
					</div>
					<div class="grid gap-1">
						<label for="connection-s3-secret-key" class="text-[0.625rem] font-medium text-muted-foreground uppercase tracking-wider">Secret access key</label>
						<input id="connection-s3-secret-key" type="password" bind:value={connectionS3SecretAccessKey} class="h-7 w-full rounded-md border border-border/40 bg-muted/30 px-2 text-[0.6875rem] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40" />
					</div>
				</div>
				<div class="grid gap-1">
					<label for="connection-s3-session-token" class="text-[0.625rem] font-medium text-muted-foreground uppercase tracking-wider">Session token (optional)</label>
					<input id="connection-s3-session-token" bind:value={connectionS3SessionToken} class="h-7 w-full rounded-md border border-border/40 bg-muted/30 px-2 text-[0.6875rem] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40" />
				</div>
				<div class="grid gap-1">
					<label for="connection-s3-default-prefix" class="text-[0.625rem] font-medium text-muted-foreground uppercase tracking-wider">Default prefix (optional)</label>
					<input id="connection-s3-default-prefix" bind:value={connectionS3DefaultPrefix} class="h-7 w-full rounded-md border border-border/40 bg-muted/30 px-2 text-[0.6875rem] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40" />
				</div>
				<div class="flex items-center gap-1.5">
					<input
						id="connection-s3-path-style"
						type="checkbox"
						checked={connectionS3ForcePathStyle}
						onchange={(event) => {
							connectionS3ForcePathStyle = (event.currentTarget as HTMLInputElement).checked;
						}}
						class="size-3.5 rounded border border-border/40 accent-primary"
					/>
					<label for="connection-s3-path-style" class="text-[0.6875rem] text-muted-foreground cursor-pointer">Force path-style URLs</label>
				</div>
			{/if}
		</div>

		<!-- Footer -->
		<div class="flex items-center justify-end px-1 border-t border-border/30 shrink-0" style="height: 28px;">
			<button
				type="button"
				class="h-7 px-2 inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset disabled:opacity-50 disabled:pointer-events-none"
				onclick={() => (createDialogOpen = false)}
			>
				<X size={14} weight="bold" />
				Cancel
			</button>
			<button
				type="button"
				class="h-7 px-2 inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset disabled:opacity-50 disabled:pointer-events-none"
				onclick={testCurrentConnection}
				disabled={!canSaveConnection || store.isSavingConnection || testingConnection}
			>
				<Lightning size={14} weight="bold" />
				{testingConnection ? "Testing..." : "Test"}
			</button>
			<button
				type="button"
				class="h-7 px-2 inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset disabled:opacity-50 disabled:pointer-events-none"
				onclick={saveConnection}
				disabled={!canSaveConnection || store.isSavingConnection}
			>
				<FloppyDisk size={14} weight="bold" />
				{store.isSavingConnection ? "Saving..." : "Save"}
			</button>
		</div>
	</Dialog.Content>
</Dialog.Root>

<!-- Delete Connection Confirmation -->
<AlertDialog.Root bind:open={deleteConfirmOpen}>
	<AlertDialog.Content portalProps={{ disabled: true }}>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete connection</AlertDialog.Title>
			<AlertDialog.Description>
				This will permanently remove this connection. This action cannot be undone.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
				onclick={() => {
					if (deleteTargetId) {
						store.deleteConnectionById(deleteTargetId).mapErr(() => {});
						deleteTargetId = null;
					}
					deleteConfirmOpen = false;
				}}
			>
				Delete
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
