<script lang="ts">
  /**
   * SqlStudioSidebar — Connections list + schema tree sidebar.
   * Matches the git panel's dense, monospace design language.
   */
  import PlusIcon from "../icons/plus-icon.svelte";
  import { RoundedIcon } from "../icons/index.js";
  import { PierreFileTree } from "../pierre-tree/index.js";
  import { TAG_COLORS } from "../../lib/colors.js";
  import { cn } from "../../lib/utils.js";
  import type { SqlConnection, SqlSchemaInfo } from "./types.js";
  import { createSqlStudioTreeModel } from "./sql-studio-tree-model.js";

  const TREE_SEARCH_CHROME_HEIGHT_PX = 36;
  const COMPACT_TREE_ROW_HEIGHT_PX = 24;

  const SQL_TREE_UNSAFE_CSS = `
    button[data-type='item'] {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      font-size: 11px;
      line-height: 16px;
      min-height: 21px;
    }

    button[data-type='item'][data-item-selected] {
      border-left: 2px solid hsl(var(--primary));
    }
  `;

  interface Props {
    connections: SqlConnection[];
    selectedConnectionId: string | null;
    schema: SqlSchemaInfo[];
    selectedSchemaName: string | null;
    selectedTableName: string | null;
    onConnectionSelect: (id: string) => void;
    onConnectionCreate: () => void;
    onConnectionDelete: (id: string) => void;
    onTableSelect: (schemaName: string, tableName: string) => void;
    class?: string;
  }

  let {
    connections,
    selectedConnectionId,
    schema,
    selectedSchemaName,
    selectedTableName,
    onConnectionSelect,
    onConnectionCreate,
    onConnectionDelete,
    onTableSelect,
    class: className,
  }: Props = $props();

  const sqlTreeModel = $derived(
    createSqlStudioTreeModel(schema, selectedSchemaName, selectedTableName)
  );
  const sqlTreeHeightPx = $derived(
    Math.min(
      360,
      Math.max(
        96,
        TREE_SEARCH_CHROME_HEIGHT_PX + sqlTreeModel.paths.length * COMPACT_TREE_ROW_HEIGHT_PX
      )
    )
  );

  function connectionColor(index: number): string {
    return TAG_COLORS[index % TAG_COLORS.length] ?? TAG_COLORS[0];
  }

  function handleSchemaTreeSelection(selectedPaths: readonly string[]): void {
    const selectedPath = selectedPaths[selectedPaths.length - 1];
    if (!selectedPath) {
      return;
    }

    const table = sqlTreeModel.tablesByPath.get(selectedPath);
    if (table) {
      onTableSelect(table.schemaName, table.tableName);
    }
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
          <PlusIcon />
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
              <RoundedIcon name="trash" class="size-3 text-destructive" />
            </button>
          </div>
        {/each}
      {/if}
    </div>

    <!-- SQL Schema tree -->
    {#if schema.length > 0}
      <div class="space-y-1 pt-2 border-t border-border/30">
        <span
          class="text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground px-1"
        >
          Tables
        </span>
        <div style:height={`${sqlTreeHeightPx}px`}>
          <PierreFileTree
            paths={sqlTreeModel.paths}
            selectedPath={sqlTreeModel.selectedPath}
            revealPath={sqlTreeModel.selectedPath}
            onSelectionChange={handleSchemaTreeSelection}
            rowDecoration={(item) => sqlTreeModel.decorationsByPath.get(item.path) ?? null}
            flattenEmptyDirectories={false}
            unsafeCSS={SQL_TREE_UNSAFE_CSS}
            class="h-full bg-transparent"
            testId="sql-studio-schema-tree"
            ariaLabel="SQL schema tree"
          />
        </div>
      </div>
    {/if}

  </div>
</div>

<style>
  .sql-table-icon {
    position: relative;
    display: inline-block;
    width: 12px;
    height: 12px;
    box-sizing: border-box;
    border: 1.4px solid currentColor;
    border-radius: 2px;
    background:
      linear-gradient(currentColor, currentColor) 0 4px / 100% 1.2px no-repeat,
      linear-gradient(currentColor, currentColor) 0 7px / 100% 1.2px no-repeat,
      linear-gradient(currentColor, currentColor) 4px 0 / 1.2px 100% no-repeat,
      linear-gradient(currentColor, currentColor) 8px 0 / 1.2px 100% no-repeat;
  }

  .sql-key-icon {
    position: relative;
    display: inline-block;
    width: 8px;
    height: 8px;
    margin-right: 2px;
    margin-top: -2px;
    vertical-align: middle;
    box-sizing: border-box;
    border: 1.3px solid currentColor;
    border-radius: 999px;
    overflow: visible;
  }

  .sql-key-icon::before {
    content: "";
    position: absolute;
    left: 5px;
    top: 3px;
    width: 4px;
    height: 1.3px;
    border-radius: 999px;
    background: currentColor;
  }

  .sql-key-icon::after {
    content: "";
    position: absolute;
    left: 7.5px;
    top: 3px;
    width: 1.3px;
    height: 3px;
    border-radius: 999px;
    background: currentColor;
    box-shadow: 2px 0 0 currentColor;
  }
</style>
