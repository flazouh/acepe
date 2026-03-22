<script lang="ts">
import { type FilePanelFormatKind, parseTableContent } from "./file-panel-format.js";

interface Props {
	content: string;
	formatKind: FilePanelFormatKind;
}

let { content, formatKind }: Props = $props();

const parseResult = $derived.by(() => {
	if (formatKind !== "csv" && formatKind !== "tsv") {
		return parseTableContent(content, "csv");
	}
	return parseTableContent(content, formatKind);
});
const parseError = $derived.by(() => {
	const result = parseResult;
	return result.isErr() ? result.error.message : null;
});
const csvData = $derived.by(() => {
	const result = parseResult;
	return result.isOk() ? result.value : null;
});
</script>

{#if parseError}
	<div
		class="text-sm text-destructive p-3 border border-destructive/20 rounded-md bg-destructive/5"
	>
		<div class="font-medium">Unable to parse CSV</div>
		<div class="mt-1 text-xs">{parseError}</div>
	</div>
{:else if csvData === null || csvData.headers.length === 0}
	<div class="text-sm text-muted-foreground p-2">No rows to display.</div>
{:else}
	<div class="csv-table-wrapper">
		<table class="csv-table">
			<thead>
				<tr>
					{#each csvData.headers as header, i (`header-${i}`)}
						<th>{header}</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each csvData.rows as row, rowIndex (`row-${rowIndex}`)}
					<tr>
						{#each row as cell, columnIndex (`cell-${rowIndex}-${columnIndex}`)}
							<td>{cell}</td>
						{/each}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<style>
	.csv-table-wrapper {
		border: 1px solid var(--border);
		border-radius: 0.5rem;
		overflow: auto;
		background: color-mix(in srgb, var(--input) 24%, transparent);
	}

	.csv-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.8125rem;
		line-height: 1.45;
	}

	.csv-table th,
	.csv-table td {
		padding: 0.5rem 0.625rem;
		text-align: left;
		border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
		border-right: 1px solid color-mix(in srgb, var(--border) 45%, transparent);
		white-space: pre-wrap;
		word-break: break-word;
		vertical-align: top;
	}

	.csv-table th:last-child,
	.csv-table td:last-child {
		border-right: none;
	}

	.csv-table thead th {
		position: sticky;
		top: 0;
		z-index: 1;
		background: color-mix(in srgb, var(--muted) 75%, transparent);
		font-weight: 600;
	}

	.csv-table tbody tr:nth-child(even) {
		background: color-mix(in srgb, var(--muted) 26%, transparent);
	}

	.csv-table tbody tr:hover {
		background: color-mix(in srgb, var(--accent) 35%, transparent);
	}
</style>
