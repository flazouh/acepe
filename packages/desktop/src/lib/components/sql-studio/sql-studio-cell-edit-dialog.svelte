<script lang="ts">
import FloppyDisk from "phosphor-svelte/lib/FloppyDisk";
import { Button } from "$lib/components/ui/button/index.js";
import { CodeMirrorEditor } from "$lib/components/ui/codemirror-editor/index.js";
import * as Dialog from "$lib/components/ui/dialog/index.js";

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

	// Heuristic: if the value looks like JSON, use JSON highlighting
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
		// Compact JSON back before saving
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

<Dialog.Root {open} {onOpenChange}>
	<Dialog.Content class="sm:max-w-2xl" portalProps={{ disabled: true }}>
		<Dialog.Header>
			<Dialog.Title>Edit cell</Dialog.Title>
			<Dialog.Description>
				{#if cell}
					<span class="font-medium">{cell.columnName}</span>
					{#if cell.columnDataType}
						<span class="text-muted-foreground"> ({cell.columnDataType})</span>
					{/if}
					{#if editorLanguage !== "text"}
						<span
							class="ml-2 inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase text-primary"
						>
							{editorLanguage}
						</span>
					{/if}
				{/if}
			</Dialog.Description>
		</Dialog.Header>
		<div class="h-[320px] overflow-hidden rounded-md border border-input">
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
		<Dialog.Footer>
			<Button
				variant="outline"
				class="h-8 px-4 rounded-full"
				onclick={handleSave}
				disabled={readOnly}
			>
				<FloppyDisk weight="fill" class="size-4 mr-1 text-primary" />
				Save
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
