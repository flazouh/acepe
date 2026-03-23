<script lang="ts">
  /**
   * SqlStudioSidebar — Connections list + schema tree sidebar.
   * Matches the git panel's dense, monospace design language.
   */
  import CaretRight from "phosphor-svelte/lib/CaretRight";
  import FolderSimple from "phosphor-svelte/lib/FolderSimple";
  import { default as TableIcon } from "phosphor-svelte/lib/Table";
  import Trash from "phosphor-svelte/lib/Trash";
  import Plus from "phosphor-svelte/lib/Plus";
  import Key from "phosphor-svelte/lib/Key";
  import { TAG_COLORS } from "../../lib/colors.js";
  import { cn } from "../../lib/utils.js";
  import type { SqlConnection, SqlSchemaInfo } from "./types.js";

  interface Props {
    connections: SqlConnection[];
    selectedConnectionId: string | null;
    schema: SqlSchemaInfo[];
    selectedSchemaName: string | null;
    selectedTableName: string | null;
    mode?: "sql" | "s3";
    s3Buckets?: readonly { name: string; creationDate: string | null }[];
    selectedS3Bucket?: string | null;
    onConnectionSelect: (id: string) => void;
    onConnectionCreate: () => void;
    onConnectionDelete: (id: string) => void;
    onTableSelect: (schemaName: string, tableName: string) => void;
    onS3BucketSelect?: (bucketName: string) => void;
    class?: string;
  }

  let {
    connections,
    selectedConnectionId,
    schema,
    selectedSchemaName,
    selectedTableName,
    mode = "sql",
    s3Buckets = [],
    selectedS3Bucket = null,
    onConnectionSelect,
    onConnectionCreate,
    onConnectionDelete,
    onTableSelect,
    onS3BucketSelect,
    class: className,
  }: Props = $props();

  let expandedTables = $state<Set<string>>(new Set());

  function connectionColor(index: number): string {
    return TAG_COLORS[index % TAG_COLORS.length] ?? TAG_COLORS[0];
  }

  function toggleTableExpand(tableKey: string, e: Event): void {
    e.stopPropagation();
    expandedTables = expandedTables.has(tableKey)
      ? new Set([...expandedTables].filter((k) => k !== tableKey))
      : new Set([...expandedTables, tableKey]);
  }
</script>

<div
  class={cn(
    "w-[200px] shrink-0 border-r border-border/30 overflow-y-auto flex flex-col",
    className,
  )}
>
  <div class="p-2 space-y-3">
    <!-- Connections -->
    <div class="space-y-1">
      <div class="flex items-center justify-between px-1">
        <span
          class="text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground"
        >
          Connections
        </span>
        <button
          type="button"
          class="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors cursor-pointer"
          title="Add connection"
          onclick={onConnectionCreate}
        >
          <Plus size={12} weight="bold" />
        </button>
      </div>

      {#if connections.length === 0}
        <div class="px-2 py-2 text-[0.6875rem] text-muted-foreground">
          No connections yet.
        </div>
      {:else}
        {#each connections as connection, index (connection.id)}
          {@const isSelected = selectedConnectionId === connection.id}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class={cn(
              "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors cursor-pointer group",
              isSelected ? "bg-muted/60" : "hover:bg-muted/40",
            )}
            onclick={() => onConnectionSelect(connection.id)}
            onkeydown={(e) =>
              e.key === "Enter" && onConnectionSelect(connection.id)}
          >
            <div
              class="w-1 self-stretch shrink-0 rounded-full"
              style="background-color: {connectionColor(index)}"
            ></div>
            <div class="min-w-0 flex-1">
              <p
                class="font-mono text-[0.6875rem] font-medium text-foreground truncate"
              >
                {connection.name}
              </p>
              {#if connection.subtitle}
                <p
                  class="font-mono text-[0.5625rem] text-muted-foreground truncate mt-0.5"
                >
                  {connection.subtitle}
                </p>
              {/if}
            </div>
            <span
              class="shrink-0 rounded-full bg-muted/40 px-2 py-0.5 text-[0.625rem] font-mono text-muted-foreground"
            >
              {connection.engine}
            </span>
            <button
              type="button"
              class="shrink-0 h-5 w-5 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 hover:bg-destructive/10 transition-all cursor-pointer"
              title="Delete connection"
              onclick={(e) => {
                e.stopPropagation();
                onConnectionDelete(connection.id);
              }}
            >
              <Trash size={12} weight="bold" class="text-destructive" />
            </button>
          </div>
        {/each}
      {/if}
    </div>

    <!-- SQL Schema tree -->
    {#if mode === "sql" && schema.length > 0}
      <div class="space-y-1 pt-2 border-t border-border/30">
        <span
          class="text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground px-1"
        >
          Tables
        </span>
        {#each schema as schemaNode (schemaNode.name)}
          <div class="space-y-0.5">
            <span
              class="text-[0.5625rem] font-semibold text-muted-foreground px-2 font-mono"
            >
              {schemaNode.name}
            </span>
            {#each schemaNode.tables as tableNode (tableNode.name)}
              {@const tableKey = `${schemaNode.name}.${tableNode.name}`}
              {@const isExpanded = expandedTables.has(tableKey)}
              {@const isTableSelected =
                selectedSchemaName === schemaNode.name &&
                selectedTableName === tableNode.name}
              <div class="space-y-0.5">
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div
                  class={cn(
                    "w-full flex items-center gap-1.5 px-2 py-0.5 rounded-md text-left transition-colors cursor-pointer",
                    isTableSelected ? "bg-muted/60" : "hover:bg-muted/40",
                  )}
                  onclick={() => onTableSelect(schemaNode.name, tableNode.name)}
                  onkeydown={(e) =>
                    e.key === "Enter" &&
                    onTableSelect(schemaNode.name, tableNode.name)}
                >
                  <button
                    type="button"
                    class="shrink-0 p-0.5 rounded hover:bg-muted/50 transition-colors"
                    title={isExpanded ? "Collapse columns" : "Expand columns"}
                    onclick={(e) => toggleTableExpand(tableKey, e)}
                  >
                    <CaretRight
                      size={10}
                      weight="bold"
                      class={cn(
                        "text-muted-foreground transition-transform duration-150",
                        isExpanded && "rotate-90",
                      )}
                    />
                  </button>
                  <TableIcon
                    size={12}
                    weight="bold"
                    class="shrink-0 text-primary"
                  />
                  <span class="font-mono text-[0.6875rem] truncate flex-1"
                    >{tableNode.name}</span
                  >
                </div>

                {#if isExpanded}
                  <div class="ml-5 rounded-md bg-muted/10 p-1.5 space-y-0.5">
                    {#each tableNode.columns as column (column.name)}
                      <div class="flex items-center justify-between gap-2 px-1">
                        <span
                          class={cn(
                            "font-mono text-[0.625rem] truncate",
                            column.isPrimaryKey && "text-primary",
                          )}
                        >
                          {#if column.isPrimaryKey}
                            <Key
                              size={8}
                              weight="bold"
                              class="inline mr-0.5 -mt-0.5"
                            />
                          {/if}
                          {column.name}
                        </span>
                        <span
                          class="font-mono text-[0.5625rem] uppercase text-muted-foreground shrink-0"
                        >
                          {column.dataType}
                        </span>
                      </div>
                    {/each}
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/each}
      </div>
    {/if}

    <!-- S3 Buckets -->
    {#if mode === "s3"}
      <div class="space-y-1 pt-2 border-t border-border/30">
        <span
          class="text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground px-1"
        >
          Buckets
        </span>
        {#if s3Buckets.length === 0}
          <div class="px-2 py-2 text-[0.6875rem] text-muted-foreground">
            No buckets found.
          </div>
        {:else}
          {#each s3Buckets as bucket (bucket.name)}
            <button
              type="button"
              class={cn(
                "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors",
                selectedS3Bucket === bucket.name
                  ? "bg-muted/60"
                  : "hover:bg-muted/40",
              )}
              onclick={() => onS3BucketSelect?.(bucket.name)}
            >
              <FolderSimple
                size={12}
                weight="bold"
                class="shrink-0 text-primary"
              />
              <div class="min-w-0 flex-1">
                <p class="font-mono text-[0.6875rem] truncate">{bucket.name}</p>
                {#if bucket.creationDate}
                  <p
                    class="font-mono text-[0.5625rem] text-muted-foreground truncate mt-0.5"
                  >
                    {bucket.creationDate}
                  </p>
                {/if}
              </div>
            </button>
          {/each}
        {/if}
      </div>
    {/if}
  </div>
</div>
