<script lang="ts">
import { Button } from "$lib/components/ui/button/index.js";
import { CodeMirrorEditor } from "$lib/components/ui/codemirror-editor/index.js";
import DialogFrame from "$lib/components/ui/dialog-frame.svelte";

export interface CellEditState {
	rowIndex: number;
	columnName: string;
	columnDataType: string;
	value: string;
}

interface Props {
	open: boolean;
	cell: CellEditState | null;
	readOnly: boolean;
	onOpenChange: (open: boolean) => void;
	onSave: (rowIndex: number, columnName: string, value: string) => void;
}

let { open, cell, readOnly, onOpenChange, onSave }: Props = $props();

let draftValue = $state("");

const editorLanguage = $derived(detectLanguage(cell));

$effect(() => {
	if (open && cell) {
		draftValue = tryFormatValue(cell.value, cell.columnDataType);
	}
});

function detectLanguage(cellState: CellEditState | null): string {
	if (!cellState) return "text";
	const dt = cellState.columnDataType.toLowerCase();

	if (dt.includes("json") || dt === "jsonb") return "json";
	if (dt.includes("xml")) return "xml";
	if (dt.includes("html")) return "html";

	const trimmed = cellState.value.trim();
	if (
		(trimmed.startsWith("{") && trimmed.endsWith("}")) ||
		(trimmed.startsWith("[") && trimmed.endsWith("]"))
	) {
		try {
			JSON.parse(trimmed);
			return "json";
		} catch {
			// Not valid JSON
		}
	}

	return "text";
}

function tryFormatValue(value: string, dataType: string): string {
	const lang = detectLanguage({ rowIndex: 0, columnName: "", columnDataType: dataType, value });
	if (lang === "json") {
		try {
			return JSON.stringify(JSON.parse(value.trim()), null, 2);
		} catch {
			return value;
		}
	}
	return value;
}

function handleSave(): void {
	if (cell) {
		let saveValue = draftValue;
		if (editorLanguage === "json") {
			try {
				saveValue = JSON.stringify(JSON.parse(draftValue));
			} catch {
				// Keep as-is if not valid JSON
			}
		}
		onSave(cell.rowIndex, cell.columnName, saveValue);
		onOpenChange(false);
	}
}
</script>

<DialogFrame
	{open}
	title="Edit cell"
	closeLabel="Close cell editor"
	size="wide"
	portalDisabled={true}
	{onOpenChange}
>
	{#snippet topLeft()}
		<span class="truncate text-[11px] font-semibold text-foreground select-none">Edit cell</span>
		{#if cell}
			<span class="truncate text-[11px] text-muted-foreground">
				{cell.columnName}
				{#if cell.columnDataType}
					({cell.columnDataType})
				{/if}
			</span>
			{#if editorLanguage !== "text"}
				<span
					class="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase text-primary"
				>
					{editorLanguage}
				</span>
			{/if}
		{/if}
	{/snippet}

	<div class="px-3 py-3">
		<div class="h-[320px] overflow-hidden rounded-lg border border-input">
			{#if open}
				<CodeMirrorEditor
					value={draftValue}
					language={editorLanguage}
					readonly={readOnly}
					class="h-full"
					onChange={(v) => (draftValue = v)}
				/>
			{/if}
		</div>
	</div>

	{#snippet footer()}
		<Button variant="invert" size="header" onclick={handleSave} disabled={readOnly}>Save</Button>
	{/snippet}
</DialogFrame>
