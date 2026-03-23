<script lang="ts">
  /**
   * SqlStudioLayout — Composed layout for the SQL Studio.
   * Top bar → sidebar + content area (toolbar, SQL editor, filter, grid, status).
   * All data-driven via props, no Tauri coupling.
   */
  import type { Snippet } from "svelte";
  import { cn } from "../../lib/utils.js";
  import type {
    SqlConnection,
    SqlSchemaInfo,
    SqlFilterOperator,
    SqlSortDirection,
  } from "./types.js";
  import SqlStudioTopBar from "./sql-studio-top-bar.svelte";
  import SqlStudioSidebar from "./sql-studio-sidebar.svelte";
  import SqlStudioToolbar from "./sql-studio-toolbar.svelte";
  import SqlStudioFilterBar from "./sql-studio-filter-bar.svelte";
  import SqlStudioMessageBar from "./sql-studio-message-bar.svelte";
  import SqlStudioDataGrid from "./sql-studio-data-grid.svelte";
  import SqlStudioStatusBar from "./sql-studio-status-bar.svelte";

  interface Props {
    // Sidebar
    connections: SqlConnection[];
    selectedConnectionId: string | null;
    schema: SqlSchemaInfo[];
    selectedSchemaName: string | null;
    selectedTableName: string | null;
    s3Buckets?: readonly { name: string; creationDate: string | null }[];
    selectedS3Bucket?: string | null;

    // Grid data
    columns: readonly string[];
    rows: readonly { originalIndex: number; cells: readonly string[] }[];
    isLoading: boolean;
    rowCount: number;
    hasMore: boolean;
    isLoadingMore: boolean;

    // Sort & filter
    sortColumn: string | null;
    sortDirection: SqlSortDirection;
    filterColumn: string | null;
    filterOperator: SqlFilterOperator;
    filterValue: string;

    // Edit state
    pendingEditCount: number;
    isSaving: boolean;
    readOnlyReason: string | null;
    isCellDirty: (rowIndex: number, columnName: string) => boolean;
    getCellValue: (rowIndex: number, columnName: string) => string;

    // Messages
    lastError: string | null;
    lastInfo: string | null;

    // SQL editor
    sqlEditorOpen: boolean;
    isExecutingQuery: boolean;

    // Callbacks
    onConnectionSelect: (id: string) => void;
    onConnectionCreate: () => void;
    onConnectionDelete: (id: string) => void;
    onTableSelect: (schemaName: string, tableName: string) => void;
    onS3BucketSelect?: (bucketName: string) => void;
    onCellClick: (rowIndex: number, columnName: string) => void;
    onSortChange: (column: string) => void;
    onFilterColumnChange: (column: string | null) => void;
    onFilterOperatorChange: (op: SqlFilterOperator) => void;
    onFilterValueChange: (value: string) => void;
    onFilterClear: () => void;
    onLoadMore: () => void;
    onSaveEdits: () => void;
    onDiscardEdits: () => void;
    onToggleSqlEditor: () => void;
    onRunQuery: () => void;
    onClose: () => void;

    /** Snippet for rendering the SQL editor (desktop provides CodeMirror, blog provides textarea) */
    sqlEditorContent?: Snippet;
    /** Optional snippet for non-SQL explorer views that still use the same shell layout. */
    explorerContent?: Snippet;
    mode?: "sql" | "s3";
    class?: string;
  }

  let {
    connections,
    selectedConnectionId,
    schema,
    selectedSchemaName,
    selectedTableName,
    s3Buckets = [],
    selectedS3Bucket = null,
    columns,
    rows,
    isLoading,
    rowCount,
    hasMore,
    isLoadingMore,
    sortColumn,
    sortDirection,
    filterColumn,
    filterOperator,
    filterValue,
    pendingEditCount,
    isSaving,
    readOnlyReason,
    isCellDirty,
    getCellValue,
    lastError,
    lastInfo,
    sqlEditorOpen,
    isExecutingQuery,
    onConnectionSelect,
    onConnectionCreate,
    onConnectionDelete,
    onTableSelect,
    onS3BucketSelect,
    onCellClick,
    onSortChange,
    onFilterColumnChange,
    onFilterOperatorChange,
    onFilterValueChange,
    onFilterClear,
    onLoadMore,
    onSaveEdits,
    onDiscardEdits,
    onToggleSqlEditor,
    onRunQuery,
    onClose,
    sqlEditorContent,
    explorerContent,
    mode = "sql",
    class: className,
  }: Props = $props();

  const selectedTableLabel = $derived(
    selectedSchemaName && selectedTableName
      ? `${selectedSchemaName}.${selectedTableName}`
      : null,
  );

  const showFilterBar = $derived(
    mode === "sql" &&
      selectedSchemaName !== null &&
      selectedTableName !== null &&
      columns.length > 0,
  );
</script>

<div class={cn("flex flex-col h-full bg-background", className)}>
  <SqlStudioTopBar {onClose} />

  <div class="flex-1 min-h-0 flex">
    <SqlStudioSidebar
      {connections}
      {selectedConnectionId}
      {schema}
      {selectedSchemaName}
      {selectedTableName}
      {mode}
      {s3Buckets}
      {selectedS3Bucket}
      {onConnectionSelect}
      {onConnectionCreate}
      {onConnectionDelete}
      {onTableSelect}
      {onS3BucketSelect}
    />

    <div class="flex-1 min-w-0 flex flex-col overflow-hidden">
      {#if mode === "s3" && explorerContent}
        {@render explorerContent()}
      {:else}
        <SqlStudioToolbar
          {selectedTableLabel}
          {pendingEditCount}
          {isSaving}
          {sqlEditorOpen}
          {isExecutingQuery}
          hasConnection={selectedConnectionId !== null}
          {lastInfo}
          {onSaveEdits}
          {onDiscardEdits}
          {onToggleSqlEditor}
          {onRunQuery}
        />

        {#if sqlEditorOpen && sqlEditorContent}
          <div
            class="shrink-0 h-[200px] border-b border-border/30 bg-background/50 overflow-hidden"
          >
            {@render sqlEditorContent()}
          </div>
        {/if}

        {#if showFilterBar}
          <SqlStudioFilterBar
            {columns}
            {filterColumn}
            {filterOperator}
            {filterValue}
            onColumnChange={onFilterColumnChange}
            onOperatorChange={onFilterOperatorChange}
            onValueChange={onFilterValueChange}
            onClear={onFilterClear}
          />
        {/if}

        <SqlStudioMessageBar error={lastError} warning={readOnlyReason} />

        {#if isLoading}
          <div class="flex-1 flex items-center justify-center gap-2">
            <span
              class="inline-block h-3 w-3 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent"
            ></span>
            <span class="text-[0.8125rem] text-muted-foreground"
              >Loading rows...</span
            >
          </div>
        {:else}
          <SqlStudioDataGrid
            {columns}
            {rows}
            {sortColumn}
            {sortDirection}
            readOnly={readOnlyReason !== null}
            {isCellDirty}
            {getCellValue}
            {onSortChange}
            {onCellClick}
          />
        {/if}

        {#if columns.length > 0 && !isLoading}
          <SqlStudioStatusBar
            {rowCount}
            {hasMore}
            {isLoadingMore}
            {onLoadMore}
          />
        {/if}
      {/if}
    </div>
  </div>
</div>
