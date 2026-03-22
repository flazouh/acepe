<script lang="ts">
import {
	type FilePanelFormatKind,
	getFilePanelFormatKind,
	parseStructuredContent,
} from "./file-panel-format.js";
import FilePanelStructuredNode from "./file-panel-structured-node.svelte";

interface Props {
	content: string;
	filePath: string;
	formatKind?: FilePanelFormatKind;
}

let { content, filePath, formatKind }: Props = $props();

const parseResult = $derived.by(() => {
	const detected = formatKind ?? getFilePanelFormatKind(filePath);
	return parseStructuredContent(content, detected);
});

const parseError = $derived.by(() => {
	const result = parseResult;
	return result.isErr() ? result.error.message : null;
});

const parsedData = $derived.by(() => {
	const result = parseResult;
	return result.isOk() ? result.value : null;
});
</script>

{#if parseError}
	<div
		class="text-sm text-destructive p-3 border border-destructive/20 rounded-md bg-destructive/5"
	>
		<div class="font-medium">Unable to parse structured content</div>
		<div class="mt-1 text-xs">{parseError}</div>
	</div>
{:else if parsedData !== null}
	<div class="structured-root p-2">
		<FilePanelStructuredNode value={parsedData} initiallyExpanded={true} />
	</div>
{/if}

<style>
	.structured-root {
		min-height: 100%;
	}
</style>
